// The agent-facing shape of feedback: one batch per mock, in delivery order.
// The `feedback` verb, the watch long-poll and the write piggyback all return this,
// so an agent reads one grouped object instead of re-deriving which mock a flat
// comment list belongs to. Runtime-agnostic (no node imports).

import { type Decisions, decisionsFor } from "./decisions.ts";
import {
  type AskOption,
  builtinAsk,
  type Comment,
  type CommentAnchor,
  DEFAULT_VARIANT,
  type Mock,
  OTHER_ID,
  type PartComment,
  type Post,
  type Reaction,
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

// An image the user attached, by the URL an agent can fetch it from.
export interface ImageRef {
  id: string;
  url: string;
}

// The user's write-in under "Other…", delivered as one more choice so an agent
// reads it like any option; `other` says it is free text, not one of yours.
export interface OtherChoice {
  id: typeof OTHER_ID;
  label: string;
  other: true;
  images?: ImageRef[];
}

// An answered ask, resolved to the options the user chose, so the agent reads
// "Look → dark" without cross-referencing ids. `note` qualifies the answer.
export interface AnsweredAsk {
  ask: string;
  text: string;
  chosen: (AskOption | OtherChoice)[];
  note?: string;
  noteImages?: ImageRef[];
}

// The write-ins, notes and their images ride in `asks`, not again as id maps.
export interface FeedbackReply extends Omit<
  Reply,
  "others" | "notes" | "otherImages" | "noteImages"
> {
  seq: number;
  at: string;
  asks: AnsweredAsk[];
  // One-tap reactions as one line each (`👍 part "hero" (variant B)`); they are
  // left out of `comments`, which keeps only what the user typed.
  reactions?: string[];
  // The screen as decided: per state the look and each slot's fill, nested
  // under the fill that holds it, plus the knob values set (decisions.ts).
  decisions?: Decisions;
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
  // Dropped by the user: hidden from the viewer, restorable. Don't build on them.
  dropped: VariantRef[];
  // Set when this batch was sent to an earlier, now quiet session (handoff.ts).
  handoff?: string;
  // The user resolved the mock instead of answering: these asks were closed
  // unanswered, as not worth answering. Don't ask them again.
  resolved?: true;
  dismissed?: { ask: string; text: string }[];
}

const ref = (p: Post): VariantRef => ({ state: p.state, variant: p.variant });

const REACTION_LEAD: Record<Reaction, string> = {
  up: "👍",
  down: "👎",
  more: "more like this:",
};

// `👍 part "hero" (variant B, state Mobile)`, `👎 variant B`, `more like this: the page`.
export function reactionLine(c: PartComment & { reaction: Reaction }): string {
  // A mock published without variant names has only "default": naming it is noise.
  const variant = c.variant && c.variant !== DEFAULT_VARIANT ? c.variant : null;
  const where = [
    c.part !== null && variant ? `variant ${variant}` : "",
    c.state ? `state ${c.state}` : "",
  ].filter(Boolean);
  const target =
    c.part !== null
      ? `part ${JSON.stringify(c.part)}`
      : variant
        ? `variant ${variant}`
        : "the page";
  const tail = where.length ? ` (${where.join(", ")})` : "";
  const note = c.text ? ` “${c.text}”` : "";
  return `${REACTION_LEAD[c.reaction]} ${target}${tail}${note}`;
}

const isReaction = (c: PartComment): c is PartComment & { reaction: Reaction } => !!c.reaction;

function answered(
  reply: Reply,
  mock: Mock | undefined,
  posts: Post[],
  base: string,
): AnsweredAsk[] {
  const others = reply.others ?? {};
  const notes = reply.notes ?? {};
  const refs = (ids: string[] | undefined): ImageRef[] =>
    (ids ?? []).map((id) => ({ id, url: `${base}/a/${encodeURIComponent(id)}` }));
  const askIds = new Set([
    ...Object.keys(reply.answers),
    ...Object.keys(others),
    ...Object.keys(notes),
  ]);
  const out: AnsweredAsk[] = [];
  for (const askId of askIds) {
    const ask = mock?.asks.find((a) => a.id === askId) ?? (mock && builtinAsk(mock, posts, askId));
    const answer = reply.answers[askId];
    const ids = answer === undefined ? [] : Array.isArray(answer) ? answer : [answer];
    const chosen: AnsweredAsk["chosen"] = ids.map(
      (id) => ask?.options.find((o) => o.id === id) ?? { id, label: id },
    );
    const otherImages = refs(reply.otherImages?.[askId]);
    if (others[askId] !== undefined)
      chosen.push({
        id: OTHER_ID,
        label: others[askId],
        other: true,
        ...(otherImages.length ? { images: otherImages } : {}),
      });
    const noteImages = refs(reply.noteImages?.[askId]);
    out.push({
      ask: askId,
      text: ask?.text ?? "",
      chosen,
      ...(notes[askId] !== undefined ? { note: notes[askId] } : {}),
      ...(noteImages.length ? { noteImages } : {}),
    });
  }
  return out;
}

// Comments arrive in seq order; keep that order both between batches and inside
// one. A mock gets a fresh batch whenever a second reply arrives for it, so a
// batch carries at most one reply and nothing is merged away. A comment whose
// mock is unknown still gets a batch — feedback is never dropped for want of
// context. `base` (origin + base path) makes image URLs absolute.
export function groupFeedback(
  comments: Comment[],
  mocks: Map<string, Mock>,
  posts: Map<string, Post[]>,
  base = "",
): FeedbackBatch[] {
  const batches: FeedbackBatch[] = [];
  const open = new Map<string, FeedbackBatch>();
  for (const c of comments) {
    const key = c.mockId ?? "";
    const mock = c.mockId ? mocks.get(c.mockId) : undefined;
    const mockPosts = (c.mockId && posts.get(c.mockId)) || [];
    let batch = open.get(key);
    if (!batch || (c.kind === "reply" && (batch.reply || batch.resolved))) {
      batch = {
        mockId: c.mockId,
        project: mock?.project ?? null,
        mock: mock?.slug ?? null,
        title: mock?.title ?? null,
        reply: null,
        comments: [],
        accepted: [],
        archived: [],
        dropped: [],
      };
      open.set(key, batch);
      batches.push(batch);
    }
    if (c.kind === "reply" && c.payload?.resolved) {
      batch.resolved = true;
      batch.dismissed = c.payload.resolved.dismissed.map((id) => ({
        ask: id,
        text:
          (mock?.asks.find((a) => a.id === id) ?? (mock && builtinAsk(mock, mockPosts, id)))
            ?.text ?? "",
      }));
      continue;
    }
    if (c.kind === "reply" && c.payload) {
      const {
        others: _others,
        notes: _notes,
        otherImages: _otherImages,
        noteImages: _noteImages,
        ...payload
      } = c.payload;
      const reactions = (payload.comments ?? []).filter(isReaction).map(reactionLine);
      batch.reply = {
        ...payload,
        comments: (payload.comments ?? []).filter((x) => !x.reaction),
        seq: c.seq,
        at: c.createdAt,
        asks: answered(c.payload, mock, mockPosts, base),
        ...(reactions.length ? { reactions } : {}),
      };
      const decisions = mock ? decisionsFor(mock, mockPosts, c.payload) : null;
      if (decisions) batch.reply.decisions = decisions;
      batch.accepted = mockPosts.filter((p) => p.status === "accepted").map(ref);
      batch.archived = mockPosts.filter((p) => p.status === "archived").map(ref);
      batch.dropped = mockPosts.filter((p) => p.status === "dropped").map(ref);
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
  base: string,
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
  return groupFeedback(comments, mocks, posts, base);
}

// Every image a list of batches carries, in order — what the MCP tiers attach
// as image content so the model sees what the user attached.
export function feedbackImages(batches: FeedbackBatch[]): ImageRef[] {
  const out: ImageRef[] = [];
  for (const b of batches) {
    for (const a of b.reply?.asks ?? []) {
      for (const c of a.chosen) if ("other" in c && c.images) out.push(...c.images);
      if (a.noteImages) out.push(...a.noteImages);
    }
  }
  return out;
}
