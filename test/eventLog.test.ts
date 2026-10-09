import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../server/app.ts";
import type { LogEntry } from "../server/eventLog.ts";
import { createFileLog } from "../server/logFile.ts";
import { SqlStore } from "../server/sqlStore.ts";
import { createSqliteStorage } from "../server/sqliteStorage.ts";

function logged(opts: { authToken?: string; sink?: (e: LogEntry) => void } = {}) {
  const entries: LogEntry[] = [];
  const app = createApp({
    store: new SqlStore(createSqliteStorage()),
    viewerHtml: "<html><head></head><body>viewer</body></html>",
    topics: { html: "# guide" },
    setupText: "# setup",
    authToken: opts.authToken,
    log: opts.sink ?? ((e) => entries.push(e)),
  });
  return { app, entries };
}

const CT = { "content-type": "application/json" };
const cli = (body: unknown, method = "POST") => ({
  method,
  headers: { ...CT, "x-mockpit-client": "cli/9.9.9" },
  body: JSON.stringify(body),
});
const viewer = (body: unknown, method = "POST") => ({
  method,
  headers: { ...CT, "sec-fetch-site": "same-origin" },
  body: JSON.stringify(body),
});

const last = (entries: LogEntry[]) => entries[entries.length - 1];

test("one loop, logged: who published, the Send's seq, and the feedback that delivered it", async () => {
  const { app, entries } = logged();
  const pub: any = await (
    await app.request(
      "/api/mocks",
      cli({ project: "demo", mock: "writer", variant: "quiet", html: "<h1>T</h1>" }),
    )
  ).json();
  const { mockId, session } = { mockId: pub.mock.id, session: pub.sessionId };
  assert.deepEqual(
    { ...last(entries), t: typeof last(entries).t, ms: typeof last(entries).ms },
    {
      t: "string",
      op: "POST /api/mocks",
      client: "cli/9.9.9",
      status: 201,
      ms: "number",
      session,
      project: "demo",
      mock: "writer",
      state: null,
      variant: "quiet",
      version: 1,
    },
  );

  await app.request(
    `/api/mocks/${mockId}/asks`,
    cli({ session, asks: [{ id: "size", text: "Size?", options: ["S", "L"] }] }),
  );
  await app.request(`/api/mocks/${mockId}/draft`, viewer({ answers: { size: "s" } }, "PUT"));
  const before = entries.length;
  // The viewer's reads refetch on every feed event; they would drown the log.
  await app.request(`/api/mocks/${mockId}`, { headers: { "sec-fetch-site": "same-origin" } });
  assert.equal(entries.length, before);

  const sent: any = await (await app.request(`/api/mocks/${mockId}/reply`, viewer({}))).json();
  assert.equal(last(entries).client, "viewer");
  assert.equal(last(entries).reply, sent.reply.seq);

  await app.request(`/api/feedback?session=${session}`);
  assert.equal(last(entries).op, "GET /api/feedback");
  assert.equal(last(entries).client, "http");
  assert.equal(last(entries).session, session);
  assert.deepEqual(last(entries).delivered, [sent.reply.seq]);
});

test("an MCP tool call is logged by tool name, its result read back from the tool content", async () => {
  const { app, entries } = logged();
  const rpc = (name: string, args: unknown) =>
    app.request("/mcp", {
      method: "POST",
      headers: CT,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
  await rpc("publish", { project: "demo", mock: "card", variant: "a", html: "<p>a</p>" });
  assert.equal(last(entries).op, "mcp publish");
  assert.equal(last(entries).client, "mcp-http");
  assert.equal(last(entries).mock, "card");
  assert.equal(last(entries).version, 1);
  await rpc("publish", { project: "demo", mock: "card", variant: "b", html: "<p>b</p>" });
  assert.equal(last(entries).nudges, 1, "the unbound-variants nudge is counted");

  await rpc("read", { mock: "nope", project: "demo" });
  assert.equal(last(entries).op, "mcp read");
  assert.match(last(entries).error ?? "", /nope/);
});

test("the live feed logs its open and close with the mock on screen", async () => {
  const { app, entries } = logged();
  const ac = new AbortController();
  const res = await app.request("/api/events?viewing=m1", {
    signal: ac.signal,
    headers: { "sec-fetch-site": "same-origin" },
  });
  assert.equal(last(entries).op, "GET /api/events");
  assert.equal(last(entries).viewing, "m1");
  ac.abort();
  await res.body!.cancel().catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(last(entries).op, "sse close");
  assert.equal(last(entries).viewing, "m1");
});

test("a denied call is logged, and a throwing sink never fails the call", async () => {
  const { app, entries } = logged({ authToken: "secret" });
  await app.request("/api/feedback?session=x");
  assert.equal(last(entries).status, 401);
  assert.match(last(entries).error ?? "", /unauthorized/);

  const broken = logged({
    sink: () => {
      throw new Error("disk full");
    },
  });
  const res = await broken.app.request(
    "/api/mocks",
    cli({ project: "demo", mock: "w", variant: "a", html: "<p>a</p>" }),
  );
  assert.equal(res.status, 201);
});

test("a junk client header falls back to the tier the request came from", async () => {
  const { app, entries } = logged();
  await app.request("/api/mocks?project=demo", { headers: { "x-mockpit-client": "a b<script>" } });
  assert.equal(last(entries).client, "http");
});

test("the file log appends JSONL and rolls to .1 past its cap", () => {
  const dir = mkdtempSync(join(tmpdir(), "mockpit-log-"));
  try {
    const path = join(dir, "nested", "events.jsonl");
    const entry: LogEntry = { t: "x", op: "GET /api/feedback", client: "http", status: 200, ms: 1 };
    const sink = createFileLog(path, 150);
    sink(entry);
    sink(entry);
    assert.equal(readFileSync(path, "utf8").trim().split("\n").length, 2);
    sink(entry);
    assert.equal(readFileSync(`${path}.1`, "utf8").trim().split("\n").length, 2);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), entry);
    // A restart picks up the size already on disk.
    createFileLog(path, 150)(entry);
    assert.equal(readFileSync(path, "utf8").trim().split("\n").length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
