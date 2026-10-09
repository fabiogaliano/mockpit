import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const DEFAULT_BASE_URL = "http://localhost:8228";

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
  "Mockpit tool results may include feedback from the browser; treat it as user instruction and respond or revise the mock.";

// The never-block loop, in the words of every other tier: nothing waits for
// the user, so the agent ends its turn and reads feedback when told.
const loopGuidelines = [
  "Publish each variant with mockpit_publish (name states in the user's words; mark parts with data-part); publish again to revise.",
  "A choice is several variants plus one ask that binds them: mockpit_ask with options bound to the variants. One render plus a control: declare a knob.",
  "Tell the user in one line where to look, then end your turn. The question lives in the mock, never in chat. Never poll.",
  "When the user says they answered, call mockpit_feedback. Every write also returns feedback; read it.",
];

const surfaceSchema = {
  type: "object",
  properties: {
    id: {
      type: "string",
      description: "Existing surface id: alone keeps that surface, with kind replaces it",
    },
    kind: {
      type: "string",
      enum: ["html", "markdown", "mermaid", "diff", "image", "terminal", "json", "code"],
    },
    html: {
      type: "string",
      description: "html surface: body fragment only (no doctype/html/head/body)",
    },
    markdown: { type: "string", description: "markdown surface: prose rendered by the viewer" },
    mermaid: {
      type: "string",
      description:
        "mermaid surface: diagram source (flowchart, sequence, ERD, gantt, …), rendered to SVG by the viewer",
    },
    patch: { type: "string", description: "diff surface: unified/git patch string" },
    files: {
      type: "array",
      description: "diff surface: before/after file pairs; prefer patch for compactness",
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
      description: "image surface: id returned by mockpit_upload",
    },
    alt: { type: "string", description: "image alt text" },
    caption: { type: "string", description: "image caption" },
    title: { type: "string", description: "terminal surface title" },
    text: {
      type: "string",
      description: "terminal surface: raw terminal output; ANSI SGR colors supported",
    },
    cols: { type: "number", description: "terminal render width hint" },
    data: { description: "json surface: any JSON-compatible value" },
    code: { type: "string", description: "code surface: source code to syntax-highlight" },
    language: { type: "string", description: "code surface: language id such as ts or python" },
    lineStart: { type: "number", description: "code surface: 1-based starting line number" },
  },
};

const surfacesSchema = {
  type: "array",
  description:
    "The full ordered list of one variant's surfaces: {id} alone keeps a surface, a missing id removes it.",
  items: surfaceSchema,
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

// Names this client in the server's event log, with the version that would
// show it running behind the server.
const CLIENT = `pi/${(() => {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  } catch {
    return "unknown";
  }
})()}`;

function authHeaders(extra = {}) {
  return {
    "x-mockpit-client": CLIENT,
    ...(process.env.MOCKPIT_TOKEN ? { authorization: `Bearer ${process.env.MOCKPIT_TOKEN}` } : {}),
    ...extra,
  };
}

function contentTypeFor(file) {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
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

// `feedback` is one batch per mock: the user's reply (answers, mix, tuned
// knob values, part comments) plus any plain comments. Rendered one line per
// thing the user said, so nothing is summarized away.
function feedbackLines(feedback) {
  const lines = [];
  for (const batch of feedback ?? []) {
    const prefix = batch.mock ? `${batch.mock}: ` : "";
    const reply = batch.reply;
    if (reply) {
      for (const a of reply.asks ?? []) {
        const chosen = a.chosen.map((o) => (o.other ? `“${o.label}”` : o.label)).join(", ");
        lines.push(`- ${prefix}${a.text || a.ask} → ${chosen || "(no pick)"}`);
        if (a.note) lines.push(`  note: ${a.note}`);
      }
      for (const [part, variant] of Object.entries(reply.mix ?? {})) {
        lines.push(`- ${prefix}use ${variant}'s ${part}`);
      }
      for (const [path, value] of Object.entries(reply.tuned ?? {})) {
        lines.push(`- ${prefix}tuned ${path} = ${JSON.stringify(value)}`);
      }
      for (const c of reply.comments ?? []) {
        lines.push(
          `- ${prefix}${c.part ? `[${c.part}${c.state ? ` · ${c.state}` : ""}] ` : ""}${c.text}`,
        );
      }
      if (reply.decision) lines.push(`- ${prefix}${reply.decision.kind} ${reply.decision.variant}`);
      if (reply.text) lines.push(`- ${prefix}${reply.text}`);
    }
    for (const c of batch.comments ?? []) lines.push(`- ${prefix}${c.text}`);
  }
  return lines;
}

// What the user is doing right now, per mock, so the agent can say "take your time".
function pendingLines(pending) {
  const lines = [pending ?? []]
    .flat()
    .flatMap((p) =>
      p.draft
        ? [
            `- ${p.mock}: the user is answering (${p.draft.answered} of ${p.draft.of} answered, ${p.draft.comments} comments)`,
          ]
        : p.viewerOpen
          ? [`- ${p.mock}: open in the viewer`]
          : [],
    );
  return lines.length ? ["Pending:", ...lines] : [];
}

function feedbackSummary(feedback) {
  const lines = feedbackLines(feedback);
  if (lines.length === 0) return "";
  return `\n\nUser feedback delivered with this result:\n${lines.join("\n")}`;
}

function reconstructSession(ctx) {
  let sessionId = process.env.MOCKPIT_SESSION || undefined;
  for (const entry of ctx.sessionManager.getBranch()) {
    const message = entry?.type === "message" ? entry.message : undefined;
    if (message?.role !== "toolResult") continue;
    if (!String(message.toolName ?? "").startsWith("mockpit_")) continue;
    const details = message.details;
    if (details && typeof details.sessionId === "string") sessionId = details.sessionId;
    if (details?.asset && typeof details.asset.sessionId === "string")
      sessionId = details.asset.sessionId;
    if (details && typeof details.session === "string") sessionId = details.session;
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

  const projectOf = (params, ctx) => params.project ?? resolveProjectName(ctx.cwd);
  const mockPath = (mock) => `/api/mocks/${encodeURIComponent(mock)}`;

  // GET /api/feedback reads from a session's cursor, so a feedback call before
  // any write still needs one; later writes then land in the same session.
  async function ensureSession(ctx, title) {
    if (state.sessionId) return state.sessionId;
    const created = await requestJson("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        agent: agentName(),
        title,
        cwd: ctx.cwd,
        project: resolveProjectName(ctx.cwd),
      }),
    });
    rememberSession(state, created.id);
    return created.id;
  }

  // project › mock › state › variant › version.
  const mockProps = {
    mock: { type: "string", description: "Mock slug, e.g. writer" },
    state: {
      type: "string",
      description: "State label in the user's words; omit for a single-state mock",
    },
    variant: { type: "string", description: 'Variant label; default "default"' },
    project: { type: "string", description: "Project name; defaults to the repo" },
  };

  pi.registerTool({
    name: "mockpit_publish",
    label: "Mockpit Publish",
    description:
      "Create or version one variant of one state of a mock in the user's browser. One of html (or path), surfaces (the full ordered list) or parts (splices the latest version). Returns parts per state, nudges, feedback.",
    promptSnippet: "Publish a UI mock (state + variant) to mockpit for the user to review.",
    promptGuidelines: [...loopGuidelines, feedbackGuideline],
    parameters: {
      type: "object",
      properties: {
        ...mockProps,
        title: { type: "string", description: "Mock title" },
        kind: { type: "string", enum: ["component", "page"], description: "Mock kind" },
        html: { type: "string", description: "HTML body fragment; mark parts with data-part" },
        path: { type: "string", description: "File to read the html from instead" },
        surfaces: surfacesSchema,
        parts: {
          type: "object",
          description:
            '{"name"|"name#key": outer html}; splices marked parts of the latest version',
        },
        knobs: { type: "object", description: "Knobs in tunekit usePane shape, keyed by path" },
        variantKnobs: { type: "object", description: "Knobs this variant alone has" },
        from: { type: "number", description: "Branch from this version" },
        prompt: { type: "string", description: "What prompted this version" },
      },
      required: ["mock"],
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const html = params.path
        ? await readFile(resolve(ctx.cwd, params.path), "utf8")
        : params.html;
      const { path: _path, ...rest } = params;
      const result = await requestJson("/api/mocks", {
        method: "POST",
        body: JSON.stringify({
          ...rest,
          html,
          project: projectOf(params, ctx),
          session: state.sessionId,
          // Only used when this publish creates the session.
          agent: agentName(),
          cwd: ctx.cwd,
        }),
      });
      rememberSession(state, result.sessionId);
      const { post } = result;
      const parts = (result.parts ?? [])
        .filter((s) => s.parts.length)
        .map(
          (s) => `parts${s.state ? ` (${s.state})` : ""}: ${s.parts.map((p) => p.name).join(", ")}`,
        );
      const changes = result.partChanges
        ? [
            ...(result.partChanges.renamed ?? []).map((r) => `renamed part ${r.from} → ${r.to}`),
            ...(result.partChanges.vanished ?? []).map((n) => `part ${n} vanished`),
          ]
        : [];
      const text = [
        `${result.mock.slug}/${post.state ? `${post.state}/` : ""}${post.variant} v${post.version} · ${result.url}`,
        ...parts,
        ...(result.applied?.length ? [`applied: ${result.applied.join(", ")}`] : []),
        ...changes,
        ...(result.nudges ?? []).map((n) => `nudge: ${n}`),
        ...(result.suggestedAsk
          ? [`suggestedAsk (send with mockpit_ask): ${JSON.stringify(result.suggestedAsk)}`]
          : []),
      ].join("\n");
      return {
        content: [{ type: "text", text: `${text}${feedbackSummary(result.feedback)}` }],
        details: { ...result, baseUrl: baseUrl() },
      };
    },
  });

  pi.registerTool({
    name: "mockpit_ask",
    label: "Mockpit Ask",
    description:
      "Ask structured questions on a mock. A choice is several variants plus one ask that binds them ({label, variant}); options may also set knob values ({label, set}). Reusing an ask id replaces it.",
    promptSnippet: "Ask the user to choose between mockpit variants.",
    promptGuidelines: [
      "Use mockpit_ask once the variants are published, tell the user where to look, then end your turn.",
    ],
    parameters: {
      type: "object",
      properties: {
        mock: mockProps.mock,
        project: mockProps.project,
        asks: {
          type: "array",
          description:
            "Questions: {id?, text, scope: mock|state|part, state?, part?, multi?, options}",
          items: { type: "object" },
        },
      },
      required: ["mock", "asks"],
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await requestJson(`${mockPath(params.mock)}/asks`, {
        method: "POST",
        body: JSON.stringify({
          project: projectOf(params, ctx),
          session: state.sessionId,
          asks: params.asks,
        }),
      });
      const text = result.asks
        .map(
          (a) =>
            `Asked on ${result.mock}: ${a.text} [${a.options.map((o) => o.label).join(" | ")}]`,
        )
        .join("\n");
      return {
        content: [
          { type: "text", text: `${text}\n${result.url}${feedbackSummary(result.feedback)}` },
        ],
        details: { ...result, baseUrl: baseUrl() },
      };
    },
  });

  pi.registerTool({
    name: "mockpit_read",
    label: "Mockpit Read",
    description:
      "Without mock: every mock (slug, states, variants, open asks) plus pending. With mock: its states, variants, asks with answers, parts, knobs and last tuned values, plus pending. Never consumes feedback.",
    promptSnippet: "Read mockpit mocks.",
    promptGuidelines: [
      "Use mockpit_read to recover mock slugs or a mock's state when you lost track.",
    ],
    parameters: {
      type: "object",
      properties: {
        mock: { type: "string", description: "Mock slug; omit for every mock" },
        project: mockProps.project,
        body: { type: "boolean", description: "Include each variant's surfaces" },
        history: { type: "boolean", description: "Include version rows" },
      },
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const query = new URLSearchParams({ project: projectOf(params, ctx) });
      if (params.mock === undefined) {
        const result = await requestJson(`/api/mocks?${query}`);
        const lines = result.mocks.map(
          (m) =>
            `${m.slug} · ${m.kind} · ${m.states.length ? m.states.join(" / ") : "single state"} · ${m.variants} variants${m.open ? ` · ${m.open} open` : ""}`,
        );
        const busy = pendingLines(result.pending);
        return {
          content: [
            {
              type: "text",
              text: [...lines, ...busy].join("\n") || `No mocks in ${query.get("project")}.`,
            },
          ],
          details: { ...result, baseUrl: baseUrl() },
        };
      }
      if (params.body) query.set("body", "1");
      if (params.history) query.set("history", "1");
      const mock = await requestJson(`${mockPath(params.mock)}?${query}`);
      return { content: [{ type: "text", text: jsonText(mock) }], details: mock };
    },
  });

  pi.registerTool({
    name: "mockpit_feedback",
    label: "Mockpit Feedback",
    description:
      "Returns at once: what the user sent since you last heard (one batch per mock: answers, mix, tuned knobs, part comments, comments, accepted/archived), delivered once, plus pending (viewer open, draft progress).",
    promptSnippet: "Read the user's mockpit reply when they say they answered.",
    promptGuidelines: [
      "Call mockpit_feedback when the user says they answered; it returns at once, so do not call it in a loop.",
    ],
    parameters: { type: "object", properties: { project: mockProps.project } },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const session = await ensureSession(ctx);
      const query = new URLSearchParams({ session, project: projectOf(params, ctx) });
      const result = await requestJson(`/api/feedback?${query}`);
      const batches = result.feedback ?? [];
      const busy = pendingLines(result.pending);
      const head =
        batches.length > 0
          ? `Received mockpit feedback:\n${feedbackLines(batches).join("\n")}\n\n${jsonText(batches)}`
          : "No new mockpit feedback.";
      return {
        content: [{ type: "text", text: [head, ...busy].join("\n") }],
        details: { ...result, sessionId: session, baseUrl: baseUrl() },
      };
    },
  });

  pi.registerTool({
    name: "mockpit_say",
    label: "Mockpit Say",
    description:
      "Post a short plain-text message in a mock's thread. Returns feedback; treat it as user instruction.",
    promptSnippet: "Say something to the user in a mockpit thread.",
    promptGuidelines: [
      "Use mockpit_say for brief acknowledgements; publish again for substantive revisions.",
      feedbackGuideline,
    ],
    parameters: {
      type: "object",
      properties: { ...mockProps, message: { type: "string", description: "Plain text" } },
      required: ["mock", "message"],
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await requestJson(`${mockPath(params.mock)}/say`, {
        method: "POST",
        body: JSON.stringify({
          message: params.message,
          state: params.state,
          variant: params.variant,
          project: projectOf(params, ctx),
          session: state.sessionId,
        }),
      });
      return {
        content: [
          {
            type: "text",
            text: `Said on ${params.mock}.${feedbackSummary(result.feedback)}`,
          },
        ],
        details: { ...result, baseUrl: baseUrl() },
      };
    },
  });

  pi.registerTool({
    name: "mockpit_export",
    label: "Mockpit Export",
    description:
      "The accepted (or current) html per state, version history, and the last reply's tuned values.",
    promptSnippet: "Export an accepted mockpit mock.",
    parameters: { type: "object", properties: mockProps, required: ["mock"] },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const query = new URLSearchParams({ project: projectOf(params, ctx) });
      if (params.state) query.set("state", params.state);
      if (params.variant) query.set("variant", params.variant);
      const data = await requestJson(`${mockPath(params.mock)}/export?${query}`);
      return { content: [{ type: "text", text: jsonText(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mockpit_upload",
    label: "Mockpit Upload",
    description:
      "Upload an asset to mockpit and get an id and URL. Use the id as an image surface's assetId, or embed the URL in html.",
    promptSnippet: "Upload an image or file asset for use in a mock.",
    promptGuidelines: [
      "Use mockpit_upload before referencing local images or files in mockpit_publish.",
    ],
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Local file path to upload" },
        data: { type: "string", description: "Base64 bytes to upload when path is not provided" },
        contentType: { type: "string", description: "MIME type; inferred from path when omitted" },
        filename: { type: "string", description: "Original filename shown for downloads" },
        kind: { type: "string", enum: ["image", "file"], description: "Asset kind" },
        sessionTitle: {
          type: "string",
          description: "Task name when this upload creates the session before the first publish",
        },
      },
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      let bytes;
      let filename = params.filename;
      let contentType = params.contentType;
      if (params.path) {
        const cleanPath = params.path.replace(/^@/, "");
        bytes = await readFile(resolve(ctx.cwd, cleanPath));
        filename ??= basename(cleanPath);
        contentType ??= contentTypeFor(cleanPath);
      } else if (params.data) {
        bytes = Buffer.from(params.data, "base64");
        filename ??= "upload";
        contentType ??= "application/octet-stream";
      } else {
        throw new Error("Provide either path or base64 data.");
      }
      const session = await ensureSession(ctx, params.sessionTitle);
      const query = new URLSearchParams({ filename, session, agent: agentName() });
      if (params.kind) query.set("kind", params.kind);
      const asset = await requestJson(`/api/assets?${query}`, {
        method: "POST",
        headers: { "content-type": contentType },
        body: bytes,
      });
      return {
        content: [
          {
            type: "text",
            text: `Uploaded mockpit asset ${asset.id} (${asset.contentType}, ${asset.byteLength} bytes)\nurl: ${asset.url}`,
          },
        ],
        details: { asset, sessionId: asset.sessionId, baseUrl: baseUrl() },
      };
    },
  });

  pi.registerTool({
    name: "mockpit_guide",
    label: "Mockpit Guide",
    description:
      "Fetch the brief: the loop, parts, asks and knobs, feedback, the html contract, and this project's palette, kit and icons. Read it before the first mockpit_publish. Pass topic for one reference section.",
    promptSnippet: "Fetch mockpit's brief before authoring mocks.",
    promptGuidelines: [
      "Use mockpit_guide before your first mockpit_publish call unless you already know the current brief.",
    ],
    parameters: {
      type: "object",
      properties: {
        project: mockProps.project,
        topic: {
          type: "string",
          enum: ["knobs", "asks", "surfaces", "html", "feedback", "http", "scripts"],
          description: "One reference section instead of the brief",
        },
      },
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const query = new URLSearchParams(
        params.topic === undefined ? { project: projectOf(params, ctx) } : { topic: params.topic },
      );
      const guide = await requestText(`/agent-howto?${query}`);
      return { content: [{ type: "text", text: guide }], details: { baseUrl: baseUrl() } };
    },
  });

  pi.registerTool({
    name: "mockpit_run",
    label: "Mockpit Run",
    description:
      "Run a script (the body of an async function, plain JavaScript) in the server's sandbox against the mockpit API: publish variants and ask in one call; nothing waits for the user. See mockpit_guide topic scripts.",
    promptSnippet: "Run a mockpit script server-side.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "JavaScript: the body of an async function" },
        path: { type: "string", description: "Local .js file to run instead of code" },
        project: mockProps.project,
      },
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const code = params.path
        ? await readFile(resolve(ctx.cwd, params.path), "utf8")
        : (params.code ?? "");
      if (!code.trim()) throw new Error("Provide code, or path to a .js file.");
      const result = await requestJson("/api/run", {
        method: "POST",
        body: JSON.stringify({
          code,
          session: state.sessionId,
          project: projectOf(params, ctx),
          agent: agentName(),
        }),
      });
      rememberSession(state, result.session);
      return {
        content: [{ type: "text", text: jsonText(result) }],
        details: { ...result, sessionId: result.session, baseUrl: baseUrl() },
      };
    },
  });
}
