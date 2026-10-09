// The agent-facing shape of feedback: one batch per mock, in delivery order.
// Waits, `author=user` reads and the `userFeedback` piggyback all return this,
// so an agent reads one grouped object instead of re-deriving which mock a flat
// comment list belongs to. Runtime-agnostic (no node imports).

import {
  type AskOption,
  type Comment,
  type CommentAnchor,
  type Mock,
  OTHER_ID,
  type Post,
  type Reply,
  type Store,
} from "./types.ts";

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

// The user's write-in under "Other…", delivered as one more choice so an agent
// reads it like any option; `other` says it is free text, not one of yours.
export interface OtherChoice {
  id: typeof OTHER_ID;
  label: string;
  other: true;
}

// An answered ask, resolved to the options the user chose, so the agent reads
// "Look → dark" without cross-referencing ids. `note` qualifies the answer.
export interface AnsweredAsk {
  ask: string;
  text: string;
  chosen: (AskOption | OtherChoice)[];
  note?: string;
}

// The write-ins and notes ride in `asks`, not again as id maps.
export interface FeedbackReply extends Omit<Reply, "others" | "notes"> {
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
  const others = reply.others ?? {};
  const notes = reply.notes ?? {};
  const askIds = new Set([
    ...Object.keys(reply.answers),
    ...Object.keys(others),
    ...Object.keys(notes),
  ]);
  const out: AnsweredAsk[] = [];
  for (const askId of askIds) {
    const ask = mock?.asks.find((a) => a.id === askId);
    const answer = reply.answers[askId];
    const ids = answer === undefined ? [] : Array.isArray(answer) ? answer : [answer];
    const chosen: AnsweredAsk["chosen"] = ids.map(
      (id) => ask?.options.find((o) => o.id === id) ?? { id, label: id },
    );
    if (others[askId] !== undefined)
      chosen.push({ id: OTHER_ID, label: others[askId], other: true });
    out.push({
      ask: askId,
      text: ask?.text ?? "",
      chosen,
      ...(notes[askId] !== undefined ? { note: notes[askId] } : {}),
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
      const { others: _others, notes: _notes, ...payload } = c.payload;
      batch.reply = {
        ...payload,
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
