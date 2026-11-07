// The design screen's state: the design as the server last sent it, the user's
// draft, and the view (state and version on stage, question, canvas tool,
// selection, preview, drawers). Components read signals from here and call
// its actions; nothing else talks to the API for this screen.

import type { ToastLine } from "./toast.tsx";
import { batch, createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js";
import { createStore } from "solid-js/store";
import {
  type AnswerCombo,
  type AnswerStanding,
  type Ask,
  type AskAnswer,
  type AskOption,
  askAnswered,
  type HiddenAnswer,
  isLive,
  recommendedAlternative,
  type KnobValue,
  MAX_ASK_IMAGES,
  optionState,
  type PartCommentAnchor,
  type Reaction,
  type ReplyVerdict,
  type SpecLine,
  type StateOutline,
} from "../../server/types.ts";
import type { SlotInfo } from "../../server/swaps.ts";
import { hiddenAnswer, type StandingKind, withStanding } from "../../server/standings.ts";
import {
  archivedAnswer,
  hiddenAlternativeAnswers,
  optionStates,
} from "../../server/alternativeQuestion.ts";
import { reactionOf, reactionStatus, toggleReaction } from "./reactionRules.ts";
import {
  api,
  type CommentRow,
  type DraftInput,
  type DesignDetail,
  type DesignSummary,
  type SendRecipients,
  subscribe,
  type AlternativeView,
  watchDesign,
  ApiError,
} from "./api.ts";
import { extensionOf, prepareImage, rejectReason } from "./attach.ts";
import { BEAT_MS, setCarried } from "./carry.ts";
import { host, readonly } from "./host.ts";
import {
  answerIds,
  askName,
  askAbout,
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
  isBuiltinAsk,
  lookAsk,
  picksAlternative,
  mixDropCause,
  mixOptions,
  mixSettled,
  partLabel,
  pruneMix,
  knobPart,
  resolveKnobs,
  designVersion,
  nextOwedDesign,
  overflowWidth,
  listedSteps,
  neighbourStep,
  type PartsReport,
  sameVersion,
  stepFor,
  type VersionRef,
  versionName,
  versionSteps,
  type Zoom,
  pickInDraft,
  readDeviceWidth,
  setAskField,
  tuneVisible,
  unanswered,
  canOutline,
  keepSame,
  keepSameAsks,
  missingStates,
  stepKey,
  type VersionStep,
  shortLabel,
  splitLabel,
} from "./logic.ts";
import { navigate, questionPath, type ScreenOpen } from "./route.ts";
import { setTheme } from "./theme.ts";
import { coarse, phoneLayout, win } from "./viewport.ts";

const RECIPIENTS_MS = 10_000;

// The canvas's tools: Try hands taps to the design, Mark leaves a comment
// where you tap, Tune outlines the parts and opens one's knobs.
export type Tool = "try" | "mark" | "tune";
// The bottom panel, opened from the version label.
export type PanelTab = "history" | "thread" | "spec";
export type AskField = "other" | "comment";
// A section of the spec being written: what it is for, or the lines of how it works.
export type SpecDraft =
  | { section: "purpose"; text: string }
  | { section: "behaviour"; lines: SpecLine[] };

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

// What the stage shows while the pointer rests on an option: another alternative,
// or knob values sent live to the frame on stage.
export interface Preview {
  key: string;
  // An option's words, for saying what the stage is showing.
  label?: string;
  alternative?: string;
  // A version option: exactly that version of the alternative.
  version?: number;
  state?: string | null;
  knobs?: Record<string, KnobValue>;
  // An answer that chooses a palette of the project's system.
  palette?: string;
  // A Mix borrow: the part outlined on the donor look while it previews.
  part?: string;
}

// Where Send leaves the user: the next design still owing answers (null when none
// does), and whether the screen is about to carry them there on its own.
export interface AfterSend {
  next: DesignSummary | null;
  auto: boolean;
}

const SAVE_MS = 300;
// Long enough to read "Next: …" and press Stay, short enough to feel carried.
const FORWARD_MS = 1600;

// Where this browser last left a design. Versions stay out: a revision that
// arrives while you are away must be what you come back to.
type Place = { state: string | null; alternatives: Record<string, string> };
const placeKey = (id: string) => `mockpit-place:${id}`;
function readPlace(id: string): Place | null {
  try {
    const raw = host().storage?.getItem(placeKey(id));
    return raw ? (JSON.parse(raw) as Place) : null;
  } catch {
    return null;
  }
}

export type SteerNote = {
  alternative: string;
  version: number;
  reaction?: Reaction;
  part?: string | null;
  text?: string;
  borrow?: { from: VersionRef; part?: string };
};

export function createDesignScreen(
  project: string,
  slug: string,
  open: ScreenOpen | null = null,
  toOwed = false,
) {
  const [design, putDesign] = createSignal<DesignDetail | null>(null);
  const setDesign = (m: DesignDetail) =>
    putDesign((was) =>
      was ? { ...m, alternatives: keepSame(was.alternatives, m.alternatives, (v) => v.postId) } : m,
    );
  const [missing, setMissing] = createSignal(false);
  const [comments, setComments] = createSignal<CommentRow[]>([]);
  const [draft, setDraftSignal] = createSignal<DraftInput | null>(null);
  const [activeState, setActiveState] = createSignal<string | null>(null);
  const [chosenAlternative, setChosenAlternative] = createSignal<Record<string, string>>({});
  const [hoveredPreview, setHoveredPreview] = createSignal<Preview | null>(null);
  const [heldPreview, setHeldPreview] = createSignal<Preview | null>(null);
  const preview = () => hoveredPreview() ?? heldPreview();
  // Everyone's null here means the preview is over, a held one included. A pointer
  // leaving says setHoveredPreview(null), which falls back to what is held.
  const setPreview = (p: Preview | null) => {
    setHoveredPreview(p);
    if (!p) setHeldPreview(null);
  };
  // Where the stage came from when going to a question moved it.
  const [stageBack, setStageBack] = createSignal<{
    from: string | null;
    to: string | null;
  } | null>(null);
  // A state picked by hand is the user's own place, with nothing to go back from.
  createEffect(() => {
    const on = activeState();
    if (untrack(stageBack)?.to !== on) setStageBack(null);
  });
  const [cur, setCur] = createSignal(0);
  // Sent answers the user chose to change ("Change answer"): back among the
  // open questions until the next Send. A sent answer is otherwise read-only.
  const [revising, setRevising] = createSignal<Record<string, true>>({});
  const [afterSend, setAfterSend] = createSignal<AfterSend | null>(null);
  // The part picked on the stage, open in Instances' Tune; null is the page.
  const [selectedPart, setSelectedPart] = createSignal<string | null>(null);
  const [hoverPart, setHoverPart] = createSignal<string | null>(null);
  // The part whose knobs are open in Instances (null is the page's own
  // knobs), or false with none open.
  const [tuneOpen, setTuneOpen] = createSignal<string | null | false>(false);
  // The parts with knobs (or a borrow) to open, as Tune lists them (tune.ts).
  const [tunable, setTunable] = createSignal<(string | null)[]>([]);
  const openTune = (part: string | null | false) => {
    if (part !== false) setSelectedPart(part);
    setTuneOpen(part);
  };
  // A part tapped on the canvas, outlined and offered reactions until the
  // question moves on.
  const [tapped, setTapped] = createSignal<string | null>(null);
  // The part an answer just changed, outlined on stage for a moment so a pick
  // never changes the screen out of sight. Armed by a pick or preview; the
  // stage finds the part from the next parts report.
  const [flash, setFlash] = createSignal<string | null>(null);
  // "entry · skeleton" when the flashed part is a slot and the swap is known.
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
  // The exact version on stage per state (String(state) → ref), once the user
  // steps to one; otherwise the stage shows the version in use, else the latest.
  const [shown, setShown] = createSignal<Record<string, VersionRef>>({});
  // Instances (the side drawer), the bottom panel and the question card's
  // minimised tab.
  const [drawer, setDrawerSignal] = createSignal(false);
  const [panel, setPanelSignal] = createSignal<PanelTab | null>(null);
  const [cardMin, setCardMin] = createSignal(false);
  // The question can't be seen, so it takes no keys and marks no part. Beside the
  // design Instances takes the question's place; on a phone it is a sheet over it.
  const questionHidden = () => cardMin() || !!panel() || (drawer() && !phoneLayout());
  // The last thing done to a version, with its undo while it is offered.
  const [toast, showToast] = createSignal<ToastLine | null>(null);
  // Actions may finish after the screen is gone, and still have a line to leave.
  let toastGoesTo: ((line: ToastLine | null) => void) | null = null;
  const setToast = (line: ToastLine | null) => (toastGoesTo ?? showToast)(line);
  const handToast = (to: (line: ToastLine | null) => void) => {
    to(toast());
    toastGoesTo = to;
    showToast(null);
  };
  const [sent, setSent] = createSignal(false);
  // The reply the last Send stored, and whether a beat has passed since: an
  // undelivered reply after that beat, with no watcher, earns the line to wake the agent.
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
  // `${field}:${askId}` → that write-in or comment folded to one line.
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
  // One canvas tool at a time. Mark (D11): a click on the stage leaves a
  // comment there. Try: taps, scrolls and motion go to the design itself, as a
  // prototype. Tune: the parts are outlined and a tap opens one's knobs.
  const [tool, setTool] = createSignal<Tool | null>(null);
  const marking = () => tool() === "mark";
  const trying = () => tool() === "try";
  const tuning = () => tool() === "tune";
  // Tune's parts live in the drawer, so it opens and closes with the tool.
  const toggleTool = (t: Tool) => {
    const next = tool() === t ? null : t;
    if (t === "tune" || tool() === "tune") setDrawerSignal(next === "tune");
    setTool(next);
  };
  const setMarking = (on: boolean) => setTool(on ? "mark" : marking() ? null : tool());
  const setTrying = (on: boolean) => setTool(on ? "try" : trying() ? null : tool());
  // Thread's comment field; a frame's sendPrompt fills it.
  const [threadText, setThreadText] = createSignal("");
  // Where Tune's knob controls mount: tunekit's pane is moved into it while Tune is open.
  const [tuneHost, setTuneHost] = createSignal<HTMLElement | null>(null);
  // The width the stage renders the design at, remembered per design in this browser.
  const [frameW, setFrameWSignal] = createSignal(DESKTOP_W);
  // Only a width the user picked holds against a design that overflows it.
  const [widthPicked, setWidthPicked] = createSignal(false);
  // The zoom of the canvas, and the scale the stage last drew at.
  const [zoom, setZoom] = createSignal<Zoom>("fit");
  const [stageScale, setStageScale] = createSignal(1);
  // Every width side by side: a pinch from there stays spread, a pick or fit doesn't.
  const allWidths = createMemo<boolean>((was) => {
    const z = zoom();
    return z === "all" ? true : z === "fit" ? false : was;
  }, false);
  // The least scale a zoom can reach on the stage now, so the header offers
  // only the steps it can take.
  const [zoomMin, setZoomMin] = createSignal(0.1);
  // The stage frames' latest parts reports, keyed by frameKey(state, alternative).
  const [reports, setReports] = createStore<Record<string, PartsReport | undefined>>({});

  // Archives on their way: an alternative leaves the screen on the click rather than
  // when the server has answered, and a read that crosses the write can't bring
  // it back.
  const [archiving, setArchiving] = createSignal<ReadonlySet<string>>(new Set());
  const archiveKey = (state: string | null, alternative: string) =>
    JSON.stringify([state, alternative]);
  const alternatives = createMemo(() => {
    const going = archiving();
    const all = design()?.alternatives ?? [];
    if (!going.size) return all;
    return all.map((v) =>
      going.has(archiveKey(v.state, v.alternative)) ? { ...v, status: "archived" as const } : v,
    );
  });
  const states = createMemo<(string | null)[]>(() => {
    const m = design();
    return m && m.states.length ? m.states : [null];
  });
  const latest = createMemo(() => designVersion(alternatives()));
  // Q6: a draft made on an older version keeps the stage on that version until
  // the user chooses to view the new one.
  const boundVersion = createMemo(() => {
    const d = draft();
    return d && !draftIsEmpty(d) && d.version < latest() ? d.version : null;
  });
  const stageVersion = createMemo(() => boundVersion() ?? latest());
  // The agent's asks plus the built-in "Which alternative?" where the agent left a
  // choice between alternatives unasked; everything below reads asks from here.
  const asks = createMemo<Ask[]>((was) => {
    const m = design();
    return m ? keepSameAsks(was, [...m.asks, ...builtinAsks(m, alternatives())]) : [];
  }, []);
  const withAsks = (m: DesignDetail) => ({ ...m, asks: asks() });
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
  const commentOf = (ask: Ask) => draft()?.askComments[ask.id] ?? ask.comment;
  const otherImagesOf = (ask: Ask) =>
    (drafted(ask) ? draft()?.otherImages[ask.id] : ask.otherImages) ?? [];
  const commentImagesOf = (ask: Ask) =>
    (draft()?.askComments[ask.id] !== undefined
      ? draft()?.askCommentImages[ask.id]
      : ask.commentImages) ?? [];
  const textOf = (ask: Ask, field: AskField) =>
    (field === "other" ? otherOf(ask) : commentOf(ask)) ?? "";
  const imagesOf = (ask: Ask, field: AskField) =>
    field === "other" ? otherImagesOf(ask) : commentImagesOf(ask);
  const pendingOf = (ask: Ask, field: AskField) => uploads()[`${field}:${ask.id}`] ?? [];

  // The alternative the alternative question settled on, drafted or sent.
  const lookPick = createMemo(() => {
    const ask = look();
    if (!ask) return null;
    const id = answerIds(answerOf(ask))[0];
    return ask.options.find((o) => o.id === id)?.alternative ?? null;
  });

  const inState = (state: string | null) => alternatives().filter((v) => v.state === state);

  // The exact version a drafted answer picked on a state, when its option
  // names one. Drafted only: once sent, it is the version in use.
  function pickedVersion(state: string | null): VersionRef | null {
    const m = design();
    const d = draft();
    if (!m || !d) return null;
    for (const a of asks()) {
      if (a.scope === "part" || optionState(a, m) !== state) continue;
      const ids = answerIds(d.answers[a.id]);
      const o = a.options.find((x) => ids.includes(x.id) && x.alternative && x.version);
      if (o) return { alternative: o.alternative!, version: o.version! };
    }
    return null;
  }

  // The alternative on stage for a state: a hovered option, the drafted look, the
  // version the user stepped to, the accepted one, else the first still open.
  function alternativeFor(state: string | null, withPreview = true) {
    const list = inState(state);
    const named = (name: string | null | undefined) =>
      name ? list.find((v) => v.alternative === name) : undefined;
    const p = withPreview ? preview() : null;
    return (
      (p && (p.state === undefined || p.state === state) ? named(p.alternative) : undefined) ??
      named(shown()[String(state)]?.alternative) ??
      named(pickedVersion(state)?.alternative) ??
      named(lookPick()) ??
      named(chosenAlternative()[String(state)]) ??
      list.find((v) => v.status === "inUse") ??
      list.find(
        (v) =>
          isLive(v.status) && v.alternative === recommendedAlternative(design()?.asks ?? [], state),
      ) ??
      list.find((v) => v.status === "open") ??
      list[0]
    );
  }
  // What the user put in use on a state, if anything.
  const inUseOf = (state: string | null): VersionRef | null => {
    const u = design()?.inUse.find((x) => x.state === state);
    return u ? { alternative: u.alternative, version: u.version } : null;
  };
  // The version of an alternative the stage shows: the one stepped to, else a
  // version option previewed or picked, else the one in use, else the newest
  // at the stage's design version that isn't hidden.
  function versionOf(v: AlternativeView): number {
    const pick = shown()[String(v.state)];
    if (pick?.alternative === v.alternative) return pick.version;
    const p = preview();
    if (
      p?.version &&
      p.alternative === v.alternative &&
      (p.state === undefined || p.state === v.state)
    ) {
      return p.version;
    }
    const picked = pickedVersion(v.state);
    if (picked?.alternative === v.alternative) return picked.version;
    const use = inUseOf(v.state);
    if (use?.alternative === v.alternative) return use.version;
    // A screen or a component the user took back to the version marked Ready.
    if (v.shownVersion !== undefined) return v.shownVersion;
    const n = frameVersion(v, stageVersion());
    const hidden = new Set(
      (v.history ?? []).filter((h) => "hidden" in h && h.hidden).map((h) => h.version),
    );
    if (!hidden.has(n)) return n;
    const visible = (v.history ?? []).map((h) => h.version).filter((x) => x < n && !hidden.has(x));
    return visible.length ? Math.max(...visible) : n;
  }
  // The version answers draw on: the stage's, before any answer moved it. Hovering or
  // picking an answer's whole page must not turn its neighbours' pictures into that page.
  function answersBaseOf(v: AlternativeView): number {
    const pick = shown()[String(v.state)];
    if (pick?.alternative === v.alternative) return pick.version;
    const use = inUseOf(v.state);
    return use?.alternative === v.alternative ? use.version : frameVersion(v, stageVersion());
  }
  const activeAlternative = createMemo(() => alternativeFor(activeState()));
  // The palette the stage wears for an answer that chooses one: previewed, else picked
  // in the draft. Only the stage: the tool strip's stored pick is left as it is.
  const stagePalette = createMemo<string | undefined>(() => {
    const p = preview();
    if (p?.palette) return p.palette;
    const m = design();
    const d = draft();
    if (!m || !d) return undefined;
    for (const a of m.asks) {
      const ids = answerIds(d.answers[a.id]);
      const o = a.options.find((x) => x.palette && ids.includes(x.id));
      if (o) return o.palette;
    }
    return undefined;
  });
  // The version a bound stage is holding back and the one it stays on, named
  // after the alternative that moved: "Dark #3 arrived", "stay on Dark #2". The
  // draft stays bound to the design-wide number; only these labels name an alternative.
  const arrived = createMemo(() => {
    const n = latest();
    const at = alternatives().filter((v) => v.version === n);
    const v =
      at.find(
        (x) => x.state === activeState() && x.alternative === activeAlternative()?.alternative,
      ) ??
      at.find((x) => x.state === activeState()) ??
      at[0];
    if (!v) return null;
    const named = alternatives().filter((x) => x.state === v.state).length > 1;
    const bound = boundVersion();
    return {
      name: versionName({ alternative: v.alternative, version: n }, named),
      bound:
        bound === null
          ? null
          : versionName({ alternative: v.alternative, version: frameVersion(v, bound) }, named),
    };
  });

  // --- slots (server/swaps.ts): a part with alternative swaps ---

  // The slots of the look on stage for a state, never a hovered one: a preview
  // must not make questions appear and vanish under the pointer.
  const slotsIn = (state: string | null): SlotInfo[] => alternativeFor(state, false)?.swaps ?? [];
  // The slot an ask chooses: every option sets exactly that one slot's path.
  function askSlot(ask: Ask): SlotInfo | null {
    const m = design();
    if (!m) return null;
    const paths = new Set(ask.options.flatMap((o) => Object.keys(o.set ?? {})));
    if (paths.size !== 1) return null;
    const [path] = paths;
    return slotsIn(askState(ask, m, activeState())).find((sl) => sl.part === path) ?? null;
  }
  // The values in force on a state's look (defaults, answers, tuning).
  function valuesIn(state: string | null): Record<string, KnobValue> {
    const m = design();
    if (!m) return {};
    return resolveKnobs({
      ...knobContext(),
      knobs: { ...m.knobs, ...alternativeFor(state, false)?.knobs },
    });
  }
  // A slot inside a swap that isn't chosen: its question doesn't apply now.
  // Walks up, so a slot two swaps deep is dormant when either is unchosen.
  function dormantOf(ask: Ask): { part: string; swap: string; label: string } | null {
    const m = design();
    let slot = askSlot(ask);
    if (!m || !slot?.parent) return null;
    const state = askState(ask, m, activeState());
    const slots = slotsIn(state);
    const values = valuesIn(state);
    while (slot?.parent) {
      const { part, swap }: { part: string; swap: string } = slot.parent;
      const parent: SlotInfo | undefined = slots.find((sl) => sl.part === part);
      if ((values[part] ?? parent?.default) !== swap) {
        const label = parent?.swaps.find((f) => f.name === swap)?.label ?? swap;
        return { part, swap, label };
      }
      slot = parent ?? null;
    }
    return null;
  }
  // The ask this one waits on (`after`) while that one has no answer yet.
  function waitingOn(ask: Ask): Ask | null {
    if (!ask.after) return null;
    const before = design()?.asks.find((a) => a.id === ask.after);
    return before && answerOf(before) === undefined && !before.dismissed ? before : null;
  }
  // What an answered `after` ask chose, which this one's pictures show.
  function shownWith(ask: Ask): { ask: Ask; labels: string; short: string } | null {
    if (!ask.after) return null;
    const before = design()?.asks.find((a) => a.id === ask.after);
    if (!before || answerOf(before) === undefined) return null;
    const ids = answerIds(answerOf(before));
    const chosen = before.options.filter((o) => ids.includes(o.id)).map((o) => o.label);
    return chosen.length
      ? { ask: before, labels: chosen.join(", "), short: chosen.map(shortLabel).join(", ") }
      : null;
  }
  // The parts an ask's options change: each knob `set` names a part (a slot is
  // its own part; "key.color" belongs to "key"), in the labels the user reads.
  function changesOf(ask: Ask): string[] {
    const m = design();
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
    (design()?.parts ?? []).filter((s) => s.parts.some((p) => p.name === part)).map((s) => s.state);
  const allowedMix = (mix: Record<string, string>) => pruneMix(mix, settled(), partStates);
  const mixOpts = createMemo(() => {
    const m = design();
    return m
      ? mixOptions(
          withAsks(m),
          alternatives(),
          lookPick(),
          (state, alternative) => reports[frameKey(state, alternative)],
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
        d.askComments[ask.id] !== undefined)
    );
  };
  const live = (ask: Ask) =>
    (!askAnswered(ask) && !ask.dismissed) || !!revising()[ask.id] || inDraft(ask);
  const ordered = createMemo<Ask[]>(() => {
    const m = design();
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
  // The questions state by state, in the design's order: each state holds the
  // asks about it (askStates), so a design-wide one appears on every state it
  // applies to and is answered once for all of them.
  const flow = createMemo<FlowEntry[]>(() => {
    const m = design();
    if (!m) return [];
    const open = ordered().filter(live);
    const out: FlowEntry[] = [];
    for (const state of states()) {
      for (const ask of open)
        if (askStates(ask, m, alternatives()).includes(state)) out.push({ state, ask });
    }
    return out;
  });
  const entriesIn = (state: string | null) => flow().filter((e) => e.state === state);
  // The questions on the state on stage. Borrowing a part from another look is
  // in Tune, per part, not a question.
  const questions = createMemo<Question[]>(() =>
    entriesIn(activeState()).map((e) => ({ kind: "ask", ask: e.ask })),
  );
  // Sent answers (and asks a resolution dismissed) on the state on stage, or on
  // every state: the folded, read-only Answered group.
  const closedAsks = (scope: "state" | "all") => {
    const m = design();
    if (!m) return [];
    return ordered().filter(
      (a) =>
        !live(a) &&
        (askAnswered(a) || !!a.dismissed) &&
        (scope === "all" || askStates(a, m, alternatives()).includes(activeState())),
    );
  };
  const owed = createMemo(() => {
    const m = design();
    return m ? unanswered(withAsks(m), draft()).filter((a) => !dormantOf(a) && !waitingOn(a)) : [];
  });
  const isOwed = (ask: Ask) => owed().some((a) => a.id === ask.id);
  // How many questions still owed are shown on a state, for its tab.
  const owedIn = (state: string | null) => entriesIn(state).filter((e) => isOwed(e.ask)).length;
  // What marks a state's tab: only what the agent asked counts as waiting, not
  // the built-in Which alternative?, and a design-wide question has no one state to mark.
  const askedIn = (state: string | null) =>
    entriesIn(state).filter(
      (e) => isOwed(e.ask) && !isBuiltinAsk(e.ask) && e.ask.scope !== "design",
    ).length;
  const waitsOnStage = createMemo(() => owed().some((a) => !picksAlternative(a)));
  // Tune is shown only with something to tune (tiers, no modes).
  const tuneShown = createMemo(() => {
    const m = design();
    return !!m && tuneVisible(m, inState(activeState()));
  });
  // What Tune reads and writes: the knobs of the alternative on stage, the drafted
  // answers, the tuned values, and what earlier replies settled.
  const knobContext = createMemo<KnobContext>(() => {
    const m = design();
    return {
      knobs: { ...m?.knobs, ...activeAlternative()?.knobs },
      asks: m?.asks ?? [],
      answers: draft()?.answers ?? {},
      tuned: draft()?.tuned ?? {},
      settled: m?.settled ?? {},
    };
  });
  // The part the current question is about: the slot it chooses a swap for,
  // else the part it is scoped to.
  const focusPart = createMemo(() => {
    if (questionHidden()) return null;
    const borrowing = preview()?.part;
    if (borrowing) return borrowing;
    const q = questions()[cur()];
    if (q?.kind !== "ask") return null;
    return askSlot(q.ask)?.part ?? (q.ask.scope === "part" ? (q.ask.part ?? null) : null);
  });
  // The part outlined on the stage. selectedPart outlives the question that set
  // it (Tune opens on it), so outside Tune the outline follows the question.
  const stagePart = createMemo(() => (tuning() ? selectedPart() : (tapped() ?? focusPart())));
  // A borrow made before the user chose that part's fate would contradict it.
  createEffect(() => {
    const mix = draft()?.borrowed ?? {};
    const kept = allowedMix(mix);
    if (Object.keys(kept).length === Object.keys(mix).length) return;
    const m = design();
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
    writeDraft((d) => ({ ...d, borrowed: kept }));
  });

  // --- draft writes: local at once, server after a short pause ---

  let saveTimer = 0;
  let lastLocalWrite = 0;
  let pending: DraftInput | null = null;
  async function flush() {
    const m = design();
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
      borrowed: { ...base.borrowed },
      tuned: { ...base.tuned },
      comments: [...base.comments],
      others: { ...base.others },
      askComments: { ...base.askComments },
      otherImages: { ...base.otherImages },
      askCommentImages: { ...base.askCommentImages },
    });
    batch(() => {
      setDraftSignal(next);
      setSent(false);
      setError(null);
    });
    // Answering again here means staying: no carrying off to the next design.
    host().window.clearTimeout(forwardTimer);
    setAfterSend(null);
    pending = next;
    lastLocalWrite = Date.now();
    host().window.clearTimeout(saveTimer);
    saveTimer = host().window.setTimeout(flush, SAVE_MS);
  }

  // --- loading and the live feed ---

  let designId: string | null = null;
  let disposed = false;
  let unwatch = () => {};
  // What says where this screen opens: a link naming the place, or the memory.
  let heldBy: "link" | "place" | null = null;
  let placeRead = false;
  // Not landed on: a state whose alternatives are all archived shows an empty Studio.
  const holdsSomething = (m: DesignDetail, state: string | null) => {
    const inIt = m.alternatives.filter((v) => v.state === state);
    return !inIt.length || inIt.some((v) => isLive(v.status));
  };
  async function fetchDesign(): Promise<DesignDetail | null> {
    if (designId) return api.design(designId);
    const m = await api.designIn(project, slug).catch((e) => {
      if (e instanceof ApiError && (e.status === 404 || e.status === 400)) return null;
      throw e;
    });
    // The route also answers to a title; this screen is only ever this slug.
    if (!m || m.slug !== slug) return null;
    designId = m.id;
    if (!disposed) unwatch = watchDesign(designId);
    return m;
  }
  async function loadDesign() {
    const m = await fetchDesign();
    if (!m) {
      setMissing(true);
      return;
    }
    batch(() => {
      setDesign(m);
      setMissing(false);
      // The first load lands on the alternative the user opened, once.
      const at = open;
      if (
        at &&
        m.alternatives.some(
          (v) =>
            v.state === at.state && (at.alternative === null || v.alternative === at.alternative),
        )
      ) {
        landOn(at);
        heldBy = "link";
        open = null;
      } else if (!at && !toOwed && !placeRead) {
        const place = readPlace(m.id);
        if (place) {
          const here = (state: string | null, alternative: string) =>
            m.alternatives.some(
              (v) => v.state === state && v.alternative === alternative && isLive(v.status),
            );
          // An alternative archived since falls to the one in use, else the newest live.
          setChosenAlternative(
            Object.fromEntries(
              Object.entries(place.alternatives ?? {}).filter(([state, alternative]) =>
                here(state === "null" ? null : state, alternative),
              ),
            ),
          );
          if (states().includes(place.state) && holdsSomething(m, place.state)) {
            setActiveState(place.state);
            heldBy = "place";
          }
        }
      }
      placeRead = true;
      if (!states().includes(activeState())) {
        setActiveState(states().find((st) => holdsSomething(m, st)) ?? states()[0]);
      }
    });
  }
  async function loadDraft() {
    const id = designId;
    if (!id) return;
    const { draft: d } = await api.draft(id).catch(() => ({ draft: null }));
    if (Date.now() - lastLocalWrite < 1500 || pending) return;
    setDraftSignal(
      d
        ? {
            version: d.version,
            answers: d.answers,
            borrowed: d.borrowed,
            tuned: d.tuned,
            comments: d.comments,
            others: d.others ?? {},
            askComments: d.askComments ?? {},
            otherImages: d.otherImages ?? {},
            askCommentImages: d.askCommentImages ?? {},
          }
        : null,
    );
  }
  async function loadComments() {
    const id = designId;
    if (!id) return;
    const { comments: list } = await api.comments(id);
    setComments(list);
  }

  async function start() {
    await loadDesign();
    await Promise.all([loadDraft(), loadComments(), loadRecipients()]);
    const m = design();
    if (!m) return;
    // Open on the first question still owed, on the state it is about; a draft
    // that already answers everything resumes on its first answer, one tap
    // from Send.
    // A pick made while this loaded keeps the user where they made it.
    if (lastLocalWrite) return;
    // Only an agent's question outranks the memory; a link is never overruled.
    const asked = firstOwed((a) => !isBuiltinAsk(a));
    if (heldBy === "link" || (heldBy === "place" && !asked)) {
      const owedHere = entriesIn(activeState()).findIndex((e) => isOwed(e.ask));
      goQuestion(Math.max(0, owedHere), { quiet: true, stay: true });
      return;
    }
    const first = asked ?? firstOwed();
    const resume = !first && !draftIsEmpty(draft()) ? flow()[0] : undefined;
    const at =
      first ??
      (resume ? { state: resume.state, to: entriesIn(resume.state).indexOf(resume) } : null);
    goQuestion(at?.to ?? 0, { quiet: true, ...(at ? { state: at.state } : {}) });
  }

  const refetch = coalesce({ design: loadDesign, draft: loadDraft, comments: loadComments });
  const stop = subscribe(
    (e) => {
      const id = designId;
      switch (e.type) {
        case "design-created":
        case "design-updated":
          if (e.id === id) refetch("design");
          break;
        case "design-deleted":
          if (e.id === id) setMissing(true);
          break;
        case "post-created":
        case "post-updated":
        case "post-deleted":
          if (e.designId === id) refetch("design");
          break;
        case "draft-updated":
          if (e.designId === id) refetch("draft");
          break;
        case "comment-created":
          if (e.designId === id) refetch("comments");
          break;
        case "session-created":
          // A new session may supersede the one an undelivered Send waits on.
          if (comments().some((c) => !c.delivered)) refetch("comments");
          break;
        case "agent-called":
          // Only matters to a Send it could be working on.
          if (lastSend()?.sessionId === e.sessionId) refetch("comments");
          break;
        case "comment-deleted":
        case "comment-delivered":
          if (
            e.sessionId === design()?.sessionId ||
            comments().some((c) => c.sessionId === e.sessionId)
          )
            refetch("comments");
          break;
        case "system-changed":
          // Its palettes and which stills still hold come with the design.
          if (id && e.project === design()?.project) refetch("design");
          break;
        case "theme-changed":
          setTheme(e.mode === "light" ? "light" : "dark");
          // Which stills show depends on the mode they were taken in.
          if (id) refetch("design");
          break;
      }
    },
    () => {
      if (designId) {
        refetch("design");
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

  // Back leaves for the place before this one: a question, a state or a version
  // moves sideways, so it replaces the entry, which stays current for Back to
  // restore when a step between Stage and Studio comes back to it.
  type Snap = {
    mockpit: "design";
    state: string | null;
    cur: number;
  };
  const snap = (): Snap => ({ mockpit: "design", state: activeState(), cur: cur() });
  const record = () => host().history.replaceState(snap(), "");
  function restoreSnap(s: unknown) {
    if (!s || typeof s !== "object" || (s as Snap).mockpit !== "design") return false;
    const v = s as Snap;
    batch(() => {
      setActiveState(v.state);
      setCur(v.cur);
      setPreview(null);
    });
    return true;
  }

  // Only the user's own moves are remembered: a link someone sent shouldn't
  // change where they left off.
  function rememberPlace() {
    const m = design();
    if (!m) return;
    const alternatives = { ...chosenAlternative() };
    for (const [state, ref] of Object.entries(shown())) alternatives[state] = ref.alternative;
    const place: Place = { state: activeState(), alternatives };
    try {
      host().storage?.setItem(placeKey(m.id), JSON.stringify(place));
    } catch {
      // Storage refused: the URL still holds it for this visit.
    }
  }
  // Onto a place the URL names, which is not a move of the user's: nothing is
  // remembered or recorded, and landing where it already is does nothing.
  function landOn(at: ScreenOpen) {
    // Still loading: the first load lands there instead of on where it set out for.
    if (!design()) {
      open = at;
      return;
    }
    batch(() => {
      if (at.state !== activeState()) {
        setActiveState(at.state);
        setPreview(null);
        setTapped(null);
      }
      const key = String(at.state);
      if (at.alternative !== null && chosenAlternative()[key] !== at.alternative) {
        setChosenAlternative({ ...chosenAlternative(), [key]: at.alternative });
      }
      if (at.alternative !== null && at.version) {
        const ref = { alternative: at.alternative, version: at.version };
        const had = shown()[key];
        const exists = alternatives().some(
          (v) =>
            v.state === at.state &&
            v.alternative === ref.alternative &&
            (v.version === ref.version || v.history?.some((h) => h.version === ref.version)),
        );
        if (exists && !(had?.alternative === ref.alternative && had.version === ref.version)) {
          setShown({ ...shown(), [key]: ref });
        }
      }
    });
  }
  // The alternative and version on stage when the user chose them; a default stays
  // out of the URL, so it can move on when a new version arrives.
  const stagePick = createMemo((): { alternative: string; version: number | null } | null => {
    const key = String(activeState());
    const ref = shown()[key];
    if (ref) return ref;
    const alternative = chosenAlternative()[key];
    return alternative ? { alternative, version: null } : null;
  });
  // Any move the user makes on this screen after a Send means they are still
  // here: the carry to the next design must not fire.
  const userMoved = () => stayHere();

  // The ith question on a state (the one on stage unless named), which comes
  // on stage with it.
  // Going to a question is asking to see it, so the stage goes to a state it
  // declared; `stay` is for a place the user chose or linked to.
  function goQuestion(
    i: number,
    opts: { quiet?: boolean; state?: string | null; stay?: boolean } = {},
  ) {
    if (!opts.quiet) userMoved();
    const from = activeState();
    let state = opts.state === undefined ? from : opts.state;
    let index = i;
    const m = design();
    const ask = entriesIn(state)[i]?.ask;
    if (ask && m && !opts.stay) {
      const to = askState(ask, m, state);
      const there = askAbout(ask, m).length
        ? entriesIn(to).findIndex((e) => e.ask.id === ask.id)
        : -1;
      if (there >= 0) {
        state = to;
        index = there;
      }
    }
    batch(() => {
      setActiveState(state);
      setCur(index);
      setStageBack(
        !opts.quiet && !opts.stay && ask && m && askAbout(ask, m).length && state !== from
          ? { from, to: state }
          : null,
      );
      setCardMin(false);
      setTapped(null);
      setPreview(null);
      if (ask?.scope === "part" && ask.part) setSelectedPart(ask.part);
    });
    record();
    if (!opts.quiet) rememberPlace();
  }
  // What the question's card offers about where the stage is: go to the state
  // the question is about, or back to where the user was.
  function stageOffer(ask: Ask): { show: string } | { back: string } | null {
    const m = design();
    const about = m ? askAbout(ask, m) : [];
    if (!about.length) return null;
    const on = activeState();
    if (on === null || !about.includes(on)) return { show: about[0] };
    const b = stageBack();
    return b && b.to === on ? { back: b.from as string } : null;
  }
  function showAskState(ask: Ask) {
    const m = design();
    const from = activeState();
    const to = m ? askAbout(ask, m)[0] : undefined;
    if (to === undefined) return;
    goQuestion(
      entriesIn(to).findIndex((e) => e.ask.id === ask.id),
      { state: to, stay: true },
    );
    setStageBack({ from, to });
  }
  function backFromAsk(ask: Ask) {
    const b = stageBack();
    if (!b) return;
    goQuestion(
      entriesIn(b.from).findIndex((e) => e.ask.id === ask.id),
      { state: b.from, stay: true },
    );
  }
  // An ask wherever it shows, on the state on stage when it shows there.
  function goAsk(id: string) {
    setPanelSignal(null);
    const here = entriesIn(activeState()).findIndex((e) => e.ask.id === id);
    if (here >= 0) return goQuestion(here);
    const e = flow().find((x) => x.ask.id === id);
    if (e) goQuestion(entriesIn(e.state).indexOf(e), { state: e.state });
  }
  // The question card back from its tab: on the first question still owed, else
  // the first with a drafted answer waiting for its Send.
  function goOwed() {
    setPanelSignal(null);
    if (questions().length) return setCardMin(false);
    const owedStop = firstOwed();
    if (owedStop) return goQuestion(owedStop.to, { state: owedStop.state });
    const drafted = flow()[0];
    if (drafted) goEntry(drafted);
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
        for (const rec of [d.answers, d.others, d.askComments, d.otherImages, d.askCommentImages]) {
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
  // Back from the Archive: the questions it left unanswered are open again.
  async function reopen() {
    const m = design();
    if (!m) return;
    try {
      await api.restoreDesign(m.id);
      await loadDesign();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  // The × on an idea. The screen stays where it is, saying so, with the way back and a
  // place for the reason, so no question stands between the × and being done.
  async function archiveDesign() {
    const m = design();
    if (!m || readonly()) return;
    try {
      await api.archiveDesign(m.id);
      await loadDesign();
      setToast({
        text: `Archived ${m.title}`,
        undo: () => {
          setToast(null);
          void reopen();
        },
      });
    } catch (e) {
      fail(e);
    }
  }
  function saveEndReason(reason: string | null) {
    const m = design();
    if (m) void api.reason(m.id, { reason }).then(loadDesign, fail);
  }
  function saveArchiveReason(alternative: string, reason: string | null, state = activeState()) {
    const m = design();
    if (m) void api.reason(m.id, { reason, state, alternative }).then(loadDesign, fail);
  }
  // The drawers. The bottom panel tucks the question card to its tab.
  const setDrawer = (on: boolean) => {
    userMoved();
    setDrawerSignal(on);
  };
  const setPanel = (tab: PanelTab | null) => {
    userMoved();
    setPanelSignal(tab);
  };
  // Back to the question and the comments from whatever stands in their place.
  function showTalk() {
    userMoved();
    batch(() => {
      if (tool() === "tune") setTool(null);
      setDrawerSignal(false);
      setPanelSignal(null);
      setCardMin(false);
    });
  }
  // A step of the flow brings its own questions: the first it still owes,
  // else its first.
  function showState(state: string | null) {
    userMoved();
    const here = entriesIn(state);
    const owedAt = here.findIndex((e) => isOwed(e.ask));
    batch(() => {
      setActiveState(state);
      setPreview(null);
      setTapped(null);
      setCur(Math.max(0, owedAt));
    });
    record();
    rememberPlace();
  }
  function chooseAlternative(alternative: string) {
    userMoved();
    setChosenAlternative({ ...chosenAlternative(), [String(activeState())]: alternative });
    rememberPlace();
  }
  // A tap on a part outlines it and offers its reactions; with Tune on it
  // opens that part's knobs in Instances instead.
  function selectPart(part: string | null) {
    setSelectedPart(part);
    if (tuning()) {
      if (part === null || !tunable().includes(part)) return;
      setTuneOpen(part);
      setDrawerSignal(true);
    } else setTapped(part);
  }

  const widthKey = (id: string) => `mockpit-width:${id}`;
  // Keyed by id alone: a refetch or a resize must not undo the user's choice.
  createEffect(
    on(
      () => design()?.id,
      (id) => {
        if (!id) return;
        let stored: string | null = null;
        try {
          stored = host().storage?.getItem(widthKey(id)) ?? null;
        } catch {
          // Unreadable storage: fall back to the default width.
        }
        const declared = design()?.widths ?? [];
        const picked = readDeviceWidth(stored, declared);
        setWidthPicked(picked !== null);
        setFrameWSignal(picked ?? declared[0] ?? defaultDeviceWidth(win().w, coarse()));
      },
    ),
  );
  createEffect(() => {
    // Widths the agent declared are the ones to judge at, overflow or not.
    if (widthPicked() || (design()?.widths ?? []).length) return;
    const v = activeAlternative();
    const w = v && overflowWidth(frameW(), reports[frameKey(v.state, v.alternative)]);
    if (w) setFrameWSignal(w);
  });
  function setFrameW(w: number) {
    setWidthPicked(true);
    setFrameWSignal(w);
    const id = design()?.id;
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
  // the first in the design's order.
  function firstOwed(which: (ask: Ask) => boolean = () => true): Stop | null {
    const st = activeState();
    const stops = (state: string | null) =>
      entriesIn(state).findIndex((e) => isOwed(e.ask) && which(e.ask));
    const here = stops(st);
    if (here >= 0) return { state: st, to: here };
    for (const other of states()) {
      const j = stops(other);
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
    // Picking a look puts it on the stage, over a version stepped to before.
    const picked = ask.options.find((o) => o.id === optionId)?.alternative;
    if (picked) setShown({});
    // A look picked now means that look as it stands. Left on an older draft's
    // version, Send would put a version nobody meant in use, on every screen including it.
    if (picked && boundVersion() !== null) viewNewVersion();
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
        const chosen = ask.options.find((o) => o.id === optionId)?.alternative;
        for (const p of Object.keys(d.borrowed)) if (d.borrowed[p] === chosen) delete d.borrowed[p];
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
  // The write-in under "Other…", and the comment on a question, with their
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
  const setComment = (ask: Ask, text: string) =>
    setField(ask, "comment", text, commentImagesOf(ask));

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
    const m = design();
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
    const at = imagesOf(ask, field).indexOf(id);
    setField(
      ask,
      field,
      textOf(ask, field),
      imagesOf(ask, field).filter((x) => x !== id),
    );
    setAttachStatus("Image removed");
    setToast({
      text: "Image removed",
      undo: () => {
        setToast(null);
        const now = imagesOf(ask, field);
        setField(ask, field, textOf(ask, field), [...now.slice(0, at), id, ...now.slice(at)]);
      },
    });
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
  function toggleMix(opt: { part: string; alternative: string } | null) {
    writeDraft((d) => {
      if (!opt) d.borrowed = {};
      else if (d.borrowed[opt.part] === opt.alternative) delete d.borrowed[opt.part];
      else d.borrowed[opt.part] = opt.alternative;
      return d;
    });
    setMixTouched(true);
    // A fresh Mix choice answers the notice; it has nothing left to explain.
    setMixDropped([]);
  }
  const mixAnswered = () => mixTouched() || Object.keys(draft()?.borrowed ?? {}).length > 0;
  function addComment(
    part: string | null,
    state: string | null,
    text: string,
    anchor?: PartCommentAnchor,
    // The exact version it is about, where a reader may be on an older one.
    on?: VersionRef,
  ) {
    writeDraft((d) => {
      d.comments.push({
        part,
        state,
        text,
        ...(anchor ? { anchor } : {}),
        ...(on ? { alternative: on.alternative, version: on.version } : {}),
      });
      return d;
    });
  }
  // A comment read back beside the design can be reworded or taken back before
  // Send, by its place in the draft.
  function setCommentText(index: number, text: string) {
    writeDraft((d) => {
      const c = d.comments[index];
      if (c) d.comments[index] = { ...c, text };
      return d;
    });
  }
  function removeComment(index: number) {
    const gone = draft()?.comments[index];
    writeDraft((d) => {
      d.comments.splice(index, 1);
      return d;
    });
    if (!gone) return;
    setToast({
      text: "Comment removed",
      undo: () =>
        writeDraft((d) => {
          d.comments.splice(index, 0, gone);
          return d;
        }),
    });
  }
  // A one-tap reaction on a part of the alternative on stage, or (part null) on the
  // alternative itself. Toggles: the same reaction again takes it back.
  function react(part: string | null, reaction: Reaction) {
    const v = activeAlternative();
    if (!v) return;
    const target = { part, state: activeState(), alternative: v.alternative };
    let now: Reaction | null = null;
    writeDraft((d) => {
      d.comments = toggleReaction(d.comments, target, reaction);
      now = reactionOf(d.comments, target);
      return d;
    });
    setReactStatus(reactionStatus(part ?? v.alternative, now));
  }
  const reactionOn = (part: string | null): Reaction | null => {
    const v = activeAlternative();
    return v
      ? reactionOf(draft()?.comments ?? [], {
          part,
          state: activeState(),
          alternative: v.alternative,
        })
      : null;
  };
  // A frame's sendPrompt: the text waits in Thread for the user to send it,
  // never straight to the agent.
  function prefill(text: string) {
    setThreadText(text);
    setTool(null);
    setPanelSignal("thread");
  }
  async function postComment(text: string) {
    const m = design();
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
  // D13: un-archive an alternative in each of the given states.
  async function restoreAlternative(alternative: string, inStates: (string | null)[]) {
    const m = design();
    if (!m) return;
    try {
      for (const st of inStates) await api.restoreAlternative(m.id, st, alternative);
      await loadDesign();
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

  function resetTuned() {
    const before = { ...knobContext().tuned };
    replaceTuned({});
    setToast({
      text: "Tuning reset",
      undo: () => {
        setToast(null);
        replaceTuned(before);
      },
    });
  }

  const sentReply = createMemo(() => {
    const id = sentId();
    return (sent() && id && comments().find((c) => c.id === id)) || null;
  });
  // Whether an agent has the last Send yet; null when nothing was sent here.
  const sentDelivered = () => (sent() && sentId() ? (sentReply()?.delivered ?? false) : null);
  const beatPassed = () => beat() && sentDelivered() === false;
  const agentListening = () => !!sentReply()?.listening;

  // Who else could hear a Send, while the agent that asked can't. A watcher opening
  // or closing sends no event, so this is read on a timer.
  const [recipients, setRecipients] = createSignal<SendRecipients>({
    default: null,
    recipients: [],
  });
  const [pickedTo, setPickedTo] = createSignal<string | null>(null);
  const sendTo = createMemo(() => {
    const { default: fallback, recipients: list } = recipients();
    return list.find((r) => r.id === pickedTo()) ?? list.find((r) => r.id === fallback) ?? null;
  });
  // Only a pick still on offer is sent; otherwise the server applies the rule the row showed.
  const toField = () => {
    const to = pickedTo();
    return to && recipients().recipients.some((r) => r.id === to) ? { to } : {};
  };
  async function loadRecipients() {
    const id = designId;
    if (!id || readonly() || host().window.document.hidden) return;
    const next = await api.recipients(id).catch(() => null);
    if (next && id === designId) setRecipients(next);
  }
  const recipientsTimer = host().window.setInterval(() => void loadRecipients(), RECIPIENTS_MS);
  onCleanup(() => host().window.clearInterval(recipientsTimer));
  let beatTimer = 0;
  onCleanup(() => host().window.clearTimeout(beatTimer));
  // Read again at the beat: what was read straight after the Send may have caught a
  // watcher between two polls, or one that has since gone.
  function armBeat() {
    setBeat(false);
    host().window.clearTimeout(beatTimer);
    beatTimer = host().window.setTimeout(() => {
      setBeat(true);
      void loadComments().catch(() => {});
    }, BEAT_MS);
  }
  // The last thing the user sent that an agent owes an answer to, read from the same
  // comments as the Thread, so the word and the Thread can't disagree. A move from
  // Home or a close isn't one.
  const lastSend = createMemo(() => {
    const list = comments();
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      if (c.kind !== "reply" || !c.payload || c.payload.edited || c.payload.archived) continue;
      return {
        sessionId: c.sessionId,
        at: c.createdAt,
        delivered: c.delivered,
        ...(c.calledAt ? { calledAt: c.calledAt } : {}),
      };
    }
    return null;
  });
  // The newest version published since the Send, in any state.
  const sinceSend = createMemo(() => {
    const since = sentReply()?.createdAt;
    if (!since) return null;
    let newest: (VersionStep & { state: string | null }) | null = null;
    for (const state of states()) {
      for (const step of versionSteps(alternatives(), state)) {
        if (step.at > since && !step.hidden && (!newest || step.at > newest.at)) {
          newest = { ...step, state };
        }
      }
    }
    return newest;
  });
  function seeSinceSend() {
    const a = sinceSend();
    if (!a) return;
    userMoved();
    landOn({ state: a.state, alternative: a.alternative, version: a.version });
    rememberPlace();
  }

  async function send(extra: { verdict?: ReplyVerdict; text?: string } = {}) {
    const m = design();
    if (!m || sending()) return;
    await flush();
    const d = draft() ?? emptyDraft(stageVersion());
    setSending(true);
    try {
      // A question inside a swap that isn't chosen doesn't apply: its answer stays out.
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
        borrowed: allowedMix(d.borrowed),
        ...extra,
        ...toField(),
      });
      // The draft holds the picks until the design carrying them as sent answers
      // arrives: dropping it first would put the stage on another alternative for
      // one fetch (a flash of a different frame fading in, then back).
      const [next] = await Promise.all([
        api.design(m.id).catch(() => null),
        loadComments().catch(() => {}),
      ]);
      batch(() => {
        if (next) setDesign(next);
        setDraftSignal(null);
        setSent(true);
        setSentId(reply.id);
        setPreview(null);
        setTapped(null);
      });
      setMixTouched(false);
      setMixDropped([]);
      setOtherOpen({});
      setOtherStash({});
      setFoldedSignal({});
      setRevising({});
      record();
      armBeat();
      void loadRecipients();
      void planNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  // --- the flow: question → Send → the next design ---

  const goEntry = (e: FlowEntry) => goQuestion(entriesIn(e.state).indexOf(e), { state: e.state });
  // An ask's first entry: a design-wide one met again on a later state is the
  // same question, so the arrows pass it by there unless they are already on
  // that state.
  const firstEntry = createMemo(() => {
    const first = new Map<string, FlowEntry>();
    for (const e of flow()) if (!first.has(e.ask.id)) first.set(e.ask.id, e);
    return first;
  });
  const stops = (e: FlowEntry) => e.state === activeState() || firstEntry().get(e.ask.id) === e;
  // The question the card's ‹ › go to from here, across the states, or null.
  const stepTarget = (by: 1 | -1): FlowEntry | null => {
    const fl = flow();
    if (by === 1) {
      for (let j = Math.floor(flowAt()) + 1; j < fl.length; j++) if (stops(fl[j])) return fl[j];
      return null;
    }
    for (let j = Math.ceil(flowAt()) - 1; j >= 0; j--) if (stops(fl[j])) return fl[j];
    return null;
  };
  function step(by: 1 | -1) {
    const to = stepTarget(by);
    if (to) goEntry(to);
  }

  const asked = (ask: Ask) =>
    answerOf(ask) !== undefined || otherOf(ask) !== undefined || commentOf(ask) !== undefined;
  // The question on the card now, if the state on stage has one.
  const curAsk = createMemo<Ask | null>(() => {
    const qs = questions();
    if (!qs.length) return null;
    const q = qs[Math.min(cur(), qs.length - 1)];
    return q.kind === "ask" ? q.ask : null;
  });
  // What the card's Send does: on to the next question still owed, else the
  // reply. Null while the question on the card has no answer to carry.
  const commitKind = createMemo<"next" | "send" | null>(() => {
    const a = curAsk();
    if (readonly() || !a || !asked(a)) return null;
    return nextStop(Math.min(cur(), questions().length - 1)) ? "next" : "send";
  });
  // Comments and tuning want no answer: they can go while a question stays open.
  const sendable = () => !readonly() && !draftIsEmpty(draft());
  const sendDraft = () => void send();
  function commit() {
    const kind = commitKind();
    if (!kind) return;
    if (kind === "send") return void send();
    const to = nextStop(Math.min(cur(), questions().length - 1));
    if (to) goQuestion(to.to, { state: to.state });
  }

  const optionKey = (ask: Ask, optionId: string) => `${ask.id}:${optionId}`;
  function previewOf(ask: Ask, optionId: string): Preview | null {
    const m = design();
    const o = ask.options.find((x) => x.id === optionId);
    if (!m || !o) return null;
    const key = optionKey(ask, o.id);
    const label = o.label;
    if (o.alternative && o.version) {
      return {
        key,
        label,
        alternative: o.alternative,
        version: o.version,
        state: optionState(ask, m),
      };
    }
    // A palette is the whole project's: every state wears it.
    if (o.palette) return { key, label, palette: o.palette };
    // The stage would show nothing of it, and moving it on a hover would jump the
    // screen: the card's Show is the way there.
    const about = askAbout(ask, m);
    const on = activeState();
    if (about.length && (on === null || !about.includes(on))) return null;
    if (o.alternative)
      return { key, label, alternative: o.alternative, state: askState(ask, m, on) };
    return o.set ? { key, label, knobs: o.set } : null;
  }
  // A tap, a click or a number key on an option: the first puts it on the
  // stage as your pick; the same option again sends it on (the next question,
  // else the reply). On a multi-choice question a tap toggles, and Send moves on.
  function choose(ask: Ask, optionId: string) {
    if (readonly()) return;
    const p = previewOf(ask, optionId);
    if (p?.knobs) {
      // A slot ask names its part and swap; a part-scoped ask its part;
      // otherwise the stage works it out from the parts reports.
      const slot = askSlot(ask);
      const swap = slot ? p.knobs[slot.part] : undefined;
      if (slot && typeof swap === "string") {
        const label = slot.swaps.find((f) => f.name === swap)?.label ?? swap;
        showFlash(slot.part, `${slot.label ?? slot.part} · ${label}`);
      } else if (ask.scope === "part" && ask.part) showFlash(ask.part);
      else armFlash();
    }
    const picked = answerIds(answerOf(ask)).includes(optionId);
    if (!ask.multi && picked && !otherTicked(ask)) {
      setPreview(null);
      return commit();
    }
    pick(ask, optionId);
    setPreview(null);
  }
  // A number key: the nth option of the question on the card, "Other…" after them.
  function chooseNth(n: number) {
    const a = curAsk();
    if (!a || questionHidden()) return;
    const list = shownOptions(a);
    const o = list[n];
    if (o) choose(a, o.id);
    else if (n === list.length && !readonly()) pick(a, null);
  }

  async function owedDesign(by: 1 | -1): Promise<DesignSummary | null> {
    const list = await api.designs(project).catch(() => null);
    return list ? nextOwedDesign(list.designs, slug, by) : null;
  }
  async function goOwedDesign(by: 1 | -1) {
    const next = await owedDesign(by);
    if (next && !disposed) navigate(questionPath(project, next.slug));
  }
  let forwardTimer = 0;
  onCleanup(() => host().window.clearTimeout(forwardTimer));
  // The Send's status rides along, so Delivered stays in sight on the next design.
  function goNext() {
    const a = afterSend();
    const m = design();
    const id = sentId();
    host().window.clearTimeout(forwardTimer);
    if (!a?.next || disposed) return;
    if (m && id) setCarried({ project, slug, title: m.title, replyId: id, designId: m.id });
    navigate(questionPath(project, a.next.slug));
  }
  function stayHere() {
    host().window.clearTimeout(forwardTimer);
    const a = afterSend();
    if (a?.auto) setAfterSend({ ...a, auto: false });
  }
  async function planNext() {
    const next = await owedDesign(1);
    if (disposed) return;
    // A hidden tab never moves on by itself: the user would come back elsewhere.
    // Nor does it carry the user into another agent conversation's work, which
    // is a different piece of work even in the same repo: that one is offered.
    const auto =
      !!next &&
      next.sessionId === design()?.sessionId &&
      host().window.document.visibilityState !== "hidden";
    setAfterSend({ next, auto });
    host().window.clearTimeout(forwardTimer);
    if (auto) forwardTimer = host().window.setTimeout(goNext, FORWARD_MS);
  }

  // --- versions ---

  // Every version of the state on stage, in the order they were published.
  const steps = createMemo<VersionStep[]>(
    (was) => keepSame(was, versionSteps(alternatives(), activeState()), stepKey),
    [],
  );
  // "Dark #2", or "#2" while the state on stage has one alternative.
  const nameOf = (ref: VersionRef) =>
    versionName(ref, alternatives().filter((v) => v.state === activeState()).length > 1);
  // The exact version on stage.
  const onStage = createMemo<VersionRef | null>(() => {
    const v = activeAlternative();
    return v ? { alternative: v.alternative, version: versionOf(v) } : null;
  });
  const stageStep = createMemo(() => stepFor(steps(), onStage()));
  // An answer's whole page isn't a version until it's chosen, so looking at one doesn't
  // change the number the user reads, unless they stepped to it themselves.
  const stageLabel = createMemo<VersionRef | null>(() => {
    const on = onStage();
    const v = activeAlternative();
    if (!on || !v || !stageStep()?.hidden || shown()[String(v.state)]) return on;
    return { alternative: v.alternative, version: answersBaseOf(v) };
  });
  const inUse = createMemo(() => inUseOf(activeState()));
  // Earlier versions the user put in use here, from the replies that did.
  const usedBefore = createMemo(() => {
    const out: VersionRef[] = [];
    for (const c of comments()) {
      const d = (c.payload as { verdict?: ReplyVerdict } | undefined)?.verdict;
      if (c.kind === "reply" && d?.kind === "use" && d.version && d.state === activeState()) {
        out.push({ alternative: d.alternative, version: d.version });
      }
    }
    return out.filter((r) => !sameVersion(r, inUse()));
  });
  function showVersion(ref: VersionRef) {
    userMoved();
    batch(() => {
      setShown({ ...shown(), [String(activeState())]: ref });
      setChosenAlternative({ ...chosenAlternative(), [String(activeState())]: ref.alternative });
      setPreview(null);
    });
    rememberPlace();
  }
  // Lets go of the version the user stepped to on the state on stage, so it shows what
  // the design says it shows. A screen's or a component's Back is the server's stay,
  // which holds only until something newer comes; a version held here would outlast it.
  function followShown() {
    const key = String(activeState());
    if (!(key in shown())) return;
    const { [key]: _, ...rest } = shown();
    setShown(rest);
    rememberPlace();
  }
  const listed = createMemo(() => listedSteps(steps()));
  function stepVersion(by: 1 | -1) {
    const to = neighbourStep(listed(), onStage(), by);
    if (to) showVersion(to);
  }
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  // Use this: the version on stage goes in use, and the agent hears it once.
  async function useThis(ref = onStage()) {
    const m = design();
    if (!m || !ref || readonly()) return;
    try {
      await api.use(m.id, { state: activeState(), ...ref, ...toField() });
      await Promise.all([loadDesign(), loadComments()]);
      showVersion(ref);
      setToast({ text: `${nameOf(ref)} is in use` });
    } catch (e) {
      fail(e);
    }
  }
  // A screen or a component: nothing on it is chosen, its newest version is current,
  // and Ready is the user's one mark.
  const product = createMemo(() => {
    const kind = design()?.kind;
    return kind !== undefined && kind !== "idea";
  });
  // The version in use has a newer one the user hasn't ruled on, which ChangedNote
  // moves to by itself. On a screen or a component: a newer version than the one marked
  // Ready, which is already current, and `use` is the way back to the marked one. Null
  // when there is none.
  const changed = createMemo(() => {
    const v = inState(activeState()).find((x) => x.changedTo !== undefined);
    const use = !v
      ? null
      : v.readyVersion !== undefined
        ? { alternative: v.alternative, version: v.readyVersion }
        : inUseOf(v.state);
    return v?.changedTo !== undefined && use
      ? { use, to: { alternative: v.alternative, version: v.changedTo } }
      : null;
  });
  function stayOnUse() {
    const m = design();
    const c = changed();
    if (!m || !c || readonly()) return;
    void api.stay(m.id, activeState(), c.use.alternative).then(() => {
      setToast({
        text: product() ? `Back to ${nameOf(c.use)}, marked Ready` : `Staying on ${nameOf(c.use)}`,
      });
      return loadDesign();
    }, fail);
  }
  // Ready: this is the version, at what each state shows now; again takes it off, and on
  // Changed marks it again. Marking a screen marks the components inside it too.
  async function markReady() {
    const m = design();
    if (!m || readonly() || !product()) return;
    const on = !m.ready || !!m.changed;
    try {
      const { carried } = await api.ready(m.id, on);
      await loadDesign();
      setToast({
        text: !on
          ? `${m.title} is in design again`
          : carried.length
            ? `${m.title} is Ready, with ${[...new Set(carried.map((c) => c.slug))].join(", ")} inside`
            : `${m.title} is Ready`,
      });
    } catch (e) {
      fail(e);
    }
  }
  // Dimmed where it stands, never removed; Undo brings it back.
  // Resolves to its undo, or to nothing if it stayed. Quiet for whoever tells it
  // as part of something bigger.
  async function hideVersion(
    ref: VersionRef,
    hidden: boolean,
    quiet = false,
  ): Promise<(() => void) | undefined> {
    const m = design();
    if (!m || readonly()) return;
    const state = activeState();
    const name = nameOf(ref);
    // Off the stage, since it's no longer what this state shows: to the one before it,
    // else after.
    const away = hidden
      ? (neighbourStep(listed(), ref, -1) ?? neighbourStep(listed(), ref, 1))
      : null;
    try {
      await api.hide(m.id, { state, ...ref, hidden });
      await loadDesign();
      if (away && sameVersion(onStage(), ref)) showVersion(away);
      const undo = () => {
        setToast(null);
        void hideVersion(ref, false, quiet).then(() => showVersion(ref));
      };
      if (!quiet) setToast(hidden ? { text: `Hid ${name}`, undo } : { text: `Restored ${name}` });
      return undo;
    } catch (e) {
      fail(e);
      return undefined;
    }
  }
  // Studio has no Send to wait for: each steer (more like this, a comment, a
  // borrow) is a reply of its own. It goes alone — never with the answers,
  // tuning or notes the user is still composing on Stage, which a steer must
  // not decide — and that draft is left as it was.
  // True once the reply is stored, so a "sent" never shows for one that wasn't.
  async function sendAlone(body: {
    comments?: DraftInput["comments"];
    text?: string;
    more?: { ask: string; note?: string; like?: string };
    answers?: Record<string, AskAnswer>;
    update?: { ask: string; option: string };
    combo?: string;
  }): Promise<boolean> {
    const m = design();
    if (!m || readonly()) return false;
    await flush();
    const keep = draft();
    try {
      const { reply } = await api.reply(m.id, {
        ...emptyDraft(boundVersion() ?? latest()),
        comments: body.comments ?? [],
        ...(body.answers ? { answers: body.answers } : {}),
        ...(body.text ? { text: body.text } : {}),
        ...(body.more ? { more: body.more } : {}),
        ...(body.update ? { update: body.update } : {}),
        ...(body.combo ? { combo: body.combo } : {}),
        ...toField(),
      });
      // Every reply clears the stored draft; put the user's back before the
      // design is fetched again, so the screen never shows it gone. What this reply
      // answered is settled, so its drafted picks don't come back.
      if (keep) {
        const left = { ...keep, answers: { ...keep.answers } };
        for (const id of Object.keys(body.answers ?? {})) delete left.answers[id];
        await api.putDraft(m.id, left);
      }
      const [next] = await Promise.all([
        api.design(m.id).catch(() => null),
        loadComments().catch(() => {}),
      ]);
      batch(() => {
        if (next) setDesign(next);
        setSent(true);
        setSentId(reply.id);
      });
      armBeat();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }
  // What each question offered when more answers were asked for, to tell the new ones.
  const [askedMore, setAskedMore] = createSignal<Record<string, string[]>>({});
  async function askMore(ask: Ask, note: string, like?: AskOption): Promise<boolean> {
    const known = ask.options.map((o) => o.id);
    const sent = await sendAlone({
      text: like ? `More like ${splitLabel(like.label).name}` : `More answers to: ${ask.text}`,
      more: { ask: ask.id, ...(note ? { note } : {}), ...(like ? { like: like.id } : {}) },
    });
    if (sent) setAskedMore((all) => ({ ...all, [ask.id]: known }));
    return sent;
  }
  const isNewOption = (ask: Ask, id: string) => {
    const known = askedMore()[ask.id];
    return !!known && !known.includes(id);
  };
  const moreWaiting = (ask: Ask) =>
    !!askedMore()[ask.id] && !ask.options.some((o) => isNewOption(ask, o.id));
  // What the agent will keep to: what's been answered on the design, this question aside.
  const answeredAround = (ask: Ask) =>
    (design()?.asks ?? [])
      .filter((a) => a.id !== ask.id && a.answer !== undefined)
      .flatMap((a) =>
        answerIds(a.answer).map((id) => a.options.find((o) => o.id === id)?.label ?? id),
      );
  // Kept and hidden answers save on the click: the screen moves at once, and moves
  // back if the server refuses (server/standings.ts holds the rules).
  const standingFor = (ask: Ask): AnswerStanding =>
    design()?.standings?.[ask.id] ?? { kept: [], hidden: [] };
  const isKept = (ask: Ask, id: string) => standingFor(ask).kept.includes(id);
  // Hidden by the user, or an alternative answer whose alternative is archived, which is what
  // hiding one does (server/alternativeQuestion.ts): its reason is the why.
  const hiddenOf = (ask: Ask, id: string): HiddenAnswer | undefined => {
    const said = hiddenAnswer(standingFor(ask), id);
    if (said) return said;
    const m = design();
    const o = ask.options.find((x) => x.id === id);
    if (!m || !o || !archivedAnswer(ask, o, m, m.alternatives)) return undefined;
    const states = optionStates(ask, o, m);
    const why = m.alternatives.find(
      (v) => v.alternative === o.alternative && states.includes(v.state) && v.archiveReason,
    )?.archiveReason;
    return { id, label: o.label, ...(why ? { why } : {}), alternative: o.alternative };
  };
  const isCarried = (ask: Ask, id: string) => !!standingFor(ask).carried?.includes(id);
  function putStanding(ask: Ask, next: AnswerStanding) {
    const m = design();
    if (m) setDesign({ ...m, standings: { ...m.standings, [ask.id]: next } });
  }
  async function setStanding(ask: Ask, o: AskOption, to: StandingKind, why?: string) {
    const m = design();
    if (!m || readonly()) return;
    const was = standingFor(ask);
    // An alternative answer's alternative follows it at once: hidden archives it, anything else
    // brings it back. The server refuses to hide the one in use.
    const wasAlternatives = m.alternatives;
    if (o.alternative && ask.scope !== "part") {
      const states = optionStates(ask, o, m);
      const mine = (v: AlternativeView) =>
        v.alternative === o.alternative && states.includes(v.state);
      if (to === "hidden" && m.alternatives.some((v) => mine(v) && v.status === "inUse")) {
        fail(new Error(`${o.alternative} is in use: choose another before hiding it`));
        return;
      }
      setDesign({
        ...m,
        alternatives: m.alternatives.map((v) =>
          !mine(v)
            ? v
            : to === "hidden" && v.status === "open"
              ? { ...v, status: "archived" as const }
              : to !== "hidden" && v.status === "archived"
                ? { ...v, status: "open" as const }
                : v,
        ),
      });
    }
    putStanding(ask, withStanding(was, o, to, why));
    // A hidden answer is out of the running, so it can't stay the pick.
    if (to === "hidden" && drafted(ask) && answerIds(answerOf(ask)).includes(o.id)) {
      writeDraft((d) => {
        const left = answerIds(d.answers[ask.id]).filter((x) => x !== o.id);
        if (ask.multi && left.length) d.answers[ask.id] = left;
        else delete d.answers[ask.id];
        return d;
      });
    }
    try {
      await api.standing(m.id, { ask: ask.id, option: o.id, to, ...(why ? { why } : {}) });
    } catch (e) {
      const now = design();
      if (now) setDesign({ ...now, alternatives: wasAlternatives });
      putStanding(ask, was);
      fail(e);
    }
  }
  // The answers a question shows, in the order it shows them: kept ones first, hidden
  // ones left out (they fold away below), the rest as the agent asked.
  const shownOptions = (ask: Ask): AskOption[] => {
    const st = standingFor(ask);
    const live = ask.options.filter((o) => !hiddenOf(ask, o.id));
    return [
      ...live.filter((o) => st.kept.includes(o.id)),
      ...live.filter((o) => !st.kept.includes(o.id)),
    ];
  };
  const hiddenOptions = (ask: Ask): AskOption[] => [
    ...ask.options.filter((o) => hiddenOf(ask, o.id)),
    ...hiddenAlternativeAnswers(ask, standingFor(ask)),
  ];
  const toggleKept = (ask: Ask, o: AskOption) =>
    void setStanding(ask, o, isKept(ask, o.id) ? "open" : "kept");
  function hideAnswer(ask: Ask, o: AskOption) {
    if (preview()?.key === optionKey(ask, o.id)) setPreview(null);
    void setStanding(ask, o, "hidden");
    setToast({
      text: `Archived ${o.label}`,
      undo: () => {
        setToast(null);
        void setStanding(ask, o, "open");
      },
      reason: {
        value: null,
        save: (why) => void setStanding(ask, o, "hidden", why ?? undefined),
      },
    });
  }
  const unhideAnswer = (ask: Ask, o: AskOption) => void setStanding(ask, o, "open");
  // Answered, a kept answer can take over: the one in use waits in its place, and the
  // agent hears the change as a reply of its own, so nothing is drafted for it.
  async function useInstead(ask: Ask, o: AskOption): Promise<boolean> {
    const m = design();
    if (!m || readonly()) return false;
    const was = answerIds(ask.answer);
    try {
      for (const id of was) {
        const old = ask.options.find((x) => x.id === id);
        if (old && !ask.multi && !isKept(ask, id)) {
          await api.standing(m.id, { ask: ask.id, option: id, to: "kept" });
        }
      }
    } catch (e) {
      fail(e);
      return false;
    }
    const name = (l: string) => splitLabel(l).name;
    const labels = was.map((id) => name(ask.options.find((x) => x.id === id)?.label ?? id));
    const sent = await sendAlone({
      answers: { [ask.id]: ask.multi ? [...was, o.id] : o.id },
      text: ask.multi
        ? `${name(o.label)} too`
        : `${name(o.label)} instead${labels.length ? ` of ${labels.join(", ")}` : ""}`,
    });
    if (sent) setPreview(null);
    return sent;
  }
  // A kept screen doesn't follow the one in use by itself: brought up to date once,
  // or changed along with it from now on.
  const updateOnce = (ask: Ask, o: AskOption) =>
    sendAlone({
      update: { ask: ask.id, option: o.id },
      text: `Bring ${splitLabel(o.label).name} up to date`,
    });
  async function carryKept(ask: Ask, o: AskOption, carried: boolean) {
    const m = design();
    if (!m || readonly()) return;
    try {
      await api.standing(m.id, { ask: ask.id, option: o.id, carried });
    } catch (e) {
      fail(e);
      return;
    }
    await sendAlone({
      text: carried
        ? `Change ${splitLabel(o.label).name} along with the one in use, from now on`
        : `Leave ${splitLabel(o.label).name} as it is`,
    });
  }
  // Saved combos: the answers on screen under a name, to come back to whole.
  const combos = (): AnswerCombo[] => design()?.combos ?? [];
  const answersNow = (): Record<string, AskAnswer> => {
    const out: Record<string, AskAnswer> = {};
    for (const a of design()?.asks ?? []) {
      const x = answerOf(a);
      if (answerIds(x).length) out[a.id] = x!;
    }
    return out;
  };
  async function writeCombo(body: Parameters<typeof api.saveCombo>[1]) {
    const m = design();
    if (!m || readonly()) return false;
    try {
      const { combos: next } = await api.saveCombo(m.id, body);
      const now = design();
      if (now) setDesign({ ...now, combos: next });
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }
  const saveCombo = (name: string) => writeCombo({ name, answers: answersNow() });
  function removeCombo(combo: AnswerCombo) {
    void writeCombo({ name: combo.name, remove: true });
    setToast({
      text: `Removed ${combo.name}`,
      undo: () => {
        setToast(null);
        void writeCombo({ name: combo.name, answers: combo.answers });
      },
    });
  }
  // What a combo looks like on the stage: every answer's values, and its screen if one
  // of them picks a screen.
  function previewCombo(combo: AnswerCombo): Preview | null {
    const m = design();
    if (!m) return null;
    let out: Preview = { key: `combo:${combo.name}`, label: combo.name, knobs: {} };
    for (const [askId, answer] of Object.entries(combo.answers)) {
      const ask = m.asks.find((a) => a.id === askId);
      for (const id of answerIds(answer)) {
        const p = ask ? previewOf(ask, id) : null;
        if (!p) continue;
        out = {
          ...out,
          ...(p.alternative ? { alternative: p.alternative, state: p.state } : {}),
          ...(p.palette ? { palette: p.palette } : {}),
        };
        if (p.version) out.version = p.version;
        out.knobs = { ...out.knobs, ...p.knobs };
      }
    }
    return out;
  }
  const comboInUse = (combo: AnswerCombo) =>
    Object.entries(combo.answers).every(([id, x]) => {
      const a = design()?.asks.find((q) => q.id === id);
      return !!a && JSON.stringify(answerIds(a.answer)) === JSON.stringify(answerIds(x));
    });
  const useCombo = (combo: AnswerCombo) =>
    sendAlone({ answers: combo.answers, combo: combo.name, text: `Use ${combo.name}` });
  // A steer names the version, since Studio shows older ones side by side.
  // Several go as one reply, with `text` for what is said about all of them.
  function steer(c: SteerNote) {
    return steerMany([c]);
  }
  function steerMany(notes: SteerNote[], text?: string) {
    return sendAlone({
      ...(text ? { text } : {}),
      comments: notes.map((c) => ({
        part: c.part ?? null,
        state: activeState(),
        text: c.text ?? "",
        alternative: c.alternative,
        version: c.version,
        ...(c.reaction ? { reaction: c.reaction } : {}),
        ...(c.borrow
          ? {
              borrow: {
                from: `${c.borrow.from.alternative}@${c.borrow.from.version}`,
                ...(c.borrow.part ? { part: c.borrow.part } : {}),
              },
            }
          : {}),
      })),
    });
  }
  // Studio's ×. One version dims like any hidden version; the last one left takes
  // its alternative to Archived, where Restore brings it back.
  const liveIn = (state: string | null) =>
    alternatives().some((v) => v.state === state && isLive(v.status));
  // Everything archived: such a state leaves the tabs and every list of states,
  // unless a question still waits there.
  const emptiedState = (state: string | null) =>
    !liveIn(state) && askedIn(state) === 0 && alternatives().some((v) => v.state === state);
  // Every design has left, once the last has really landed, and no question waits.
  const emptied = () =>
    archiving().size === 0 && states().every((state) => !liveIn(state) && askedIn(state) === 0);
  // The closest state on with something left, else the closest back.
  function nextLiveState(): string | null | undefined {
    const all = states();
    const at = all.indexOf(activeState());
    return [...all.slice(at + 1), ...all.slice(0, at).reverse()].find(liveIn);
  }
  // Resolves to its undo, or to nothing if they stayed; quiet as hideVersion is.
  async function archiveAlternatives(
    alternatives: string[],
    label = alternatives.join(", "),
    quiet = false,
  ) {
    const m = design();
    if (!m || readonly() || !alternatives.length) return undefined;
    const state = activeState();
    const keys = alternatives.map((v) => archiveKey(state, v));
    const going = (on: boolean) =>
      setArchiving((was) => {
        const next = new Set(was);
        for (const k of keys) {
          if (on) next.add(k);
          else next.delete(k);
        }
        return next;
      });
    going(true);
    // The last one out empties the state and its tab goes, so on to the next.
    const movedOn = liveIn(activeState()) ? undefined : nextLiveState();
    if (movedOn !== undefined) showState(movedOn);
    let landed = true;
    const done = (async () => {
      try {
        for (const v of alternatives) await api.archiveAlternative(m.id, state, v);
        await loadDesign();
      } catch (e) {
        landed = false;
        await loadDesign().catch(() => {});
        fail(e);
      } finally {
        going(false);
      }
    })();
    const undo = () => {
      setToast(null);
      if (movedOn !== undefined) showState(state);
      // After the archive lands, or the restore could be overtaken by it.
      void done.then(() => {
        for (const v of alternatives) void restoreAlternative(v, [state]);
      });
    };
    if (!quiet) {
      setToast({
        text: `Archived ${label}`,
        undo,
        reason: {
          value: null,
          // After the archive lands: the server only keeps a reason for what has gone.
          save: (reason) =>
            void done.then(() => {
              for (const v of alternatives) saveArchiveReason(v, reason, state);
            }),
        },
      });
    }
    await done;
    return landed ? undo : undefined;
  }
  // The states this screen could still have, and the one being asked for right now
  // (an empty name is + New state, whose name is still to be typed).
  const outlinable = createMemo(() => {
    const m = design();
    return !!m && !readonly() && canOutline(m, alternatives());
  });
  const stateOutlines = createMemo(() => {
    const m = design();
    return m && outlinable() ? missingStates(m, alternatives()) : [];
  });
  const [askingState, setAskingState] = createSignal<{ name: string } | null>(null);
  function setOutline(state: string, to: StateOutline | null) {
    const m = design();
    if (!m) return Promise.resolve(false);
    return api.stateOutline(m.id, { state, to }).then(
      async () => {
        await loadDesign();
        return true;
      },
      (e) => {
        fail(e);
        return false;
      },
    );
  }
  async function dismissOutline(name: string) {
    setAskingState(null);
    if (!(await setOutline(name, "dismissed"))) return;
    setToast({
      text: `${name} doesn't apply here`,
      undo: () => {
        setToast(null);
        void setOutline(name, null);
      },
    });
  }
  // A plan's own state: nothing is drawn, so once it's gone there is nothing to bring
  // back, and the agent can plan it again.
  async function dropPlannedState(name: string) {
    if (!(await setOutline(name, "dismissed"))) return;
    const left = states().find((st) => st !== name);
    if (left !== undefined) showState(left);
    setToast({ text: `${name} isn't needed` });
  }
  // A request is a reply like any other: it goes out now, whatever the draft holds, and
  // nothing waits on it. The outline stays, marked, until a state of that name arrives.
  async function askForState(name: string, detail: string) {
    const said = detail.trim();
    const sent = await sendAlone({
      text: `New state, please: ${name}.${said ? ` ${said}` : ""}`,
    });
    if (!sent) return false;
    setAskingState(null);
    await setOutline(name, "requested");
    return true;
  }
  function askToDraw() {
    const m = design();
    if (!m) return Promise.resolve(false);
    const state = activeState();
    return sendAlone({ text: `Please draw ${m.title}${state ? `, ${state}` : ""}.` });
  }
  // What's being written stays while the panel shuts or another opens: one section of
  // the spec at a time, each its own edit.
  const [specWriting, setSpecWriting] = createSignal<SpecDraft | null>(null);
  // A hand edit: what later agents read, and what an active one hears in its feedback.
  function saveSpec(edit: { purpose: string } | { behaviour: SpecLine[] }) {
    const m = design();
    if (!m || readonly()) return Promise.resolve(false);
    return api.editDesign(m.id, edit).then(
      async () => {
        await loadDesign();
        return true;
      },
      (e) => {
        fail(e);
        return false;
      },
    );
  }
  // New version: ask the agent for another version of the one on stage, as a reply
  // (with whatever the draft holds), so it arrives through the same cursor.
  function askNew() {
    const ref = onStage();
    if (!ref) return;
    void send({
      verdict: { kind: "revise", state: activeState(), alternative: ref.alternative },
      text: `New version, please, from ${nameOf(ref)}.`,
    });
  }
  // The newer version a draft-bound stage is holding back.
  function viewNewVersion() {
    const m = design();
    const d = draft();
    if (!m || !d) return;
    const moved = carryOver(d, withAsks(m), alternatives(), latest());
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
    design,
    missing,
    comments,
    draft,
    alternatives,
    states,
    allWidths,
    latest,
    boundVersion,
    arrived,
    stageVersion,
    look,
    lookPick,
    answerOf,
    otherOf,
    otherTicked,
    setOther,
    setComment,
    commentOf,
    foldedOf,
    setFolded,
    imagesOf,
    pendingOf,
    attachImages,
    detachImage,
    dismissPending,
    attachStatus,
    tuneShown,
    alternativeFor,
    activeAlternative,
    activeState,
    showState,
    chooseAlternative,
    preview,
    setPreview,
    cur,
    goQuestion,
    stageOffer,
    showAskState,
    backFromAsk,
    goAsk,
    goOwed,
    changeAnswer,
    keepAnswer,
    revisingOf,
    reopen,
    archiveDesign,
    saveEndReason,
    saveArchiveReason,
    changed,
    stayOnUse,
    followShown,
    step,
    stepTarget,
    curAsk,
    commitKind,
    commit,
    choose,
    chooseNth,
    previewOf,
    stagePalette,
    hoveredPreview,
    setHoveredPreview,
    heldPreview,
    setHeldPreview,
    askMore,
    standingFor,
    shownOptions,
    hiddenOptions,
    isKept,
    hiddenOf,
    isCarried,
    toggleKept,
    hideAnswer,
    unhideAnswer,
    useInstead,
    updateOnce,
    carryKept,
    combos,
    answersNow,
    saveCombo,
    removeCombo,
    previewCombo,
    comboInUse,
    useCombo,
    moreWaiting,
    isNewOption,
    answeredAround,
    optionKey,
    afterSend,
    goNext,
    stayHere,
    goOwedDesign,
    nextStop,
    questions,
    flow,
    closedAsks,
    asks,
    owed,
    owedIn,
    askedIn,
    waitsOnStage,
    landOn,
    stagePick,
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
    tuneOpen,
    openTune,
    tunable,
    setTunable,
    steps,
    onStage,
    stageStep,
    stageLabel,
    nameOf,
    inUse,
    usedBefore,
    showVersion,
    listed,
    stepVersion,
    useThis,
    product,
    markReady,
    hideVersion,
    askNew,
    outlinable,
    stateOutlines,
    specWriting,
    setSpecWriting,
    askingState,
    setAskingState,
    dismissOutline,
    dropPlannedState,
    askForState,
    askToDraw,
    saveSpec,
    viewNewVersion,
    toast,
    setToast,
    drawer,
    setDrawer,
    panel,
    setPanel,
    showTalk,
    questionHidden,
    cardMin,
    setCardMin,
    sent,
    sentReply,
    sentDelivered,
    beatPassed,
    agentListening,
    recipients,
    sendTo,
    setPickedTo,
    lastSend,
    sinceSend,
    seeSinceSend,
    sending,
    flagged,
    error,
    setError,
    pick,
    toggleMix,
    addComment,
    setCommentText,
    removeComment,
    sendable,
    sendDraft,
    react,
    reactionOn,
    reactStatus,
    reactPart: () => (tuning() ? null : tapped()),
    frameW,
    setFrameW,
    zoom,
    setZoom,
    stageScale,
    setStageScale,
    zoomMin,
    setZoomMin,
    tool,
    setTool,
    toggleTool,
    marking,
    setMarking,
    trying,
    setTrying,
    tuning,
    threadText,
    setThreadText,
    prefill,
    postComment,
    restoreAlternative,
    steer,
    steerMany,
    archiveAlternatives,
    nextLiveState,
    emptiedState,
    emptied,
    handToast,
    setTuned,
    replaceTuned,
    resetTuned,
    knobContext,
    send,
    tuneHost,
    setTuneHost,
    reports,
    setReports,
    frameVersionOf: versionOf,
    answersBaseOf,
  };
}

export type DesignScreenState = ReturnType<typeof createDesignScreen>;

// Several events in one burst (a reply flips statuses on every alternative) cost
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
