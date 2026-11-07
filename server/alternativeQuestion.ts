// An alternative question chooses which alternative of a state goes in use: an agent's ask whose
// answers name alternatives, or the viewer's built-in Which alternative?. A Send of either settles
// every live alternative in the states it chooses in, so it has to show all of them: one
// choice, one question. What the agent published and never put in its question is added
// to it here, and an alternative answer the user hid is an archived alternative, not a second list
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
  type AlternativeStatus,
} from "./types.ts";

// A post or an alternative view: all these rules need of one.
export type AlternativeRow = {
  state: string | null;
  alternative: string;
  status: PostStatus | AlternativeStatus;
};

// An added answer's id: its alternative's name behind a prefix no slugged id can carry, so it
// never meets one the agent's options were given.
const ADDED = "added:";
export const addedAnswerId = (alternative: string) => `${ADDED}${alternative}`;

export const isBuiltinAskId = (id: string): boolean =>
  id === BUILTIN_ASK_ID || id.startsWith(`${BUILTIN_ASK_ID}:`);

const scopeStates = (ask: Ask, design: Pick<Design, "states">): (string | null)[] =>
  ask.scope === "state" ? [ask.state ?? null] : design.states.length ? design.states : [null];

// The states an alternative answer of this question puts in use.
export function optionStates(
  ask: Ask,
  option: AskOption,
  design: Pick<Design, "states">,
): (string | null)[] {
  if (option.version !== undefined) return [optionState(ask, design)];
  return scopeStates(ask, design);
}

const boundAlternatives = (ask: Ask) =>
  new Set(ask.options.flatMap((o) => (o.alternative ? [o.alternative] : [])));

// Where an open question of the agent's chooses an alternative: the states in which one of
// its answers names a live alternative. An answered one has chosen; what turns up after it
// is a new choice, the built-in's.
export function choosesIn(
  ask: Ask,
  design: Pick<Design, "states">,
  rows: AlternativeRow[],
): (string | null)[] {
  if (ask.scope === "part" || isBuiltinAskId(ask.id) || askAnswered(ask) || ask.dismissed) {
    return [];
  }
  const bound = boundAlternatives(ask);
  if (!bound.size) return [];
  return scopeStates(ask, design).filter((state) =>
    rows.some((r) => r.state === state && isLive(r.status) && bound.has(r.alternative)),
  );
}

// The live alternatives a question chooses between and no answer of it names.
export function addedAnswers(
  ask: Ask,
  design: Pick<Design, "states">,
  rows: AlternativeRow[],
): AskOption[] {
  const states = choosesIn(ask, design, rows);
  if (!states.length) return [];
  const bound = boundAlternatives(ask);
  const names = new Set(
    rows
      .filter((r) => states.includes(r.state) && isLive(r.status) && !bound.has(r.alternative))
      .map((r) => r.alternative),
  );
  return [...names].map((alternative) => ({
    id: addedAnswerId(alternative),
    label: alternative,
    alternative,
    added: true,
  }));
}

// The question as the user meets it: the agent's answers, then the alternatives added.
export function withAddedAnswers(ask: Ask, design: Pick<Design, "states">, rows: AlternativeRow[]) {
  const added = addedAnswers(ask, design, rows);
  return added.length ? { ...ask, options: [...ask.options, ...added] } : ask;
}

// The alternative answers the user hid that the question no longer offers: an added one
// leaves it once its alternative is archived, and the agent may drop one asking again.
// They still read as hidden there, and showing one again brings its alternative back.
export function hiddenAlternativeAnswers(ask: Ask, standing: AnswerStanding): AskOption[] {
  return standing.hidden.flatMap((h) =>
    h.alternative && !ask.options.some((o) => o.id === h.id)
      ? [{ id: h.id, label: h.label, alternative: h.alternative }]
      : [],
  );
}

// An alternative answer of an open question whose alternative is archived everywhere it would go
// in use: hidden, since hiding one is archiving it. An answered question shows its
// archived answers as such, with the way back.
export function archivedAnswer(
  ask: Ask,
  option: AskOption,
  design: Pick<Design, "states">,
  rows: AlternativeRow[],
): boolean {
  if (!option.alternative || ask.scope === "part" || askAnswered(ask)) return false;
  const states = optionStates(ask, option, design);
  const mine = rows.filter((r) => r.alternative === option.alternative && states.includes(r.state));
  return mine.length > 0 && !mine.some((r) => isLive(r.status));
}

// A state of an idea needs the built-in Which alternative? when it has a real choice (2+ live
// alternatives) that no question of the agent's makes: none chooses there, and none binds
// every one.
export function needsBuiltinAsk(
  asks: Ask[],
  design: Pick<Design, "states" | "kind">,
  rows: AlternativeRow[],
  state: string | null,
): boolean {
  // A screen or a component holds what ships: its alternatives belong in an idea.
  if (design.kind !== "idea") return false;
  const live = [
    ...new Set(rows.filter((r) => r.state === state && isLive(r.status)).map((r) => r.alternative)),
  ];
  if (live.length < 2) return false;
  return !asks.some(
    (a) =>
      choosesIn(a, design, rows).includes(state) ||
      ((a.scope === "design" || (a.scope === "state" && a.state === state)) &&
        live.every((name) => a.options.some((o) => o.alternative === name))),
  );
}
