// The window's size and input, for fitting the stage beside or above the panel.
// Layout follows what fits (panelBeside) and input follows the pointer
// (coarse), never a device guess: an iPad sends a desktop user agent.

import { createRoot, createSignal } from "solid-js";
import { host, root } from "./host.ts";
import { panelBeside } from "./logic.ts";

const size = () => ({ w: host().window.innerWidth, h: host().window.innerHeight });

export const win = createRoot(() => {
  const [get, set] = createSignal(size());
  host().window.addEventListener("resize", () => set(size()));
  return get;
});

function media(query: string) {
  return createRoot(() => {
    const mql = host().window.matchMedia?.(query);
    const [get, set] = createSignal(mql?.matches ?? false);
    mql?.addEventListener?.("change", (e) => set(e.matches));
    return get;
  });
}

// A finger, not a mouse: no hover, and the stage scrolls the page natively.
export const coarse = media("(pointer: coarse)");

// The panel does not fit beside the stage: the stage is a canvas and the
// questions float over it.
export const canvasLayout = () => !panelBeside(win().w);

// Where the canvas starts: under its header, which measures itself.
const [canvasTopSignal, setCanvasTopSignal] = createRoot(() => createSignal(96));
export const canvasTop = canvasTopSignal;
export const setCanvasTop = setCanvasTopSignal;

// The strip of the canvas a question card resting on a side takes.
const [cardInsetSignal, setCardInsetSignal] = createRoot(() =>
  createSignal(
    { left: 0, right: 0 },
    { equals: (a, b) => a.left === b.left && a.right === b.right },
  ),
);
export const cardInset = cardInsetSignal;
export const setCardInset = setCardInsetSignal;

// The left and right safe-area insets together (a notched phone held sideways):
// CSS knows them and script does not, so a hidden probe padded by them is read
// on every resize. The stage fits inside them and never sits under a notch.
let safeXSignal: (() => number) | null = null;
export function safeX(): number {
  safeXSignal ??= createRoot(() => {
    const doc = root();
    const probe = doc.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
      "padding:0 env(safe-area-inset-right) 0 env(safe-area-inset-left)";
    doc.body?.appendChild(probe);
    const read = () => {
      const cs = host().window.getComputedStyle?.(probe);
      return cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0;
    };
    const [get, set] = createSignal(read());
    host().window.addEventListener("resize", () => set(read()));
    return get;
  });
  return safeXSignal();
}
