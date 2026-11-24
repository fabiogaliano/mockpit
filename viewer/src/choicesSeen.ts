// What this browser knows of each design's choice knobs, per project, in localStorage: a
// knob is new until the user picks, keeps, rules out or compares in its group, and then it
// is known. As in seen.ts, a project's first visit marks nothing: what is there then is
// known. A design first opened after that, which changed since, has every knob new; one
// that didn't has them all known. Also kept here, per design: the groups the user folded or
// unfolded by hand, which win over the panel's own rule.

import { createSignal } from "solid-js";
import type { StillCell } from "../../server/stills.ts";
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

// Choice groups whose every value drew one picture on a frame, by design: a signature of the
// frame's version and the other knobs' values (`sameSignature`), so the group's stills aren't
// asked for again when only the mode, palette or system changes, and are once the frame
// changes or another knob's value does, which can make this one matter. Newest last, capped.
const sameKey = (design: string) => `mockpit:choices-same:${design}`;
const MAX_SAME = 200;

const sameList = (design: string): string[] => {
  const v = read<unknown>(sameKey(design));
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
};

export function knownSame(design: string, signature: string): boolean {
  void rev();
  return sameList(design).includes(signature);
}

export function setKnownSame(design: string, signature: string, same: boolean) {
  const list = sameList(design);
  if (list.includes(signature) === same) return;
  const rest = list.filter((s) => s !== signature);
  write(sameKey(design), same ? [...rest, signature].slice(-MAX_SAME) : rest);
}

// What a group's verdict is kept under: the frame as drawn, and every knob value but the
// group's own, any of which can make this knob matter. The mode, palette and system are left
// out: what a knob draws seldom hangs on them, they change often, and the panel's Check
// again asks anew.
export function sameSignature(cell: StillCell, path: string): string {
  const { [path]: _own, ...others } = cell.knobs;
  return JSON.stringify([
    cell.postId,
    cell.version,
    cell.rewrites,
    cell.e,
    cell.part,
    cell.width,
    path,
    Object.keys(others)
      .sort()
      .map((k) => [k, others[k]]),
  ]);
}
