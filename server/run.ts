// Server-side codemode: one `run` executes an agent's script against the same
// flows REST and MCP call, with the caller's identity. Runtime-agnostic — the
// sandbox itself is an `Executor` the host passes in (server/codeRunner.ts on
// Node); a deployment without one answers that `run` is unavailable.
//
// The script is a new untrusted channel into the trusted origin, gated like the
// bridge: it never sees a credential, binds only agent verbs (never Send,
// drafts, accept/drop, settings), and every way out goes through a host call
// that is counted, bounded and logged.

import type { FlowContext, FlowResult } from "./app.ts";
import type { FeedbackBatch } from "./feedbackBatch.ts";
import { type GuideTopic, isGuideTopic, unknownTopicMessage } from "./designGuide.ts";
import { type McpFlows, unwrap } from "./mcpHttp.ts";
import { RUN_FUNCTIONS, type RunFunction } from "./runApi.ts";
import type { Store } from "./types.ts";

export interface RunLimits {
  // Wall time for the whole run, waits included.
  deadlineMs: number;
  // Script compute time, summed over its synchronous bursts.
  cpuMs: number;
  memoryBytes: number;
  stackBytes: number;
  maxCodeBytes: number;
  // value + prints, in characters, before head/tail truncation.
  maxOutputChars: number;
  maxCalls: number;
  maxInflight: number;
  // Concurrent runs per app, like the SSE/long-poll ceiling.
  maxRuns: number;
}

// 200 s keeps a whole run under claude.ai's 240 s per-tool-call limit. 32 MiB and
// a 256 KiB stack are what the spike showed safe (512 KiB overflows the host
// stack on workerd). The code cap clears a few full-page html variants written
// as template literals.
export const DEFAULT_RUN_LIMITS: RunLimits = {
  deadlineMs: 200_000,
  cpuMs: 10_000,
  memoryBytes: 32 * 1024 * 1024,
  stackBytes: 256 * 1024,
  maxCodeBytes: 1024 * 1024,
  maxOutputChars: 24_000,
  maxCalls: 100,
  maxInflight: 4,
  maxRuns: 4,
};

export type RunErrorKind = "script" | "timeout" | "limit" | "aborted";

export interface RunError {
  kind: RunErrorKind;
  message: string;
  line?: number;
  column?: number;
}

export interface ExecRequest {
  code: string;
  limits: RunLimits;
  // Fires when the caller goes away; the executor stops the script at once.
  signal: AbortSignal;
  // A host call: JSON array of arguments in, JSON value out; rejects with the
  // message the script's promise rejects with.
  call(name: string, argsJson: string): Promise<string>;
  print(line: string): void;
}

// `json` is the script's return value, JSON-encoded inside the sandbox
// (undefined when it returned nothing).
export type ExecResult = { ok: true; json?: string } | { ok: false; error: RunError };

export interface Executor {
  run(request: ExecRequest): Promise<ExecResult>;
}

export interface RunCall {
  fn: string;
  ok: boolean;
  summary: string;
}

export interface RunEnvelope {
  ok: boolean;
  value?: unknown;
  prints: string[];
  calls: RunCall[];
  error?: RunError;
  // Every batch the run received — waits and piggyback alike — whatever the
  // script did afterwards. The cursor already moved past these.
  feedback: FeedbackBatch[];
  session: string | null;
  truncated?: true;
}

export interface RunDeps {
  store: Store;
  executor?: Executor;
  limits: RunLimits;
  flows: McpFlows;
  guide(project: string, topic?: GuideTopic): string | Promise<string>;
  createSession(input: { agent: string; project?: string }): Promise<string>;
}

const DEFAULT_WAIT_SECONDS = 55;
const MAX_WAIT_SECONDS = 230;

export const RUN_UNAVAILABLE =
  "run is not available on this deployment: it has no script sandbox. Use the mock tools (or REST) instead";

const text = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

const plain = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

// Keep the head and the tail: the start says what a value is, the end is where
// a failing log usually explains itself.
export function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  const keep = Math.max(0, max - 40);
  const head = Math.ceil(keep / 2);
  return `${s.slice(0, head)}\n…[${s.length - keep} chars cut]…\n${s.slice(s.length - (keep - head))}`;
}

function writeSummary(body: any): string {
  const post = body?.post;
  const slug = body?.mock?.slug ?? "?";
  if (!post) return slug;
  return `${slug}/${post.state ? `${post.state}/` : ""}${post.variant} v${post.version}`;
}

// Host calls past `size` in flight queue rather than fail, so Promise.all over
// a handful of publishes just works.
function semaphore(size: number) {
  const queue: (() => void)[] = [];
  let used = 0;
  return {
    async take(): Promise<void> {
      if (used < size) {
        used++;
        return;
      }
      await new Promise<void>((resolve) => queue.push(resolve));
    },
    give(): void {
      const next = queue.shift();
      if (next) next();
      else used--;
    },
  };
}

export function createRunFlow(deps: RunDeps) {
  const { store, flows, limits } = deps;
  let active = 0;

  return async function runFlow(body: any, ctx: FlowContext): Promise<FlowResult> {
    const executor = deps.executor;
    if (!executor) return { status: 501, body: { error: RUN_UNAVAILABLE } };
    if (!body || typeof body !== "object")
      return { status: 400, body: { error: "invalid JSON body" } };
    const code = body.code;
    if (typeof code !== "string" || !code.trim()) {
      return { status: 400, body: { error: 'provide "code": the body of an async function' } };
    }
    let sessionId: string | null = null;
    let project = text(body.project, 500);
    if (typeof body.session === "string" && body.session) {
      const session = await store.getSession(body.session);
      if (!session) return { status: 404, body: { error: `session "${body.session}" not found` } };
      sessionId = session.id;
      project ??= session.project ?? undefined;
    }
    const agent = text(body.agent, 500) ?? "agent";

    const prints: string[] = [];
    const calls: RunCall[] = [];
    const feedback: FeedbackBatch[] = [];
    let printed = 0;
    let truncated = false;
    const envelope = (ok: boolean, extra: Partial<RunEnvelope>): FlowResult => ({
      status: 200,
      body: {
        ok,
        ...extra,
        prints,
        calls,
        feedback,
        session: sessionId,
        ...(truncated ? { truncated: true } : {}),
      } satisfies RunEnvelope,
    });

    if (new TextEncoder().encode(code).byteLength > limits.maxCodeBytes) {
      return envelope(false, {
        error: { kind: "limit", message: `code exceeds ${limits.maxCodeBytes} bytes` },
      });
    }
    if (active >= limits.maxRuns) {
      return { status: 503, body: { error: "too many concurrent runs; retry shortly" } };
    }
    active++;

    const startedAt = Date.now();
    const run = new AbortController();
    const onAbort = () => run.abort();
    ctx.signal?.addEventListener("abort", onAbort, { once: true });
    if (ctx.signal?.aborted) run.abort();
    // A script is agent code: it never acts as the user, whatever origin sent it.
    const flowCtx: FlowContext = { ...ctx, viewer: false, strict: false, signal: run.signal };
    const gate = semaphore(limits.maxInflight);
    const inflight = new Set<Promise<unknown>>();

    const session = async (): Promise<string> =>
      (sessionId ??= await deps.createSession({ agent, project }));
    const mine = async (v: Record<string, unknown>) => ({
      ...v,
      session: await session(),
      ...(project ? { project } : {}),
    });
    const take = async (result: Promise<FlowResult>): Promise<any> => {
      const value = unwrap(await result) as any;
      if (Array.isArray(value?.userFeedback)) feedback.push(...value.userFeedback);
      return value;
    };
    const projectOf = async (): Promise<string> => {
      if (project) return project;
      const projects = await store.listProjects();
      return projects[0]?.name ?? "workspace";
    };

    // Each host function returns [value the script sees, one-line summary].
    const host: Record<RunFunction, (a: unknown[]) => Promise<[unknown, string]>> = {
      async guide([topic]) {
        if (topic === undefined || topic === null)
          return [await deps.guide(await projectOf()), "brief"];
        if (!isGuideTopic(topic)) throw new Error(unknownTopicMessage(String(topic)));
        return [await deps.guide("", topic), String(topic)];
      },
      async list() {
        const value = await take(flows.list({ project: await projectOf() }));
        return [value.mocks, `${value.mocks.length} mocks`];
      },
      async get([mock, opts]) {
        const o = plain(opts);
        const value = await take(
          flows.get(mock, { project, body: o.body === true, history: o.history === true }),
        );
        return [value, String(value?.slug ?? mock)];
      },
      async publish([v]) {
        const value = await take(flows.publish({ ...(await mine(plain(v))), agent }, flowCtx));
        return [value, writeSummary(value)];
      },
      async revise([v]) {
        const value = await take(flows.revise(await mine(plain(v)), flowCtx));
        return [value, writeSummary(value)];
      },
      async ask([mock, asks]) {
        const value = await take(flows.ask(mock, await mine({ asks }), flowCtx));
        return [value, `${value.mock} ${value.asks.length} ask(s)`];
      },
      async wait([seconds]) {
        if (!sessionId) {
          throw new Error(
            "wait needs a session: publish or ask in this run first, or run with session",
          );
        }
        // Return before the deadline so the batch reaches the envelope through
        // the script, not just through a cut-off run.
        const margin = Math.min(5000, limits.deadlineMs / 10);
        const left = (startedAt + limits.deadlineMs - margin - Date.now()) / 1000;
        const asked = typeof seconds === "number" && seconds >= 0 ? seconds : DEFAULT_WAIT_SECONDS;
        const waitSeconds = Math.max(0, Math.min(asked, MAX_WAIT_SECONDS, left));
        const value = await take(
          flows.feedback({ sessionId, author: "user", waitSeconds }, run.signal),
        );
        const batches = (value.feedback ?? []) as FeedbackBatch[];
        feedback.push(...batches);
        return [batches, batches.length ? `${batches.length} batch(es)` : "no feedback"];
      },
      async reply([v, message]) {
        await take(flows.comment({ ...(await mine(plain(v))), text: message }, flowCtx));
        return [null, String(plain(v).mock ?? "?")];
      },
      async "surfaces.add"([v, surface, at]) {
        const r = plain(v);
        const value = await take(
          flows.appendSurface(r.mock, { ...(await mine(r)), surface, ...plain(at) }, flowCtx),
        );
        return [value, writeSummary(value)];
      },
      async "surfaces.edit"([v, target, change]) {
        const r = plain(v);
        const value = await take(
          flows.replaceSurface(
            r.mock,
            String(target ?? ""),
            { ...(await mine(r)), ...plain(change) },
            flowCtx,
          ),
        );
        return [value, writeSummary(value)];
      },
      async "surfaces.remove"([v, target]) {
        const r = plain(v);
        const value = await take(
          flows.removeSurface(r.mock, String(target ?? ""), await mine(r), flowCtx),
        );
        return [value, writeSummary(value)];
      },
      async "surfaces.reorder"([v, order]) {
        const r = plain(v);
        const value = await take(
          flows.reorderSurfaces(r.mock, { ...(await mine(r)), order }, flowCtx),
        );
        return [value, writeSummary(value)];
      },
      async export([v]) {
        const r = plain(v);
        const value = await take(flows.exportMock(r.mock, { ...r, project }, flowCtx));
        return [value, `${value.mock} ${value.states.length} state(s)`];
      },
    };

    const call = (name: string, argsJson: string): Promise<string> => {
      const entry: RunCall = { fn: name, ok: false, summary: "cancelled" };
      calls.push(entry);
      const fail = (message: string) => {
        entry.summary = message;
        return Promise.reject(new Error(message));
      };
      if (run.signal.aborted) return fail("run ended");
      if (calls.length > limits.maxCalls) return fail(`call limit of ${limits.maxCalls} reached`);
      const fn = (RUN_FUNCTIONS as readonly string[]).includes(name)
        ? host[name as RunFunction]
        : undefined;
      if (!fn) return fail(`mockpit.${name} is not a function`);
      const work = (async () => {
        await gate.take();
        try {
          if (run.signal.aborted) throw new Error("run ended");
          const args = JSON.parse(argsJson) as unknown[];
          const [value, summary] = await fn(Array.isArray(args) ? args : []);
          entry.ok = true;
          entry.summary = summary;
          return JSON.stringify(value ?? null);
        } catch (err) {
          entry.summary = err instanceof Error ? err.message : String(err);
          throw err;
        } finally {
          gate.give();
        }
      })();
      inflight.add(work);
      work.then(
        () => inflight.delete(work),
        () => inflight.delete(work),
      );
      return work;
    };

    const print = (line: string) => {
      if (truncated) return;
      if (printed + line.length > limits.maxOutputChars) {
        truncated = true;
        prints.push(cut(line, Math.max(0, limits.maxOutputChars - printed)));
        prints.push("…[further prints cut]");
        return;
      }
      printed += line.length;
      prints.push(line);
    };

    try {
      let result: ExecResult;
      try {
        result = await executor.run({ code, limits, signal: run.signal, call, print });
      } catch (err) {
        result = {
          ok: false,
          error: {
            kind: "limit",
            message: `sandbox failed: ${err instanceof Error ? err.message : err}`,
          },
        };
      }
      // Writes already sent finish and land in `calls`; an aborted wait returns
      // without moving the cursor.
      run.abort();
      await Promise.allSettled(inflight);
      if (ctx.signal?.aborted && (result.ok || result.error.kind !== "aborted")) {
        result = { ok: false, error: { kind: "aborted", message: "the caller went away" } };
      }
      if (!result.ok) return envelope(false, { error: result.error });
      if (result.json === undefined) return envelope(true, {});
      const room = Math.max(1000, limits.maxOutputChars - printed);
      if (result.json.length <= room) return envelope(true, { value: JSON.parse(result.json) });
      truncated = true;
      return envelope(true, { value: cut(result.json, room) });
    } finally {
      ctx.signal?.removeEventListener("abort", onAbort);
      active--;
    }
  };
}
