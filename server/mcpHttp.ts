import type { Hono } from "hono";
import type { CommentWait, Feedback } from "./app.ts";
import { buildFeedbackBatches } from "./feedbackBatch.ts";
import { mcpPostListRowView, postDetailView, postWriteView } from "./apiViews.ts";
import { decodeBase64 } from "./base64.ts";
import {
  type Asset,
  type AssetKind,
  type Comment,
  htmlSurface,
  type ItemDetail,
  type Store,
  type Post,
  type Surface,
} from "./types.ts";
import {
  DEPRECATED_HTTP_MCP_TOOLS,
  HTTP_MCP_TOOLS,
  includeLegacyMcpTools,
  MCP_INSTRUCTIONS,
  MCP_SERVER_INFO,
} from "./mcpSpec.ts";
import { coerceSurfaces } from "./postSurfaces.ts";
import {
  findWelcomePost,
  WELCOME_POST_TITLE,
  WELCOME_SESSION_TITLE,
  welcomeSurfaces,
} from "./welcomePost.ts";

// Stateless MCP over streamable HTTP: every request is self-contained, which
// is what a serverless deployment needs. Session continuity is explicit —
// publish_surface returns a sessionId the agent passes back on later calls.

type FlowResult<T> = Promise<
  { post: T; userFeedback?: Feedback[] } | { error: string; status: number }
>;

export interface McpDeps {
  store: Store;
  basePath?: (request: Request) => string;
  publishPost(input: {
    surfaces: Surface[];
    title?: string;
    session?: string;
    sessionTitle?: string;
    agent?: string;
    // project › item › variant: an existing (project, slug, variant) becomes a
    // new version of that post, anything else creates one.
    project?: string;
    slug?: string;
    kind?: string;
    variant?: string;
    from?: number;
    prompt?: string;
  }): FlowResult<Post>;
  revisePost(id: string, patch: { surfaces?: Surface[]; title?: string }): FlowResult<Post>;
  appendPostSurface(
    id: string,
    surface: Surface,
    pos?: { before?: string; after?: string },
  ): FlowResult<Post>;
  replacePostSurface(
    id: string,
    target: string,
    replacement: { surface?: Surface; content?: string; kits?: unknown },
  ): FlowResult<Post>;
  removePostSurface(id: string, target: string): FlowResult<Post>;
  reorderPostSurfaces(id: string, order: (string | number)[]): FlowResult<Post>;
  createComment(input: {
    text: string;
    surface?: string;
  }): Promise<{ comment: Comment; userFeedback?: Feedback[] } | { error: string; status: number }>;
  waitForComments(q: CommentWait): Promise<{ comments: Comment[]; lastSeq: number }>;
  uploadAsset(input: {
    data: Uint8Array;
    contentType: string;
    filename?: string;
    kind?: AssetKind;
    session?: string;
  }): Promise<{ asset: Omit<Asset, "data"> } | { error: string; status: number }>;
  // A static guide, or one rendered for a project (palette, kit, icons).
  guide: string | ((project: string) => string | Promise<string>);
}

// Coerce loosely-typed tool args into a validated Surface[]. Unknown kinds
// and empty surfaces are dropped rather than rejected, so a slightly-off call
// still publishes what it can.
// Deprecated alias retained for older deep imports that used the legacy name.
export const coerceParts = coerceSurfaces;

export function registerMcp(app: Hono, deps: McpDeps) {
  // All tools emit the canonical /p/<id> view URL (the legacy /s/<id> route
  // remains accepted inbound and resolves to the same post page).
  const postResult = (result: { post: Post; userFeedback?: Feedback[] }, origin: string) =>
    JSON.stringify(
      {
        ...postWriteView(result.post),
        url: `${origin}/p/${result.post.id}`,
        ...(result.userFeedback && { userFeedback: result.userFeedback }),
      },
      null,
      2,
    );

  // The item tools read through the Store's project/item methods rather than
  // re-entering the HTTP layer; the writes still go through the shared publish
  // flow so events, feedback piggyback, and validation stay in one place.
  const store = deps.store;

  async function projectOf(args: any): Promise<string> {
    if (typeof args.project === "string" && args.project) return args.project;
    if (typeof args.session === "string") {
      const session = await store.getSession(args.session);
      if (session?.project) return session.project;
    }
    const projects = await store.listProjects();
    return projects[0]?.name ?? "workspace";
  }

  // Which variant a tool call means: explicit wins, a single variant is
  // unambiguous, several without a choice is an error that names them.
  function chooseVariant(item: ItemDetail, wanted: unknown): ItemDetail["variants"][number] {
    const variants = item.variants ?? [];
    if (typeof wanted === "string" && wanted) {
      const found = variants.find((v) => v.variant === wanted);
      if (!found) throw new Error(`${item.slug} has no variant "${wanted}"`);
      return found;
    }
    if (variants.length === 1) return variants[0];
    throw new Error(
      `${item.slug} has ${variants.length} variants; pass variant: ${variants
        .map((v) => v.variant)
        .join("|")}`,
    );
  }

  const htmlOf = (post: any) =>
    (post?.surfaces ?? []).find((s: any) => s.kind === "html")?.html ?? "";

  // History without bodies — the metadata is what an agent reasons about.
  const historyMeta = (history: any[] | undefined) =>
    (history ?? []).map((h) => ({
      version: h.version,
      ...(h.from !== undefined && { from: h.from }),
      ...(h.prompt && { prompt: h.prompt }),
      ...(h.author && { author: h.author }),
      ...(h.updatedAt && { updatedAt: h.updatedAt }),
    }));

  async function publishItem(args: any, origin: string, kind?: string) {
    const slug = String(args.slug ?? "");
    if (!slug) throw new Error("slug is required");
    const project = await projectOf(args);
    // An existing page stays a page across revisions, so its <mockpit-slot>
    // tags keep being re-snapshotted.
    const existingKind = (await store.getItem(project, slug))?.kind;
    const surfaces =
      typeof args.html === "string"
        ? await coerceSurfaces([htmlSurface(args.html)])
        : await coerceSurfaces(args.surfaces ?? []);
    if (surfaces.length === 0) throw new Error("an item needs html or surfaces");
    const result = await deps.publishPost({
      surfaces,
      project,
      slug,
      variant: typeof args.variant === "string" ? args.variant : undefined,
      kind: kind ?? (args.kind === "page" ? "page" : (existingKind ?? "component")),
      title: typeof args.title === "string" ? args.title : undefined,
      from: typeof args.from === "number" ? args.from : undefined,
      prompt: typeof args.prompt === "string" ? args.prompt : undefined,
      session: typeof args.session === "string" ? args.session : undefined,
      sessionTitle: typeof args.sessionTitle === "string" ? args.sessionTitle : undefined,
    });
    if ("error" in result) throw new Error(result.error);
    // Item tools answer in the CLI's vocabulary — the post view alone leaves
    // out the identity (project/slug/variant) the agent addresses it by.
    const post = result.post;
    return JSON.stringify(
      {
        ...postWriteView(post),
        project: post.project,
        slug: post.slug,
        kind: post.kind,
        variant: post.variant,
        status: post.status,
        ask: post.ask,
        slots: post.slots,
        ...(post.from === undefined ? {} : { from: post.from }),
        ...(post.prompt === undefined ? {} : { prompt: post.prompt }),
        url: `${origin}/p/${post.id}`,
        ...(result.userFeedback && { userFeedback: result.userFeedback }),
      },
      null,
      2,
    );
  }

  async function callTool(name: string, args: any, origin: string): Promise<string> {
    switch (name) {
      case "publish_item":
        return publishItem(args, origin);
      case "revise_item":
        return publishItem(args, origin);
      case "ask_user": {
        const project = await projectOf(args);
        const item = await store.getItem(project, String(args.slug ?? ""));
        if (!item) throw new Error(`${project} has no item "${args.slug}"`);
        const variant = chooseVariant(item, args.variant);
        const text = String(args.text ?? "");
        if (!text) throw new Error("ask_user needs text");
        const post = await store.setPostAsk(variant.postId, {
          text,
          at: new Date().toISOString(),
        });
        // The question also lands in the card's thread, so the operator reads it
        // where they answer it.
        await deps.createComment({ text, surface: variant.postId });
        return JSON.stringify(
          {
            project,
            slug: item.slug,
            variant: variant.variant,
            version: post?.version ?? variant.version,
            ask: text,
            url: `${origin}/p/${variant.postId}`,
          },
          null,
          2,
        );
      }
      case "list_items": {
        const project = await projectOf(args);
        const items = await store.listItems(project);
        return JSON.stringify({ project, items }, null, 2);
      }
      case "get_item": {
        const project = await projectOf(args);
        const item = await store.getItem(project, String(args.slug ?? ""));
        if (!item) throw new Error(`${project} has no item "${args.slug}"`);
        const variants = (item.variants ?? [])
          // `variant` narrows the read to one take, as it does on the stdio
          // tier — an item with five variants is five bodies otherwise.
          .filter((v) => !args.variant || v.variant === args.variant)
          .map((v) => ({
            variant: v.variant,
            postId: v.postId,
            version: v.version,
            status: v.status,
            ask: v.ask,
            updatedAt: v.updatedAt,
            ...(args.history && { history: historyMeta(v.history) }),
            ...(args.body && { html: htmlOf(v) }),
          }));
        return JSON.stringify(
          { project, slug: item.slug, kind: item.kind, title: item.title, variants },
          null,
          2,
        );
      }
      case "export_item": {
        const project = await projectOf(args);
        const item = await store.getItem(project, String(args.slug ?? ""));
        if (!item) throw new Error(`${project} has no item "${args.slug}"`);
        const chosen = chooseVariant(item, args.variant);
        const post = await store.findVariant(project, item.slug, chosen.variant);
        if (!post) throw new Error("variant not found");
        return JSON.stringify(
          {
            project,
            slug: item.slug,
            variant: chosen.variant,
            version: post.version,
            status: post.status,
            html: htmlOf(post),
            history: historyMeta(post.history),
          },
          null,
          2,
        );
      }
      case "publish_post":
      case "publish_surface":
      case "publish_snippet": {
        // New tools advertise `surfaces`; legacy tools still send `parts`.
        const blocks = name === "publish_post" ? (args.surfaces ?? args.parts) : args.parts;
        const surfaces =
          name === "publish_snippet"
            ? await coerceSurfaces([htmlSurface(String(args.html ?? ""), args.kits)])
            : await coerceSurfaces(blocks);
        if (surfaces.length === 0) {
          throw new Error("a post needs at least one surface");
        }
        const result = await deps.publishPost({
          surfaces,
          title: typeof args.title === "string" ? args.title : undefined,
          session: typeof args.session === "string" ? args.session : undefined,
          sessionTitle: typeof args.sessionTitle === "string" ? args.sessionTitle : undefined,
          agent: typeof args.agent === "string" ? args.agent : undefined,
        });
        if ("error" in result) throw new Error(result.error);
        return postResult(result, origin);
      }
      case "update_post":
      case "update_surface":
      case "update_snippet": {
        const patch: { surfaces?: Surface[]; title?: string } = {
          title: typeof args.title === "string" ? args.title : undefined,
        };
        if (name === "update_snippet") {
          if (typeof args.html === "string")
            patch.surfaces = await coerceSurfaces([htmlSurface(args.html, args.kits)]);
        } else {
          const blocks = name === "update_post" ? (args.surfaces ?? args.parts) : args.parts;
          if (blocks !== undefined) patch.surfaces = await coerceSurfaces(blocks);
        }
        const result = await deps.revisePost(String(args.id ?? ""), patch);
        if ("error" in result) throw new Error(result.error);
        return postResult(result, origin);
      }
      case "wait_for_feedback": {
        const result = await deps.waitForComments({
          sessionId: String(args.session ?? ""),
          author: "user",
          afterSeq: typeof args.afterSeq === "number" ? args.afterSeq : undefined,
          waitSeconds: typeof args.timeoutSeconds === "number" ? args.timeoutSeconds : 60,
        });
        if (result.comments.length === 0) {
          return JSON.stringify({
            comments: [],
            lastSeq: result.lastSeq,
            note: "no user feedback yet — continue, or wait again later",
          });
        }
        // One batch per post: the decision the operator made, the comments they
        // batched with it, and which sibling variants it archived. Built by the
        // same function the HTTP tier uses, so MCP and CLI cannot drift.
        const batches = await buildFeedbackBatches(deps.store, result.comments);
        return JSON.stringify(batches.length === 1 ? batches[0] : batches, null, 2);
      }
      case "reply_to_user": {
        // createComment derives the reply author from the session; MCP cannot
        // choose a label or mint the reserved human "user" identity.
        const result = await deps.createComment({
          text: String(args.message ?? ""),
          surface: String(args.postId ?? args.surfaceId ?? ""),
        });
        if ("error" in result) throw new Error(result.error);
        return JSON.stringify(
          { ...result.comment, ...(result.userFeedback && { userFeedback: result.userFeedback }) },
          null,
          2,
        );
      }
      case "list_posts":
      case "list_surfaces":
      case "list_snippets": {
        const posts = await deps.store.listPosts(
          typeof args.session === "string" ? args.session : undefined,
        );
        return JSON.stringify(posts.map(mcpPostListRowView), null, 2);
      }
      case "get_post": {
        const post = await deps.store.getPost(String(args.id ?? ""));
        if (!post) throw new Error("post not found");
        return JSON.stringify(
          postDetailView(post, { history: args.history === "full" ? "full" : "meta" }),
          null,
          2,
        );
      }
      case "upload_asset": {
        if (typeof args.data !== "string" || args.data.length === 0) {
          throw new Error("upload_asset needs base64 `data`");
        }
        const result = await deps.uploadAsset({
          data: decodeBase64(args.data),
          contentType: typeof args.contentType === "string" ? args.contentType : "",
          filename: typeof args.filename === "string" ? args.filename : undefined,
          kind:
            args.kind === "image" || args.kind === "trace" || args.kind === "file"
              ? args.kind
              : undefined,
          session: typeof args.session === "string" ? args.session : undefined,
        });
        if ("error" in result) throw new Error(result.error);
        return JSON.stringify(
          {
            id: result.asset.id,
            sessionId: result.asset.sessionId,
            url: `${origin}/a/${result.asset.id}`,
            contentType: result.asset.contentType,
            byteLength: result.asset.byteLength,
            kind: result.asset.kind,
          },
          null,
          2,
        );
      }
      case "get_design_guide": {
        // app.ts may hand us a static guide or a project-aware renderer; either
        // is fine here, and the project only matters to the latter.
        const guide: any = deps.guide;
        return typeof guide === "function" ? await guide(await projectOf(args)) : guide;
      }
      case "send_test_post": {
        // Idempotent: a board only ever needs one welcome card. If it's already
        // there, hand back the existing post instead of stacking duplicates —
        // agents are told to call this right after connecting, and an eager one
        // may call it more than once.
        const existing = await findWelcomePost(deps.store);
        if (existing) {
          return JSON.stringify(
            {
              ...postWriteView(existing),
              url: `${origin}/p/${existing.id}`,
              alreadySent: true,
              note: "the welcome post is already on this board — returning it, not republishing",
            },
            null,
            2,
          );
        }
        const result = await deps.publishPost({
          surfaces: welcomeSurfaces(),
          title: WELCOME_POST_TITLE,
          sessionTitle: WELCOME_SESSION_TITLE,
          agent: typeof args.agent === "string" ? args.agent : undefined,
        });
        if ("error" in result) throw new Error(result.error);
        return postResult(result, origin);
      }
      case "add_surface": {
        const surfaces = await coerceSurfaces([args.surface]);
        if (surfaces.length === 0) throw new Error("invalid surface");
        const result = await deps.appendPostSurface(String(args.postId ?? ""), surfaces[0], {
          before: typeof args.before === "string" ? args.before : undefined,
          after: typeof args.after === "string" ? args.after : undefined,
        });
        if ("error" in result) throw new Error(result.error);
        return postResult(result, origin);
      }
      case "edit_surface": {
        let surface: Surface | undefined;
        if (args.surface !== undefined) {
          const surfaces = await coerceSurfaces([args.surface]);
          if (surfaces.length === 0) throw new Error("invalid surface");
          surface = surfaces[0];
        }
        const result = await deps.replacePostSurface(
          String(args.postId ?? ""),
          String(args.target ?? ""),
          {
            surface,
            content: typeof args.content === "string" ? args.content : undefined,
            kits: args.kits,
          },
        );
        if ("error" in result) throw new Error(result.error);
        return postResult(result, origin);
      }
      case "remove_surface": {
        const result = await deps.removePostSurface(
          String(args.postId ?? ""),
          String(args.target ?? ""),
        );
        if ("error" in result) throw new Error(result.error);
        return postResult(result, origin);
      }
      case "reorder_surfaces": {
        const result = await deps.reorderPostSurfaces(
          String(args.postId ?? ""),
          Array.isArray(args.order) ? args.order : [],
        );
        if ("error" in result) throw new Error(result.error);
        return postResult(result, origin);
      }
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  }

  app.post("/mcp", async (c) => {
    const rpc = (id: unknown, result: unknown) => c.json({ jsonrpc: "2.0", id, result });
    const rpcError = (id: unknown, code: number, message: string, status = 200) =>
      c.json({ jsonrpc: "2.0", id, error: { code, message } }, status as 200);

    let msg: any;
    try {
      msg = await c.req.json();
    } catch {
      return rpcError(null, -32700, "parse error", 400);
    }
    if (Array.isArray(msg)) {
      return rpcError(null, -32600, "batch requests are not supported", 400);
    }

    if (msg.method === "initialize") {
      return rpc(msg.id, {
        protocolVersion:
          typeof msg.params?.protocolVersion === "string"
            ? msg.params.protocolVersion
            : "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions: MCP_INSTRUCTIONS,
      });
    }
    if (msg.id === undefined) return c.body(null, 202); // notifications
    if (msg.method === "ping") return rpc(msg.id, {});
    if (msg.method === "tools/list") {
      // The retired spellings stay callable but are not advertised, so a fresh
      // agent never pays context for them.
      return rpc(msg.id, {
        tools: includeLegacyMcpTools()
          ? [...HTTP_MCP_TOOLS, ...DEPRECATED_HTTP_MCP_TOOLS]
          : HTTP_MCP_TOOLS,
      });
    }
    if (msg.method === "tools/call") {
      const url = new URL(c.req.url);
      const baseUrl = `${url.origin}${deps.basePath?.(c.req.raw) ?? ""}`;
      try {
        const text = await callTool(msg.params?.name, msg.params?.arguments ?? {}, baseUrl);
        return rpc(msg.id, { content: [{ type: "text", text }] });
      } catch (err) {
        return rpc(msg.id, {
          content: [{ type: "text", text: `error: ${err instanceof Error ? err.message : err}` }],
          isError: true,
        });
      }
    }
    return rpcError(msg.id, -32601, `method not found: ${msg.method}`);
  });

  // Stateless server: no SSE stream to resume, no session to delete.
  app.get("/mcp", (c) => c.text("mockpit MCP is stateless — POST JSON-RPC messages here", 405));
  app.delete("/mcp", (c) => c.body(null, 405));
}
