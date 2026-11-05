import * as z from "zod/v4";
import { encodeBase64 } from "./base64.ts";
import { GUIDE_TOPICS } from "./designGuide.ts";
import { type FeedbackBatch, feedbackImages, type ImageRef } from "./feedbackBatch.ts";
import { KIT_IDS } from "./kits.ts";
import { RUN_DESCRIPTION } from "./runApi.ts";
import { MAX_NOTES, SURFACE_KINDS, type SurfaceKind } from "./types.ts";

export const MCP_SERVER_INFO = { name: "mockpit", version: "0.2.0" };

// The `kind` enum both MCP transports advertise — derived from the one canonical
// list (types.ts) so the MCP tier can never fall behind what REST/CLI accept.
const SURFACE_KIND_ENUM = [...SURFACE_KINDS] as [SurfaceKind, ...SurfaceKind[]];

export const MCP_INSTRUCTIONS =
  "Mockpit shows design work to the user: project > design > state > variant > version. publish " +
  "each variant (name states in the user's words; declare parts with data-part); publish again to " +
  "revise. A choice is several variants plus one question that binds them (ask). One render plus a " +
  "control: declare a knob. Say where to look, then end your turn; nothing waits. When the " +
  "user says they answered, call feedback. Writes return feedback too; it is delivered once. " +
  "Fetch guide before html.";

const field = {
  design: "Design slug, title or id",
  state: "State label; omit if single-state",
  variant: 'Variant label; default "default"',
  project: "Default: the session's project",
  title: "Design title",
  session: "Session id from an earlier publish",
  sessionTitle: "Task name; used only when creating the session",
  agent: "Agent name for a new session",
  html: "HTML body fragment",
  knobs:
    'Global knobs (tunekit usePane shape) keyed by path: [default,min,max,step], boolean, {type:"select",options}, "#hex"',
  variantKnobs: "Knobs this variant alone has",
  from: "Branch from this version",
  amend: "Replace the latest version in place: a fix before the user acts on it",
  withdraw: "Take the latest version back, before the user acts on it",
  fork: 'Start this new variant from a sibling: "variant" or "variant@N"; alone it copies it, with parts/fills it edits the copy',
  prompt: "What prompted this version; usually omit",
  description: "What this variant is; shown beside it, never in the html",
  widths: "Widths it ships at, side by side: [390,1280]",
  kind: "Only when building the product's screens: screen, component (a reusable design screens embed). With no html it plans one, drawn by a later publish. Omit for ideas, diagrams and reviews",
  area: 'Product area in the project\'s words; Home groups by it. "" clears',
  source: 'Code path implementing it. "" clears',
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
      variant: z.string().optional().describe("Bind to a published variant"),
      version: z.number().int().optional().describe("And one version of it"),
      set: z.record(z.string(), z.unknown()).optional().describe("Or to knob values {path: value}"),
      recommended: z.boolean().optional().describe("The one you would pick; one per ask"),
    }),
  ),
});

// One parameter vocabulary generates both transports' schemas, so the HTTP
// JSON Schema and the stdio zod shape cannot drift apart.
type Param =
  | { t: "string" | "number" | "boolean" | "integer"; d?: string; req?: boolean }
  | { t: "enum"; values: readonly [string, ...string[]]; d?: string; req?: boolean }
  | { t: "surfaces" | "asks" | "object" | "integers" | "strings"; d?: string; req?: boolean };

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
    case "object":
      s = z.record(z.string(), z.unknown());
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
  variant: { t: "string", d: field.variant },
  project: { t: "string", d: field.project },
  session: { t: "string", d: field.session },
} as const satisfies Record<string, Param>;

const VARIANT_REF = { design: P.design, state: P.state, variant: P.variant, project: P.project };

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
      "Create or version one variant of one state of a design. One of html, surfaces (the full ordered list), parts or fills (splice the latest version); or kind screen or component and none of them, to plan it. Returns parts per state, nudges, feedback.",
    params: {
      ...VARIANT_REF,
      title: { t: "string", d: field.title },
      kind: { t: "enum", values: ["screen", "component", "idea"], d: field.kind },
      area: { t: "string", d: field.area },
      source: { t: "string", d: field.source },
      html: { t: "string", d: field.html },
      poster: { t: "string", d: field.poster },
      surfaces: {
        t: "surfaces",
        d: "Full ordered list: {id} keeps a surface, a missing id removes it",
      },
      parts: { t: "object", d: '{"name"|"name#key": outer html}; splices declared parts' },
      fills: {
        t: "object",
        d: '{"part#fill": outer html}; replaces that fill of a part, or adds it after its others',
      },
      knobs: { t: "object", d: field.knobs },
      variantKnobs: { t: "object", d: field.variantKnobs },
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
      "Ask structured questions on a design. A choice is several variants plus one question that binds them; options may also set knob values. Reusing a question id replaces it.",
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
      "Read this first. Both forms carry decisionList: what the user already settled in this project; it stands unless they say otherwise. Without design: every design (slug, states, variants, open questions), flows, plus pending. With design: its notes (a spec; the user's edits stand), states, variants, questions with answers, parts, knobs and settled values (every answer's set and tuning sent so far), plus pending. Never consumes feedback.",
    params: {
      design: { t: "string", d: field.design },
      project: P.project,
      body: { t: "boolean", d: "Include each variant's surfaces" },
      history: { t: "boolean", d: "Include version rows" },
      tree: {
        t: "boolean",
        d: "Without design: the project as a tree (each design's variants with status and forkedFrom, the designs it embeds and is embedded in)",
      },
      decisions: {
        t: "boolean",
        d: "Only the whole decision list, when decisionList says it was cut",
      },
    },
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
      ...VARIANT_REF,
      message: { t: "string", d: "Plain text", req: true },
      session: P.session,
    },
    httpOnly: ["session"],
  },
  {
    name: "move",
    description:
      "Tidy up variants: to or toState moves them there and out of here; archive takes them out of view; restore brings them back; a group goes along; one in use stays. Only when the user asks: hideOlder hides each variant's older versions (variants optional: all of them), and deleteOlder deletes them for good, skipping any that a reply, comment, question, embed, copy or fork still points at, or that is in use. Confirm a delete first: it can't be undone. Returns feedback.",
    params: {
      design: P.design,
      state: P.state,
      variants: { t: "strings", d: "Variant names; required except with hideOlder or deleteOlder" },
      to: { t: "string", d: "Target design; default this one" },
      toState: { t: "string", d: "Target state; created if new" },
      archive: { t: "boolean" },
      restore: { t: "boolean" },
      hideOlder: { t: "boolean", d: "Hide all but each variant's newest visible version" },
      deleteOlder: { t: "boolean", d: "Delete them instead; permanent, skips what's referenced" },
      project: P.project,
      session: P.session,
    },
    httpOnly: ["session"],
  },
  {
    name: "export",
    description:
      "The html in use (else current) per state, version history, screenshot URL, knobs, the settled values and the last reply.",
    params: VARIANT_REF,
  },
  {
    name: "edit",
    description:
      "Change a design without a new version; a new slug rewrites every reference to the old one. Without design, rename renames the project and areaOrder orders its areas. Returns feedback.",
    params: {
      design: { t: "string", d: field.design },
      project: P.project,
      slug: { t: "string" },
      title: { t: "string" },
      kind: { t: "enum", values: ["screen", "component", "idea"] },
      area: { t: "string" },
      source: { t: "string" },
      firstState: { t: "string", d: "Names a design's one unnamed state, so it can have more" },
      notes: {
        t: "string",
        d: `A short plain-text spec, at most ${MAX_NOTES} characters; "" clears. Not applied over the user's own edit, and the result says so`,
      },
      rename: { t: "string", d: "New project name" },
      areaOrder: { t: "strings", d: "Without design: Home's area order" },
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
    name: "guide",
    description:
      "Fetch the brief: the loop, parts, asks and knobs, feedback, the html contract, and this " +
      "project's palette, kit and icons. Read it before the first publish. Pass topic for one " +
      `reference section (${GUIDE_TOPICS.join(", ")}).`,
    params: {
      project: P.project,
      topic: { t: "enum", values: GUIDE_TOPICS, d: "One reference section instead of the brief" },
    },
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
const variantRef = o({ state: nullStr, variant: str });
const inUseRef = o({ state: nullStr, variant: str, version: num });
const partsByState = z.array(o({ state: nullStr, parts: z.array(o({ name: str })) }));
const flowSchema = o({ name: str, steps: z.array(o({ design: str, state: nullStr })) });

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
    borrowed: bag.describe("Part → the variant to take it from"),
    tuned: bag,
    comments: z.array(o({ part: nullStr, text: str })),
    reactions: strs.optional().describe('One-tap reactions, e.g. 👍 part "hero" (variant B)'),
    verdict: o({ kind: z.enum(["use", "revise"]), state: nullStr, variant: str })
      .optional()
      .describe("Use this or New version on one variant"),
  })
    .nullable()
    .describe("The user's Send; null if only messages"),
  messages: z.array(o({ seq: num, text: str })).describe("What the user wrote in the thread"),
  inUse: z.array(inUseRef).describe("In use, each at the version the user put in use"),
  archived: z.array(variantRef),
  edited: o({
    kind: str.optional(),
    area: nullStr.optional(),
    notes: nullStr.optional(),
  })
    .optional()
    .describe("The user moved the design from Home (its kind or area now) or edited its notes"),
}).meta({ id: "Feedback" });
// Typed once, on feedback: repeating it on every write would cost more than
// the rest of the write's output schema.
const feedbackRide = z.array(bag).describe("Feedback batches as the feedback tool returns");
const pendingSchema = o({
  design: str,
  archived: z.literal(true).optional(),
  viewerOpen: z.boolean(),
  draft: o({ answered: num, of: num, comments: num, touchedAt: str }).nullable(),
}).meta({ id: "Pending" });

const writeOutput = {
  post: o({ state: nullStr, variant: str, version: num })
    .optional()
    .describe("Absent when planned: nothing is drawn yet"),
  planned: z.boolean().optional(),
  sessionId: str,
  url: str.describe("Viewer link for the user"),
  parts: partsByState.optional(),
  partChanges: o({ vanished: strs, renamed: z.array(o({ from: str, to: str })) }).optional(),
  nudges: strs.optional(),
  suggestedAsk: bag.optional().describe("Send with ask when a nudge names it"),
  suggestedFillAsks: z
    .array(bag)
    .optional()
    .describe("A question per part with fills that none sets; send with ask"),
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
    variants: z.array(o({ state: str.nullable(), variant: str, status: str })),
    versions: z
      .array(o({ state: str.nullable(), variant: str, version: num }))
      .optional()
      .describe("With hideOlder or deleteOlder: what was hidden or deleted"),
    skipped: z.array(
      o({ state: str.nullable().optional(), variant: str, version: num.optional(), why: str }),
    ),
    to: o({ design: str, title: str, state: str.nullable() }).optional(),
    saved: z
      .array(o({ state: str.nullable(), variant: str, already: z.boolean() }))
      .optional()
      .describe("What each is called there"),
    url: str,
    feedback: feedbackRide,
  },
  edit: {
    renamed: o({ from: str, to: str }).optional(),
    areaOrder: strs.optional(),
    url: str,
    nudges: strs.optional(),
    feedback: feedbackRide,
  },
  read: {
    designs: z.array(o({ slug: str, states: strs, variants: num, open: num })).optional(),
    states: strs.optional(),
    asks: z.array(o({ id: str, text: str })).optional(),
    variants: z
      .array(
        o({
          state: nullStr,
          variant: str,
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
      .describe("Per state, the version the user put in use; export and embeds resolve to it"),
    knobs: bag.optional(),
    settled: bag.optional().describe("Every knob value the user has sent, later replies winning"),
    tree: z.array(bag).optional(),
    flows: z.array(flowSchema).optional(),
    decisionList: o({
      total: num,
      lines: z.array(
        o({
          design: str,
          text: str,
          here: z.boolean().optional().describe("From the design read"),
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
    states: z.array(
      o({
        state: nullStr,
        variant: str,
        version: num,
        latest: num.optional().describe("Your newer version, not in use yet"),
        html: str.describe("With fills: only the chosen ones"),
        allFills: str.optional().describe("With fills: the html with every fill"),
        markdown: str,
      }),
    ),
    settled: bag,
    reply: bag.nullable(),
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
