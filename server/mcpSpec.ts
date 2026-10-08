import { z } from "zod";
import { KIT_IDS } from "./kits.ts";
import { SURFACE_KINDS, type SurfaceKind } from "./types.ts";

export const MCP_SERVER_INFO = { name: "mockpit", version: "0.2.0" };

// The `kind` enum both MCP transports advertise — derived from the one canonical
// list (types.ts) so the MCP tier can never fall behind what REST/CLI accept.
const SURFACE_KIND_ENUM = [...SURFACE_KINDS] as [SurfaceKind, ...SurfaceKind[]];

export const MCP_INSTRUCTIONS =
  "Mockpit shows design work to the user: project > mock > state > variant > version. Publish " +
  "with publish_mock (name each state in the user's words; mark parts with data-part), iterate " +
  "with revise_mock. Two renders needed to show a choice: publish variants and ask_user with " +
  "options bound to them. One render plus a control: declare a knob. Then wait_for_feedback for " +
  "the user's one batched reply. Read userFeedback in write results; feedback is delivered once. " +
  "Fetch get_design_guide before html.";

const field = {
  mock: "Mock slug (or id), e.g. writer",
  state: "State label in the user's words, e.g. Lab open; omit for a single-state mock",
  variant: 'Variant label; default "default"',
  project: "Project name; omit for the session's",
  title: "Mock title",
  kind: "component or page",
  session: "Session id from a previous publish; omit on the first",
  sessionTitle: "Task name for a new session; honored only when the publish creates it",
  agent: "Agent name for a new session",
  html: "HTML body fragment; no doctype/html/head/body. Mark parts with data-part",
  knobs:
    'Global knobs in tunekit usePane shape, keyed by path ("size" or "body.size"): ' +
    "[default,min,max,step] sliders, booleans, {type:'select',options}, '#hex' colors",
  variantKnobs: "Knobs only this variant has (same shape as knobs)",
  from: "Branch from this version instead of the latest",
  prompt: "What prompted this version; usually omit",
  target: "Surface id or 0-based index",
  kits: `Optional HTML bundles (${KIT_IDS.join("|")}); get_design_guide documents their classes`,
  markdown: "Markdown prose; raw HTML is escaped",
  mermaid: "Mermaid diagram source; viewer themes it, so do not set colors",
  patch: "Unified/git diff; preferred over full files",
  files: "Full before/after file pairs; use patch when available",
  assetId: "Asset id returned by upload_asset",
  text: "Terminal output; ANSI SGR styles are rendered",
  cols: "Optional terminal width in columns",
  data: "Any JSON value",
  code: "Source code to syntax-highlight",
  language: "Language id such as ts, js, python, go, or rust",
  lineStart: "1-based starting line number for an excerpt",
} as const;

const MCP_SURFACE_DESCRIPTION =
  "One surface: html for custom visuals, markdown for prose, mermaid for diagrams, diff for review, " +
  "image, terminal, json, code. Match kind to its named content field.";

const diffFileJson = {
  type: "object",
  properties: {
    filename: { type: "string" },
    before: { type: "string" },
    after: { type: "string" },
    language: { type: "string" },
  },
  required: ["filename", "before", "after"],
} as const;

export const MCP_SURFACE_JSON_SCHEMA = {
  type: "object",
  description: MCP_SURFACE_DESCRIPTION,
  properties: {
    kind: { type: "string", enum: SURFACE_KIND_ENUM },
    html: { type: "string", description: field.html },
    kits: { type: "array", items: { type: "string" }, description: field.kits },
    markdown: { type: "string", description: field.markdown },
    mermaid: { type: "string", description: field.mermaid },
    patch: { type: "string", description: field.patch },
    files: { type: "array", items: diffFileJson, description: field.files },
    layout: { type: "string", enum: ["unified", "split"] },
    assetId: { type: "string", description: field.assetId },
    alt: { type: "string" },
    caption: { type: "string" },
    title: { type: "string" },
    text: { type: "string", description: field.text },
    cols: { type: "number", description: field.cols },
    data: { description: field.data },
    code: { type: "string", description: field.code },
    language: { type: "string", description: field.language },
    lineStart: { type: "number", description: field.lineStart },
  },
  required: ["kind"],
} as const;

const diffFileSchema = z.object({
  filename: z.string(),
  before: z.string(),
  after: z.string(),
  language: z.string().optional(),
});

export const mcpSurfaceSchema = z
  .object({
    kind: z.enum(SURFACE_KIND_ENUM),
    html: z.string().optional().describe(field.html),
    kits: z.array(z.string()).optional().describe(field.kits),
    markdown: z.string().optional().describe(field.markdown),
    mermaid: z.string().optional().describe(field.mermaid),
    patch: z.string().optional().describe(field.patch),
    files: z.array(diffFileSchema).optional().describe(field.files),
    layout: z.enum(["unified", "split"]).optional(),
    assetId: z.string().optional().describe(field.assetId),
    alt: z.string().optional(),
    caption: z.string().optional(),
    title: z.string().optional(),
    text: z.string().optional().describe(field.text),
    cols: z.number().optional().describe(field.cols),
    data: z.unknown().optional().describe(field.data),
    code: z.string().optional().describe(field.code),
    language: z.string().optional().describe(field.language),
    lineStart: z.number().int().min(1).optional().describe(field.lineStart),
  })
  .describe(MCP_SURFACE_DESCRIPTION);

const ASK_JSON_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "Stable id; reusing one replaces that ask" },
    text: { type: "string", description: "The question, one sentence" },
    scope: { type: "string", enum: ["mock", "state", "part"] },
    state: { type: "string" },
    part: { type: "string", description: "data-part name, for scope part" },
    multi: { type: "boolean" },
    options: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          variant: { type: "string", description: "Bind to a published variant" },
          set: { type: "object", description: "Or bind to knob values {path: value}" },
        },
        required: ["label"],
      },
    },
  },
  required: ["text", "options"],
} as const;

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
      set: z.record(z.unknown()).optional().describe("Or bind to knob values {path: value}"),
    }),
  ),
});

// One parameter vocabulary generates both transports' schemas, so the HTTP
// JSON Schema and the stdio zod shape cannot drift apart.
type Param =
  | { t: "string" | "number" | "boolean" | "integer"; d?: string; req?: boolean }
  | { t: "enum"; values: readonly [string, ...string[]]; d?: string; req?: boolean }
  | { t: "surface" | "surfaces" | "asks" | "object" | "order"; d?: string; req?: boolean };

function jsonParam(p: Param): Record<string, unknown> {
  const d = p.d ? { description: p.d } : {};
  switch (p.t) {
    case "enum":
      return { type: "string", enum: p.values, ...d };
    case "surface":
      return MCP_SURFACE_JSON_SCHEMA;
    case "surfaces":
      return { type: "array", items: MCP_SURFACE_JSON_SCHEMA, ...d };
    case "asks":
      return { type: "array", items: ASK_JSON_SCHEMA, ...d };
    case "object":
      return { type: "object", ...d };
    case "order":
      return { type: "array", items: { oneOf: [{ type: "string" }, { type: "number" }] }, ...d };
    default:
      return { type: p.t, ...d };
  }
}

function zodParam(p: Param): z.ZodTypeAny {
  let s: z.ZodTypeAny;
  switch (p.t) {
    case "enum":
      s = z.enum(p.values as [string, ...string[]]);
      break;
    case "surface":
      s = mcpSurfaceSchema;
      break;
    case "surfaces":
      s = z.array(mcpSurfaceSchema);
      break;
    case "asks":
      s = z.array(askSchema);
      break;
    case "object":
      s = z.record(z.unknown());
      break;
    case "order":
      s = z.array(z.union([z.string(), z.number()]));
      break;
    case "integer":
      s = z.number().int();
      break;
    default:
      s = p.t === "string" ? z.string() : p.t === "number" ? z.number() : z.boolean();
  }
  if (p.d && p.t !== "surface") s = s.describe(p.d);
  return p.req ? s : s.optional();
}

const P = {
  mock: { t: "string", d: field.mock, req: true },
  state: { t: "string", d: field.state },
  variant: { t: "string", d: field.variant },
  project: { t: "string", d: field.project },
  session: { t: "string", d: field.session },
  target: { t: "string", d: field.target, req: true },
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
    name: "publish_mock",
    description:
      "Publish one variant of one state of a mock. An existing (mock, state, variant) becomes a new version. Returns the parts found per state and any that vanished or were renamed. Read userFeedback.",
    params: {
      ...VARIANT_REF,
      title: { t: "string", d: field.title },
      kind: { t: "enum", values: ["component", "page"], d: field.kind },
      html: { t: "string", d: field.html },
      surfaces: { t: "surfaces", d: "Ordered surfaces; use instead of html for other kinds" },
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
    name: "revise_mock",
    description:
      "Publish the next version of an existing variant; from branches off an earlier one. Flags parts that vanished or were renamed. Read userFeedback.",
    params: {
      ...VARIANT_REF,
      title: { t: "string", d: field.title },
      html: { t: "string", d: field.html },
      parts: { t: "object", d: '{"name"|"name#key": outer html}; splices parts, not with html' },
      surfaces: { t: "surfaces", d: "Ordered surfaces; use instead of html for other kinds" },
      knobs: { t: "object", d: field.knobs },
      variantKnobs: { t: "object", d: field.variantKnobs },
      from: { t: "integer", d: field.from },
      prompt: { t: "string", d: field.prompt },
      session: P.session,
    },
    httpOnly: ["session"],
  },
  {
    name: "list_mocks",
    description: "List mocks: slug, states, variants, open asks. No bodies.",
    params: { project: P.project },
  },
  {
    name: "get_mock",
    description:
      "One mock: states, variants, asks with answers, parts per state, knobs and last tuned values. Bodies and version rows are opt-in.",
    params: {
      mock: P.mock,
      project: P.project,
      body: { t: "boolean", d: "Include each variant's surfaces" },
      history: { t: "boolean", d: "Include version rows" },
    },
  },
  {
    name: "ask_user",
    description:
      "Ask structured questions on a mock. Bind options to variants (two renders needed to show a choice) or to knob values. Reusing an ask id replaces it. Follow with wait_for_feedback.",
    params: {
      mock: P.mock,
      project: P.project,
      asks: { t: "asks", d: "Questions with options", req: true },
      session: P.session,
    },
    httpOnly: ["session"],
  },
  {
    name: "wait_for_feedback",
    description:
      "Wait up to 300 seconds for the user's feedback: one batch per mock with the reply (answers, mix, tuned knob values, part comments), plain comments, and the variants accepted/archived. 0 is a non-blocking check.",
    params: {
      session: { t: "string", d: "Session id returned by publish_mock", req: true },
      timeoutSeconds: { t: "number", d: "Seconds to wait; 0 checks only" },
    },
    httpOnly: ["session"],
  },
  {
    name: "reply_to_user",
    description: "Post a short plain-text message in a mock's thread. Read userFeedback.",
    params: {
      ...VARIANT_REF,
      message: { t: "string", d: "Plain-text reply", req: true },
      session: P.session,
    },
    httpOnly: ["session"],
  },
  {
    name: "export_mock",
    description:
      "The accepted (or current) html per state, version history, screenshot URL, knobs and the last reply's tuned values.",
    params: VARIANT_REF,
  },
  {
    name: "upload_asset",
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
    name: "get_design_guide",
    description:
      "Fetch HTML fragment, sizing, theme, kit, CDN, parts and knobs guidance. Not needed for non-HTML kinds.",
    params: { project: P.project },
  },
  {
    name: "add_surface",
    description:
      "Insert one surface into a variant; before/after take an id or 0-based index. Read userFeedback.",
    params: {
      ...VARIANT_REF,
      surface: { t: "surface", req: true },
      before: { t: "string", d: field.target },
      after: { t: "string", d: field.target },
    },
  },
  {
    name: "edit_surface",
    description:
      "Replace one surface of a variant by id/index, or pass content to keep its kind options. Read userFeedback.",
    params: {
      ...VARIANT_REF,
      target: P.target,
      surface: { t: "surface" },
      content: { t: "string", d: "New content for the existing kind" },
      parts: { t: "object", d: 'Html only: {"name"|"name#key": outer html}; splices parts' },
      kits: { t: "object", d: field.kits },
    },
  },
  {
    name: "remove_surface",
    description:
      "Remove one surface of a variant by id/index; a variant keeps at least one. Read userFeedback.",
    params: { ...VARIANT_REF, target: P.target },
  },
  {
    name: "reorder_surfaces",
    description:
      "Reorder every surface of a variant by id or 0-based index; order length must match. Read userFeedback.",
    params: {
      ...VARIANT_REF,
      order: { t: "order", d: "All surface ids or 0-based indexes in desired order", req: true },
    },
  },
];

// edit_surface's kits is a string list, not a free object.
const KITS_PARAM_JSON = { type: "array", items: { type: "string" }, description: field.kits };

export const HTTP_MCP_TOOLS = MCP_TOOL_DEFS.map((tool) => {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, p] of Object.entries(tool.params)) {
    properties[key] = key === "kits" ? KITS_PARAM_JSON : jsonParam(p);
    if (p.req) required.push(key);
  }
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: { type: "object", properties, ...(required.length ? { required } : {}) },
  };
});

export const STDIO_MCP_TOOLS = MCP_TOOL_DEFS.map((tool) => {
  const shape: Record<string, z.ZodTypeAny> = {};
  const params = { ...tool.params, ...tool.stdioExtra };
  for (const [key, p] of Object.entries(params)) {
    if (tool.httpOnly?.includes(key)) continue;
    shape[key] =
      key === "kits"
        ? z.array(z.string()).optional().describe(field.kits)
        : key === "html" && (tool.name === "publish_mock" || tool.name === "revise_mock")
          ? z.string().optional().describe(`${field.html}; or a file path`)
          : zodParam(p);
  }
  return { name: tool.name, description: tool.description, inputSchema: shape };
});

export const MCP_TOOL_NAMES = MCP_TOOL_DEFS.map((t) => t.name);
