// Pictures or a list for a question's answers. One person's way of reading, so it is
// remembered per browser and holds across questions.

import { createSignal } from "solid-js";
import { host } from "./host.ts";

export type AnswersView = "grid" | "list";

const KEY = "mockpit:answers-view";
const [chosen, setChosen] = createSignal<AnswersView | null>(null);

export const answersView = (): AnswersView =>
  chosen() ?? (host().storage?.getItem(KEY) === "grid" ? "grid" : "list");

export function setAnswersView(view: AnswersView) {
  setChosen(view);
  host().storage?.setItem(KEY, view);
}

// The same choice for the alternatives beside the design, kept apart: a list of three reads
// well where three answers want their pictures.
const ALTS_KEY = "mockpit:alternatives-view";
const [altsChosen, setAltsChosen] = createSignal<AnswersView | null>(null);

export const alternativesView = (): AnswersView =>
  altsChosen() ?? (host().storage?.getItem(ALTS_KEY) === "grid" ? "grid" : "list");

export function setAlternativesView(view: AnswersView) {
  setAltsChosen(view);
  host().storage?.setItem(ALTS_KEY, view);
}
