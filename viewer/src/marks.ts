// What the user has marked on the design, saved on the click and never waiting for a Send:
// each question's kept and archived answers (server/standings.ts holds the rules). The
// screen moves at once, and moves back if the server refuses. The design's data is
// designData.ts; this reads and writes the marks on it.

import type { AnswerStanding, Ask, AskOption, HiddenAnswer } from "../../server/types.ts";
import { hiddenAnswer, type StandingKind, withStanding } from "../../server/standings.ts";
import {
  archivedAnswer,
  hiddenAlternativeAnswers,
  optionStates,
} from "../../server/alternativeQuestion.ts";
import { api, type AlternativeView, type DesignDetail, type DraftInput } from "./api.ts";
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
}

export function createMarks(d: MarkDeps) {
  const { design, setDesign } = d;
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
    hiddenOf,
    isCarried,
    shownOptions,
    hiddenOptions,
    toggleKept,
    hideAnswer,
    unhideAnswer,
  };
}

export type Marks = ReturnType<typeof createMarks>;
