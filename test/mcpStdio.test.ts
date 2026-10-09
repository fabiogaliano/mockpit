import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createApp } from "../server/app.ts";
import { MCP_TOOL_NAMES, STDIO_MCP_TOOLS } from "../server/mcpSpec.ts";
import { SqlStore } from "../server/sqlStore.ts";
import { createSqliteStorage } from "../server/sqliteStorage.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MCP_SERVER = join(ROOT, "mcp", "server.ts");
const CLI = join(ROOT, "bin", "mockpit.js");

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
  suggestedAsk?: unknown;
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
  delete env.CLAUDE_CODE_SESSION_ID;
  // A fixed project keeps the stdio server from deriving one from this repo's
  // git remote, so the test reads the same project the tools wrote.
  return { ...env, MOCKPIT_PROJECT: PROJECT, ...overrides };
}

async function serveApp(authToken?: string, onRequest?: (url: URL) => void) {
  const dir = mkdtempSync(join(tmpdir(), "mockpit-mcp-stdio-"));
  const app = createApp({
    store: new SqlStore(createSqliteStorage()),
    viewerHtml: "<html>viewer</html>",
    topics: { html: "# stdio design guide" },
    setupText: "# setup",
    authToken,
  });

  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    const fetch: typeof app.fetch = (req, ...rest) => {
      onRequest?.(new URL(req.url));
      return app.fetch(req, ...rest);
    };
    const server = serve({ fetch, port: 0 }, (info) => {
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

test("stdio MCP lists exactly the spec's catalog", { timeout: 15_000 }, async (t) => {
  const app = await serveApp();
  const mcp = await connectMcp(app.url);
  t.after(async () => {
    await mcp.close();
    await app.close();
  });
  const { tools } = await mcp.client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    STDIO_MCP_TOOLS.map((tool) => tool.name),
  );
  assert.deepEqual(MCP_TOOL_NAMES, [
    "publish",
    "ask",
    "read",
    "feedback",
    "say",
    "export",
    "upload",
    "guide",
  ]);
  for (const tool of tools) {
    const props = Object.keys((tool.inputSchema as { properties?: object }).properties ?? {});
    assert.ok(!props.includes("timeoutSeconds"), `${tool.name} takes no timeout`);
    assert.ok(!props.includes("session"), `${tool.name}: stdio holds the session`);
  }
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
    const quiet = await callJson<WriteResult>(mcp.client, "publish", {
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

    const dark = await callJson<WriteResult>(mcp.client, "publish", {
      mock: "writer",
      state: "Writing",
      variant: "dark",
      html: '<h1 data-part="title">Writer</h1><p data-part="body">dark</p>',
    });
    assert.equal(dark.sessionId, quiet.sessionId, "one session per conversation");
    assert.ok(dark.suggestedAsk, "two unbound variants suggest an ask");

    const revised = await callJson<WriteResult>(mcp.client, "publish", {
      mock: "writer",
      state: "Writing",
      variant: "dark",
      html: '<p data-part="body">dark v2</p>',
    });
    assert.equal(revised.post.version, 2);
    assert.deepEqual(revised.partChanges?.vanished, ["title"]);

    const list = await callJson<{
      mocks: Array<{ slug: string; variants: number }>;
      pending: Array<{ mock: string }>;
    }>(mcp.client, "read");
    assert.deepEqual(
      list.mocks.map((m) => [m.slug, m.variants]),
      [["writer", 2]],
    );
    assert.deepEqual(
      list.pending.map((p) => p.mock),
      ["writer"],
    );

    const detail = await callJson<{
      id: string;
      states: string[];
      knobs: Record<string, unknown>;
      variants: Array<{ variant: string; surfaces: Array<{ html?: string }> }>;
      pending: { mock: string };
    }>(mcp.client, "read", { mock: "writer", body: true });
    assert.deepEqual(detail.states, ["Writing"]);
    assert.deepEqual(detail.knobs, { "body.size": [17, 14, 22, 1] });
    assert.equal(detail.pending.mock, "writer");
    assert.equal(
      detail.variants.find((v) => v.variant === "dark")?.surfaces[0].html,
      '<p data-part="body">dark v2</p>',
    );

    const asked = await callJson<{ asks: Array<{ id: string; options: Array<{ id: string }> }> }>(
      mcp.client,
      "ask",
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
      "export",
      { mock: "writer", variant: "dark" },
    );
    assert.equal(exported.states[0].html, '<p data-part="body">dark v2</p>');

    // Part values travel as paths too, like html.
    const bodyFile = join(dir, "body.html");
    writeFileSync(bodyFile, '<p data-part="body" class="v3">dark v3</p>');
    const spliced = await callJson<WriteResult & { applied?: string[] }>(mcp.client, "publish", {
      mock: "writer",
      state: "Writing",
      variant: "dark",
      parts: { body: bodyFile },
    });
    assert.equal(spliced.post.version, 3);
    assert.deepEqual(spliced.applied, ["body"]);
    const afterSplice = await callJson<{ states: Array<{ html: string }> }>(mcp.client, "export", {
      mock: "writer",
      variant: "dark",
    });
    assert.equal(afterSplice.states[0].html, '<p data-part="body" class="v3">dark v3</p>');

    const said = await callJson<{ feedback: unknown[] }>(mcp.client, "say", {
      mock: "writer",
      message: "Two looks are up",
    });
    assert.deepEqual(said.feedback, []);
    const thread = await fetchJson<{ comments: Array<{ text: string; author: string }> }>(
      app.url,
      `/api/comments?mock=${detail.id}`,
    );
    assert.deepEqual(
      [thread.comments.at(-1)?.text, thread.comments.at(-1)?.author],
      ["Two looks are up", "stdio-agent"],
    );

    const pngFile = join(dir, "shot.png");
    writeFileSync(pngFile, Buffer.from("not really a png"));
    const asset = await callJson<{ id: string; contentType: string; sessionId: string }>(
      mcp.client,
      "upload",
      { path: pngFile },
    );
    assert.equal(asset.contentType, "image/png");
    assert.equal(asset.sessionId, quiet.sessionId);

    // The full ordered list subsumes add, edit, reorder and remove.
    const target = { mock: "writer", state: "Writing", variant: "quiet" };
    const added = await callJson<WriteResult>(mcp.client, "publish", {
      ...target,
      surfaces: [{ id: quiet.post.surfaces[0].id }, { kind: "markdown", markdown: "notes" }],
    });
    assert.deepEqual(
      added.post.surfaces.map((s) => s.kind),
      ["html", "markdown"],
    );
    const [htmlId, mdId] = added.post.surfaces.map((s) => s.id);
    const reordered = await callJson<WriteResult>(mcp.client, "publish", {
      ...target,
      surfaces: [{ id: mdId, kind: "markdown", markdown: "better notes" }, { id: htmlId }],
    });
    assert.deepEqual(
      reordered.post.surfaces.map((s) => s.kind),
      ["markdown", "html"],
    );
    const removed = await callJson<WriteResult>(mcp.client, "publish", {
      ...target,
      surfaces: [{ id: htmlId }],
    });
    assert.deepEqual(
      removed.post.surfaces.map((s) => s.kind),
      ["html"],
    );

    const guide = await callText(mcp.client, "guide");
    assert.match(guide, /# mockpit brief/);
    const html = await callText(mcp.client, "guide", { topic: "html" });
    assert.equal(html, "# stdio design guide");

    const idle = await callJson<{ feedback: unknown[]; pending: Array<{ mock: string }> }>(
      mcp.client,
      "feedback",
    );
    assert.deepEqual(idle.feedback, []);
    assert.deepEqual(
      idle.pending.map((p) => p.mock),
      ["writer"],
    );

    // The user's Send goes through the viewer; the agent hears it exactly once.
    await fetchJson(
      app.url,
      `/api/mocks/${detail.id}/reply`,
      viewerJson({ answers: { look: "dark" }, tuned: { "body.size": 19 }, text: "go dark" }),
    );
    const heard = await callJson<{
      feedback: Array<{
        mock: string;
        reply: { answers: Record<string, string>; tuned: Record<string, number>; text: string };
        accepted: Array<{ variant: string }>;
        archived: Array<{ variant: string }>;
      }>;
    }>(mcp.client, "feedback");
    assert.equal(heard.feedback.length, 1);
    const batch = heard.feedback[0];
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

    const again = await callJson<{ feedback: unknown[] }>(mcp.client, "feedback");
    assert.deepEqual(again.feedback, [], "a reply is delivered once");

    const invoked = invokedTools.get(mcp.client) ?? new Set<string>();
    assert.deepEqual(
      MCP_TOOL_NAMES.filter((name) => !invoked.has(name)),
      [],
      "every advertised tool must be invoked, not merely listed",
    );
  },
);

// One session, two tiers: whichever reads first takes the Send, the other never
// sees it again, because the cursor lives on the server.
test(
  "a reply is delivered exactly once across CLI feedback and stdio feedback",
  { timeout: 20_000 },
  async (t) => {
    const app = await serveApp();
    const session = await fetchJson<{ id: string }>(
      app.url,
      "/api/sessions",
      viewerJson({ agent: "shared-agent", title: "Shared", project: PROJECT }),
    );
    const mcp = await connectMcp(app.url, { MOCKPIT_SESSION: session.id });
    t.after(async () => {
      await mcp.close();
      await app.close();
    });
    const cliFeedback = () =>
      new Promise<{ feedback: Array<{ comments: Array<{ text: string }> }> }>((resolve, reject) => {
        execFile(
          process.execPath,
          [CLI, "feedback"],
          {
            cwd: mkdtempSync(join(tmpdir(), "mockpit-mcp-cli-")),
            env: cleanEnv({ MOCKPIT_URL: app.url, MOCKPIT_SESSION: session.id }),
          },
          (err, stdout, stderr) => (err ? reject(new Error(stderr)) : resolve(JSON.parse(stdout))),
        );
      });
    const published = await callJson<WriteResult>(mcp.client, "publish", {
      mock: "writer",
      html: "<h1>T</h1>",
    });
    const userSays = (text: string) =>
      fetchJson(
        app.url,
        "/api/comments",
        viewerJson({ mock: published.mock.id, text, author: "user" }),
      );

    await userSays("first");
    const byCli = await cliFeedback();
    assert.deepEqual(
      byCli.feedback.flatMap((b) => b.comments.map((c) => c.text)),
      ["first"],
    );
    const stdioAfter = await callJson<{ feedback: unknown[] }>(mcp.client, "feedback");
    assert.deepEqual(stdioAfter.feedback, [], "stdio never redelivers what the CLI took");

    await fetchJson(app.url, `/api/mocks/${published.mock.id}/reply`, viewerJson({ text: "go" }));
    const byStdio = await callJson<{ feedback: Array<{ reply: { text: string } }> }>(
      mcp.client,
      "feedback",
    );
    assert.equal(byStdio.feedback[0].reply.text, "go");
    assert.deepEqual((await cliFeedback()).feedback, [], "the CLI never redelivers it either");
  },
);

// The never-block contract ends the agent's turn after `ask`; a resumed
// Claude Code conversation answers from a new MCP process, which must reclaim
// the session that owns the reply rather than start an empty one.
test(
  "a resumed Claude Code conversation picks up the reply sent to its old process",
  { timeout: 20_000 },
  async (t) => {
    const app = await serveApp();
    t.after(() => app.close());
    const conversation = { CLAUDE_CODE_SESSION_ID: "conv-1" };
    const first = await connectMcp(app.url, conversation);
    const published = await callJson<WriteResult>(first.client, "publish", {
      mock: "writer",
      html: "<h1>T</h1>",
    });
    await first.close();

    await fetchJson(app.url, `/api/mocks/${published.mock.id}/reply`, viewerJson({ text: "go" }));

    const other = await connectMcp(app.url, { CLAUDE_CODE_SESSION_ID: "conv-2" });
    const resumed = await connectMcp(app.url, conversation);
    t.after(async () => {
      await other.close();
      await resumed.close();
    });
    const strangers = await callJson<{ feedback: unknown[] }>(other.client, "feedback");
    assert.deepEqual(strangers.feedback, [], "another conversation does not take the reply");
    const got = await callJson<{ feedback: Array<{ reply: { text: string } }> }>(
      resumed.client,
      "feedback",
    );
    assert.equal(got.feedback[0].reply.text, "go");
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
  const published = await callJson<WriteResult>(mcp.client, "publish", {
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
      await unauthenticated.client.callTool({ name: "publish", arguments: publishArgs }),
      "publish",
    );
    assert.equal(unauthorized.isError, true);
    assert.match(unauthorized.text, /401/);

    const authorized = await connectMcp(protectedApp.url, { MOCKPIT_TOKEN: "secret" });
    connections.push(authorized);
    const published = await callJson<WriteResult>(authorized.client, "publish", publishArgs);
    assert.ok(published.post.id);

    // The server's hint (which states exist) reaches the agent verbatim.
    await callJson(authorized.client, "publish", {
      mock: "multi",
      state: "Open",
      html: "<p>open</p>",
    });
    const ambiguous = readToolText(
      await authorized.client.callTool({
        name: "publish",
        arguments: { mock: "multi", html: "<p>?</p>" },
      }),
      "publish",
    );
    assert.equal(ambiguous.isError, true);
    assert.match(ambiguous.text, /pass state/);
    assert.match(ambiguous.text, /Open/);

    const unreachable = await connectMcp("http://127.0.0.1:1");
    connections.push(unreachable);
    const failed = readToolText(
      await unreachable.client.callTool({ name: "publish", arguments: publishArgs }),
      "publish",
    );
    assert.equal(failed.isError, true);
    assert.match(failed.text, /mockpit server not reachable/);
  },
);
