// The window's size and input, for fitting the canvas. Layout follows what
// fits and input follows the pointer (coarse), never a device guess: an iPad
// sends a desktop user agent.

import { createRoot, createSignal } from "solid-js";
import { host, root } from "./host.ts";

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

// Too narrow for anything to sit beside the design: it reads as one page
// fitted to the width, the drawers are sheets from the bottom, and a swipe
// across it moves between steps. One scroll and one zoom, so a finger never
// has to guess which layer it moves.
export const PHONE_W = 640;
export const phoneLayout = () => win().w <= PHONE_W;

// Where the canvas starts: under the top bar and the flow bar, which measure themselves.
const [canvasTopSignal, setCanvasTopSignal] = createRoot(() => createSignal(96));
export const canvasTop = canvasTopSignal;
export const setCanvasTop = setCanvasTopSignal;

// The bands of the canvas taken by what floats over it: on a phone the bottom bar
// and the question card below; elsewhere the tool strip and the neighbouring steps
// at the sides.
export interface CardInset {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export const NO_INSET: CardInset = { left: 0, right: 0, top: 0, bottom: 0 };
const [cardInsetSignal, setCardInsetSignal] = createRoot(() =>
  createSignal<CardInset>(NO_INSET, {
    equals: (a, b) =>
      a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom,
  }),
);
export const cardInset = cardInsetSignal;
export const setCardInset = setCardInsetSignal;

// What the open screen's margins take from the canvas: the bands they stand in,
// and how much further it pans so nothing stays stuck under a margin floating
// over it.
export interface CanvasBox {
  left: number;
  right: number;
  over: number;
}
export const NO_BOX: CanvasBox = { left: 0, right: 0, over: 0 };
const [canvasBoxSignal, setCanvasBoxSignal] = createRoot(() =>
  createSignal<CanvasBox>(NO_BOX, {
    equals: (a, b) => a.left === b.left && a.right === b.right && a.over === b.over,
  }),
);
export const canvasBox = canvasBoxSignal;
export const setCanvasBox = setCanvasBoxSignal;

// Where the artboards start on screen as the canvas pans, for what stands beside
// them. Null where no canvas is showing.
export interface DesignAt {
  left: number;
  top: number;
  // The live artboard's right edge, which is what its version's actions line up with.
  right: number;
}
const [designAtSignal, setDesignAtSignal] = createRoot(() =>
  createSignal<DesignAt | null>(null, {
    equals: (a, b) => a?.left === b?.left && a?.top === b?.top && a?.right === b?.right,
  }),
);
export const designAt = designAtSignal;
export const setDesignAt = setDesignAtSignal;

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
