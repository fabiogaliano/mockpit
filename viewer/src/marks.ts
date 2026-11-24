// What the user has marked on the design, saved on the click and never waiting for a Send:
// the frames picked and the Main of each state (server/marks.ts), and each question's
// archived answers and those kept before picks (server/standings.ts). The screen moves at
// once, and moves back if the server refuses. The design's data is designData.ts; this
// reads and writes the marks on it.
//
// Until kept answers fold into marks, both are read: an answer is picked when its frame is
// marked or its question kept it. A new pick is written as a mark only.

import type { AnswerStanding, Ask, AskOption, HiddenAnswer } from "../../server/types.ts";
import { mainSlotKey, type MarkChange, type MarkSubject, subjectKey } from "../../server/marks.ts";
import { hiddenAnswer, type StandingKind, withStanding } from "../../server/standings.ts";
import {
  archivedAnswer,
  hiddenAlternativeAnswers,
  optionStates,
} from "../../server/alternativeQuestion.ts";
import {
  api,
  type AlternativeView,
  type DesignDetail,
  type DraftInput,
  type MarkView,
} from "./api.ts";
import { readonly } from "./host.ts";
import { answerIds } from "./logic.ts";
import type { Preview } from "./onScreen.ts";
import type { GhostLine } from "./ArchivedGhost.tsx";
import type { ToastLine } from "./toast.tsx";

interface MarkDeps {
  design: () => DesignDetail | null;
  setDesign: (m: DesignDetail) => void;
  drafted: (ask: Ask) => boolean;
  answerOf: (ask: Ask) => DraftInput["answers"][string] | undefined;
  writeDraft: (fn: (d: DraftInput) => DraftInput) => void;
  preview: () => Preview | null;
  setPreview: (p: Preview | null) => void;
  optionKey: (ask: Ask, optionId: string) => string;
  setToast: (line: ToastLine | null) => void;
  leaveGhost: (line: GhostLine) => void;
  // An archived alternative's reason, as the note it leaves saves it.
  saveArchiveReason: (alternative: string, reason: string | null, state: string | null) => void;
  fail: (e: unknown) => void;
  asks: () => Ask[];
  activeState: () => string | null;
  // The frame a state shows, which an answer's values are picked on.
  frameIn: (state: string | null) => AlternativeView | undefined;
}

export type MarkWord = "main" | "keep" | "deleted";

const isFrameMark = (m: MarkView): m is MarkView & MarkSubject =>
  m.alternative !== undefined && m.kind !== "archived";

export function createMarks(d: MarkDeps) {
  const { design, setDesign } = d;
  const standingFor = (ask: Ask): AnswerStanding =>
    design()?.standings?.[ask.id] ?? { kept: [], hidden: [] };
  const isKept = (ask: Ask, id: string) => standingFor(ask).kept.includes(id);

  // --- Main, Keep (Bookmarked), Deleted ---

  const marks = (): MarkView[] => design()?.marks ?? [];
  const viewOf = (subject: MarkSubject) => {
    const key = subjectKey(subject);
    return marks().find((m) => isFrameMark(m) && subjectKey(m) === key);
  };
  const markOf = (subject: MarkSubject): MarkWord | null => {
    const m = viewOf(subject);
    return m ? (m.kind as MarkWord) : null;
  };
  // A frame's active mark across its cells: Main outranks Keep; Deleted marks are ignored.
  const frameMark = (state: string | null, alternative: string): "main" | "keep" | null => {
    const mine = marks().filter(
      (m) =>
        isFrameMark(m) &&
        m.kind !== "deleted" &&
        m.state === state &&
        m.alternative === alternative,
    );
    return mine.some((m) => m.kind === "main")
      ? "main"
      : mine.some((m) => m.kind === "keep")
        ? "keep"
        : null;
  };
  // A frame's mark on a specific knob (or looks when knob is null): used for Sheet row stars
  // and Set progress (N/M ★).
  const frameKnobMark = (
    state: string | null,
    alternative: string,
    knob: string | null,
  ): "main" | "keep" | null => {
    const mine = marks().filter(
      (m) =>
        isFrameMark(m) &&
        m.kind !== "deleted" &&
        m.state === state &&
        m.alternative === alternative &&
        (knob === null ? !!m.look : !!m.values && Object.hasOwn(m.values, knob)),
    );
    return mine.some((m) => m.kind === "main")
      ? "main"
      : mine.some((m) => m.kind === "keep")
        ? "keep"
        : null;
  };
  // Optimistic update mirroring server/marks.ts withMark: setting Main replaces only an
  // earlier Main in the same slot (leaving it neutral, never auto-bookmarked).
  const locally = (
    list: MarkView[],
    subject: MarkSubject,
    kind: MarkWord | null,
    isSet: boolean,
  ) => {
    const key = subjectKey(subject);
    const slot = mainSlotKey(subject, isSet);
    const rest = list.filter((m) => {
      if (!isFrameMark(m)) return true;
      if (subjectKey(m) === key) return false;
      if (kind === "main" && m.kind === "main" && mainSlotKey(m, isSet) === slot) return false;
      return true;
    });
    if (kind === null) return rest;
    return [...rest, { ...subject, kind, at: new Date().toISOString(), by: "user" as const }];
  };
  async function setMark(subject: MarkSubject, kind: MarkWord | null): Promise<boolean> {
    const m = design();
    if (!m || readonly()) return false;
    const was = viewOf(subject);
    setDesign({ ...m, marks: locally(marks(), subject, kind, !!m.set) });
    try {
      const { marks: back } = await api.mark(m.id, { ...subject, mark: kind });
      const now = design();
      if (now) setDesign({ ...now, marks: back });
      // A bookmark read from a question's kept answer lives in that store: letting it go
      // takes it out of there too.
      if (kind === null && was?.answer) {
        const ask = d.asks().find((a) => a.id === was.answer!.ask);
        const o = ask?.options.find((x) => x.id === was.answer!.option);
        if (ask && o) await setStanding(ask, o, "open");
      }
      return true;
    } catch (e) {
      const now = design();
      if (now) setDesign({ ...now, marks: m.marks ?? [] });
      d.fail(e);
      return false;
    }
  }
  const toggleKeep = (subject: MarkSubject) =>
    void setMark(subject, markOf(subject) === "keep" ? null : "keep");
  const toggleMain = (subject: MarkSubject) =>
    void setMark(subject, markOf(subject) === "main" ? null : "main");
  async function deleteMark(subject: MarkSubject) {
    const prev = markOf(subject);
    if (prev === "deleted") return;
    // No undo: a deleted cell stays in its place on the Sheet, with Restore.
    await setMark(subject, "deleted");
  }

  async function deleteCells(subjects: MarkSubject[]): Promise<boolean> {
    const current = design();
    if (!current || readonly() || !subjects.length) return false;
    const save = async (changes: MarkChange[]) => {
      try {
        const result = await api.markCells(current.id, changes);
        const now = design();
        if (now?.id === current.id) setDesign({ ...now, marks: result.marks });
        return result.previous;
      } catch (error) {
        d.fail(error);
        return null;
      }
    };
    const previous = await save(subjects.map((subject) => ({ ...subject, mark: "deleted" })));
    // No undo: the column waits under the Sheet's Deleted columns, with Restore.
    return !!previous?.length && design()?.id === current.id;
  }
  // Back from deleted, each cell that still is: a mark set since stays.
  async function restoreCells(subjects: MarkSubject[]): Promise<void> {
    const current = design();
    if (!current || readonly() || !subjects.length) return;
    try {
      const result = await api.markCells(
        current.id,
        subjects.map((subject) => ({ ...subject, mark: null, ifDeleted: true })),
      );
      const now = design();
      if (now?.id === current.id) setDesign({ ...now, marks: result.marks });
    } catch (error) {
      d.fail(error);
    }
  }

  // What bookmarking an answer marks: its alternative, in each state it would be used in, or
  // the frame on stage in its values. An answer in words only, or one that borrows a part,
  // is on no frame.
  function answerSubjects(ask: Ask, o: AskOption): MarkSubject[] {
    const m = design();
    // A screen's or component's frames are not chosen between, so its answers stay kept.
    if (!m || m.kind !== "idea" || ask.scope === "part") return [];
    if (o.alternative) {
      return optionStates(ask, o, m)
        .filter((state) =>
          m.alternatives.some((v) => v.state === state && v.alternative === o.alternative),
        )
        .map((state) => ({ state, alternative: o.alternative! }));
    }
    if (!o.set || !Object.keys(o.set).length) return [];
    const state = ask.scope === "state" ? (ask.state ?? null) : d.activeState();
    const frame = d.frameIn(state);
    return frame ? [{ state, alternative: frame.alternative, values: o.set }] : [];
  }
  const answerPicked = (ask: Ask, o: AskOption) =>
    isKept(ask, o.id) ||
    answerSubjects(ask, o).some((x) => {
      const k = markOf(x);
      return k === "main" || k === "keep";
    });
  const isPicked = (ask: Ask, id: string) => {
    const o = ask.options.find((x) => x.id === id);
    return !!o && answerPicked(ask, o);
  };
  function togglePicked(ask: Ask, o: AskOption) {
    const subjects = answerSubjects(ask, o);
    if (!subjects.length) return toggleKept(ask, o);
    if (!answerPicked(ask, o)) {
      for (const x of subjects) void setMark(x, "keep");
      return;
    }
    for (const x of subjects) if (markOf(x) !== null) void setMark(x, null);
    if (isKept(ask, o.id)) void setStanding(ask, o, "open");
  }
  // An answer stepping aside for another stays bookmarked: kept where it is on no frame.
  async function holdAnswer(ask: Ask, o: AskOption): Promise<boolean> {
    const m = design();
    if (!m || answerPicked(ask, o)) return true;
    const subjects = answerSubjects(ask, o);
    if (subjects.length) {
      const done = await Promise.all(subjects.map((x) => setMark(x, "keep")));
      return done.every(Boolean);
    }
    try {
      await api.standing(m.id, { ask: ask.id, option: o.id, to: "kept" });
      return true;
    } catch (e) {
      d.fail(e);
      return false;
    }
  }
  // Answering a question whose answers are frames bookmarks the frame, and taking the
  // answer back lets that bookmark go. Main and kept answers stay as they are.
  function followAnswer(ask: Ask, before: string[], after: string[]) {
    for (const o of ask.options) {
      if (!o.alternative) continue;
      const now = after.includes(o.id);
      if (now === before.includes(o.id)) continue;
      for (const x of answerSubjects(ask, o)) {
        const mark = viewOf(x);
        if (now && !mark) void setMark(x, "keep");
        else if (!now && mark?.kind === "keep" && !mark.answer) void setMark(x, null);
      }
    }
  }
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
        d.fail(new Error(`${o.alternative} is in use: choose another before hiding it`));
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
    if (to === "hidden" && d.drafted(ask) && answerIds(d.answerOf(ask)).includes(o.id)) {
      d.writeDraft((dr) => {
        const left = answerIds(dr.answers[ask.id]).filter((x) => x !== o.id);
        if (ask.multi && left.length) dr.answers[ask.id] = left;
        else delete dr.answers[ask.id];
        return dr;
      });
    }
    try {
      await api.standing(m.id, { ask: ask.id, option: o.id, to, ...(why ? { why } : {}) });
    } catch (e) {
      const now = design();
      if (now) setDesign({ ...now, alternatives: wasAlternatives });
      putStanding(ask, was);
      d.fail(e);
    }
  }
  // The answers a question shows, in the order the agent asked them: a mark never moves a
  // card. Hidden ones are left out (they fold away below).
  const shownOptions = (ask: Ask): AskOption[] => ask.options.filter((o) => !hiddenOf(ask, o.id));
  const hiddenOptions = (ask: Ask): AskOption[] => [
    ...ask.options.filter((o) => hiddenOf(ask, o.id)),
    ...hiddenAlternativeAnswers(ask, standingFor(ask)),
  ];
  const toggleKept = (ask: Ask, o: AskOption) =>
    void setStanding(ask, o, isKept(ask, o.id) ? "open" : "kept");
  function hideAnswer(ask: Ask, o: AskOption) {
    if (d.preview()?.key === d.optionKey(ask, o.id)) d.setPreview(null);
    void setStanding(ask, o, "hidden");
    d.leaveGhost({
      label: o.label,
      frames: o.alternative ? [{ state: d.activeState(), alternative: o.alternative }] : [],
      answer: { ask: ask.id, option: o.id },
      saveReason: (why) => void setStanding(ask, o, "hidden", why ?? undefined),
    });
  }
  const unhideAnswer = (ask: Ask, o: AskOption) => void setStanding(ask, o, "open");
  // Why an archived answer went, written or changed any time after: where its why is kept,
  // the question's standing for one hidden there, else its alternative's archive reason.
  function setAnswerWhy(ask: Ask, o: AskOption, why: string | null) {
    const m = design();
    if (!m || readonly()) return;
    if (hiddenAnswer(standingFor(ask), o.id)) {
      void setStanding(ask, o, "hidden", why ?? undefined);
      return;
    }
    if (!o.alternative) return;
    for (const state of optionStates(ask, o, m)) {
      const v = m.alternatives.find((x) => x.alternative === o.alternative && x.state === state);
      if (v && v.status === "archived") d.saveArchiveReason(o.alternative, why, state);
    }
  }

  return {
    standingFor,
    isKept,
    isPicked,
    togglePicked,
    holdAnswer,
    followAnswer,
    marks,
    markOf,
    frameMark,
    frameKnobMark,
    setMark,
    toggleKeep,
    toggleMain,
    deleteMark,
    deleteCells,
    restoreCells,
    hiddenOf,
    isCarried,
    shownOptions,
    hiddenOptions,
    hideAnswer,
    setAnswerWhy,
    unhideAnswer,
  };
}

export type Marks = ReturnType<typeof createMarks>;
