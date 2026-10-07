import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const DEFAULT_BASE_URL = "http://localhost:8228";
const MAX_WAIT_SECONDS = 300;
const TRACE_MAX_DETAIL = 1800;
const TRACE_MAX_LABEL = 140;

const CONTENT_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  json: "application/json",
  jsonl: "application/x-ndjson",
  ndjson: "application/x-ndjson",
  txt: "text/plain",
  log: "text/plain",
  csv: "text/csv",
  pdf: "application/pdf",
};

const feedbackGuideline =
  "Mockpit tool results may include userFeedback from browser comments; treat it as user instruction and respond or update the surface.";

const partSchema = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: ["html", "markdown", "mermaid", "diff", "image", "terminal", "json", "code"],
    },
    html: {
      type: "string",
      description: "html part: body fragment only (no doctype/html/head/body)",
    },
    markdown: { type: "string", description: "markdown part: prose rendered by the viewer" },
    mermaid: {
      type: "string",
      description:
        "mermaid part: diagram source (flowchart, sequence, ERD, gantt, …), rendered to SVG by the viewer",
    },
    patch: { type: "string", description: "diff part: unified/git patch string" },
    files: {
      type: "array",
      description: "diff part: before/after file pairs; prefer patch for compactness",
      items: {
        type: "object",
        properties: {
          filename: { type: "string" },
          before: { type: "string" },
          after: { type: "string" },
          language: { type: "string" },
        },
        required: ["filename", "before", "after"],
      },
    },
    layout: { type: "string", enum: ["unified", "split"] },
    assetId: {
      type: "string",
      description: "image part: id returned by mockpit_upload_asset",
    },
    alt: { type: "string", description: "image alt text" },
    caption: { type: "string", description: "image caption" },
    title: { type: "string", description: "terminal part title" },
    text: {
      type: "string",
      description: "terminal part: raw terminal output; ANSI SGR colors supported",
    },
    cols: { type: "number", description: "terminal render width hint" },
    data: { description: "json part: any JSON-compatible value" },
    code: { type: "string", description: "code part: source code to syntax-highlight" },
    language: { type: "string", description: "code part: language id such as ts or python" },
    lineStart: { type: "number", description: "code part: 1-based starting line number" },
  },
  required: ["kind"],
};

const partsSchema = {
  type: "array",
  description:
    "Ordered mockpit surface parts. Combine html, markdown, mermaid, diff, image, terminal, json, and code parts in one card.",
  items: partSchema,
};

function baseUrl() {
  return (process.env.MOCKPIT_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function agentName() {
  return process.env.MOCKPIT_AGENT || "pi";
}

// A project is the repo the agent runs in — same resolution order as the CLI so
// both tiers land in the same project.
function resolveProjectName(cwd) {
  if (process.env.MOCKPIT_PROJECT) return process.env.MOCKPIT_PROJECT;
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const m = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/);
    if (m) return `${m[1]}/${m[2]}`;
  } catch {
    // not a git checkout
  }
  return (
    String(cwd ?? "")
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() || "workspace"
  );
}

function authHeaders(extra = {}) {
  return {
    ...(process.env.MOCKPIT_TOKEN ? { authorization: `Bearer ${process.env.MOCKPIT_TOKEN}` } : {}),
    ...extra,
  };
}

function contentTypeFor(file) {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function clampWait(value, fallback) {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_WAIT_SECONDS, Math.max(0, Math.floor(n)));
}

function jsonText(value) {
  return JSON.stringify(value, null, 2);
}

async function requestJson(path, init = {}) {
  let response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: authHeaders({
        ...(init.body && !(init.body instanceof Uint8Array)
          ? { "content-type": "application/json" }
          : {}),
        ...init.headers,
      }),
    });
  } catch (error) {
    throw new Error(
      `mockpit server not reachable at ${baseUrl()} — start it with "mockpit serve" (${error.message})`,
    );
  }

  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { text };
    }
  }

  if (!response.ok) {
    const message =
      body && typeof body.error === "string"
        ? body.error
        : `${response.status} ${response.statusText}`;
    throw new Error(`mockpit ${path} failed: ${message}`);
  }

  return body;
}

async function requestText(path) {
  let response;
  try {
    response = await fetch(`${baseUrl()}${path}`, { headers: authHeaders() });
  } catch (error) {
    throw new Error(
      `mockpit server not reachable at ${baseUrl()} — start it with "mockpit serve" (${error.message})`,
    );
  }
  const text = await response.text();
  if (!response.ok)
    throw new Error(`mockpit ${path} failed: ${response.status} ${response.statusText}`);
  return text;
}

function rememberSession(state, sessionId) {
  if (typeof sessionId === "string" && sessionId) state.sessionId = sessionId;
}

function urlForSurface(surfaceId) {
  return `${baseUrl()}/p/${surfaceId}`;
}

// `userFeedback` is one batch per item — a decision plus the comments the user
// released with it. Older servers send a flat comment list; both render as one
// line per thing the user said, so nothing is ever summarized away.
function feedbackSummary(feedback) {
  if (!Array.isArray(feedback) || feedback.length === 0) return "";
  const lines = [];
  for (const item of feedback) {
    const where = [item.slug, item.variant].filter(Boolean).join("/") || item.surfaceTitle || "";
    const prefix = where ? `${where}: ` : "";
    if (item.decision)
      lines.push(
        `- ${prefix}${item.decision.kind}${item.decision.text ? ` — ${item.decision.text}` : ""}`,
      );
    if (Array.isArray(item.comments)) {
      for (const c of item.comments) lines.push(`- ${prefix}${c.text}`);
    } else if (item.text) {
      lines.push(`- ${prefix}${item.text}`);
    }
    if (item.archived?.length) lines.push(`- ${prefix}archived ${item.archived.join(", ")}`);
  }
  if (lines.length === 0) return "";
  return `\n\nUser feedback delivered with this result:\n${lines.join("\n")}`;
}

const truncStr = (value, max) => {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block?.type === "text" && typeof block.text === "string") return block.text;
      return "";
    })
    .join("");
}

function entryTimestamp(entry, message) {
  if (typeof message?.timestamp === "number") return new Date(message.timestamp).toISOString();
  return typeof entry?.timestamp === "string" ? entry.timestamp : undefined;
}

function baseName(path) {
  return typeof path === "string" ? path.split(/[\\/]/).pop() || path : "";
}

function summarizePiTool(name, args) {
  if (name === "read") return { kind: "read", label: `Read ${baseName(args?.path)}` };
  if (["edit", "write"].includes(name))
    return { kind: "edit", label: `Edit ${baseName(args?.path)}` };
  if (name === "bash") return { kind: "run", label: args?.command ?? "command" };
  if (name === "web_fetch") return { kind: "web", label: `Fetch ${args?.url ?? ""}` };
  if (name === "web_search")
    return { kind: "web", label: `Search ${JSON.stringify(args?.query ?? "")}` };
  if (name === "subagent")
    return { kind: "agent", label: args?.agent ?? args?.action ?? "Subagent" };
  if (name?.startsWith("mockpit_"))
    return { kind: "mockpit", label: name.replace(/^mockpit_/, "") };
  return { kind: (name || "tool").toLowerCase().slice(0, 20), label: name || "tool" };
}

function buildPiTraceSteps(ctx) {
  const steps = [];
  const pending = new Map();
  for (const entry of ctx.sessionManager.getBranch()) {
    const message = entry?.type === "message" ? entry.message : undefined;
    if (!message) continue;
    const ts = entryTimestamp(entry, message);

    if (message.role === "user") {
      const prompt = contentText(message.content).trim();
      if (prompt) {
        steps.push({
          kind: "prompt",
          label: truncStr(prompt.split("\n")[0], TRACE_MAX_LABEL),
          detail: truncStr(prompt, TRACE_MAX_DETAIL),
          ts,
        });
      }
      continue;
    }

    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block?.type === "thinking" && typeof block.thinking === "string") {
          const thought = block.thinking.trim();
          if (thought) {
            steps.push({
              kind: "think",
              label: truncStr(thought.split("\n")[0], TRACE_MAX_LABEL),
              ts,
            });
          }
        } else if (block?.type === "text" && typeof block.text === "string") {
          const say = block.text.trim();
          if (say) {
            steps.push({
              kind: "say",
              label: truncStr(say.split("\n")[0], TRACE_MAX_LABEL),
              detail: truncStr(say, TRACE_MAX_DETAIL),
              ts,
            });
          }
        } else if (block?.type === "toolCall") {
          const { kind, label } = summarizePiTool(block.name, block.arguments);
          steps.push({
            kind,
            label: truncStr(label, TRACE_MAX_LABEL),
            detail: truncStr(JSON.stringify(block.arguments ?? {}), TRACE_MAX_DETAIL),
            ts,
          });
          if (block.id) pending.set(block.id, steps.length - 1);
        }
      }
      continue;
    }

    if (message.role === "toolResult") {
      const idx = pending.get(message.toolCallId);
      if (idx != null) {
        const output = truncStr(contentText(message.content), 1200).trim();
        if (output)
          steps[idx].detail = truncStr(`${steps[idx].detail}\n\n→ ${output}`, TRACE_MAX_DETAIL);
        pending.delete(message.toolCallId);
      }
      continue;
    }

    if (message.role === "bashExecution") {
      steps.push({
        kind: "run",
        label: truncStr(message.command ?? "shell command", TRACE_MAX_LABEL),
        detail: truncStr(message.output ?? "", TRACE_MAX_DETAIL),
        ts,
      });
    }
  }
  return steps;
}

function scopeToSurfaces(steps, surfaceTimes, pad = 5) {
  if (!surfaceTimes.length) return steps;
  const promptTs = steps
    .filter((step) => step.kind === "prompt" && step.ts)
    .map((step) => Date.parse(step.ts))
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);
  if (!promptTs.length) return steps;
  const first = surfaceTimes[0];
  const last = surfaceTimes[surfaceTimes.length - 1];
  const countAtOrBefore = (time) => promptTs.filter((prompt) => prompt <= time).length;
  const startIdx = Math.max(0, countAtOrBefore(first) - 1 - pad);
  const endIdx = Math.min(promptTs.length - 1, Math.max(0, countAtOrBefore(last) - 1) + pad);
  const startTs = promptTs[startIdx];
  const endTs = endIdx + 1 < promptTs.length ? promptTs[endIdx + 1] : Infinity;
  return steps.filter((step) => {
    const time = step.ts ? Date.parse(step.ts) : NaN;
    return Number.isFinite(time) && time >= startTs && time < endTs;
  });
}

async function syncPiTrace(state, ctx, { all = false, pad = 5 } = {}) {
  if (!state.sessionId) return { skipped: true, reason: "no-session" };
  let steps = buildPiTraceSteps(ctx);
  if (!all) {
    const surfaces = await requestJson(
      `/api/sessions/${encodeURIComponent(state.sessionId)}/surfaces`,
    );
    const surfaceTimes = (Array.isArray(surfaces) ? surfaces : [])
      .map((surface) => Date.parse(surface.createdAt))
      .filter((time) => Number.isFinite(time))
      .sort((a, b) => a - b);
    steps = scopeToSurfaces(steps, surfaceTimes, pad);
  }
  const result = await requestJson(`/api/sessions/${encodeURIComponent(state.sessionId)}/trace`, {
    method: "POST",
    body: JSON.stringify({ steps, reset: true }),
  });
  return { ...result, sent: steps.length, sessionId: state.sessionId };
}

function reconstructSession(ctx) {
  let sessionId = process.env.MOCKPIT_SESSION || undefined;
  for (const entry of ctx.sessionManager.getBranch()) {
    const message = entry?.type === "message" ? entry.message : undefined;
    if (message?.role !== "toolResult") continue;
    if (!String(message.toolName ?? "").startsWith("mockpit_")) continue;
    const details = message.details;
    if (details && typeof details.sessionId === "string") sessionId = details.sessionId;
    if (details?.surface && typeof details.surface.sessionId === "string")
      sessionId = details.surface.sessionId;
    if (details?.asset && typeof details.asset.sessionId === "string")
      sessionId = details.asset.sessionId;
  }
  return sessionId;
}

export default function mockpitExtension(pi) {
  const state = { sessionId: process.env.MOCKPIT_SESSION || undefined };

  pi.on("session_start", (_event, ctx) => {
    state.sessionId = reconstructSession(ctx);
    ctx.ui.setStatus(
      "mockpit",
      state.sessionId
        ? `mockpit ${state.sessionId}`
        : `mockpit ${baseUrl().replace(/^https?:\/\//, "")}`,
    );
  });

  pi.on("turn_end", async (_event, ctx) => {
    if (!state.sessionId) return;
    try {
      await syncPiTrace(state, ctx);
    } catch {
      // Trace sync should never interfere with the agent turn.
    }
  });

  pi.registerCommand("mockpit", {
    description: "Show mockpit extension status or reset its remembered session: /mockpit [reset]",
    handler: async (args, ctx) => {
      const command = args.trim();
      if (command === "reset") {
        state.sessionId = process.env.MOCKPIT_SESSION || undefined;
        ctx.ui.setStatus("mockpit", `mockpit ${baseUrl().replace(/^https?:\/\//, "")}`);
        ctx.ui.notify("Reset remembered mockpit session", "info");
        return;
      }
      ctx.ui.notify(
        `mockpit: ${baseUrl()}${state.sessionId ? ` (session ${state.sessionId})` : " (no session yet)"}`,
        "info",
      );
    },
  });

  pi.registerTool({
    name: "mockpit_get_design_guide",
    label: "Mockpit Guide",
    description:
      "Fetch the mockpit design contract: surface parts, HTML fragment rules, theme variables, and interactivity bridge. Call once before the first mockpit publish in a session.",
    promptSnippet: "Fetch mockpit's design guide before authoring live preview surfaces.",
    promptGuidelines: [
      "Use mockpit_get_design_guide before your first mockpit_publish_surface call in a session unless you already know the current guide.",
    ],
    parameters: { type: "object", properties: {} },
    async execute() {
      const guide = await requestText("/guide");
      return {
        content: [{ type: "text", text: guide }],
        details: { baseUrl: baseUrl() },
      };
    },
  });

  // --- project › item › variant › version ------------------------------------
  // The design loop: publish a variant, revise it, ask, then read one batched
  // answer. The surface-era tools below stay for back-compat.

  const itemProps = {
    slug: { type: "string", description: "Item slug, e.g. pricing-card" },
    project: { type: "string", description: "Project name; defaults to the repo" },
    variant: { type: "string", description: 'Variant label; default "default"' },
  };

  async function publishItem(params, ctx, kind) {
    const project = params.project ?? resolveProjectName(ctx.cwd);
    const html = params.path ? await readFile(resolve(ctx.cwd, params.path), "utf8") : params.html;
    if (!html) throw new Error("Provide html or path.");
    const post = await requestJson("/api/posts", {
      method: "POST",
      body: JSON.stringify({
        project,
        slug: params.slug,
        variant: params.variant,
        kind: kind ?? params.kind ?? "component",
        title: params.title,
        from: params.from,
        prompt: params.prompt,
        surfaces: [{ kind: "html", html }],
        session: params.session ?? state.sessionId,
        // Only used when this publish is what creates the session; without it
        // an item-first conversation shows up as the anonymous "agent".
        agent: agentName(),
        cwd: ctx.cwd,
      }),
    });
    rememberSession(state, post.sessionId);
    const url = `${baseUrl()}/project/${encodeURIComponent(project)}/${post.slug ?? params.slug}`;
    return {
      content: [
        {
          type: "text",
          text: `${post.slug ?? params.slug}/${post.variant ?? params.variant ?? "default"} v${post.version} · ${url}${feedbackSummary(post.userFeedback)}`,
        },
      ],
      details: { ...post, project, url, baseUrl: baseUrl() },
    };
  }

  pi.registerTool({
    name: "mockpit_publish_item",
    label: "Mockpit Publish Item",
    description:
      "Publish a variant of an item (a component or page) to the user's browser. An existing (project, slug, variant) becomes a new version. If userFeedback appears, treat it as user instruction.",
    promptSnippet: "Publish a UI item variant to mockpit for the user to review.",
    promptGuidelines: [
      "Use mockpit_publish_item for design work the user reviews: one item, one variant per call.",
      feedbackGuideline,
    ],
    parameters: {
      type: "object",
      properties: {
        ...itemProps,
        kind: { type: "string", enum: ["component", "page"], description: "Item kind" },
        title: { type: "string", description: "Item title" },
        html: { type: "string", description: "HTML body fragment" },
        path: { type: "string", description: "File to read the html from instead" },
        from: { type: "number", description: "Branch from this version" },
        prompt: { type: "string", description: "What prompted this version" },
      },
      required: ["slug"],
    },
    execute: (_id, params, _signal, _onUpdate, ctx) => publishItem(params, ctx),
  });

  pi.registerTool({
    name: "mockpit_revise_item",
    label: "Mockpit Revise Item",
    description:
      "Publish the next version of an existing variant. If userFeedback appears, treat it as user instruction.",
    promptSnippet: "Revise a mockpit item variant after user feedback.",
    promptGuidelines: [
      "Use mockpit_revise_item rather than publishing a near-duplicate item.",
      feedbackGuideline,
    ],
    parameters: {
      type: "object",
      properties: {
        ...itemProps,
        html: { type: "string", description: "HTML body fragment" },
        path: { type: "string", description: "File to read the html from instead" },
        from: { type: "number", description: "Branch from this version" },
        prompt: { type: "string", description: "What prompted this version" },
      },
      required: ["slug"],
    },
    execute: (_id, params, _signal, _onUpdate, ctx) => publishItem(params, ctx),
  });

  pi.registerTool({
    name: "mockpit_ask_user",
    label: "Mockpit Ask",
    description:
      "Mark an item as waiting on the user and ask one question. Follow with mockpit_wait_for_feedback.",
    promptSnippet: "Ask the user to decide between mockpit item variants.",
    promptGuidelines: ["Use mockpit_ask_user once the variants are published, then wait."],
    parameters: {
      type: "object",
      properties: { ...itemProps, text: { type: "string", description: "The question" } },
      required: ["slug", "text"],
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const project = params.project ?? resolveProjectName(ctx.cwd);
      const item = await requestJson(
        `/api/projects/${encodeURIComponent(project)}/items/${encodeURIComponent(params.slug)}`,
      );
      const variants = item.variants ?? [];
      const chosen = params.variant
        ? variants.find((v) => v.variant === params.variant)
        : variants.length === 1
          ? variants[0]
          : null;
      if (!chosen) {
        throw new Error(
          `${params.slug} has ${variants.length} variants; pass variant: ${variants.map((v) => v.variant).join("|")}`,
        );
      }
      await requestJson(`/api/posts/${encodeURIComponent(chosen.postId)}/ask`, {
        method: "POST",
        body: JSON.stringify({ text: params.text }),
      });
      return {
        content: [
          { type: "text", text: `Asked on ${params.slug}/${chosen.variant}: ${params.text}` },
        ],
        details: { project, slug: params.slug, variant: chosen.variant, baseUrl: baseUrl() },
      };
    },
  });

  pi.registerTool({
    name: "mockpit_list_items",
    label: "Mockpit Items",
    description: "List a project's items: slug, kind, variants, and what is waiting. No bodies.",
    promptSnippet: "List mockpit items and their variants.",
    promptGuidelines: [
      "Use mockpit_list_items to recover item slugs and variants when you lost track of what is published.",
    ],
    parameters: { type: "object", properties: { project: itemProps.project } },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const project = params.project ?? resolveProjectName(ctx.cwd);
      const items = await requestJson(`/api/projects/${encodeURIComponent(project)}/items`);
      const lines = items.map(
        (item) =>
          `${item.slug} · ${item.kind} · ${(item.variants ?? []).map((v) => `${v.variant}(v${v.version}${v.status && v.status !== "open" ? `, ${v.status}` : ""})`).join(" ")}`,
      );
      return {
        content: [{ type: "text", text: lines.join("\n") || `No items in ${project}.` }],
        details: { project, items, baseUrl: baseUrl() },
      };
    },
  });

  pi.registerTool({
    name: "mockpit_publish_surface",
    label: "Mockpit Publish",
    description:
      "Publish a live mockpit surface to the user's browser. A surface is an ordered list of parts: html, markdown, mermaid, diff, image, terminal, json, or code. Returns surfaceId, sessionId, and URL. On first publish, set sessionTitle to the task name. If userFeedback appears, treat it as user instruction.",
    promptSnippet:
      "Publish diagrams, UI sketches, markdown, diffs, terminal output, images, JSON trees, or code to mockpit.",
    promptGuidelines: [
      "Use mockpit_publish_surface when a visual preview, diagram, UI sketch, rendered markdown, terminal output, or diff would help the user.",
      "Pass sessionTitle on the first mockpit_publish_surface call and name the user's task, not the tool.",
      feedbackGuideline,
    ],
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title shown above the surface card" },
        parts: partsSchema,
        session: {
          type: "string",
          description: "Existing session id; defaults to this extension's remembered session",
        },
        sessionTitle: { type: "string", description: "Task name for a newly created session" },
        agent: {
          type: "string",
          description: 'Agent name for a new session; defaults to MOCKPIT_AGENT or "pi"',
        },
        newSession: {
          type: "boolean",
          description: "Force a fresh mockpit session instead of reusing the remembered one",
        },
      },
      required: ["title", "parts"],
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const body = {
        title: params.title,
        parts: params.parts,
        session: params.newSession ? undefined : (params.session ?? state.sessionId),
        sessionTitle: params.sessionTitle,
        agent: params.agent ?? agentName(),
        cwd: ctx.cwd,
      };
      const surface = await requestJson("/api/surfaces", {
        method: "POST",
        body: JSON.stringify(body),
      });
      rememberSession(state, surface.sessionId);
      const url = urlForSurface(surface.id);
      return {
        content: [
          {
            type: "text",
            text: `Published mockpit surface "${surface.title}" at ${url}\nsurfaceId: ${surface.id}\nsessionId: ${surface.sessionId}${feedbackSummary(surface.userFeedback)}`,
          },
        ],
        details: { ...surface, url, baseUrl: baseUrl() },
      };
    },
  });

  pi.registerTool({
    name: "mockpit_update_surface",
    label: "Mockpit Update",
    description:
      "Revise an existing mockpit surface in place (same card, new version). Prefer updating over publishing near-duplicates. If userFeedback appears, treat it as user instruction.",
    promptSnippet: "Update an existing mockpit surface with revised parts or title.",
    promptGuidelines: [
      "Use mockpit_update_surface rather than publishing near-duplicate mockpit cards for revisions.",
      feedbackGuideline,
    ],
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Surface id returned by mockpit_publish_surface" },
        title: { type: "string", description: "Optional replacement title" },
        parts: partsSchema,
      },
      required: ["id"],
    },
    async execute(_toolCallId, params) {
      const body = { title: params.title, parts: params.parts };
      const surface = await requestJson(`/api/surfaces/${encodeURIComponent(params.id)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      rememberSession(state, surface.sessionId);
      const url = urlForSurface(surface.id);
      return {
        content: [
          {
            type: "text",
            text: `Updated mockpit surface "${surface.title}" to version ${surface.version} at ${url}${feedbackSummary(surface.userFeedback)}`,
          },
        ],
        details: { ...surface, url, baseUrl: baseUrl() },
      };
    },
  });

  pi.registerTool({
    name: "mockpit_wait_for_feedback",
    label: "Mockpit Wait",
    description:
      "Wait for user comments from the mockpit browser for the current or specified session. Returns only comments not yet delivered to the agent. Use timeoutSeconds 0 for a non-blocking drain.",
    promptSnippet: "Wait for or drain user browser comments from mockpit.",
    promptGuidelines: [
      "Use mockpit_wait_for_feedback after publishing a surface when you need a browser reaction, and before final answers if feedback may be pending.",
    ],
    parameters: {
      type: "object",
      properties: {
        session: { type: "string", description: "Session id; defaults to remembered session" },
        timeoutSeconds: { type: "number", description: "Seconds to wait, 0-300; default 60" },
        afterSeq: { type: "number", description: "Explicit cursor override; usually omit" },
      },
    },
    async execute(_toolCallId, params) {
      const session = params.session ?? state.sessionId;
      if (!session) throw new Error("No mockpit session yet. Publish first or pass session.");
      const wait = clampWait(params.timeoutSeconds, 60);
      const query = new URLSearchParams({ session, author: "user", wait: String(wait) });
      if (params.afterSeq !== undefined) query.set("after", String(params.afterSeq));
      const result = await requestJson(`/api/comments?${query}`);
      // Agent reads come back as one batch per item (decision + the comments
      // released with it); fall back to the flat list on an older server.
      const batches = Array.isArray(result.feedback) ? result.feedback : null;
      const count = batches
        ? batches.length
        : Array.isArray(result.comments)
          ? result.comments.length
          : 0;
      return {
        content: [
          {
            type: "text",
            text:
              count > 0
                ? batches
                  ? `Received ${count} mockpit feedback batch(es):\n${jsonText(batches.length === 1 ? batches[0] : batches)}`
                  : `Received ${count} mockpit comment(s):\n${jsonText(result.comments)}`
                : "No new mockpit feedback.",
          },
        ],
        details: { ...result, sessionId: session, baseUrl: baseUrl() },
      };
    },
  });

  pi.registerTool({
    name: "mockpit_reply_to_user",
    label: "Mockpit Reply",
    description:
      "Post a short agent reply into a mockpit surface thread. Use it to acknowledge browser feedback. If userFeedback appears, treat it as user instruction.",
    promptSnippet: "Reply to the user in a mockpit comment thread.",
    promptGuidelines: [
      "Use mockpit_reply_to_user for brief acknowledgements in the browser thread; use mockpit_update_surface for substantive revisions.",
      feedbackGuideline,
    ],
    parameters: {
      type: "object",
      properties: {
        surfaceId: { type: "string", description: "Surface thread to reply under" },
        message: { type: "string", description: "Plain-text reply" },
      },
      required: ["surfaceId", "message"],
    },
    async execute(_toolCallId, params) {
      const body = { text: params.message, surface: params.surfaceId };
      const comment = await requestJson("/api/comments", {
        method: "POST",
        body: JSON.stringify(body),
      });
      rememberSession(state, comment.sessionId);
      const surfaceId = comment.postId ?? comment.surfaceId;
      return {
        content: [
          {
            type: "text",
            text: `Posted mockpit reply${surfaceId ? ` on surface ${surfaceId}` : ""}.${feedbackSummary(comment.userFeedback)}`,
          },
        ],
        details: { ...comment, baseUrl: baseUrl() },
      };
    },
  });

  pi.registerTool({
    name: "mockpit_list_surfaces",
    label: "Mockpit List",
    description:
      "List mockpit surfaces in the remembered or specified session, or across all sessions.",
    promptSnippet: "List mockpit surfaces and ids for updates or replies.",
    parameters: {
      type: "object",
      properties: {
        session: {
          type: "string",
          description: "Session id; defaults to remembered session unless all is true",
        },
        all: { type: "boolean", description: "List surfaces from every session" },
        limit: {
          type: "number",
          description: "Maximum surfaces to include in the text summary; default 50",
        },
      },
    },
    async execute(_toolCallId, params) {
      const limit = Math.max(1, Math.floor(Number(params.limit ?? 50)));
      if (params.all) {
        const sessions = await requestJson("/api/sessions");
        const groups = [];
        for (const session of sessions) {
          const surfaces = await requestJson(
            `/api/sessions/${encodeURIComponent(session.id)}/surfaces`,
          );
          groups.push({ session, surfaces });
        }
        const lines = [];
        for (const group of groups) {
          for (const surface of group.surfaces) {
            if (lines.length >= limit) break;
            lines.push(`${surface.id} [${group.session.id}] ${surface.title} v${surface.version}`);
          }
          if (lines.length >= limit) break;
        }
        return {
          content: [
            { type: "text", text: lines.length ? lines.join("\n") : "No mockpit surfaces found." },
          ],
          details: { sessions: groups, baseUrl: baseUrl() },
        };
      }

      const session = params.session ?? state.sessionId;
      if (!session)
        throw new Error("No mockpit session yet. Publish first, pass session, or set all=true.");
      const surfaces = await requestJson(`/api/sessions/${encodeURIComponent(session)}/surfaces`);
      const lines = surfaces
        .slice(0, limit)
        .map(
          (surface) =>
            `${surface.id} ${surface.title} v${surface.version} ${urlForSurface(surface.id)}`,
        );
      return {
        content: [
          {
            type: "text",
            text: lines.length ? lines.join("\n") : "No mockpit surfaces in this session.",
          },
        ],
        details: { sessionId: session, surfaces, baseUrl: baseUrl() },
      };
    },
  });

  pi.registerTool({
    name: "mockpit_upload_asset",
    label: "Mockpit Upload",
    description:
      "Upload an asset to mockpit and get an assetId/URL. Use image assets in surface parts as {kind:'image', assetId}, or embed the URL in an html part.",
    promptSnippet: "Upload an image or file asset for use in mockpit surfaces.",
    promptGuidelines: [
      "Use mockpit_upload_asset before referencing local images or files in mockpit_publish_surface parts.",
    ],
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Local file path to upload" },
        data: { type: "string", description: "Base64 bytes to upload when path is not provided" },
        contentType: { type: "string", description: "MIME type; inferred from path when omitted" },
        filename: { type: "string", description: "Original filename shown for downloads" },
        kind: { type: "string", enum: ["image", "file"], description: "Asset kind" },
        session: {
          type: "string",
          description: "Session id; defaults to remembered session or creates one",
        },
        sessionTitle: {
          type: "string",
          description:
            "Task name when this upload needs to create a session before the first publish",
        },
        newSession: {
          type: "boolean",
          description: "Force a fresh mockpit session for this upload",
        },
      },
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      let bytes;
      let filename = params.filename;
      let contentType = params.contentType;
      if (params.path) {
        const cleanPath = params.path.replace(/^@/, "");
        const filePath = resolve(ctx.cwd, cleanPath);
        bytes = await readFile(filePath);
        filename ??= basename(cleanPath);
        contentType ??= contentTypeFor(cleanPath);
      } else if (params.data) {
        bytes = Buffer.from(params.data, "base64");
        filename ??= "upload";
        contentType ??= "application/octet-stream";
      } else {
        throw new Error("Provide either path or base64 data.");
      }

      let session = params.newSession ? undefined : (params.session ?? state.sessionId);
      if (!session && (params.sessionTitle || params.newSession)) {
        const created = await requestJson("/api/sessions", {
          method: "POST",
          body: JSON.stringify({ agent: agentName(), title: params.sessionTitle, cwd: ctx.cwd }),
        });
        session = created.id;
        rememberSession(state, session);
      }

      const query = new URLSearchParams();
      if (filename) query.set("filename", filename);
      if (params.kind) query.set("kind", params.kind);
      if (session) query.set("session", session);
      query.set("agent", agentName());

      const asset = await requestJson(`/api/assets?${query}`, {
        method: "POST",
        headers: { "content-type": contentType },
        body: bytes,
      });
      rememberSession(state, asset.sessionId);
      return {
        content: [
          {
            type: "text",
            text: `Uploaded mockpit asset ${asset.id} (${asset.contentType}, ${asset.byteLength} bytes)\nurl: ${asset.url}\nsessionId: ${asset.sessionId}`,
          },
        ],
        details: { asset, sessionId: asset.sessionId, baseUrl: baseUrl() },
      };
    },
  });
}
