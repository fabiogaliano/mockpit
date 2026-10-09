import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { serve } from "@hono/node-server";
// @ts-expect-error The distributed Pi extension is intentionally standalone JavaScript.
import mockpitExtension from "../extensions/mockpit.js";
import { createApp } from "../server/app.ts";
import { SqlStore } from "../server/sqlStore.ts";
import { createSqliteStorage } from "../server/sqliteStorage.ts";

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  details?: Record<string, any>;
};

type ToolDefinition = {
  name: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: {
    properties?: Record<string, any>;
    required?: string[];
  };
  execute: (
    toolCallId: string,
    params: Record<string, any>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: ReturnType<typeof createContext>,
  ) => Promise<ToolResult>;
};

type CommandDefinition = {
  description: string;
  handler: (args: string, ctx: ReturnType<typeof createContext>) => Promise<void>;
};

type EventHandler = (event: Record<string, any>, ctx: ReturnType<typeof createContext>) => any;

function createPiHarness() {
  const tools = new Map<string, ToolDefinition>();
  const commands = new Map<string, CommandDefinition>();
  const handlers = new Map<string, EventHandler[]>();
  const pi = {
    on(name: string, handler: EventHandler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    registerCommand(name: string, definition: CommandDefinition) {
      commands.set(name, definition);
    },
    registerTool(definition: ToolDefinition) {
      tools.set(definition.name, definition);
    },
  };

  mockpitExtension(pi);

  return {
    tools,
    commands,
    eventNames: [...handlers.keys()],
    async emit(name: string, ctx: ReturnType<typeof createContext>) {
      for (const handler of handlers.get(name) ?? []) await handler({}, ctx);
    },
    tool(name: string) {
      const tool = tools.get(name);
      assert.ok(tool, `tool ${name} was registered`);
      return tool;
    },
    command(name: string) {
      const command = commands.get(name);
      assert.ok(command, `command ${name} was registered`);
      return command;
    },
  };
}

function createContext(cwd: string, branch: any[] = []) {
  const statuses: Array<{ key: string; value: string }> = [];
  const notifications: Array<{ message: string; level: string }> = [];
  return {
    cwd,
    statuses,
    notifications,
    ui: {
      setStatus(key: string, value: string) {
        statuses.push({ key, value });
      },
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
    sessionManager: {
      getBranch() {
        return branch;
      },
    },
  };
}

async function invoke(
  harness: ReturnType<typeof createPiHarness>,
  name: string,
  params: Record<string, any>,
  ctx: ReturnType<typeof createContext>,
) {
  return harness.tool(name).execute("call-1", params, undefined, undefined, ctx);
}

function startServer() {
  const store = new SqlStore(createSqliteStorage());
  const app = createApp({
    store,
    viewerHtml: "<html>viewer</html>",
    topics: { html: "# Mockpit design contract" },
    setupText: "# setup",
    authToken: "test-token",
  });

  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      resolve({
        url: `http://localhost:${info.port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            (
              server as typeof server & { closeAllConnections?: () => void }
            ).closeAllConnections?.();
          }),
      });
    });
  });
}

function text(result: ToolResult) {
  return result.content.map((block) => block.text).join("");
}

function authInit(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      authorization: "Bearer test-token",
      ...(init.body ? { "content-type": "application/json", "sec-fetch-site": "same-origin" } : {}),
      ...init.headers,
    },
  };
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, authInit({ method: "POST", body: JSON.stringify(body) }));
  assert.equal(response.ok, true);
  return response.json() as Promise<any>;
}

async function getJson(url: string) {
  const response = await fetch(url, authInit());
  assert.equal(response.ok, true);
  return response.json() as Promise<any>;
}

// Each test gets a real server and its own env, restored afterwards, because
// the extension reads its configuration from process.env on every call.
async function setup(t: { after: (fn: () => Promise<void>) => void }, session?: string) {
  const dir = mkdtempSync(join(tmpdir(), "mockpit-pi-extension-"));
  const saved = {
    MOCKPIT_URL: process.env.MOCKPIT_URL,
    MOCKPIT_TOKEN: process.env.MOCKPIT_TOKEN,
    MOCKPIT_AGENT: process.env.MOCKPIT_AGENT,
    MOCKPIT_SESSION: process.env.MOCKPIT_SESSION,
    MOCKPIT_PROJECT: process.env.MOCKPIT_PROJECT,
  };
  const server = await startServer();
  process.env.MOCKPIT_URL = `${server.url}/`;
  process.env.MOCKPIT_TOKEN = "test-token";
  process.env.MOCKPIT_AGENT = "contract-pi";
  process.env.MOCKPIT_PROJECT = "acme/site";
  if (session) process.env.MOCKPIT_SESSION = session;
  else delete process.env.MOCKPIT_SESSION;
  t.after(async () => {
    try {
      await server.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
  return { dir, server, ctx: createContext(dir) };
}

test("the extension registers the mock tool set and no trace sync", async () => {
  const harness = createPiHarness();
  assert.deepEqual(
    [...harness.tools.keys()],
    [
      "mockpit_get_design_guide",
      "mockpit_publish_mock",
      "mockpit_revise_mock",
      "mockpit_ask_user",
      "mockpit_list_mocks",
      "mockpit_get_mock",
      "mockpit_export_mock",
      "mockpit_wait_for_feedback",
      "mockpit_reply_to_user",
      "mockpit_upload_asset",
    ],
  );
  assert.deepEqual([...harness.commands.keys()], ["mockpit"]);
  assert.deepEqual(harness.eventNames, ["session_start"]);
  assert.deepEqual(harness.tool("mockpit_publish_mock").parameters.required, ["mock"]);
  assert.deepEqual(harness.tool("mockpit_ask_user").parameters.required, ["mock", "asks"]);
  assert.deepEqual(harness.tool("mockpit_reply_to_user").parameters.required, ["mock", "message"]);
  const kinds =
    harness.tool("mockpit_publish_mock").parameters.properties?.surfaces.items.properties.kind.enum;
  for (const kind of ["html", "markdown", "mermaid", "diff", "image", "terminal", "json", "code"]) {
    assert.ok(kinds.includes(kind), `publish schema includes ${kind}`);
  }
  assert.equal(kinds.includes("trace"), false);
  const guidelines = harness.tool("mockpit_publish_mock").promptGuidelines!.join("\n");
  assert.match(guidelines, /Two renders needed to show a choice/);
});

test("publish, revise, ask, list, get, wait, reply and export round-trip through a real server", async (t) => {
  const { dir, server, ctx } = await setup(t);
  const harness = createPiHarness();

  writeFileSync(join(dir, "dark.html"), '<h1 data-part="title">T</h1><p data-part="body">dark</p>');
  const quiet = await invoke(
    harness,
    "mockpit_publish_mock",
    {
      mock: "writer",
      state: "Writing",
      variant: "quiet",
      html: '<h1 data-part="title">T</h1><p data-part="body">b</p>',
      knobs: { "body.size": [17, 14, 22, 1], trim: { type: "select", options: ["top", "bottom"] } },
    },
    ctx,
  );
  assert.match(text(quiet), /^writer\/Writing\/quiet v1 · .*\/project\/acme%2Fsite\/writer/);
  assert.match(text(quiet), /parts \(Writing\): title, body/);
  assert.match(text(quiet), /nudge: knob "trim" has 2 discrete options/);
  const sessionId = quiet.details!.sessionId;
  assert.ok(sessionId);
  const session = await getJson(`${server.url}/api/sessions/${sessionId}`);
  assert.equal(session.agent, "contract-pi", "a publish that creates the session names the agent");

  // The remembered session carries the second publish; `path` reads from the cwd.
  const dark = await invoke(
    harness,
    "mockpit_publish_mock",
    { mock: "writer", state: "Writing", variant: "dark", path: "dark.html" },
    ctx,
  );
  assert.equal(dark.details!.sessionId, sessionId);

  const revised = await invoke(
    harness,
    "mockpit_revise_mock",
    { mock: "writer", state: "Writing", variant: "dark", html: '<h1 data-part="title">T2</h1>' },
    ctx,
  );
  assert.match(text(revised), /^writer\/Writing\/dark v2 · /);
  assert.match(text(revised), /part body vanished/);

  const asked = await invoke(
    harness,
    "mockpit_ask_user",
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
    ctx,
  );
  assert.match(text(asked), /^Asked on writer: Which look\? \[Quiet \| Dark\]/);

  const listed = await invoke(harness, "mockpit_list_mocks", {}, ctx);
  assert.match(text(listed), /^writer · component · Writing · 2 variants · 1 open$/);

  const got = await invoke(harness, "mockpit_get_mock", { mock: "writer", body: true }, ctx);
  assert.equal(got.details!.variants.length, 2);
  assert.match(got.details!.variants[0].surfaces[0].html, /data-part/);

  const empty = await invoke(harness, "mockpit_wait_for_feedback", { timeoutSeconds: 0 }, ctx);
  assert.equal(text(empty), "No new mockpit feedback.");

  const mockId = got.details!.id;
  await postJson(`${server.url}/api/mocks/${mockId}/reply`, {
    answers: { look: "dark" },
    tuned: { "body.size": 19 },
    comments: [{ part: "title", state: "Writing", text: "bigger" }],
    text: "go dark",
  });
  const waited = await invoke(harness, "mockpit_wait_for_feedback", { timeoutSeconds: 5 }, ctx);
  const lines = text(waited);
  assert.match(lines, /- writer: Which look\? → Dark/);
  assert.match(lines, /- writer: tuned body\.size = 19/);
  assert.match(lines, /- writer: \[title · Writing\] bigger/);
  assert.match(lines, /- writer: go dark/);
  assert.equal(waited.details!.feedback[0].reply.answers.look, "dark");
  const again = await invoke(harness, "mockpit_wait_for_feedback", { timeoutSeconds: 0 }, ctx);
  assert.equal(text(again), "No new mockpit feedback.", "a reply is delivered once");

  // A user comment left while the agent works rides back on its next write.
  await postJson(`${server.url}/api/comments`, { mock: mockId, text: "one more", author: "user" });
  const replied = await invoke(
    harness,
    "mockpit_reply_to_user",
    { mock: "writer", message: "on it" },
    ctx,
  );
  assert.match(text(replied), /^Posted mockpit reply on writer\./);
  assert.match(text(replied), /User feedback delivered with this result:\n- writer: one more/);
  assert.equal(replied.details!.author, "contract-pi");

  const exported = await invoke(harness, "mockpit_export_mock", { mock: "writer" }, ctx);
  assert.equal(exported.details!.states[0].variant, "dark");
  assert.equal(exported.details!.states[0].status, "accepted");
  assert.deepEqual(exported.details!.reply.tuned, { "body.size": 19 });
});

test("wait_for_feedback defaults to 55 seconds and caps at 230", async (t) => {
  const { server, ctx } = await setup(t);
  const harness = createPiHarness();
  const published = await invoke(
    harness,
    "mockpit_publish_mock",
    { mock: "writer", html: "<h1>T</h1>" },
    ctx,
  );
  const waits: Array<string | null> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/api/comments" && url.searchParams.has("author"))
      waits.push(url.searchParams.get("wait"));
    return realFetch(input, init);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  // Pending feedback makes each long-poll return at once, so only the query is observed.
  const mock = published.details!.mock.id;
  await postJson(`${server.url}/api/comments`, { mock, text: "one", author: "user" });
  await invoke(harness, "mockpit_wait_for_feedback", {}, ctx);
  await postJson(`${server.url}/api/comments`, { mock, text: "two", author: "user" });
  await invoke(harness, "mockpit_wait_for_feedback", { timeoutSeconds: 900 }, ctx);
  assert.deepEqual(waits, ["55", "230"]);
});

test("the design guide is the project-aware brief", async (t) => {
  const { ctx } = await setup(t);
  const harness = createPiHarness();
  const guide = await invoke(harness, "mockpit_get_design_guide", {}, ctx);
  assert.match(text(guide), /# mockpit brief/);
  assert.match(text(guide), /mockpit publish --mock/);
});

test("upload_asset reads a path, creates a session when asked, and remembers it", async (t) => {
  const { dir, ctx } = await setup(t);
  const harness = createPiHarness();
  writeFileSync(join(dir, "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const uploaded = await invoke(
    harness,
    "mockpit_upload_asset",
    { path: "@shot.png", sessionTitle: "Screens" },
    ctx,
  );
  const asset = uploaded.details!.asset;
  assert.equal(asset.contentType, "image/png");
  assert.equal(asset.filename, "shot.png");
  assert.match(text(uploaded), /^Uploaded mockpit asset /);

  // The next publish lands in the session the upload created.
  const published = await invoke(harness, "mockpit_publish_mock", { mock: "x", html: "<p/>" }, ctx);
  assert.equal(published.details!.sessionId, uploaded.details!.sessionId);

  await assert.rejects(
    invoke(harness, "mockpit_upload_asset", {}, ctx),
    /Provide either path or base64 data/,
  );
});

test("session_start restores the session from earlier mockpit tool results; /mockpit reset forgets it", async (t) => {
  const { dir } = await setup(t);
  const harness = createPiHarness();
  const branch = [
    {
      type: "message",
      message: { role: "toolResult", toolName: "bash", details: { sessionId: "nope" } },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "mockpit_publish_mock",
        details: { sessionId: "s-1" },
      },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "mockpit_upload_asset",
        details: { asset: { sessionId: "s-2" } },
      },
    },
  ];
  const ctx = createContext(dir, branch);
  await harness.emit("session_start", ctx);
  assert.deepEqual(ctx.statuses.at(-1), { key: "mockpit", value: "mockpit s-2" });

  await harness.command("mockpit").handler("", ctx);
  assert.match(ctx.notifications.at(-1)!.message, /\(session s-2\)/);
  await harness.command("mockpit").handler("reset", ctx);
  assert.match(ctx.statuses.at(-1)!.value, /^mockpit localhost:\d+$/);
  await harness.command("mockpit").handler("", ctx);
  assert.match(ctx.notifications.at(-1)!.message, /\(no session yet\)/);
});

test("wait without a session explains how to get one", async (t) => {
  const { ctx } = await setup(t);
  const harness = createPiHarness();
  await assert.rejects(
    invoke(harness, "mockpit_wait_for_feedback", {}, ctx),
    /No mockpit session yet/,
  );
});

test("server errors surface as the server's message", async (t) => {
  const { ctx } = await setup(t);
  const harness = createPiHarness();
  await assert.rejects(
    invoke(harness, "mockpit_revise_mock", { mock: "nope", html: "<p/>" }, ctx),
    /mockpit \/api\/mocks\/nope\/revise failed: acme\/site has no mock "nope"/,
  );
});
