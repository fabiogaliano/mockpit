// The window's size and input, for fitting the stage beside or above the panel.
// Layout follows what fits (panelBeside) and input follows the pointer
// (coarse), never a device guess: an iPad sends a desktop user agent.

import { createRoot, createSignal } from "solid-js";
import { host } from "./host.ts";
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

// The panel is a bottom sheet under a full-width stage.
export const sheet = () => !panelBeside(win().w);
