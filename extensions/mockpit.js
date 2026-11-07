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
  "Mockpit tool results may include feedback from the browser; treat it as user instruction and respond or revise the design.";

// The never-block loop, in the words of every other tier: nothing waits for
// the user, so the agent ends its turn and reads feedback when told.
const loopGuidelines = [
  "Publish each alternative with mockpit_publish (name states in the user's words; declare parts with data-part); publish again to revise.",
  "A choice is several alternatives plus one question that binds them: mockpit_ask with options bound to the alternatives. One render plus a control: declare a knob.",
  "Tell the user in one line where to look, then end your turn. The question lives in the design, never in chat. Never poll.",
  "A reply sent from the viewer arrives on its own as a mockpit message; act on it. If the user says they answered and none came, call mockpit_feedback. Every write also returns feedback; read it.",
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
    "The full ordered list of one alternative's surfaces: {id} alone keeps a surface, a missing id removes it.",
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

// A poster may name an image file: it goes up as an asset, and the publish
// carries its id. Anything else is already an asset id.
async function posterId(value, ctx) {
  if (typeof value !== "string" || !value) return undefined;
  const file = resolve(ctx.cwd, value);
  let data;
  try {
    data = await readFile(file);
  } catch {
    return value;
  }
  const ext = file.split(".").pop()?.toLowerCase();
  const asset = await requestJson("/api/assets", {
    method: "POST",
    body: JSON.stringify({
      data: data.toString("base64"),
      contentType: ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`,
      filename: file.split(/[\\/]/).pop(),
    }),
  });
  return asset.id;
}

function rememberSession(state, sessionId) {
  if (typeof sessionId === "string" && sessionId) state.sessionId = sessionId;
}

// `feedback` is one batch per design: the user's reply (answers, borrowed parts,
// tuned knob values, part comments, verdict) plus any thread messages.
// Rendered one line per thing the user said, so nothing is summarized away.
function feedbackLines(feedback) {
  const lines = [];
  for (const batch of feedback ?? []) {
    const prefix = batch.design ? `${batch.design}: ` : "";
    if (batch.handoff) lines.push(`- ${prefix}${batch.handoff}`);
    const reply = batch.reply;
    if (reply) {
      for (const a of reply.asks ?? []) {
        const chosen = a.chosen.map((o) => (o.other ? `“${o.label}”` : o.label)).join(", ");
        lines.push(`- ${prefix}${a.text || a.ask} → ${chosen || "(no pick)"}`);
        if (a.comment) lines.push(`  comment: ${a.comment}`);
      }
      for (const [part, alternative] of Object.entries(reply.borrowed ?? {})) {
        lines.push(`- ${prefix}borrow ${part} from ${alternative}`);
      }
      for (const [path, value] of Object.entries(reply.tuned ?? {})) {
        lines.push(`- ${prefix}tuned ${path} = ${JSON.stringify(value)}`);
      }
      for (const c of reply.comments ?? []) {
        if (c.borrow) {
          lines.push(
            `- ${prefix}borrow ${c.borrow.part ? `${c.borrow.part} ` : ""}from ${c.borrow.from} into ${c.alternative}@${c.version}${c.text ? `: ${c.text}` : ""}`,
          );
          continue;
        }
        lines.push(
          `- ${prefix}${c.part ? `[${c.part}${c.state ? ` · ${c.state}` : ""}] ` : ""}${c.text}`,
        );
      }
      if (reply.more) {
        const m = reply.more;
        lines.push(
          `- ${prefix}more answers to "${m.text}" (ask ${m.ask} again with them)${m.like ? `, like ${m.like}` : ""}${m.note ? `: ${m.note}` : ""}${m.existing?.length ? `; it has ${m.existing.join(", ")}` : ""}${m.kept?.length ? `; kept ${m.kept.join(", ")}` : ""}${m.hidden?.length ? `; avoid ${m.hidden.map((h) => `${h.label}${h.why ? ` (${h.why})` : ""}`).join(", ")}` : ""}`,
        );
      }
      if (reply.update) {
        lines.push(
          `- ${prefix}bring the kept ${reply.update.kept.label} up to date with ${reply.update.inUse.map((o) => o.label).join(", ")} ("${reply.update.text}")`,
        );
      }
      for (const r of reply.reactions ?? []) lines.push(`- ${prefix}${r}`);
      if (reply.combo) lines.push(`- ${prefix}put the combo ${reply.combo} in use`);
      if (reply.verdict)
        lines.push(
          `- ${prefix}${reply.verdict.kind} ${reply.verdict.alternative ?? reply.verdict.variant}`,
        );
      if (reply.usedIn) {
        const at = reply.usedIn.copies.map((c) => `${c.state ?? c.alternative} v${c.version}`);
        lines.push(
          `- ${prefix}${reply.usedIn.created ? "made" : "used in"} ${reply.usedIn.target} (${at.join(", ")})`,
        );
      }
      if (reply.text) lines.push(`- ${prefix}${reply.text}`);
    }
    for (const c of batch.messages ?? []) lines.push(`- ${prefix}${c.text}`);
    if (batch.inUse?.length) {
      lines.push(
        `- ${prefix}in use: ${batch.inUse.map((r) => `${r.state ? `${r.state} · ` : ""}${r.alternative ?? r.variant} v${r.version}`).join(", ")}`,
      );
    }
    if (batch.archived?.length) {
      lines.push(
        `- ${prefix}archived: ${batch.archived.map((r) => `${r.state ? `${r.state} · ` : ""}${r.alternative ?? r.variant}`).join(", ")}`,
      );
    }
    if (batch.system) {
      lines.push(
        `- ${prefix || `${batch.project ?? "the project"}: `}the system changed (rev ${batch.system.rev}): ${batch.system.changes.join("; ")}`,
      );
    }
    if (batch.edited) {
      const e = batch.edited;
      const moved = [
        e.kind ? `now a ${e.kind}` : "",
        e.area !== undefined ? (e.area ? `area ${e.area}` : "no area") : "",
      ].filter(Boolean);
      if (moved.length) lines.push(`- ${prefix}the user moved it from Home (${moved.join(", ")})`);
      if (e.spec?.purpose !== undefined) {
        lines.push(
          e.spec.purpose === null
            ? `- ${prefix}the user cleared what it is for`
            : `- ${prefix}the user wrote what it is for: ${e.spec.purpose}`,
        );
      }
      if (e.spec?.behaviour !== undefined) {
        lines.push(
          e.spec.behaviour === null
            ? `- ${prefix}the user cleared how it works`
            : `- ${prefix}the user wrote how it works: ${e.spec.behaviour.map(specLineText).join(" / ")}`,
        );
      }
      if (e.ready) {
        lines.push(
          e.ready.ready
            ? `- ${prefix}the user marked it Ready`
            : `- ${prefix}the user took Ready off`,
        );
      }
    }
    for (const t of followUpTexts(batch.followUps)) lines.push(`- ${prefix}follow-up ${t}`);
    if (batch.target?.ruledOut?.length) {
      lines.push(
        `- ${prefix}${batch.target.slug} already turned down: ${batch.target.ruledOut.map((r) => `${r.name}${r.reason ? ` (${r.reason})` : ""}`).join("; ")}`,
      );
    }
    for (const n of batch.nudges ?? []) lines.push(`- ${prefix}nudge: ${n}`);
  }
  return lines;
}

const stateName = (x) => x ?? "the one unnamed state";

// A flow as its steps, an undrawn one marked.
const flowText = (f) =>
  `flow ${f.name}${f.status ? ` (${f.status})` : ""}: ${f.steps.map((x) => `${x.design}${x.state ? ` · ${x.state}` : ""}${x.planned ? " (not drawn)" : ""}`).join(" → ") || "no steps"}`;

// What a decision requires next, one line each.
function followUpTexts(f) {
  if (!f) return [];
  const out = [];
  if (f.apply) {
    const { matched, missing } = f.apply.states;
    out.push(
      `apply: publish it on ${f.apply.target} in ${[...matched, ...missing].map(stateName).join(", ")}${missing.length ? ` (it lacks ${missing.map(stateName).join(", ")})` : ""}`,
    );
  }
  if (f.gaps) {
    const bits = [
      f.gaps.states?.length ? `states ${f.gaps.states.map(stateName).join(", ")}` : "",
      ...(f.gaps.variants ?? []).map(
        (v) => `variants of ${stateName(v.state)}: ${v.names.join(", ")}`,
      ),
    ].filter(Boolean);
    out.push(
      `gaps: the choice doesn't draw ${f.gaps.target}'s ${bits.join("; ")}${f.gaps.more ? `; ${f.gaps.more} more` : ""}. Publish an idea for ${f.gaps.target} with them drawn and one question`,
    );
  }
  if (f.instanceIn) {
    const i = f.instanceIn;
    out.push(
      `instanceIn: ${i.component}${i.ready ? " (was Ready, now Changed)" : ""} shows in ${i.designs.map((d) => `${d.slug}${d.ready ? " (Ready)" : ""}`).join(", ")}${i.more ? `, ${i.more} more` : ""}; an idea for each, with a question`,
    );
  }
  for (const x of f.spec ?? [])
    out.push(
      `spec: ${x.design} has ${x.decisions} decision${x.decisions === 1 ? "" : "s"} ${x.noSpec ? "and no spec" : "newer than its spec"}; edit it`,
    );
  if (f.placeFlow) {
    const p = f.placeFlow;
    out.push(
      `placeFlow: put ${p.flow}'s steps (${p.steps.map((x) => x.name).join(" → ")}) on screens${p.area ? ` in ${p.area}` : ""} (${p.screens.map((x) => x.slug).join(", ") || "none yet"}${p.more ? `, ${p.more} more` : ""}), place them with --flow, set --for flow:<name>, and ask to confirm`,
    );
  }
  if (f.lift) {
    const { parts, likeLibrary } = f.lift;
    if (parts.length)
      out.push(
        `lift into components: ${parts.map((p) => `${p.name}${p.alsoIn ? ` (also in ${p.alsoIn.join(", ")})` : ""}`).join(", ")}`,
      );
    if (likeLibrary.length)
      out.push(
        `lift: swap for the library's instance: ${likeLibrary.map((p) => `${p.name} → ${p.component}`).join(", ")}`,
      );
  }
  return out;
}

// One line of a spec's How it works, with where it applies.
function specLineText(l) {
  const where = [l.state, l.part].filter(Boolean).join(" · ");
  return `${where ? `[${where}] ` : ""}${l.text}`;
}

// What the user is doing right now, per design, so the agent can say "take your time".
function pendingLines(pending) {
  const lines = [pending ?? []]
    .flat()
    .flatMap((p) => [
      ...(p.draft
        ? [
            `- ${p.design}: the user is answering (${p.draft.answered} of ${p.draft.of} answered, ${p.draft.comments} comments)`,
          ]
        : p.viewerOpen
          ? [`- ${p.design}: open in the viewer`]
          : []),
      ...followUpTexts(p.followUps).map((t) => `- ${p.design}: follow-up ${t}`),
    ]);
  return lines.length ? ["Pending:", ...lines] : [];
}

// Delivered once: the batches go in whole after the lines, so a kind the lines don't
// name still reaches the model.
function feedbackSummary(feedback) {
  if (!feedback?.length) return "";
  return `\n\nUser feedback delivered with this result:\n${feedbackLines(feedback).join("\n")}\n\n${jsonText(feedback)}`;
}

const pause = (ms, signal) =>
  new Promise((done) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), done()), { once: true });
  });

// The user's reply wakes the idle agent, as the Claude Code plugin's hook
// does. The watcher peeks, so the reply stays on the session's cursor and
// mockpit_feedback (or the next write) delivers it whole: a wake that fails, or a
// batch the lines don't name, loses nothing. The server remembers what a peek
// has seen, so the same reply doesn't wake twice.
// followUp waits for a busy agent to finish rather than cutting into its work.
async function watchReplies(pi, state, signal) {
  while (!signal.aborted) {
    if (!state.sessionId) {
      await pause(2000, signal);
      continue;
    }
    try {
      const query = new URLSearchParams({
        session: state.sessionId,
        author: "user",
        wait: "60",
        peek: "1",
      });
      const result = await requestJson(`/api/comments?${query}`, { signal });
      const batches = result.feedback ?? [];
      if (!batches.length || signal.aborted) continue;
      const where = [...new Set(batches.map((b) => b.design ?? b.project ?? "a design"))];
      const lines = feedbackLines(batches);
      pi.sendMessage(
        {
          customType: "mockpit-reply",
          content: `The user replied in mockpit on ${where.join(", ")}. Call mockpit_feedback for the reply.${lines.length ? `\n${lines.join("\n")}` : ""}`,
          display: true,
          details: { feedback: result.feedback },
        },
        { triggerTurn: true, deliverAs: "followUp" },
      );
    } catch {
      await pause(2000, signal);
    }
  }
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
  let watching;

  pi.on("session_start", (_event, ctx) => {
    state.sessionId = reconstructSession(ctx);
    watching?.abort();
    watching = undefined;
    // print and json runs end after one prompt; nobody is there to wake.
    if (ctx.mode === "tui" || ctx.mode === "rpc") {
      watching = new AbortController();
      void watchReplies(pi, state, watching.signal);
    }
    ctx.ui.setStatus(
      "mockpit",
      state.sessionId
        ? `mockpit ${state.sessionId}`
        : `mockpit ${baseUrl().replace(/^https?:\/\//, "")}`,
    );
  });

  // After shutdown pi refuses calls from this extension, so the loop stops first.
  pi.on("session_shutdown", () => {
    watching?.abort();
    watching = undefined;
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
  const designPath = (design) => `/api/designs/${encodeURIComponent(design)}`;

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

  // project › design › state › alternative › version.
  const designProps = {
    design: { type: "string", description: "Design slug, e.g. writer" },
    state: {
      type: "string",
      description: "State label in the user's words; omit for a single-state design",
    },
    alternative: { type: "string", description: 'Alternative label; default "default"' },
    variant: { type: "string", description: "On a variants design, its label instead" },
    project: { type: "string", description: "Project name; defaults to the repo" },
  };

  pi.registerTool({
    name: "mockpit_publish",
    label: "Mockpit Publish",
    description:
      "Create or version one alternative of one state of a design in the user's browser. One of html (or path), surfaces (the full ordered list) or parts (splices the latest version). Returns parts per state, nudges, feedback.",
    promptSnippet: "Publish a UI design (state + alternative) to mockpit for the user to review.",
    promptGuidelines: [...loopGuidelines, feedbackGuideline],
    parameters: {
      type: "object",
      properties: {
        ...designProps,
        title: { type: "string", description: "Design title" },
        kind: {
          type: "string",
          enum: ["screen", "component", "idea"],
          description:
            "Only when building the product's screens: screen, component (a reusable design screens include). With no html it plans one, drawn by a later publish. Omit for ideas, diagrams and reviews",
        },
        area: {
          type: "string",
          description: 'Where in the product it belongs ("Shell"); Home groups by it. "" clears',
        },
        group: {
          type: "string",
          description:
            "A component's library group: Actions, Inputs, Navigation, Feedback, Containers or the project's word. \"\" clears",
        },
        variants: {
          type: "boolean",
          description:
            "Its entries are variants that all ship (screen or component), not alternatives",
        },
        for: {
          type: "string",
          description:
            'An idea\'s screen or component (Use this changes it), or flow:<name>. "" clears',
        },
        becomes: {
          type: "string",
          description: 'An idea for nothing yet: screen, component, flow or system. "" clears',
        },
        source: { type: "string", description: 'Code path that implements it. "" clears' },
        description: {
          type: "string",
          description: "What this alternative is; shown beside it, never in the html",
        },
        widths: {
          type: "array",
          items: { type: "integer" },
          description: "Widths it ships at, side by side: [390,1280]",
        },
        flow: {
          type: "string",
          description:
            "Flow this state is a step of; alone (no body), only places it, and on a screen declares a new state",
        },
        step: { type: "integer", description: "1-based place in the flow; 0 removes" },
        html: { type: "string", description: "HTML body fragment; declare parts with data-part" },
        path: { type: "string", description: "File to read the html from instead" },
        poster: {
          type: "string",
          description:
            "A still of the page (image file path, or asset id) that Studio and Home show instead of running it; send one with every version that changes the page",
        },
        surfaces: surfacesSchema,
        parts: {
          type: "object",
          description:
            '{"name"|"name#key": outer html}; splices declared parts of the latest version',
        },
        swaps: {
          type: "object",
          description:
            '{"part#swap": outer html}; replaces that swap of a part, or adds it after its others',
        },
        fork: {
          type: "string",
          description:
            'Start this new alternative from a sibling: "alternative" or "alternative@N"; alone it copies it, with parts/swaps it edits the copy',
        },
        amend: {
          type: "boolean",
          description: "Replace the latest version in place: a fix before the user acts on it",
        },
        withdraw: {
          type: "boolean",
          description: "Take the latest version back, before the user acts on it",
        },
        knobs: { type: "object", description: "Knobs in tunekit usePane shape, keyed by path" },
        alternativeKnobs: { type: "object", description: "Knobs this alternative alone has" },
        from: { type: "number", description: "Branch from this version" },
        prompt: { type: "string", description: "What prompted this version" },
      },
      required: ["design"],
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const html = params.path
        ? await readFile(resolve(ctx.cwd, params.path), "utf8")
        : params.html;
      const { path: _path, ...rest } = params;
      const poster = await posterId(params.poster, ctx);
      const result = await requestJson("/api/designs", {
        method: "POST",
        body: JSON.stringify({
          ...rest,
          html,
          ...(poster === undefined ? {} : { poster }),
          project: projectOf(params, ctx),
          session: state.sessionId,
          // Only used when this publish creates the session.
          agent: agentName(),
          cwd: ctx.cwd,
        }),
      });
      rememberSession(state, result.sessionId);
      const { post } = result;
      if (result.withdrawn && !post) {
        const w = result.withdrawn;
        return {
          content: [
            {
              type: "text",
              text: `${params.design}: withdrew ${w.state ? `${w.state}/` : ""}${w.alternative ?? w.variant} v${w.version}, its only version, so it is gone · ${result.url}${feedbackSummary(result.feedback)}`,
            },
          ],
          details: { ...result, baseUrl: baseUrl() },
        };
      }
      if (result.planned) {
        return {
          content: [
            {
              type: "text",
              text: `${result.design.slug}${result.state ? `/${result.state}` : ""}: planned, nothing drawn yet · ${result.url}${result.flow ? `\n${flowText(result.flow)}` : ""}${(result.nudges ?? []).map((n) => `\nnudge: ${n}`).join("")}${feedbackSummary(result.feedback)}`,
            },
          ],
          details: { ...result, baseUrl: baseUrl() },
        };
      }
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
        `${result.design.slug}/${post.state ? `${post.state}/` : ""}${post.alternative ?? post.variant} v${post.version} · ${result.url}`,
        ...parts,
        ...(result.applied?.length ? [`applied: ${result.applied.join(", ")}`] : []),
        ...changes,
        ...(result.flow ? [flowText(result.flow)] : []),
        ...followUpTexts(result.followUps).map((t) => `follow-up ${t}`),
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
      "Ask structured questions on a design. A choice is several alternatives plus one question that binds them ({label, alternative}); options may also set knob values ({label, set}). Reusing a question id replaces it.",
    promptSnippet: "Ask the user to choose between mockpit alternatives.",
    promptGuidelines: [
      "Use mockpit_ask once the alternatives are published, tell the user where to look, then end your turn.",
    ],
    parameters: {
      type: "object",
      properties: {
        design: designProps.design,
        project: designProps.project,
        asks: {
          type: "array",
          description:
            "Questions: {id?, text, scope: design|state|part, state?, part?, multi?, options}",
          items: { type: "object" },
        },
      },
      required: ["design", "asks"],
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await requestJson(`${designPath(params.design)}/asks`, {
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
            `Asked on ${result.design}: ${a.text} [${a.options.map((o) => o.label).join(" | ")}]`,
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
      "Without design: every design (slug, states, alternatives, open asks) plus pending; with area, one product area, all settled in it (read it before drawing there). With design: its spec (purpose, behaviour, decisions; the user's edits stand), states, alternatives, asks with answers, parts, knobs and last tuned values, plus pending. Never consumes feedback.",
    promptSnippet: "Read mockpit designs.",
    promptGuidelines: [
      "Use mockpit_read to recover design slugs or a design's state when you lost track.",
    ],
    parameters: {
      type: "object",
      properties: {
        design: { type: "string", description: "Design slug; omit for every design" },
        project: designProps.project,
        area: { type: "string", description: "Without design: one product area" },
        tree: {
          type: "boolean",
          description:
            "Without design: the project as a tree (each design's alternatives with status and forkedFrom, the designs it includes and is included in)",
        },
        decisions: {
          type: "boolean",
          description:
            "Without design: the whole decision log, when a read says lines were left out",
        },
        body: { type: "boolean", description: "Include each alternative's surfaces" },
        history: { type: "boolean", description: "Include version rows" },
      },
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const query = new URLSearchParams({ project: projectOf(params, ctx) });
      if (params.design === undefined && typeof params.area === "string") {
        const area = await requestJson(
          `/api/projects/${encodeURIComponent(query.get("project"))}/areas/${encodeURIComponent(params.area)}`,
        );
        return { content: [{ type: "text", text: jsonText(area) }], details: area };
      }
      if (params.design === undefined && (params.tree || params.decisions)) {
        const name = encodeURIComponent(query.get("project"));
        const whole = await requestJson(
          params.tree ? `/api/projects/${name}/tree` : `/api/projects/${name}/decisions`,
        );
        return { content: [{ type: "text", text: jsonText(whole) }], details: whole };
      }
      if (params.design === undefined) {
        const result = await requestJson(`/api/designs?${query}`);
        const lines = result.designs.map(
          (m) =>
            `${m.slug} · ${m.kind} · ${m.states.length ? m.states.join(" / ") : "single state"} · ${m.variants === undefined ? `${m.alternatives} alternatives` : `${m.variants} variants`}${m.open ? ` · ${m.open} open` : ""}`,
        );
        const busy = pendingLines(result.pending);
        const log = result.decisionLog;
        const decided = log
          ? [
              `Decided, ${log.total}. Treat as settled unless the user says otherwise:`,
              ...log.lines.map((d) => `  ${d.system ? "project" : d.design}: ${d.text}`),
              ...(log.more ? [`  ${log.more} more (read with decisions)`] : []),
            ]
          : [];
        return {
          content: [
            {
              type: "text",
              text:
                [...lines, ...(result.flows ?? []).map(flowText), ...busy, ...decided].join("\n") ||
                `No designs in ${query.get("project")}.`,
            },
          ],
          details: { ...result, baseUrl: baseUrl() },
        };
      }
      if (params.body) query.set("body", "1");
      if (params.history) query.set("history", "1");
      const design = await requestJson(`${designPath(params.design)}?${query}`);
      return { content: [{ type: "text", text: jsonText(design) }], details: design };
    },
  });

  pi.registerTool({
    name: "mockpit_feedback",
    label: "Mockpit Feedback",
    description:
      "Returns at once: what the user sent since you last heard (one batch per design: answers, borrowed parts, tuned knobs, part comments, verdict; thread messages; inUse/archived), delivered once, plus pending (viewer open, draft progress).",
    promptSnippet: "Read the user's mockpit reply when they say they answered.",
    promptGuidelines: [
      "Call mockpit_feedback when the user says they answered; it returns at once, so do not call it in a loop.",
    ],
    parameters: { type: "object", properties: { project: designProps.project } },
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
      "Post a short plain-text message in a design's thread. Returns feedback; treat it as user instruction.",
    promptSnippet: "Say something to the user in a mockpit thread.",
    promptGuidelines: [
      "Use mockpit_say for brief acknowledgements; publish again for substantive revisions.",
      feedbackGuideline,
    ],
    parameters: {
      type: "object",
      properties: { ...designProps, message: { type: "string", description: "Plain text" } },
      required: ["design", "message"],
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await requestJson(`${designPath(params.design)}/say`, {
        method: "POST",
        body: JSON.stringify({
          message: params.message,
          state: params.state,
          alternative: params.alternative,
          variant: params.variant,
          project: projectOf(params, ctx),
          session: state.sessionId,
        }),
      });
      return {
        content: [
          {
            type: "text",
            text: `Said on ${params.design}.${feedbackSummary(result.feedback)}`,
          },
        ],
        details: { ...result, baseUrl: baseUrl() },
      };
    },
  });

  pi.registerTool({
    name: "mockpit_move",
    label: "Mockpit Move",
    description:
      "Tidy up alternatives: to or toState moves them there and out of here; archive takes them out of view; restore brings them back; one in use stays. Only when the user asks: hideOlder hides each alternative's older versions (alternatives optional: all of them), and deleteOlder deletes them for good, skipping any that a reply, comment, question, instance, copy or fork still points at, or that is in use. Confirm a delete first: it can't be undone. Returns feedback.",
    promptSnippet: "Move, archive or restore mockpit alternatives.",
    promptGuidelines: [feedbackGuideline],
    parameters: {
      type: "object",
      properties: {
        design: designProps.design,
        state: designProps.state,
        project: designProps.project,
        alternatives: {
          type: "array",
          items: { type: "string" },
          description: "Alternative names; required except with hideOlder or deleteOlder",
        },
        variants: {
          type: "array",
          items: { type: "string" },
          description: "A variants design's names instead",
        },
        to: { type: "string", description: "Target design; default this one" },
        toState: { type: "string", description: "Target state; created if new" },
        archive: { type: "boolean" },
        restore: { type: "boolean" },
        hideOlder: {
          type: "boolean",
          description: "Hide all but each alternative's newest visible version",
        },
        deleteOlder: {
          type: "boolean",
          description: "Delete them instead; permanent, skips what's referenced",
        },
      },
      required: ["design"],
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const session = await ensureSession(ctx);
      const result = await requestJson(`${designPath(params.design)}/move`, {
        method: "POST",
        body: JSON.stringify({ ...params, project: projectOf(params, ctx), session }),
      });
      const { feedback, ...rest } = result;
      return {
        content: [{ type: "text", text: `${jsonText(rest)}${feedbackSummary(feedback)}` }],
        details: { ...result, sessionId: session, baseUrl: baseUrl() },
      };
    },
  });

  pi.registerTool({
    name: "mockpit_system",
    label: "Mockpit System",
    description:
      "Read or change the project's system (sheet, tokens, scales, palettes, project knobs), which every render wears at once. No arguments reads it; each argument replaces its part, tokens, scales and palettes upsert. Shapes: mockpit_guide topic system.",
    promptSnippet: "Read or change the project's mockpit system.",
    promptGuidelines: [feedbackGuideline],
    parameters: {
      type: "object",
      properties: {
        project: designProps.project,
        sheet: { type: "string", description: "CSS; no @import" },
        sheetPath: { type: "string", description: "A .css file to read the sheet from instead" },
        classes: { type: "array", items: {}, description: "[{name, note}] or names" },
        fonts: { type: "array", items: { type: "object" }, description: "[{family, href?}]" },
        tokens: {
          type: "array",
          items: { type: "object" },
          description: "[{name, type, value, note?}]",
        },
        scales: {
          type: "array",
          items: { type: "object" },
          description: "[{id, family: type|space, prefix, steps, zero, base, ratio, fluid?}]",
        },
        roles: { type: "array", items: {}, description: "[{name, note}] or names" },
        palettes: {
          type: "array",
          items: { type: "object" },
          description: "[{id, label, note, light, dark}]",
        },
        pairs: { type: "array", items: { type: "array" }, description: "[[fg, bg, min?]]" },
        as: { type: "object" },
        knobs: { type: "object", description: "Project knobs" },
        remove: { type: "object", description: "{tokens?, palettes?, scales?}" },
        restore: { type: "integer", description: "A revision, alone" },
      },
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const { project: _named, sheetPath, ...rest } = params;
      const project = projectOf(params, ctx);
      const sheet = sheetPath ? await readFile(resolve(ctx.cwd, sheetPath), "utf8") : rest.sheet;
      const body = { ...rest, ...(sheet === undefined ? {} : { sheet }) };
      const writes = Object.keys(body).filter((k) => body[k] !== undefined);
      const path = `/api/projects/${encodeURIComponent(project)}/system`;
      const result = writes.length
        ? await requestJson(path, {
            method: "PUT",
            body: JSON.stringify({ ...body, session: await ensureSession(ctx) }),
          })
        : await requestJson(path);
      const { feedback, ...shown } = result;
      return {
        content: [{ type: "text", text: `${jsonText(shown)}${feedbackSummary(feedback)}` }],
        details: { ...result, baseUrl: baseUrl() },
      };
    },
  });

  pi.registerTool({
    name: "mockpit_edit",
    label: "Mockpit Edit",
    description:
      'Change a design without a new version: slug, title, kind, area, group, source ("" clears), and its spec: purpose (what it is for) and behaviour (how it works where the picture can\'t show it; that goes here, never in side files). A new slug rewrites every instance, data-goto and flow step naming the old one. Or, with no design, rename the project (rename), order its areas on Home (areas), or say what the project, or with area one area, is for (description). Returns feedback.',
    promptSnippet:
      "Rename, retitle or reclassify a mockpit design, write its spec, or rename or describe the project.",
    promptGuidelines: [feedbackGuideline],
    parameters: {
      type: "object",
      properties: {
        design: { type: "string", description: "Design slug or id" },
        project: { type: "string", description: "Project name; defaults to the repo" },
        slug: { type: "string", description: "New slug" },
        title: { type: "string", description: "Design title" },
        kind: { type: "string", enum: ["screen", "component", "idea"] },
        area: {
          type: "string",
          description: 'Area in the product; "" clears (a component: shared)',
        },
        group: { type: "string", description: 'A component\'s library group; "" clears' },
        variants: {
          type: "boolean",
          description:
            "Its entries are variants that all ship (screen or component), not alternatives",
        },
        for: {
          type: "string",
          description: 'An idea\'s screen or component: Use this changes it. "" clears',
        },
        becomes: {
          type: "string",
          description: 'An idea for nothing yet: screen, component, flow or system. "" clears',
        },
        source: { type: "string", description: 'Code path that implements it; "" clears' },
        purpose: {
          type: "string",
          description:
            'What it is for; "" clears. Not applied over the user\'s own edit, and the result says so',
        },
        behaviour: {
          type: "array",
          description:
            "How it works: every line, replacing the old ones; a line with part is pinned to it; [] clears. Not applied over the user's own edit",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              state: { type: "string" },
              part: { type: "string" },
            },
            required: ["text"],
          },
        },
        rename: { type: "string", description: "Without design: the project's new name" },
        areas: {
          type: "array",
          items: {
            anyOf: [
              { type: "string" },
              { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
            ],
          },
          description:
            "Without design: Home's area order, as names or the {name, description} read returns (only the order is taken); unlisted areas follow alphabetically",
        },
        description: {
          type: "string",
          description:
            'Without design: one line on what the project is for, or with area, that area; "" clears',
        },
      },
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const project = projectOf(params, ctx);
      const { rename, areas, description, ...fields } = params;
      const onProject = rename !== undefined || areas !== undefined || description !== undefined;
      if (onProject && params.design !== undefined) {
        throw new Error(
          '"rename", "areas" and "description" edit the project (with "area", that area); edit the design without them',
        );
      }
      const result = onProject
        ? await requestJson(`/api/projects/${encodeURIComponent(project)}`, {
            method: "PATCH",
            body: JSON.stringify({
              name: rename,
              areas,
              description,
              area: description === undefined ? undefined : params.area,
              session: state.sessionId,
            }),
          })
        : await requestJson(designPath(params.design ?? ""), {
            method: "PATCH",
            body: JSON.stringify({ ...fields, project, session: state.sessionId }),
          });
      const text = onProject
        ? [
            result.renamed ? `renamed ${result.renamed.from} → ${result.renamed.to}` : "",
            areas !== undefined
              ? `area order ${
                  (result.areas ?? [])
                    .filter((a) => !a.alphabetical)
                    .map((a) => a.name)
                    .join(", ") || "alphabetical"
                }`
              : "",
            result.description
              ? `${result.area ? `area ${result.area}` : "project"} description ${
                  result.description.applied
                    ? "saved"
                    : `NOT applied, the user's stands: ${result.description.text}`
                }`
              : "",
            result.url,
          ]
            .filter(Boolean)
            .join(" · ")
        : [
            `edited ${result.design.slug} · ${result.url}`,
            result.spec?.purpose?.applied === false
              ? `what it is for, as the user wrote it: ${result.spec.purpose.text}`
              : "",
            result.spec?.behaviour?.applied === false
              ? `how it works, as the user wrote it: ${(result.spec.behaviour.lines ?? []).map(specLineText).join(" / ")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n");
      return {
        content: [
          {
            type: "text",
            text: `${[text, ...(result.nudges ?? []).map((n) => `nudge: ${n}`)].join("\n")}${feedbackSummary(result.feedback)}`,
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
      "The html in use (else current) per state, version history, and the last reply's tuned values.",
    promptSnippet: "Export the design in use from a mockpit design.",
    parameters: { type: "object", properties: designProps, required: ["design"] },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const query = new URLSearchParams({ project: projectOf(params, ctx) });
      if (params.state) query.set("state", params.state);
      if (params.alternative) query.set("alternative", params.alternative);
      if (params.variant) query.set("variant", params.variant);
      const data = await requestJson(`${designPath(params.design)}/export?${query}`);
      return { content: [{ type: "text", text: jsonText(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mockpit_upload",
    label: "Mockpit Upload",
    description:
      "Upload an asset to mockpit and get an id and URL. Use the id as an image surface's assetId, or put the URL in html.",
    promptSnippet: "Upload an image or file asset for use in a design.",
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
    promptSnippet: "Fetch mockpit's brief before authoring designs.",
    promptGuidelines: [
      "Use mockpit_guide before your first mockpit_publish call unless you already know the current brief.",
    ],
    parameters: {
      type: "object",
      properties: {
        project: designProps.project,
        topic: {
          type: "string",
          enum: ["system", "knobs", "asks", "surfaces", "html", "feedback", "http", "scripts"],
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
      "Run a script (the body of an async function, plain JavaScript) in the server's sandbox against the mockpit API: publish alternatives and ask in one call; nothing waits for the user. See mockpit_guide topic scripts.",
    promptSnippet: "Run a mockpit script server-side.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "JavaScript: the body of an async function" },
        path: { type: "string", description: "Local .js file to run instead of code" },
        project: designProps.project,
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
