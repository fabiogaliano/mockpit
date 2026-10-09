import assert from "node:assert/strict";
import { test } from "node:test";
import { serve } from "@hono/node-server";
import { createApp } from "../server/app.ts";
import { createNodeExecutor } from "../server/codeRunner.ts";
import { SqlStore } from "../server/sqlStore.ts";
import { createSqliteStorage } from "../server/sqliteStorage.ts";

// One reply stream, several ways to read it. The agentSeq cursor is shared, so a
// reply taken on any channel must never surface again on that one or another.

const PROJECT = "roundtrip";

type Batch = { mock: string; reply?: { text?: string } };

function serveApp() {
  const app = createApp({
    store: new SqlStore(createSqliteStorage()),
    viewerHtml: "<html>viewer</html>",
    topics: { html: "# guide" },
    setupText: "# setup",
    executor: createNodeExecutor({ graceMs: 200 }),
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

function toolJson(result: unknown) {
  const { content, isError } = result as { content: { text: string }[]; isError?: boolean };
  assert.ok(!isError, content[0].text);
  return JSON.parse(content[0].text);
}

// What `mockpit watch` holds open: the author=user long-poll on the cursor.
async function watchPoll(url: string, session: string, wait: number): Promise<Batch[]> {
  const res = await fetch(`${url}/api/comments?session=${session}&author=user&wait=${wait}`);
  assert.equal(res.status, 200);
  return ((await res.json()) as { feedback: Batch[] }).feedback;
}

async function feedbackRead(url: string, session: string): Promise<Batch[]> {
  const res = await fetch(`${url}/api/feedback?session=${session}`);
  assert.equal(res.status, 200);
  return ((await res.json()) as { feedback: Batch[] }).feedback;
}

async function mcpFeedback(url: string, session: string): Promise<Batch[]> {
  const body = await postJson(`${url}/mcp`, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "feedback", arguments: { session } },
  });
  return toolJson(body.result).feedback as Batch[];
}

async function runFeedback(url: string, session: string): Promise<Batch[]> {
  const out = await postJson(`${url}/api/run`, {
    session,
    code: "return (await mockpit.feedback()).feedback;",
  });
  assert.ok(out.ok, JSON.stringify(out.error));
  assert.deepEqual(out.value, out.feedback, "the envelope carries what the script read");
  return out.value as Batch[];
}

let version = 1;
async function piggyback(url: string, session: string): Promise<Batch[]> {
  const out = await postJson(`${url}/api/mocks`, {
    session,
    project: PROJECT,
    mock: "card",
    html: `<div>Card ${++version}</div>`,
  });
  return out.feedback as Batch[];
}

const replyTexts = (batches: Batch[]) => batches.map((b) => b.reply?.text);

test("a reply is delivered exactly once whichever channel reads it", async () => {
  const server = await serveApp();
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

    // `watch` blocks briefly when re-read, so a redelivery racing the cursor
    // write would show; every other channel returns at once.
    const channels: Array<[string, (block: boolean) => Promise<Batch[]>]> = [
      ["write piggyback", () => piggyback(server.url, session)],
      ["GET /api/feedback", () => feedbackRead(server.url, session)],
      ["/mcp feedback", () => mcpFeedback(server.url, session)],
      ["run mockpit.feedback()", () => runFeedback(server.url, session)],
      ["watch long-poll", (block) => watchPoll(server.url, session, block ? 1 : 0)],
    ];
    for (const [name, read] of channels) {
      await reply(`via ${name}`);
      const first = await read(false);
      assert.deepEqual(replyTexts(first), [`via ${name}`], `${name}: first read`);
      assert.equal(first[0].mock, "card");
      assert.deepEqual(await read(true), [], `${name}: second read redelivered`);
      for (const [other, otherRead] of channels) {
        assert.deepEqual(
          await otherRead(false),
          [],
          `${other} redelivered a reply taken by ${name}`,
        );
      }
    }
  } finally {
    await server.close();
  }
});

test("the watch long-poll wakes when the reply lands mid-wait", async () => {
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
    const pending = watchPoll(server.url, session, 10);
    await new Promise((r) => setTimeout(r, 100));
    await postJson(`${server.url}/api/mocks/${published.mock.id}/reply`, { text: "now" }, true);
    assert.deepEqual(replyTexts(await pending), ["now"]);
    assert.deepEqual(await feedbackRead(server.url, session), []);
  } finally {
    await server.close();
  }
});
