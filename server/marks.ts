// Marks: the user's picks and Main on a design's frames, saved on the click and stored with
// the design. A frame on a sheet wears a look or a knob's value, and that cell is marked
// apart from the frame as it is. Nothing is sent: an agent reads them in `read`.
// Runtime-agnostic, shared with the viewer.
//
// Two older stores still say the same kind of thing: a question's kept answers
// (standings.ts) and an alternative's archived status. Until they fold in, they are read
// beside the stored marks, and a new mark is written only here.

import { type AlternativeRow, optionStates, withAddedAnswers } from "./alternativeQuestion.ts";
import { alternativeKey, keptAlternatives } from "./standings.ts";
import {
  type Ask,
  type Author,
  builtinAsk,
  type Design,
  isLive,
  type KnobValue,
  type Mark,
  type MarkKind,
  type Post,
} from "./types.ts";

export const MAX_MARKS = 400;

// What a mark is on: a frame, as it is or in a look or in some knob values.
export type MarkSubject = Pick<Mark, "state" | "alternative" | "look" | "values">;

const sortedValues = (values: Record<string, KnobValue> | undefined) =>
  values && Object.keys(values).length
    ? Object.fromEntries(Object.entries(values).sort(([a], [b]) => (a < b ? -1 : 1)))
    : null;

// A look is the same cell whatever its values became since; values are the same cell
// whatever order they were written in.
export const subjectKey = (m: MarkSubject): string =>
  JSON.stringify([m.state, m.alternative, m.look ?? null, m.look ? null : sortedValues(m.values)]);

export const markOn = (marks: Mark[], subject: MarkSubject): Mark | undefined => {
  const key = subjectKey(subject);
  return marks.find((m) => subjectKey(m) === key);
};

// The marks with this subject's set to a kind, or cleared. A state has one Main: a new
// one leaves the last a pick.
export function withMark(
  marks: Mark[],
  subject: MarkSubject,
  kind: "pick" | "main" | null,
  by: Author,
  at: string,
): Mark[] {
  const key = subjectKey(subject);
  const rest = marks.filter((m) => subjectKey(m) !== key);
  if (kind === null) return rest;
  const others =
    kind === "main"
      ? rest.map((m) =>
          m.kind === "main" && m.state === subject.state ? { ...m, kind: "pick" as const } : m,
        )
      : rest;
  const values = subject.values && Object.keys(subject.values).length ? subject.values : undefined;
  return [
    ...others,
    {
      state: subject.state,
      alternative: subject.alternative,
      ...(subject.look ? { look: subject.look } : {}),
      ...(values ? { values } : {}),
      kind,
      at,
      by,
    },
  ];
}

// The frames a mark still has something to stand on: the alternative is in that state.
const standing = (marks: Mark[], rows: Pick<AlternativeRow, "state" | "alternative">[]) =>
  marks.filter((m) => rows.some((r) => r.state === m.state && r.alternative === m.alternative));

// The Main frame of a state, if it has one, else of any state.
export function mainOf(
  design: Pick<Design, "marks">,
  rows: Pick<AlternativeRow, "state" | "alternative" | "status">[],
  state?: string | null,
): Mark | undefined {
  const mains = standing(
    design.marks,
    rows.filter((r) => isLive(r.status)),
  ).filter((m) => m.kind === "main");
  return (state === undefined ? undefined : mains.find((m) => m.state === state)) ?? mains[0];
}

// Every frame a question keeps or the user picked, by state and name: a Send leaves them out
// of the archive, as it always has the kept ones.
export function heldAlternatives(design: Design, rows: AlternativeRow[]): Set<string> {
  const out = keptAlternatives(design, rows);
  for (const m of standing(design.marks, rows)) out.add(alternativeKey(m.state, m.alternative));
  return out;
}

// One mark as a read lists it. A kept answer reads as a pick, with the answer it is; an
// archived frame as archived, at when it left. A kept answer that sets values is not on
// any one frame.
export interface MarkView {
  kind: MarkKind;
  state: string | null;
  alternative?: string;
  look?: string;
  values?: Record<string, KnobValue>;
  at?: string;
  by?: Author;
  answer?: { ask: string; option: string; label: string };
}

type MarkRow = AlternativeRow & Partial<Pick<Post, "archivedAt">>;

// Every mark on the design: the stored ones whose frame is still live, then each kept
// answer not already marked, then each archived frame.
export function marksOf(
  design: Pick<Design, "marks" | "standings" | "asks" | "states" | "kind">,
  rows: MarkRow[],
): MarkView[] {
  const live = rows.filter((r) => isLive(r.status));
  const stored: MarkView[] = standing(design.marks, live);
  const kept: MarkView[] = [];
  for (const [askId, st] of Object.entries(design.standings)) {
    if (!st.kept.length) continue;
    const found = design.asks.find((a) => a.id === askId);
    const ask: Ask | undefined = found
      ? withAddedAnswers(found, design, rows)
      : builtinAsk(design, rows, askId);
    if (!ask || ask.scope === "part") continue;
    for (const id of st.kept) {
      const o = ask.options.find((x) => x.id === id);
      if (!o) continue;
      const answer = { ask: ask.id, option: o.id, label: o.label };
      if (o.alternative) {
        for (const state of optionStates(ask, o, design)) {
          const here = live.some((r) => r.state === state && r.alternative === o.alternative);
          const subject = { state, alternative: o.alternative };
          if (here && !markOn(design.marks, subject))
            kept.push({ kind: "pick", ...subject, answer });
        }
      } else if (o.set && Object.keys(o.set).length) {
        kept.push({ kind: "pick", state: ask.state ?? null, values: o.set, answer });
      }
    }
  }
  const archived: MarkView[] = rows
    .filter((r) => !isLive(r.status))
    .map((r) => ({
      kind: "archived" as const,
      state: r.state,
      alternative: r.alternative,
      ...(r.archivedAt ? { at: r.archivedAt } : {}),
    }));
  return [...stored, ...kept, ...archived];
}
