// What Focus has on screen: the state and the alternative chosen on each, what a pointer
// previews, the question, the part picked, pointed at, tapped or flashed, the canvas tool,
// the panel, and the part open in Tune. One store, so what is on screen is one thing to
// read and to move, rather than signals that each part of the screen keeps in step by hand.
//
// Each field reads and writes like the signal it replaced. Objects come back unwrapped: a
// preview's knob values are posted to frames, and a store proxy can't be cloned.

import { createStore, unwrap } from "solid-js/store";
import type { KnobValue } from "../../server/types.ts";

// The canvas's tools: Try hands taps to the design, Mark leaves a comment
// where you tap, Tune outlines the parts and opens one's knobs.
export type Tool = "try" | "mark" | "tune";
// The bottom panel, opened from the version label.
export type PanelTab = "history" | "thread" | "spec";

// What the stage shows while the pointer rests on an option: another alternative,
// or knob values sent live to the frame on stage.
export interface Preview {
  key: string;
  // An option's words, for saying what the stage is showing.
  label?: string;
  alternative?: string;
  // A version option: exactly that version of the alternative.
  version?: number;
  state?: string | null;
  knobs?: Record<string, KnobValue>;
  // An answer that chooses a palette of the project's system.
  palette?: string;
  // A Mix borrow: the part outlined on the donor look while it previews.
  part?: string;
}

interface OnScreen {
  state: string | null;
  // The alternative chosen by hand on each state, by String(state).
  chosen: Record<string, string>;
  hovered: Preview | null;
  held: Preview | null;
  // The question on the state on stage, by its place there.
  cur: number;
  // The part picked on the stage, open in Instances' Tune; null is the page.
  selectedPart: string | null;
  hoverPart: string | null;
  // The part whose knobs are open in Instances (null is the page's own knobs), or false
  // with none open.
  tuneOpen: string | null | false;
  // A part tapped on the canvas, outlined and offered reactions until the question
  // moves on.
  tapped: string | null;
  // The part an answer just changed, outlined for a moment, and "entry · skeleton" when
  // it is a slot and the swap is known.
  flash: string | null;
  flashLabel: string | null;
  tool: Tool | null;
  panel: PanelTab | null;
}

type Field<K extends keyof OnScreen> = readonly [() => OnScreen[K], (v: OnScreen[K]) => void];

export function createOnScreen() {
  const [view, setView] = createStore<OnScreen>({
    state: null,
    chosen: {},
    hovered: null,
    held: null,
    cur: 0,
    selectedPart: null,
    hoverPart: null,
    tuneOpen: false,
    tapped: null,
    flash: null,
    flashLabel: null,
    tool: null,
    panel: null,
  });
  // Written as a top-level merge, which replaces the field: a nested object set by path
  // would be merged into the old one instead.
  const field = <K extends keyof OnScreen>(k: K): Field<K> => [
    () => unwrap(view[k]),
    (v) => setView({ [k]: v } as Pick<OnScreen, K>),
  ];
  return {
    state: field("state"),
    chosen: field("chosen"),
    hovered: field("hovered"),
    held: field("held"),
    cur: field("cur"),
    selectedPart: field("selectedPart"),
    hoverPart: field("hoverPart"),
    tuneOpen: field("tuneOpen"),
    tapped: field("tapped"),
    flash: field("flash"),
    flashLabel: field("flashLabel"),
    tool: field("tool"),
    panel: field("panel"),
  };
}
