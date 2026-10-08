import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createApp } from "../server/app.ts";
import { SqlStore } from "../server/sqlStore.ts";
import { createSqliteStorage } from "../server/sqliteStorage.ts";

// One reply stream, four ways to read it. The agentSeq cursor is shared, so a
// reply taken on any channel must never surface again on that one or another.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "bin", "mockpit.js");
const MCP_SERVER = join(ROOT, "mcp", "server.ts");
const PROJECT = "roundtrip";

type Batch = { mock: string; reply?: { text?: string } };

function cleanEnv(overrides: Record<string, string>) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("MOCKPIT_")) env[key] = value;
  }
  return { ...env, MOCKPIT_PROJECT: PROJECT, ...overrides };
}

function serveApp() {
  const app = createApp({
    store: new SqlStore(createSqliteStorage()),
    viewerHtml: "<html>viewer</html>",
    guideMarkdown: "# guide",
    setupText: "# setup",
    agentHowtoText: "# agent how-to",
  });
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

const CT = { "content-type": "application/json" };

async function postJson(url: string, body: unknown, viewer = false) {
  const res = await fetch(url, {
    method: "POST",
    headers: viewer ? { ...CT, "sec-fetch-site": "same-origin" } : CT,
    body: JSON.stringify(body),
  });
  const out = (await res.json()) as any;
  assert.ok(res.ok, `${url} → ${res.status}: ${JSON.stringify(out)}`);
  return out;
}

function cliWait(url: string, session: string, timeout: number) {
  return new Promise<Batch[]>((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI, "wait", "--timeout", String(timeout)],
      {
        cwd: mkdtempSync(join(tmpdir(), "mockpit-roundtrip-")),
        env: cleanEnv({ MOCKPIT_URL: url, MOCKPIT_SESSION: session }),
      },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`cli wait failed: ${stderr}`, { cause: err }));
        const out = JSON.parse(stdout);
        resolve(out.timedOut ? out.feedback : [out]);
      },
    );
  });
}

async function connectStdio(url: string, session: string) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SERVER],
    cwd: ROOT,
    env: cleanEnv({ MOCKPIT_URL: url, MOCKPIT_SESSION: session }),
    stderr: "pipe",
  });
  const client = new Client({ name: "mockpit-roundtrip", version: "1.0.0" });
  await client.connect(transport, { timeout: 5_000 });
  return client;
}

function toolJson(result: unknown) {
  const { content, isError } = result as { content: { text: string }[]; isError?: boolean };
  assert.ok(!isError, content[0].text);
  return JSON.parse(content[0].text);
}

async function stdioWait(client: Client, timeoutSeconds: number): Promise<Batch[]> {
  const result = await client.callTool({
    name: "wait_for_feedback",
    arguments: { timeoutSeconds },
  });
  return toolJson(result).feedback;
}

async function httpMcpWait(url: string, session: string, timeoutSeconds: number) {
  const body = await postJson(`${url}/mcp`, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "wait_for_feedback", arguments: { session, timeoutSeconds } },
  });
  return toolJson(body.result).feedback as Batch[];
}

async function httpWait(url: string, session: string, wait: number): Promise<Batch[]> {
  const res = await fetch(`${url}/api/comments?session=${session}&author=user&wait=${wait}`);
  assert.equal(res.status, 200);
  return ((await res.json()) as { feedback: Batch[] }).feedback;
}

const replyTexts = (batches: Batch[]) => batches.map((b) => b.reply?.text);

test("a reply is delivered exactly once whichever channel waits for it", async () => {
  const server = await serveApp();
  let stdio: Client | undefined;
  try {
    const session = (
      await postJson(`${server.url}/api/sessions`, { agent: "roundtrip", project: PROJECT })
    ).id as string;
    const published = await postJson(`${server.url}/api/mocks`, {
      session,
      project: PROJECT,
      mock: "card",
      surfaces: [{ kind: "html", html: '<div data-part="card">Card</div>' }],
    });
    const mockId = published.mock.id as string;
    const reply = (text: string) =>
      postJson(`${server.url}/api/mocks/${mockId}/reply`, { text }, true);
    stdio = await connectStdio(server.url, session);

    const channels: Array<[string, (timeout: number) => Promise<Batch[]>]> = [
      ["cli wait", (t) => cliWait(server.url, session, t)],
      ["stdio wait_for_feedback", (t) => stdioWait(stdio!, t)],
      ["/mcp wait_for_feedback", (t) => httpMcpWait(server.url, session, t)],
      ["GET /api/comments wait", (t) => httpWait(server.url, session, t)],
    ];
    for (const [name, wait] of channels) {
      await reply(`via ${name}`);
      const first = await wait(5);
      assert.deepEqual(replyTexts(first), [`via ${name}`], `${name}: first wait`);
      assert.equal(first[0].mock, "card");
      // A short block, not 0, so a redelivery racing the cursor write would show.
      assert.deepEqual(await wait(1), [], `${name}: second wait redelivered`);
      for (const [other, otherWait] of channels) {
        assert.deepEqual(await otherWait(0), [], `${other} redelivered a reply taken by ${name}`);
      }
    }
  } finally {
    await stdio?.close();
    await server.close();
  }
});

test("a blocking wait wakes when the reply lands mid-wait", async () => {
  const server = await serveApp();
  try {
    const session = (
      await postJson(`${server.url}/api/sessions`, { agent: "roundtrip", project: PROJECT })
    ).id as string;
    const published = await postJson(`${server.url}/api/mocks`, {
      session,
      project: PROJECT,
      mock: "card",
      surfaces: [{ kind: "html", html: "<div>Card</div>" }],
    });
    const pending = httpWait(server.url, session, 10);
    await new Promise((r) => setTimeout(r, 100));
    await postJson(`${server.url}/api/mocks/${published.mock.id}/reply`, { text: "now" }, true);
    assert.deepEqual(replyTexts(await pending), ["now"]);
    assert.deepEqual(await httpWait(server.url, session, 0), []);
  } finally {
    await server.close();
  }
});
