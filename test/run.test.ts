import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createApp } from "../server/app.ts";
import { createNodeExecutor } from "../server/codeRunner.ts";
import { HTTP_MCP_TOOLS, HTTP_RUN_TOOLS } from "../server/mcpSpec.ts";
import { cut, type RunEnvelope, type RunLimits } from "../server/run.ts";
import { RUN_API, RUN_DESCRIPTION, RUN_FUNCTIONS } from "../server/runApi.ts";
import { SqlStore } from "../server/sqlStore.ts";
import { createSqliteStorage } from "../server/sqliteStorage.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "bin", "mockpit.js");
const MCP_SERVER = join(ROOT, "mcp", "server.ts");
const CT = { "content-type": "application/json" };

// Small budgets keep the limit tests fast; each test overrides what it probes.
const FAST: Partial<RunLimits> = { deadlineMs: 8_000, cpuMs: 400 };

function makeApp(
  opts: { limits?: Partial<RunLimits>; authToken?: string; executor?: boolean } = {},
) {
  const store = new SqlStore(createSqliteStorage());
  const app = createApp({
    store,
    viewerHtml: "<html>viewer</html>",
    setupText: "# setup",
    topics: { html: "# html topic", scripts: "# scripts\n\n<!-- run-api -->\n" },
    version: "",
    authToken: opts.authToken,
    ...(opts.executor === false ? {} : { executor: createNodeExecutor({ graceMs: 200 }) }),
    runLimits: { ...FAST, ...opts.limits },
  });
  return { app, store };
}
type App = ReturnType<typeof makeApp>["app"];

async function run(
  app: App,
  code: string,
  extra: Record<string, unknown> = {},
  init: RequestInit = {},
): Promise<RunEnvelope> {
  const res = await app.request("/api/run", {
    method: "POST",
    headers: CT,
    body: JSON.stringify({ code, project: "demo", ...extra }),
    ...init,
  });
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()) as RunEnvelope;
}

const viewerPost = (app: App, path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { ...CT, "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });

const AB = `
await mockpit.publish({ mock: "writer", variant: "calm", html: '<p data-part="hero">calm</p>' });
await mockpit.publish({ mock: "writer", variant: "bold", html: '<p data-part="hero">bold</p>' });
await mockpit.ask("writer", [{ id: "look", text: "Which look?",
  options: [{ label: "Calm", variant: "calm" }, { label: "Bold", variant: "bold" }] }]);
`;

test("a run returns the value, prints and every host call in order", async () => {
  const { app } = makeApp();
  const r = await run(
    app,
    `print("start", { n: 1 });
     const w = await mockpit.publish({ mock: "writer", html: '<p data-part="hero">hi</p>' });
     console.log("published", w.post.version);
     return { version: w.post.version, parts: w.parts[0].parts.map((p) => p.name) };`,
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { version: 1, parts: ["hero"] });
  assert.deepEqual(r.prints, ['start {"n":1}', "published 1"]);
  assert.deepEqual(r.calls, [{ fn: "publish", ok: true, summary: "writer/default v1" }]);
  assert.deepEqual(r.feedback, []);
  assert.ok(r.session, "the first write creates the run's session");
  const empty = await run(app, "print('nothing returned')");
  assert.equal(empty.ok, true);
  assert.equal("value" in empty, false);
});

test("a failing call rejects in the script; the calls log keeps the writes that landed", async () => {
  const { app, store } = makeApp();
  const r = await run(
    app,
    `await mockpit.publish({ mock: "writer", html: "<p>one</p>" });
await mockpit.publish({ mock: "missing", parts: { hero: "<p>two</p>" } });
return "unreached";`,
  );
  assert.equal(r.ok, false);
  assert.equal(r.error?.kind, "script");
  assert.match(r.error!.message, /missing has no variant "default"/);
  assert.equal(r.error?.line, 2);
  assert.deepEqual(
    r.calls.map((c) => [c.fn, c.ok]),
    [
      ["publish", true],
      ["publish", false],
    ],
  );
  assert.ok(await store.findMock("demo", "writer"), "the publish before the failure landed");

  const caught = await run(
    app,
    `try { await mockpit.read("nope"); } catch (e) { return "caught: " + e.message; }`,
  );
  assert.equal(caught.ok, true);
  assert.match(String(caught.value), /^caught: /);
});

test("errors carry the script's line and column", async () => {
  const { app } = makeApp();
  const thrown = await run(app, `const a = 1;\nconst b = 2;\nthrow new Error("boom");`);
  assert.deepEqual(thrown.error, { kind: "script", message: "boom", line: 3, column: 11 });
  const first = await run(app, `null.foo;`);
  assert.equal(first.error?.line, 1);
  assert.ok(first.error!.column! <= 5, "line 1 columns exclude the wrapper");
  const syntax = await run(app, `const ok = 1;\nconst = 2;`);
  assert.equal(syntax.error?.kind, "script");
  assert.match(syntax.error!.message, /^SyntaxError/);
  assert.equal(syntax.error?.line, 2);
  const ts = await run(app, `const n: number = 1;`);
  assert.match(ts.error!.message, /looks like TypeScript/);
  const stack = await run(app, `const f = () => f(); f();`);
  assert.match(stack.error!.message, /RangeError/);
  const odd = await run(app, `throw { toString() { return "plain object"; } }`);
  assert.equal(odd.error?.kind, "script");
  const bigint = await run(app, `return 1n;`);
  assert.match(bigint.error!.message, /BigInt/);
  const hang = await run(app, `await new Promise(() => {});`);
  assert.match(hang.error!.message, /never settle/);
});

test("each limit stops the script with its kind and leaves the server serving", async () => {
  const { app } = makeApp({ limits: { maxCodeBytes: 4096 } });
  const loop = await run(app, "while (true) {}");
  assert.equal(loop.error?.kind, "limit");
  assert.match(loop.error!.message, /CPU/);
  // QuickJS never reaches its interrupt inside a long sort: the watchdog's
  // terminate() is what ends this one.
  const sort = await run(
    app,
    "const a = Array.from({ length: 300000 }, (_, i) => (i * 7919) % 1000); for (;;) a.slice().sort();",
  );
  assert.equal(sort.error?.kind, "limit");
  const memory = await run(app, `const a = []; for (;;) a.push("x".repeat(1e6));`);
  assert.deepEqual(memory.error, { kind: "limit", message: "memory limit reached" });
  const caught = await run(
    app,
    `const a = []; for (;;) { try { a.push("x".repeat(1e6)); } catch {} }`,
  );
  assert.equal(caught.error?.kind, "limit");
  const big = await run(app, `return "${"x".repeat(5000)}";`);
  assert.equal(big.error?.kind, "limit");
  assert.match(big.error!.message, /code exceeds/);
  const after = await run(app, "return 6 * 7;");
  assert.equal(after.value, 42);

  const slow = makeApp({ limits: { deadlineMs: 600, cpuMs: 60_000 } }).app;
  const started = Date.now();
  const deadline = await run(slow, "while (true) {}");
  assert.equal(deadline.error?.kind, "timeout");
  assert.ok(Date.now() - started < 3_000);
});

test("host calls are capped per run and queued past the in-flight limit", async () => {
  const { app } = makeApp({ limits: { maxCalls: 3, maxInflight: 2 } });
  const many = await run(
    app,
    `const all = await Promise.all([1, 2, 3].map(() => mockpit.read()));
     await mockpit.read();`,
  );
  assert.equal(many.error?.kind, "script");
  assert.match(many.error!.message, /call limit of 3/);
  assert.deepEqual(
    many.calls.map((c) => c.ok),
    [true, true, true, false],
  );
  for (const retired of ["wait", "revise", "list", "get", "reply", "surfaces"]) {
    const gone = await run(app, `return typeof mockpit.${retired};`);
    assert.equal(gone.value, "undefined", retired);
  }
});

test("output past the cap keeps its head and tail and says so", async () => {
  const { app } = makeApp({ limits: { maxOutputChars: 2000 } });
  const prints = await run(
    app,
    `for (let i = 0; i < 100; i++) print("line " + i + " " + "y".repeat(40));`,
  );
  assert.equal(prints.truncated, true);
  assert.equal(prints.prints.at(-1), "…[further prints cut]");
  const value = await run(app, `return "a".repeat(3000) + "END";`);
  assert.equal(value.truncated, true);
  assert.match(String(value.value), /chars cut/);
  assert.match(String(value.value), /END"$/);
  assert.equal(cut("short", 10), "short");
});

test("the sandbox has no network, modules, timers or process", async () => {
  const { app } = makeApp();
  const probe = await run(
    app,
    `return {
      fetch: typeof fetch, require: typeof require, process: typeof process,
      setTimeout: typeof setTimeout, WebAssembly: typeof WebAssembly, XMLHttpRequest: typeof XMLHttpRequest,
      viaFunction: Function("return typeof process")(),
      viaConstructor: mockpit.publish.constructor.constructor("return typeof require")(),
      globals: Object.getOwnPropertyNames(globalThis).filter((k) => /^[a-z]/.test(k)).sort(),
    };`,
  );
  assert.equal(probe.ok, true, JSON.stringify(probe.error));
  const v = probe.value as Record<string, unknown>;
  for (const key of [
    "fetch",
    "require",
    "process",
    "setTimeout",
    "WebAssembly",
    "XMLHttpRequest",
  ]) {
    assert.equal(v[key], "undefined", key);
  }
  assert.equal(v.viaFunction, "undefined");
  assert.equal(v.viaConstructor, "undefined");
  assert.ok(!(v.globals as string[]).includes("std"));
  const imported = await run(app, `await import("node:fs");`);
  assert.equal(imported.error?.kind, "script");
  assert.match(imported.error!.message, /could not load module/);
  const frozen = await run(app, `mockpit.publish = () => 1; return typeof mockpit.publish;`);
  assert.equal(frozen.value, "function");
});

test("a run needs the workspace token like any write", async () => {
  const { app } = makeApp({ authToken: "secret" });
  const body = JSON.stringify({ code: "return 1" });
  const none = await app.request("/api/run", { method: "POST", headers: CT, body });
  assert.equal(none.status, 401);
  const bad = await app.request("/api/run", {
    method: "POST",
    headers: { ...CT, authorization: "Bearer wrong" },
    body,
  });
  assert.equal(bad.status, 401);
  const good = await app.request("/api/run", {
    method: "POST",
    headers: { ...CT, authorization: "Bearer secret" },
    body,
  });
  assert.equal(good.status, 200);
  assert.equal(((await good.json()) as RunEnvelope).value, 1);
});

test("a run checks its input, its session and the concurrent-run cap", async () => {
  const { app } = makeApp({ limits: { maxRuns: 1, cpuMs: 5_000 } });
  const post = (body: unknown) =>
    app.request("/api/run", { method: "POST", headers: CT, body: JSON.stringify(body) });
  assert.equal((await post({})).status, 400);
  assert.equal(
    (await app.request("/api/run", { method: "POST", headers: CT, body: "{" })).status,
    400,
  );
  assert.equal((await post({ code: "1", session: "nope" })).status, 404);

  const first = await run(app, `await mockpit.publish({ mock: "m", html: "<p>x</p>" });`);
  const holding = run(app, "const t = Date.now(); while (Date.now() - t < 800) {}", {
    session: first.session,
  });
  await new Promise((r) => setTimeout(r, 200));
  const busy = await post({ code: "return 1" });
  assert.equal(busy.status, 503);
  await holding;
  assert.equal((await post({ code: "return 1" })).status, 200);
});

test("without an executor, run says it is unavailable on every tier", async () => {
  const { app } = makeApp({ executor: false });
  const res = await app.request("/api/run", {
    method: "POST",
    headers: CT,
    body: JSON.stringify({ code: "return 1" }),
  });
  assert.equal(res.status, 501);
  assert.match(((await res.json()) as { error: string }).error, /not available on this deployment/);
  const mcp = (await (
    await app.request("/mcp?mode=code", {
      method: "POST",
      headers: CT,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "run", arguments: { code: "return 1" } },
      }),
    })
  ).json()) as { result: { isError: boolean; content: { text: string }[] } };
  assert.equal(mcp.result.isError, true);
  assert.match(mcp.result.content[0].text, /not available on this deployment/);
});

test("feedback() returns at once; a Send it read reaches the envelope even when the script then throws", async () => {
  const { app, store } = makeApp();
  const setup = await run(app, AB);
  assert.equal(setup.ok, true, JSON.stringify(setup.error));
  const mock = (await store.findMock("demo", "writer"))!;
  const nothing = await run(app, "return await mockpit.feedback();", { session: setup.session });
  assert.deepEqual(nothing.value, {
    feedback: [],
    pending: [{ mock: "writer", viewerOpen: false, draft: null }],
  });
  assert.equal(nothing.calls[0].summary, "no feedback");
  const sent = await viewerPost(app, `/api/mocks/${mock.id}/reply`, {
    answers: { look: "bold" },
    text: "bold it is",
  });
  assert.equal(sent.status, 201, await sent.clone().text());
  const r = await run(
    app,
    `const got = await mockpit.feedback();
     print("got", got.feedback.length);
     throw new Error("crashed after reading");`,
    { session: setup.session },
  );
  assert.equal(r.ok, false);
  assert.equal(r.error?.kind, "script");
  assert.deepEqual(r.prints, ["got 1"]);
  assert.equal(r.feedback.length, 1);
  assert.equal(r.feedback[0].reply?.text, "bold it is");
  assert.equal(r.feedback[0].reply?.asks[0].chosen[0].label, "Bold");
  assert.equal(r.calls.at(-1)?.summary, "1 batch(es)");
  // Delivered once: no later read returns it again.
  const again = await run(app, "return (await mockpit.feedback()).feedback;", {
    session: setup.session,
  });
  assert.deepEqual(again.value, []);
  assert.deepEqual(again.feedback, []);
});

test("feedback piggybacked on a write is in the envelope even when the run is cut off", async () => {
  const { app } = makeApp({ limits: { cpuMs: 300 } });
  const setup = await run(app, AB);
  const comment = await viewerPost(app, "/api/comments", {
    mock: "writer",
    project: "demo",
    session: setup.session,
    author: "user",
    text: "make it warmer",
  });
  assert.equal(comment.status, 201);
  const r = await run(
    app,
    `await mockpit.publish({ mock: "writer", variant: "calm", html: '<p data-part="hero">warm</p>' });
     while (true) {}`,
    { session: setup.session },
  );
  assert.equal(r.error?.kind, "limit");
  assert.deepEqual(
    r.feedback.flatMap((b) => b.comments.map((c) => c.text)),
    ["make it warmer"],
  );
});

test("aborting the request aborts the run without moving the cursor", async () => {
  const { app, store } = makeApp({ limits: { cpuMs: 30_000, deadlineMs: 30_000 } });
  const setup = await run(app, AB);
  const sessionId = setup.session!;
  const mock = (await store.findMock("demo", "writer"))!;
  await viewerPost(app, `/api/mocks/${mock.id}/reply`, { text: "before the abort" });
  const before = (await store.getSession(sessionId))!.agentSeq;
  const controller = new AbortController();
  const started = Date.now();
  const pending = run(
    app,
    "while (true) {}",
    { session: sessionId },
    {
      signal: controller.signal,
    },
  );
  await new Promise((r) => setTimeout(r, 300));
  controller.abort();
  const r = await pending;
  assert.equal(r.error?.kind, "aborted");
  assert.ok(Date.now() - started < 3_000);
  assert.equal((await store.getSession(sessionId))!.agentSeq, before);
  // The Send is still there for the next read.
  const next = await run(app, "return (await mockpit.feedback()).feedback;", {
    session: sessionId,
  });
  assert.equal((next.value as { reply: { text: string } }[])[0].reply.text, "before the abort");

  const early = new AbortController();
  early.abort();
  const never = await run(app, "return 1", {}, { signal: early.signal });
  assert.equal(never.error?.kind, "aborted");
});

test("every host function reaches its flow", async () => {
  const { app } = makeApp();
  const png = Buffer.from("\x89PNG\r\n\x1a\n pixels").toString("base64");
  const r = await run(
    app,
    `const v = { mock: "writer", variant: "calm" };
     const first = await mockpit.publish({ ...v, title: "Writer", html: '<p data-part="hero">a</p>' });
     await mockpit.publish({ ...v, parts: { hero: '<p data-part="hero">b</p>' } });
     const [html] = first.post.surfaces;
     const added = await mockpit.publish({ ...v, surfaces: [{ id: html.id }, { kind: "markdown", markdown: "# notes" }] });
     const md = added.post.surfaces[1];
     await mockpit.publish({ ...v, surfaces: [{ id: md.id, kind: "markdown", markdown: "# edited" }, { id: html.id }] });
     const removed = await mockpit.publish({ ...v, surfaces: [{ id: md.id }] });
     await mockpit.say(v, "revised the hero");
     const asset = await mockpit.upload("${png}", { contentType: "image/png", kind: "image" });
     const listed = await mockpit.read();
     const got = await mockpit.read("writer", { body: true });
     const fb = await mockpit.feedback();
     const exported = await mockpit.export(v);
     const brief = await mockpit.guide();
     const topic = await mockpit.guide("scripts");
     let bad = "";
     try { await mockpit.guide("nope"); } catch (e) { bad = e.message; }
     return { listed: listed.mocks.map((m) => m.slug), pending: listed.pending.length,
       kinds: removed.post.surfaces.map((s) => s.kind), markdown: got.variants[0].surfaces[0].markdown,
       asset: asset.url.endsWith("/a/" + asset.id), feedback: fb.feedback.length,
       states: exported.states.length, variants: got.variants.length, brief: brief.length > 0,
       topic: topic.includes("declare const mockpit"), bad };`,
  );
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.value, {
    listed: ["writer"],
    pending: 1,
    kinds: ["markdown"],
    markdown: "# edited",
    asset: true,
    feedback: 0,
    states: 1,
    variants: 1,
    brief: true,
    topic: true,
    bad: 'unknown topic "nope"; topics: knobs, asks, surfaces, html, reply, http, scripts',
  });
  assert.deepEqual(
    r.calls.map((c) => c.fn),
    [
      "publish",
      "publish",
      "publish",
      "publish",
      "publish",
      "say",
      "upload",
      "read",
      "read",
      "feedback",
      "export",
      "guide",
      "guide",
      "guide",
    ],
  );
  assert.equal(r.calls[1].summary, "writer/calm v2");
  assert.equal(r.calls[4].summary, "writer/calm v5");
});

test("the run API text names exactly the host functions", () => {
  const block = RUN_API.slice(RUN_API.indexOf("declare const mockpit"));
  const named = [...block.matchAll(/^\s+(\w+)\(/gm)].map((m) => m[1]);
  assert.deepEqual([...named].sort(), [...RUN_FUNCTIONS].sort());
  assert.ok(RUN_DESCRIPTION.includes(RUN_API));
  // A script never waits for the user, so nothing in its API says it can.
  assert.ok(!(RUN_FUNCTIONS as readonly string[]).includes("wait"));
  assert.doesNotMatch(RUN_DESCRIPTION, /\bwait\b|200 s|timeoutSeconds/);
});

test("/mcp?mode=code lists only run, about 4.3k chars; the default catalog is unchanged", async () => {
  const { app } = makeApp();
  const rpc = async (path: string, method: string, params?: unknown) =>
    (await (
      await app.request(path, {
        method: "POST",
        headers: CT,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      })
    ).json()) as any;
  const code = await rpc("/mcp?mode=code", "tools/list");
  assert.deepEqual(
    code.result.tools.map((t: { name: string }) => t.name),
    ["run"],
  );
  assert.ok(RUN_DESCRIPTION.length < 4_600, `run description is ${RUN_DESCRIPTION.length} chars`);
  assert.ok(code.result.tools[0].outputSchema);
  const plain = await rpc("/mcp", "tools/list");
  assert.equal(plain.result.tools.length, 8);
  assert.deepEqual(plain.result.tools, HTTP_MCP_TOOLS);
  assert.deepEqual(code.result.tools, HTTP_RUN_TOOLS);
  const init = await rpc("/mcp?mode=code", "initialize", {});
  assert.match(init.result.instructions, /Call run/);

  const called = await rpc("/mcp?mode=code", "tools/call", {
    name: "run",
    arguments: { code: "print('hi'); return 1;", project: "demo" },
  });
  assert.equal(called.result.isError, undefined);
  assert.equal(called.result.structuredContent.value, 1);
  assert.deepEqual(called.result.structuredContent.prints, ["hi"]);
  const failed = await rpc("/mcp?mode=code", "tools/call", {
    name: "run",
    arguments: { code: "throw new Error('no')" },
  });
  assert.equal(failed.result.isError, true);
  assert.equal(failed.result.structuredContent.error.kind, "script");
});

test("the scripts topic carries the run API", async () => {
  const { app } = makeApp();
  const text = await (await app.request("/agent-howto?topic=scripts")).text();
  assert.ok(text.includes(RUN_API));
  assert.ok(!text.includes("<!-- run-api -->"));
});

function serveApp() {
  const { app } = makeApp({ limits: { deadlineMs: 20_000, cpuMs: 20_000 } });
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      resolve({
        url: `http://127.0.0.1:${info.port}`,
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

function cleanEnv(overrides: Record<string, string>) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("MOCKPIT_")) env[key] = value;
  }
  return { ...env, MOCKPIT_PROJECT: "run-test", ...overrides };
}

test("stdio MOCKPIT_MCP_MODE=code runs scripts by code or path", { timeout: 20_000 }, async () => {
  const server = await serveApp();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SERVER],
    cwd: ROOT,
    env: cleanEnv({ MOCKPIT_URL: server.url, MOCKPIT_MCP_MODE: "code" }),
    stderr: "pipe",
  });
  const client = new Client({ name: "run-test", version: "1.0.0" });
  try {
    await client.connect(transport, { timeout: 5_000 });
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name),
      ["run"],
    );
    assert.equal(tools[0].inputSchema.properties?.session, undefined);
    const inline = (await client.callTool({
      name: "run",
      arguments: {
        code: `const w = await mockpit.publish({ mock: "m", html: "<p>x</p>" }); return w.post.version;`,
      },
    })) as any;
    assert.equal(inline.structuredContent.value, 1);
    const dir = mkdtempSync(join(tmpdir(), "mockpit-run-"));
    const file = join(dir, "script.js");
    writeFileSync(
      file,
      `const w = await mockpit.publish({ mock: "m", html: \`<p>"quoted" \${1 + 1}</p>\` });\nreturn w.post.version;`,
    );
    const fromPath = (await client.callTool({ name: "run", arguments: { path: file } })) as any;
    assert.equal(fromPath.structuredContent.value, 2);
    assert.equal(
      fromPath.structuredContent.session,
      inline.structuredContent.session,
      "one session per conversation",
    );
    const failed = (await client.callTool({
      name: "run",
      arguments: { code: "throw new Error('x')" },
    })) as any;
    assert.equal(failed.isError, true);
    const empty = (await client.callTool({ name: "run", arguments: {} })) as any;
    assert.equal(empty.isError, true);
    assert.match(empty.content[0].text, /needs code/);

    // The client's cancel reaches the server and ends the run.
    const cancel = new AbortController();
    const waiting = client
      .callTool({ name: "run", arguments: { code: "while (true) {} return 'late';" } }, undefined, {
        signal: cancel.signal,
      })
      .catch((e: Error) => e);
    await new Promise((r) => setTimeout(r, 400));
    cancel.abort();
    assert.ok((await waiting) instanceof Error);
    const after = (await client.callTool({
      name: "run",
      arguments: { code: "return 'free';" },
    })) as any;
    assert.equal(after.structuredContent.value, "free");
  } finally {
    await client.close();
    await server.close();
  }
});

function cli(args: string[], env: Record<string, string>, stdin?: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = execFile(
      process.execPath,
      [CLI, ...args],
      { env: cleanEnv(env) },
      (err, stdout, stderr) =>
        resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr }),
    );
    if (stdin !== undefined) child.stdin!.end(stdin);
  });
}

test("mockpit run posts a file or stdin and prints the result", { timeout: 20_000 }, async () => {
  const server = await serveApp();
  const env = { MOCKPIT_URL: server.url };
  try {
    const dir = mkdtempSync(join(tmpdir(), "mockpit-run-cli-"));
    const file = join(dir, "loop.js");
    writeFileSync(
      file,
      `const w = await mockpit.publish({ mock: "cli", html: '<p data-part="hero">x</p>' });\nprint("url", w.url);\nreturn { version: w.post.version };`,
    );
    const ok = await cli(["run", file], env);
    assert.equal(ok.code, 0, ok.stderr);
    assert.match(ok.stdout, /^ok {3}publish cli\/default v1$/m);
    assert.match(ok.stdout, /^> url http/m);
    assert.match(ok.stdout, /"version": 1/);

    const json = await cli(["run", "-", "--json"], env, "return 5;");
    assert.equal(json.code, 0, json.stderr);
    assert.equal(JSON.parse(json.stdout).value, 5);

    const failed = await cli(["run", "-"], env, "\nthrow new Error('nope');");
    assert.equal(failed.code, 2);
    assert.match(failed.stdout, /^error script at 2:\d+: nope$/m);

    const missing = await cli(["run"], env);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /run needs one script/);

    const help = await cli(["run", "--help"], env);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /^mockpit run <file\|->/);
  } finally {
    await server.close();
  }
});
