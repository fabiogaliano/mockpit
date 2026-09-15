import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFeedbackBatches, groupFeedback } from "../server/feedbackBatch.ts";
import { createSqliteStorage } from "../server/sqliteStorage.ts";
import { SqlStore } from "../server/sqlStore.ts";
import type { Comment, Post, Store } from "../server/types.ts";

// One batch per item is the agent-facing shape of feedback. The hard rule this
// pins: nothing the user said is ever dropped — not a comment on a post that has
// since been deleted, not a workspace-level comment with no post at all.

let seq = 0;
const comment = (over: Partial<Comment> = {}): Comment => ({
  id: `c${++seq}`,
  seq,
  sessionId: "s1",
  postId: "p1",
  postTitle: null,
  author: "user",
  text: "tighter",
  createdAt: "2026-09-15T00:00:00.000Z",
  kind: "comment",
  anchors: [],
  draft: false,
  postVersion: null,
  viewport: null,
  ...over,
});

const post = (over: Partial<Post> = {}): Post =>
  ({
    id: "p1",
    sessionId: "s1",
    project: "acme/site",
    slug: "pricing-card",
    variant: "default",
    title: "Pricing card",
    version: 4,
    surfaces: [],
    history: [],
    ...over,
  }) as unknown as Post;

test("a comment on a post the store no longer has still becomes a batch", () => {
  const [gone, none] = groupFeedback(
    [
      comment({ postId: "deleted", postTitle: "Old card" }),
      comment({ postId: null, text: "the whole project feels cramped" }),
    ],
    new Map(),
  );
  assert.deepEqual(gone, {
    postId: "deleted",
    project: null,
    slug: null,
    variant: null,
    // the title the comment itself carried is the last trace of the item
    title: "Old card",
    version: null,
    decision: null,
    comments: [gone.comments[0]],
    archived: [],
  });
  assert.equal(none.postId, null);
  assert.equal(none.title, null);
  assert.equal(none.comments[0].text, "the whole project feels cramped");
});

test("a comment's anchors, viewport and version default rather than go missing", () => {
  const anchored = comment({ anchors: [{ kind: "point", x: 1, y: 2 } as any], viewport: 390 });
  const bare = comment({ anchors: undefined as any, postVersion: 3 });
  const [batch] = groupFeedback([anchored, bare], new Map([["p1", post()]]));

  assert.equal(batch.project, "acme/site");
  assert.equal(batch.slug, "pricing-card");
  assert.equal(batch.variant, "default");
  assert.equal(batch.version, 4, "the item's CURRENT version, not the commented-on one");
  assert.deepEqual(batch.comments[0].anchors, [{ kind: "point", x: 1, y: 2 }]);
  assert.equal(batch.comments[0].viewport, 390);
  assert.equal(batch.comments[0].version, null);
  assert.deepEqual(batch.comments[1].anchors, []);
  assert.equal(batch.comments[1].viewport, null);
  assert.equal(batch.comments[1].version, 3);
});

test("a decision is the batch's verdict, not one of its comments", () => {
  for (const kind of ["revise", "accept", "drop"] as const) {
    const [batch] = groupFeedback(
      [comment({ text: "released draft" }), comment({ kind, text: `${kind} it` })],
      new Map([["p1", post()]]),
    );
    assert.deepEqual(batch.decision, { kind, text: `${kind} it` });
    assert.equal(batch.comments.length, 1, "the decision never doubles as a comment");
  }
});

test("batch order follows the first mention of each post, and later ones merge", () => {
  const batches = groupFeedback(
    [
      comment({ postId: "a", text: "1" }),
      comment({ postId: "b", text: "2" }),
      comment({ postId: "a", text: "3" }),
    ],
    new Map(),
  );
  assert.deepEqual(
    batches.map((b) => [b.postId, b.comments.map((c) => c.text)]),
    [
      ["a", ["1", "3"]],
      ["b", ["2"]],
    ],
  );
});

test("buildFeedbackBatches resolves its own context and lists accept-archived siblings", async () => {
  const store = new SqlStore(createSqliteStorage()) as Store;
  const session = await store.createSession({ title: "t", agent: "pi", project: "acme/site" });
  const solid = (await store.createPost({
    sessionId: session.id,
    title: "Pricing card",
    surfaces: [{ kind: "markdown", markdown: "a" }],
    project: "acme/site",
    slug: "pricing-card",
    variant: "solid",
  } as any))!;
  const ghost = (await store.createPost({
    sessionId: session.id,
    title: "Pricing card",
    surfaces: [{ kind: "markdown", markdown: "b" }],
    project: "acme/site",
    slug: "pricing-card",
    variant: "ghost",
  } as any))!;
  await store.setPostStatus(ghost.id, "archived");

  const batches = await buildFeedbackBatches(store, [
    comment({ postId: solid.id, kind: "accept", text: "ship it" }),
    // a comment whose post was never stored resolves to a context-free batch
    comment({ postId: "missing", text: "and this one too" }),
  ]);
  assert.deepEqual(
    batches.map((b) => [b.slug, b.variant, b.archived]),
    [
      ["pricing-card", "solid", ["ghost"]],
      [null, null, []],
    ],
  );

  // without an accept, no archive lookup happens at all
  const plain = await buildFeedbackBatches(store, [comment({ postId: solid.id, text: "tighter" })]);
  assert.deepEqual(plain[0].archived, []);
});
