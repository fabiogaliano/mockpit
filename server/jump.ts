// Search to jump: find a mock by anything the user might remember it by, its
// title, a state, a variant's name or note, a question, or its area. It reads
// what `listJumpRows` hands it, which never includes surfaces, so a big
// workspace costs its metadata and not its pages. This project comes first, then
// the others. Runtime-agnostic (no node imports).

import { isLive, openAsks, type JumpRows, type MockKind } from "./types.ts";

export type JumpMatch = "title" | "state" | "variant" | "area" | "question" | "note";

export interface JumpHit {
  project: string;
  // Null for an area, which is a place on Home and not a mock.
  id: string | null;
  slug: string | null;
  title: string;
  kind: MockKind | null;
  width: number | null;
  area: string | null;
  match: JumpMatch;
  // What matched, clipped around the words, when it isn't the title.
  text: string | null;
  state: string | null;
  variant: string | null;
  archived: boolean;
  open: number;
  closed: boolean;
  inUse: boolean;
}

const MAX_HERE = 20;
const MAX_ELSEWHERE = 12;
// A mock whose variants all carry the word shouldn't push every other mock off the list.
const MAX_PER_MOCK = 3;
const SNIPPET = 90;

// Precision before recall: what a mock is called beats what was once said about it.
const RANK = {
  exact: 0,
  prefix: 1,
  word: 2,
  title: 3,
  state: 4,
  variant: 5,
  area: 6,
  question: 7,
  note: 8,
} as const;

// "Cafe" finds "Café", and "food" finds "Food".
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function clip(text: string, term: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= SNIPPET) return flat;
  const at = Math.max(0, fold(flat).indexOf(term));
  const start = at < SNIPPET / 3 ? 0 : at - Math.floor(SNIPPET / 3);
  const cut = flat.slice(start, start + SNIPPET).trim();
  return `${start > 0 ? "…" : ""}${cut}${start + SNIPPET < flat.length ? "…" : ""}`;
}

interface Ranked {
  hit: JumpHit;
  rank: number;
  updatedAt: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function allHits(rows: JumpRows, terms: string[], whole: string): Ranked[] {
  const byMock = new Map<string, JumpRows["variants"]>();
  for (const v of rows.variants) {
    const list = byMock.get(v.mockId);
    if (list) list.push(v);
    else byMock.set(v.mockId, [v]);
  }
  const has = (text: string) => {
    const f = fold(text);
    return terms.every((t) => f.includes(t));
  };
  const out: Ranked[] = [];
  const areasSeen = new Set<string>();
  for (const m of rows.mocks) {
    const variants = byMock.get(m.id) ?? [];
    const base = {
      project: m.project,
      id: m.id,
      slug: m.slug,
      title: m.title,
      kind: m.kind,
      width: m.widths[0] ?? null,
      area: m.area,
      open: openAsks(m).length,
      closed: !!m.closedAt,
      inUse: variants.some((v) => v.status === "accepted"),
      text: null,
      state: null,
      variant: null,
      archived: false,
    };
    const mine: Ranked[] = [];
    const add = (rank: number, match: JumpMatch, extra: Partial<JumpHit> = {}) =>
      mine.push({ hit: { ...base, match, ...extra }, rank, updatedAt: m.updatedAt });
    const title = fold(m.title);
    if (title === whole) add(RANK.exact, "title");
    else if (title.startsWith(whole)) add(RANK.prefix, "title");
    else if (terms.every((t) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(t)}`, "u").test(title)))
      add(RANK.word, "title");
    else if (has(m.title) || has(m.slug)) add(RANK.title, "title");
    for (const state of m.states) {
      if (has(state)) add(RANK.state, "state", { text: state, state });
    }
    const namesSeen = new Set<string>();
    for (const v of variants) {
      const gone = !isLive(v.status);
      const tail = gone ? 0.5 : 0;
      // A variant named "default" says nothing the mock's title doesn't.
      if (v.variant !== "default" && !namesSeen.has(v.variant) && has(v.variant)) {
        namesSeen.add(v.variant);
        add(RANK.variant + tail, "variant", {
          text: v.variant,
          state: v.state,
          variant: v.variant,
          archived: gone,
        });
      }
      if (v.note && has(v.note)) {
        add(RANK.note + tail, "note", {
          text: clip(v.note, terms[0]),
          state: v.state,
          variant: v.variant,
          archived: gone,
        });
      }
    }
    for (const ask of m.asks) {
      if (has(ask.text)) {
        add(RANK.question, "question", {
          text: clip(ask.text, terms[0]),
          state: ask.state ?? null,
        });
      }
    }
    mine.sort((a, b) => a.rank - b.rank);
    out.push(...mine.slice(0, MAX_PER_MOCK));
    if (m.area && has(m.area) && !areasSeen.has(`${m.project}\n${m.area}`)) {
      areasSeen.add(`${m.project}\n${m.area}`);
      out.push({
        hit: {
          ...base,
          id: null,
          slug: null,
          title: m.area,
          kind: null,
          width: null,
          match: "area",
          open: 0,
          closed: false,
          inUse: false,
        },
        rank: RANK.area,
        updatedAt: m.updatedAt,
      });
    }
  }
  return out;
}

export function jumpHits(rows: JumpRows, query: string, project: string | null): JumpHit[] {
  const whole = fold(query).trim().replace(/\s+/g, " ");
  const terms = whole.split(" ").filter(Boolean);
  if (!terms.length) return [];
  const order = (a: Ranked, b: Ranked) => a.rank - b.rank || b.updatedAt.localeCompare(a.updatedAt);
  const all = allHits(rows, terms, whole);
  const here = all.filter((h) => h.hit.project === project).sort(order);
  const elsewhere = all.filter((h) => h.hit.project !== project).sort(order);
  return [...here.slice(0, MAX_HERE), ...elsewhere.slice(0, MAX_ELSEWHERE)].map((h) => h.hit);
}

// The mocks this browser opened last, in that order, as they are called now: a
// renamed one follows, and a deleted one drops out.
export function recentHits(rows: JumpRows, ids: string[]): JumpHit[] {
  const wanted = new Map(ids.map((id, i) => [id, i]));
  const inUse = new Set(rows.variants.filter((v) => v.status === "accepted").map((v) => v.mockId));
  return rows.mocks
    .filter((m) => wanted.has(m.id))
    .sort((a, b) => wanted.get(a.id)! - wanted.get(b.id)!)
    .map((m) => ({
      project: m.project,
      id: m.id,
      slug: m.slug,
      title: m.title,
      kind: m.kind,
      width: m.widths[0] ?? null,
      area: m.area,
      match: "title" as const,
      text: null,
      state: null,
      variant: null,
      archived: false,
      open: openAsks(m).length,
      closed: !!m.closedAt,
      inUse: inUse.has(m.id),
    }));
}
