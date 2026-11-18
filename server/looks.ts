// Looks: named sets of knob values, the way one frame's tune travels to another frame
// or another design with the same knobs. Runtime-agnostic, shared with the viewer.

import { checkKnobValue, checkKnobValues, knobFor } from "./knobs.ts";
import type { Author, Design, KnobValue, Knobs, Look, Post } from "./types.ts";

export const MAX_LOOKS = 40;
export const MAX_LOOK_NAME = 60;

// A look as a read shows it: where it is stored, by slug, so the same name on two
// designs stays two looks.
export type LookView = Look & { design: string };

type KnobHolders = (Pick<Post, "knobs"> & { surfaces?: Post["surfaces"] })[];

// What an agent's publish (or the user's save) names: look name → knob path → value,
// keyed as knobs are. Each value is checked against the knobs declared now.
export function checkLooks(
  raw: unknown,
  knobs: Knobs,
  posts: KnobHolders,
): { ok: true; value: Record<string, Record<string, KnobValue>> } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "looks must be an object of look name → {knob path: value}" };
  }
  const out: Record<string, Record<string, KnobValue>> = {};
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_LOOKS) return { ok: false, error: `at most ${MAX_LOOKS} looks` };
  for (const [rawName, values] of entries) {
    const name = rawName.replace(/\0/g, "").trim();
    if (!name || name.length > MAX_LOOK_NAME) {
      return { ok: false, error: `a look's name is 1 to ${MAX_LOOK_NAME} characters` };
    }
    const checked = checkKnobValues(values, { knobs }, posts, `look "${name}"`);
    if (!checked.ok) return checked;
    if (!Object.keys(checked.value).length) {
      return { ok: false, error: `look "${name}" sets no knob` };
    }
    out[name] = checked.value;
  }
  return { ok: true, value: out };
}

// The design's looks with these written in, by name. An agent never replaces a look the
// user made: those names come back in `kept`.
export function withLooks(
  looks: Look[],
  given: Record<string, Record<string, KnobValue>>,
  author: Author,
  at: string,
): { looks: Look[]; kept: string[] } | { error: string } {
  const out = [...looks];
  const kept: string[] = [];
  for (const [name, values] of Object.entries(given)) {
    const i = out.findIndex((l) => l.name === name);
    if (i >= 0 && author === "agent" && out[i].author === "user") {
      kept.push(name);
      continue;
    }
    const look: Look = { name, values, author, at };
    if (i >= 0) out[i] = look;
    else out.push(look);
  }
  if (out.length > MAX_LOOKS) return { error: `a design holds at most ${MAX_LOOKS} looks` };
  return { looks: out, kept };
}

// Whether a design declares every knob a look sets, with a value it can hold.
export function fits(
  look: Pick<Look, "values">,
  design: Pick<Design, "knobs">,
  posts: KnobHolders,
): boolean {
  return Object.entries(look.values).every(([path, value]) => {
    const config = knobFor(path, design, posts);
    return config !== undefined && checkKnobValue(path, config, value).ok;
  });
}

// Every look a read of this design shows: its own, then those stored on the project's
// other designs that it declares every knob of.
export function looksFor(
  design: Pick<Design, "id" | "slug" | "knobs" | "looks">,
  posts: KnobHolders,
  others: { designId: string; slug: string; looks: Look[] }[],
): LookView[] {
  const own = design.looks.map((l) => ({ ...l, design: design.slug }));
  const offered = others.flatMap((o) =>
    o.designId === design.id
      ? []
      : o.looks.filter((l) => fits(l, design, posts)).map((l) => ({ ...l, design: o.slug })),
  );
  return [...own, ...offered];
}
