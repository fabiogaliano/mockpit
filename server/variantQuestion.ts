// A variant question chooses which variant of a state goes in use: an agent's ask whose
// answers name variants, or the viewer's built-in Which variant?. A Send of either settles
// every live variant in the states it chooses in, so it has to show all of them: one
// choice, one question. What the agent published and never put in its question is added
// to it here, and a variant answer the user hid is an archived variant, not a second list
// that could disagree with Studio. The server and the viewer share these rules.
// Runtime-agnostic.

import {
  type AnswerStanding,
  type Ask,
  type AskOption,
  askAnswered,
  BUILTIN_ASK_ID,
  type Design,
  isLive,
  optionState,
  type PostStatus,
  type VariantStatus,
} from "./types.ts";

// A post or a variant view: all these rules need of one.
export type VariantRow = {
  state: string | null;
  variant: string;
  status: PostStatus | VariantStatus;
};

// An added answer's id: its variant's name behind a prefix no slugged id can carry, so it
// never meets one the agent's options were given.
const ADDED = "added:";
export const addedAnswerId = (variant: string) => `${ADDED}${variant}`;

export const isBuiltinAskId = (id: string): boolean =>
  id === BUILTIN_ASK_ID || id.startsWith(`${BUILTIN_ASK_ID}:`);

const scopeStates = (ask: Ask, design: Pick<Design, "states">): (string | null)[] =>
  ask.scope === "state" ? [ask.state ?? null] : design.states.length ? design.states : [null];

// The states a variant answer of this question puts in use.
export function optionStates(
  ask: Ask,
  option: AskOption,
  design: Pick<Design, "states">,
): (string | null)[] {
  if (option.version !== undefined) return [optionState(ask, design)];
  return scopeStates(ask, design);
}

const boundVariants = (ask: Ask) =>
  new Set(ask.options.flatMap((o) => (o.variant ? [o.variant] : [])));

// Where an open question of the agent's chooses a variant: the states in which one of
// its answers names a live variant. An answered one has chosen; what turns up after it
// is a new choice, the built-in's.
export function choosesIn(
  ask: Ask,
  design: Pick<Design, "states">,
  rows: VariantRow[],
): (string | null)[] {
  if (ask.scope === "part" || isBuiltinAskId(ask.id) || askAnswered(ask) || ask.dismissed) {
    return [];
  }
  const bound = boundVariants(ask);
  if (!bound.size) return [];
  return scopeStates(ask, design).filter((state) =>
    rows.some((r) => r.state === state && isLive(r.status) && bound.has(r.variant)),
  );
}

// The live variants a question chooses between and no answer of it names.
export function addedAnswers(
  ask: Ask,
  design: Pick<Design, "states">,
  rows: VariantRow[],
): AskOption[] {
  const states = choosesIn(ask, design, rows);
  if (!states.length) return [];
  const bound = boundVariants(ask);
  const names = new Set(
    rows
      .filter((r) => states.includes(r.state) && isLive(r.status) && !bound.has(r.variant))
      .map((r) => r.variant),
  );
  return [...names].map((variant) => ({
    id: addedAnswerId(variant),
    label: variant,
    variant,
    added: true,
  }));
}

// The question as the user meets it: the agent's answers, then the variants added.
export function withAddedAnswers(ask: Ask, design: Pick<Design, "states">, rows: VariantRow[]) {
  const added = addedAnswers(ask, design, rows);
  return added.length ? { ...ask, options: [...ask.options, ...added] } : ask;
}

// The variant answers the user hid that the question no longer offers: an added one
// leaves it once its variant is archived, and the agent may drop one asking again.
// They still read as hidden there, and showing one again brings its variant back.
export function hiddenVariantAnswers(ask: Ask, standing: AnswerStanding): AskOption[] {
  return standing.hidden.flatMap((h) =>
    h.variant && !ask.options.some((o) => o.id === h.id)
      ? [{ id: h.id, label: h.label, variant: h.variant }]
      : [],
  );
}

// A variant answer of an open question whose variant is archived everywhere it would go
// in use: hidden, since hiding one is archiving it. An answered question shows its
// archived answers as such, with the way back.
export function archivedAnswer(
  ask: Ask,
  option: AskOption,
  design: Pick<Design, "states">,
  rows: VariantRow[],
): boolean {
  if (!option.variant || ask.scope === "part" || askAnswered(ask)) return false;
  const states = optionStates(ask, option, design);
  const mine = rows.filter((r) => r.variant === option.variant && states.includes(r.state));
  return mine.length > 0 && !mine.some((r) => isLive(r.status));
}

// A state needs the built-in Which variant? when it has a real choice (2+ live variants)
// that no question of the agent's makes: none chooses there, and none binds every one.
export function needsBuiltinAsk(
  asks: Ask[],
  design: Pick<Design, "states">,
  rows: VariantRow[],
  state: string | null,
): boolean {
  const live = [
    ...new Set(rows.filter((r) => r.state === state && isLive(r.status)).map((r) => r.variant)),
  ];
  if (live.length < 2) return false;
  return !asks.some(
    (a) =>
      choosesIn(a, design, rows).includes(state) ||
      ((a.scope === "design" || (a.scope === "state" && a.state === state)) &&
        live.every((name) => a.options.some((o) => o.variant === name))),
  );
}
