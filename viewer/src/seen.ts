// What this browser has had on screen of each alternative: the version it last showed, per
// project, in localStorage. An alternative past it has changed since the user was here: the
// Board dots its frame and counts it in "Since you were here", and its cover says New.
// Focus offers the version seen before to compare with. No server state: it is one person's
// "since I last looked", per browser. A project's first visit marks nothing; everything there
// counts as seen from then on.

import { createSignal } from "solid-js";
import { host } from "./host.ts";

// By alternative (its post id): the version last on screen, and `was`, what Focus last
// showed of it when only the Board's still has been seen since. Picking a changed frame on
// the Board clears its dot, and opening it after still compares with what came before.
type Mark = { v: number; was?: number };
export type Seen = Record<string, Mark>;

const key = (project: string) => `mockpit:seen-versions:${project}`;

// Bumped on every write, so the Board and Home re-read after Focus marks one seen.
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

// The project's record, reactive. Its first read, given every alternative in the project,
// records them all as seen, so a first visit shows nothing changed; an alternative missing
// from the record after that is one made since.
export function seenIn(project: string, all: { post: string; version: number }[]): Seen | null {
  void rev();
  if (!host().storage) return null;
  const seen = read(project);
  if (seen || !all.length) return seen;
  const first: Seen = Object.fromEntries(all.map((x) => [x.post, { v: x.version }]));
  // Read inside a memo: recording it must not re-run that memo.
  write(project, first, false);
  return first;
}

// The one version rule for "seen" and "changed": the version an alternative's frame and its
// cover show (in use, else the Board's and the cover's after a stay or a Ready mark), never
// a newer one they don't, or a cover would say New after the frame was seen.
export const versionShown = (v: {
  version: number;
  coverVersion?: number;
  inUseVersion?: number;
}): number => v.inUseVersion ?? v.coverVersion ?? v.version;

export const changedSince = (seen: Seen | null, post: string, version: number): boolean =>
  !!seen && version > (seen[post]?.v ?? 0);

// The version of an alternative to compare `version` with: the one this browser last had on
// screen, or before a still glanced at on the Board, the one Focus last showed. Undefined
// when there is none older (or the project was never visited).
export function sawBefore(project: string, post: string, version: number): number | undefined {
  const mark = read(project)?.[post];
  if (!mark) return undefined;
  return mark.v < version ? mark.v : mark.was;
}

// `focus`: shown live in Focus, which settles what was seen; the Board's still keeps what
// came before it for Focus to compare with.
export function markSeen(project: string, post: string, version: number, focus = false) {
  // Before the project's first visit there is nothing to mark against: that visit takes
  // everything as seen, this one included.
  const seen = read(project);
  if (!seen) return;
  const mark = seen[post];
  if (mark && (mark.v > version || (mark.v === version && (!focus || mark.was === undefined))))
    return;
  const was = focus ? undefined : (mark?.was ?? mark?.v);
  write(project, { ...seen, [post]: { v: version, ...(was === undefined ? {} : { was }) } });
}
