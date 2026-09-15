// The agent-facing shape of feedback: one batch per post, in delivery order.
// Waits, `author=user` reads and the `userFeedback` piggyback all return this,
// so an agent reads one grouped object instead of re-deriving which item a
// flat comment list belongs to. Runtime-agnostic (no node imports).

import type { Comment, Post, Store } from "./types.ts";

export interface FeedbackDecision {
  kind: "revise" | "accept" | "drop";
  text: string;
}

export interface FeedbackComment {
  seq: number;
  text: string;
  anchors: Comment["anchors"];
  viewport: number | null;
  version: number | null;
}

export interface FeedbackBatch {
  postId: string | null;
  project: string | null;
  slug: string | null;
  variant: string | null;
  // The item's human title — what the operator sees on the card, so the agent
  // can name the thing it is being asked to change without a second read.
  title: string | null;
  version: number | null;
  decision: FeedbackDecision | null;
  comments: FeedbackComment[];
  // Sibling variants archived by an `accept` decision, by variant label.
  archived: string[];
}

const DECISION_KINDS = new Set(["revise", "accept", "drop"]);

const commentView = (c: Comment): FeedbackComment => ({
  seq: c.seq,
  text: c.text,
  anchors: c.anchors ?? [],
  viewport: c.viewport ?? null,
  version: c.postVersion ?? null,
});

// Comments arrive in seq order; keep that order both between batches (first
// mention of a post decides its place) and inside one. A comment whose post is
// unknown still gets a batch — feedback is never dropped for want of context.
export function groupFeedback(
  comments: Comment[],
  posts: Map<string, Post>,
  archivedByPost?: Map<string, string[]>,
): FeedbackBatch[] {
  const batches: FeedbackBatch[] = [];
  const byPost = new Map<string, FeedbackBatch>();
  for (const c of comments) {
    const key = c.postId ?? "";
    let batch = byPost.get(key);
    if (!batch) {
      const post = c.postId ? posts.get(c.postId) : undefined;
      batch = {
        postId: c.postId,
        project: post?.project ?? null,
        slug: post?.slug ?? null,
        variant: post?.variant ?? null,
        title: post?.title ?? c.postTitle ?? null,
        version: post?.version ?? null,
        decision: null,
        comments: [],
        archived: (c.postId && archivedByPost?.get(c.postId)) || [],
      };
      byPost.set(key, batch);
      batches.push(batch);
    }
    if (DECISION_KINDS.has(c.kind)) {
      // A decision is the batch's verdict, not one of its comments — the
      // released drafts ride in `comments` beside it.
      batch.decision = { kind: c.kind as FeedbackDecision["kind"], text: c.text };
      continue;
    }
    batch.comments.push(commentView(c));
  }
  return batches;
}

// The same grouping, resolving its own context from the store — for callers
// that hold a Store but not the app's internals (the MCP tier).
export async function buildFeedbackBatches(
  store: Store,
  comments: Comment[],
): Promise<FeedbackBatch[]> {
  const posts = new Map<string, Post>();
  for (const c of comments) {
    if (c.postId && !posts.has(c.postId)) {
      const post = await store.getPost(c.postId);
      if (post) posts.set(c.postId, post);
    }
  }
  const archived = new Map<string, string[]>();
  for (const [id, post] of posts) {
    if (!comments.some((c) => c.postId === id && c.kind === "accept")) continue;
    const item = await store.getItem(post.project, post.slug);
    archived.set(
      id,
      (item?.variants ?? [])
        .filter((v) => v.postId !== id && v.status === "archived")
        .map((v) => v.variant),
    );
  }
  return groupFeedback(comments, posts, archived);
}
