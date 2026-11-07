// A product design (a screen or a component) holds what ships, so nothing on it is
// chosen: no Use this, no Which alternative?, nothing in use. The newest version of each
// entry is current, and the user's one mark is Ready, which records what each state
// showed. Changed is derived from it on every read, never stored. Runtime-agnostic;
// the viewer shares these rules.

import { isProduct } from "./spec.ts";
import {
  currentVersion,
  type Design,
  type DesignReady,
  isLive,
  newestVisible,
  type Post,
  type PostStatus,
  type ReadyCover,
} from "./types.ts";

type Line = Pick<
  Post,
  | "state"
  | "alternative"
  | "status"
  | "version"
  | "acceptedVersion"
  | "hiddenVersions"
  | "stayedVersion"
> & { history: { version: number }[] };

// What an older reply put in use on a design that is now a screen or a component stays
// stored, as history, and reads as open: the design shows its newest version, and a
// alternative can't be both shipped and chosen. Copies only where changed.
export function shipped<P extends { status: PostStatus; acceptedVersion?: number }>(
  design: Pick<Design, "kind">,
  posts: P[],
): P[] {
  if (!isProduct(design) || !posts.some((p) => p.status === "accepted")) return posts;
  return posts.map((p) => {
    if (p.status !== "accepted") return p;
    const { acceptedVersion: _, ...rest } = p;
    return { ...rest, status: "open" } as P;
  });
}

const coverOf = (ready: DesignReady | null, post: Pick<Line, "state" | "alternative">) =>
  ready?.covers.find((c) => c.state === post.state && c.name === post.alternative)?.version;

// The version Ready recorded for this entry, if it recorded one.
export const readyVersion = (
  design: Pick<Design, "ready">,
  post: Pick<Line, "state" | "alternative">,
) => coverOf(design.ready, post);

// The visible version before an entry's newest: what showed until the newest came.
function previousVisible(post: Line): number | undefined {
  const hidden = new Set(post.hiddenVersions ?? []);
  const newest = newestVisible(post);
  const older = [post.version, ...post.history.map((h) => h.version)].filter(
    (v) => v < newest && !hidden.has(v),
  );
  return older.length ? Math.max(...older) : undefined;
}

// Where a product design's entry goes back to: the version marked Ready, else the one
// shown before its newest, so a new version or a use is never a one-way door.
export function backVersion(
  design: Pick<Design, "kind" | "ready">,
  post: Line,
): number | undefined {
  if (!isProduct(design)) return undefined;
  return coverOf(design.ready, post) ?? previousVisible(post);
}

// Whether the user went back from the newest and nothing newer has come. A stay records
// the newest there was then. Past the Ready version it holds over a hidden newest too;
// past an unmarked one it must name the newest exactly, or hiding the newest would send
// the entry back one more.
const stayedBack = (marked: boolean, post: Line, newest: number) =>
  marked ? (post.stayedVersion ?? 0) >= newest : post.stayedVersion === newest;

// The version an entry shows. An idea's: the one in use, else its newest. A product
// design's: its newest, unless the user went back (to the version they marked Ready,
// else to the one before) and nothing newer has come since.
export function shownVersion(design: Pick<Design, "kind" | "ready">, post: Line): number {
  if (!isProduct(design)) return currentVersion(post);
  const newest = newestVisible(post);
  const back = backVersion(design, post);
  const marked = coverOf(design.ready, post) !== undefined;
  return back !== undefined && back < newest && stayedBack(marked, post, newest) ? back : newest;
}

// On a product design: a newer version than the one Back goes to that the user hasn't
// gone back from, which the viewer offers the way back from.
export function backNewer(design: Pick<Design, "kind" | "ready">, post: Line): number | undefined {
  const back = backVersion(design, post);
  if (back === undefined) return undefined;
  const newest = newestVisible(post);
  const marked = coverOf(design.ready, post) !== undefined;
  return newest > back && !stayedBack(marked, post, newest) ? newest : undefined;
}

const stateOrder = (design: Pick<Design, "states">) =>
  design.states.length ? design.states : [null];

// What each state shows now: every live entry at its shown version, in state order.
export function shownCovers(design: Pick<Design, "kind" | "ready" | "states">, posts: Line[]) {
  const live = shipped(design, posts).filter((p) => isLive(p.status));
  return stateOrder(design).flatMap((state) =>
    live
      .filter((p) => p.state === state)
      .map((p): ReadyCover => ({ state, name: p.alternative, version: shownVersion(design, p) })),
  );
}

const coverKey = (c: ReadyCover) => `${c.state ?? ""}\n${c.name}\n${c.version}`;

// The mark as recorded, for what it records the states the design declared then.
export const readyMark = (
  design: Pick<Design, "states">,
  covers: ReadyCover[],
  at: string,
): DesignReady => ({ at, covers, states: [...design.states] });

// Marked Ready and showing something else now: another version of an entry, an entry
// the mark didn't record or one it recorded that is gone, or a state declared since,
// drawn or not. A state declared and undrawn at the mark says nothing until it is drawn.
// False again as soon as everything shown matches, so going back clears it.
export function isChanged(design: Pick<Design, "kind" | "ready" | "states">, posts: Line[]) {
  if (!design.ready || !isProduct(design)) return false;
  const declared = new Set(design.ready.states);
  if (design.states.some((s) => !declared.has(s))) return true;
  const now = shownCovers(design, posts);
  const marked = new Set(design.ready.covers.map(coverKey));
  return now.length !== marked.size || now.some((c) => !marked.has(coverKey(c)));
}

// A cover whose version history no longer holds (deleted before covers were kept, or
// its entry deleted): said, never stood in for by another version.
export type ReadyCoverView = ReadyCover & { missing?: true };
export function coverMissing(c: ReadyCover, posts: Line[]): boolean {
  const p = posts.find((x) => x.state === c.state && x.alternative === c.name);
  return !p || (p.version !== c.version && !p.history.some((h) => h.version === c.version));
}
export function readyView(
  design: Pick<Design, "ready">,
  posts: Line[],
): (Omit<DesignReady, "covers"> & { covers: ReadyCoverView[] }) | null {
  if (!design.ready) return null;
  return {
    ...design.ready,
    covers: design.ready.covers.map((c) =>
      coverMissing(c, posts) ? { ...c, missing: true as const } : c,
    ),
  };
}

// A product design's standing in a word, for its cover and for reads.
export type ReadyWord = "In design" | "Ready" | "Changed";
export function readyWord(
  design: Pick<Design, "kind" | "ready">,
  changed: boolean,
): ReadyWord | undefined {
  if (!isProduct(design)) return undefined;
  if (!design.ready) return "In design";
  return changed ? "Changed" : "Ready";
}

// A flow carries no mark of its own: it reads Ready when every step's screen is Ready,
// Changed when any is, and In design otherwise, a step with nothing drawn included.
export function flowWord(steps: { word?: ReadyWord; planned?: boolean }[]): ReadyWord {
  if (steps.some((s) => s.word === "Changed")) return "Changed";
  if (steps.length && steps.every((s) => s.word === "Ready" && !s.planned)) return "Ready";
  return "In design";
}

// The most live entries one state of a product design holds, when that is more than
// one: alternatives, which belong in an idea for it.
// A variants design's entries all ship, so it holds none to move out.
export function alternativesHeld(
  design: Pick<Design, "kind" | "states" | "variants">,
  posts: Line[],
): number {
  if (!isProduct(design) || design.variants) return 0;
  const live = posts.filter((p) => isLive(p.status));
  const most = Math.max(
    0,
    ...stateOrder(design).map((s) => live.filter((p) => p.state === s).length),
  );
  return most > 1 ? most : 0;
}

export const alternativesNudge = (design: Pick<Design, "title">, n: number) =>
  `${design.title} holds ${n} alternatives; move them to an idea for it (\`move\`), or, if they all ship, make it a variants design (\`edit --variants\`).`;

// What a product design says about its mark on every read: the mark, whether it moved,
// and whether it still holds alternatives. Nothing on an idea.
export interface ReadyFields {
  ready?: ReturnType<typeof readyView>;
  changed?: boolean;
  status?: ReadyWord;
  holdsAlternatives?: true;
  nudges?: string[];
}
export function readyFields(
  design: Pick<Design, "kind" | "ready" | "states" | "title" | "variants">,
  posts: Line[],
): ReadyFields {
  if (!isProduct(design)) return {};
  const changed = isChanged(design, posts);
  const held = alternativesHeld(design, posts);
  return {
    ready: readyView(design, posts),
    changed,
    status: readyWord(design, changed)!,
    ...(held
      ? { holdsAlternatives: true as const, nudges: [alternativesNudge(design, held)] }
      : {}),
  };
}

// A component a design is built from, as its mark stands.
export interface BuiltFrom {
  slug: string;
  ready: boolean;
  changed: boolean;
}
