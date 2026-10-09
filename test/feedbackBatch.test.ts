import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFeedbackBatches, groupFeedback } from "../server/feedbackBatch.ts";
import { createSqliteStorage } from "../server/sqliteStorage.ts";
import { SqlStore } from "../server/sqlStore.ts";
import type { Comment, Mock, Post, Reply } from "../server/types.ts";

// One batch per mock is the agent-facing shape of feedback. The hard rule this
// pins: nothing the user said is ever dropped — not a comment on a mock that has
// since been deleted, not a reply that arrives after another reply.

let seq = 0;
const comment = (over: Partial<Comment> = {}): Comment => ({
  id: `c${++seq}`,
  seq,
  sessionId: "s1",
  mockId: "m1",
  postId: null,
  author: "user",
  text: "tighter",
  createdAt: "2026-09-15T00:00:00.000Z",
  kind: "comment",
  anchors: [],
  postVersion: null,
  viewport: null,
  ...over,
});

const mock = (over: Partial<Mock> = {}): Mock => ({
  id: "m1",
  project: "demo/writer",
  slug: "writer",
  title: "Writer",
  kind: "component",
  states: ["Writing"],
  asks: [
    {
      id: "look",
      text: "Which look?",
      scope: "mock",
      options: [
        { id: "quiet", label: "Quiet", variant: "quiet" },
        { id: "dark", label: "Dark", variant: "dark" },
      ],
      at: "2026-09-15T00:00:00.000Z",
    },
  ],
  knobs: {},
  draft: null,
  sessionId: "s1",
  createdAt: "2026-09-15T00:00:00.000Z",
  updatedAt: "2026-09-15T00:00:00.000Z",
  ...over,
});

const post = (over: Partial<Post> = {}): Post =>
  ({
    id: "p1",
    sessionId: "s1",
    mock: "m1",
    state: "Writing",
    variant: "quiet",
    status: "open",
    title: "Writer",
    version: 4,
    surfaces: [],
    history: [],
    slots: [],
    ...over,
  }) as Post;

const reply = (over: Partial<Reply> = {}): Reply => ({
  mockId: "m1",
  version: 4,
  answers: { look: "dark" },
  mix: {},
  tuned: { "body.size": 19 },
  comments: [{ part: "title", state: "Writing", text: "bigger" }],
  ...over,
});

test("a comment on a mock the store no longer has still becomes a batch", () => {
  const [gone, none] = groupFeedback(
    [
      comment({ mockId: "deleted" }),
      comment({ mockId: null, text: "the whole project feels cramped" }),
    ],
    new Map(),
    new Map(),
  );
  assert.equal(gone.mockId, "deleted");
  assert.equal(gone.mock, null);
  assert.equal(gone.comments[0].text, "tighter");
  assert.equal(none.mockId, null);
  assert.equal(none.comments[0].text, "the whole project feels cramped");
});

test("a reply resolves its answers to the chosen options and lists the flipped variants", () => {
  const [batch] = groupFeedback(
    [comment({ kind: "reply", text: "go dark", payload: reply({ text: "go dark" }) })],
    new Map([["m1", mock()]]),
    new Map([
      [
        "m1",
        [
          post({ id: "p1", variant: "quiet", status: "archived" }),
          post({ id: "p2", variant: "dark", status: "accepted" }),
        ],
      ],
    ]),
  );
  assert.equal(batch.mock, "writer");
  assert.equal(batch.project, "demo/writer");
  assert.ok(batch.reply);
  assert.deepEqual(batch.reply.asks, [
    {
      ask: "look",
      text: "Which look?",
      chosen: [{ id: "dark", label: "Dark", variant: "dark" }],
    },
  ]);
  assert.deepEqual(batch.reply.tuned, { "body.size": 19 });
  assert.equal(batch.reply.comments[0].part, "title");
  assert.deepEqual(batch.accepted, [{ state: "Writing", variant: "dark" }]);
  assert.deepEqual(batch.archived, [{ state: "Writing", variant: "quiet" }]);
  assert.deepEqual(batch.comments, [], "the reply is not repeated as a comment");
});

test("an answer naming an option the mock no longer has is kept by id", () => {
  const [batch] = groupFeedback(
    [comment({ kind: "reply", payload: reply({ answers: { gone: "x" } }) })],
    new Map([["m1", mock()]]),
    new Map(),
  );
  assert.deepEqual(batch.reply?.asks, [
    { ask: "gone", text: "", chosen: [{ id: "x", label: "x" }] },
  ]);
});

test("a write-in rides as an `other` choice and a note on its ask, not again as maps", () => {
  const withLang = mock({
    asks: [
      ...mock().asks,
      {
        id: "lang",
        text: "Which language?",
        scope: "mock",
        options: [{ id: "en", label: "English" }],
        at: "t",
      },
    ],
  });
  const [batch] = groupFeedback(
    [
      comment({
        kind: "reply",
        payload: reply({
          others: { lang: "Both, side by side" },
          notes: { look: "dark on desktop only", lang: "admin first" },
        }),
      }),
    ],
    new Map([["m1", withLang]]),
    new Map(),
  );
  assert.deepEqual(batch.reply?.asks, [
    {
      ask: "look",
      text: "Which look?",
      chosen: [{ id: "dark", label: "Dark", variant: "dark" }],
      note: "dark on desktop only",
    },
    {
      ask: "lang",
      text: "Which language?",
      chosen: [{ id: "other", label: "Both, side by side", other: true }],
      note: "admin first",
    },
  ]);
  assert.equal("others" in (batch.reply ?? {}), false);
  assert.equal("notes" in (batch.reply ?? {}), false);
});

test("a note alone answers its ask with nothing chosen", () => {
  const [batch] = groupFeedback(
    [comment({ kind: "reply", payload: reply({ answers: {}, notes: { look: "neither" } }) })],
    new Map([["m1", mock()]]),
    new Map(),
  );
  assert.deepEqual(batch.reply?.asks, [
    { ask: "look", text: "Which look?", chosen: [], note: "neither" },
  ]);
});

test("a second reply for the same mock starts a new batch rather than overwriting", () => {
  const batches = groupFeedback(
    [
      comment({ kind: "reply", payload: reply({ text: "one" }) }),
      comment({ text: "plain" }),
      comment({ kind: "reply", payload: reply({ text: "two" }) }),
    ],
    new Map([["m1", mock()]]),
    new Map(),
  );
  assert.equal(batches.length, 2);
  assert.equal(batches[0].reply?.text, "one");
  assert.deepEqual(
    batches[0].comments.map((c) => c.text),
    ["plain"],
  );
  assert.equal(batches[1].reply?.text, "two");
});

test("a comment's anchors, viewport and variant ride along; empty ones are omitted", () => {
  const anchored = comment({
    postId: "p1",
    anchors: [{ ref: "@1", shape: "pin", box: [0.1, 0.2], surfaceIndex: 0, postVersion: 3 }],
    viewport: 390,
    postVersion: 3,
  });
  const bare = comment({ postId: null });
  const [batch] = groupFeedback(
    [anchored, bare],
    new Map([["m1", mock()]]),
    new Map([["m1", [post()]]]),
  );
  assert.equal(batch.comments[0].variant, "quiet");
  assert.equal(batch.comments[0].state, "Writing");
  assert.equal(batch.comments[0].version, 3);
  assert.equal(batch.comments[0].viewport, 390);
  assert.equal(batch.comments[0].anchors?.length, 1);
  assert.equal(batch.comments[1].variant, null);
  assert.equal("anchors" in batch.comments[1], false);
  assert.equal("viewport" in batch.comments[1], false);
});

test("buildFeedbackBatches resolves mocks and posts from the store", async () => {
  const store = new SqlStore(createSqliteStorage());
  const session = await store.createSession({ agent: "a" });
  const m = await store.createMock({ project: "p", slug: "card", sessionId: session.id });
  const p = await store.createPost({
    sessionId: session.id,
    mock: m.id,
    state: null,
    variant: "default",
    surfaces: [{ kind: "html", html: "<p>x</p>" }],
  });
  assert.ok(p);
  const c = await store.createComment({
    sessionId: session.id,
    mockId: m.id,
    postId: p.id,
    author: "user",
    text: "hi",
  });
  assert.ok(c);
  const [batch] = await buildFeedbackBatches(store, [c], "http://x");
  assert.equal(batch.mock, "card");
  assert.equal(batch.comments[0].variant, "default");
});

test("an answer to the built-in variant ask resolves like any ask", () => {
  const posts = [
    post({ id: "p1", variant: "quiet" }),
    post({ id: "p2", variant: "dark", status: "accepted" }),
  ];
  const [batch] = groupFeedback(
    [
      comment({
        kind: "reply",
        payload: reply({ answers: { variant: "dark", "variant:Writing": "quiet" } }),
      }),
    ],
    new Map([["m1", mock({ asks: [] })]]),
    new Map([["m1", posts]]),
  );
  assert.deepEqual(
    batch.reply?.asks.map((a) => [a.ask, a.text, a.chosen.map((c) => [c.id, c.label])]),
    [
      ["variant", "Which one?", [["dark", "dark"]]],
      ["variant:Writing", "Which one?", [["quiet", "quiet"]]],
    ],
  );
});
