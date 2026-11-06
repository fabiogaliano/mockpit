// A product design (a screen or a component) holds what ships, so nothing on it is
// chosen: no Use this, no Which variant?, nothing in use. The newest version of each
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
  | "variant"
  | "status"
  | "version"
  | "acceptedVersion"
  | "hiddenVersions"
  | "stayedVersion"
> & { history: { version: number }[] };

// What an older reply put in use on a design that is now a screen or a component stays
// stored, as history, and reads as open: the design shows its newest version, and a
// variant can't be both shipped and chosen. Copies only where changed.
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

const coverOf = (ready: DesignReady | null, post: Pick<Line, "state" | "variant">) =>
  ready?.covers.find((c) => c.state === post.state && c.name === post.variant)?.version;

// The version Ready recorded for this entry, if it recorded one.
export const readyVersion = (
  design: Pick<Design, "ready">,
  post: Pick<Line, "state" | "variant">,
) => coverOf(design.ready, post);

// The version an entry shows. An idea's: the one in use, else its newest. A product
// design's: its newest, unless the user went back to the version they marked Ready
// (a stay, at the newest there was then) and nothing newer has come since.
export function shownVersion(design: Pick<Design, "kind" | "ready">, post: Line): number {
  if (!isProduct(design)) return currentVersion(post);
  const newest = newestVisible(post);
  const back = coverOf(design.ready, post);
  return back !== undefined && back < newest && (post.stayedVersion ?? 0) >= newest ? back : newest;
}

// On a product design marked Ready: a newer version than the marked one that the user
// hasn't gone back from, which the viewer offers the way back to.
export function readyNewer(design: Pick<Design, "kind" | "ready">, post: Line): number | undefined {
  if (!isProduct(design)) return undefined;
  const back = coverOf(design.ready, post);
  const newest = newestVisible(post);
  return back !== undefined && newest > Math.max(back, post.stayedVersion ?? 0)
    ? newest
    : undefined;
}

const stateOrder = (design: Pick<Design, "states">) =>
  design.states.length ? design.states : [null];

// What each state shows now: every live entry at its shown version, in state order.
export function shownCovers(design: Pick<Design, "kind" | "ready" | "states">, posts: Line[]) {
  const live = shipped(design, posts).filter((p) => isLive(p.status));
  return stateOrder(design).flatMap((state) =>
    live
      .filter((p) => p.state === state)
      .map((p): ReadyCover => ({ state, name: p.variant, version: shownVersion(design, p) })),
  );
}

const coverKey = (c: ReadyCover) => `${c.state ?? ""}\n${c.name}\n${c.version}`;

// Marked Ready and showing something else now: another version of an entry, an entry
// or a state the mark didn't record, or one it recorded that is gone. False again as
// soon as everything shown matches, so going back clears it.
export function isChanged(design: Pick<Design, "kind" | "ready" | "states">, posts: Line[]) {
  if (!design.ready || !isProduct(design)) return false;
  const now = shownCovers(design, posts);
  const marked = new Set(design.ready.covers.map(coverKey));
  return now.length !== marked.size || now.some((c) => !marked.has(coverKey(c)));
}

// A product design's standing in a word, for its cover and for reads.
export type ReadyWord = "in design" | "Ready" | "Changed";
export function readyWord(
  design: Pick<Design, "kind" | "ready">,
  changed: boolean,
): ReadyWord | undefined {
  if (!isProduct(design)) return undefined;
  if (!design.ready) return "in design";
  return changed ? "Changed" : "Ready";
}

// The most live entries one state of a product design holds, when that is more than
// one: alternatives, which belong in an idea for it.
export function alternativesHeld(design: Pick<Design, "kind" | "states">, posts: Line[]): number {
  if (!isProduct(design)) return 0;
  const live = posts.filter((p) => isLive(p.status));
  const most = Math.max(
    0,
    ...stateOrder(design).map((s) => live.filter((p) => p.state === s).length),
  );
  return most > 1 ? most : 0;
}

export const alternativesNudge = (design: Pick<Design, "title">, n: number) =>
  `${design.title} holds ${n} alternatives; move them to an idea for it (\`move\`).`;

// What a product design says about its mark on every read: the mark, whether it moved,
// and whether it still holds alternatives. Nothing on an idea.
export interface ReadyFields {
  ready?: DesignReady | null;
  changed?: boolean;
  status?: ReadyWord;
  holdsAlternatives?: true;
  nudges?: string[];
}
export function readyFields(
  design: Pick<Design, "kind" | "ready" | "states" | "title">,
  posts: Line[],
): ReadyFields {
  if (!isProduct(design)) return {};
  const changed = isChanged(design, posts);
  const held = alternativesHeld(design, posts);
  return {
    ready: design.ready,
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
