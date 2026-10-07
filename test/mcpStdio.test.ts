import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createApp } from "../server/app.ts";
import { HTTP_MCP_TOOLS } from "../server/mcpSpec.ts";
import { JsonFileStore } from "../server/storage.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MCP_SERVER = join(ROOT, "mcp", "server.ts");

type PostResult = {
  id: string;
  sessionId: string;
  title: string;
  version: number;
  surfaces: Array<{
    id: string;
    index: number;
    kind: string;
    markdown?: string;
    code?: string;
    text?: string;
    html?: string;
  }>;
};

type SessionRow = {
  id: string;
  title: string | null;
  agent: string;
  postCount: number;
};

function cleanEnv(overrides: Record<string, string> = {}) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  delete env.MOCKPIT_URL;
  delete env.MOCKPIT_SESSION;
  delete env.MOCKPIT_AGENT;
  delete env.MOCKPIT_TOKEN;
  return { ...env, ...overrides };
}

async function serveApp(authToken?: string) {
  const dir = mkdtempSync(join(tmpdir(), "mockpit-mcp-stdio-"));
  const app = createApp({
    store: new JsonFileStore(join(dir, "data.json")),
    viewerHtml: "<html>viewer</html>",
    guideMarkdown: "# stdio design guide",
    setupText: "# setup",
    agentHowtoText: "# agent how-to",
    authToken,
  });

  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      resolve({
        url: `http://127.0.0.1:${info.port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => {
              rmSync(dir, { recursive: true, force: true });
              done();
            });
            (
              server as typeof server & { closeAllConnections?: () => void }
            ).closeAllConnections?.();
          }),
      });
    });
  });
}

async function connectMcp(url: string, overrides: Record<string, string> = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SERVER],
    cwd: ROOT,
    env: cleanEnv({
      MOCKPIT_URL: url,
      MOCKPIT_AGENT: "stdio-agent",
      ...overrides,
    }),
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const client = new Client({ name: "mockpit-stdio-test", version: "1.0.0" });
  try {
    await client.connect(transport, { timeout: 5_000 });
  } catch (error) {
    await transport.close();
    throw new Error(`failed to connect to stdio MCP server: ${stderr}`, { cause: error });
  }
  return { client, close: () => client.close() };
}

function readToolText(result: unknown, name: string) {
  if (typeof result !== "object" || result === null) {
    throw new Error(`${name} returned a non-object result`);
  }
  const candidate = result as { content?: unknown; isError?: unknown };
  if (!Array.isArray(candidate.content)) throw new Error(`${name} returned a task result`);
  const first = candidate.content[0] as unknown;
  if (typeof first !== "object" || first === null) {
    throw new Error(`${name} returned no content`);
  }
  const part = first as { type?: unknown; text?: unknown };
  if (part.type !== "text" || typeof part.text !== "string") {
    throw new Error(`${name} returned non-text content: ${JSON.stringify(result)}`);
  }
  return { text: part.text, isError: candidate.isError === true };
}

const invokedTools = new WeakMap<Client, Set<string>>();

async function callText(client: Client, name: string, args: Record<string, unknown> = {}) {
  const names = invokedTools.get(client) ?? new Set<string>();
  names.add(name);
  invokedTools.set(client, names);
  const output = readToolText(await client.callTool({ name, arguments: args }), name);
  if (output.isError) throw new Error(`${name} failed: ${output.text}`);
  return output.text;
}

async function callJson<T>(client: Client, name: string, args: Record<string, unknown> = {}) {
  return JSON.parse(await callText(client, name, args)) as T;
}

async function fetchJson<T>(url: string, path: string, init?: RequestInit) {
  const response = await fetch(`${url}${path}`, init);
  assert.ok(response.ok, `${init?.method ?? "GET"} ${path} returned ${response.status}`);
  return response.json() as Promise<T>;
}

const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
  body: JSON.stringify(body),
});

// `userFeedback` is the batch shape: one entry per post, its comments inside.
type FeedbackResult = {
  userFeedback?: Array<{ postId: string; comments: Array<{ text: string }> }>;
};

async function queueFeedback(url: string, postId: string, text: string) {
  await fetchJson(url, "/api/comments", json({ surface: postId, text, author: "user" }));
}

function assertFeedback(result: FeedbackResult, text: string, postId: string) {
  assert.deepEqual(
    result.userFeedback?.flatMap((batch) => batch.comments.map((c) => c.text)),
    [text],
  );
  assert.equal(result.userFeedback?.[0].postId, postId);
}

test(
  "stdio MCP exercises the complete tool catalog against a real Mockpit server",
  { timeout: 15_000 },
  async (t) => {
    const app = await serveApp();
    const connections: Array<Awaited<ReturnType<typeof connectMcp>>> = [];
    t.after(async () => {
      for (const connection of connections.reverse()) await connection.close();
      await app.close();
    });
    const mcp = await connectMcp(app.url);
    connections.push(mcp);

    let post!: PostResult;
    let addedSurfaceId!: string;

    await t.test("advertises every HTTP-equivalent tool and starts without a session", async () => {
      assert.equal(mcp.client.getServerVersion()?.name, "mockpit");
      assert.match(mcp.client.getInstructions() ?? "", /publish_item/);

      const listed = await mcp.client.listTools();
      // stdio advertises the HTTP catalog plus `init_project`, which only makes
      // sense with a local checkout; retired spellings stay callable but are
      // not listed (MOCKPIT_MCP_LEGACY=1 brings them back).
      assert.deepEqual(
        listed.tools.map((tool) => tool.name).sort(),
        [...HTTP_MCP_TOOLS.map((tool) => tool.name), "init_project"].sort(),
      );
      assert.ok(!listed.tools.some((tool) => tool.name === "publish_surface"));
      assert.deepEqual(await callJson(mcp.client, "list_posts"), []);
      assert.deepEqual(await callJson(mcp.client, "list_surfaces"), []);
      // get_design_guide renders the project-aware brief (the reshape's short
      // guide), not the raw workspace guide markdown.
      const guide = await callText(mcp.client, "get_design_guide");
      assert.match(guide, /design brief/);
      assert.match(guide, /publish --item/);
    });

    await t.test("rejects invalid input before creating a lazy session", async () => {
      const invalid = readToolText(
        await mcp.client.callTool({
          name: "publish_post",
          arguments: { title: "missing surfaces" },
        }),
        "publish_post",
      );
      assert.equal(invalid.isError, true);
      assert.match(invalid.text, /invalid arguments/i);
      assert.match(invalid.text, /surfaces/);
      assert.deepEqual(await fetchJson<SessionRow[]>(app.url, "/api/sessions"), []);
      assert.deepEqual(await callJson(mcp.client, "list_posts"), []);
    });

    await t.test("canonical publish, read, update, and asset tools reuse one session", async () => {
      post = await callJson<PostResult>(mcp.client, "publish_post", {
        title: "stdio canonical",
        sessionTitle: "Stdio integration",
        surfaces: [
          { kind: "markdown", markdown: "# first" },
          { kind: "code", code: "const answer = 42;", language: "ts" },
        ],
      });
      assert.ok(post.id);
      assert.ok(post.sessionId);
      assert.equal(post.surfaces.length, 2);
      assert.match((post as PostResult & { url: string }).url, new RegExp(`/p/${post.id}$`));

      const fetched = await callJson<PostResult>(mcp.client, "get_post", { id: post.id });
      assert.equal(fetched.title, "stdio canonical");
      assert.deepEqual(
        fetched.surfaces.map((surface) => surface.kind),
        ["markdown", "code"],
      );
      assert.equal(fetched.surfaces[0].markdown, "# first");
      assert.equal(fetched.surfaces[1].code, "const answer = 42;");

      post = await callJson<PostResult>(mcp.client, "update_post", {
        id: post.id,
        title: "stdio canonical updated",
        surfaces: [
          { kind: "markdown", markdown: "# updated" },
          { kind: "code", code: "const answer = 43;", language: "ts" },
        ],
      });
      assert.equal(post.version, 2);
      assert.equal(post.title, "stdio canonical updated");
      const revised = await callJson<PostResult>(mcp.client, "get_post", { id: post.id });
      assert.equal(revised.surfaces[0].markdown, "# updated");
      assert.equal(revised.surfaces[1].code, "const answer = 43;");

      const asset = await callJson<{
        id: string;
        kind: string;
        url: string;
        sessionId: string;
      }>(mcp.client, "upload_asset", {
        data: Buffer.from("stdio asset").toString("base64"),
        contentType: "text/plain",
        filename: "stdio.txt",
        kind: "file",
      });
      assert.ok(asset.id);
      assert.equal(asset.kind, "file");
      assert.equal(asset.sessionId, post.sessionId);
      const servedAsset = await fetch(asset.url);
      assert.equal(servedAsset.status, 200);
      assert.equal(servedAsset.headers.get("content-type"), "text/plain");
      assert.equal(
        servedAsset.headers.get("content-disposition"),
        'attachment; filename="stdio.txt"',
      );
      assert.equal(await servedAsset.text(), "stdio asset");

      const sessions = await fetchJson<SessionRow[]>(app.url, "/api/sessions");
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].id, post.sessionId);
      assert.equal(sessions[0].title, "Stdio integration");
      assert.equal(sessions[0].agent, "stdio-agent");
    });

    await t.test("per-surface writes preserve feedback while mutating by stable id", async () => {
      await queueFeedback(app.url, post.id, "feedback before add");
      let updated = await callJson<PostResult & FeedbackResult>(mcp.client, "add_surface", {
        postId: post.id,
        surface: { kind: "terminal", text: "ready\n", title: "build" },
      });
      assertFeedback(updated, "feedback before add", post.id);
      assert.equal(updated.surfaces.length, 3);
      addedSurfaceId = updated.surfaces[2].id;

      await queueFeedback(app.url, post.id, "feedback before edit");
      updated = await callJson<PostResult & FeedbackResult>(mcp.client, "edit_surface", {
        postId: post.id,
        target: addedSurfaceId,
        content: "done\n",
      });
      assertFeedback(updated, "feedback before edit", post.id);
      assert.equal(
        updated.surfaces.find((surface) => surface.id === addedSurfaceId)?.kind,
        "terminal",
      );
      const afterEdit = await callJson<PostResult>(mcp.client, "get_post", { id: post.id });
      assert.equal(
        afterEdit.surfaces.find((surface) => surface.id === addedSurfaceId)?.text,
        "done\n",
      );

      const originalIds = updated.surfaces.map((surface) => surface.id);
      await queueFeedback(app.url, post.id, "feedback before reorder");
      updated = await callJson<PostResult & FeedbackResult>(mcp.client, "reorder_surfaces", {
        postId: post.id,
        order: [addedSurfaceId, originalIds[0], originalIds[1]],
      });
      assertFeedback(updated, "feedback before reorder", post.id);
      assert.deepEqual(
        updated.surfaces.map((surface) => surface.id),
        [addedSurfaceId, originalIds[0], originalIds[1]],
      );

      await queueFeedback(app.url, post.id, "feedback before remove");
      updated = await callJson<PostResult & FeedbackResult>(mcp.client, "remove_surface", {
        postId: post.id,
        target: originalIds[1],
      });
      assertFeedback(updated, "feedback before remove", post.id);
      assert.deepEqual(
        updated.surfaces.map((surface) => surface.id),
        [addedSurfaceId, originalIds[0]],
      );
    });

    await t.test(
      "deprecated aliases remain callable and stay in the conversation session",
      async () => {
        await queueFeedback(app.url, post.id, "feedback before publish_surface");
        let legacy = await callJson<PostResult & FeedbackResult>(mcp.client, "publish_surface", {
          title: "legacy surface",
          sessionTitle: "ignored after first publish",
          parts: [{ kind: "markdown", markdown: "legacy" }],
        });
        assertFeedback(legacy, "feedback before publish_surface", post.id);
        assert.equal(legacy.sessionId, post.sessionId);

        await queueFeedback(app.url, post.id, "feedback before update_surface");
        legacy = await callJson<PostResult & FeedbackResult>(mcp.client, "update_surface", {
          id: legacy.id,
          title: "legacy surface updated",
          parts: [{ kind: "terminal", text: "legacy updated" }],
        });
        assertFeedback(legacy, "feedback before update_surface", post.id);
        assert.equal(legacy.title, "legacy surface updated");
        assert.equal(legacy.surfaces[0].kind, "terminal");
        const legacyDetail = await callJson<PostResult>(mcp.client, "get_post", { id: legacy.id });
        assert.equal(legacyDetail.surfaces[0].text, "legacy updated");

        await queueFeedback(app.url, post.id, "feedback before publish_snippet");
        let snippet = await callJson<PostResult & FeedbackResult>(mcp.client, "publish_snippet", {
          title: "legacy snippet",
          html: "<strong>v1</strong>",
          kits: ["issues"],
        });
        assertFeedback(snippet, "feedback before publish_snippet", post.id);
        assert.equal(snippet.sessionId, post.sessionId);
        assert.equal(snippet.surfaces[0].kind, "html");

        await queueFeedback(app.url, post.id, "feedback before update_snippet");
        snippet = await callJson<PostResult & FeedbackResult>(mcp.client, "update_snippet", {
          id: snippet.id,
          title: "legacy snippet updated",
          html: "<strong>v2</strong>",
          kits: ["issues"],
        });
        assertFeedback(snippet, "feedback before update_snippet", post.id);
        assert.equal(snippet.title, "legacy snippet updated");
        assert.equal(snippet.version, 2);
        const snippetDetail = await callJson<PostResult>(mcp.client, "get_post", {
          id: snippet.id,
        });
        assert.equal(snippetDetail.surfaces[0].html, "<strong>v2</strong>");

        const posts = await callJson<Array<{ id: string }>>(mcp.client, "list_posts");
        const surfaces = await callJson<Array<{ id: string }>>(mcp.client, "list_surfaces");
        assert.equal(posts.length, 3);
        assert.deepEqual(surfaces, posts);

        const sessions = await fetchJson<SessionRow[]>(app.url, "/api/sessions");
        assert.equal(sessions.length, 1);
        assert.equal(sessions[0].title, "Stdio integration");
        assert.equal(sessions[0].postCount, 3);
      },
    );

    await t.test(
      "feedback is delivered exactly once through writes, waits, and replies",
      async () => {
        await fetchJson(
          app.url,
          "/api/comments",
          json({ surface: post.id, text: "Piggyback on the next write", author: "user" }),
        );
        const updated = await callJson<PostResult & FeedbackResult>(mcp.client, "update_post", {
          id: post.id,
          title: "stdio canonical feedback",
          surfaces: [{ kind: "markdown", markdown: "# feedback revision" }],
        });
        assertFeedback(updated, "Piggyback on the next write", post.id);
        post = updated;

        const afterWrite = await callJson<{ comments: unknown[] }>(
          mcp.client,
          "wait_for_feedback",
          { timeoutSeconds: 0 },
        );
        assert.deepEqual(afterWrite.comments, []);

        await fetchJson(
          app.url,
          "/api/comments",
          json({ surface: post.id, text: "Please tighten this", author: "user" }),
        );
        // A wait returns the batch for the post: its identity once, comments inside.
        const waited = await callJson<{
          postId: string;
          title: string;
          decision: unknown;
          comments: Array<{ text: string; seq: number }>;
        }>(mcp.client, "wait_for_feedback", { timeoutSeconds: 0 });
        assert.equal(waited.postId, post.id);
        assert.equal(waited.title, "stdio canonical feedback");
        assert.equal(waited.decision, null);
        assert.deepEqual(
          waited.comments.map((c) => c.text),
          ["Please tighten this"],
        );

        const afterWait = await callJson<{ comments: unknown[]; note: string }>(
          mcp.client,
          "wait_for_feedback",
          { timeoutSeconds: 0 },
        );
        assert.deepEqual(afterWait.comments, []);
        assert.match(afterWait.note, /no user feedback yet/);

        await fetchJson(
          app.url,
          "/api/comments",
          json({ surface: post.id, text: "Explain the change", author: "user" }),
        );
        const reply = await callJson<FeedbackResult>(mcp.client, "reply_to_user", {
          postId: post.id,
          message: "Tightened.",
        });
        assertFeedback(reply, "Explain the change", post.id);
        const afterReply = await callJson<{ comments: unknown[] }>(
          mcp.client,
          "wait_for_feedback",
          { timeoutSeconds: 0 },
        );
        assert.deepEqual(afterReply.comments, []);

        const { comments } = await fetchJson<{
          comments: Array<{ author: string; text: string }>;
        }>(app.url, `/api/comments?surface=${post.id}`);
        assert.deepEqual(
          comments.slice(-4).map(({ author, text }) => ({ author, text })),
          [
            { author: "user", text: "Piggyback on the next write" },
            { author: "user", text: "Please tighten this" },
            { author: "user", text: "Explain the change" },
            { author: "stdio-agent", text: "Tightened." },
          ],
        );
      },
    );

    await t.test("the item tools drive the project > item > variant loop", async () => {
      // The stdio tier answers in the item vocabulary (project/slug/variant/
      // version + a project URL), not the post shape.
      const published = await callJson<{
        project: string;
        slug: string;
        variant: string;
        version: number;
        url: string;
      }>(mcp.client, "publish_item", {
        slug: "pricing-card",
        variant: "highlighted",
        title: "Pricing card",
        html: "<div class=card>v1</div>",
      });
      assert.equal(published.slug, "pricing-card");
      assert.equal(published.variant, "highlighted");
      assert.equal(published.version, 1);
      assert.match(published.url, /\/project\/.+\/pricing-card$/);

      // the same (project, slug, variant) is a new VERSION, not a second item
      const revised = await callJson<{ slug: string; variant: string; version: number }>(
        mcp.client,
        "revise_item",
        {
          slug: "pricing-card",
          variant: "highlighted",
          html: "<div class=card>v2</div>",
          from: 1,
          prompt: "tighten the spacing",
        },
      );
      assert.equal(revised.slug, "pricing-card");
      assert.equal(revised.version, 2);

      const listed = await callJson<{
        project: string;
        items: Array<{ slug: string; kind: string; variants: Array<{ variant: string }> }>;
      }>(mcp.client, "list_items", { project: published.project });
      const row = listed.items.find((item) => item.slug === "pricing-card");
      assert.ok(row, "the published item is listed");
      assert.equal(row!.kind, "component");
      assert.deepEqual(
        row!.variants.map((v) => v.variant),
        ["highlighted"],
      );

      const item = await callJson<{
        slug: string;
        kind: string;
        variants: Array<{ variant: string; version: number; status: string; html?: string }>;
      }>(mcp.client, "get_item", {
        slug: "pricing-card",
        project: published.project,
        body: true,
      });
      assert.equal(item.kind, "component");
      const highlighted = item.variants.find((v) => v.variant === "highlighted")!;
      assert.equal(highlighted.version, 2);
      assert.equal(highlighted.status, "open");
      assert.equal(highlighted.html, "<div class=card>v2</div>");

      // ask marks the item as waiting on the operator, and lands in its thread
      const asked = await callJson<{ ask: string; variant: string; version: number }>(
        mcp.client,
        "ask_user",
        {
          slug: "pricing-card",
          project: published.project,
          variant: "highlighted",
          text: "tighter or roomier?",
        },
      );
      assert.equal(asked.ask, "tighter or roomier?");
      const asking = await callJson<{ variants: Array<{ variant: string; ask: any }> }>(
        mcp.client,
        "get_item",
        { slug: "pricing-card", project: published.project, variant: "highlighted" },
      );
      assert.equal(asking.variants[0].ask?.text, "tighter or roomier?");

      const exported = await callJson<{
        variant: string;
        version: number;
        html: string;
        prompts: Array<{ version: number; prompt: string }>;
      }>(mcp.client, "export_item", {
        slug: "pricing-card",
        project: published.project,
        variant: "highlighted",
      });
      assert.equal(exported.version, 2);
      assert.equal(exported.html, "<div class=card>v2</div>");
      // newest first, current version included, each with what prompted it
      assert.deepEqual(
        exported.prompts.map((h) => h.version),
        [2, 1],
      );
      assert.equal(exported.prompts[0].prompt, "tighten the spacing");
    });

    await t.test("the welcome tool is idempotent and isolated from the conversation", async () => {
      const first = await callJson<{ id: string; alreadySent?: boolean }>(
        mcp.client,
        "send_test_post",
      );
      const second = await callJson<{ id: string; alreadySent?: boolean }>(
        mcp.client,
        "send_test_post",
      );
      assert.equal(first.alreadySent, undefined);
      assert.equal(second.alreadySent, true);
      assert.equal(second.id, first.id);

      const posts = await callJson<Array<{ id: string }>>(mcp.client, "list_posts");
      assert.equal(posts.length, 4, "welcome post must not enter the conversation session");
      const sessions = await fetchJson<SessionRow[]>(app.url, "/api/sessions");
      assert.equal(sessions.length, 2);
      const invoked = invokedTools.get(mcp.client) ?? new Set<string>();
      assert.deepEqual(
        HTTP_MCP_TOOLS.map((tool) => tool.name)
          .filter((name) => !invoked.has(name))
          .sort(),
        [],
        "every advertised tool must be invoked, not merely listed",
      );
    });
  },
);

test(
  "stdio MCP wait and upload tools can create the lazy conversation session",
  { timeout: 15_000 },
  async (t) => {
    const app = await serveApp();
    const connections: Array<Awaited<ReturnType<typeof connectMcp>>> = [];
    t.after(async () => {
      for (const connection of connections.reverse()) await connection.close();
      await app.close();
    });

    const waitClient = await connectMcp(app.url, { MOCKPIT_AGENT: "wait-first-agent" });
    connections.push(waitClient);
    const empty = await callJson<{ comments: unknown[] }>(waitClient.client, "wait_for_feedback", {
      timeoutSeconds: 0,
    });
    assert.deepEqual(empty.comments, []);
    const afterWait = await fetchJson<SessionRow[]>(app.url, "/api/sessions");
    assert.equal(afterWait.length, 1);
    assert.equal(afterWait[0].agent, "wait-first-agent");
    const waitPost = await callJson<PostResult>(waitClient.client, "publish_post", {
      title: "after wait",
      surfaces: [{ kind: "markdown", markdown: "same session" }],
    });
    assert.equal(waitPost.sessionId, afterWait[0].id);

    const uploadClient = await connectMcp(app.url, { MOCKPIT_AGENT: "upload-first-agent" });
    connections.push(uploadClient);
    const asset = await callJson<{ sessionId: string }>(uploadClient.client, "upload_asset", {
      data: Buffer.from("upload first").toString("base64"),
      contentType: "text/plain",
    });
    const uploadPost = await callJson<PostResult>(uploadClient.client, "publish_post", {
      title: "after upload",
      surfaces: [{ kind: "markdown", markdown: "same session" }],
    });
    assert.equal(uploadPost.sessionId, asset.sessionId);

    const sessions = await fetchJson<SessionRow[]>(app.url, "/api/sessions");
    assert.equal(sessions.length, 2);
    assert.equal(
      sessions.find((session) => session.id === asset.sessionId)?.agent,
      "upload-first-agent",
    );
  },
);

test("stdio MCP honors a preconfigured conversation session", { timeout: 15_000 }, async (t) => {
  const app = await serveApp();
  const connections: Array<Awaited<ReturnType<typeof connectMcp>>> = [];
  t.after(async () => {
    for (const connection of connections.reverse()) await connection.close();
    await app.close();
  });

  const session = await fetchJson<{ id: string }>(
    app.url,
    "/api/sessions",
    json({ agent: "preexisting-agent", cwd: "/tmp/fixed", title: "Fixed session" }),
  );
  const mcp = await connectMcp(app.url, { MOCKPIT_SESSION: session.id });
  connections.push(mcp);
  assert.deepEqual(await callJson(mcp.client, "list_posts"), []);

  const seed = await fetchJson<PostResult>(
    app.url,
    "/api/posts",
    json({
      session: session.id,
      title: "feedback seed",
      surfaces: [{ kind: "markdown", markdown: "seed" }],
    }),
  );
  await queueFeedback(app.url, seed.id, "feedback before publish_post");
  const post = await callJson<PostResult & FeedbackResult>(mcp.client, "publish_post", {
    title: "fixed-session post",
    sessionTitle: "must not replace the existing title",
    surfaces: [{ kind: "markdown", markdown: "fixed" }],
  });
  assertFeedback(post, "feedback before publish_post", seed.id);
  assert.equal(post.sessionId, session.id);

  const asset = await callJson<{ sessionId: string }>(mcp.client, "upload_asset", {
    data: Buffer.from("fixed asset").toString("base64"),
    contentType: "text/plain",
    filename: "fixed.txt",
  });
  assert.equal(asset.sessionId, session.id);
  await fetchJson(
    app.url,
    "/api/comments",
    json({ surface: post.id, text: "fixed feedback", author: "user" }),
  );
  const feedback = await callJson<{ comments: Array<{ text: string }> }>(
    mcp.client,
    "wait_for_feedback",
    { timeoutSeconds: 0 },
  );
  assert.deepEqual(
    feedback.comments.map((comment) => comment.text),
    ["fixed feedback"],
  );
  assert.equal((await callJson<unknown[]>(mcp.client, "list_posts")).length, 2);

  const sessions = await fetchJson<SessionRow[]>(app.url, "/api/sessions");
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, session.id);
  assert.equal(sessions[0].title, "Fixed session");
  assert.equal(sessions[0].agent, "preexisting-agent");
});

test(
  "stdio MCP returns actionable API authentication and reachability errors",
  { timeout: 15_000 },
  async (t) => {
    const protectedApp = await serveApp("secret");
    const connections: Array<Awaited<ReturnType<typeof connectMcp>>> = [];
    t.after(async () => {
      for (const connection of connections.reverse()) await connection.close();
      await protectedApp.close();
    });
    const unauthenticated = await connectMcp(protectedApp.url);
    connections.push(unauthenticated);

    const unauthorized = readToolText(
      await unauthenticated.client.callTool({
        name: "publish_post",
        arguments: { title: "blocked", surfaces: [{ kind: "markdown", markdown: "nope" }] },
      }),
      "publish_post",
    );
    assert.equal(unauthorized.isError, true);
    assert.match(unauthorized.text, /401/);

    const authorized = await connectMcp(protectedApp.url, { MOCKPIT_TOKEN: "secret" });
    connections.push(authorized);
    const published = await callJson<PostResult>(authorized.client, "publish_post", {
      title: "allowed",
      surfaces: [{ kind: "markdown", markdown: "ok" }],
    });
    assert.ok(published.id);

    const unreachable = await connectMcp("http://127.0.0.1:1");
    connections.push(unreachable);
    const failed = readToolText(
      await unreachable.client.callTool({
        name: "publish_post",
        arguments: { title: "offline", surfaces: [{ kind: "markdown", markdown: "nope" }] },
      }),
      "publish_post",
    );
    assert.equal(failed.isError, true);
    assert.match(failed.text, /mockpit server not reachable/);
  },
);
