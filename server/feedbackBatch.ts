// The agent-facing shape of feedback: one batch per design, in delivery order.
// The `feedback` verb, the watch long-poll and the write piggyback all return this,
// so an agent reads one grouped object instead of re-deriving which design a flat
// comment list belongs to. Runtime-agnostic (no node imports).

import { type Decisions, decisionsFor } from "./decisions.ts";
import { ROUTED_NOTE } from "./handoff.ts";
import { designLink } from "./links.ts";
import { reactionLine, type SendAsk, sendLines, useLine } from "./sendLines.ts";
import { standingOf, type StandingView, standingView } from "./standings.ts";
import { archivedAnswer, optionStates, withAddedAnswers } from "./alternativeQuestion.ts";
import { shipped } from "./ready.ts";
import type { IdeaTarget } from "./apiViews.ts";
import {
  type AnswerStanding,
  asVariant,
  type Ask,
  type AskOption,
  builtinAsk,
  type Comment,
  type CommentAnchor,
  inUseVersion,
  DEFAULT_ALTERNATIVE,
  type Design,
  type DesignEdit,
  type FollowUps,
  OTHER_ID,
  type PartComment,
  type Post,
  type Reaction,
  type DraftRequest,
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
  // What the user said about single answers, picked or not, each by the answer it is on.
  onAnswers?: { id: string; label: string; comment: string }[];
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
  | "others"
  | "askComments"
  | "otherImages"
  | "askCommentImages"
  | "answerComments"
  | "more"
  | "standings"
  | "update"
  | "followUps"
> {
  // The Send in words, one line per thing in it, as the user read it before it went
  // (sendLines.ts). A Use is its first line.
  lines: string[];
  more?: MoreAnswers;
  // The other questions more answers were asked for, past the first.
  moreAlso?: MoreAnswers[];
  update?: UpdateRequest;
  updateAlso?: UpdateRequest[];
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
  // The design's link to send the user (links.ts).
  url?: string;
  reply: FeedbackReply | null;
  // What the user wrote in the thread, outside any Send.
  messages: FeedbackMessage[];
  // The alternatives the reply left in use / archived (restorable).
  inUse: InUseRef[];
  archived: AlternativeRef[];
  // Set when this batch reached a session that didn't ask it (handoff.ts).
  handoff?: string;
  // The user moved the design themselves: its kind or area as they left it
  // (area null: none). Build on it; don't move it back.
  edited?: DesignEdit;
  // What changed in the project's system: by the user's hand (a project batch, no
  // design), or by this design's Send (a palette made the default, a project knob
  // settled). The revision it made and what changed. Build on it.
  system?: { rev: number; changes: string[] };
  // What this batch asks of the agent beyond answering it: a product design's spec
  // left behind what was decided on it, a component more than one area shows.
  nudges?: string[];
  // What the decision now requires, each by what and where: an alternative to bring over
  // (`apply`), what the target still lacks (`gaps`), the designs showing a component that
  // changed (`instanceIn`), specs behind their decisions (`spec`), and with a screen just
  // marked Ready what it draws itself (`lift`: parts to lift into components, likeLibrary
  // copies to swap for the library's instance).
  followUps?: FollowUps;
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

const isReaction = (c: PartComment): c is PartComment & { reaction: Reaction } => !!c.reaction;

function answered(
  reply: Reply,
  design: Design | undefined,
  posts: Post[],
  base: string,
): AnsweredAsk[] {
  const others = reply.others ?? {};
  const comments = reply.askComments ?? {};
  const onAnswer = reply.answerComments ?? {};
  const refs = (ids: string[] | undefined): ImageRef[] =>
    (ids ?? []).map((id) => ({ id, url: `${base}/a/${encodeURIComponent(id)}` }));
  const standings = reply.standings ?? {};
  const askIds = new Set([
    ...Object.keys(reply.answers),
    ...Object.keys(others),
    ...Object.keys(comments),
    ...Object.keys(onAnswer),
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
    const onAnswers = Object.entries(onAnswer[askId] ?? {}).map(([id, comment]) => ({
      id,
      label: ask?.options.find((o) => o.id === id)?.label ?? id,
      comment,
    }));
    out.push({
      ask: askId,
      text: ask?.text ?? "",
      chosen,
      ...(ask && st ? standingView({ ...ask, answer }, st) : {}),
      ...(comments[askId] !== undefined ? { comment: comments[askId] } : {}),
      ...(commentImages.length ? { commentImages } : {}),
      ...(onAnswers.length ? { onAnswers } : {}),
    });
  }
  return out;
}

// The reply in the words the user's Send list showed it: a Use first, then what the Send
// carried, each question by what it was answered.
function replyLines(reply: Reply, asks: AnsweredAsk[], design: Design | undefined): string[] {
  const verdict = reply.verdict;
  const use =
    verdict?.kind === "use"
      ? useLine(
          verdict.picks ?? [
            {
              state: verdict.state,
              alternative: verdict.alternative,
              version: verdict.version ?? reply.version,
            },
          ],
          reply.usedIn?.target ?? null,
        )
      : null;
  const said: SendAsk[] = asks.map((a) => ({
    id: a.ask,
    text: a.text,
    chosen: a.chosen.map((o) => o.label),
    ...(a.comment ? { comment: a.comment } : {}),
    ...(a.onAnswers ? { onAnswers: a.onAnswers } : {}),
  }));
  const requests: DraftRequest[] = reply.requests ?? [
    ...(reply.more ? [{ kind: "more" as const, ...reply.more }] : []),
    ...(reply.update ? [{ kind: "update" as const, ...reply.update }] : []),
    ...(verdict?.kind === "revise"
      ? [{ kind: "revise" as const, state: verdict.state, alternative: verdict.alternative }]
      : []),
  ];
  const lines = sendLines(
    {
      asks: said,
      borrowed: reply.borrowed ?? {},
      // A reply from before tunes belonged to a frame tuned the design as a whole.
      tunedOn:
        reply.tunedOn ??
        (Object.keys(reply.tuned ?? {}).length ? { [DEFAULT_ALTERNATIVE]: reply.tuned } : {}),
      comments: reply.comments ?? [],
      requests,
      ...(reply.text ? { text: reply.text } : {}),
    },
    {
      askText: (id) => design?.asks.find((a) => a.id === id)?.text,
      optionLabel: (id, option) =>
        design?.asks.find((a) => a.id === id)?.options.find((o) => o.id === option)?.label,
    },
  ).map((l) => l.text);
  return use ? [use, ...lines] : lines;
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
// context. `base` (origin + base path) makes image URLs absolute; `links` is where the
// user opens the viewer.
export function groupFeedback(
  comments: Comment[],
  designs: Map<string, Design>,
  posts: Map<string, Post[]>,
  base = "",
  links = base,
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
        ...(design ? { url: designLink(links, design) } : {}),
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
        const { lift: _lift, ...rest } = batch.followUps ?? {};
        const lift = c.payload?.followUps?.lift;
        const next = lift ? { ...rest, lift } : rest;
        if (Object.keys(next).length) batch.followUps = next;
        else delete batch.followUps;
      }
      continue;
    }
    if (c.kind === "reply" && c.payload) {
      const {
        others: _others,
        askComments: _askComments,
        otherImages: _otherImages,
        askCommentImages: _askCommentImages,
        answerComments: _answerComments,
        routed,
        more: asked,
        standings: sentStandings,
        update: wanted,
        system: decidedHere,
        // What a use requires is worked out at delivery, from the designs as they stand
        // (withFollowUps in app.ts); a reply never carries a lift.
        followUps: _followUps,
        ...payload
      } = c.payload;
      if (decidedHere) batch.system = { rev: decidedHere.rev, changes: decidedHere.changes };
      // A reply from before requests carried at most one of each.
      const requests: DraftRequest[] = payload.requests ?? [
        ...(asked ? [{ kind: "more" as const, ...asked }] : []),
        ...(wanted ? [{ kind: "update" as const, ...wanted }] : []),
      ];
      const mores = design
        ? requests.flatMap((r) =>
            r.kind === "more"
              ? (moreAnswers(design, designPosts, r, sentStandings?.[r.ask]) ?? [])
              : [],
          )
        : [];
      const updates = design
        ? requests.flatMap((r) => (r.kind === "update" ? (updateRequest(design, r) ?? []) : []))
        : [];
      if (routed) batch.handoff = ROUTED_NOTE;
      const reactions = (payload.comments ?? []).filter(isReaction).map(reactionLine);
      const asks = answered(c.payload, design, designPosts, base);
      batch.reply = {
        ...payload,
        lines: replyLines(c.payload, asks, design),
        comments: (payload.comments ?? []).filter((x) => !x.reaction),
        seq: c.seq,
        at: c.createdAt,
        asks,
        ...(reactions.length ? { reactions } : {}),
        ...(mores.length ? { more: mores[0] } : {}),
        ...(mores.length > 1 ? { moreAlso: mores.slice(1) } : {}),
        ...(updates.length ? { update: updates[0] } : {}),
        ...(updates.length > 1 ? { updateAlso: updates.slice(1) } : {}),
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
  return batches.map((b) =>
    b.designId && designs.get(b.designId)?.variants ? variantsBatch(b) : b,
  );
}

// A variants design's entries are variants to the agent, as every read of it names them:
// the batch's verdict, in-use and archived refs and messages say `variant`.
function variantsBatch(batch: FeedbackBatch): FeedbackBatch {
  const named = {
    ...batch,
    ...(batch.reply?.verdict
      ? { reply: { ...batch.reply, verdict: asVariant(batch.reply.verdict) } }
      : {}),
    inUse: batch.inUse.map(asVariant),
    archived: batch.archived.map(asVariant),
    messages: batch.messages.map(asVariant),
  };
  // The renamed refs are the agent's words for the same fields; nothing on the server
  // reads a batch's refs after this, so the type stays the one the tiers return.
  return named as unknown as FeedbackBatch;
}

export async function buildFeedbackBatches(
  store: Store,
  comments: Comment[],
  base: string,
  links = base,
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
  return groupFeedback(comments, designs, posts, base, links);
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
