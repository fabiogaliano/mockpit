// What this browser has seen of each mock: the version stamp (logic.ts
// versionStamp) it last had on screen, per project, in localStorage. Home
// marks a mock whose stamp has moved past it. No server state: it is one
// person's "since I last looked", per browser. A project's first visit marks
// nothing; everything there counts as seen from then on.

import { createSignal } from "solid-js";
import { host } from "./host.ts";

type Seen = Record<string, number>;

const key = (project: string) => `mockpit:seen:${project}`;

// Bumped on every write, so Home re-reads after a mock screen marks one seen.
const [rev, setRev] = createSignal(0);

function read(project: string): Seen | null {
  const raw = host().storage?.getItem(key(project));
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Seen) : null;
  } catch {
    return null;
  }
}

function write(project: string, seen: Seen, bump = true) {
  try {
    host().storage?.setItem(key(project), JSON.stringify(seen));
  } catch {
    // Full or locked storage: the dots just don't remember.
  }
  if (bump) setRev((n) => n + 1);
}

export function markSeen(project: string, mockId: string, stamp: number) {
  // Before Home's first visit there is nothing to mark against: that visit
  // takes everything as seen, this mock included.
  const seen = read(project);
  if (!seen || (seen[mockId] ?? -1) >= stamp) return;
  write(project, { ...seen, [mockId]: stamp });
}

// The mocks with something new since this browser last opened them. The first
// call for a project records every mock as seen and marks none.
export function unseen(project: string, mocks: { id: string; stamp: number }[]): Set<string> {
  void rev();
  if (!host().storage) return new Set();
  const seen = read(project);
  if (!seen) {
    // Read inside Home's memo: recording it must not re-run that memo.
    if (mocks.length) {
      write(project, Object.fromEntries(mocks.map((m) => [m.id, m.stamp])), false);
    }
    return new Set();
  }
  return new Set(mocks.filter((m) => m.stamp > (seen[m.id] ?? 0)).map((m) => m.id));
}
