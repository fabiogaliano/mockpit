import * as z from "zod/v4";
import { encodeBase64 } from "./base64.ts";
import { GUIDE_TOPICS } from "./designGuide.ts";
import { type FeedbackBatch, feedbackImages, type ImageRef } from "./feedbackBatch.ts";
import { KIT_IDS } from "./kits.ts";
import { RUN_DESCRIPTION } from "./runApi.ts";
import { MAX_SPEC, SURFACE_KINDS, type SurfaceKind } from "./types.ts";

export const MCP_SERVER_INFO = { name: "mockpit", version: "0.2.0" };

// Without a design, `edit` edits the project: these name it, its areas' order, and
// what it (or, with `area`, one area) is for. Both transports route on it.
export const editsProject = (args: any) =>
  args.rename !== undefined || args.areas !== undefined || args.description !== undefined;

// The `kind` enum both MCP transports advertise — derived from the one canonical
// list (types.ts) so the MCP tier can never fall behind what REST/CLI accept.
const SURFACE_KIND_ENUM = [...SURFACE_KINDS] as [SurfaceKind, ...SurfaceKind[]];

export const MCP_INSTRUCTIONS =
  "Mockpit shows design work to the user: project > design > state > alternative > version. publish " +
  "each alternative (name states in the user's words; declare parts with data-part); publish again to " +
  "revise. A choice is several alternatives plus one question that binds them (ask). One render plus a " +
  "control: declare a knob. Say where to look, then end your turn; nothing waits. When the " +
  "user says they answered, call feedback. Writes return feedback too; it is delivered once. " +
  "Fetch guide before html.";

const field = {
  design: "Design slug, title or id",
  state: "State label; omit if single-state",
  alternative: 'Alternative label; default "default"',
  variant: "On a variants design, its label instead",
  variants: "Its entries are variants that all ship (screen or component), not alternatives",
  project: "Default: the session's project",
  title: "Design title",
  session: "Session id from an earlier publish",
  sessionTitle: "Task name; used only when creating the session",
  agent: "Agent name for a new session",
  html: "HTML body fragment",
  knobs:
    'Global knobs (tunekit usePane shape) keyed by path: [default,min,max,step], boolean, {type:"select",options}, "#hex"',
  alternativeKnobs: "Knobs this alternative alone has",
  from: "Branch from this version",
  amend: "Replace the latest version in place: a fix before the user acts on it",
  withdraw: "Take the latest version back, before the user acts on it",
  fork: 'Start this new alternative from a sibling: "alternative" or "alternative@N"; alone it copies it, with parts/swaps it edits the copy',
  prompt: "What prompted this version; usually omit",
  description: "What this alternative is; shown beside it, never in the html",
  widths: "Widths it ships at, side by side: [390,1280]",
  kind: "Only when building the product's screens: screen, component (a reusable design screens include). With no html it plans one, drawn by a later publish. Omit for ideas, diagrams and reviews",
  area: 'Product area in the project\'s words; Home groups by it. "" clears',
  group:
    'A component\'s library group: Actions, Inputs, Navigation, Feedback, Containers or your word. "" clears',
  source: 'Code path implementing it. "" clears',
  for: "An idea's screen or component (Use this changes it), or flow:<name>",
  becomes: "An idea for nothing yet: screen, component, flow or system",
  flow: "Flow this state is a step of; alone, only places it",
  step: "1-based place; 0 removes",
  kits: `Opt-in bundles: ${KIT_IDS.join("|")}`,
  poster: "Still of the page (asset id) shown instead of running it; resend when the page changes",
} as const;

const diffFileSchema = z.object({
  filename: z.string(),
  before: z.string(),
  after: z.string(),
  language: z.string().optional(),
});

// Named so each tool carries it once under $defs and codemode harnesses
// generate one `Surface` type instead of four anonymous copies.
export const mcpSurfaceSchema = z
  .object({
    id: z
      .string()
      .optional()
      .describe("Existing surface id: alone keeps it, with kind replaces it"),
    kind: z.enum(SURFACE_KIND_ENUM).optional(),
    html: z.string().optional().describe(field.html),
    kits: z.array(z.string()).optional().describe(field.kits),
    poster: z.string().optional().describe(field.poster),
    markdown: z.string().optional().describe("Prose; raw HTML is escaped"),
    mermaid: z.string().optional().describe("Diagram source; do not set colors"),
    patch: z.string().optional().describe("Preferred over files"),
    files: z.array(diffFileSchema).optional(),
    layout: z.enum(["unified", "split"]).optional(),
    assetId: z.string().optional().describe("Id from upload"),
    alt: z.string().optional(),
    caption: z.string().optional(),
    title: z.string().optional(),
    text: z.string().optional().describe("ANSI styles render"),
    cols: z.number().optional(),
    data: z.unknown().optional(),
    code: z.string().optional(),
    language: z.string().optional(),
    lineStart: z.number().int().min(1).optional().describe("1-based first line"),
  })
  .meta({
    id: "Surface",
    description:
      "Set kind and its field: html, markdown, mermaid, patch|files (diff), assetId (image), text (terminal), data (json), code",
  });

const askSchema = z.object({
  id: z.string().optional().describe("Stable id; reusing one replaces that question"),
  text: z.string().describe("The question, one sentence"),
  scope: z.enum(["design", "state", "part"]).optional(),
  state: z.string().optional(),
  states: z
    .array(z.string())
    .optional()
    .describe("Design-wide question: the states its answers can be seen on, best first"),
  part: z.string().optional().describe("data-part name, for scope part"),
  multi: z.boolean().optional(),
  after: z
    .string()
    .optional()
    .describe("Id of an earlier ask this depends on; it opens once that one is answered"),
  options: z.array(
    z.object({
      id: z.string().optional(),
      label: z.string(),
      alternative: z.string().optional().describe("Bind to a published alternative"),
      version: z.number().int().optional().describe("And one version of it"),
      set: z.record(z.string(), z.unknown()).optional().describe("Or to knob values {path: value}"),
      style: z.string().optional().describe("With a set of a new value: its CSS"),
      swap: z.string().optional().describe("With a set of {part: new swap}: its html"),
      palette: z
        .string()
        .optional()
        .describe("Or a palette id of the project's system; the answer makes it the default"),
      html: z.string().optional().describe("Or a whole page"),
      recommended: z.boolean().optional().describe("The one you would pick; one per ask"),
    }),
  ),
});

const specLineSchema = z.object({
  text: z.string(),
  state: z.string().optional(),
  part: z.string().optional().describe("Pins the line to it"),
});

// One parameter vocabulary generates both transports' schemas, so the HTTP
// JSON Schema and the stdio zod shape cannot drift apart.
type Param =
  | { t: "string" | "number" | "boolean" | "integer"; d?: string; req?: boolean }
  | { t: "enum"; values: readonly [string, ...string[]]; d?: string; req?: boolean }
  | {
      t:
        | "surfaces"
        | "asks"
        | "object"
        | "objects"
        | "named"
        | "pairs"
        | "json"
        | "integers"
        | "strings"
        | "specLines";
      d?: string;
      req?: boolean;
    };

function zodParam(p: Param): z.ZodType {
  let s: z.ZodType;
  switch (p.t) {
    case "enum":
      s = z.enum(p.values as [string, ...string[]]);
      break;
    case "surfaces":
      s = z.array(mcpSurfaceSchema);
      break;
    case "asks":
      s = z.array(askSchema);
      break;
    case "specLines":
      s = z.array(specLineSchema);
      break;
    case "object":
      s = z.record(z.string(), z.unknown());
      break;
    case "objects":
      s = z.array(z.record(z.string(), z.unknown()));
      break;
    // A list of objects where a bare name stands for {name}.
    case "named":
      s = z.array(z.union([z.string(), z.record(z.string(), z.unknown())]));
      break;
    // [foreground, background, minimum?]
    case "pairs":
      s = z.array(
        z
          .array(z.union([z.string(), z.number()]))
          .min(2)
          .max(3),
      );
      break;
    case "json":
      s = z.unknown();
      break;
    case "integer":
      s = z.number().int();
      break;
    case "integers":
      s = z.array(z.number().int());
      break;
    case "strings":
      s = z.array(z.string());
      break;
    default:
      s = p.t === "string" ? z.string() : p.t === "number" ? z.number() : z.boolean();
  }
  if (p.d) s = s.describe(p.d);
  return p.req ? s : s.optional();
}

const P = {
  design: { t: "string", d: field.design, req: true },
  state: { t: "string", d: field.state },
  alternative: { t: "string", d: field.alternative },
  variant: { t: "string", d: field.variant },
  project: { t: "string", d: field.project },
  session: { t: "string", d: field.session },
} as const satisfies Record<string, Param>;

const ALTERNATIVE_REF = {
  design: P.design,
  state: P.state,
  alternative: P.alternative,
  variant: P.variant,
  project: P.project,
};

interface ToolDef {
  name: string;
  description: string;
  params: Record<string, Param>;
  // Over stdio the server owns the session and runs on the agent's machine:
  // these params are dropped there, and `stdioExtra` adds file-path inputs.
  httpOnly?: readonly string[];
  stdioExtra?: Record<string, Param>;
}

export const MCP_TOOL_DEFS: ToolDef[] = [
  {
    name: "publish",
    description:
      "Create or version one alternative of one state of a design. One of html, surfaces (the full ordered list), parts or swaps (splice the latest version); or kind screen or component and none of them, to plan it. Returns parts per state, nudges, feedback.",
    params: {
      ...ALTERNATIVE_REF,
      title: { t: "string", d: field.title },
      kind: { t: "enum", values: ["screen", "component", "idea"], d: field.kind },
      area: { t: "string", d: field.area },
      group: { t: "string", d: field.group },
      variants: { t: "boolean", d: field.variants },
      for: { t: "string", d: field.for },
      becomes: { t: "string", d: field.becomes },
      source: { t: "string", d: field.source },
      html: { t: "string", d: field.html },
      poster: { t: "string", d: field.poster },
      surfaces: {
        t: "surfaces",
        d: "Full ordered list: {id} keeps a surface, a missing id removes it",
      },
      parts: { t: "object", d: '{"name"|"name#key": outer html}; splices declared parts' },
      swaps: {
        t: "object",
        d: '{"part#swap": outer html}; replaces that swap of a part, or adds it after its others',
      },
      knobs: { t: "object", d: field.knobs },
      alternativeKnobs: { t: "object", d: field.alternativeKnobs },
      from: { t: "integer", d: field.from },
      fork: { t: "string", d: field.fork },
      amend: { t: "boolean", d: field.amend },
      withdraw: { t: "boolean", d: field.withdraw },
      prompt: { t: "string", d: field.prompt },
      description: { t: "string", d: field.description },
      widths: { t: "integers", d: field.widths },
      flow: { t: "string", d: field.flow },
      step: { t: "integer", d: field.step },
      session: P.session,
      sessionTitle: { t: "string", d: field.sessionTitle },
      agent: { t: "string", d: field.agent },
    },
    httpOnly: ["session", "agent"],
  },
  {
    name: "ask",
    description:
      "Ask structured questions on a design. A choice is several alternatives plus one question that binds them; options may also set knob values. Reusing a question id replaces it.",
    params: {
      design: P.design,
      project: P.project,
      asks: { t: "asks", d: "Questions with options", req: true },
      session: P.session,
    },
    httpOnly: ["session"],
  },
  {
    name: "read",
    description:
      "Read this first. Every form carries decisionLog: what the user already settled in this project; it stands unless they say otherwise. Without design: every design (slug, states, alternatives, open questions), flows, plus pending. With area: all settled in it; read it before drawing there. With design: its spec (purpose, behaviour, decisions; the user's edits stand), states, alternatives, questions with answers, parts, knobs and settled values (every answer's set and tuning sent so far), plus pending. Never consumes feedback.",
    params: {
      design: { t: "string", d: field.design },
      project: P.project,
      body: { t: "boolean", d: "Include each alternative's surfaces" },
      history: { t: "boolean", d: "Include version rows" },
      tree: {
        t: "boolean",
        d: "Without design: the project as a tree (each design's alternatives with status and forkedFrom, the designs it includes and is included in)",
      },
      area: { t: "string", d: "Without design: one product area" },
      decisions: {
        t: "boolean",
        d: "Only the whole decision log, when decisionLog says it was cut",
      },
      session: P.session,
    },
    httpOnly: ["session"],
  },
  {
    name: "feedback",
    description:
      "Returns at once: what the user sent since you last heard (one batch per design: reply answers, borrowed parts, tuned knobs, part comments, verdict; thread messages; inUse/archived), delivered once, plus pending (viewer open, draft progress).",
    params: {
      project: P.project,
      session: { t: "string", d: "Session id returned by publish", req: true },
    },
    httpOnly: ["session"],
  },
  {
    name: "say",
    description: "Post a short plain-text message in a design's thread. Returns feedback.",
    params: {
      ...ALTERNATIVE_REF,
      message: { t: "string", d: "Plain text", req: true },
      session: P.session,
    },
    httpOnly: ["session"],
  },
  {
    name: "move",
    description:
      "Tidy up alternatives: to or toState moves them there and out of here; archive takes them out of view; restore brings them back; a group goes along; one in use stays. Only when the user asks: hideOlder hides each alternative's older versions (alternatives optional: all of them), and deleteOlder deletes them for good, skipping any that a reply, comment, question, instance, copy or fork still points at, or that is in use. Confirm a delete first: it can't be undone. Returns feedback.",
    params: {
      design: P.design,
      state: P.state,
      alternatives: {
        t: "strings",
        d: "Alternative names; required except with hideOlder or deleteOlder",
      },
      variants: { t: "strings", d: "A variants design's names instead" },
      to: { t: "string", d: "Target design; default this one" },
      toState: { t: "string", d: "Target state; created if new" },
      archive: { t: "boolean" },
      restore: { t: "boolean" },
      hideOlder: { t: "boolean", d: "Hide all but each alternative's newest visible version" },
      deleteOlder: { t: "boolean", d: "Delete them instead; permanent, skips what's referenced" },
      project: P.project,
      session: P.session,
    },
    httpOnly: ["session"],
  },
  {
    name: "export",
    description:
      "The html in use (else current; a screen or component's every entry marked Ready) per state, version history, screenshot URL, knobs, the settled values and the last reply; a screen or component adds ready, its spec and builtFrom. Without design: the project's system for code (sheet, tokens as CSS and JSON, settled project knobs, components' sources).",
    params: { ...ALTERNATIVE_REF, design: { t: "string", d: field.design }, session: P.session },
    httpOnly: ["session"],
  },
  {
    name: "edit",
    description:
      "Change a design without a new version; a new slug rewrites every reference to the old one. purpose and behaviour write its spec; what the picture can't show goes there, not in side files. Without design: rename, areas (their order), description (the project's, or with area that area's). Returns feedback.",
    params: {
      design: { t: "string", d: field.design },
      project: P.project,
      slug: { t: "string" },
      title: { t: "string" },
      kind: { t: "enum", values: ["screen", "component", "idea"] },
      area: { t: "string" },
      group: { t: "string" },
      variants: { t: "boolean", d: field.variants },
      for: { t: "string" },
      becomes: { t: "string" },
      source: { t: "string" },
      firstState: { t: "string", d: "Names a design's one unnamed state, so it can have more" },
      purpose: {
        t: "string",
        d: `What it is for; with behaviour at most ${MAX_SPEC} chars. Not applied over the user's own edit`,
      },
      behaviour: { t: "specLines", d: "How it works: every line, replacing the old" },
      rename: { t: "string", d: "New project name" },
      areas: { t: "strings" },
      description: { t: "string", d: "One line" },
      session: P.session,
    },
    httpOnly: ["session"],
  },
  {
    name: "upload",
    description: "Upload bytes and return id and URL. Reference id as an image surface's assetId.",
    params: {
      data: { t: "string", d: "Base64 file bytes" },
      contentType: { t: "string", d: "MIME type" },
      filename: { t: "string", d: "Original download filename" },
      kind: { t: "enum", values: ["image", "file"] },
      session: P.session,
    },
    httpOnly: ["session"],
    stdioExtra: { path: { t: "string", d: "Local file path; use instead of data" } },
  },
  {
    name: "system",
    description:
      "Read or change the project's system (sheet, tokens, scales, palettes, project knobs), which every render wears at once. No arguments reads it; each argument replaces its part, tokens, scales and palettes upsert. Shapes: topic system.",
    params: {
      project: P.project,
      sheet: { t: "string", d: "CSS; no @import" },
      classes: { t: "named", d: "[{name, note}] or names" },
      fonts: { t: "objects", d: "[{family, href?}]" },
      tokens: { t: "objects", d: "[{name, type, value, note?}]" },
      scales: {
        t: "objects",
        d: "[{id, family: type|space, prefix, steps, zero, base, ratio, fluid?}]",
      },
      roles: { t: "named", d: "[{name, note}] or names" },
      palettes: { t: "objects", d: "[{id, label, note, light, dark}]" },
      pairs: { t: "pairs", d: "[[fg, bg, min?]]" },
      as: { t: "object" },
      knobs: { t: "object", d: "Project knobs" },
      remove: { t: "object", d: "{tokens?, palettes?, scales?}" },
      restore: { t: "integer", d: "A revision, alone" },
      session: P.session,
    },
    httpOnly: ["session"],
  },
  {
    name: "guide",
    description:
      "Fetch the brief: the loop, parts, asks and knobs, feedback, the html contract, and this " +
      "project's system, kit and icons. Read it before the first publish. Pass topic for one " +
      `reference section (${GUIDE_TOPICS.join(", ")}).`,
    params: {
      project: P.project,
      topic: { t: "enum", values: GUIDE_TOPICS, d: "One reference section instead of the brief" },
      session: P.session,
    },
    httpOnly: ["session"],
  },
];

// The codemode catalog (`/mcp?mode=code`, MOCKPIT_MCP_MODE=code): one tool whose
// description carries the whole script API.
export const RUN_TOOL_DEF: ToolDef = {
  name: "run",
  description: RUN_DESCRIPTION,
  params: {
    code: { t: "string", d: "JavaScript: the body of an async function", req: true },
    session: { t: "string", d: "Session id from an earlier run" },
    project: P.project,
    agent: { t: "string", d: field.agent },
  },
  httpOnly: ["session", "agent"],
  stdioExtra: {
    code: { t: "string", d: "JavaScript: the body of an async function" },
    path: { t: "string", d: "Local .js file to run instead of code" },
  },
};

// Output shapes (MCP 2025-06-18 outputSchema) of what the shared flows return
// (apiViews.ts, feedbackBatch.ts, app.ts). Loose objects: they name the fields
// an agent's code reads, not every field, and must never reject the rest.
const o = z.looseObject;
const str = z.string();
const num = z.number();
const nullStr = z.string().nullable();
const strs = z.array(z.string());
const bag = z.record(z.string(), z.unknown());
const alternativeRef = o({ state: nullStr, alternative: str });
// An entry named as its design names them: an alternative, or a variants design's
// variant. Exactly one of the two, so a correct result of either kind validates.
const entryNamed = <T extends z.ZodRawShape>(shape: T) =>
  z.union([
    o({ ...shape, alternative: str, variant: z.never().optional() }),
    o({ ...shape, variant: str, alternative: z.never().optional() }),
  ]);
const inUseRef = o({ state: nullStr, alternative: str, version: num });
const partsByState = z.array(o({ state: nullStr, parts: z.array(o({ name: str })) }));
const flowSchema = o({ name: str, steps: z.array(o({ design: str, state: nullStr })) });

const followUpsSchema = o({
  apply: o({ target: str, states: o({ matched: z.array(nullStr), missing: z.array(nullStr) }) })
    .optional()
    .describe("Not copied: publish it on target"),
  gaps: o({ target: str, states: z.array(nullStr).optional(), variants: z.array(bag).optional() })
    .optional()
    .describe("What target has that the use lacks: draw it there"),
  instanceIn: o({ component: str, ready: z.boolean(), designs: z.array(bag) })
    .optional()
    .describe("Designs showing the changed component: an idea for each, with a question"),
  spec: z
    .array(o({ design: str, decisions: num }))
    .optional()
    .describe("Specs to update"),
  lift: o({ parts: z.array(bag), likeLibrary: z.array(bag) })
    .optional()
    .describe("A screen just marked Ready: its own parts to lift, copies of library components"),
  placeFlow: o({ flow: str, steps: z.array(bag), screens: z.array(bag) })
    .optional()
    .describe("A flow idea used: put each step on a screen, then ask"),
}).describe("What the decision now requires");
const feedbackSchema = o({
  design: nullStr,
  reply: o({
    asks: z.array(
      o({
        ask: str,
        chosen: z.array(o({ label: str, other: z.literal(true).optional() })),
        description: str.optional(),
      }),
    ),
    borrowed: bag.describe("Part → the alternative to take it from"),
    tuned: bag,
    comments: z.array(o({ part: nullStr, text: str })),
    reactions: strs.optional().describe('One-tap reactions, e.g. 👍 part "hero" (alternative B)'),
    verdict: o({ kind: z.enum(["use", "revise"]), state: nullStr, alternative: str })
      .optional()
      .describe("Use this or New version on one alternative"),
    more: o({
      ask: str,
      text: str,
      existing: strs,
      note: str.optional(),
      answered: z.array(o({ ask: str, text: str, chosen: strs, comment: str.optional() })),
    })
      .optional()
      .describe("The user wants more answers to this question: ask it again, same id, with them"),
  })
    .nullable()
    .describe("The user's Send; null if only messages"),
  messages: z.array(o({ seq: num, text: str })).describe("What the user wrote in the thread"),
  inUse: z.array(inUseRef).describe("In use, each at the version the user put in use"),
  archived: z.array(alternativeRef),
  edited: o({
    kind: str.optional(),
    area: nullStr.optional(),
    spec: bag.optional(),
    ready: o({ ready: z.boolean(), at: str }).optional(),
  })
    .optional()
    .describe(
      "The user moved the design from Home (its kind or area now), edited its spec, or marked it Ready (or took it off)",
    ),
  nudges: strs.optional(),
  followUps: followUpsSchema.optional(),
  target: o({ slug: str, ruledOut: z.array(o({ name: str })).optional() })
    .optional()
    .describe("What the idea's design turned down"),
}).meta({ id: "Feedback" });
// Typed once, on feedback: repeating it on every write would cost more than
// the rest of the write's output schema.
const feedbackRide = z.array(bag).describe("Feedback batches as the feedback tool returns");
const pendingSchema = o({
  design: str,
  archived: z.literal(true).optional(),
  viewerOpen: z.boolean(),
  draft: o({ answered: num, of: num, comments: num, touchedAt: str }).nullable(),
  followUps: bag.optional().describe("Still open from its last decision"),
}).meta({ id: "Pending" });

const writeOutput = {
  post: entryNamed({ state: nullStr, version: num })
    .optional()
    .describe("Absent when planned: nothing is drawn yet"),
  planned: z.boolean().optional(),
  sessionId: str,
  url: str.describe("Viewer link for the user"),
  parts: partsByState.optional(),
  partChanges: o({ vanished: strs, renamed: z.array(o({ from: str, to: str })) }).optional(),
  nudges: strs.optional(),
  suggestedAsk: bag.optional().describe("Send with ask when a nudge names it"),
  suggestedSwapAsks: z
    .array(bag)
    .optional()
    .describe("A question per part with swaps that none sets; send with ask"),
  flow: flowSchema.optional(),
  feedback: feedbackRide,
};

const OUTPUT_SCHEMAS: Record<string, z.ZodRawShape> = {
  run: {
    ok: z.boolean(),
    value: z.unknown().optional(),
    prints: strs,
    calls: z
      .array(o({ fn: str, ok: z.boolean(), summary: str }))
      .describe("Every host call, in order"),
    error: o({
      kind: z.enum(["script", "timeout", "limit", "aborted"]),
      message: str,
      line: num.optional(),
      column: num.optional(),
    }).optional(),
    feedback: z.array(feedbackSchema).describe("Every batch the run received, also on failure"),
    session: nullStr,
  },
  publish: writeOutput,
  ask: {
    asks: z.array(o({ id: str, text: str })),
    open: num,
    url: str,
    nudges: strs.optional(),
    feedback: feedbackRide,
  },
  feedback: {
    feedback: z.array(feedbackSchema).describe("One batch per design; empty when nothing is new"),
    pending: z.array(pendingSchema),
  },
  say: { feedback: feedbackRide },
  move: {
    alternatives: z.array(o({ state: str.nullable(), alternative: str, status: str })),
    versions: z
      .array(o({ state: str.nullable(), alternative: str, version: num }))
      .optional()
      .describe("With hideOlder or deleteOlder: what was hidden or deleted"),
    skipped: z.array(
      o({ state: str.nullable().optional(), alternative: str, version: num.optional(), why: str }),
    ),
    to: o({ design: str, title: str, state: str.nullable() }).optional(),
    saved: z
      .array(o({ state: str.nullable(), alternative: str, already: z.boolean() }))
      .optional()
      .describe("What each is called there"),
    url: str,
    feedback: feedbackRide,
  },
  system: {
    rev: num,
    changed: strs.optional().describe("What this write changed, as the Thread says it"),
    checks: strs,
    nudges: strs.optional(),
    url: str,
    feedback: feedbackRide.optional(),
  },
  edit: {
    renamed: o({ from: str, to: str }).optional(),
    areas: z.array(bag).optional(),
    url: str,
    nudges: strs.optional(),
    feedback: feedbackRide,
  },
  read: {
    designs: z
      .array(o({ slug: str, states: strs, alternatives: num.optional(), open: num }))
      .optional(),
    states: strs.optional(),
    asks: z.array(o({ id: str, text: str })).optional(),
    alternatives: z
      .array(
        o({
          state: nullStr,
          alternative: str,
          status: z.enum(["open", "inUse", "archived"]),
          version: num,
          inUseVersion: num.optional().describe("Set while in use: the version in use"),
          history: z
            .array(o({ version: num, hidden: z.boolean().optional() }))
            .optional()
            .describe("With history: version rows; hidden ones the user put away are flagged"),
        }),
      )
      .optional(),
    inUse: z
      .array(inUseRef)
      .optional()
      .describe("Per state, the version the user put in use; export and instances resolve to it"),
    knobs: bag.optional(),
    system: str
      .optional()
      .describe(
        "Without design: what the project's renders wear (rev, palettes, counts, failing checks)",
      ),
    settled: bag.optional().describe("Every knob value the user has sent, later replies winning"),
    tree: z.array(bag).optional(),
    spec: bag.optional(),
    ready: bag
      .nullable()
      .optional()
      .describe("A screen or component: the user's mark, with the versions it covers"),
    changed: z.boolean().optional().describe("Something newer than Ready shows"),
    builtFrom: z.array(bag).optional(),
    flows: z.array(flowSchema).optional(),
    decisionLog: o({
      total: num,
      lines: z.array(
        o({
          design: str,
          text: str,
          here: z.boolean().optional().describe("From the design read"),
          system: z.boolean().optional().describe("The project's own, on every design"),
          edited: z.boolean().optional(),
          archived: z.boolean().optional(),
        }),
      ),
      more: str.optional(),
    }).optional(),
    total: num.optional(),
    lines: z.array(bag).optional(),
    pending: z.union([z.array(pendingSchema), pendingSchema]).optional(),
  },
  export: {
    states: z
      .array(
        entryNamed({
          state: nullStr,
          version: num,
          latest: num.optional().describe("Your newer version, not in use yet"),
          html: str.describe("With swaps: only the chosen ones"),
          allSwaps: str.optional().describe("With swaps: the html with every swap"),
          markdown: str,
        }),
      )
      .optional(),
    settled: bag.optional(),
    reply: bag.nullable().optional(),
    sheet: str.optional().describe("Without design: the project's sheet"),
    css: str
      .optional()
      .describe(
        "Without design: tokens as CSS, the default palette on :root, kept ones by [data-palette]",
      ),
    tokens: bag.optional().describe("Without design: the same as data"),
    knobs: bag.optional().describe("Without design: the project knobs' values"),
    components: z.array(bag).optional(),
  },
};

// The core loop, loaded up front by harnesses that defer the rest of the
// catalog behind a tool search.
const ALWAYS_LOAD = new Set(["publish", "ask", "feedback", "guide"]);
const toolMeta = (name: string) =>
  ALWAYS_LOAD.has(name) ? { _meta: { "anthropic/alwaysLoad": true } } : {};

function shapeFor(tool: ToolDef, transport: "http" | "stdio"): z.ZodRawShape {
  const shape: Record<string, z.ZodType> = {};
  const params = transport === "stdio" ? { ...tool.params, ...tool.stdioExtra } : tool.params;
  for (const [key, p] of Object.entries(params)) {
    if (transport === "stdio" && tool.httpOnly?.includes(key)) continue;
    shape[key] =
      transport === "stdio" && key === "html" && tool.name === "publish"
        ? z.string().optional().describe(`${field.html}; or a file path`)
        : transport === "stdio" && key === "sheet" && tool.name === "system"
          ? z.string().optional().describe(`${p.d}; or a file path`)
          : transport === "stdio" && key === "poster" && tool.name === "publish"
            ? z.string().optional().describe(`${p.d}; or an image file path`)
            : zodParam(p);
  }
  return shape;
}

// Both transports advertise zod's 2020-12 output (`$defs` + `$ref`), minus keys
// that only restate JSON Schema defaults and the `id` zod leaves on a named
// def, which Ajv-based clients reject as a draft-04 keyword.
type Json = Record<string, unknown>;
const SAFE_INT = Number.MAX_SAFE_INTEGER;

function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compact);
  if (!value || typeof value !== "object") return value;
  const node: Json = {};
  for (const [k, v] of Object.entries(value)) node[k] = compact(v);
  delete node.$schema;
  if (typeof node.id === "string") delete node.id;
  delete node.propertyNames;
  if (node.minimum === -SAFE_INT) delete node.minimum;
  if (node.maximum === SAFE_INT) delete node.maximum;
  const extra = node.additionalProperties;
  if (extra && typeof extra === "object" && Object.keys(extra).length === 0) {
    delete node.additionalProperties;
  }
  // zod spells nullable as anyOf [T, null]; a type list says the same.
  const any = node.anyOf as Json[] | undefined;
  if (any?.length === 2 && typeof any[0].type === "string" && any[1].type === "null") {
    const { anyOf: _, ...rest } = node;
    return { ...any[0], ...rest, type: [any[0].type, "null"] };
  }
  return node;
}

const toJson = (schema: z.ZodType, io: "input" | "output") =>
  compact(z.toJSONSchema(schema, { target: "draft-2020-12", io })) as Json;

const catalog = (transport: "http" | "stdio", defs = MCP_TOOL_DEFS) =>
  defs.map((tool) => {
    const output = OUTPUT_SCHEMAS[tool.name];
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: toJson(z.object(shapeFor(tool, transport)), "input"),
      ...(output ? { outputSchema: toJson(z.looseObject(output), "output") } : {}),
      ...toolMeta(tool.name),
    };
  });

export const HTTP_MCP_TOOLS = catalog("http");

// What stdio's tools/list returns. The SDK would serialize the zod shapes
// itself, but as draft-07 with the leaked `id` (see `compact`), so mcp/server.ts
// lists this and keeps the zod shapes below for call validation only.
export const STDIO_MCP_CATALOG = catalog("stdio");

export const HTTP_RUN_TOOLS = catalog("http", [RUN_TOOL_DEF]);
export const STDIO_RUN_CATALOG = catalog("stdio", [RUN_TOOL_DEF]);

const stdioTools = (defs: ToolDef[]) =>
  defs.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: shapeFor(tool, "stdio"),
    ...(OUTPUT_SCHEMAS[tool.name]
      ? { outputSchema: z.looseObject(OUTPUT_SCHEMAS[tool.name]) }
      : {}),
    ...toolMeta(tool.name),
  }));

export const STDIO_MCP_TOOLS = stdioTools(MCP_TOOL_DEFS);
export const STDIO_RUN_TOOLS = stdioTools([RUN_TOOL_DEF]);

export const MCP_TOOL_NAMES = MCP_TOOL_DEFS.map((t) => t.name);

// One result shape for both transports: the JSON text every client reads, plus
// the same value as structuredContent where the tool declares an outputSchema.
export function toolResult(name: string, value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const structured =
    Object.hasOwn(OUTPUT_SCHEMAS, name) && value !== null && typeof value === "object";
  return {
    content: [{ type: "text" as const, text }],
    ...(structured ? { structuredContent: value as Record<string, unknown> } : {}),
  };
}

// The images a result's feedback carries, inlined as image content so the
// model sees what the user attached instead of only its URL. Capped per result:
// the rest stay reachable by URL in the JSON.
export const MAX_RESULT_IMAGES = 8;
export async function withFeedbackImages<T extends { content: unknown[] }>(
  result: T,
  value: unknown,
  load: (ref: ImageRef) => Promise<{ data: Uint8Array; mimeType: string } | null>,
): Promise<T> {
  const batches = (value as { feedback?: unknown } | null)?.feedback;
  if (!Array.isArray(batches)) return result;
  const images: { type: "image"; data: string; mimeType: string }[] = [];
  for (const ref of feedbackImages(batches as FeedbackBatch[]).slice(0, MAX_RESULT_IMAGES)) {
    const bytes = await load(ref).catch(() => null);
    if (bytes)
      images.push({ type: "image", data: encodeBase64(bytes.data), mimeType: bytes.mimeType });
  }
  return images.length ? { ...result, content: [...result.content, ...images] } : result;
}

// A run that failed is still a full envelope (calls, feedback); isError tells
// the client the script did not finish.
export function runToolResult(envelope: unknown) {
  const ok = (envelope as { ok?: unknown } | null)?.ok === true;
  return { ...toolResult("run", envelope), ...(ok ? {} : { isError: true }) };
}
