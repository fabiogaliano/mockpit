// What's left to design on one page of the Board, an area: each of its screens and
// components down, every state across, and each cell Ready, In design, Planned or
// Missing. `read --area` and the Board both read it from here, so an agent and the user
// see the same map. Runtime-agnostic; the viewer shares the owed states.

import { isChanged, readyWord, type ReadyWord, shipped, shownCovers } from "./ready.ts";
import { isProduct } from "./spec.ts";
import {
  type Design,
  type FlowStep,
  isLive,
  openAsks,
  type PostHead,
  type StateOutline,
} from "./types.ts";

// Ready: marked Ready, and the state still shows what the mark recorded. In design:
// drawn. Planned: declared, nothing drawn. Missing: a standard state a drawn screen is
// owed, which nobody dismissed. A design without the state has no cell (null).
export type Cell = "Ready" | "In design" | "Planned" | "Missing";
export const CELLS: readonly Cell[] = ["Ready", "In design", "Planned", "Missing"];

// The standard states a screen is expected to have, and what already counts as each:
// an agent that drew "Error" or "No results" has drawn it, whatever it called it.
const STANDARD_STATES: { name: string; covered: RegExp }[] = [
  { name: "Empty", covered: /\b(empty|blank|no (results|data|items))\b/i },
  { name: "Loading", covered: /\b(loading|skeleton)\b/i },
  { name: "Failed", covered: /\b(fail(ed|ure)?|errors?|offline|couldn.t)\b/i },
];

export interface StateOutlineRow {
  name: string;
  // Already asked for: it waits on the agent, not on the user.
  requested: boolean;
}

// What a screen that can be outlined is still owed: the standard states it lacks and
// nobody dismissed, and any other the user asked for.
export function owedStates(design: {
  states: string[];
  stateOutlines?: Record<string, StateOutline>;
}): StateOutlineRow[] {
  const said = design.stateOutlines ?? {};
  const has = (name: string) =>
    design.states.some((st) => st.toLowerCase().includes(name.toLowerCase()));
  const standard = STANDARD_STATES.filter(
    (x) => said[x.name] !== "dismissed" && !design.states.some((st) => x.covered.test(st)),
  ).map((x) => ({ name: x.name, requested: said[x.name] === "requested" }));
  const asked = Object.entries(said)
    .filter(
      ([name, to]) =>
        to === "requested" && !STANDARD_STATES.some((x) => x.name === name) && !has(name),
    )
    .map(([name]) => ({ name, requested: true }));
  return [...standard, ...asked];
}

// Only a screen with a page drawn is owed states: on an idea, a document or a component
// they would be noise, and on a plan the whole screen is still to draw.
export const outlinable = (
  design: Pick<Design, "kind">,
  posts: { status: PostHead["status"]; surfaces: { kind: string }[] }[],
): boolean =>
  design.kind === "screen" &&
  posts.some((p) => isLive(p.status) && p.surfaces.some((s) => s.kind === "html"));

// The designs a page counts: its area's screens and components, or, for the page of
// screens no area claims, those. `live` is already without what left the shelves. Screens
// first, then by name: the store lists the newest work first, and a map whose rows moved
// with every publish or mark couldn't be read twice the same way.
function pageDesigns(live: Design[], area: string | null): Design[] {
  return live
    .filter(
      (d) => isProduct(d) && (area === null ? !d.area && d.kind === "screen" : d.area === area),
    )
    .toSorted(
      (a, b) =>
        Number(a.kind !== "screen") - Number(b.kind !== "screen") || a.title.localeCompare(b.title),
    );
}

const statesOf = (d: Pick<Design, "states">) => (d.states.length ? d.states : [null]);

// Ready per state, not per design: a state drawn again since the mark is back in design
// while the rest of the screen stays Ready.
function cellOf(design: Design, posts: PostHead[], state: string | null): Cell {
  if (!posts.some((p) => p.state === state)) return "Planned";
  if (!design.ready) return "In design";
  const key = (c: { name: string; version: number }) => `${c.name}\n${c.version}`;
  const now = shownCovers(design, posts)
    .filter((c) => c.state === state)
    .map(key);
  const marked = new Set(design.ready.covers.filter((c) => c.state === state).map(key));
  return now.length > 0 && now.length === marked.size && now.every((k) => marked.has(k))
    ? "Ready"
    : "In design";
}

const wordOf = (design: Design, posts: PostHead[]): ReadyWord =>
  readyWord(design, isChanged(design, posts)) ?? "In design";

// "3/7": a page's designs marked Ready, of all of them, for the rail.
export function pageReady(input: {
  area: string | null;
  live: Design[];
  heads: Map<string, PostHead[]>;
}): { ready: number; of: number } {
  const own = pageDesigns(input.live, input.area);
  return {
    ready: own.filter((d) => wordOf(d, shipped(d, input.heads.get(d.id) ?? [])) === "Ready").length,
    of: own.length,
  };
}

export interface CoverageRow {
  slug: string;
  title: string;
  kind: Design["kind"];
  status: ReadyWord;
  // One per column of `states`, null where the design has no such state.
  cells: (Cell | null)[];
}

export interface Coverage {
  // The columns: every state a design here has or is owed, in the order the designs give
  // them; null, a design's one unnamed state, last.
  states: (string | null)[];
  designs: CoverageRow[];
  // Each flow with a step here: how many of its steps are Ready.
  flows: { name: string; ready: number; steps: number }[];
  ready: number;
  of: number;
  missing: number;
  planned: number;
  questions: number;
}

export function coverageOf(input: {
  area: string | null;
  live: Design[];
  heads: Map<string, PostHead[]>;
  flows: { name: string; steps: FlowStep[] }[];
}): Coverage {
  const posts = (d: Design) => shipped(d, input.heads.get(d.id) ?? []);
  const own = pageDesigns(input.live, input.area);
  const rows = own.map((d) => {
    const ps = posts(d);
    const owed = outlinable(d, ps) ? owedStates(d).map((o) => o.name) : [];
    const cells = new Map<string | null, Cell>([
      ...statesOf(d).map((s): [string | null, Cell] => [s, cellOf(d, ps, s)]),
      ...owed.map((n): [string, Cell] => [n, "Missing"]),
    ]);
    return { d, status: wordOf(d, ps), cells };
  });
  const named = [...new Set(rows.flatMap((r) => [...r.cells.keys()]))].filter(
    (s): s is string => s !== null,
  );
  const states = rows.some((r) => r.cells.has(null)) ? [...named, null] : named;

  // A step on a design of another page reads that design's cell.
  const bySlug = new Map(input.live.map((d) => [d.slug, d]));
  const ownSlugs = new Set(own.map((d) => d.slug));
  const stepReady = (x: FlowStep) => {
    const d = bySlug.get(x.design);
    return !!d && isProduct(d) && cellOf(d, posts(d), x.state) === "Ready";
  };
  const flows = input.flows
    .filter((f) => f.steps.some((x) => ownSlugs.has(x.design)))
    .map((f) => ({
      name: f.name,
      ready: f.steps.filter(stepReady).length,
      steps: f.steps.length,
    }));

  const count = (c: Cell) =>
    rows.reduce((n, r) => n + [...r.cells.values()].filter((x) => x === c).length, 0);
  return {
    states,
    designs: rows.map((r) => ({
      slug: r.d.slug,
      title: r.d.title,
      kind: r.d.kind,
      status: r.status,
      cells: states.map((s) => r.cells.get(s) ?? null),
    })),
    flows,
    ready: rows.filter((r) => r.status === "Ready").length,
    of: rows.length,
    missing: count("Missing"),
    planned: count("Planned"),
    questions: own.reduce((n, d) => n + openAsks(d).length, 0),
  };
}

// The page's coverage in one line, a number and its words per part, as the Board's card
// and `read --area` both say it: "0 of 7 ready · 3 missing · 1 question".
export function coverageSummary(c: Coverage): { n: number; text: string; missing?: true }[] {
  return [
    { n: c.ready, text: ` of ${c.of} ready` },
    ...(c.missing ? [{ n: c.missing, text: " missing", missing: true as const }] : []),
    ...(c.planned ? [{ n: c.planned, text: " planned" }] : []),
    { n: c.questions, text: c.questions === 1 ? " question" : " questions" },
  ];
}

export const flowLine = (f: { ready: number; steps: number }) =>
  `${f.ready} of ${f.steps} step${f.steps === 1 ? "" : "s"} ready`;

// The same map as text, for an agent: a header of states, a line per design, a column per
// state, "-" where a design has no such state.
export function coverageText(c: Coverage) {
  const head = (s: string | null) => s ?? "single state";
  const name = Math.max(0, ...c.designs.map((d) => d.title.length));
  const widths = c.states.map((s, i) =>
    Math.max(head(s).length, ...c.designs.map((d) => (d.cells[i] ?? "-").length)),
  );
  const line = (first: string, cols: string[]) =>
    [first.padEnd(name), ...cols.map((x, i) => x.padEnd(widths[i]!))].join(" | ").trimEnd();
  return {
    summary: coverageSummary(c)
      .map((p) => `${p.n}${p.text}`)
      .join(" · "),
    legend:
      "Ready: marked Ready, showing what was marked · In design: drawn · Planned: declared, not drawn · Missing: a standard state the screen is owed, not drawn · -: no such state",
    map: c.states.length
      ? [
          line("", c.states.map(head)),
          ...c.designs.map((d) =>
            line(
              d.title,
              d.cells.map((x) => x ?? "-"),
            ),
          ),
        ]
      : [],
    flows: c.flows.map((f) => `${f.name}: ${flowLine(f)}`),
  };
}
