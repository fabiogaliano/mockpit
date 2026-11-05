// Kept and hidden answers: the rules the server and the viewer share. A standing
// belongs to a question by id, so it outlives the agent asking that question again,
// and to an answer by id, remapped when a re-ask renames it. Runtime-agnostic.

import {
  type AnswerStanding,
  type Ask,
  type AskOption,
  builtinAsk,
  type Design,
  type HiddenAnswer,
  optionState,
  type Post,
} from "./types.ts";

export const MAX_WHY = 300;
export const MAX_SETS = 12;

export type StandingKind = "kept" | "hidden" | "open";

const EMPTY: AnswerStanding = { kept: [], hidden: [] };

export const standingOf = (design: Pick<Design, "standings">, askId: string): AnswerStanding =>
  design.standings[askId] ?? EMPTY;

export const isEmptyStanding = (s: AnswerStanding) =>
  !s.kept.length && !s.hidden.length && !s.carried?.length;

export const hiddenAnswer = (s: AnswerStanding, id: string): HiddenAnswer | undefined =>
  s.hidden.find((h) => h.id === id);

// One answer moved to kept, hidden or neither. Kept and hidden exclude each other, and
// an answer that stops being kept stops being carried.
export function withStanding(
  s: AnswerStanding,
  option: Pick<AskOption, "id" | "label">,
  to: StandingKind,
  why?: string,
): AnswerStanding {
  const kept = s.kept.filter((id) => id !== option.id);
  const hidden = s.hidden.filter((h) => h.id !== option.id);
  const carried = (s.carried ?? []).filter((id) => id !== option.id || to === "kept");
  const since = { ...s.since };
  if (to !== "kept") delete since[option.id];
  if (to === "kept") kept.push(option.id);
  if (to === "hidden") hidden.push({ id: option.id, label: option.label, ...(why ? { why } : {}) });
  return {
    kept,
    hidden,
    ...(carried.length ? { carried } : {}),
    ...(Object.keys(since).length ? { since } : {}),
    unsent: true,
  };
}

const sameSet = (a: AskOption, b: AskOption) =>
  !!a.set && !!b.set && JSON.stringify(a.set) === JSON.stringify(b.set);

// The answer in a re-asked question that is the same one under another id: the same
// variant and version, the same values, else the same words.
function sameAnswer(old: AskOption, next: AskOption[]): AskOption | undefined {
  return (
    next.find((o) => o.id === old.id) ??
    next.find((o) => !!old.variant && o.variant === old.variant && o.version === old.version) ??
    next.find((o) => sameSet(o, old)) ??
    next.find((o) => o.label.trim().toLowerCase() === old.label.trim().toLowerCase())
  );
}

// A standing carried across a re-ask. A kept answer the agent dropped can't be shown
// any more, so it goes; a hidden one stays, by its label, so it is still not offered.
export function remapStanding(
  s: AnswerStanding,
  before: Ask | undefined,
  after: Ask,
): AnswerStanding {
  const move = (id: string) => {
    const was = before?.options.find((o) => o.id === id);
    return was
      ? sameAnswer(was, after.options)?.id
      : after.options.some((o) => o.id === id)
        ? id
        : undefined;
  };
  const kept = s.kept.flatMap((id) => move(id) ?? []);
  const carried = (s.carried ?? []).flatMap((id) => move(id) ?? []);
  const hidden = s.hidden.map((h) => ({ ...h, id: move(h.id) ?? h.id }));
  const since = Object.fromEntries(
    Object.entries(s.since ?? {}).flatMap(([id, at]) => (move(id) ? [[move(id)!, at]] : [])),
  );
  return {
    kept: [...new Set(kept)],
    hidden,
    ...(carried.length ? { carried: [...new Set(carried)] } : {}),
    ...(Object.keys(since).length ? { since } : {}),
    ...(s.unsent ? { unsent: true as const } : {}),
  };
}

// The answers a re-ask offers again that the user hid: they stay folded away.
export function reoffered(s: AnswerStanding, ask: Ask): HiddenAnswer[] {
  return s.hidden.filter((h) => ask.options.some((o) => o.id === h.id));
}

// The states a variant answer of this question puts in use.
export function optionStates(
  ask: Ask,
  option: AskOption,
  design: Pick<Design, "states">,
): (string | null)[] {
  if (option.version !== undefined) return [optionState(ask, design)];
  if (ask.scope === "state") return [ask.state ?? null];
  return design.states.length ? design.states : [null];
}

const variantKey = (state: string | null, variant: string) => `${state ?? ""}\n${variant}`;

// Every variant some question keeps, by state and name: Send leaves them out of the
// archive and `read` marks them kept.
export function keptVariants(
  design: Design,
  posts: Pick<Post, "state" | "variant">[],
): Set<string> {
  const out = new Set<string>();
  for (const [askId, s] of Object.entries(design.standings)) {
    if (!s.kept.length) continue;
    const ask = design.asks.find((a) => a.id === askId) ?? builtinAsk(design, posts, askId);
    if (!ask || ask.scope === "part") continue;
    for (const id of s.kept) {
      const o = ask.options.find((x) => x.id === id);
      if (!o?.variant) continue;
      for (const state of optionStates(ask, o, design)) out.add(variantKey(state, o.variant));
    }
  }
  return out;
}

export const isKeptVariant = (kept: Set<string>, p: Pick<Post, "state" | "variant">) =>
  kept.has(variantKey(p.state, p.variant));

// A standing as the agent reads it: answers by label, each with its id.
export interface StandingView {
  kept?: { id: string; label: string }[];
  hidden?: HiddenAnswer[];
  carried?: { id: string; label: string }[];
}

export function standingView(ask: Ask, s: AnswerStanding): StandingView | undefined {
  const named = (ids: string[]) =>
    ids.flatMap((id) => {
      const o = ask.options.find((x) => x.id === id);
      return o ? [{ id, label: o.label }] : [];
    });
  const kept = named(s.kept.filter((id) => !answered(ask).includes(id)));
  const carried = named(s.carried ?? []);
  if (!kept.length && !s.hidden.length && !carried.length) return undefined;
  return {
    ...(kept.length ? { kept } : {}),
    ...(s.hidden.length ? { hidden: s.hidden } : {}),
    ...(carried.length ? { carried } : {}),
  };
}

const answered = (ask: Ask): string[] =>
  ask.answer === undefined ? [] : Array.isArray(ask.answer) ? ask.answer : [ask.answer];
