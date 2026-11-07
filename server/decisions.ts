// What a reply decided, as the state is built: per state, the alternative and the
// chosen fill of each part with fills, with the parts inside a fill listed
// under it only when that fill was chosen; plus every other knob value the
// reply set. The agent
// reads "entry → skeleton → rows → shimmer" instead of reassembling it from
// option ids, and `export` composes the same choice into one screen.
// Runtime-agnostic (no node imports).

import { type SlotInfo, slotsInSurfaces } from "./fills.ts";
import { checkKnobValue, knobFor } from "./knobs.ts";
import { shipped, shownVersion } from "./ready.ts";
import {
  inUseVersion,
  type KnobValue,
  type Design,
  type Post,
  postAtVersion,
  type Reply,
} from "./types.ts";

export interface FillDecision {
  fill: string;
  label?: string;
  // Set when the user borrowed this part from another alternative.
  borrowedFrom?: string;
  parts?: Record<string, FillDecision>;
}

export interface StateDecision {
  alternative: string;
  // Each part with fills, by part name.
  parts: Record<string, FillDecision>;
}

export interface Decisions {
  // Keyed by state label; a single-state design uses "".
  states: Record<string, StateDecision>;
  // Values the reply set (answers' knob sets, then tuning) that pick no fill.
  knobs: Record<string, KnobValue>;
}

// The knob values a reply carries: each chosen option's `set`, then tuning,
// which wins, as in the viewer's resolveKnobs.
export function replyValues(
  reply: Pick<Reply, "answers" | "tuned">,
  design: Pick<Design, "asks">,
): Record<string, KnobValue> {
  const out: Record<string, KnobValue> = {};
  for (const ask of design.asks) {
    const answer = reply.answers[ask.id];
    const ids = answer === undefined ? [] : Array.isArray(answer) ? answer : [answer];
    for (const id of ids) Object.assign(out, ask.options.find((o) => o.id === id)?.set ?? {});
  }
  return { ...out, ...reply.tuned };
}

// Every value the user has sent, oldest reply first so a later answer or tune
// replaces an earlier one. Values the knobs declared now can't hold drop out:
// the agent may have renamed or narrowed a knob since.
export function settledValues(
  replies: Pick<Reply, "answers" | "tuned">[],
  design: Pick<Design, "asks" | "knobs">,
  posts: (Pick<Post, "knobs"> & { surfaces?: Post["surfaces"] })[],
): Record<string, KnobValue> {
  const all: Record<string, KnobValue> = {};
  for (const r of replies) Object.assign(all, replyValues(r, design));
  const out: Record<string, KnobValue> = {};
  for (const [path, value] of Object.entries(all)) {
    const config = knobFor(path, design, posts);
    const checked = config === undefined ? null : checkKnobValue(path, config, value);
    if (checked?.ok) out[path] = checked.value;
  }
  return out;
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

// The post a state is decided by: the accepted look at its version in use,
// else the open one. A screen or a component has nothing in use: its first live
// entry, at the version it shows.
export function postForState(
  posts: Post[],
  state: string | null,
  design?: Pick<Design, "kind" | "ready">,
): Post | undefined {
  const inState = (design ? shipped(design, posts) : posts).filter((p) => p.state === state);
  const post =
    inState.find((p) => p.status === "accepted") ??
    inState.find((p) => p.status === "open") ??
    inState[0];
  if (!post) return undefined;
  const product = design && design.kind !== "idea";
  return postAtVersion(post, product ? shownVersion(design, post) : inUseVersion(post)) ?? post;
}

function tree(
  slots: SlotInfo[],
  chosen: Record<string, string>,
  parent: SlotInfo["parent"],
  borrowed: Record<string, string>,
): Record<string, FillDecision> {
  const out: Record<string, FillDecision> = {};
  for (const s of slots) {
    const same = parent
      ? s.parent?.part === parent.part && s.parent.fill === parent.fill
      : s.parent === null;
    if (!same) continue;
    const fill = chosen[s.part];
    const label = s.fills.find((f) => f.name === fill)?.label;
    const inner = tree(slots, chosen, { part: s.part, fill }, borrowed);
    out[s.part] = {
      fill,
      ...(label ? { label } : {}),
      ...(borrowed[s.part] ? { borrowedFrom: borrowed[s.part] } : {}),
      ...(Object.keys(inner).length ? { parts: inner } : {}),
    };
  }
  return out;
}

// Null when the design has no fills and the reply set no knobs: then the
// answered asks already say everything.
export function decisionsFor(
  design: Design,
  posts: Post[],
  reply: Pick<Reply, "answers" | "tuned" | "borrowed">,
): Decisions | null {
  const values = replyValues(reply, design);
  const states: Record<string, StateDecision> = {};
  const slotPaths = new Set<string>();
  for (const state of design.states.length ? design.states : [null]) {
    const post = postForState(posts, state, design);
    if (!post) continue;
    const slots = slotsInSurfaces(post.surfaces);
    for (const s of slots) slotPaths.add(s.part);
    states[state ?? ""] = {
      alternative: post.alternative,
      parts: tree(slots, chosenFills(slots, values), null, reply.borrowed ?? {}),
    };
  }
  const knobs = Object.fromEntries(Object.entries(values).filter(([p]) => !slotPaths.has(p)));
  if (!slotPaths.size && !Object.keys(knobs).length) return null;
  return { states, knobs };
}
