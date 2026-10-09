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

test("the extension registers the verb set and no trace sync or wait", async () => {
  const harness = createPiHarness();
  assert.deepEqual(
    [...harness.tools.keys()],
    [
      "mockpit_publish",
      "mockpit_ask",
      "mockpit_read",
      "mockpit_feedback",
      "mockpit_say",
      "mockpit_export",
      "mockpit_upload",
      "mockpit_guide",
      "mockpit_run",
    ],
  );
  assert.deepEqual([...harness.commands.keys()], ["mockpit"]);
  assert.deepEqual(harness.eventNames, ["session_start"]);
  assert.deepEqual(harness.tool("mockpit_publish").parameters.required, ["mock"]);
  assert.deepEqual(harness.tool("mockpit_ask").parameters.required, ["mock", "asks"]);
  assert.deepEqual(harness.tool("mockpit_say").parameters.required, ["mock", "message"]);
  assert.equal(harness.tool("mockpit_feedback").parameters.properties?.timeoutSeconds, undefined);
  const surface = harness.tool("mockpit_publish").parameters.properties?.surfaces.items;
  const kinds = surface.properties.kind.enum;
  for (const kind of ["html", "markdown", "mermaid", "diff", "image", "terminal", "json", "code"]) {
    assert.ok(kinds.includes(kind), `publish schema includes ${kind}`);
  }
  assert.equal(kinds.includes("trace"), false);
  assert.ok(surface.properties.id, "a surface may be only {id}");
  assert.ok(harness.tool("mockpit_publish").parameters.properties?.parts);
  const guidelines = harness.tool("mockpit_publish").promptGuidelines!.join("\n");
  assert.match(guidelines, /A choice is several variants plus one ask that binds them/);
  assert.match(guidelines, /then end your turn/);
  assert.match(guidelines, /call mockpit_feedback/);
  const everything = [...harness.tools.values()]
    .flatMap((tool) => [tool.promptSnippet ?? "", ...(tool.promptGuidelines ?? [])])
    .join("\n");
  assert.doesNotMatch(everything, /Two renders|wait|\b55\b|\b230\b/i);
});

test("publish, ask, read, feedback, say and export round-trip through a real server", async (t) => {
  const { dir, server, ctx } = await setup(t);
  const harness = createPiHarness();
  // Only the extension's own requests count, not the test's setup and checks.
  const seen: string[] = [];
  const realFetch = globalThis.fetch;
  const extension = harness.tools;
  let recording = false;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (recording) seen.push(`${init?.method ?? "GET"} ${url.pathname}`);
    return realFetch(input, init);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  const invoke = async (
    _h: typeof harness,
    name: string,
    params: Record<string, any>,
    c: typeof ctx,
  ) => {
    recording = true;
    try {
      return await extension.get(name)!.execute("call-1", params, undefined, undefined, c);
    } finally {
      recording = false;
    }
  };

  writeFileSync(join(dir, "dark.html"), '<h1 data-part="title">T</h1><p data-part="body">dark</p>');
  const quiet = await invoke(
    harness,
    "mockpit_publish",
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
    "mockpit_publish",
    { mock: "writer", state: "Writing", variant: "dark", path: "dark.html" },
    ctx,
  );
  assert.equal(dark.details!.sessionId, sessionId);
  assert.match(text(dark), /nudge: .*no ask binds them/);
  assert.match(text(dark), /suggestedAsk \(send with mockpit_ask\): \{"id":"variant"/);

  const revised = await invoke(
    harness,
    "mockpit_publish",
    { mock: "writer", state: "Writing", variant: "dark", html: '<h1 data-part="title">T2</h1>' },
    ctx,
  );
  assert.match(text(revised), /^writer\/Writing\/dark v2 · /);
  assert.match(text(revised), /part body vanished/);

  const spliced = await invoke(
    harness,
    "mockpit_publish",
    {
      mock: "writer",
      state: "Writing",
      variant: "dark",
      parts: { title: '<h1 data-part="title">T3</h1>' },
    },
    ctx,
  );
  assert.match(text(spliced), /^writer\/Writing\/dark v3 · /);
  assert.match(text(spliced), /applied: title/);

  const asked = await invoke(
    harness,
    "mockpit_ask",
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

  const listed = await invoke(harness, "mockpit_read", {}, ctx);
  assert.match(text(listed), /^writer · component · Writing · 2 variants · 1 open$/m);
  assert.equal(listed.details!.pending[0].mock, "writer");

  const got = await invoke(harness, "mockpit_read", { mock: "writer", body: true }, ctx);
  assert.equal(got.details!.variants.length, 2);
  assert.match(got.details!.variants[0].surfaces[0].html, /data-part/);
  assert.equal(got.details!.pending.mock, "writer");

  const empty = await invoke(harness, "mockpit_feedback", {}, ctx);
  assert.equal(text(empty), "No new mockpit feedback.");
  assert.deepEqual(empty.details!.pending, [{ mock: "writer", viewerOpen: false, draft: null }]);

  const mockId = got.details!.id;
  await fetch(
    `${server.url}/api/mocks/${mockId}/draft`,
    authInit({ method: "PUT", body: JSON.stringify({ answers: { look: "dark" } }) }),
  );
  const drafting = await invoke(harness, "mockpit_feedback", {}, ctx);
  assert.match(
    text(drafting),
    /No new mockpit feedback\.\nPending:\n- writer: the user is answering \(1 of 1 answered, 0 comments\)/,
  );

  await postJson(`${server.url}/api/mocks/${mockId}/reply`, {
    answers: { look: "dark" },
    tuned: { "body.size": 19 },
    comments: [{ part: "title", state: "Writing", text: "bigger" }],
    text: "go dark",
  });
  const heard = await invoke(harness, "mockpit_feedback", {}, ctx);
  const lines = text(heard);
  assert.match(lines, /- writer: Which look\? → Dark/);
  assert.match(lines, /- writer: tuned body\.size = 19/);
  assert.match(lines, /- writer: \[title · Writing\] bigger/);
  assert.match(lines, /- writer: go dark/);
  assert.equal(heard.details!.feedback[0].reply.answers.look, "dark");
  const again = await invoke(harness, "mockpit_feedback", {}, ctx);
  assert.equal(text(again), "No new mockpit feedback.", "a reply is delivered once");

  // A user comment left while the agent works rides back on its next write.
  await postJson(`${server.url}/api/comments`, { mock: mockId, text: "one more", author: "user" });
  const said = await invoke(harness, "mockpit_say", { mock: "writer", message: "on it" }, ctx);
  assert.match(text(said), /^Said on writer\./);
  assert.match(text(said), /User feedback delivered with this result:\n- writer: one more/);
  const thread = await getJson(`${server.url}/api/comments?mock=${mockId}`);
  const agentLine = thread.comments.find((c: any) => c.text === "on it");
  assert.equal(agentLine.author, "contract-pi");

  const exported = await invoke(harness, "mockpit_export", { mock: "writer" }, ctx);
  assert.equal(exported.details!.states[0].variant, "dark");
  assert.equal(exported.details!.states[0].status, "accepted");
  assert.deepEqual(exported.details!.reply.tuned, { "body.size": 19 });

  assert.deepEqual([...new Set(seen)].sort(), [
    "GET /api/feedback",
    "GET /api/mocks",
    "GET /api/mocks/writer",
    "GET /api/mocks/writer/export",
    "POST /api/mocks",
    "POST /api/mocks/writer/asks",
    "POST /api/mocks/writer/say",
  ]);
});

test("publish takes the full ordered surface list", async (t) => {
  const { ctx } = await setup(t);
  const harness = createPiHarness();
  const first = await invoke(
    harness,
    "mockpit_publish",
    {
      mock: "notes",
      surfaces: [
        { kind: "html", html: "<p>n</p>" },
        { kind: "markdown", markdown: "# a" },
      ],
    },
    ctx,
  );
  const [htmlId, mdId] = first.details!.post.surfaces.map((s: any) => s.id);
  const moved = await invoke(
    harness,
    "mockpit_publish",
    { mock: "notes", surfaces: [{ id: mdId }, { id: htmlId }] },
    ctx,
  );
  assert.deepEqual(
    moved.details!.post.surfaces.map((s: any) => s.kind),
    ["markdown", "html"],
  );
  const removed = await invoke(
    harness,
    "mockpit_publish",
    { mock: "notes", surfaces: [{ id: htmlId }] },
    ctx,
  );
  assert.deepEqual(
    removed.details!.post.surfaces.map((s: any) => s.kind),
    ["html"],
  );
});

test("the guide is the project-aware brief, or one topic", async (t) => {
  const { ctx } = await setup(t);
  const harness = createPiHarness();
  const guide = await invoke(harness, "mockpit_guide", {}, ctx);
  assert.match(text(guide), /# mockpit brief/);
  assert.match(text(guide), /mockpit publish --mock/);
  const topic = await invoke(harness, "mockpit_guide", { topic: "html" }, ctx);
  assert.equal(text(topic), "# Mockpit design contract");
});

test("upload reads a path, creates a session, and remembers it", async (t) => {
  const { dir, ctx } = await setup(t);
  const harness = createPiHarness();
  writeFileSync(join(dir, "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const uploaded = await invoke(
    harness,
    "mockpit_upload",
    { path: "@shot.png", sessionTitle: "Screens" },
    ctx,
  );
  const asset = uploaded.details!.asset;
  assert.equal(asset.contentType, "image/png");
  assert.equal(asset.filename, "shot.png");
  assert.match(text(uploaded), /^Uploaded mockpit asset /);

  // The next publish lands in the session the upload created.
  const published = await invoke(harness, "mockpit_publish", { mock: "x", html: "<p/>" }, ctx);
  assert.equal(published.details!.sessionId, uploaded.details!.sessionId);

  await assert.rejects(
    invoke(harness, "mockpit_upload", {}, ctx),
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
        toolName: "mockpit_publish",
        details: { sessionId: "s-1" },
      },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "mockpit_upload",
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

test("feedback before any write starts a session the next publish reuses", async (t) => {
  const { ctx } = await setup(t);
  const harness = createPiHarness();
  const first = await invoke(harness, "mockpit_feedback", {}, ctx);
  assert.equal(text(first), "No new mockpit feedback.");
  const published = await invoke(harness, "mockpit_publish", { mock: "x", html: "<p/>" }, ctx);
  assert.equal(published.details!.sessionId, first.details!.sessionId);
});

test("server errors surface as the server's message", async (t) => {
  const { ctx } = await setup(t);
  const harness = createPiHarness();
  await assert.rejects(
    invoke(harness, "mockpit_publish", { mock: "nope", parts: { a: "<p/>" } }, ctx),
    /mockpit \/api\/mocks failed: nope has no variant "default"/,
  );
});

test("run posts the script to /api/run; empty code is refused locally", async (t) => {
  const { ctx } = await setup(t);
  const harness = createPiHarness();
  await assert.rejects(invoke(harness, "mockpit_run", {}, ctx), /Provide code, or path/);
  // This server has no sandbox, so reaching it proves the route.
  await assert.rejects(
    invoke(harness, "mockpit_run", { code: "return 1;" }, ctx),
    /mockpit \/api\/run failed: run is not available on this deployment/,
  );
});
