// The agent-facing shape of feedback: one batch per mock, in delivery order.
// Waits, `author=user` reads and the `userFeedback` piggyback all return this,
// so an agent reads one grouped object instead of re-deriving which mock a flat
// comment list belongs to. Runtime-agnostic (no node imports).

import type { AskOption, Comment, CommentAnchor, Mock, Post, Reply, Store } from "./types.ts";

export interface VariantRef {
  state: string | null;
  variant: string;
}

export interface FeedbackComment {
  seq: number;
  text: string;
  state: string | null;
  variant: string | null;
  version: number | null;
  anchor?: CommentAnchor;
  anchors?: Comment["anchors"];
  viewport?: number;
}

// An answered ask, resolved to the options the user chose, so the agent reads
// "Look → dark" without cross-referencing ids.
export interface AnsweredAsk {
  ask: string;
  text: string;
  chosen: AskOption[];
}

export interface FeedbackReply extends Reply {
  seq: number;
  at: string;
  asks: AnsweredAsk[];
}

export interface FeedbackBatch {
  mockId: string | null;
  project: string | null;
  mock: string | null;
  title: string | null;
  reply: FeedbackReply | null;
  comments: FeedbackComment[];
  // The variants the reply left accepted / archived (restorable).
  accepted: VariantRef[];
  archived: VariantRef[];
}

const ref = (p: Post): VariantRef => ({ state: p.state, variant: p.variant });

function answered(reply: Reply, mock: Mock | undefined): AnsweredAsk[] {
  const out: AnsweredAsk[] = [];
  for (const [askId, answer] of Object.entries(reply.answers)) {
    const ask = mock?.asks.find((a) => a.id === askId);
    const ids = Array.isArray(answer) ? answer : [answer];
    out.push({
      ask: askId,
      text: ask?.text ?? "",
      chosen: ids.map((id) => ask?.options.find((o) => o.id === id) ?? { id, label: id }),
    });
  }
  return out;
}

// Comments arrive in seq order; keep that order both between batches and inside
// one. A mock gets a fresh batch whenever a second reply arrives for it, so a
// batch carries at most one reply and nothing is merged away. A comment whose
// mock is unknown still gets a batch — feedback is never dropped for want of
// context.
export function groupFeedback(
  comments: Comment[],
  mocks: Map<string, Mock>,
  posts: Map<string, Post[]>,
): FeedbackBatch[] {
  const batches: FeedbackBatch[] = [];
  const open = new Map<string, FeedbackBatch>();
  for (const c of comments) {
    const key = c.mockId ?? "";
    const mock = c.mockId ? mocks.get(c.mockId) : undefined;
    const mockPosts = (c.mockId && posts.get(c.mockId)) || [];
    let batch = open.get(key);
    if (!batch || (c.kind === "reply" && batch.reply)) {
      batch = {
        mockId: c.mockId,
        project: mock?.project ?? null,
        mock: mock?.slug ?? null,
        title: mock?.title ?? null,
        reply: null,
        comments: [],
        accepted: [],
        archived: [],
      };
      open.set(key, batch);
      batches.push(batch);
    }
    if (c.kind === "reply" && c.payload) {
      batch.reply = {
        ...c.payload,
        seq: c.seq,
        at: c.createdAt,
        asks: answered(c.payload, mock),
      };
      batch.accepted = mockPosts.filter((p) => p.status === "accepted").map(ref);
      batch.archived = mockPosts.filter((p) => p.status === "archived").map(ref);
      continue;
    }
    const post = c.postId ? mockPosts.find((p) => p.id === c.postId) : undefined;
    batch.comments.push({
      seq: c.seq,
      text: c.text,
      state: post?.state ?? null,
      variant: post?.variant ?? null,
      version: c.postVersion,
      ...(c.anchor ? { anchor: c.anchor } : {}),
      ...(c.anchors.length ? { anchors: c.anchors } : {}),
      ...(c.viewport != null ? { viewport: c.viewport } : {}),
    });
  }
  return batches;
}

export async function buildFeedbackBatches(
  store: Store,
  comments: Comment[],
): Promise<FeedbackBatch[]> {
  const mocks = new Map<string, Mock>();
  const posts = new Map<string, Post[]>();
  for (const c of comments) {
    if (!c.mockId || mocks.has(c.mockId)) continue;
    const mock = await store.getMock(c.mockId);
    if (!mock) continue;
    mocks.set(c.mockId, mock);
    posts.set(c.mockId, await store.listPosts({ mockId: c.mockId }));
  }
  return groupFeedback(comments, mocks, posts);
}
