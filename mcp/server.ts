#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { feedbackView, mcpPostListRowView } from "../server/apiViews.ts";
import {
  DEPRECATED_MCP_TOOL_NAMES,
  DEPRECATED_STDIO_MCP_INPUT_SCHEMAS,
  includeLegacyMcpTools,
  MCP_INSTRUCTIONS,
  MCP_SERVER_INFO,
  MCP_TOOL_DESCRIPTIONS,
  STDIO_MCP_INPUT_SCHEMAS,
  toFeedbackBatches,
} from "../server/mcpSpec.ts";

// Point at a deployed instance later by setting SIDESHOW_URL.
const API = process.env.SIDESHOW_URL ?? "http://localhost:8228";
const TOKEN = process.env.SIDESHOW_TOKEN;
const AGENT = process.env.SIDESHOW_AGENT ?? "claude-code";

async function api(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { ...init, headers });
  } catch {
    throw new Error(
      `sideshow server not reachable at ${API} — ask the user to start it with "sideshow serve" or "npm run dev"`,
    );
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text}`);
  return text;
}

const text = (value: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});

// Stdio runs on the agent's machine, so a value may name a file: markup and
// asset bytes never have to travel through the model's context.
function readMaybeFile(value: string): string {
  if (value.includes("\n") || value.length > 512) return value;
  try {
    if (statSync(value).isFile()) return readFileSync(value, "utf8");
  } catch {
    // not a path — it is the content itself
  }
  return value;
}

// The project this repo is: explicit, environment, git remote, then directory
// name. Same order as the CLI, so both tiers land in the same project.
function resolveProject(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.SIDESHOW_PROJECT) return process.env.SIDESHOW_PROJECT;
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const m = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/);
    if (m) return `${m[1]}/${m[2]}`;
  } catch {
    // not a git checkout
  }
  return process.cwd().split(/[\\/]/).filter(Boolean).pop() ?? "workspace";
}

const ASSET_CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  json: "application/json",
  txt: "text/plain",
  csv: "text/csv",
  pdf: "application/pdf",
};

const contentTypeForPath = (file: string) =>
  ASSET_CONTENT_TYPES[file.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

const projectPath = (project: string) => `/api/projects/${encodeURIComponent(project)}`;

// One MCP server process lives as long as one agent conversation, so a
// lazily-created session shared across tool calls maps cleanly onto it.
let sessionId: string | null = process.env.SIDESHOW_SESSION ?? null;

// `title` is used only when this call creates the session — once one exists
// (here or in the viewer, where the user can rename it) it is never retitled.
async function ensureSession(title?: string): Promise<string> {
  if (sessionId) return sessionId;
  const session = JSON.parse(
    await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        agent: AGENT,
        cwd: process.cwd(),
        title,
        project: resolveProject(),
      }),
    }),
  );
  sessionId = session.id as string;
  return sessionId;
}

const server = new McpServer(MCP_SERVER_INFO, { instructions: MCP_INSTRUCTIONS });

server.registerTool(
  "publish_post",
  {
    description: MCP_TOOL_DESCRIPTIONS.publishPostStdio,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.publishPost,
  },
  async ({ title, surfaces, sessionTitle }) => {
    const session = await ensureSession(sessionTitle);
    const created = JSON.parse(
      await api("/api/posts", {
        method: "POST",
        body: JSON.stringify({ title, surfaces, session }),
      }),
    );
    return text({ ...created, url: `${API}/p/${created.id}` });
  },
);

server.registerTool(
  "update_post",
  {
    description: MCP_TOOL_DESCRIPTIONS.updatePost,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.updatePost,
  },
  async ({ id, surfaces, title }) => {
    const updated = JSON.parse(
      await api(`/api/posts/${id}`, { method: "PUT", body: JSON.stringify({ surfaces, title }) }),
    );
    return text({ ...updated, url: `${API}/p/${updated.id}` });
  },
);

server.registerTool(
  "list_posts",
  { description: MCP_TOOL_DESCRIPTIONS.listPostsStdio, inputSchema: {} },
  async () => {
    if (!sessionId) return text([]);
    const rows = JSON.parse(await api(`/api/sessions/${sessionId}/posts`));
    return text(rows.map(mcpPostListRowView));
  },
);

server.registerTool(
  "get_post",
  {
    description: MCP_TOOL_DESCRIPTIONS.getPost,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.getPost,
  },
  async ({ id, history }) => {
    const query = history === "full" ? "?history=full" : "";
    return text(JSON.parse(await api(`/api/posts/${id}${query}`)));
  },
);

// --- project › item › variant › version -------------------------------------

async function publishItem(args: any, kind?: string) {
  const session = await ensureSession(args.sessionTitle);
  const project = resolveProject(args.project);
  const surfaces =
    typeof args.html === "string"
      ? [{ kind: "html", html: readMaybeFile(args.html) }]
      : (args.surfaces ?? []);
  if (surfaces.length === 0) throw new Error("an item needs html or surfaces");
  const post = JSON.parse(
    await api("/api/posts", {
      method: "POST",
      body: JSON.stringify({
        session,
        project,
        slug: args.slug,
        variant: args.variant,
        kind: kind ?? args.kind ?? "component",
        title: args.title,
        from: args.from,
        prompt: args.prompt,
        surfaces,
      }),
    }),
  );
  return text({
    project,
    slug: post.slug ?? args.slug,
    variant: post.variant ?? args.variant ?? "default",
    version: post.version,
    url: `${API}/project/${encodeURIComponent(project)}/${post.slug ?? args.slug}`,
    ...(post.userFeedback && { userFeedback: post.userFeedback }),
  });
}

async function fetchItem(project: string, slug: string) {
  const item = JSON.parse(await api(`${projectPath(project)}/items/${encodeURIComponent(slug)}`));
  if (!item) throw new Error(`${project} has no item "${slug}"`);
  return item;
}

function chooseVariant(item: any, wanted?: string) {
  const variants = item.variants ?? [];
  if (wanted) {
    const found = variants.find((v: any) => v.variant === wanted);
    if (!found) throw new Error(`${item.slug} has no variant "${wanted}"`);
    return found;
  }
  if (variants.length === 1) return variants[0];
  throw new Error(
    `${item.slug} has ${variants.length} variants; pass variant: ${variants
      .map((v: any) => v.variant)
      .join("|")}`,
  );
}

// Bodies are the expensive part of an item, so history rows carry metadata only.
const historyMeta = (history: any[] | undefined) =>
  (history ?? []).map((h) => ({
    version: h.version,
    ...(h.from !== undefined && { from: h.from }),
    ...(h.prompt && { prompt: h.prompt }),
  }));

server.registerTool(
  "publish_item",
  {
    description: MCP_TOOL_DESCRIPTIONS.publishItem,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.publishItem,
  },
  (args) => publishItem(args),
);

server.registerTool(
  "revise_item",
  {
    description: MCP_TOOL_DESCRIPTIONS.reviseItem,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.reviseItem,
  },
  (args) => publishItem(args),
);

server.registerTool(
  "ask_user",
  { description: MCP_TOOL_DESCRIPTIONS.askUser, inputSchema: STDIO_MCP_INPUT_SCHEMAS.askUser },
  async ({ slug, project, variant, text: question }) => {
    const name = resolveProject(project);
    const item = await fetchItem(name, slug);
    const chosen = chooseVariant(item, variant);
    const post = JSON.parse(
      await api(`/api/posts/${chosen.postId}/ask`, {
        method: "POST",
        body: JSON.stringify({ text: question }),
      }),
    );
    return text({
      project: name,
      slug: item.slug,
      variant: chosen.variant,
      version: post.version ?? chosen.version,
      ask: question,
    });
  },
);

server.registerTool(
  "list_items",
  { description: MCP_TOOL_DESCRIPTIONS.listItems, inputSchema: STDIO_MCP_INPUT_SCHEMAS.listItems },
  async ({ project }) => {
    const name = resolveProject(project);
    return text({ project: name, items: JSON.parse(await api(`${projectPath(name)}/items`)) });
  },
);

server.registerTool(
  "get_item",
  { description: MCP_TOOL_DESCRIPTIONS.getItem, inputSchema: STDIO_MCP_INPUT_SCHEMAS.getItem },
  async ({ slug, project, variant, body, history }) => {
    const name = resolveProject(project);
    const item = await fetchItem(name, slug);
    const variants = (item.variants ?? [])
      .filter((v: any) => !variant || v.variant === variant)
      .map((v: any) => ({
        variant: v.variant,
        version: v.version,
        status: v.status,
        ask: v.ask,
        ...(history && { history: historyMeta(v.history) }),
        ...(body && {
          html: (v.surfaces ?? []).find((s: any) => s.kind === "html")?.html ?? "",
        }),
      }));
    return text({ project: name, slug: item.slug, kind: item.kind, variants });
  },
);

server.registerTool(
  "export_item",
  {
    description: MCP_TOOL_DESCRIPTIONS.exportItem,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.exportItem,
  },
  async ({ slug, project, variant }) => {
    const name = resolveProject(project);
    const item = await fetchItem(name, slug);
    const chosen = chooseVariant(item, variant);
    const params = new URLSearchParams({ variant: chosen.variant });
    return text(
      JSON.parse(
        await api(`${projectPath(name)}/items/${encodeURIComponent(item.slug)}/export?${params}`),
      ),
    );
  },
);

// Stdio only: init touches this repo's files, so it runs where the agent runs.
// It shells out to the CLI rather than duplicating the steps.
server.registerTool(
  "init_project",
  {
    description: MCP_TOOL_DESCRIPTIONS.initProject,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.initProject,
  },
  async ({ project }) => {
    const cli = fileURLToPath(new URL("../bin/sideshow.js", import.meta.url));
    const args = ["init", "--json", ...(project ? ["--project", project] : [])];
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      env: process.env,
    });
    try {
      return text(JSON.parse(stdout));
    } catch {
      return text(stdout.trim());
    }
  },
);

server.registerTool(
  "publish_surface",
  {
    description: MCP_TOOL_DESCRIPTIONS.publishSurfaceStdio,
    inputSchema: DEPRECATED_STDIO_MCP_INPUT_SCHEMAS.publishSurface,
  },
  async ({ title, parts, sessionTitle }) => {
    const session = await ensureSession(sessionTitle);
    const created = JSON.parse(
      await api("/api/posts", {
        method: "POST",
        body: JSON.stringify({ title, surfaces: parts, session }),
      }),
    );
    return text({ ...created, url: `${API}/p/${created.id}` });
  },
);

server.registerTool(
  "update_surface",
  {
    description: MCP_TOOL_DESCRIPTIONS.updateSurface,
    inputSchema: DEPRECATED_STDIO_MCP_INPUT_SCHEMAS.updateSurface,
  },
  async ({ id, parts, title }) => {
    const updated = JSON.parse(
      await api(`/api/posts/${id}`, {
        method: "PUT",
        body: JSON.stringify({ surfaces: parts, title }),
      }),
    );
    return text({ ...updated, url: `${API}/p/${updated.id}` });
  },
);

server.registerTool(
  "publish_snippet",
  {
    description: MCP_TOOL_DESCRIPTIONS.publishSnippet,
    inputSchema: DEPRECATED_STDIO_MCP_INPUT_SCHEMAS.publishSnippet,
  },
  async ({ title, html, kits, sessionTitle }) => {
    const session = await ensureSession(sessionTitle);
    const created = JSON.parse(
      await api("/api/posts", {
        method: "POST",
        body: JSON.stringify({ title, surfaces: [{ kind: "html", html, kits }], session }),
      }),
    );
    return text({ ...created, url: `${API}/p/${created.id}` });
  },
);

server.registerTool(
  "update_snippet",
  {
    description: MCP_TOOL_DESCRIPTIONS.updateSnippet,
    inputSchema: DEPRECATED_STDIO_MCP_INPUT_SCHEMAS.updateSnippet,
  },
  async ({ id, html, title, kits }) => {
    const surfaces = html === undefined ? undefined : [{ kind: "html", html, kits }];
    const updated = JSON.parse(
      await api(`/api/posts/${id}`, { method: "PUT", body: JSON.stringify({ surfaces, title }) }),
    );
    return text({ ...updated, url: `${API}/p/${updated.id}` });
  },
);

server.registerTool(
  "wait_for_feedback",
  {
    description: MCP_TOOL_DESCRIPTIONS.waitForFeedback,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.waitForFeedback,
  },
  async ({ timeoutSeconds }) => {
    const session = await ensureSession();
    const wait = timeoutSeconds ?? 120;
    // No client-side cursor: the server resumes author=user reads from the
    // session's agent cursor, shared with piggyback delivery.
    const result = JSON.parse(
      await api(`/api/comments?session=${session}&author=user&wait=${wait}`),
    );
    // The server already returns the batch shape for agent reads (as `feedback`,
    // alongside the legacy comment list); pass it through rather than re-grouping.
    if (Array.isArray(result.feedback)) {
      if (result.feedback.length === 0) {
        return text({ comments: [], note: "no user feedback yet — continue, or wait again later" });
      }
      return text(result.feedback.length === 1 ? result.feedback[0] : result.feedback);
    }
    if (!Array.isArray(result.comments)) return text(result);
    if (result.comments.length === 0) {
      return text({ comments: [], note: "no user feedback yet — continue, or wait again later" });
    }
    // One batch per item: the decision, the comments batched with it, and the
    // sibling variants it archived.
    const batches = toFeedbackBatches(result.comments.map(feedbackView));
    return text(batches.length === 1 ? batches[0] : batches);
  },
);

server.registerTool(
  "reply_to_user",
  {
    description: MCP_TOOL_DESCRIPTIONS.replyToUser,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.replyToUser,
  },
  async ({ postId, surfaceId, message }) => {
    const created = JSON.parse(
      await api("/api/comments", {
        method: "POST",
        body: JSON.stringify({ surface: postId ?? surfaceId, text: message }),
      }),
    );
    return text(created);
  },
);

server.registerTool(
  "list_surfaces",
  { description: MCP_TOOL_DESCRIPTIONS.listSurfacesStdio, inputSchema: {} },
  async () => {
    if (!sessionId) return text([]);
    const rows = JSON.parse(await api(`/api/sessions/${sessionId}/surfaces`));
    return text(rows.map(mcpPostListRowView));
  },
);

server.registerTool(
  "upload_asset",
  {
    description: MCP_TOOL_DESCRIPTIONS.uploadAssetStdio,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.uploadAsset,
  },
  async ({ path, data, contentType, filename, kind }) => {
    const session = await ensureSession();
    // Stdio shares the agent's filesystem, so a path beats base64 in context.
    const bytes = path ? readFileSync(path) : null;
    const created = JSON.parse(
      await api("/api/assets", {
        method: "POST",
        body: JSON.stringify({
          data: bytes ? bytes.toString("base64") : data,
          contentType:
            contentType ?? (path ? contentTypeForPath(path) : "application/octet-stream"),
          filename: filename ?? (path ? path.split(/[\\/]/).pop() : undefined),
          kind,
          session,
        }),
      }),
    );
    return text(created);
  },
);

server.registerTool(
  "get_design_guide",
  {
    description: MCP_TOOL_DESCRIPTIONS.getDesignGuide,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.getDesignGuide,
  },
  async ({ project }) => {
    // The brief guide renders this project's real palette, kit, and icons, so
    // the agent never restates them.
    const params = new URLSearchParams({ brief: "1", project: resolveProject(project) });
    return text(await api(`/agent-howto?${params}`));
  },
);

server.registerTool(
  "send_test_post",
  {
    description: MCP_TOOL_DESCRIPTIONS.sendTestPost,
    inputSchema: {},
  },
  async () => {
    // The server owns the fixed content and the already-sent check; this tool
    // is just the trigger. The welcome card lives in its own "Getting started"
    // session, so the conversation's lazy session is deliberately not used.
    const created = JSON.parse(
      await api("/api/test-post", { method: "POST", body: JSON.stringify({ agent: AGENT }) }),
    );
    return text({ ...created, url: `${API}/p/${created.id}` });
  },
);

server.registerTool(
  "add_surface",
  {
    description: MCP_TOOL_DESCRIPTIONS.addSurface,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.addSurface,
  },
  async ({ postId, surface, before, after }) => {
    const updated = JSON.parse(
      await api(`/api/posts/${postId}/surfaces`, {
        method: "POST",
        body: JSON.stringify({ surface, before, after }),
      }),
    );
    return text({ ...updated, url: `${API}/p/${updated.id}` });
  },
);

server.registerTool(
  "edit_surface",
  {
    description: MCP_TOOL_DESCRIPTIONS.editSurface,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.editSurface,
  },
  async ({ postId, target, surface, content, kits }) => {
    const updated = JSON.parse(
      await api(`/api/posts/${postId}/surfaces/${target}`, {
        method: "PATCH",
        body: JSON.stringify({ surface, content, kits }),
      }),
    );
    return text({ ...updated, url: `${API}/p/${updated.id}` });
  },
);

server.registerTool(
  "remove_surface",
  {
    description: MCP_TOOL_DESCRIPTIONS.removeSurface,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.removeSurface,
  },
  async ({ postId, target }) => {
    const updated = JSON.parse(
      await api(`/api/posts/${postId}/surfaces/${target}`, { method: "DELETE" }),
    );
    return text({ ...updated, url: `${API}/p/${updated.id}` });
  },
);

server.registerTool(
  "reorder_surfaces",
  {
    description: MCP_TOOL_DESCRIPTIONS.reorderSurfaces,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.reorderSurfaces,
  },
  async ({ postId, order }) => {
    const updated = JSON.parse(
      await api(`/api/posts/${postId}/surfaces`, {
        method: "PATCH",
        body: JSON.stringify({ order }),
      }),
    );
    return text({ ...updated, url: `${API}/p/${updated.id}` });
  },
);

// Hidden, not removed: the retired spellings stay callable forever (that is the
// compatibility promise), they just don't appear in tools/list, so a fresh
// conversation doesn't pay context for them. Disabling them would break the
// promise, so the listing is filtered instead.
if (!includeLegacyMcpTools()) {
  const inner = (server.server as any)._requestHandlers.get("tools/list");
  server.server.setRequestHandler(ListToolsRequestSchema, async (request: any, extra: any) => {
    const result = await inner(request, extra);
    return {
      ...result,
      tools: result.tools.filter((tool: any) => !DEPRECATED_MCP_TOOL_NAMES.has(tool.name)),
    };
  });
}

await server.connect(new StdioServerTransport());
