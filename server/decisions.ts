// What a reply decided, as the screen is built: per state, the look and each
// slot's chosen fill, with the slots inside a fill listed under it only when
// that fill was chosen; plus every other knob value the reply set. The agent
// reads "entry → skeleton → rows → shimmer" instead of reassembling it from
// option ids, and `export` composes the same choice into one screen.
// Runtime-agnostic (no node imports).

import { type SlotInfo, slotsInSurfaces } from "./fills.ts";
import type { KnobValue, Mock, Post, Reply } from "./types.ts";

export interface SlotDecision {
  fill: string;
  label?: string;
  // Set when Mix took this part from another look.
  from?: string;
  slots?: Record<string, SlotDecision>;
}

export interface StateDecision {
  variant: string;
  slots: Record<string, SlotDecision>;
}

export interface Decisions {
  // Keyed by state label; a single-state mock uses "".
  states: Record<string, StateDecision>;
  // Values the reply set (answers' knob sets, then tuning) that are not slots.
  knobs: Record<string, KnobValue>;
}

// The knob values a reply carries: each chosen option's `set`, then tuning,
// which wins, as in the viewer's resolveKnobs.
export function replyValues(
  reply: Pick<Reply, "answers" | "tuned">,
  mock: Pick<Mock, "asks">,
): Record<string, KnobValue> {
  const out: Record<string, KnobValue> = {};
  for (const ask of mock.asks) {
    const answer = reply.answers[ask.id];
    const ids = answer === undefined ? [] : Array.isArray(answer) ? answer : [answer];
    for (const id of ids) Object.assign(out, ask.options.find((o) => o.id === id)?.set ?? {});
  }
  return { ...out, ...reply.tuned };
}

// The fill each slot shows under these values: a value naming one of its
// fills, else its default.
export function chosenFills(
  slots: SlotInfo[],
  values: Record<string, KnobValue>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of slots) {
    const v = values[s.part];
    out[s.part] = typeof v === "string" && s.fills.some((f) => f.name === v) ? v : s.default;
  }
  return out;
}

// The post a state is decided by: the accepted look, else the open one.
export function postForState(posts: Post[], state: string | null): Post | undefined {
  const inState = posts.filter((p) => p.state === state);
  return (
    inState.find((p) => p.status === "accepted") ??
    inState.find((p) => p.status === "open") ??
    inState[0]
  );
}

function tree(
  slots: SlotInfo[],
  chosen: Record<string, string>,
  parent: SlotInfo["parent"],
  mix: Record<string, string>,
): Record<string, SlotDecision> {
  const out: Record<string, SlotDecision> = {};
  for (const s of slots) {
    const same = parent
      ? s.parent?.part === parent.part && s.parent.fill === parent.fill
      : s.parent === null;
    if (!same) continue;
    const fill = chosen[s.part];
    const label = s.fills.find((f) => f.name === fill)?.label;
    const inner = tree(slots, chosen, { part: s.part, fill }, mix);
    out[s.part] = {
      fill,
      ...(label ? { label } : {}),
      ...(mix[s.part] ? { from: mix[s.part] } : {}),
      ...(Object.keys(inner).length ? { slots: inner } : {}),
    };
  }
  return out;
}

// Null when the mock has no slots and the reply set no knobs: then the
// answered asks already say everything.
export function decisionsFor(
  mock: Mock,
  posts: Post[],
  reply: Pick<Reply, "answers" | "tuned" | "mix">,
): Decisions | null {
  const values = replyValues(reply, mock);
  const states: Record<string, StateDecision> = {};
  const slotPaths = new Set<string>();
  for (const state of mock.states.length ? mock.states : [null]) {
    const post = postForState(posts, state);
    if (!post) continue;
    const slots = slotsInSurfaces(post.surfaces);
    for (const s of slots) slotPaths.add(s.part);
    states[state ?? ""] = {
      variant: post.variant,
      slots: tree(slots, chosenFills(slots, values), null, reply.mix ?? {}),
    };
  }
  const knobs = Object.fromEntries(Object.entries(values).filter(([p]) => !slotPaths.has(p)));
  if (!slotPaths.size && !Object.keys(knobs).length) return null;
  return { states, knobs };
}
