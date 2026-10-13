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

const SHOWN: Record<Reaction, string> = { up: "👍", down: "👎", more: "More like this" };

// A comment as the thread lists it under a Send: a reaction reads as its mark.
export const commentText = (c: PartComment): string =>
  c.reaction ? `${SHOWN[c.reaction]}${c.text ? ` · ${c.text}` : ""}` : c.text;

// Where a reaction was left: its part (if any), the variant, the state.
export const reactionWhere = (c: PartComment): string =>
  [c.part, c.variant, c.state].filter(Boolean).join(" · ") || "page";
