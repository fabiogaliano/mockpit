// The agent-facing shape of feedback: one batch per design, in delivery order.
// The `feedback` verb, the watch long-poll and the write piggyback all return this,
// so an agent reads one grouped object instead of re-deriving which design a flat
// comment list belongs to. Runtime-agnostic (no node imports).

import { type Decisions, decisionsFor } from "./decisions.ts";
import { ROUTED_NOTE } from "./handoff.ts";
import { standingOf, type StandingView, standingView } from "./standings.ts";
import { archivedAnswer, optionStates, withAddedAnswers } from "./alternativeQuestion.ts";
import { shipped } from "./ready.ts";
import type { IdeaTarget } from "./apiViews.ts";
import {
  type AnswerStanding,
  type Ask,
  type AskOption,
  builtinAsk,
  type Comment,
  type CommentAnchor,
  inUseVersion,
  DEFAULT_ALTERNATIVE,
  type Design,
  type DesignEdit,
  type Lift,
  OTHER_ID,
  type PartComment,
  type Post,
  type Reaction,
  type Reply,
  type Store,
} from "./types.ts";

export interface AlternativeRef {
  state: string | null;
  alternative: string;
}

// An alternative in use, with the version the user put in use.
export interface InUseRef extends AlternativeRef {
  version: number;
}

export interface FeedbackMessage {
  seq: number;
  text: string;
  state: string | null;
  alternative: string | null;
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
// "Which alternative? → dark" without cross-referencing ids. `comment` qualifies the answer.
export interface AnsweredAsk extends StandingView {
  ask: string;
  text: string;
  chosen: (AskOption | OtherChoice)[];
  comment?: string;
  commentImages?: ImageRef[];
}

// A request for more answers, with what the agent needs to answer it in one go: the
// question, what it already offers, and what the user has settled around it.
export interface MoreAnswers {
  ask: string;
  text: string;
  existing: string[];
  note?: string;
  // More like this one answer, rather than more of everything.
  like?: string;
  // What the user kept points the way; what they hid, and why, is what to avoid.
  kept?: string[];
  hidden?: { label: string; why?: string }[];
  answered: { ask: string; text: string; chosen: string[]; comment?: string }[];
}

// A kept screen to bring up to date with the one in use, once.
export interface UpdateRequest {
  ask: string;
  text: string;
  kept: AskOption;
  inUse: AskOption[];
}

// The write-ins, comments and their images ride in `asks`, not again as id maps.
export interface FeedbackReply extends Omit<
  Reply,
  "others" | "askComments" | "otherImages" | "askCommentImages" | "more" | "standings" | "update"
> {
  more?: MoreAnswers;
  update?: UpdateRequest;
  seq: number;
  at: string;
  asks: AnsweredAsk[];
  // One-tap reactions as one line each (`👍 part "hero" (alternative B)`); they are
  // left out of `comments`, which keeps only what the user typed.
  reactions?: string[];
  // The state as decided: per state the alternative and each part's chosen swap,
  // nested under the swap that holds it, plus the knob values set (decisions.ts).
  decisions?: Decisions;
}

export interface FeedbackBatch {
  designId: string | null;
  project: string | null;
  design: string | null;
  title: string | null;
  reply: FeedbackReply | null;
  // What the user wrote in the thread, outside any Send.
  messages: FeedbackMessage[];
  // The alternatives the reply left in use / archived (restorable).
  inUse: InUseRef[];
  archived: AlternativeRef[];
  // Set when this batch reached a session that didn't ask it (handoff.ts).
  handoff?: string;
  // The user moved the design from Home: its kind or area as they left it
  // (area null: none). Build on it; don't move it back.
  edited?: DesignEdit;
  // What changed in the project's system: by the user's hand (a project batch, no
  // design), or by this design's Send (a palette made the default, a project knob
  // settled). The revision it made and what changed. Build on it.
  system?: { rev: number; changes: string[] };
  // What this batch asks of the agent beyond answering it: a product design's spec
  // left behind what was decided on it, a component more than one area shows.
  nudges?: string[];
  // With a screen just marked Ready: what it draws itself, to lift into components
  // (parts) or to swap for the library's instance (likeLibrary). Then ask `lift`.
  lift?: Lift;
  // With a reply on an idea for a design: that design, and what it has turned down.
  target?: IdeaTarget;
}

const ref = (p: Post): AlternativeRef => ({ state: p.state, alternative: p.alternative });

function moreAnswers(
  design: Design,
  posts: Post[],
  more: NonNullable<Reply["more"]>,
  sent: AnswerStanding | undefined,
): MoreAnswers | undefined {
  const stored = design.asks.find((a) => a.id === more.ask);
  if (!stored) return undefined;
  const ask = withAddedAnswers(stored, design, posts);
  const st = sent ?? standingOf(design, ask.id);
  const view = standingView(ask, st);
  // An alternative answer whose alternative is archived is as hidden as one the user hid, with
  // the alternative's reason as its why.
  const archived = ask.options.filter(
    (o) => archivedAnswer(ask, o, design, posts) && !st.hidden.some((h) => h.id === o.id),
  );
  const reason = (o: AskOption) => {
    const states = optionStates(ask, o, design);
    return posts.find(
      (p) => p.alternative === o.alternative && states.includes(p.state) && p.archiveReason,
    )?.archiveReason;
  };
  const hidden = [
    ...(view?.hidden ?? []).map((h) => ({ label: h.label, ...(h.why ? { why: h.why } : {}) })),
    ...archived.map((o) => ({ label: o.label, ...(reason(o) ? { why: reason(o)! } : {}) })),
  ];
  const like = more.like ? ask.options.find((o) => o.id === more.like)?.label : undefined;
  const labels = (a: Ask): string[] => {
    const ids = a.answer === undefined ? [] : Array.isArray(a.answer) ? a.answer : [a.answer];
    return [
      ...ids.map((id) => a.options.find((o) => o.id === id)?.label ?? id),
      ...(a.other === undefined ? [] : [a.other]),
    ];
  };
  return {
    ask: ask.id,
    text: ask.text,
    // Hidden ones are out: asked again, they'd only fold away.
    existing: ask.options
      .filter((o) => !st.hidden.some((h) => h.id === o.id) && !archived.includes(o))
      .map((o) => o.label),
    ...(more.note ? { note: more.note } : {}),
    ...(like ? { like } : {}),
    ...(view?.kept ? { kept: view.kept.map((k) => k.label) } : {}),
    ...(hidden.length ? { hidden } : {}),
    answered: design.asks
      .filter((a) => a.id !== ask.id && labels(a).length > 0)
      .map((a) => ({
        ask: a.id,
        text: a.text,
        chosen: labels(a),
        ...(a.comment ? { comment: a.comment } : {}),
      })),
  };
}

function updateRequest(
  design: Design,
  wanted: NonNullable<Reply["update"]>,
): UpdateRequest | undefined {
  const ask = design.asks.find((a) => a.id === wanted.ask);
  const kept = ask?.options.find((o) => o.id === wanted.option);
  if (!ask || !kept) return undefined;
  const ids = ask.answer === undefined ? [] : [ask.answer].flat();
  return {
    ask: ask.id,
    text: ask.text,
    kept,
    inUse: ask.options.filter((o) => ids.includes(o.id)),
  };
}

const REACTION_LEAD: Record<Reaction, string> = {
  up: "👍",
  down: "👎",
  more: "more like this:",
};

// `👍 part "hero" (alternative B, state Mobile)`, `👎 alternative B`, `more like this: the page`.
export function reactionLine(c: PartComment & { reaction: Reaction }): string {
  // A design published without alternative names has only "default": naming it is noise.
  const named = c.alternative && c.alternative !== DEFAULT_ALTERNATIVE ? c.alternative : null;
  // A version is written as agents write it, dark@2.
  const at = c.version ? `@${c.version}` : "";
  const alternative = named ? `${named}${at}` : at ? `${DEFAULT_ALTERNATIVE}${at}` : null;
  const where = [
    c.part !== null && alternative ? `alternative ${alternative}` : "",
    c.state ? `state ${c.state}` : "",
  ].filter(Boolean);
  const target =
    c.part !== null
      ? `part ${JSON.stringify(c.part)}`
      : alternative
        ? `alternative ${alternative}`
        : "the page";
  const tail = where.length ? ` (${where.join(", ")})` : "";
  const note = c.text ? ` “${c.text}”` : "";
  return `${REACTION_LEAD[c.reaction]} ${target}${tail}${note}`;
}

const isReaction = (c: PartComment): c is PartComment & { reaction: Reaction } => !!c.reaction;

function answered(
  reply: Reply,
  design: Design | undefined,
  posts: Post[],
  base: string,
): AnsweredAsk[] {
  const others = reply.others ?? {};
  const comments = reply.askComments ?? {};
  const refs = (ids: string[] | undefined): ImageRef[] =>
    (ids ?? []).map((id) => ({ id, url: `${base}/a/${encodeURIComponent(id)}` }));
  const standings = reply.standings ?? {};
  const askIds = new Set([
    ...Object.keys(reply.answers),
    ...Object.keys(others),
    ...Object.keys(comments),
    // A question whose answers the user only kept or hid is still news: more answers
    // should follow the kept ones and avoid the hidden.
    ...Object.keys(standings).filter((id) => id !== reply.more?.ask),
  ]);
  const out: AnsweredAsk[] = [];
  for (const askId of askIds) {
    const stored = design?.asks.find((a) => a.id === askId);
    const ask =
      design && stored
        ? withAddedAnswers(stored, design, posts)
        : design && builtinAsk(design, posts, askId);
    const answer = reply.answers[askId];
    const ids = answer === undefined ? [] : Array.isArray(answer) ? answer : [answer];
    const chosen: AnsweredAsk["chosen"] = ids.map((id) => {
      const option = ask?.options.find((o) => o.id === id);
      if (!option) return { id, label: id };
      // What it brought isn't in any version yet: an agent folding it in needs it here.
      const brought = design?.answerAdditions.find((a) =>
        Object.entries(option.set ?? {}).some(([k, v]) => a.knob === k && a.value === v),
      );
      return brought ? { ...option, brought } : option;
    });
    const otherImages = refs(reply.otherImages?.[askId]);
    if (others[askId] !== undefined)
      chosen.push({
        id: OTHER_ID,
        label: others[askId],
        other: true,
        ...(otherImages.length ? { images: otherImages } : {}),
      });
    const commentImages = refs(reply.askCommentImages?.[askId]);
    const st = standings[askId];
    out.push({
      ask: askId,
      text: ask?.text ?? "",
      chosen,
      ...(ask && st ? standingView({ ...ask, answer }, st) : {}),
      ...(comments[askId] !== undefined ? { comment: comments[askId] } : {}),
      ...(commentImages.length ? { commentImages } : {}),
    });
  }
  return out;
}

// Two edits of one design in one batch: the later wins field by field, and the spec
// section by section, so a purpose and then a behaviour edit both reach the agent. A
// null is a clear and stands like any other value.
function mergeEdits(before: DesignEdit | undefined, edit: DesignEdit): DesignEdit {
  const merged = { ...before, ...edit };
  if (before?.spec && edit.spec) merged.spec = { ...before.spec, ...edit.spec };
  return merged;
}

// Comments arrive in seq order; keep that order both between batches and inside
// one. A design gets a fresh batch whenever a second reply arrives for it, so a
// batch carries at most one reply and nothing is merged away. A comment whose
// design is unknown still gets a batch — feedback is never dropped for want of
// context. `base` (origin + base path) makes image URLs absolute.
export function groupFeedback(
  comments: Comment[],
  designs: Map<string, Design>,
  posts: Map<string, Post[]>,
  base = "",
): FeedbackBatch[] {
  const batches: FeedbackBatch[] = [];
  const open = new Map<string, FeedbackBatch>();
  for (const c of comments) {
    // Stored from when a close wrote to this stream. Ending something tells the agent
    // nothing, so one still ahead of the cursor stays unsaid.
    if (c.kind === "reply" && c.payload?.archived) continue;
    // The user's hand on the system page: one project batch each, never merged.
    const decided = c.kind === "reply" && !c.designId ? c.payload?.system : undefined;
    if (decided) {
      batches.push({
        designId: null,
        project: decided.project,
        design: null,
        title: null,
        reply: null,
        messages: [],
        inUse: [],
        archived: [],
        system: { rev: decided.rev, changes: decided.changes },
      });
      continue;
    }
    const key = c.designId ?? "";
    const design = c.designId ? designs.get(c.designId) : undefined;
    const designPosts = (c.designId && posts.get(c.designId)) || [];
    let batch = open.get(key);
    // An edit says where the design is now, so it joins whatever batch is open.
    const edit = c.kind === "reply" ? c.payload?.edited : undefined;
    if (!batch || (c.kind === "reply" && !edit && batch.reply)) {
      batch = {
        designId: c.designId,
        project: design?.project ?? null,
        design: design?.slug ?? null,
        title: design?.title ?? null,
        reply: null,
        messages: [],
        inUse: [],
        archived: [],
      };
      open.set(key, batch);
      batches.push(batch);
    }
    if (edit) {
      batch.edited = mergeEdits(batch.edited, edit);
      // The latest mark says what there is to lift: a later one with nothing (taken off,
      // or over versions that draw nothing of their own) leaves nothing.
      if (edit.ready) {
        if (c.payload?.lift) batch.lift = c.payload.lift;
        else delete batch.lift;
      }
      continue;
    }
    if (c.kind === "reply" && c.payload) {
      const {
        others: _others,
        askComments: _askComments,
        otherImages: _otherImages,
        askCommentImages: _askCommentImages,
        routed,
        more: asked,
        standings: _standings,
        update: wanted,
        system: decidedHere,
        ...payload
      } = c.payload;
      if (decidedHere) batch.system = { rev: decidedHere.rev, changes: decidedHere.changes };
      const more =
        asked && design
          ? moreAnswers(design, designPosts, asked, c.payload.standings?.[asked.ask])
          : undefined;
      const update = wanted && design ? updateRequest(design, wanted) : undefined;
      if (routed) batch.handoff = ROUTED_NOTE;
      const reactions = (payload.comments ?? []).filter(isReaction).map(reactionLine);
      batch.reply = {
        ...payload,
        comments: (payload.comments ?? []).filter((x) => !x.reaction),
        seq: c.seq,
        at: c.createdAt,
        asks: answered(c.payload, design, designPosts, base),
        ...(reactions.length ? { reactions } : {}),
        ...(more ? { more } : {}),
        ...(update ? { update } : {}),
      };
      const decisions = design ? decisionsFor(design, designPosts, c.payload) : null;
      if (decisions) batch.reply.decisions = decisions;
      batch.inUse = (design ? shipped(design, designPosts) : designPosts)
        .filter((p) => p.status === "accepted")
        .map((p) => ({ ...ref(p), version: inUseVersion(p) }));
      batch.archived = designPosts.filter((p) => p.status === "archived").map(ref);
      continue;
    }
    const post = c.postId ? designPosts.find((p) => p.id === c.postId) : undefined;
    batch.messages.push({
      seq: c.seq,
      text: c.text,
      state: post?.state ?? null,
      alternative: post?.alternative ?? null,
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
  const designs = new Map<string, Design>();
  const posts = new Map<string, Post[]>();
  for (const c of comments) {
    if (!c.designId || designs.has(c.designId)) continue;
    const design = await store.getDesign(c.designId);
    if (!design) continue;
    designs.set(c.designId, design);
    posts.set(c.designId, await store.listPosts({ designId: c.designId }));
  }
  return groupFeedback(comments, designs, posts, base);
}

// Every image a list of batches carries, in order — what the MCP tiers attach
// as image content so the model sees what the user attached.
export function feedbackImages(batches: FeedbackBatch[]): ImageRef[] {
  const out: ImageRef[] = [];
  for (const b of batches) {
    for (const a of b.reply?.asks ?? []) {
      for (const c of a.chosen) if ("other" in c && c.images) out.push(...c.images);
      if (a.commentImages) out.push(...a.commentImages);
    }
  }
  return out;
}
