// The event log: one entry per call that moves the loop (agent writes and
// reads, viewer writes, the viewer's live feed), so a session can be diagnosed
// after the fact — which client sent what, which reply seqs it was handed, what
// the agent was told was pending. Shapes and ids only, never html or comment
// text: the store already holds the content under the same ids, and a log that
// copied it would be a second, unbounded store. `scripts/inspect.ts` reads it.

import type { Context, MiddlewareHandler } from "hono";

export interface LogEntry {
  t: string;
  // "POST /api/mocks", "mcp publish", "sse close".
  op: string;
  // The x-mockpit-client header ("cli/1.0.0", "mcp-stdio/1.0.0", "pi/1.0.0"),
  // else "viewer", "mcp-http" or "http". The version is how a stale client
  // still running against a newer server shows up.
  client: string;
  status: number;
  ms: number;
  session?: string;
  project?: string;
  // The slug when the response names it, else the id the request did.
  mock?: string;
  state?: string | null;
  variant?: string;
  version?: number;
  // Comment seqs handed to the agent in this response: the exactly-once
  // cursor made visible.
  delivered?: number[];
  // What the agent was told the user is doing: "writer 2/3 answered", "card open".
  pending?: string[];
  nudges?: number;
  // The seq a viewer Send created.
  reply?: number;
  // The mock an SSE client has on screen.
  viewing?: string;
  key?: string;
  error?: string;
}

export type LogSink = (entry: LogEntry) => void;

const MAX_ERROR = 300;
const CLIENT = /^[\w.@/-]{1,64}$/;

export function clientOf(header: string | undefined, viewer: boolean, mcp: boolean): string {
  if (header && CLIENT.test(header)) return header;
  if (viewer) return "viewer";
  return mcp ? "mcp-http" : "http";
}

const isObj = (v: unknown): v is Record<string, any> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const text = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v.slice(0, 200) : undefined;

// What the request itself names, for calls whose response doesn't (errors,
// feedback reads).
export function fromRequest(
  query: URLSearchParams,
  body: unknown,
  pathMock: string | undefined,
): Partial<LogEntry> {
  const b = isObj(body) ? body : {};
  return prune({
    session: text(query.get("session")) ?? text(b.session),
    project: text(query.get("project")) ?? text(b.project),
    mock: pathMock ?? text(b.mock),
    variant: text(b.variant),
    viewing: text(query.get("viewing")),
  });
}

// What a flow's response body says about the call.
export function fromResponse(body: unknown): Partial<LogEntry> {
  if (!isObj(body)) return {};
  const mock = isObj(body.mock) ? body.mock : undefined;
  const post = isObj(body.post) ? body.post : undefined;
  // POST /api/sessions answers with the bare session (201 new, 200 reclaimed by key).
  const session = typeof body.agentSeq === "number" ? body : undefined;
  const delivered = deliveredSeqs(body.feedback);
  const pending = pendingLines(body.pending);
  return prune({
    session: text(body.sessionId) ?? text(post?.sessionId) ?? text(session?.id),
    key: text(session?.key),
    project: text(mock?.project) ?? text(body.project) ?? text(session?.project),
    mock:
      text(mock?.slug) ??
      text(body.slug) ??
      (typeof body.mock === "string" ? text(body.mock) : undefined),
    state: post ? (post.state ?? null) : undefined,
    variant: text(post?.variant),
    version: typeof post?.version === "number" ? post.version : undefined,
    delivered: delivered.length ? delivered : undefined,
    pending: pending.length ? pending : undefined,
    nudges: Array.isArray(body.nudges) && body.nudges.length ? body.nudges.length : undefined,
    reply: isObj(body.reply) && typeof body.reply.seq === "number" ? body.reply.seq : undefined,
    error: typeof body.error === "string" ? body.error.slice(0, MAX_ERROR) : undefined,
  });
}

function deliveredSeqs(feedback: unknown): number[] {
  if (!Array.isArray(feedback)) return [];
  const seqs: number[] = [];
  for (const batch of feedback) {
    if (!isObj(batch)) continue;
    if (isObj(batch.reply) && typeof batch.reply.seq === "number") seqs.push(batch.reply.seq);
    for (const c of Array.isArray(batch.comments) ? batch.comments : []) {
      if (isObj(c) && typeof c.seq === "number") seqs.push(c.seq);
    }
  }
  return seqs.sort((a, b) => a - b);
}

function pendingLines(pending: unknown): string[] {
  const rows = Array.isArray(pending) ? pending : isObj(pending) ? [pending] : [];
  return rows.flatMap((p) => {
    if (!isObj(p) || typeof p.mock !== "string") return [];
    if (isObj(p.draft)) return [`${p.mock} ${p.draft.answered}/${p.draft.of} answered`];
    return p.viewerOpen ? [`${p.mock} open`] : [];
  });
}

function prune(entry: Record<string, unknown>): Partial<LogEntry> {
  for (const k of Object.keys(entry)) if (entry[k] === undefined) delete entry[k];
  return entry as Partial<LogEntry>;
}

// A sink that throws must never fail the request it describes.
export function writeLog(sink: LogSink | undefined, entry: LogEntry): void {
  if (!sink) return;
  try {
    sink(entry);
  } catch {
    // The log is diagnostics; losing an entry beats losing the call.
  }
}

// The viewer's reads (it refetches on every feed event) would drown the agent's
// calls, so only its writes and its feed connection are logged.
function loggable(c: Context, viewer: boolean): boolean {
  const path = c.req.path;
  if (path === "/mcp") return c.req.method === "POST";
  if (!path.startsWith("/api/")) return false;
  return path === "/api/events" || c.req.method !== "GET" || !viewer;
}

const isJson = (type: string | null | undefined) => !!type?.includes("application/json");

export function logMiddleware(sink: LogSink): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now();
    await next();
    const viewer = c.req.header("sec-fetch-site") === "same-origin";
    if (!loggable(c, viewer)) return;
    try {
      const url = new URL(c.req.url);
      // Handlers already parsed the body; Hono hands back its cached copy.
      const reqBody = isJson(c.req.header("content-type"))
        ? await c.req.json().catch(() => undefined)
        : undefined;
      // Never clone a non-JSON body: a clone of the SSE stream is a tee branch
      // nobody reads, which buffers every event for the connection's life.
      const resBody = isJson(c.res.headers.get("content-type"))
        ? await c.res
            .clone()
            .json()
            .catch(() => undefined)
        : undefined;
      const mcp = c.req.path === "/mcp";
      const entry: LogEntry = {
        t: new Date().toISOString(),
        op: mcp ? mcpOp(reqBody) : `${c.req.method} ${c.req.path}`,
        client: clientOf(c.req.header("x-mockpit-client"), viewer, mcp),
        status: c.res.status,
        ms: Date.now() - start,
      };
      if (mcp) {
        const call = isObj(reqBody) && isObj(reqBody.params) ? reqBody.params : {};
        Object.assign(entry, fromRequest(url.searchParams, call.arguments, undefined));
        Object.assign(entry, fromMcpResult(resBody));
      } else {
        const pathMock = /^\/api\/mocks\/([^/]+)/.exec(c.req.path)?.[1];
        Object.assign(entry, fromRequest(url.searchParams, reqBody, pathMock));
        Object.assign(entry, fromResponse(resBody));
      }
      writeLog(sink, entry);
    } catch {
      // Same as writeLog: diagnostics never fail the call.
    }
  };
}

function mcpOp(body: unknown): string {
  if (!isObj(body)) return "mcp";
  if (body.method === "tools/call" && isObj(body.params)) {
    return `mcp ${text(body.params.name) ?? "?"}`;
  }
  return `mcp ${text(body.method) ?? "?"}`;
}

// A tool result carries the flow's JSON body: structured where the tool
// declares an output schema, else as its text content.
function fromMcpResult(body: unknown): Partial<LogEntry> {
  if (!isObj(body)) return {};
  if (isObj(body.error)) return { error: String(body.error.message).slice(0, MAX_ERROR) };
  const result = isObj(body.result) ? body.result : {};
  if (isObj(result.structuredContent)) return fromResponse(result.structuredContent);
  const first = Array.isArray(result.content) ? result.content[0] : undefined;
  const raw = isObj(first) && typeof first.text === "string" ? first.text : undefined;
  if (raw === undefined) return {};
  if (result.isError) return { error: raw.slice(0, MAX_ERROR) };
  try {
    return fromResponse(JSON.parse(raw));
  } catch {
    return {};
  }
}
