// The mock screen's state: the mock as the server last sent it, the user's
// draft, and the view (state on stage, question, mode, selection, preview,
// version). Components read signals from here and call its actions; nothing
// else talks to the API for this screen.

import { batch, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import {
  type Ask,
  type AskAnswer,
  askAnswered,
  type KnobValue,
  MAX_ASK_IMAGES,
  type PartCommentAnchor,
  type Reaction,
  type ReplyDecision,
} from "../../server/types.ts";
import type { SlotInfo } from "../../server/fills.ts";
import { reactionOf, reactionStatus, toggleReaction } from "./reactionRules.ts";
import {
  api,
  type CommentRow,
  type DraftInput,
  type MockDetail,
  type MockSummary,
  subscribe,
  watchMock,
} from "./api.ts";
import { extensionOf, prepareImage, rejectReason } from "./attach.ts";
import { setCarried } from "./carry.ts";
import { host, readonly } from "./host.ts";
import {
  answerIds,
  askName,
  askState,
  askStates,
  builtinAsks,
  carryOver,
  defaultDeviceWidth,
  DESKTOP_W,
  draftIsEmpty,
  emptyDraft,
  frameKey,
  frameVersion,
  type KnobContext,
  lookAsk,
  mixDropCause,
  mixOptions,
  mixSettled,
  partLabel,
  pruneMix,
  knobPart,
  resolveKnobs,
  mockVersion,
  nextOwedMock,
  overflowWidth,
  type PartsReport,
  type Zoom,
  pickInDraft,
  readDeviceWidth,
  reviewRows,
  sendCount,
  setAskField,
  tapPicks,
  tuneVisible,
  unanswered,
} from "./logic.ts";
import { mockPath, navigate } from "./route.ts";
import { setTheme } from "./theme.ts";
import { canvasLayout, coarse, win } from "./viewport.ts";

export type Mode = "questions" | "tune" | "thread";
export type AskField = "other" | "note";

// An image on its way up (a local preview), or one that failed (with why).
export interface PendingImage {
  key: string;
  url: string;
  name: string;
  error?: string;
}
export type Question = { kind: "ask"; ask: Ask } | { kind: "mix" };
// One question on one state: an ask shown on several states is an entry on each.
export interface FlowEntry {
  state: string | null;
  ask: Ask;
}
// A question to go to: the nth one on that state.
export interface Stop {
  state: string | null;
  to: number;
}

// What the stage shows while the pointer rests on an option: another variant,
// or knob values sent live to the frame on stage.
export interface Preview {
  key: string;
  variant?: string;
  state?: string | null;
  knobs?: Record<string, KnobValue>;
  // A Mix borrow: the part outlined on the donor look while it previews.
  part?: string;
}

// What the primary button under the questions does now.
export type Primary =
  | ({ kind: "next" } & Stop)
  | { kind: "review" }
  | { kind: "back" }
  | { kind: "send"; count: number }
  | ({ kind: "owed" } & Stop)
  | null;

// Where Send leaves the user: the next mock still owing answers (null when none
// does), and whether the screen is about to carry them there on its own.
export interface AfterSend {
  next: MockSummary | null;
  auto: boolean;
}

const SAVE_MS = 300;
// Long enough to read "Next: …" and press Stay, short enough to feel carried.
const FORWARD_MS = 1600;
// A pick on a hover device moves on after a beat, so the tick is seen landing.
const ADVANCE_MS = 450;
// Long enough for an agent that is watching to pick a reply up.
const BEAT_MS = 4000;

export function createMockScreen(
  project: string,
  slug: string,
  open: { state: string | null; variant: string } | null = null,
) {
  const [mock, setMock] = createSignal<MockDetail | null>(null);
  const [missing, setMissing] = createSignal(false);
  const [comments, setComments] = createSignal<CommentRow[]>([]);
  const [draft, setDraftSignal] = createSignal<DraftInput | null>(null);
  const [activeState, setActiveState] = createSignal<string | null>(null);
  const [chosenVariant, setChosenVariant] = createSignal<Record<string, string>>({});
  const [preview, setPreview] = createSignal<Preview | null>(null);
  const [mode, setModeSignal] = createSignal<Mode>("questions");
  const [cur, setCur] = createSignal(0);
  // Sent answers the user chose to change ("Change answer"): back among the
  // open questions until the next Send. A sent answer is otherwise read-only.
  const [revising, setRevising] = createSignal<Record<string, true>>({});
  // The review step after the last question: every answer as a row, and Send.
  const [reviewing, setReviewing] = createSignal(false);
  // A question opened from a review row: a pick there goes back to the review.
  const [returning, setReturning] = createSignal(false);
  const [afterSend, setAfterSend] = createSignal<AfterSend | null>(null);
  const [keysOpen, setKeysOpen] = createSignal(false);
  // The part picked on the stage, shown in Tune; null is the page ("Look").
  const [selectedPart, setSelectedPart] = createSignal<string | null>(null);
  const [hoverPart, setHoverPart] = createSignal<string | null>(null);
  // A part tapped on the canvas, where a tap must not swap the question card's
  // mode; lit until the question or mode moves on.
  const [tapped, setTapped] = createSignal<string | null>(null);
  // The part an answer just changed, outlined on stage for a moment so a pick
  // never changes the screen out of sight. Armed by a pick or preview; the
  // stage finds the part from the next parts report.
  const [flash, setFlash] = createSignal<string | null>(null);
  // "entry · skeleton" when the flashed part is a slot and the fill is known.
  const [flashLabel, setFlashLabel] = createSignal<string | null>(null);
  let flashArmedAt = 0;
  let flashTimer = 0;
  const armFlash = () => (flashArmedAt = Date.now());
  const flashArmed = () => Date.now() - flashArmedAt < 1500;
  function showFlash(part: string, label: string | null = null) {
    flashArmedAt = 0;
    setFlashLabel(label);
    setFlash(part);
    host().window.clearTimeout(flashTimer);
    flashTimer = host().window.setTimeout(() => setFlash(null), 1600);
  }
  const [viewVersion, setViewVersion] = createSignal<number | null>(null);
  const [versionsOpen, setVersionsOpen] = createSignal(false);
  // Older component versions shown on the stage instead of the latest, slug →
  // version: a look back, never saved.
  const [embedPeek, setEmbedPeek] = createSignal<Record<string, number>>({});
  const [sent, setSent] = createSignal(false);
  // The reply the last Send stored, and whether a beat has passed since: an
  // undelivered reply after that beat earns the "tell your agent" hint.
  const [sentId, setSentId] = createSignal<string | null>(null);
  const [beat, setBeat] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [flagged, setFlagged] = createSignal<string[]>([]);
  // askId → "Other…" ticked; a write-in counts once it has text, so until then
  // the tick lives only here.
  const [otherOpen, setOtherOpen] = createSignal<Record<string, boolean>>({});
  // askId → the write-in a pick took out of the draft, so ticking "Other…"
  // again brings back what was typed instead of an empty box.
  const [otherStash, setOtherStash] = createSignal<
    Record<string, { text: string; images: string[] }>
  >({});
  // `${field}:${askId}` → that write-in or note folded to one line.
  const [folded, setFoldedSignal] = createSignal<Record<string, boolean>>({});
  // "No, all <look>" is an answer even though it borrows nothing.
  const [mixTouched, setMixTouched] = createSignal(false);
  // Borrows a later answer took out of Mix, said where Mix and the review show
  // it, so the review's "none" never reads as the user's own choice.
  const [mixDropped, setMixDropped] = createSignal<{ part: string; note: string }[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  // `${field}:${askId}` → images still uploading or failed there.
  const [uploads, setUploads] = createSignal<Record<string, PendingImage[]>>({});
  // The last attach/remove, for a polite live region.
  const [attachStatus, setAttachStatus] = createSignal("");
  // The last reaction tap, for a polite live region.
  const [reactStatus, setReactStatus] = createSignal("");
  // The Mark tool (D11): while on, a click on the stage leaves a comment there.
  const [marking, setMarking] = createSignal(false);
  // Thread's comment field; a frame's sendPrompt fills it.
  const [threadText, setThreadText] = createSignal("");
  // Where Tune's knob controls mount: tunekit's pane is moved into it while Tune is open.
  const [tuneHost, setTuneHost] = createSignal<HTMLElement | null>(null);
  // The width the stage renders the design at, remembered per mock in this browser.
  const [frameW, setFrameWSignal] = createSignal(DESKTOP_W);
  // Only a width the user picked holds against a design that overflows it.
  const [widthPicked, setWidthPicked] = createSignal(false);
  // Inspect: the stage alone, full screen, zoomable.
  const [inspect, setInspect] = createSignal(false);
  // The zoom of Inspect and of the canvas, and the scale the stage last drew at.
  const [zoom, setZoom] = createSignal<Zoom>("fit");
  const [stageScale, setStageScale] = createSignal(1);
  // The least scale a zoom can reach on the stage now, so the header offers
  // only the steps it can take.
  const [zoomMin, setZoomMin] = createSignal(0.1);
  // The stage frames' latest parts reports, keyed by frameKey(state, variant).
  const [reports, setReports] = createStore<Record<string, PartsReport | undefined>>({});

  const variants = createMemo(() => mock()?.variants ?? []);
  const states = createMemo<(string | null)[]>(() => {
    const m = mock();
    return m && m.states.length ? m.states : [null];
  });
  const latest = createMemo(() => mockVersion(variants()));
  // Q6: a draft made on an older version keeps the stage on that version until
  // the user chooses to view the new one.
  const boundVersion = createMemo(() => {
    const d = draft();
    return d && !draftIsEmpty(d) && d.version < latest() ? d.version : null;
  });
  const stageVersion = createMemo(() => viewVersion() ?? boundVersion() ?? latest());
  // The agent's asks plus the built-in "Which one?" where the agent left a
  // choice between variants unasked; everything below reads asks from here.
  const asks = createMemo<Ask[]>(() => {
    const m = mock();
    return m ? [...m.asks, ...builtinAsks(m, variants())] : [];
  });
  const withAsks = (m: MockDetail) => ({ ...m, asks: asks() });
  const look = createMemo(() => lookAsk({ asks: asks() }));

  // The draft speaks for an ask once it picked an option or ticked "Other…" there;
  // until then the ask reads as sent.
  const drafted = (ask: Ask) => {
    const d = draft();
    return (
      !!otherOpen()[ask.id] ||
      (!!d && (d.answers[ask.id] !== undefined || d.others[ask.id] !== undefined))
    );
  };
  const answerOf = (ask: Ask) => (drafted(ask) ? draft()?.answers[ask.id] : ask.answer);
  const otherOf = (ask: Ask) => (drafted(ask) ? draft()?.others[ask.id] : ask.other);
  const otherTicked = (ask: Ask) => !!otherOpen()[ask.id] || otherOf(ask) !== undefined;
  const noteOf = (ask: Ask) => draft()?.notes[ask.id] ?? ask.note;
  const otherImagesOf = (ask: Ask) =>
    (drafted(ask) ? draft()?.otherImages[ask.id] : ask.otherImages) ?? [];
  const noteImagesOf = (ask: Ask) =>
    (draft()?.notes[ask.id] !== undefined ? draft()?.noteImages[ask.id] : ask.noteImages) ?? [];
  const textOf = (ask: Ask, field: AskField) =>
    (field === "other" ? otherOf(ask) : noteOf(ask)) ?? "";
  const imagesOf = (ask: Ask, field: AskField) =>
    field === "other" ? otherImagesOf(ask) : noteImagesOf(ask);
  const pendingOf = (ask: Ask, field: AskField) => uploads()[`${field}:${ask.id}`] ?? [];

  // The variant the Look ask settled on, drafted or sent.
  const lookPick = createMemo(() => {
    const ask = look();
    if (!ask) return null;
    const id = answerIds(answerOf(ask))[0];
    return ask.options.find((o) => o.id === id)?.variant ?? null;
  });

  const inState = (state: string | null) => variants().filter((v) => v.state === state);

  // The variant on stage for a state: a hovered option, the drafted look, the
  // switcher's choice, the accepted one, else the first still open.
  function variantFor(state: string | null, withPreview = true) {
    const list = inState(state);
    const named = (name: string | null | undefined) =>
      name ? list.find((v) => v.variant === name) : undefined;
    const p = withPreview ? preview() : null;
    return (
      (p && (p.state === undefined || p.state === state) ? named(p.variant) : undefined) ??
      named(lookPick()) ??
      named(chosenVariant()[String(state)]) ??
      list.find((v) => v.status === "accepted") ??
      list.find((v) => v.status === "open") ??
      list[0]
    );
  }
  const activeVariant = createMemo(() => variantFor(activeState()));

  // --- slots (server/fills.ts): a part with alternative fills ---

  // The slots of the look on stage for a state, never a hovered one: a preview
  // must not make questions appear and vanish under the pointer.
  const slotsIn = (state: string | null): SlotInfo[] => variantFor(state, false)?.slots ?? [];
  // The slot an ask chooses: every option sets exactly that one slot's path.
  function askSlot(ask: Ask): SlotInfo | null {
    const m = mock();
    if (!m) return null;
    const paths = new Set(ask.options.flatMap((o) => Object.keys(o.set ?? {})));
    if (paths.size !== 1) return null;
    const [path] = paths;
    return slotsIn(askState(ask, m, activeState())).find((sl) => sl.part === path) ?? null;
  }
  // The values in force on a state's look (defaults, answers, tuning).
  function valuesIn(state: string | null): Record<string, KnobValue> {
    const m = mock();
    if (!m) return {};
    return resolveKnobs({
      ...knobContext(),
      knobs: { ...m.knobs, ...variantFor(state, false)?.knobs },
    });
  }
  // A slot inside a fill that isn't chosen: its question doesn't apply now.
  // Walks up, so a slot two fills deep is dormant when either is unchosen.
  function dormantOf(ask: Ask): { part: string; fill: string; label: string } | null {
    const m = mock();
    let slot = askSlot(ask);
    if (!m || !slot?.parent) return null;
    const state = askState(ask, m, activeState());
    const slots = slotsIn(state);
    const values = valuesIn(state);
    while (slot?.parent) {
      const { part, fill }: { part: string; fill: string } = slot.parent;
      const parent: SlotInfo | undefined = slots.find((sl) => sl.part === part);
      if ((values[part] ?? parent?.default) !== fill) {
        const label = parent?.fills.find((f) => f.name === fill)?.label ?? fill;
        return { part, fill, label };
      }
      slot = parent ?? null;
    }
    return null;
  }
  // The ask this one waits on (`after`) while that one has no answer yet.
  function waitingOn(ask: Ask): Ask | null {
    if (!ask.after) return null;
    const before = mock()?.asks.find((a) => a.id === ask.after);
    return before && answerOf(before) === undefined && !before.dismissed ? before : null;
  }
  // What an answered `after` ask chose, which this one's pictures show.
  function shownWith(ask: Ask): { ask: Ask; labels: string } | null {
    if (!ask.after) return null;
    const before = mock()?.asks.find((a) => a.id === ask.after);
    if (!before || answerOf(before) === undefined) return null;
    const ids = answerIds(answerOf(before));
    const labels = before.options
      .filter((o) => ids.includes(o.id))
      .map((o) => o.label)
      .join(", ");
    return labels ? { ask: before, labels } : null;
  }
  // The parts an ask's options change: each knob `set` names a part (a slot is
  // its own part; "key.color" belongs to "key"), in the labels the user reads.
  function changesOf(ask: Ask): string[] {
    const m = mock();
    if (!m) return [];
    const names = new Set<string>();
    for (const o of ask.options) {
      for (const path of Object.keys(o.set ?? {})) {
        const part = askSlot(ask)?.part ?? knobPart(path);
        if (part) names.add(part);
      }
    }
    const label = (name: string) =>
      m.parts.flatMap((s) => s.parts).find((p) => p.name === name)?.label ?? name;
    return [...names].map(label);
  }
  // How deep an ask's slot sits inside other fills (0 at the top of the screen).
  function slotDepth(ask: Ask): number {
    const m = mock();
    let slot = askSlot(ask);
    if (!m || !slot) return 0;
    const slots = slotsIn(askState(ask, m, activeState()));
    let depth = 0;
    while (slot?.parent) {
      depth++;
      slot = slots.find((sl) => sl.part === slot!.parent!.part) ?? null;
    }
    return depth;
  }

  // What the user chose so far (sent, then drafted), so Mix can't contradict it.
  const chosen = createMemo(() => {
    const answers: Record<string, AskAnswer> = {};
    const others: Record<string, string> = {};
    for (const a of asks()) {
      if (a.answer !== undefined) answers[a.id] = a.answer;
      if (a.other !== undefined) others[a.id] = a.other;
    }
    const d = draft();
    for (const id of Object.keys(d?.answers ?? {})) delete others[id];
    for (const id of Object.keys(d?.others ?? {})) delete answers[id];
    Object.assign(answers, d?.answers ?? {});
    Object.assign(others, d?.others ?? {});
    return { answers, others, tuned: d?.tuned ?? {} };
  });
  const settled = createMemo(() => {
    const c = chosen();
    return mixSettled(asks(), c.answers, c.others, c.tuned);
  });
  const partStates = (part: string) =>
    (mock()?.parts ?? []).filter((s) => s.parts.some((p) => p.name === part)).map((s) => s.state);
  const allowedMix = (mix: Record<string, string>) => pruneMix(mix, settled(), partStates);
  const mixOpts = createMemo(() => {
    const m = mock();
    return m
      ? mixOptions(
          withAsks(m),
          variants(),
          lookPick(),
          (state, variant) => reports[frameKey(state, variant)],
          settled(),
        )
      : [];
  });
  // What the user still has to say: an ask open on the server, one they chose
  // to change, or one their draft already speaks for (so a reload never hides
  // an unsent answer). A sent answer stays out of the way.
  const inDraft = (ask: Ask) => {
    const d = draft();
    return (
      !!d &&
      (d.answers[ask.id] !== undefined ||
        d.others[ask.id] !== undefined ||
        d.notes[ask.id] !== undefined)
    );
  };
  const live = (ask: Ask) =>
    (!askAnswered(ask) && !ask.dismissed) || !!revising()[ask.id] || inDraft(ask);
  const ordered = createMemo<Ask[]>(() => {
    const m = mock();
    if (!m) return [];
    // A slot's question comes right after the question of the slot it sits in.
    const all = asks();
    const slotOf = new Map(all.map((a) => [a.id, askSlot(a)]));
    const parentAsk = (a: Ask) => {
      const parent = slotOf.get(a.id)?.parent;
      return parent ? all.find((b) => slotOf.get(b.id)?.part === parent.part) : undefined;
    };
    const ordered: Ask[] = [];
    const put = (a: Ask) => {
      if (ordered.includes(a)) return;
      ordered.push(a);
      for (const c of all) if (parentAsk(c) === a) put(c);
    };
    for (const a of all) if (!parentAsk(a)) put(a);
    for (const a of all) put(a);
    return ordered;
  });
  // The questions state by state, in the mock's order: each state holds the
  // asks about it (askStates), so a mock-wide one appears on every state it
  // applies to and is answered once for all of them.
  const flow = createMemo<FlowEntry[]>(() => {
    const m = mock();
    if (!m) return [];
    const open = ordered().filter(live);
    const out: FlowEntry[] = [];
    for (const state of states()) {
      for (const ask of open)
        if (askStates(ask, m, variants()).includes(state)) out.push({ state, ask });
    }
    return out;
  });
  const entriesIn = (state: string | null) => flow().filter((e) => e.state === state);
  // The questions on the state on stage. Borrowing a part from another look is
  // in Tune, per part, not a question.
  const questions = createMemo<Question[]>(() =>
    entriesIn(activeState()).map((e) => ({ kind: "ask", ask: e.ask })),
  );
  // Each ask once, in the order the flow first meets it: what the review lists.
  const reviewAsks = createMemo<Ask[]>(() => {
    const seen = new Set<string>();
    return flow().flatMap((e) => (seen.has(e.ask.id) ? [] : (seen.add(e.ask.id), [e.ask])));
  });
  // Sent answers (and asks a resolution dismissed) on the state on stage, or on
  // every state: the folded, read-only Answered group.
  const closedAsks = (scope: "state" | "all") => {
    const m = mock();
    if (!m) return [];
    return ordered().filter(
      (a) =>
        !live(a) &&
        (askAnswered(a) || !!a.dismissed) &&
        (scope === "all" || askStates(a, m, variants()).includes(activeState())),
    );
  };
  const owed = createMemo(() => {
    const m = mock();
    return m ? unanswered(withAsks(m), draft()).filter((a) => !dormantOf(a) && !waitingOn(a)) : [];
  });
  const isOwed = (ask: Ask) => owed().some((a) => a.id === ask.id);
  // How many questions still owed are shown on a state, for its tab.
  const owedIn = (state: string | null) => entriesIn(state).filter((e) => isOwed(e.ask)).length;
  // Tune is shown only with something to tune (tiers, no modes).
  const tuneShown = createMemo(() => {
    const m = mock();
    return !!m && tuneVisible(m, inState(activeState()));
  });
  // What Tune reads and writes: the knobs of the variant on stage, the drafted
  // answers, the tuned values, and what earlier replies settled.
  const knobContext = createMemo<KnobContext>(() => {
    const m = mock();
    return {
      knobs: { ...m?.knobs, ...activeVariant()?.knobs },
      asks: m?.asks ?? [],
      answers: draft()?.answers ?? {},
      tuned: draft()?.tuned ?? {},
      settled: m?.settled ?? {},
    };
  });
  // The part the current question is about, while Questions is open: the slot
  // it chooses a fill for, else the part it is scoped to.
  const focusPart = createMemo(() => {
    if (mode() !== "questions") return null;
    const borrowing = preview()?.part;
    if (borrowing) return borrowing;
    const q = questions()[cur()];
    if (q?.kind !== "ask") return null;
    return askSlot(q.ask)?.part ?? (q.ask.scope === "part" ? (q.ask.part ?? null) : null);
  });
  // The part outlined on the stage. selectedPart outlives the question that set
  // it (Tune opens on it), so outside Tune the outline follows the question.
  const stagePart = createMemo(() =>
    mode() === "tune" ? selectedPart() : (tapped() ?? focusPart()),
  );
  // A borrow made before the user chose that part's fate would contradict it.
  createEffect(() => {
    const mix = draft()?.mix ?? {};
    const kept = allowedMix(mix);
    if (Object.keys(kept).length === Object.keys(mix).length) return;
    const m = mock();
    const c = chosen();
    const notes = Object.keys(mix)
      .filter((part) => !(part in kept))
      .map((part) => {
        const by = mixDropCause(asks(), c.answers, c.others, part, partStates);
        const label = m ? partLabel(m, part) : part;
        // A heading that only repeats the part ("Hero") or says nothing
        // ("Question") gives way to the question's own words.
        const name = by && m ? askName(by, m) : null;
        const topic = name === "Question" || name === label ? by?.text : name;
        const why = by ? `your answer to “${topic}” decides it` : "your tuned value decides it";
        return { part, note: `Removed “${label}” from Mix — ${why}` };
      });
    setMixDropped((prev) => [
      ...prev.filter((x) => !notes.some((n) => n.part === x.part)),
      ...notes,
    ]);
    writeDraft((d) => ({ ...d, mix: kept }));
  });

  // --- draft writes: local at once, server after a short pause ---

  let saveTimer = 0;
  let lastLocalWrite = 0;
  let pending: DraftInput | null = null;
  async function flush() {
    const m = mock();
    const d = pending;
    pending = null;
    host().window.clearTimeout(saveTimer);
    if (!m || !d) return;
    try {
      await api.putDraft(m.id, d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function writeDraft(fn: (d: DraftInput) => DraftInput) {
    const base = draft() ?? emptyDraft(boundVersion() ?? latest());
    const next = fn({
      ...base,
      answers: { ...base.answers },
      mix: { ...base.mix },
      tuned: { ...base.tuned },
      comments: [...base.comments],
      others: { ...base.others },
      notes: { ...base.notes },
      otherImages: { ...base.otherImages },
      noteImages: { ...base.noteImages },
    });
    batch(() => {
      setDraftSignal(next);
      setSent(false);
      setError(null);
    });
    // Answering again here means staying: no carrying off to the next mock.
    host().window.clearTimeout(forwardTimer);
    setAfterSend(null);
    pending = next;
    lastLocalWrite = Date.now();
    host().window.clearTimeout(saveTimer);
    saveTimer = host().window.setTimeout(flush, SAVE_MS);
  }

  // --- loading and the live feed ---

  let mockId: string | null = null;
  let disposed = false;
  let unwatch = () => {};
  async function resolveId(): Promise<string | null> {
    if (mockId) return mockId;
    const list = await api.mocks(project);
    mockId = list.mocks.find((m) => m.slug === slug)?.id ?? null;
    if (mockId && !disposed) unwatch = watchMock(mockId);
    return mockId;
  }
  async function loadMock() {
    const id = await resolveId();
    if (!id) {
      setMissing(true);
      return;
    }
    const m = await api.mock(id);
    batch(() => {
      setMock(m);
      setMissing(false);
      // The first load lands on the variant the user opened, once.
      const at = open;
      if (at && m.variants.some((v) => v.state === at.state && v.variant === at.variant)) {
        setActiveState(at.state);
        setChosenVariant({ [String(at.state)]: at.variant });
        open = null;
      }
      if (!states().includes(activeState())) setActiveState(states()[0]);
    });
  }
  async function loadDraft() {
    const id = await resolveId();
    if (!id) return;
    const { draft: d } = await api.draft(id).catch(() => ({ draft: null }));
    if (Date.now() - lastLocalWrite < 1500 || pending) return;
    setDraftSignal(
      d
        ? {
            version: d.version,
            answers: d.answers,
            mix: d.mix,
            tuned: d.tuned,
            comments: d.comments,
            others: d.others ?? {},
            notes: d.notes ?? {},
            otherImages: d.otherImages ?? {},
            noteImages: d.noteImages ?? {},
          }
        : null,
    );
  }
  async function loadComments() {
    const id = await resolveId();
    if (!id) return;
    const { comments: list } = await api.comments(id);
    setComments(list);
  }

  async function start() {
    await loadMock();
    await Promise.all([loadDraft(), loadComments()]);
    const m = mock();
    if (!m) return;
    // Open on the first question still owed, on the state it is about; a draft
    // that already answers everything resumes on its review, one tap from Send.
    const first = firstOwed();
    if (!first && asks().length && !draftIsEmpty(draft())) {
      goReview({ history: false });
      return;
    }
    goQuestion(first?.to ?? 0, { history: false, ...(first ? { state: first.state } : {}) });
  }

  const refetch = coalesce({ mock: loadMock, draft: loadDraft, comments: loadComments });
  const stop = subscribe(
    (e) => {
      const id = mockId;
      switch (e.type) {
        case "mock-created":
        case "mock-updated":
          if (e.id === id) refetch("mock");
          break;
        case "mock-deleted":
          if (e.id === id) setMissing(true);
          break;
        case "post-created":
        case "post-updated":
        case "post-deleted":
          if (e.mockId === id) refetch("mock");
          break;
        case "draft-updated":
          if (e.mockId === id) refetch("draft");
          break;
        case "comment-created":
          if (e.mockId === id) refetch("comments");
          break;
        case "session-created":
          // A new session may supersede the one an undelivered Send waits on.
          if (comments().some((c) => !c.delivered)) refetch("comments");
          break;
        case "comment-deleted":
        case "comment-delivered":
          if (
            e.sessionId === mock()?.sessionId ||
            comments().some((c) => c.sessionId === e.sessionId)
          )
            refetch("comments");
          break;
        case "theme-changed":
          setTheme(e.mode === "light" ? "light" : "dark");
          break;
      }
    },
    () => {
      if (mockId) {
        refetch("mock");
        refetch("draft");
        refetch("comments");
      }
    },
  );
  onCleanup(() => {
    disposed = true;
    stop();
    unwatch();
    if (pending) void flush();
  });

  // --- navigation inside the screen ---

  // Each question, mode and viewed version is a history step, so Back walks
  // them; values (picks, tuning) are not.
  type Snap = {
    mockpit: "mock";
    state: string | null;
    mode: Mode;
    cur: number;
    review: boolean;
    view: number | null;
  };
  const snap = (): Snap => ({
    mockpit: "mock",
    state: activeState(),
    mode: mode(),
    cur: cur(),
    review: reviewing(),
    view: viewVersion(),
  });
  function record(replace: boolean) {
    const h = host().history;
    if (replace) h.replaceState(snap(), "");
    else h.pushState(snap(), "");
  }
  function restoreSnap(s: unknown) {
    if (!s || typeof s !== "object" || (s as Snap).mockpit !== "mock") return false;
    const v = s as Snap;
    cancelAdvance();
    batch(() => {
      setActiveState(v.state);
      setModeSignal(v.mode);
      setCur(v.cur);
      setReviewing(!!v.review);
      setReturning(false);
      setViewVersion(v.view);
      setPreview(null);
      setVersionsOpen(false);
    });
    return true;
  }

  // A pick's move-on, pending for a beat. Any other move cancels it: the user
  // has gone elsewhere, and coming back to the same question must not let the
  // stale move fire then.
  let advanceTimer = 0;
  const cancelAdvance = () => host().window.clearTimeout(advanceTimer);
  onCleanup(cancelAdvance);
  // Any move the user makes on this screen after a Send means they are still
  // here: neither a pending move-on nor the carry to the next mock may fire.
  const userMoved = () => {
    cancelAdvance();
    stayHere();
  };

  // The ith question on a state (the one on stage unless named), which comes
  // on stage with it.
  function goQuestion(
    i: number,
    opts: { history?: boolean; fromReview?: boolean; state?: string | null } = {},
  ) {
    userMoved();
    const state = opts.state === undefined ? activeState() : opts.state;
    const ask = entriesIn(state)[i]?.ask;
    batch(() => {
      setActiveState(state);
      setCur(i);
      setReviewing(false);
      setReturning(!!opts.fromReview);
      setModeSignal("questions");
      setTapped(null);
      setPreview(null);
      if (ask?.scope === "part" && ask.part) setSelectedPart(ask.part);
    });
    if (opts.history !== false) record(false);
    else record(true);
  }
  // An ask wherever it shows, on the state on stage when it shows there.
  function goAsk(id: string, opts: { fromReview?: boolean } = {}) {
    const here = entriesIn(activeState()).findIndex((e) => e.ask.id === id);
    if (here >= 0) return goQuestion(here, opts);
    const e = flow().find((x) => x.ask.id === id);
    if (e) goQuestion(entriesIn(e.state).indexOf(e), { ...opts, state: e.state });
  }
  function goOwed() {
    const first = firstOwed();
    if (first) goQuestion(first.to, { state: first.state });
    else setMode("questions");
  }
  // "Change answer" on a sent one: deliberate, so it alone reopens it.
  function changeAnswer(ask: Ask) {
    if (readonly()) return;
    setRevising({ ...revising(), [ask.id]: true });
    goAsk(ask.id);
  }
  // Leave a sent answer as it was: whatever the draft held for it goes, and so
  // does the question.
  function keepAnswer(ask: Ask) {
    const { [ask.id]: _, ...rest } = revising();
    setRevising(rest);
    if (inDraft(ask)) {
      writeDraft((d) => {
        for (const rec of [d.answers, d.others, d.notes, d.otherImages, d.noteImages]) {
          delete rec[ask.id];
        }
        return d;
      });
    }
    const { [ask.id]: _open, ...opened } = otherOpen();
    setOtherOpen(opened);
    const next = firstOwed();
    if (next) goQuestion(next.to, { state: next.state });
    else goQuestion(0);
  }
  const revisingOf = (ask: Ask) => !!revising()[ask.id] && askAnswered(ask);
  // Back from Resolved: the questions it closed are open again.
  async function reopen() {
    const m = mock();
    if (!m) return;
    try {
      await api.reopen(m.id);
      await loadMock();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function goReview(opts: { history?: boolean } = {}) {
    userMoved();
    batch(() => {
      setReviewing(true);
      setReturning(false);
      setModeSignal("questions");
      setTapped(null);
      setPreview(null);
    });
    record(opts.history === false);
  }
  function setMode(next: Mode) {
    if (next === "questions") return reviewing() ? goReview() : goQuestion(cur());
    userMoved();
    batch(() => {
      setModeSignal(next);
      setPreview(null);
      setTapped(null);
    });
    record(false);
  }
  // A state picked on the strip brings its own questions: the first it still
  // owes, else its first.
  function showState(state: string | null) {
    userMoved();
    const here = entriesIn(state);
    const owedAt = here.findIndex((e) => isOwed(e.ask));
    batch(() => {
      setActiveState(state);
      setPreview(null);
      if (!reviewing()) {
        setCur(Math.max(0, owedAt));
        setReturning(false);
      }
    });
    record(true);
  }
  function chooseVariant(variant: string) {
    userMoved();
    setChosenVariant({ ...chosenVariant(), [String(activeState())]: variant });
  }
  // On the canvas a tap on the design only marks the part: opening Tune there
  // would cover the design the user is looking at. With no Tune to open,
  // it marks the part too, so it can still take a reaction.
  function selectPart(part: string | null) {
    setSelectedPart(part);
    if (canvasLayout() || !tuneShown()) setTapped(part);
    else if (part && mode() !== "tune") setMode("tune");
  }
  // No Tune tab (nothing to tune): a Tune mode restored from history or set by
  // a stray click lands on Questions instead.
  createEffect(() => {
    if (mode() === "tune" && mock() && !tuneShown()) setModeSignal("questions");
  });

  const widthKey = (id: string) => `mockpit-width:${id}`;
  // Keyed by id alone: a refetch or a resize must not undo the user's choice.
  createEffect(
    on(
      () => mock()?.id,
      (id) => {
        if (!id) return;
        let stored: string | null = null;
        try {
          stored = host().storage?.getItem(widthKey(id)) ?? null;
        } catch {
          // Unreadable storage: fall back to the default width.
        }
        const declared = mock()?.widths ?? [];
        const picked = readDeviceWidth(stored, declared);
        setWidthPicked(picked !== null);
        setFrameWSignal(picked ?? declared[0] ?? defaultDeviceWidth(win().w, coarse()));
      },
    ),
  );
  createEffect(() => {
    // Widths the agent declared are the ones to judge at, overflow or not.
    if (widthPicked() || (mock()?.widths ?? []).length) return;
    const v = activeVariant();
    const w = v && overflowWidth(frameW(), reports[frameKey(v.state, v.variant)]);
    if (w) setFrameWSignal(w);
  });
  function setFrameW(w: number) {
    setWidthPicked(true);
    setFrameWSignal(w);
    const id = mock()?.id;
    if (!id) return;
    try {
      host().storage?.setItem(widthKey(id), String(w));
    } catch {
      // Storage full or denied: the width still applies for this visit.
    }
  }

  // The next question still owed after the ith on the state on stage: later on
  // that state, then earlier on it, then on the other states from the next one
  // round. null once none is, which is the review step's turn.
  function nextStop(i: number): Stop | null {
    const st = activeState();
    const here = entriesIn(st);
    const current = here[i]?.ask.id;
    const owes = (e: FlowEntry) => e.ask.id !== current && isOwed(e.ask);
    for (let k = 1; k <= here.length; k++) {
      const j = (((i + k) % here.length) + here.length) % here.length;
      if (owes(here[j])) return { state: st, to: j };
    }
    const all = states();
    const at = all.indexOf(st);
    for (let k = 1; k < all.length; k++) {
      const other = all[(at + k) % all.length];
      const j = entriesIn(other).findIndex(owes);
      if (j >= 0) return { state: other, to: j };
    }
    return null;
  }
  // The first question still owed: on the state on stage if it has one, else
  // the first in the mock's order.
  function firstOwed(): Stop | null {
    const st = activeState();
    const here = entriesIn(st).findIndex((e) => isOwed(e.ask));
    if (here >= 0) return { state: st, to: here };
    for (const other of states()) {
      const j = entriesIn(other).findIndex((e) => isOwed(e.ask));
      if (j >= 0) return { state: other, to: j };
    }
    return null;
  }
  // Where the question on stage sits in the whole flow (half a step before
  // where its state's entries would be, when it has none), so the arrows walk
  // every state in turn.
  const flowAt = createMemo(() => {
    const all = states();
    const at = all.indexOf(activeState());
    const start = flow().findIndex((e) => all.indexOf(e.state) >= at);
    const base = start < 0 ? flow().length : start;
    const n = questions().length;
    return n ? base + Math.min(cur(), n - 1) : base - 0.5;
  });

  // --- answers ---

  // `null` is "Other…".
  function pick(ask: Ask, optionId: string | null) {
    const wasOpen = otherTicked(ask);
    const typed = { text: otherOf(ask) ?? "", images: otherImagesOf(ask) };
    const kept = otherStash()[ask.id];
    let open = false;
    writeDraft((base) => {
      const r = pickInDraft(base, ask, optionId, !!otherOpen()[ask.id]);
      open = r.otherOpen;
      let d = r.draft;
      if (!wasOpen && open && kept) d = setAskField(d, ask.id, "other", kept.text, kept.images);
      if (optionId !== null && look()?.id === ask.id) {
        // A borrow from the look just picked is no longer a borrow.
        const chosen = ask.options.find((o) => o.id === optionId)?.variant;
        for (const p of Object.keys(d.mix)) if (d.mix[p] === chosen) delete d.mix[p];
      }
      return d;
    });
    setOtherOpen({ ...otherOpen(), [ask.id]: open });
    if (wasOpen && !open && (typed.text.trim() || typed.images.length)) {
      setOtherStash({ ...otherStash(), [ask.id]: typed });
    } else if (!wasOpen && open && kept) {
      const { [ask.id]: _, ...rest } = otherStash();
      setOtherStash(rest);
    }
    setFlagged(flagged().filter((x) => x !== ask.id));
  }
  const foldedOf = (ask: Ask, field: AskField) => !!folded()[`${field}:${ask.id}`];
  const setFolded = (ask: Ask, field: AskField, on: boolean) =>
    setFoldedSignal({ ...folded(), [`${field}:${ask.id}`]: on });
  // The write-in under "Other…", and the note on a question, with their
  // images. Blank text with no image is none.
  function setField(ask: Ask, field: AskField, text: string, images: string[]) {
    writeDraft((d) => {
      const next = setAskField(d, ask.id, field, text, images);
      if (field === "other" && next.others[ask.id] !== undefined && !ask.multi) {
        delete next.answers[ask.id];
      }
      return next;
    });
    if (field === "other") setOtherOpen({ ...otherOpen(), [ask.id]: true });
  }
  const setOther = (ask: Ask, text: string) => setField(ask, "other", text, otherImagesOf(ask));
  const setNote = (ask: Ask, text: string) => setField(ask, "note", text, noteImagesOf(ask));

  function setPending(slot: string, fn: (list: PendingImage[]) => PendingImage[]) {
    const all = { ...uploads() };
    const next = fn(all[slot] ?? []);
    if (next.length) all[slot] = next;
    else delete all[slot];
    setUploads(all);
  }
  let uploadSeq = 0;
  // Uploads at once, so Send never waits on bytes; the draft only ever holds
  // ids the server has. A file that can't go keeps its chip with the reason.
  async function attachImages(ask: Ask, field: AskField, files: File[]) {
    const m = mock();
    if (!m || !files.length) return;
    const slot = `${field}:${ask.id}`;
    const room = MAX_ASK_IMAGES - imagesOf(ask, field).length - pendingOf(ask, field).length;
    if (room <= 0) {
      setAttachStatus(`At most ${MAX_ASK_IMAGES} images here`);
      return;
    }
    if (files.length > room) setAttachStatus(`At most ${MAX_ASK_IMAGES} images here`);
    await Promise.all(
      files.slice(0, room).map(async (file) => {
        const key = `u${++uploadSeq}`;
        const url = URL.createObjectURL(file);
        const failed = (why: string) => {
          setPending(slot, (l) => l.map((p) => (p.key === key ? { ...p, error: why } : p)));
          setAttachStatus(why);
        };
        setPending(slot, (l) => [...l, { key, url, name: file.name }]);
        const refused = rejectReason(file);
        if (refused) return failed(refused);
        try {
          const blob = await prepareImage(file);
          const name = `${file.name.replace(/\.[^.]*$/, "") || "image"}.${extensionOf(blob.type)}`;
          const { id } = await api.attach(m.id, blob, name);
          const was = pendingOf(ask, field).some((p) => p.key === key);
          setPending(slot, (l) => l.filter((p) => p.key !== key));
          URL.revokeObjectURL(url);
          // Removed while it was uploading: the user no longer wants it.
          if (!was) return;
          const images = imagesOf(ask, field);
          if (!images.includes(id)) setField(ask, field, textOf(ask, field), [...images, id]);
          setAttachStatus(`Attached ${file.name || "image"}`);
        } catch (e) {
          failed(e instanceof Error ? e.message : String(e));
        }
      }),
    );
  }
  function detachImage(ask: Ask, field: AskField, id: string) {
    setField(
      ask,
      field,
      textOf(ask, field),
      imagesOf(ask, field).filter((x) => x !== id),
    );
    setAttachStatus("Image removed");
  }
  function dismissPending(ask: Ask, field: AskField, key: string) {
    const p = pendingOf(ask, field).find((x) => x.key === key);
    if (p) URL.revokeObjectURL(p.url);
    setPending(`${field}:${ask.id}`, (l) => l.filter((x) => x.key !== key));
  }
  onCleanup(() => {
    for (const list of Object.values(uploads())) for (const p of list) URL.revokeObjectURL(p.url);
  });
  // `null` is "No, all <look>": clears every borrow.
  function toggleMix(opt: { part: string; variant: string } | null) {
    writeDraft((d) => {
      if (!opt) d.mix = {};
      else if (d.mix[opt.part] === opt.variant) delete d.mix[opt.part];
      else d.mix[opt.part] = opt.variant;
      return d;
    });
    setMixTouched(true);
    // A fresh Mix choice answers the notice; it has nothing left to explain.
    setMixDropped([]);
  }
  const mixAnswered = () => mixTouched() || Object.keys(draft()?.mix ?? {}).length > 0;
  function addComment(
    part: string | null,
    state: string | null,
    text: string,
    anchor?: PartCommentAnchor,
  ) {
    writeDraft((d) => {
      d.comments.push(anchor ? { part, state, text, anchor } : { part, state, text });
      return d;
    });
  }
  // A one-tap reaction on a part of the variant on stage, or (part null) on the
  // variant itself. Toggles: the same reaction again takes it back.
  function react(part: string | null, reaction: Reaction) {
    const v = activeVariant();
    if (!v) return;
    const target = { part, state: activeState(), variant: v.variant };
    let now: Reaction | null = null;
    writeDraft((d) => {
      d.comments = toggleReaction(d.comments, target, reaction);
      now = reactionOf(d.comments, target);
      return d;
    });
    setReactStatus(reactionStatus(part ?? v.variant, now));
  }
  const reactionOn = (part: string | null): Reaction | null => {
    const v = activeVariant();
    return v
      ? reactionOf(draft()?.comments ?? [], { part, state: activeState(), variant: v.variant })
      : null;
  };
  // A frame's sendPrompt: the text waits in Thread for the user to send it,
  // never straight to the agent.
  function prefill(text: string) {
    setThreadText(text);
    setMarking(false);
    if (mode() !== "thread") setMode("thread");
  }
  async function postComment(text: string) {
    const m = mock();
    if (!m) return false;
    try {
      await api.comment(m.id, text);
      setThreadText("");
      await loadComments();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }
  // D13: un-archive a variant in each of the given states.
  async function restoreVariant(variant: string, inStates: (string | null)[]) {
    const m = mock();
    if (!m) return;
    try {
      for (const st of inStates) await api.restoreVariant(m.id, st, variant);
      await loadMock();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function starVariant(v: { state: string | null; variant: string }, starred: boolean) {
    const m = mock();
    if (!m) return;
    try {
      await api.star(m.id, v.state, v.variant, starred);
      await loadMock();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  // Tune's writer (phase 4b): one tuned knob value into the draft.
  function setTuned(path: string, value: KnobValue | undefined) {
    writeDraft((d) => {
      if (value === undefined) delete d.tuned[path];
      else d.tuned[path] = value;
      return d;
    });
  }

  // A preset restores a whole set of tuned values at once.
  function replaceTuned(values: Record<string, KnobValue>) {
    writeDraft((d) => {
      d.tuned = { ...values };
      return d;
    });
  }

  // Whether an agent has the last Send yet; null when nothing was sent here.
  const sentDelivered = createMemo(() => {
    const id = sentId();
    if (!sent() || !id) return null;
    return comments().find((c) => c.id === id)?.delivered ?? false;
  });
  const nudgeAgent = () => beat() && sentDelivered() === false;
  let beatTimer = 0;
  onCleanup(() => host().window.clearTimeout(beatTimer));

  async function send(extra: { decision?: ReplyDecision; text?: string } = {}) {
    const m = mock();
    if (!m || sending()) return;
    await flush();
    const d = draft() ?? emptyDraft(stageVersion());
    setSending(true);
    try {
      // A question inside a fill that isn't chosen doesn't apply: its answer stays out.
      const asleep = new Set(
        asks()
          .filter((a) => dormantOf(a))
          .map((a) => a.id),
      );
      const keep = <T>(rec: Record<string, T>) =>
        Object.fromEntries(Object.entries(rec).filter(([id]) => !asleep.has(id)));
      const { reply } = await api.reply(m.id, {
        ...d,
        answers: keep(d.answers),
        others: keep(d.others),
        mix: allowedMix(d.mix),
        ...extra,
      });
      // The draft holds the picks until the mock carrying them as sent answers
      // arrives: dropping it first would put the stage on another variant for
      // one fetch (a flash of a different frame fading in, then back).
      const [next] = await Promise.all([
        api.mock(m.id).catch(() => null),
        loadComments().catch(() => {}),
      ]);
      batch(() => {
        if (next) setMock(next);
        setDraftSignal(null);
        setSent(true);
        setSentId(reply.id);
        setBeat(false);
        setModeSignal("thread");
        setPreview(null);
        setTapped(null);
      });
      setMixTouched(false);
      setMixDropped([]);
      setOtherOpen({});
      setOtherStash({});
      setFoldedSignal({});
      setRevising({});
      setReviewing(false);
      setReturning(false);
      record(true);
      host().window.clearTimeout(beatTimer);
      beatTimer = host().window.setTimeout(() => setBeat(true), BEAT_MS);
      void planNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  // --- the flow: question → review → Send → the next mock ---

  // Once a question is answered: on to the next one owed, else the review. One
  // opened from the review moves on too, so filling in what it showed open
  // takes one pass.
  function advance(from: number) {
    const next = nextStop(from);
    if (next !== null) goQuestion(next.to, { state: next.state });
    else goReview();
  }
  const goEntry = (e: FlowEntry) => goQuestion(entriesIn(e.state).indexOf(e), { state: e.state });
  // An ask's first entry: a mock-wide one met again on a later state is the
  // same question, so the arrows pass it by there unless they are already on
  // that state.
  const firstEntry = createMemo(() => {
    const first = new Map<string, FlowEntry>();
    for (const e of flow()) if (!first.has(e.ask.id)) first.set(e.ask.id, e);
    return first;
  });
  const stops = (e: FlowEntry) => e.state === activeState() || firstEntry().get(e.ask.id) === e;
  // Where ←/→ go from here: a question, the review after the last, or nowhere.
  const stepTarget = (by: 1 | -1): FlowEntry | "review" | null => {
    const fl = flow();
    if (reviewing()) {
      if (by === 1) return null;
      for (let j = fl.length - 1; j >= 0; j--)
        if (firstEntry().get(fl[j].ask.id) === fl[j]) return fl[j];
      return null;
    }
    if (by === 1) {
      for (let j = Math.floor(flowAt()) + 1; j < fl.length; j++) if (stops(fl[j])) return fl[j];
      return fl.length ? "review" : null;
    }
    for (let j = Math.ceil(flowAt()) - 1; j >= 0; j--) if (stops(fl[j])) return fl[j];
    return null;
  };
  // ←/→ and the arrows: one question at a time across the states, the review
  // after the last.
  function step(by: 1 | -1) {
    if (mode() !== "questions") return;
    const to = stepTarget(by);
    if (to === "review") goReview();
    else if (to) goEntry(to);
  }

  const asked = (ask: Ask) =>
    answerOf(ask) !== undefined || otherOf(ask) !== undefined || noteOf(ask) !== undefined;
  const primary = createMemo<Primary>(() => {
    if (!asks().length || mode() !== "questions") return null;
    if (reviewing()) {
      if (readonly()) return null;
      const to = firstOwed();
      if (to) return { kind: "owed", ...to };
      const count = sendCount(draft() ?? emptyDraft(0));
      return count > 0 ? { kind: "send", count } : null;
    }
    const qs = questions();
    // Nothing open on this state: on to a state that still asks, else the
    // review if there is anything to send.
    if (!qs.length) {
      const to = nextStop(-1);
      if (to) return { kind: "next", ...to };
      return draftIsEmpty(draft()) ? null : { kind: "review" };
    }
    const i = Math.min(cur(), qs.length - 1);
    const q = qs[i];
    const done = q.kind === "mix" ? mixAnswered() : asked(q.ask);
    const to = done ? nextStop(i) : null;
    if (returning()) return to ? { kind: "next", ...to } : { kind: "back" };
    if (!done) return stepTarget(1) === "review" ? { kind: "review" } : null;
    return to ? { kind: "next", ...to } : { kind: "review" };
  });
  function runPrimary() {
    const p = primary();
    if (!p) return;
    if (p.kind === "next" || p.kind === "owed") goQuestion(p.to, { state: p.state });
    else if (p.kind === "review" || p.kind === "back") goReview();
    else void send();
  }
  const review = createMemo(() => {
    const m = mock();
    if (!m) return [];
    const multi = m.states.length > 1;
    // An ask on one state is grouped under it; one on several, above them all.
    const only = (a: Ask) => {
      const on = [...new Set(flow().flatMap((e) => (e.ask.id === a.id ? [e.state] : [])))];
      return on.length === 1 ? on[0] : null;
    };
    return reviewRows(
      reviewAsks().map((ask) => ({ kind: "ask", ask })),
      {
        name: (a) => askName(a, m),
        pick: (a) => ({ ids: answerIds(answerOf(a)), other: otherOf(a), note: noteOf(a) }),
        owed: (a) => owed().some((o) => o.id === a.id),
        mix: draft()?.mix ?? {},
        mixAnswered: mixAnswered(),
        depth: slotDepth,
        group: (a) => (multi ? only(a) : null),
        dormant: (a) => !!dormantOf(a),
      },
    );
  });

  const optionKey = (ask: Ask, optionId: string) => `${ask.id}:${optionId}`;
  function previewOf(ask: Ask, optionId: string): Preview | null {
    const m = mock();
    const o = ask.options.find((x) => x.id === optionId);
    if (!m || !o) return null;
    const key = optionKey(ask, o.id);
    if (o.variant) return { key, variant: o.variant, state: askState(ask, m, activeState()) };
    return o.set ? { key, knobs: o.set } : null;
  }
  // A click, a tap or a number key on an option. On touch the first tap
  // previews on the stage (tapPicks) and a second tap on it picks; a key acts as
  // a click, having nothing to hover. A pick moves on, as a click does.
  function choose(ask: Ask, optionId: string, hover: boolean) {
    if (readonly()) return;
    const index = cur();
    const p = previewOf(ask, optionId);
    if (p?.knobs) {
      // A slot ask names its part and fill; a part-scoped ask its part;
      // otherwise the stage works it out from the parts reports.
      const slot = askSlot(ask);
      const fill = slot ? p.knobs[slot.part] : undefined;
      if (slot && typeof fill === "string") {
        const label = slot.fills.find((f) => f.name === fill)?.label ?? fill;
        showFlash(slot.part, `${slot.label ?? slot.part} · ${label}`);
      } else if (ask.scope === "part" && ask.part) showFlash(ask.part);
      else armFlash();
    }
    const tap = {
      hover,
      previewing: preview()?.key === optionKey(ask, optionId),
      canPreview: p !== null,
      unpicks: !!ask.multi && answerIds(answerOf(ask)).includes(optionId),
    };
    if (!tapPicks(tap)) {
      setPreview(p);
      return;
    }
    pick(ask, optionId);
    setPreview(null);
    if (ask.multi) return;
    cancelAdvance();
    advanceTimer = host().window.setTimeout(() => {
      if (mode() !== "questions" || reviewing() || cur() !== index) return;
      if (!answerIds(answerOf(ask)).includes(optionId)) return;
      advance(index);
    }, ADVANCE_MS);
  }
  // A number key: the nth option of the question on screen, "Other…" after them.
  function chooseNth(n: number) {
    if (mode() !== "questions" || reviewing()) return;
    const q = questions()[cur()];
    if (!q || q.kind !== "ask") return;
    const o = q.ask.options[n];
    if (o) choose(q.ask, o.id, true);
    else if (n === q.ask.options.length && !readonly()) pick(q.ask, null);
  }

  async function owedMock(by: 1 | -1): Promise<MockSummary | null> {
    const list = await api.mocks(project).catch(() => null);
    return list ? nextOwedMock(list.mocks, slug, by) : null;
  }
  async function goOwedMock(by: 1 | -1) {
    const next = await owedMock(by);
    if (next && !disposed) navigate(mockPath(project, next.slug));
  }
  let forwardTimer = 0;
  onCleanup(() => host().window.clearTimeout(forwardTimer));
  // The Send's status rides along, so Delivered stays in sight on the next mock.
  function goNext() {
    const a = afterSend();
    const m = mock();
    const id = sentId();
    host().window.clearTimeout(forwardTimer);
    if (!a?.next || disposed) return;
    if (m && id) setCarried({ project, slug, title: m.title, replyId: id, mockId: m.id });
    navigate(mockPath(project, a.next.slug));
  }
  function stayHere() {
    host().window.clearTimeout(forwardTimer);
    const a = afterSend();
    if (a?.auto) setAfterSend({ ...a, auto: false });
  }
  async function planNext() {
    const next = await owedMock(1);
    if (disposed) return;
    // A hidden tab never moves on by itself: the user would come back elsewhere.
    // Nor does it carry the user into another agent conversation's work, which
    // is a different piece of work even in the same repo: that one is offered.
    const auto =
      !!next &&
      next.sessionId === mock()?.sessionId &&
      host().window.document.visibilityState !== "hidden";
    setAfterSend({ next, auto });
    host().window.clearTimeout(forwardTimer);
    if (auto) forwardTimer = host().window.setTimeout(goNext, FORWARD_MS);
  }

  // --- versions ---

  function viewOld(version: number) {
    setVersionsOpen(false);
    const next = version >= latest() ? null : version;
    if (next === viewVersion()) return;
    setViewVersion(next);
    record(false);
  }
  function backToLatest() {
    setViewVersion(null);
    record(false);
  }
  async function restoreViewed() {
    const m = mock();
    const v = activeVariant();
    if (!m || !v) return;
    try {
      await api.restoreVersion(m.id, v.postId, frameVersion(v, stageVersion()));
      backToLatest();
      await loadMock();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  // The newer version a draft-bound stage is holding back.
  function viewNewVersion() {
    const m = mock();
    const d = draft();
    if (!m || !d) return;
    const moved = carryOver(d, withAsks(m), variants(), latest());
    writeDraft(() => moved.draft);
    setFlagged(moved.flagged);
  }

  const onPop = (e: PopStateEvent) => restoreSnap(e.state);
  host().window.addEventListener("popstate", onPop);
  onCleanup(() => host().window.removeEventListener("popstate", onPop));

  void start();

  return {
    project,
    slug,
    mock,
    missing,
    comments,
    draft,
    variants,
    states,
    latest,
    boundVersion,
    stageVersion,
    look,
    lookPick,
    answerOf,
    otherOf,
    otherTicked,
    noteOf,
    setOther,
    setNote,
    foldedOf,
    setFolded,
    imagesOf,
    pendingOf,
    attachImages,
    detachImage,
    dismissPending,
    attachStatus,
    tuneShown,
    variantFor,
    activeVariant,
    activeState,
    showState,
    chooseVariant,
    preview,
    setPreview,
    mode,
    setMode,
    cur,
    goQuestion,
    goAsk,
    goOwed,
    changeAnswer,
    keepAnswer,
    revisingOf,
    reopen,
    goReview,
    reviewing,
    returning,
    review,
    step,
    primary,
    runPrimary,
    choose,
    chooseNth,
    previewOf,
    optionKey,
    afterSend,
    goNext,
    stayHere,
    goOwedMock,
    keysOpen,
    setKeysOpen,
    nextStop,
    questions,
    flow,
    stepTarget,
    reviewAsks,
    closedAsks,
    asks,
    owed,
    owedIn,
    settled,
    mixOpts,
    mixAnswered,
    mixDropped,
    selectedPart,
    selectPart,
    focusPart,
    stagePart,
    flash,
    flashLabel,
    flashArmed,
    askSlot,
    dormantOf,
    waitingOn,
    shownWith,
    changesOf,
    showFlash,
    hoverPart,
    setHoverPart,
    viewVersion,
    viewOld,
    backToLatest,
    restoreViewed,
    viewNewVersion,
    versionsOpen,
    setVersionsOpen,
    embedPeek,
    setEmbedPeek,
    sent,
    sentDelivered,
    nudgeAgent,
    sending,
    flagged,
    error,
    setError,
    pick,
    toggleMix,
    addComment,
    react,
    reactionOn,
    reactStatus,
    reactPart: () => (mode() === "tune" ? selectedPart() : tapped()),
    frameW,
    setFrameW,
    inspect,
    setInspect,
    zoom,
    setZoom,
    stageScale,
    setStageScale,
    zoomMin,
    setZoomMin,
    marking,
    setMarking,
    threadText,
    setThreadText,
    prefill,
    postComment,
    restoreVariant,
    starVariant,
    setTuned,
    replaceTuned,
    knobContext,
    send,
    tuneHost,
    setTuneHost,
    reports,
    setReports,
    frameVersionOf: (v: Parameters<typeof frameVersion>[0]) => frameVersion(v, stageVersion()),
  };
}

export type MockScreenState = ReturnType<typeof createMockScreen>;

// Several events in one burst (a reply flips statuses on every variant) cost
// one refetch per kind, not one per event.
function coalesce<K extends string>(loaders: Record<K, () => Promise<void>>) {
  const timers = new Map<K, number>();
  return (kind: K) => {
    if (timers.has(kind)) return;
    timers.set(
      kind,
      host().window.setTimeout(() => {
        timers.delete(kind);
        loaders[kind]().catch(() => {});
      }, 60),
    );
  };
}
