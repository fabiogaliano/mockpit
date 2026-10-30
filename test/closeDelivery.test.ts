import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../server/app.ts";
import { createSqliteStorage } from "../server/sqliteStorage.ts";
import { SqlStore } from "../server/sqlStore.ts";

// Closing a mock from the project list dismisses its open questions unanswered. The
// agent must hear that exactly once, on the same cursor as a Send, and must not
// be able to ask a dismissed question again: both halves lose the user's
// intent silently if they regress.
function makeApp() {
  return createApp({
    store: new SqlStore(createSqliteStorage()),
    viewerHtml: "<html>v</html>",
    topics: { html: "#" },
    setupText: "#",
  });
}

const post = (body: unknown, viewer = false) => ({
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(viewer ? { "sec-fetch-site": "same-origin" } : {}),
  },
  body: JSON.stringify(body),
});

test("a close dismisses the open questions, is delivered once, and blocks re-asking them", async () => {
  const app = makeApp();
  const call = async (path: string, init?: RequestInit) => {
    const res = await app.request(path, init);
    const body = (await res.json()) as any;
    assert.ok(res.ok, `${path} → ${res.status}: ${JSON.stringify(body)}`);
    return body;
  };
  const pub = await call("/api/mocks", post({ project: "p", mock: "card", html: "<p>x</p>" }));
  const { sessionId: session } = pub;
  const mockId = pub.mock.id as string;
  await call(
    `/api/mocks/${mockId}/asks`,
    post({
      session,
      asks: [
        { id: "tone", text: "Which tone?", options: ["Warm", "Plain"] },
        { id: "size", text: "Which size?", options: ["S", "L"] },
      ],
    }),
  );
  // One answered and delivered before the user gives up on the other.
  await call(`/api/mocks/${mockId}/reply`, post({ answers: { tone: "warm" } }, true));
  const sent = await call(`/api/feedback?session=${session}`);
  assert.equal(sent.feedback.length, 1);
  assert.equal(sent.feedback[0].reply.answers.tone, "warm");

  const forbidden = await app.request(`/api/mocks/${mockId}/close`, post({}));
  assert.equal(forbidden.status, 403, "only the user's viewer closes");

  const closed = await call(`/api/mocks/${mockId}/close`, post({}, true));
  assert.deepEqual(closed.dismissed, ["size"]);
  assert.equal(closed.mock.open, 0);
  assert.ok(closed.mock.closedAt);

  const heard = await call(`/api/feedback?session=${session}`);
  assert.equal(heard.feedback.length, 1);
  const batch = heard.feedback[0];
  assert.equal(batch.mock, "card");
  assert.equal(batch.closed, true);
  assert.equal(batch.reply, null);
  assert.deepEqual(batch.dismissed, [{ ask: "size", text: "Which size?" }]);
  assert.equal(
    heard.pending.find((p: any) => p.mock === "card")?.closed,
    true,
    "pending says the mock is closed",
  );
  assert.deepEqual((await call(`/api/feedback?session=${session}`)).feedback, [], "once only");

  const read = await call(`/api/mocks/${mockId}`);
  assert.equal(read.asks.find((a: any) => a.id === "tone").answer, "warm", "answers are kept");
  assert.equal(read.asks.find((a: any) => a.id === "size").dismissed, true);
  assert.equal((await call("/api/mocks?project=p")).open, 0);

  // Asking it again is refused with a nudge, and the mock stays closed.
  const again = await call(
    `/api/mocks/${mockId}/asks`,
    post({ session, asks: [{ id: "size", text: "Which size, really?", options: ["S", "L"] }] }),
  );
  assert.deepEqual(again.asks, []);
  assert.deepEqual(again.skipped, ["size"]);
  assert.match(again.nudges[0], /dismissed/);
  const still = await call(`/api/mocks/${mockId}`);
  assert.ok(still.closedAt);
  assert.equal(still.asks.find((a: any) => a.id === "size").text, "Which size?");

  // Reopen revives what the close dismissed.
  const reopened = await call(`/api/mocks/${mockId}/reopen`, post({}, true));
  assert.equal(reopened.mock.closedAt, null);
  assert.equal(reopened.mock.open, 1);
  assert.deepEqual((await call(`/api/feedback?session=${session}`)).feedback, []);
});

test("a new question on a closed mock brings it back to the open list", async () => {
  const app = makeApp();
  const call = async (path: string, init?: RequestInit) =>
    (await app.request(path, init)).json() as any;
  const pub = await call("/api/mocks", post({ project: "p", mock: "card", html: "<p>x</p>" }));
  const mockId = pub.mock.id as string;
  await call(`/api/mocks/${mockId}/close`, post({}, true));
  const asked = await call(
    `/api/mocks/${mockId}/asks`,
    post({ session: pub.sessionId, asks: [{ id: "new", text: "New?", options: ["Y", "N"] }] }),
  );
  assert.equal(asked.open, 1);
  assert.equal((await call(`/api/mocks/${mockId}`)).closedAt, null);
});
