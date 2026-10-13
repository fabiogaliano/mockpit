// One-tap reactions (like, dislike, "more like this") on a part or on a whole
// variant, for a reviewer on a phone. Pure rules; they live in the draft as
// part comments with a `reaction`, so they ride the one reply like any comment.

import type { PartComment, Reaction } from "../../server/types.ts";

export interface ReactionTarget {
  // null: the variant itself, not one of its parts.
  part: string | null;
  state: string | null;
  variant: string;
}

const sameTarget = (c: PartComment, t: ReactionTarget) =>
  !!c.reaction && c.part === t.part && c.state === t.state && c.variant === t.variant;

export const reactionOf = (comments: PartComment[], t: ReactionTarget): Reaction | null =>
  comments.find((c) => sameTarget(c, t))?.reaction ?? null;

// One reaction per target: the same tap again takes it back, another replaces it.
export function toggleReaction(
  comments: PartComment[],
  t: ReactionTarget,
  reaction: Reaction,
): PartComment[] {
  const was = reactionOf(comments, t);
  const rest = comments.filter((c) => !sameTarget(c, t));
  return was === reaction
    ? rest
    : [...rest, { part: t.part, state: t.state, text: "", reaction, variant: t.variant }];
}

export const REACTION_LABEL: Record<Reaction, string> = {
  up: "Like",
  down: "Dislike",
  more: "More like this",
};

// What the polite status line says after a tap.
export function reactionStatus(target: string, reaction: Reaction | null): string {
  if (!reaction) return `Removed your reaction to ${target}`;
  if (reaction === "more") return `Asked for more like ${target}`;
  return `${reaction === "up" ? "Liked" : "Disliked"} ${target}`;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const GAP = 8;
const EDGE = 4;
// The part's name tag sits on its top edge, or under its bottom edge when the
// part touches the top of the page (PartBoxView's `edge`).
const LABEL_H = 22;

// Where the reaction row goes for a picked part, in the overlay's px: under the
// part, else above its name tag, else inside its top edge; never past the
// overlay's sides.
export function reactionSpot(
  part: Box,
  bar: { w: number; h: number },
  overlay: { width: number; height: number },
): { left: number; top: number } {
  const below = part.y + part.h + GAP + (part.y < LABEL_H ? LABEL_H : 0);
  const above = part.y - LABEL_H - GAP - bar.h;
  const top =
    below + bar.h <= overlay.height - EDGE
      ? below
      : above >= EDGE
        ? above
        : Math.max(EDGE, part.y + GAP);
  const left = Math.max(EDGE, Math.min(part.x, overlay.width - bar.w - EDGE));
  return { left, top };
}

const SHOWN: Record<Reaction, string> = { up: "👍", down: "👎", more: "More like this" };

// A comment as the thread lists it under a Send: a reaction reads as its mark.
export const commentText = (c: PartComment): string =>
  c.reaction ? `${SHOWN[c.reaction]}${c.text ? ` · ${c.text}` : ""}` : c.text;

// Where a reaction was left: its part (if any), the variant, the state.
export const reactionWhere = (c: PartComment): string =>
  [c.part, c.variant, c.state].filter(Boolean).join(" · ") || "page";
