// Marks: the user's Main, Keep (bookmarked backup), and Deleted (tombstone) marks on a
// design's frames and sheet cells, saved on the click and stored with the design. A frame
// on a sheet wears a look or a knob's value, and that cell is marked apart from the frame
// as it is. Nothing is sent: an agent reads them in `read`.
// Runtime-agnostic, shared with the viewer.

import { type AlternativeRow, optionStates, withAddedAnswers } from "./alternativeQuestion.ts";
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
  type StoredMarkKind,
} from "./types.ts";

export const MAX_MARKS = 400;

// What a mark is on: a frame, as it is or in a look or in some knob values.
export type MarkSubject = Pick<Mark, "state" | "alternative" | "look" | "values">;

// Legacy workspaces stored "pick" before the Main/Keep/Delete lifecycle; normalize cleanly.
export function normalizeMarkKind(kind: unknown): StoredMarkKind | null {
  if (kind === "main" || kind === "keep" || kind === "deleted") return kind;
  if (kind === "pick") return "keep";
  return null;
}

export function normalizeMarks(raw: unknown): Mark[] {
  if (!Array.isArray(raw)) return [];
  const out: Mark[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    const kind = normalizeMarkKind(m.kind);
    if (!kind || typeof m.alternative !== "string") continue;
    out.push({
      state: typeof m.state === "string" ? m.state : null,
      alternative: m.alternative,
      ...(typeof m.look === "string" && m.look ? { look: m.look } : {}),
      ...(m.values && typeof m.values === "object" && Object.keys(m.values).length
        ? { values: m.values as Record<string, KnobValue> }
        : {}),
      kind,
      at: typeof m.at === "string" ? m.at : "",
      by: m.by === "agent" ? "agent" : "user",
    });
  }
  return out;
}

const sortedValues = (values: Record<string, KnobValue> | undefined) =>
  values && Object.keys(values).length
    ? Object.fromEntries(Object.entries(values).sort(([a], [b]) => (a < b ? -1 : 1)))
    : null;

// A look is the same cell whatever its values became since; values are the same cell
// whatever order they were written in.
export const subjectKey = (m: MarkSubject): string =>
  JSON.stringify([m.state, m.alternative, m.look ?? null, m.look ? null : sortedValues(m.values)]);

// The exclusivity slot for `main`:
// - A knob cell (`values` without `look`) competes only within `(state, alternative, knobKeys)`,
//   so each frame can accumulate its own ★ Main across multiple knobs (e.g. glyphs + colour).
// - A look cell competes within `(state, alternative)`.
// - A bare frame competes within `state` on Alternatives ideas, or only with itself on a Set.
export function mainSlotKey(m: MarkSubject, isSet = false): string {
  if (m.look) return JSON.stringify(["look", m.state, m.alternative]);
  const keys = m.values ? Object.keys(m.values).sort() : [];
  if (keys.length) return JSON.stringify(["knob", m.state, m.alternative, keys]);
  return isSet
    ? JSON.stringify(["frame", m.state, m.alternative])
    : JSON.stringify(["state", m.state]);
}

export const markOn = (marks: Mark[], subject: MarkSubject): Mark | undefined => {
  const key = subjectKey(subject);
  return marks.find((m) => subjectKey(m) === key);
};

// The marks with this subject's set to a kind, or cleared.
// Main replaces only another Main in the same slot (leaving it neutral, never silently
// bookmarking it). Keep and Deleted replace only this exact subject.
export function withMark(
  marks: Mark[],
  subject: MarkSubject,
  kind: StoredMarkKind | null,
  by: Author,
  at: string,
  opts: { isSet?: boolean } = {},
): Mark[] {
  const key = subjectKey(subject);
  const rest = marks.filter((m) => subjectKey(m) !== key);
  if (kind === null) return rest;
  const slot = kind === "main" ? mainSlotKey(subject, !!opts.isSet) : null;
  const others =
    slot !== null
      ? rest.filter((m) => !(m.kind === "main" && mainSlotKey(m, !!opts.isSet) === slot))
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

// Accumulated ★ Main knob values on a single frame across all knobs (oldest first so newer
// marks win on any overlapping knob path).
export function mainValuesFor(
  marks: {
    state: string | null;
    alternative?: string;
    kind: string;
    values?: Record<string, KnobValue>;
    at?: string;
  }[],
  state: string | null,
  alternative: string,
): Record<string, KnobValue> {
  const mine = marks
    .filter(
      (m) =>
        m.kind === "main" &&
        m.state === state &&
        m.alternative === alternative &&
        m.values &&
        Object.keys(m.values).length > 0,
    )
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  const merged: Record<string, KnobValue> = {};
  for (const m of mine) Object.assign(merged, m.values);
  return merged;
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

// One mark as a read lists it. A kept answer reads as keep, with the answer it is; an
// archived frame as archived, at when it left.
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
            kept.push({ kind: "keep", ...subject, answer });
        }
      } else if (o.set && Object.keys(o.set).length) {
        kept.push({ kind: "keep", state: ask.state ?? null, values: o.set, answer });
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

// One frame resolved for Use: grouped per (state, alternative) with its accumulated
// ★ Main knob values (Q1 combo) and optional look name.
export interface FrameUsePick {
  kind: "main";
  state: string | null;
  alternative: string;
  main?: true;
  look?: string;
  values?: Record<string, KnobValue>;
}

// The frames a Use would put in use:
// - On a Set (`isSet: true`), every live frame ships (Q2 all-with-main), each wearing its
//   accumulated ★ Main knob values where chosen (defaults otherwise).
// - On an Alternatives idea (`isSet: false`), every frame with a ★ Main mark, grouped per
//   frame so multiple knob ★ Main marks combine into one entry wearing all chosen knobs.
export function framePicks(
  marks: MarkView[],
  opts: { isSet?: boolean; rows?: AlternativeRow[] } = {},
): FrameUsePick[] {
  const mains = marks.filter(
    (m): m is MarkView & { alternative: string; kind: "main" } =>
      m.kind === "main" && m.alternative !== undefined,
  );
  const forFrame = (state: string | null, alternative: string): FrameUsePick => {
    const mine = mains.filter((m) => m.state === state && m.alternative === alternative);
    const values = mainValuesFor(
      mine.map((m) => ({
        state: m.state,
        alternative: m.alternative,
        kind: "main" as const,
        values: m.values,
        at: m.at ?? "",
      })),
      state,
      alternative,
    );
    const look = mine.find((m) => m.look)?.look;
    return {
      kind: "main",
      state,
      alternative,
      ...(mine.length ? { main: true as const } : {}),
      ...(look ? { look } : {}),
      ...(Object.keys(values).length ? { values } : {}),
    };
  };
  if (opts.isSet && opts.rows) {
    const live = opts.rows.filter((r) => isLive(r.status));
    return live.map((r) => forFrame(r.state, r.alternative));
  }
  const seen = new Set<string>();
  const out: FrameUsePick[] = [];
  for (const m of mains) {
    const k = JSON.stringify([m.state, m.alternative]);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(forFrame(m.state, m.alternative));
  }
  return out;
}

// A pick as a Use compares it with the last: the frame, what it wears, and whether it is Main.
export const pickKey = (p: {
  state: string | null;
  alternative: string;
  look?: string;
  values?: Record<string, KnobValue>;
  main?: boolean;
}): string =>
  JSON.stringify([
    subjectKey({ state: p.state, alternative: p.alternative, look: p.look, values: p.values }),
    !!p.main,
  ]);

// Whether the picks (or set items + their ★ Main combos) have moved since the last Use.
export function changedSinceUse(
  used: {
    state: string | null;
    alternative: string;
    look?: string;
    values?: Record<string, KnobValue>;
    main?: true;
  }[],
  marks: MarkView[],
  opts: { isSet?: boolean; rows?: AlternativeRow[] } = {},
): boolean {
  const now = new Set(framePicks(marks, opts).map((m) => pickKey({ ...m, main: !!m.main })));
  const then = new Set(used.map(pickKey));
  return now.size !== then.size || [...now].some((k) => !then.has(k));
}
