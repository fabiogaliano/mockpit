// The mock screen's state: the mock as the server last sent it, the user's
// draft, and the view (state on stage, question, mode, selection, preview,
// version). Components read signals from here and call its actions; nothing
// else talks to the API for this screen.

import { batch, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import type { Ask, KnobValue, PartCommentAnchor, ReplyDecision } from "../../server/types.ts";
import { api, type CommentRow, type DraftInput, type MockDetail, subscribe } from "./api.ts";
import { host } from "./host.ts";
import {
  answerIds,
  askState,
  carryOver,
  draftIsEmpty,
  emptyDraft,
  frameKey,
  frameVersion,
  type KnobContext,
  lookAsk,
  mixOptions,
  mockVersion,
  overriddenAsks,
  type PartsReport,
  pickInDraft,
  tuneVisible,
  unanswered,
} from "./logic.ts";
import { setTheme } from "./theme.ts";
import { narrow } from "./viewport.ts";

export type Mode = "questions" | "tune" | "thread";
export type Question = { kind: "ask"; ask: Ask } | { kind: "mix" };

// What the stage shows while the pointer rests on an option: another variant,
// or knob values sent live to the frame on stage.
export interface Preview {
  key: string;
  variant?: string;
  state?: string | null;
  knobs?: Record<string, KnobValue>;
}

const SAVE_MS = 300;

export function createMockScreen(project: string, slug: string) {
  const [mock, setMock] = createSignal<MockDetail | null>(null);
  const [missing, setMissing] = createSignal(false);
  const [comments, setComments] = createSignal<CommentRow[]>([]);
  const [draft, setDraftSignal] = createSignal<DraftInput | null>(null);
  const [activeState, setActiveState] = createSignal<string | null>(null);
  const [chosenVariant, setChosenVariant] = createSignal<Record<string, string>>({});
  const [preview, setPreview] = createSignal<Preview | null>(null);
  const [mode, setModeSignal] = createSignal<Mode>("questions");
  const [cur, setCur] = createSignal(0);
  // The part picked on the stage, shown in Tune; null is the page ("Look").
  const [selectedPart, setSelectedPart] = createSignal<string | null>(null);
  const [hoverPart, setHoverPart] = createSignal<string | null>(null);
  // A part tapped on a narrow stage (no Tune there); lit until the question or
  // mode moves on.
  const [tapped, setTapped] = createSignal<string | null>(null);
  const [viewVersion, setViewVersion] = createSignal<number | null>(null);
  const [versionsOpen, setVersionsOpen] = createSignal(false);
  const [sent, setSent] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [flagged, setFlagged] = createSignal<string[]>([]);
  // askId → "Other…" ticked; a write-in counts once it has text, so until then
  // the tick lives only here.
  const [otherOpen, setOtherOpen] = createSignal<Record<string, boolean>>({});
  // "No, all <look>" is an answer even though it borrows nothing.
  const [mixTouched, setMixTouched] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  // The Mark tool (D11): while on, a click on the stage leaves a comment there.
  const [marking, setMarking] = createSignal(false);
  // Thread's comment field; a frame's sendPrompt fills it.
  const [threadText, setThreadText] = createSignal("");
  // Where Tune's knob controls mount: tunekit's pane is moved into it while Tune is open.
  const [tuneHost, setTuneHost] = createSignal<HTMLElement | null>(null);
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
  const look = createMemo(() => (mock() ? lookAsk(mock()!) : undefined));

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

  // The variant the Look question settled on, drafted or sent.
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

  const mixOpts = createMemo(() => {
    const m = mock();
    return m
      ? mixOptions(m, variants(), lookPick(), (state, variant) => reports[frameKey(state, variant)])
      : [];
  });
  const questions = createMemo<Question[]>(() => {
    const m = mock();
    if (!m) return [];
    const list: Question[] = m.asks.map((ask) => ({ kind: "ask", ask }));
    // Mix only exists once a look is picked and another look renders a part.
    if (look() && lookPick() && mixOpts().length) list.push({ kind: "mix" });
    return list;
  });
  const owed = createMemo(() => {
    const m = mock();
    return m ? unanswered(m, draft()) : [];
  });
  // Tune is shown only with something to tune (tiers, no modes).
  const tuneShown = createMemo(() => {
    const m = mock();
    return !!m && tuneVisible(m, inState(activeState()));
  });
  // What Tune reads and writes: the knobs of the variant on stage, every answer
  // so far (sent, then drafted), and the tuned values.
  const knobContext = createMemo<KnobContext>(() => {
    const m = mock();
    const answers: KnobContext["answers"] = {};
    for (const a of m?.asks ?? []) if (a.answer !== undefined) answers[a.id] = a.answer;
    Object.assign(answers, draft()?.answers ?? {});
    return {
      knobs: { ...m?.knobs, ...activeVariant()?.knobs },
      asks: m?.asks ?? [],
      answers,
      tuned: draft()?.tuned ?? {},
    };
  });
  // The part the current question is about, while Questions is open.
  const focusPart = createMemo(() => {
    if (mode() !== "questions") return null;
    const q = questions()[cur()];
    return q?.kind === "ask" && q.ask.scope === "part" ? (q.ask.part ?? null) : null;
  });
  // The part outlined on the stage. selectedPart outlives the question that set
  // it (Tune opens on it), so outside Tune the outline follows the question.
  const stagePart = createMemo(() =>
    mode() === "tune" ? selectedPart() : (tapped() ?? focusPart()),
  );
  const overridden = createMemo(() => {
    const m = mock();
    const d = draft();
    return m && d ? overriddenAsks(m.asks, d.answers, d.mix) : {};
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
    });
    batch(() => {
      setDraftSignal(next);
      setSent(false);
      setError(null);
    });
    pending = next;
    lastLocalWrite = Date.now();
    host().window.clearTimeout(saveTimer);
    saveTimer = host().window.setTimeout(flush, SAVE_MS);
  }

  // --- loading and the live feed ---

  let mockId: string | null = null;
  async function resolveId(): Promise<string | null> {
    if (mockId) return mockId;
    const list = await api.mocks(project);
    mockId = list.mocks.find((m) => m.slug === slug)?.id ?? null;
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
    // Open on the first question still owed, on the state it is about.
    const first = owed()[0];
    const idx = first ? questions().findIndex((q) => q.kind === "ask" && q.ask.id === first.id) : 0;
    goQuestion(Math.max(0, idx), { history: false });
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
        case "comment-deleted":
        case "comment-seen":
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
    stop();
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
    view: number | null;
  };
  const snap = (): Snap => ({
    mockpit: "mock",
    state: activeState(),
    mode: mode(),
    cur: cur(),
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
    batch(() => {
      setActiveState(v.state);
      setModeSignal(v.mode);
      setCur(v.cur);
      setViewVersion(v.view);
      setPreview(null);
      setVersionsOpen(false);
    });
    return true;
  }

  function goQuestion(i: number, opts: { history?: boolean } = {}) {
    const q = questions()[i];
    const m = mock();
    batch(() => {
      setCur(i);
      setModeSignal("questions");
      setTapped(null);
      setPreview(null);
      if (q && m) {
        if (q.kind === "ask") setActiveState(askState(q.ask, m, activeState()));
        if (q.kind === "ask" && q.ask.scope === "part" && q.ask.part) setSelectedPart(q.ask.part);
      }
    });
    if (opts.history !== false) record(false);
    else record(true);
  }
  function setMode(next: Mode) {
    if (next === "questions") return goQuestion(cur());
    batch(() => {
      setModeSignal(next);
      setPreview(null);
      setTapped(null);
    });
    record(false);
  }
  function showState(state: string | null) {
    batch(() => {
      setActiveState(state);
      setPreview(null);
    });
    record(true);
  }
  function chooseVariant(variant: string) {
    setChosenVariant({ ...chosenVariant(), [String(activeState())]: variant });
  }
  // Narrow screens have no Tune, so a tap on the stage only marks the part.
  function selectPart(part: string | null) {
    setSelectedPart(part);
    if (narrow()) setTapped(part);
    else if (part && mode() !== "tune") setMode("tune");
  }
  // No Tune tab (narrow screen, or nothing to tune): a Tune mode restored from
  // history or set by a stray click lands on Questions instead.
  createEffect(() => {
    if (mode() === "tune" && (narrow() || (mock() && !tuneShown()))) setModeSignal("questions");
  });

  // The next question still owed after i, else the last one (where Send lives).
  function nextStop(i: number): number | null {
    const qs = questions();
    for (let k = 1; k <= qs.length; k++) {
      const j = (i + k) % qs.length;
      const q = qs[j];
      if (q.kind === "ask" && owed().some((a) => a.id === q.ask.id)) return j;
    }
    return qs.length - 1 !== i ? qs.length - 1 : null;
  }

  // --- answers ---

  // `null` is "Other…".
  function pick(ask: Ask, optionId: string | null) {
    let open = false;
    writeDraft((base) => {
      const r = pickInDraft(base, ask, optionId, !!otherOpen()[ask.id]);
      open = r.otherOpen;
      const d = r.draft;
      if (optionId !== null && look()?.id === ask.id) {
        // A borrow from the look just picked is no longer a borrow.
        const chosen = ask.options.find((o) => o.id === optionId)?.variant;
        for (const p of Object.keys(d.mix)) if (d.mix[p] === chosen) delete d.mix[p];
      }
      return d;
    });
    setOtherOpen({ ...otherOpen(), [ask.id]: open });
    setFlagged(flagged().filter((x) => x !== ask.id));
  }
  // The write-in under "Other…", and the note on a question. Blank is none.
  function setOther(ask: Ask, text: string) {
    writeDraft((d) => {
      if (text.trim()) {
        d.others[ask.id] = text;
        if (!ask.multi) delete d.answers[ask.id];
      } else delete d.others[ask.id];
      return d;
    });
    setOtherOpen({ ...otherOpen(), [ask.id]: true });
  }
  function setNote(ask: Ask, text: string) {
    writeDraft((d) => {
      if (text.trim()) d.notes[ask.id] = text;
      else delete d.notes[ask.id];
      return d;
    });
  }
  // `null` is "No, all <look>": clears every borrow.
  function toggleMix(opt: { part: string; variant: string } | null) {
    writeDraft((d) => {
      if (!opt) d.mix = {};
      else if (d.mix[opt.part] === opt.variant) delete d.mix[opt.part];
      else d.mix[opt.part] = opt.variant;
      return d;
    });
    setMixTouched(true);
  }
  const mixAnswered = () => mixTouched() || Object.keys(draft()?.mix ?? {}).length > 0;
  function undoMix(part: string) {
    writeDraft((d) => {
      delete d.mix[part];
      return d;
    });
  }
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

  async function send(extra: { decision?: ReplyDecision; text?: string } = {}) {
    const m = mock();
    if (!m || sending()) return;
    await flush();
    const d = draft() ?? emptyDraft(stageVersion());
    setSending(true);
    try {
      await api.reply(m.id, { ...d, ...extra });
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
        setModeSignal("thread");
        setPreview(null);
        setTapped(null);
      });
      setMixTouched(false);
      setOtherOpen({});
      record(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
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
    const moved = carryOver(d, m, variants(), latest());
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
    nextStop,
    questions,
    owed,
    overridden,
    mixOpts,
    mixAnswered,
    selectedPart,
    selectPart,
    focusPart,
    stagePart,
    hoverPart,
    setHoverPart,
    viewVersion,
    viewOld,
    backToLatest,
    restoreViewed,
    viewNewVersion,
    versionsOpen,
    setVersionsOpen,
    sent,
    sending,
    flagged,
    error,
    setError,
    pick,
    toggleMix,
    undoMix,
    addComment,
    marking,
    setMarking,
    threadText,
    setThreadText,
    prefill,
    postComment,
    restoreVariant,
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
