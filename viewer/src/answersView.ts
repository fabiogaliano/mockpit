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
