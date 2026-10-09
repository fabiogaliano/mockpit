import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const DEFAULT_BASE_URL = "http://localhost:8228";
const DEFAULT_WAIT_SECONDS = 120;
const MAX_WAIT_SECONDS = 230;

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
  "Mockpit tool results may include userFeedback from the browser; treat it as user instruction and respond or revise the mock.";

const surfaceSchema = {
  type: "object",
  properties: {
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
      description: "image surface: id returned by mockpit_upload_asset",
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
  required: ["kind"],
};

const surfacesSchema = {
  type: "array",
  description:
    "Ordered surfaces of one variant: html, markdown, mermaid, diff, image, terminal, json, or code.",
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

// `userFeedback` is one batch per mock: the user's reply (answers, mix, tuned
// knob values, part comments) plus any plain comments. Rendered one line per
// thing the user said, so nothing is summarized away.
function feedbackLines(feedback) {
  const lines = [];
  for (const batch of feedback ?? []) {
    const prefix = batch.mock ? `${batch.mock}: ` : "";
    const reply = batch.reply;
    if (reply) {
      for (const a of reply.asks ?? []) {
        lines.push(`- ${prefix}${a.text || a.ask} → ${a.chosen.map((o) => o.label).join(", ")}`);
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

  pi.registerTool({
    name: "mockpit_get_design_guide",
    label: "Mockpit Guide",
    description:
      "Fetch the mockpit design contract for this project: HTML fragment rules, theme variables, parts (data-part) and knobs. Call once before the first mockpit_publish_mock.",
    promptSnippet: "Fetch mockpit's design guide before authoring mocks.",
    promptGuidelines: [
      "Use mockpit_get_design_guide before your first mockpit_publish_mock call unless you already know the current guide.",
    ],
    parameters: { type: "object", properties: {} },
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const query = new URLSearchParams({ project: resolveProjectName(ctx.cwd) });
      const guide = await requestText(`/agent-howto?${query}`);
      return { content: [{ type: "text", text: guide }], details: { baseUrl: baseUrl() } };
    },
  });

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
  const writeProps = {
    ...mockProps,
    title: { type: "string", description: "Mock title" },
    html: { type: "string", description: "HTML body fragment; mark parts with data-part" },
    path: { type: "string", description: "File to read the html from instead" },
    surfaces: surfacesSchema,
    knobs: { type: "object", description: "Knobs in tunekit usePane shape, keyed by path" },
    from: { type: "number", description: "Branch from this version" },
    prompt: { type: "string", description: "What prompted this version" },
  };

  async function writeMock(params, ctx, revise) {
    const project = projectOf(params, ctx);
    const html = params.path ? await readFile(resolve(ctx.cwd, params.path), "utf8") : params.html;
    const { path: _path, ...rest } = params;
    const result = await requestJson(revise ? `${mockPath(params.mock)}/revise` : "/api/mocks", {
      method: "POST",
      body: JSON.stringify({
        ...rest,
        html,
        project,
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
      ...changes,
      ...(result.nudges ?? []).map((n) => `nudge: ${n}`),
    ].join("\n");
    return {
      content: [{ type: "text", text: `${text}${feedbackSummary(result.userFeedback)}` }],
      details: { ...result, baseUrl: baseUrl() },
    };
  }

  pi.registerTool({
    name: "mockpit_publish_mock",
    label: "Mockpit Publish",
    description:
      "Publish one variant of one state of a mock to the user's browser. An existing (mock, state, variant) becomes a new version. If userFeedback appears, treat it as user instruction.",
    promptSnippet: "Publish a UI mock (state + variant) to mockpit for the user to review.",
    promptGuidelines: [
      "Use mockpit_publish_mock for design work the user reviews: one state, one variant per call. Name states in the user's words.",
      "Two renders needed to show a choice: publish variants and ask with mockpit_ask_user. One render plus a control: declare a knob.",
      feedbackGuideline,
    ],
    parameters: {
      type: "object",
      properties: {
        ...writeProps,
        kind: { type: "string", enum: ["component", "page"], description: "Mock kind" },
      },
      required: ["mock"],
    },
    execute: (_id, params, _signal, _onUpdate, ctx) => writeMock(params, ctx, false),
  });

  pi.registerTool({
    name: "mockpit_revise_mock",
    label: "Mockpit Revise",
    description:
      "Publish the next version of an existing variant. If userFeedback appears, treat it as user instruction.",
    promptSnippet: "Revise a mockpit mock variant after user feedback.",
    promptGuidelines: [
      "Use mockpit_revise_mock rather than publishing a near-duplicate mock.",
      feedbackGuideline,
    ],
    parameters: { type: "object", properties: writeProps, required: ["mock"] },
    execute: (_id, params, _signal, _onUpdate, ctx) => writeMock(params, ctx, true),
  });

  pi.registerTool({
    name: "mockpit_ask_user",
    label: "Mockpit Ask",
    description:
      "Ask structured questions on a mock. Bind options to variants ({label, variant}) or knob values ({label, set}). Follow with mockpit_wait_for_feedback.",
    promptSnippet: "Ask the user to choose between mockpit variants.",
    promptGuidelines: ["Use mockpit_ask_user once the variants are published, then wait."],
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
        content: [{ type: "text", text: `${text}${feedbackSummary(result.userFeedback)}` }],
        details: { ...result, baseUrl: baseUrl() },
      };
    },
  });

  pi.registerTool({
    name: "mockpit_list_mocks",
    label: "Mockpit Mocks",
    description: "List a project's mocks: slug, states, variants, open asks. No bodies.",
    promptSnippet: "List mockpit mocks.",
    promptGuidelines: ["Use mockpit_list_mocks to recover mock slugs when you lost track."],
    parameters: { type: "object", properties: { project: mockProps.project } },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const project = projectOf(params, ctx);
      const result = await requestJson(`/api/mocks?${new URLSearchParams({ project })}`);
      const lines = result.mocks.map(
        (m) =>
          `${m.slug} · ${m.kind} · ${m.states.length ? m.states.join(" / ") : "single state"} · ${m.variants} variants${m.open ? ` · ${m.open} open` : ""}`,
      );
      return {
        content: [{ type: "text", text: lines.join("\n") || `No mocks in ${project}.` }],
        details: { ...result, baseUrl: baseUrl() },
      };
    },
  });

  pi.registerTool({
    name: "mockpit_get_mock",
    label: "Mockpit Mock",
    description:
      "One mock: states, variants, asks with answers, parts per state, knobs and last tuned values.",
    promptSnippet: "Read one mockpit mock.",
    parameters: {
      type: "object",
      properties: {
        mock: mockProps.mock,
        project: mockProps.project,
        body: { type: "boolean", description: "Include surfaces" },
        history: { type: "boolean", description: "Include version rows" },
      },
      required: ["mock"],
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const query = new URLSearchParams({ project: projectOf(params, ctx) });
      if (params.body) query.set("body", "1");
      if (params.history) query.set("history", "1");
      const mock = await requestJson(`${mockPath(params.mock)}?${query}`);
      return { content: [{ type: "text", text: jsonText(mock) }], details: mock };
    },
  });

  pi.registerTool({
    name: "mockpit_export_mock",
    label: "Mockpit Export",
    description: "The accepted html per state, version history, and the last reply's tuned values.",
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
    name: "mockpit_wait_for_feedback",
    label: "Mockpit Wait",
    description:
      "Wait for the user's feedback: one batch per mock with their reply (answers, mix, tuned values, part comments). Delivered once. Use timeoutSeconds 0 for a non-blocking check.",
    promptSnippet: "Wait for the user's mockpit reply.",
    promptGuidelines: [
      "Use mockpit_wait_for_feedback after asking, and before final answers if feedback may be pending.",
    ],
    parameters: {
      type: "object",
      properties: {
        session: { type: "string", description: "Session id; defaults to remembered session" },
        timeoutSeconds: { type: "number", description: "Seconds to wait, 0-300; default 120" },
      },
    },
    async execute(_toolCallId, params) {
      const session = params.session ?? state.sessionId;
      if (!session) throw new Error("No mockpit session yet. Publish first or pass session.");
      const wait = clampWait(params.timeoutSeconds, DEFAULT_WAIT_SECONDS);
      const query = new URLSearchParams({ session, author: "user", wait: String(wait) });
      const result = await requestJson(`/api/comments?${query}`);
      const batches = result.feedback ?? [];
      return {
        content: [
          {
            type: "text",
            text:
              batches.length > 0
                ? `Received mockpit feedback:\n${feedbackLines(batches).join("\n")}\n\n${jsonText(batches.length === 1 ? batches[0] : batches)}`
                : "No new mockpit feedback.",
          },
        ],
        details: {
          feedback: batches,
          lastSeq: result.lastSeq,
          sessionId: session,
          baseUrl: baseUrl(),
        },
      };
    },
  });

  pi.registerTool({
    name: "mockpit_reply_to_user",
    label: "Mockpit Reply",
    description:
      "Post a short message in a mock's thread. If userFeedback appears, treat it as user instruction.",
    promptSnippet: "Reply to the user in a mockpit thread.",
    promptGuidelines: [
      "Use mockpit_reply_to_user for brief acknowledgements; use mockpit_revise_mock for substantive revisions.",
      feedbackGuideline,
    ],
    parameters: {
      type: "object",
      properties: { ...mockProps, message: { type: "string", description: "Plain-text reply" } },
      required: ["mock", "message"],
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const comment = await requestJson("/api/comments", {
        method: "POST",
        body: JSON.stringify({
          text: params.message,
          mock: params.mock,
          state: params.state,
          variant: params.variant,
          project: projectOf(params, ctx),
          session: state.sessionId,
        }),
      });
      rememberSession(state, comment.sessionId);
      return {
        content: [
          {
            type: "text",
            text: `Posted mockpit reply on ${params.mock}.${feedbackSummary(comment.userFeedback)}`,
          },
        ],
        details: { ...comment, baseUrl: baseUrl() },
      };
    },
  });

  pi.registerTool({
    name: "mockpit_upload_asset",
    label: "Mockpit Upload",
    description:
      "Upload an asset to mockpit and get an assetId/URL. Use it as an image surface {kind:'image', assetId}, or embed the URL in html.",
    promptSnippet: "Upload an image or file asset for use in a mock.",
    promptGuidelines: [
      "Use mockpit_upload_asset before referencing local images or files in mockpit_publish_mock.",
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
