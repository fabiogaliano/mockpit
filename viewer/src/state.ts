// The mock screen's state: the mock as the server last sent it, the user's
// draft, and the view (state on stage, question, mode, selection, preview,
// version). Components read signals from here and call its actions; nothing
// else talks to the API for this screen.

import { batch, createMemo, createSignal, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import type { Ask, KnobValue, ReplyDecision } from "../../server/types.ts";
import { api, type CommentRow, type DraftInput, type MockDetail, subscribe } from "./api.ts";
import { host } from "./host.ts";
import {
  answerIds,
  askState,
  carryOver,
  draftIsEmpty,
  emptyDraft,
  frameVersion,
  lookAsk,
  mixOptions,
  mockVersion,
  overriddenAsks,
  type PartsReport,
  unanswered,
} from "./logic.ts";
import { setTheme } from "./theme.ts";

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
  // The part picked on the stage. Tune (phase 4b) reads it to show that part's knobs.
  const [selectedPart, setSelectedPart] = createSignal<string | null>(null);
  const [hoverPart, setHoverPart] = createSignal<string | null>(null);
  const [viewVersion, setViewVersion] = createSignal<number | null>(null);
  const [versionsOpen, setVersionsOpen] = createSignal(false);
  const [sent, setSent] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [flagged, setFlagged] = createSignal<string[]>([]);
  // "No, all <look>" is an answer even though it borrows nothing.
  const [mixTouched, setMixTouched] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  // Where Tune's knob controls mount (phase 4b hands this element to tunekit).
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

  const answerOf = (ask: Ask) => draft()?.answers[ask.id] ?? ask.answer;

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
    return m ? mixOptions(m, variants(), lookPick()) : [];
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
  function selectPart(part: string | null) {
    setSelectedPart(part);
    if (part && mode() !== "tune") setMode("tune");
  }

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

  function pick(ask: Ask, optionId: string) {
    writeDraft((d) => {
      if (ask.multi) {
        const have = answerIds(d.answers[ask.id]);
        const next = have.includes(optionId)
          ? have.filter((x) => x !== optionId)
          : [...have, optionId];
        if (next.length) d.answers[ask.id] = next;
        else delete d.answers[ask.id];
      } else {
        d.answers[ask.id] = optionId;
      }
      if (look()?.id === ask.id) {
        // A borrow from the look just picked is no longer a borrow.
        const chosen = ask.options.find((o) => o.id === optionId)?.variant;
        for (const p of Object.keys(d.mix)) if (d.mix[p] === chosen) delete d.mix[p];
      }
      return d;
    });
    setFlagged(flagged().filter((x) => x !== ask.id));
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
  function addComment(part: string | null, state: string | null, text: string) {
    writeDraft((d) => {
      d.comments.push({ part, state, text });
      return d;
    });
  }
  // Tune's writer (phase 4b): one tuned knob value into the draft.
  function setTuned(path: string, value: KnobValue | undefined) {
    writeDraft((d) => {
      if (value === undefined) delete d.tuned[path];
      else d.tuned[path] = value;
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
      batch(() => {
        setDraftSignal(null);
        setSent(true);
        setModeSignal("thread");
        setPreview(null);
      });
      setMixTouched(false);
      record(true);
      await Promise.all([loadMock(), loadComments()]);
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
      await api.restore(m.id, { state: v.state, variant: v.variant });
      backToLatest();
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
    setTuned,
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
