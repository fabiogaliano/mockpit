// One answer at a time on the design, or every answer side by side on the canvas.
// Kept per design in this browser: a palette is weighed side by side, a wording on
// the design itself, and the same person comes back to each the way they left it.

import { createSignal } from "solid-js";
import { host } from "./host.ts";

export type AnswersLayout = "one" | "side";

const key = (design: string) => `mockpit:answers-layout:${design}`;
const [chosen, setChosen] = createSignal<Record<string, AnswersLayout>>({});

export const answersLayout = (design: string): AnswersLayout =>
  chosen()[design] ?? (host().storage?.getItem(key(design)) === "side" ? "side" : "one");

export function setAnswersLayout(design: string, layout: AnswersLayout) {
  setChosen({ ...chosen(), [design]: layout });
  host().storage?.setItem(key(design), layout);
}

// The question last laid out in the row, so that a Send leaves its row where it was
// rather than moving on with the card. For this visit only: a reload starts from the
// open question.
const [rowFor, setRowForSignal] = createSignal<Record<string, string | undefined>>({});
export const rowAskFor = (design: string): string | undefined => rowFor()[design];
export const setRowAskFor = (design: string, ask: string | undefined) =>
  setRowForSignal({ ...rowFor(), [design]: ask });
