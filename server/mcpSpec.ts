import { z } from "zod";
import { KIT_IDS } from "./kits.ts";
import { SURFACE_KINDS, type SurfaceKind } from "./types.ts";

export const MCP_SERVER_INFO = { name: "sideshow", version: "0.1.0" };

// The `kind` enum both MCP transports advertise — derived from the one canonical
// list (types.ts) so the MCP tier can never again fall behind what REST/CLI
// accept. Non-empty tuple cast so z.enum keeps the literal union.
const PART_KIND_ENUM = [...SURFACE_KINDS] as [SurfaceKind, ...SurfaceKind[]];

export const MCP_INSTRUCTIONS =
  "Sideshow shows design work to the operator: project > item > variant > version. Publish a " +
  "variant with publish_item, iterate with revise_item, ask with ask_user, then wait_for_feedback " +
  "for one batched decision. Read state with list_items/get_item (bodies are opt-in). Read " +
  "userFeedback in write results; comments are delivered once. Fetch get_design_guide before html.";

const field = {
  title: "Short card title",
  session: "Session id from a previous publish; omit on the first",
  sessionTitle: "Task name for a new session; honored only when the publish creates it",
  agent: "Agent name for a new session",
  postId: "Post id returned by publish_post",
  target: "Surface id or 0-based index",
  html: "HTML body fragment; no doctype/html/head/body",
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

const MCP_SURFACE_JSON_SCHEMA = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: PART_KIND_ENUM,
    },
    html: { type: "string" },
    kits: { type: "array", items: { type: "string" } },
    markdown: { type: "string" },
    mermaid: { type: "string" },
    patch: { type: "string" },
    files: {
      type: "array",
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
    assetId: { type: "string" },
    alt: { type: "string" },
    caption: { type: "string" },
    title: { type: "string" },
    text: { type: "string" },
    cols: { type: "number" },
    data: {},
    code: { type: "string" },
    language: { type: "string" },
    lineStart: { type: "number" },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          kind: { type: "string" },
          detail: { type: "string" },
          ts: { type: "string" },
        },
        required: ["label"],
      },
    },
  },
  required: ["kind"],
} as const;

const MCP_DOCUMENTED_SURFACE_JSON_SCHEMA = {
  ...MCP_SURFACE_JSON_SCHEMA,
  description: MCP_SURFACE_DESCRIPTION,
  properties: {
    ...MCP_SURFACE_JSON_SCHEMA.properties,
    html: { type: "string", description: field.html },
    kits: {
      type: "array",
      items: { type: "string" },
      description: field.kits,
    },
    markdown: { type: "string", description: field.markdown },
    mermaid: { type: "string", description: field.mermaid },
    patch: { type: "string", description: field.patch },
    files: { ...MCP_SURFACE_JSON_SCHEMA.properties.files, description: field.files },
    assetId: { type: "string", description: field.assetId },
    text: { type: "string", description: field.text },
    cols: { type: "number", description: field.cols },
    data: { description: field.data },
    code: { type: "string", description: field.code },
    language: { type: "string", description: field.language },
    lineStart: { type: "number", description: field.lineStart },
  },
} as const;

const MCP_SURFACES_JSON_SCHEMA = {
  type: "array",
  items: MCP_SURFACE_JSON_SCHEMA,
} as const;

const MCP_DOCUMENTED_SURFACES_JSON_SCHEMA = {
  type: "array",
  description: "Ordered surfaces; combine kinds in one card",
  items: MCP_DOCUMENTED_SURFACE_JSON_SCHEMA,
} as const;

// project › item › variant › version. These fields are spelled the same on the
// CLI, so one vocabulary covers all three tiers.
const itemField = {
  project: "Project name; omit for the session's",
  slug: "Item slug, e.g. pricing-card",
  variant: 'Variant label; default "default"',
  kind: "component or page",
  from: "Branch from this version instead of the latest",
  prompt: "What prompted this version; usually omit",
  html: "HTML body fragment; no doctype/html/head/body",
} as const;

// One shared surface definition per tool, referenced rather than inlined — the
// item tools take the same surfaces as publish_post without repeating the
// schema in every advertised tool.
// The item tools' surface definition omits the experimental trace fields: items
// are the product-facing taxonomy, and every advertised byte is agent context.
const { steps: _traceSteps, ...ITEM_SURFACE_PROPERTIES } = MCP_SURFACE_JSON_SCHEMA.properties;
const surfaceDefs = {
  surface: { ...MCP_SURFACE_JSON_SCHEMA, properties: ITEM_SURFACE_PROPERTIES },
} as const;
const surfaceRef = { $ref: "#/$defs/surface" } as const;
const itemSurfaces = { type: "array", items: surfaceRef } as const;

export const MCP_TOOL_DESCRIPTIONS = {
  publishPostHttp:
    "Publish ordered surfaces as one post. Returns post id, URL, sessionId, and surface ids; reuse sessionId. Set sessionTitle on the first publish. Read userFeedback.",
  publishPostStdio:
    "Publish ordered surfaces as one post. Returns post id, URL, and surface ids. Set sessionTitle on the first publish. Read userFeedback.",
  updatePost:
    "Revise a post in place rather than publishing a duplicate. Pass title and/or replacement surfaces in the publish_post shape. Read userFeedback.",
  listPostsHttp: "List posts, optionally scoped by session. Metadata only, no bodies.",
  listPostsStdio:
    "List posts in this conversation. Returns surface id/kind/index metadata without bodies.",
  getPost:
    "Get one post with surface ids/indexes and version; use before targeted edits or after compaction.",
  publishSurfaceHttp:
    "Deprecated publish_post alias; pass the same surface shape as parts. Read userFeedback.",
  publishSurfaceStdio:
    "Deprecated publish_post alias; pass the same surface shape as parts. Read userFeedback.",
  updateSurface:
    "Deprecated update_post alias; pass replacement surfaces as parts. Read userFeedback.",
  publishSnippet:
    "Deprecated HTML-only publish_post sugar. Send a body fragment in html. Read userFeedback.",
  updateSnippet: "Deprecated HTML-only update_post sugar. Read userFeedback.",
  waitForFeedback:
    "Wait up to 300 seconds for one batched operator request: {project, slug, variant, version, decision, comments, archived}. 0 is a non-blocking check.",
  publishItem:
    "Publish a variant of an item. An existing (project, slug, variant) becomes a new version; anything else creates it. Read userFeedback.",
  reviseItem:
    "Publish the next version of an existing variant; from branches off an earlier one. Read userFeedback.",
  askUser:
    "Mark an item as waiting on the operator and ask one question. Follow with wait_for_feedback.",
  listItems: "List a project's items: slug, kind, variants, and what is waiting. No bodies.",
  getItem: "One item's metadata and variants. Bodies and version rows are opt-in.",
  exportItem: "The accepted html, version, prompt history, and screenshot URL for one variant.",
  initProject:
    "Detect this repo's design system, store its palette/kit/icons on the project, and write .sideshow/starter.html. Run once per repo.",
  replyToUser:
    "Post a short plain-text reply using postId (surfaceId is deprecated). Read userFeedback.",
  listSurfacesHttp: "Deprecated list_posts alias.",
  listSurfacesStdio: "Deprecated list_posts alias.",
  uploadAsset:
    "Upload base64 bytes and return id and URL. Reference id as image assetId; pass the publish session for grouping.",
  uploadAssetStdio:
    "Upload base64 bytes and return id and URL. Reference id as image assetId; it attaches to this conversation.",
  getDesignGuide:
    "Fetch HTML fragment, sizing, theme, kit, CDN, and interactivity guidance. Not needed for non-HTML kinds.",
  sendTestPost:
    "Publish the built-in welcome post to test a connection; idempotent, returns the existing post if already sent.",
  addSurface:
    "Insert one publish_post-shaped surface; before/after take an id or 0-based index. Read userFeedback.",
  editSurface:
    "Replace one surface by id/index, or pass content to keep its kind options. Read userFeedback.",
  removeSurface:
    "Remove one surface by id/index; a post must retain at least one. Read userFeedback.",
  reorderSurfaces:
    "Reorder every surface by id or 0-based index; order length must match. Read userFeedback.",
} as const;

export const HTTP_MCP_TOOLS = [
  {
    name: "publish_post",
    description: MCP_TOOL_DESCRIPTIONS.publishPostHttp,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: field.title },
        surfaces: MCP_DOCUMENTED_SURFACES_JSON_SCHEMA,
        session: { type: "string", description: field.session },
        sessionTitle: { type: "string", description: field.sessionTitle },
        agent: { type: "string", description: field.agent },
      },
      required: ["title", "surfaces"],
    },
  },
  {
    name: "update_post",
    description: MCP_TOOL_DESCRIPTIONS.updatePost,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: field.postId },
        surfaces: MCP_SURFACES_JSON_SCHEMA,
        title: { type: "string", description: "Replacement card title" },
      },
      required: ["id"],
    },
  },
  {
    name: "list_posts",
    description: MCP_TOOL_DESCRIPTIONS.listPostsHttp,
    inputSchema: {
      type: "object",
      properties: { session: { type: "string", description: "Optional session scope" } },
    },
  },
  {
    name: "get_post",
    description: MCP_TOOL_DESCRIPTIONS.getPost,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: field.postId },
        history: {
          type: "string",
          enum: ["meta", "full"],
          description: "History detail: metadata only (default) or full surface bodies per version",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "publish_item",
    description: MCP_TOOL_DESCRIPTIONS.publishItem,
    inputSchema: {
      type: "object",
      $defs: surfaceDefs,
      properties: {
        slug: { type: "string", description: itemField.slug },
        project: { type: "string", description: itemField.project },
        variant: { type: "string", description: itemField.variant },
        kind: { type: "string", enum: ["component", "page"], description: itemField.kind },
        title: { type: "string", description: field.title },
        html: { type: "string", description: itemField.html },
        surfaces: itemSurfaces,
        from: { type: "number", description: itemField.from },
        prompt: { type: "string", description: itemField.prompt },
        session: { type: "string", description: field.session },
        sessionTitle: { type: "string", description: field.sessionTitle },
      },
      required: ["slug"],
    },
  },
  {
    name: "revise_item",
    description: MCP_TOOL_DESCRIPTIONS.reviseItem,
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: itemField.slug },
        project: { type: "string", description: itemField.project },
        variant: { type: "string", description: itemField.variant },
        html: { type: "string", description: itemField.html },
        from: { type: "number", description: itemField.from },
        prompt: { type: "string", description: itemField.prompt },
      },
      required: ["slug"],
    },
  },
  {
    name: "ask_user",
    description: MCP_TOOL_DESCRIPTIONS.askUser,
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: itemField.slug },
        project: { type: "string", description: itemField.project },
        variant: { type: "string", description: itemField.variant },
        text: { type: "string", description: "The question, one sentence" },
      },
      required: ["slug", "text"],
    },
  },
  {
    name: "list_items",
    description: MCP_TOOL_DESCRIPTIONS.listItems,
    inputSchema: {
      type: "object",
      properties: { project: { type: "string", description: itemField.project } },
    },
  },
  {
    name: "get_item",
    description: MCP_TOOL_DESCRIPTIONS.getItem,
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: itemField.slug },
        project: { type: "string", description: itemField.project },
        variant: { type: "string", description: itemField.variant },
        body: { type: "boolean", description: "Include the current html body" },
        history: { type: "boolean", description: "Include version rows" },
      },
      required: ["slug"],
    },
  },
  {
    name: "export_item",
    description: MCP_TOOL_DESCRIPTIONS.exportItem,
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: itemField.slug },
        project: { type: "string", description: itemField.project },
        variant: { type: "string", description: itemField.variant },
      },
      required: ["slug"],
    },
  },
  {
    name: "wait_for_feedback",
    description: MCP_TOOL_DESCRIPTIONS.waitForFeedback,
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Session id returned by publish_post" },
        afterSeq: {
          type: "number",
          description: "Explicit shared-cursor override; usually omit",
        },
        timeoutSeconds: { type: "number", description: "Seconds to wait; 0 checks only" },
      },
      required: ["session"],
    },
  },
  {
    name: "reply_to_user",
    description: MCP_TOOL_DESCRIPTIONS.replyToUser,
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: field.postId },
        surfaceId: { type: "string", description: "Deprecated alias of postId" },
        message: { type: "string", description: "Plain-text reply" },
      },
      required: ["message"],
    },
  },
  {
    name: "upload_asset",
    description: MCP_TOOL_DESCRIPTIONS.uploadAsset,
    inputSchema: {
      type: "object",
      properties: {
        data: { type: "string", description: "Base64 file bytes" },
        contentType: { type: "string", description: "MIME type, e.g. image/png" },
        filename: { type: "string", description: "Original download filename" },
        kind: { type: "string", enum: ["image", "trace", "file"] },
        session: { type: "string", description: "Session to own the asset" },
      },
      required: ["data", "contentType"],
    },
  },
  {
    name: "get_design_guide",
    description: MCP_TOOL_DESCRIPTIONS.getDesignGuide,
    inputSchema: {
      type: "object",
      properties: { project: { type: "string", description: itemField.project } },
    },
  },
  {
    name: "send_test_post",
    description: MCP_TOOL_DESCRIPTIONS.sendTestPost,
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", description: field.agent },
      },
    },
  },
  {
    name: "add_surface",
    description: MCP_TOOL_DESCRIPTIONS.addSurface,
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: field.postId },
        surface: MCP_SURFACE_JSON_SCHEMA,
        before: { type: "string", description: field.target },
        after: { type: "string", description: field.target },
      },
      required: ["postId", "surface"],
    },
  },
  {
    name: "edit_surface",
    description: MCP_TOOL_DESCRIPTIONS.editSurface,
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: field.postId },
        target: { type: "string", description: field.target },
        surface: MCP_SURFACE_JSON_SCHEMA,
        content: { type: "string", description: "New content for the existing kind" },
        kits: { type: "array", items: { type: "string" } },
      },
      required: ["postId", "target"],
    },
  },
  {
    name: "remove_surface",
    description: MCP_TOOL_DESCRIPTIONS.removeSurface,
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: field.postId },
        target: { type: "string", description: field.target },
      },
      required: ["postId", "target"],
    },
  },
  {
    name: "reorder_surfaces",
    description: MCP_TOOL_DESCRIPTIONS.reorderSurfaces,
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: field.postId },
        order: {
          type: "array",
          items: { oneOf: [{ type: "string" }, { type: "number" }] },
          description: "All surface ids or 0-based indexes in desired order",
        },
      },
      required: ["postId", "order"],
    },
  },
] as const;

// Retired spellings. Byte-identical to what they always were — they stay
// callable forever, but they are omitted from tools/list unless
// SIDESHOW_MCP_LEGACY=1, so a fresh agent never pays for them.
export const DEPRECATED_HTTP_MCP_TOOLS = [
  {
    name: "publish_surface",
    description: MCP_TOOL_DESCRIPTIONS.publishSurfaceHttp,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        parts: MCP_SURFACES_JSON_SCHEMA,
        session: { type: "string" },
        sessionTitle: { type: "string" },
        agent: { type: "string" },
      },
      required: ["title", "parts"],
    },
  },
  {
    name: "update_surface",
    description: MCP_TOOL_DESCRIPTIONS.updateSurface,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        parts: MCP_SURFACES_JSON_SCHEMA,
        title: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "publish_snippet",
    description: MCP_TOOL_DESCRIPTIONS.publishSnippet,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        html: { type: "string" },
        kits: { type: "array", items: { type: "string" } },
        session: { type: "string" },
        sessionTitle: { type: "string" },
        agent: { type: "string" },
      },
      required: ["title", "html"],
    },
  },
  {
    name: "update_snippet",
    description: MCP_TOOL_DESCRIPTIONS.updateSnippet,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        html: { type: "string" },
        kits: { type: "array", items: { type: "string" } },
        title: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "list_surfaces",
    description: MCP_TOOL_DESCRIPTIONS.listSurfacesHttp,
    inputSchema: {
      type: "object",
      properties: { session: { type: "string" } },
    },
  },
] as const;

export const DEPRECATED_MCP_TOOL_NAMES = new Set([
  "publish_surface",
  "update_surface",
  "publish_snippet",
  "update_snippet",
  "list_surfaces",
  "list_snippets",
]);

// Whether a transport advertises the retired spellings. Reads the environment
// defensively: there is no `process` on the Worker runtime.
export function includeLegacyMcpTools(): boolean {
  return (globalThis as any).process?.env?.SIDESHOW_MCP_LEGACY === "1";
}

// The batch an agent gets back from a wait or a piggybacked write: one entry per
// post, decisions separated from plain comments, in delivery order.
export interface FeedbackBatch {
  project: string | null;
  slug: string | null;
  variant: string | null;
  version: number | null;
  decision: { kind: string; text: string } | null;
  comments: {
    seq: number;
    text: string;
    anchors?: unknown[];
    viewport?: number;
    version?: number;
  }[];
  archived: string[];
}

export function toFeedbackBatches(comments: any[]): FeedbackBatch[] {
  const groups = new Map<string, FeedbackBatch>();
  for (const c of comments ?? []) {
    const key = String(c.postId ?? "");
    let batch = groups.get(key);
    if (!batch) {
      batch = {
        project: c.project ?? null,
        slug: c.slug ?? null,
        variant: c.variant ?? null,
        version: c.postVersion ?? null,
        decision: null,
        comments: [],
        archived: [],
      };
      groups.set(key, batch);
    }
    if (c.kind === "accept" || c.kind === "revise" || c.kind === "drop") {
      batch.decision = { kind: c.kind, text: c.text ?? "" };
      continue;
    }
    batch.comments.push({
      seq: c.seq,
      text: c.text,
      ...(c.anchors?.length && { anchors: c.anchors }),
      ...(c.viewport != null && { viewport: c.viewport }),
      ...(c.postVersion != null && { version: c.postVersion }),
    });
  }
  return [...groups.values()];
}

const diffFileSchema = z.object({
  filename: z.string(),
  before: z.string(),
  after: z.string(),
  language: z.string().optional(),
});

const traceStepSchema = z.object({
  label: z.string(),
  kind: z.string().optional(),
  detail: z.string().optional(),
  ts: z.string().optional(),
});

const mcpSurfaceSchema = z.object({
  kind: z.enum(PART_KIND_ENUM),
  html: z.string().optional(),
  kits: z.array(z.string()).optional(),
  markdown: z.string().optional(),
  mermaid: z.string().optional(),
  patch: z.string().optional(),
  files: z.array(diffFileSchema).optional(),
  layout: z.enum(["unified", "split"]).optional(),
  assetId: z.string().optional(),
  alt: z.string().optional(),
  caption: z.string().optional(),
  title: z.string().optional(),
  steps: z.array(traceStepSchema).optional(),
  text: z.string().optional(),
  cols: z.number().optional(),
  data: z.unknown().optional(),
  code: z.string().optional(),
  language: z.string().optional(),
  lineStart: z.number().int().min(1).optional(),
});

const documentedMcpSurfaceSchema = mcpSurfaceSchema
  .extend({
    html: z.string().optional().describe(field.html),
    kits: z.array(z.string()).optional().describe(field.kits),
    markdown: z.string().optional().describe(field.markdown),
    mermaid: z.string().optional().describe(field.mermaid),
    patch: z.string().optional().describe(field.patch),
    files: z.array(diffFileSchema).optional().describe(field.files),
    assetId: z.string().optional().describe(field.assetId),
    text: z.string().optional().describe(field.text),
    cols: z.number().optional().describe(field.cols),
    data: z.unknown().optional().describe(field.data),
    code: z.string().optional().describe(field.code),
    language: z.string().optional().describe(field.language),
    lineStart: z.number().int().min(1).optional().describe(field.lineStart),
  })
  .describe(MCP_SURFACE_DESCRIPTION);

export const STDIO_MCP_INPUT_SCHEMAS = {
  publishPost: {
    title: z.string().describe(field.title),
    surfaces: z
      .array(documentedMcpSurfaceSchema)
      .describe("Ordered surfaces; combine kinds in one card"),
    sessionTitle: z.string().optional().describe(field.sessionTitle),
  },
  updatePost: {
    id: z.string().describe(field.postId),
    surfaces: z.array(mcpSurfaceSchema).optional(),
    title: z.string().optional().describe("Replacement card title"),
  },
  getPost: {
    id: z.string().describe(field.postId),
    history: z
      .enum(["meta", "full"])
      .optional()
      .describe("History detail: metadata only (default) or full surface bodies per version"),
  },
  // Over stdio the agent shares a filesystem with the server, so `html` may be
  // a path — the markup never has to pass through the model's context.
  publishItem: {
    slug: z.string().describe(itemField.slug),
    project: z.string().optional().describe(itemField.project),
    variant: z.string().optional().describe(itemField.variant),
    kind: z.enum(["component", "page"]).optional().describe(itemField.kind),
    title: z.string().optional().describe(field.title),
    html: z.string().optional().describe(`${itemField.html}, or a file path`),
    from: z.number().int().optional().describe(itemField.from),
    prompt: z.string().optional().describe(itemField.prompt),
    sessionTitle: z.string().optional().describe(field.sessionTitle),
  },
  reviseItem: {
    slug: z.string().describe(itemField.slug),
    project: z.string().optional().describe(itemField.project),
    variant: z.string().optional().describe(itemField.variant),
    html: z.string().optional().describe(`${itemField.html}, or a file path`),
    from: z.number().int().optional().describe(itemField.from),
    prompt: z.string().optional().describe(itemField.prompt),
  },
  askUser: {
    slug: z.string().describe(itemField.slug),
    project: z.string().optional().describe(itemField.project),
    variant: z.string().optional().describe(itemField.variant),
    text: z.string().describe("The question, one sentence"),
  },
  listItems: { project: z.string().optional().describe(itemField.project) },
  getItem: {
    slug: z.string().describe(itemField.slug),
    project: z.string().optional().describe(itemField.project),
    variant: z.string().optional().describe(itemField.variant),
    body: z.boolean().optional().describe("Include the current html body"),
    history: z.boolean().optional().describe("Include version rows"),
  },
  exportItem: {
    slug: z.string().describe(itemField.slug),
    project: z.string().optional().describe(itemField.project),
    variant: z.string().optional().describe(itemField.variant),
  },
  initProject: { project: z.string().optional().describe(itemField.project) },
  getDesignGuide: { project: z.string().optional().describe(itemField.project) },
  waitForFeedback: {
    timeoutSeconds: z
      .number()
      .min(0)
      .max(300)
      .optional()
      .describe("Seconds to wait; 0 checks only"),
  },
  replyToUser: {
    postId: z.string().optional().describe(field.postId),
    surfaceId: z.string().optional().describe("Deprecated alias of postId"),
    message: z.string().describe("Plain-text reply"),
  },
  uploadAsset: {
    path: z.string().optional().describe("Local file path; use instead of data"),
    data: z.string().optional().describe("Base64 file bytes"),
    contentType: z.string().optional().describe("MIME type; inferred from path"),
    filename: z.string().optional().describe("Original download filename"),
    kind: z.enum(["image", "trace", "file"]).optional(),
  },
  addSurface: {
    postId: z.string().describe(field.postId),
    surface: mcpSurfaceSchema,
    before: z.string().optional().describe(field.target),
    after: z.string().optional().describe(field.target),
  },
  editSurface: {
    postId: z.string().describe(field.postId),
    target: z.string().describe(field.target),
    surface: mcpSurfaceSchema.optional(),
    content: z.string().optional().describe("New content for the existing kind"),
    kits: z.array(z.string()).optional(),
  },
  removeSurface: {
    postId: z.string().describe(field.postId),
    target: z.string().describe(field.target),
  },
  reorderSurfaces: {
    postId: z.string().describe(field.postId),
    order: z
      .array(z.union([z.string(), z.number()]))
      .describe("All surface ids or 0-based indexes in desired order"),
  },
} as const;

// The retired stdio spellings, kept exactly as they were. Split out of
// STDIO_MCP_INPUT_SCHEMAS because they are no longer advertised by default.
export const DEPRECATED_STDIO_MCP_INPUT_SCHEMAS = {
  publishSurface: {
    title: z.string(),
    parts: z.array(mcpSurfaceSchema),
    sessionTitle: z.string().optional(),
  },
  updateSurface: {
    id: z.string(),
    parts: z.array(mcpSurfaceSchema).optional(),
    title: z.string().optional(),
  },
  publishSnippet: {
    title: z.string(),
    html: z.string(),
    kits: z.array(z.string()).optional(),
    sessionTitle: z.string().optional(),
  },
  updateSnippet: {
    id: z.string(),
    html: z.string().optional(),
    kits: z.array(z.string()).optional(),
    title: z.string().optional(),
  },
} as const;
