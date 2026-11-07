// What an idea is for. An idea explores for a screen or a component (`for`), or would
// become one, a flow or a system change once used (`becomes`). Using an alternative of an
// idea that is for a design copies the version in use onto that design, state by state,
// when the states match; what the design has already turned down is handed to whoever
// explores for it. Runtime-agnostic (no node imports).

import type { DecisionLine } from "./decisionLog.ts";
import {
  type ApplyTo,
  type Design,
  isLive,
  type PostHead,
  type RuledOut,
  slugify,
} from "./types.ts";

const tokens = (text: string) => slugify(text).split("-").filter(Boolean);

// Whether `inner`'s words appear, in order and together, among `outer`'s.
function holds(outer: string[], inner: string[]): boolean {
  if (!inner.length || inner.length > outer.length) return false;
  for (let i = 0; i + inner.length <= outer.length; i++) {
    if (inner.every((t, j) => outer[i + j] === t)) return true;
  }
  return false;
}

// "Onni lab" is named like "Onni": the design's slug or title is in the idea's.
export function namedLike(idea: Pick<Design, "slug" | "title">, product: Design): boolean {
  const ideaNames = [tokens(idea.slug), tokens(idea.title)];
  const productNames = [tokens(product.slug), tokens(product.title)];
  return ideaNames.some((o) => productNames.some((i) => holds(o, i)));
}

// The same code path, or one inside the other.
export function sameSource(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const x = a.replace(/\/+$/, "");
  const y = b.replace(/\/+$/, "");
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

// The product design an idea that says nothing of what it is for most looks like it is
// for: in its own area by code path, then by name, then by name anywhere in the project.
// A guess for a nudge, never stored.
export function likelyTarget(idea: Design, designs: Design[]): Design | null {
  if (idea.kind !== "idea" || idea.for || idea.becomes) return null;
  const products = designs.filter((d) => d.kind !== "idea" && !d.archivedAt && d.id !== idea.id);
  const here = products.filter((d) => !!idea.area && d.area === idea.area);
  return (
    here.find((d) => sameSource(idea.source, d.source)) ??
    here.find((d) => namedLike(idea, d)) ??
    products.find((d) => namedLike(idea, d)) ??
    null
  );
}

export const forNudge = (idea: Design, target: Design) =>
  `${idea.title} looks like it is for ${target.title}: \`edit ${idea.slug} --for ${target.slug}\` (or --becomes screen, component, flow or system)`;

// An idea's standing in a word, the same for the agent, the tree and the area page.
export function ideaStatus(
  posts: Pick<PostHead, "status">[],
  open: number,
  target?: Pick<Design, "title"> | null,
): string {
  if (open) return `${open} question${open === 1 ? "" : "s"}`;
  if (posts.some((p) => p.status === "accepted"))
    return target ? `in use in ${target.title}` : "in use";
  return "exploring";
}

// Which states an alternative put in use would land in on the design an idea is for:
// every state the idea draws it in must be one the design has, else nothing is copied.
export function statesFor(
  idea: Pick<Design, "states">,
  posts: Pick<PostHead, "state" | "alternative" | "status">[],
  used: { state: string | null; alternative: string }[],
  target: Pick<Design, "slug" | "states">,
): ApplyTo["states"] {
  const names = new Set(used.map((u) => u.alternative));
  const drawn = new Set<string | null>(used.map((u) => u.state));
  for (const p of posts) if (names.has(p.alternative) && isLive(p.status)) drawn.add(p.state);
  const order: (string | null)[] = idea.states.length ? idea.states : [null];
  const states = [
    ...order.filter((s) => drawn.has(s)),
    ...[...drawn].filter((s) => !order.includes(s)),
  ];
  const has: (string | null)[] = target.states.length ? target.states : [null];
  return {
    matched: states.filter((s) => has.includes(s)),
    missing: states.filter((s) => !has.includes(s)),
  };
}

const MAX_RULED_OUT = 40;

// What a design has turned down, newest first: its archived alternatives with their
// reasons, the answers the user hid on it with their why, and its decisions' "Not:".
export function ruledOutOf(
  target: Design,
  posts: Pick<PostHead, "alternative" | "status" | "archiveReason" | "archivedAt">[],
  lines: DecisionLine[],
): { ruledOut: RuledOut[]; more?: number } {
  const byName = new Map<string, RuledOut>();
  for (const p of posts) {
    if (p.status !== "archived") continue;
    const was = byName.get(p.alternative);
    const when = p.archivedAt ?? undefined;
    if (was && (was.when ?? "") >= (when ?? "")) continue;
    byName.set(p.alternative, {
      name: p.alternative,
      ...(p.archiveReason
        ? { reason: p.archiveReason }
        : was?.reason
          ? { reason: was.reason }
          : {}),
      ...(when ? { when } : {}),
    });
  }
  const out = [...byName.values()];
  for (const standing of Object.values(target.standings)) {
    for (const h of standing.hidden) {
      // Hiding an alternative's answer archived the alternative: one entry, with the why.
      const same = h.alternative ? byName.get(h.alternative) : undefined;
      if (same) {
        if (!same.reason && h.why) same.reason = h.why;
        continue;
      }
      out.push({ name: h.label, ...(h.why ? { reason: h.why } : {}) });
    }
  }
  for (const l of lines) {
    if (l.design !== target.slug || !l.parts?.not) continue;
    const chose = l.parts.chose ? ` ${l.parts.chose}.` : "";
    out.push({
      name: l.parts.not,
      reason: `${l.parts.asked}${chose}`,
      ...(l.at ? { when: l.at } : {}),
    });
  }
  out.sort((a, b) => (b.when ?? "").localeCompare(a.when ?? ""));
  return out.length > MAX_RULED_OUT
    ? { ruledOut: out.slice(0, MAX_RULED_OUT), more: out.length - MAX_RULED_OUT }
    : { ruledOut: out };
}
