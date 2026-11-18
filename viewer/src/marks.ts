// What the user has marked on the design, saved on the click and never waiting for a Send:
// the frames picked and the Main of each state (server/marks.ts), and each question's
// archived answers and those kept before picks (server/standings.ts). The screen moves at
// once, and moves back if the server refuses. The design's data is designData.ts; this
// reads and writes the marks on it.
//
// Until kept answers fold into marks, both are read: an answer is picked when its frame is
// marked or its question kept it. A new pick is written as a mark only.

import type { AnswerStanding, Ask, AskOption, HiddenAnswer } from "../../server/types.ts";
import { type MarkSubject, subjectKey } from "../../server/marks.ts";
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
  fail: (e: unknown) => void;
  asks: () => Ask[];
  activeState: () => string | null;
  // The frame a state shows, which an answer's values are picked on.
  frameIn: (state: string | null) => AlternativeView | undefined;
}

export type MarkWord = "pick" | "main";

const isFrameMark = (m: MarkView): m is MarkView & MarkSubject =>
  m.alternative !== undefined && m.kind !== "archived";

export function createMarks(d: MarkDeps) {
  const { design, setDesign } = d;
  const standingFor = (ask: Ask): AnswerStanding =>
    design()?.standings?.[ask.id] ?? { kept: [], hidden: [] };
  const isKept = (ask: Ask, id: string) => standingFor(ask).kept.includes(id);

  // --- picks and Main ---

  const marks = (): MarkView[] => design()?.marks ?? [];
  const viewOf = (subject: MarkSubject) => {
    const key = subjectKey(subject);
    return marks().find((m) => isFrameMark(m) && subjectKey(m) === key);
  };
  const markOf = (subject: MarkSubject): MarkWord | null => {
    const m = viewOf(subject);
    return m ? (m.kind as MarkWord) : null;
  };
  // A frame's mark in any of its cells: Main outranks a pick.
  const frameMark = (state: string | null, alternative: string): MarkWord | null => {
    const mine = marks().filter(
      (m) => isFrameMark(m) && m.state === state && m.alternative === alternative,
    );
    return mine.some((m) => m.kind === "main") ? "main" : mine.length ? "pick" : null;
  };
  // What the screen shows before the server answers: the subject's mark replaced, and a
  // new Main leaving the state's last one a pick, as server/marks.ts withMark does.
  const locally = (list: MarkView[], subject: MarkSubject, kind: MarkWord | null) => {
    const key = subjectKey(subject);
    const rest = list.filter((m) => !isFrameMark(m) || subjectKey(m) !== key);
    if (kind === null) return rest;
    const others =
      kind === "main"
        ? rest.map((m) =>
            m.kind === "main" && m.state === subject.state ? { ...m, kind: "pick" as const } : m,
          )
        : rest;
    return [...others, { ...subject, kind, at: new Date().toISOString(), by: "user" as const }];
  };
  async function setMark(subject: MarkSubject, kind: MarkWord | null): Promise<boolean> {
    const m = design();
    if (!m || readonly()) return false;
    const was = viewOf(subject);
    setDesign({ ...m, marks: locally(marks(), subject, kind) });
    try {
      const { marks: back } = await api.mark(m.id, { ...subject, mark: kind });
      const now = design();
      if (now) setDesign({ ...now, marks: back });
      // A pick read from a question's kept answer lives in that store: letting it go
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
  const togglePick = (subject: MarkSubject) =>
    void setMark(subject, markOf(subject) ? null : "pick");
  const toggleMain = (subject: MarkSubject) =>
    void setMark(subject, markOf(subject) === "main" ? "pick" : "main");

  // What picking an answer marks: its alternative, in each state it would be used in, or
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
    isKept(ask, o.id) || answerSubjects(ask, o).some((x) => markOf(x) !== null);
  const isPicked = (ask: Ask, id: string) => {
    const o = ask.options.find((x) => x.id === id);
    return !!o && answerPicked(ask, o);
  };
  function togglePicked(ask: Ask, o: AskOption) {
    const subjects = answerSubjects(ask, o);
    if (!subjects.length) return toggleKept(ask, o);
    if (!answerPicked(ask, o)) {
      for (const x of subjects) void setMark(x, "pick");
      return;
    }
    for (const x of subjects) if (markOf(x) !== null) void setMark(x, null);
    if (isKept(ask, o.id)) void setStanding(ask, o, "open");
  }
  // An answer stepping aside for another stays in the running: picked, or kept where it is
  // on no frame. False if that couldn't be saved.
  async function holdAnswer(ask: Ask, o: AskOption): Promise<boolean> {
    const m = design();
    if (!m || answerPicked(ask, o)) return true;
    const subjects = answerSubjects(ask, o);
    if (subjects.length) {
      const done = await Promise.all(subjects.map((x) => setMark(x, "pick")));
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
  // Answering a question whose answers are frames picks the frame, as its tick does, and
  // taking the answer back lets that pick go. Main and kept answers stay as they are.
  function followAnswer(ask: Ask, before: string[], after: string[]) {
    for (const o of ask.options) {
      if (!o.alternative) continue;
      const now = after.includes(o.id);
      if (now === before.includes(o.id)) continue;
      for (const x of answerSubjects(ask, o)) {
        const mark = viewOf(x);
        if (now && !mark) void setMark(x, "pick");
        else if (!now && mark?.kind === "pick" && !mark.answer) void setMark(x, null);
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
  // The answers a question shows, in the order it shows them: picked ones first, hidden
  // ones left out (they fold away below), the rest as the agent asked.
  const shownOptions = (ask: Ask): AskOption[] => {
    const live = ask.options.filter((o) => !hiddenOf(ask, o.id));
    return [
      ...live.filter((o) => answerPicked(ask, o)),
      ...live.filter((o) => !answerPicked(ask, o)),
    ];
  };
  const hiddenOptions = (ask: Ask): AskOption[] => [
    ...ask.options.filter((o) => hiddenOf(ask, o.id)),
    ...hiddenAlternativeAnswers(ask, standingFor(ask)),
  ];
  const toggleKept = (ask: Ask, o: AskOption) =>
    void setStanding(ask, o, isKept(ask, o.id) ? "open" : "kept");
  function hideAnswer(ask: Ask, o: AskOption) {
    if (d.preview()?.key === d.optionKey(ask, o.id)) d.setPreview(null);
    void setStanding(ask, o, "hidden");
    d.setToast({
      text: `Archived ${o.label}`,
      undo: () => {
        d.setToast(null);
        void setStanding(ask, o, "open");
      },
      reason: {
        value: null,
        save: (why) => void setStanding(ask, o, "hidden", why ?? undefined),
      },
    });
  }
  const unhideAnswer = (ask: Ask, o: AskOption) => void setStanding(ask, o, "open");

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
    setMark,
    togglePick,
    toggleMain,
    hiddenOf,
    isCarried,
    shownOptions,
    hiddenOptions,
    hideAnswer,
    unhideAnswer,
  };
}

export type Marks = ReturnType<typeof createMarks>;
