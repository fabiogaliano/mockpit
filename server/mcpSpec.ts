import * as z from "zod/v4";
import { GUIDE_TOPICS } from "./designGuide.ts";
import { KIT_IDS } from "./kits.ts";
import { RUN_DESCRIPTION } from "./runApi.ts";
import { SURFACE_KINDS, type SurfaceKind } from "./types.ts";

export const MCP_SERVER_INFO = { name: "mockpit", version: "0.2.0" };

// The `kind` enum both MCP transports advertise — derived from the one canonical
// list (types.ts) so the MCP tier can never fall behind what REST/CLI accept.
const SURFACE_KIND_ENUM = [...SURFACE_KINDS] as [SurfaceKind, ...SurfaceKind[]];

export const MCP_INSTRUCTIONS =
  "Mockpit shows design work to the user: project > mock > state > variant > version. publish " +
  "each variant (name states in the user's words; mark parts with data-part); publish again to " +
  "revise. A choice is several variants plus one ask that binds them. One render plus a " +
  "control: declare a knob. Say where to look, then end your turn; nothing waits. When the " +
  "user says they answered, call feedback. Writes return feedback too; it is delivered once. " +
  "Fetch guide before html.";

const field = {
  mock: "Mock slug or id",
  state: "State label; omit if single-state",
  variant: 'Variant label; default "default"',
  project: "Default: the session's project",
  title: "Mock title",
  session: "Session id from an earlier publish",
  sessionTitle: "Task name; used only when creating the session",
  agent: "Agent name for a new session",
  html: "HTML body fragment",
  knobs:
    'Global knobs (tunekit usePane shape) keyed by path: [default,min,max,step], boolean, {type:"select",options}, "#hex"',
  variantKnobs: "Knobs this variant alone has",
  from: "Branch from this version",
  prompt: "What prompted this version; usually omit",
  kits: `Opt-in bundles: ${KIT_IDS.join("|")}`,
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
  id: z.string().optional().describe("Stable id; reusing one replaces that ask"),
  text: z.string().describe("The question, one sentence"),
  scope: z.enum(["mock", "state", "part"]).optional(),
  state: z.string().optional(),
  part: z.string().optional().describe("data-part name, for scope part"),
  multi: z.boolean().optional(),
  options: z.array(
    z.object({
      id: z.string().optional(),
      label: z.string(),
      variant: z.string().optional().describe("Bind to a published variant"),
      set: z.record(z.string(), z.unknown()).optional().describe("Or to knob values {path: value}"),
    }),
  ),
});

// One parameter vocabulary generates both transports' schemas, so the HTTP
// JSON Schema and the stdio zod shape cannot drift apart.
type Param =
  | { t: "string" | "number" | "boolean" | "integer"; d?: string; req?: boolean }
  | { t: "enum"; values: readonly [string, ...string[]]; d?: string; req?: boolean }
  | { t: "surfaces" | "asks" | "object"; d?: string; req?: boolean };

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
    default:
      s = p.t === "string" ? z.string() : p.t === "number" ? z.number() : z.boolean();
  }
  if (p.d) s = s.describe(p.d);
  return p.req ? s : s.optional();
}

const P = {
  mock: { t: "string", d: field.mock, req: true },
  state: { t: "string", d: field.state },
  variant: { t: "string", d: field.variant },
  project: { t: "string", d: field.project },
  session: { t: "string", d: field.session },
} as const satisfies Record<string, Param>;

const VARIANT_REF = { mock: P.mock, state: P.state, variant: P.variant, project: P.project };

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
      "Create or version one variant of one state of a mock. One of html, surfaces (the full ordered list) or parts (splices the latest version). Returns parts per state, nudges, feedback.",
    params: {
      ...VARIANT_REF,
      title: { t: "string", d: field.title },
      kind: { t: "enum", values: ["component", "page"] },
      html: { t: "string", d: field.html },
      surfaces: {
        t: "surfaces",
        d: "Full ordered list: {id} keeps a surface, a missing id removes it",
      },
      parts: { t: "object", d: '{"name"|"name#key": outer html}; splices marked parts' },
      knobs: { t: "object", d: field.knobs },
      variantKnobs: { t: "object", d: field.variantKnobs },
      from: { t: "integer", d: field.from },
      prompt: { t: "string", d: field.prompt },
      session: P.session,
      sessionTitle: { t: "string", d: field.sessionTitle },
      agent: { t: "string", d: field.agent },
    },
    httpOnly: ["session", "agent"],
  },
  {
    name: "ask",
    description:
      "Ask structured questions on a mock. A choice is several variants plus one ask that binds them; options may also set knob values. Reusing an ask id replaces it.",
    params: {
      mock: P.mock,
      project: P.project,
      asks: { t: "asks", d: "Questions with options", req: true },
      session: P.session,
    },
    httpOnly: ["session"],
  },
  {
    name: "read",
    description:
      "Without mock: every mock (slug, states, variants, open asks) plus pending. With mock: its states, variants, asks with answers, parts, knobs and last tuned values, plus pending. Never consumes feedback.",
    params: {
      mock: { t: "string", d: field.mock },
      project: P.project,
      body: { t: "boolean", d: "Include each variant's surfaces" },
      history: { t: "boolean", d: "Include version rows" },
    },
  },
  {
    name: "feedback",
    description:
      "Returns at once: what the user sent since you last heard (one batch per mock: reply answers, mix, tuned knobs, part comments, comments, accepted/archived), delivered once, plus pending (viewer open, draft progress).",
    params: {
      project: P.project,
      session: { t: "string", d: "Session id returned by publish", req: true },
    },
    httpOnly: ["session"],
  },
  {
    name: "say",
    description: "Post a short plain-text message in a mock's thread. Returns feedback.",
    params: {
      ...VARIANT_REF,
      message: { t: "string", d: "Plain text", req: true },
      session: P.session,
    },
    httpOnly: ["session"],
  },
  {
    name: "export",
    description:
      "The accepted (or current) html per state, version history, screenshot URL, knobs and the last reply's tuned values.",
    params: VARIANT_REF,
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
      "Fetch the brief: the loop, parts, asks and knobs, the reply, the html contract, and this " +
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
const partsByState = z.array(o({ state: nullStr, parts: z.array(o({ name: str })) }));

const feedbackSchema = o({
  mock: nullStr,
  reply: o({
    asks: z.array(
      o({
        ask: str,
        chosen: z.array(o({ label: str, other: z.literal(true).optional() })),
        note: str.optional(),
      }),
    ),
    mix: bag,
    tuned: bag,
    comments: z.array(o({ part: nullStr, text: str })),
  })
    .nullable()
    .describe("The user's Send; null if only comments"),
  comments: z.array(o({ seq: num, text: str })),
  accepted: z.array(variantRef),
  archived: z.array(variantRef),
}).meta({ id: "Feedback" });
// Typed once, on feedback: repeating it on every write would cost more than
// the rest of the write's output schema.
const feedbackRide = z.array(bag).describe("Feedback batches as the feedback tool returns");
const pendingSchema = o({
  mock: str,
  viewerOpen: z.boolean(),
  draft: o({ answered: num, of: num, comments: num, touchedAt: str }).nullable(),
}).meta({ id: "Pending" });

const writeOutput = {
  post: o({ state: nullStr, variant: str, version: num }),
  sessionId: str,
  url: str.describe("Viewer link for the user"),
  parts: partsByState,
  partChanges: o({ vanished: strs, renamed: z.array(o({ from: str, to: str })) }).optional(),
  nudges: strs.optional(),
  suggestedAsk: bag.optional().describe("Send with ask when a nudge names it"),
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
  ask: { asks: z.array(o({ id: str, text: str })), open: num, url: str, feedback: feedbackRide },
  feedback: {
    feedback: z.array(feedbackSchema).describe("One batch per mock; empty when nothing is new"),
    pending: z.array(pendingSchema),
  },
  say: { feedback: feedbackRide },
  read: {
    mocks: z.array(o({ slug: str, states: strs, variants: num, open: num })).optional(),
    states: strs.optional(),
    asks: z.array(o({ id: str, text: str })).optional(),
    variants: z.array(o({ state: nullStr, variant: str, status: str, version: num })).optional(),
    knobs: bag.optional(),
    tuned: bag.optional().describe("Knob values from the latest reply"),
    pending: z.union([z.array(pendingSchema), pendingSchema]),
  },
  export: {
    states: z.array(o({ state: nullStr, variant: str, version: num, html: str, markdown: str })),
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

// A run that failed is still a full envelope (calls, feedback); isError tells
// the client the script did not finish.
export function runToolResult(envelope: unknown) {
  const ok = (envelope as { ok?: unknown } | null)?.ok === true;
  return { ...toolResult("run", envelope), ...(ok ? {} : { isError: true }) };
}
