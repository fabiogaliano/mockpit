import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createApp } from "../server/app.ts";
import { MCP_TOOL_NAMES } from "../server/mcpSpec.ts";
import { SqlStore } from "../server/sqlStore.ts";
import { createSqliteStorage } from "../server/sqliteStorage.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MCP_SERVER = join(ROOT, "mcp", "server.ts");

const PROJECT = "stdio-test";

type WriteResult = {
  mock: { id: string; slug: string; project: string; states: string[] };
  post: {
    id: string;
    state: string | null;
    variant: string;
    version: number;
    surfaces: Array<{ id: string; kind: string; index: number }>;
  };
  sessionId: string;
  url: string;
  parts: Array<{ state: string | null; parts: Array<{ name: string }> }>;
  partChanges?: { vanished: string[]; renamed: Array<{ from: string; to: string }> };
};

type SessionRow = { id: string; agent: string };

function cleanEnv(overrides: Record<string, string> = {}) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  delete env.MOCKPIT_URL;
  delete env.MOCKPIT_SESSION;
  delete env.MOCKPIT_AGENT;
  delete env.MOCKPIT_TOKEN;
  // A fixed project keeps the stdio server from deriving one from this repo's
  // git remote, so the test reads the same project the tools wrote.
  return { ...env, MOCKPIT_PROJECT: PROJECT, ...overrides };
}

async function serveApp(authToken?: string) {
  const dir = mkdtempSync(join(tmpdir(), "mockpit-mcp-stdio-"));
  const app = createApp({
    store: new SqlStore(createSqliteStorage()),
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

const viewerJson = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
  body: JSON.stringify(body),
});

const partNames = (result: WriteResult, state: string | null) =>
  result.parts.find((p) => p.state === state)?.parts.map((p) => p.name) ?? [];

test("stdio MCP lists exactly the mock tools", { timeout: 15_000 }, async (t) => {
  const app = await serveApp();
  const mcp = await connectMcp(app.url);
  t.after(async () => {
    await mcp.close();
    await app.close();
  });
  const { tools } = await mcp.client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    MCP_TOOL_NAMES,
  );
});

test(
  "stdio MCP drives the whole mock loop through the REST API",
  { timeout: 30_000 },
  async (t) => {
    const app = await serveApp();
    const dir = mkdtempSync(join(tmpdir(), "mockpit-mcp-files-"));
    const mcp = await connectMcp(app.url);
    t.after(async () => {
      await mcp.close();
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    });

    // html travels as a path over stdio, so markup never passes through context.
    const quietFile = join(dir, "quiet.html");
    writeFileSync(quietFile, '<h1 data-part="title">Writer</h1><p data-part="body">x</p>');
    const quiet = await callJson<WriteResult>(mcp.client, "publish_mock", {
      mock: "writer",
      state: "Writing",
      variant: "quiet",
      html: quietFile,
      knobs: { "body.size": [17, 14, 22, 1] },
      sessionTitle: "Writer redesign",
    });
    assert.equal(quiet.mock.slug, "writer");
    assert.equal(quiet.mock.project, PROJECT);
    assert.deepEqual(quiet.mock.states, ["Writing"]);
    assert.equal(quiet.post.variant, "quiet");
    assert.equal(quiet.post.version, 1);
    assert.deepEqual(partNames(quiet, "Writing"), ["title", "body"]);

    const sessions = await fetchJson<SessionRow[]>(app.url, "/api/sessions");
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].agent, "stdio-agent");
    assert.equal(quiet.sessionId, sessions[0].id);

    const dark = await callJson<WriteResult>(mcp.client, "publish_mock", {
      mock: "writer",
      state: "Writing",
      variant: "dark",
      html: '<h1 data-part="title">Writer</h1><p data-part="body">dark</p>',
    });
    assert.equal(dark.sessionId, quiet.sessionId, "one session per conversation");

    const revised = await callJson<WriteResult>(mcp.client, "revise_mock", {
      mock: "writer",
      state: "Writing",
      variant: "dark",
      html: '<p data-part="body">dark v2</p>',
    });
    assert.equal(revised.post.version, 2);
    assert.deepEqual(revised.partChanges?.vanished, ["title"]);

    const list = await callJson<{ mocks: Array<{ slug: string; variants: number }> }>(
      mcp.client,
      "list_mocks",
    );
    assert.deepEqual(
      list.mocks.map((m) => [m.slug, m.variants]),
      [["writer", 2]],
    );

    const detail = await callJson<{
      id: string;
      states: string[];
      knobs: Record<string, unknown>;
      variants: Array<{ variant: string; surfaces: Array<{ html?: string }> }>;
    }>(mcp.client, "get_mock", { mock: "writer", body: true });
    assert.deepEqual(detail.states, ["Writing"]);
    assert.deepEqual(detail.knobs, { "body.size": [17, 14, 22, 1] });
    assert.equal(
      detail.variants.find((v) => v.variant === "dark")?.surfaces[0].html,
      '<p data-part="body">dark v2</p>',
    );

    const asked = await callJson<{ asks: Array<{ id: string; options: Array<{ id: string }> }> }>(
      mcp.client,
      "ask_user",
      {
        mock: "writer",
        asks: [
          {
            id: "look",
            text: "Which look?",
            options: [
              { label: "Quiet", variant: "quiet" },
              { label: "Dark", variant: "dark" },
            ],
          },
        ],
      },
    );
    assert.deepEqual(
      asked.asks[0].options.map((o) => o.id),
      ["quiet", "dark"],
    );

    const exported = await callJson<{ states: Array<{ variant: string; html: string }> }>(
      mcp.client,
      "export_mock",
      { mock: "writer", variant: "dark" },
    );
    assert.equal(exported.states[0].html, '<p data-part="body">dark v2</p>');

    const reply = await callJson<{ text: string; author: string; mockId: string }>(
      mcp.client,
      "reply_to_user",
      { mock: "writer", message: "Two looks are up" },
    );
    assert.equal(reply.text, "Two looks are up");
    assert.equal(reply.author, "stdio-agent");
    assert.equal(reply.mockId, detail.id);

    const pngFile = join(dir, "shot.png");
    writeFileSync(pngFile, Buffer.from("not really a png"));
    const asset = await callJson<{ id: string; contentType: string; sessionId: string }>(
      mcp.client,
      "upload_asset",
      { path: pngFile },
    );
    assert.equal(asset.contentType, "image/png");
    assert.equal(asset.sessionId, quiet.sessionId);

    const target = { mock: "writer", state: "Writing", variant: "quiet" };
    const added = await callJson<WriteResult>(mcp.client, "add_surface", {
      ...target,
      surface: { kind: "markdown", markdown: "notes" },
    });
    assert.deepEqual(
      added.post.surfaces.map((s) => s.kind),
      ["html", "markdown"],
    );
    const edited = await callJson<WriteResult>(mcp.client, "edit_surface", {
      ...target,
      target: "1",
      content: "better notes",
    });
    assert.equal(edited.post.version, added.post.version + 1);
    const reordered = await callJson<WriteResult>(mcp.client, "reorder_surfaces", {
      ...target,
      order: [1, 0],
    });
    assert.deepEqual(
      reordered.post.surfaces.map((s) => s.kind),
      ["markdown", "html"],
    );
    const removed = await callJson<WriteResult>(mcp.client, "remove_surface", {
      ...target,
      target: "0",
    });
    assert.deepEqual(
      removed.post.surfaces.map((s) => s.kind),
      ["html"],
    );

    const guide = await callText(mcp.client, "get_design_guide");
    assert.match(guide, /design brief/);

    // The user's Send goes through the viewer; the agent hears it exactly once.
    await fetchJson(
      app.url,
      `/api/mocks/${detail.id}/reply`,
      viewerJson({ answers: { look: "dark" }, tuned: { "body.size": 19 }, text: "go dark" }),
    );
    const waited = await callJson<{
      feedback: Array<{
        mock: string;
        reply: { answers: Record<string, string>; tuned: Record<string, number>; text: string };
        accepted: Array<{ variant: string }>;
        archived: Array<{ variant: string }>;
      }>;
      lastSeq: number;
    }>(mcp.client, "wait_for_feedback", { timeoutSeconds: 5 });
    assert.equal(waited.feedback.length, 1);
    const batch = waited.feedback[0];
    assert.equal(batch.mock, "writer");
    assert.deepEqual(batch.reply.answers, { look: "dark" });
    assert.deepEqual(batch.reply.tuned, { "body.size": 19 });
    assert.equal(batch.reply.text, "go dark");
    assert.deepEqual(
      batch.accepted.map((v) => v.variant),
      ["dark"],
    );
    assert.deepEqual(
      batch.archived.map((v) => v.variant),
      ["quiet"],
    );
    assert.ok(waited.lastSeq > 0);

    const again = await callJson<{ feedback: unknown[]; note?: string }>(
      mcp.client,
      "wait_for_feedback",
      { timeoutSeconds: 0 },
    );
    assert.deepEqual(again.feedback, []);
    assert.match(again.note ?? "", /no user feedback/);

    const invoked = invokedTools.get(mcp.client) ?? new Set<string>();
    assert.deepEqual(
      MCP_TOOL_NAMES.filter((name) => !invoked.has(name)),
      [],
      "every advertised tool must be invoked, not merely listed",
    );
  },
);

test("stdio MCP honors a preconfigured conversation session", { timeout: 15_000 }, async (t) => {
  const app = await serveApp();
  const session = await fetchJson<{ id: string }>(
    app.url,
    "/api/sessions",
    viewerJson({ agent: "preexisting-agent", title: "Fixed session" }),
  );
  const mcp = await connectMcp(app.url, { MOCKPIT_SESSION: session.id });
  t.after(async () => {
    await mcp.close();
    await app.close();
  });
  const published = await callJson<WriteResult>(mcp.client, "publish_mock", {
    mock: "card",
    html: "<p>card</p>",
  });
  assert.equal(published.sessionId, session.id);
  const sessions = await fetchJson<SessionRow[]>(app.url, "/api/sessions");
  assert.deepEqual(
    sessions.map((s) => s.id),
    [session.id],
  );
});

test(
  "stdio MCP returns actionable API authentication, validation and reachability errors",
  { timeout: 15_000 },
  async (t) => {
    const protectedApp = await serveApp("secret");
    const connections: Array<Awaited<ReturnType<typeof connectMcp>>> = [];
    t.after(async () => {
      for (const connection of connections.reverse()) await connection.close();
      await protectedApp.close();
    });
    const publishArgs = { mock: "card", html: "<p>card</p>" };

    const unauthenticated = await connectMcp(protectedApp.url);
    connections.push(unauthenticated);
    const unauthorized = readToolText(
      await unauthenticated.client.callTool({ name: "publish_mock", arguments: publishArgs }),
      "publish_mock",
    );
    assert.equal(unauthorized.isError, true);
    assert.match(unauthorized.text, /401/);

    const authorized = await connectMcp(protectedApp.url, { MOCKPIT_TOKEN: "secret" });
    connections.push(authorized);
    const published = await callJson<WriteResult>(authorized.client, "publish_mock", publishArgs);
    assert.ok(published.post.id);

    // The server's hint (which states exist) reaches the agent verbatim.
    await callJson(authorized.client, "publish_mock", {
      mock: "multi",
      state: "Open",
      html: "<p>open</p>",
    });
    const ambiguous = readToolText(
      await authorized.client.callTool({
        name: "publish_mock",
        arguments: { mock: "multi", html: "<p>?</p>" },
      }),
      "publish_mock",
    );
    assert.equal(ambiguous.isError, true);
    assert.match(ambiguous.text, /pass state/);
    assert.match(ambiguous.text, /Open/);

    const unreachable = await connectMcp("http://127.0.0.1:1");
    connections.push(unreachable);
    const failed = readToolText(
      await unreachable.client.callTool({ name: "publish_mock", arguments: publishArgs }),
      "publish_mock",
    );
    assert.equal(failed.isError, true);
    assert.match(failed.text, /mockpit server not reachable/);
  },
);
