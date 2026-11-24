// What this browser knows of each design's choice knobs, per project, in localStorage: a
// knob is new until the user picks, keeps, rules out or compares in its group, and then it
// is known. As in seen.ts, a project's first visit marks nothing: what is there then is
// known. A design first opened after that, which changed since, has every knob new; one
// that didn't has them all known. Also kept here, per design: the groups the user folded or
// unfolded by hand, which win over the panel's own rule.

import { createSignal } from "solid-js";
import { host } from "./host.ts";

interface Known {
  // When the project was first visited here.
  since: string;
  // By design id: the knob paths known.
  designs: Record<string, string[]>;
}

const knownKey = (project: string) => `mockpit:choices-known:${project}`;
const foldKey = (design: string) => `mockpit:choices-open:${design}`;

// Bumped on every write, so whatever reads the record reads it again.
const [rev, setRev] = createSignal(0);

function read<T>(key: string): T | null {
  const raw = host().storage?.getItem(key);
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" ? (v as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown, bump = true) {
  try {
    host().storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Full or locked storage: nothing is remembered, and nothing breaks.
  }
  if (bump) setRev((n) => n + 1);
}

// The knob paths known on a design, reactive. Without storage nothing is new. `changedAt` is
// the design's newest write, which says whether its knobs came after the first visit.
export function knownChoices(
  project: string,
  design: string,
  present: string[],
  changedAt: string,
): Set<string> {
  void rev();
  if (!host().storage) return new Set(present);
  const known = read<Known>(knownKey(project));
  // Read inside a memo: recording them must not run that memo again.
  if (!known) {
    write(
      knownKey(project),
      { since: new Date().toISOString(), designs: { [design]: present } },
      false,
    );
    return new Set(present);
  }
  const mine = known.designs?.[design];
  if (mine) return new Set(mine);
  const first = changedAt > known.since ? [] : present;
  write(knownKey(project), { ...known, designs: { ...known.designs, [design]: first } }, false);
  return new Set(first);
}

export function markChoiceKnown(project: string, design: string, path: string) {
  const known = read<Known>(knownKey(project));
  if (!known) return;
  const mine = known.designs?.[design] ?? [];
  if (mine.includes(path)) return;
  write(knownKey(project), { ...known, designs: { ...known.designs, [design]: [...mine, path] } });
}

// The groups folded or unfolded by hand on a design: open is true.
export function ownFolds(design: string): Record<string, boolean> {
  void rev();
  return read<Record<string, boolean>>(foldKey(design)) ?? {};
}

export function setOwnFold(design: string, group: string, open: boolean) {
  write(foldKey(design), { ...read<Record<string, boolean>>(foldKey(design)), [group]: open });
}
