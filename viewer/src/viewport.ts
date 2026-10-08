// The window's size, for fitting the stage beside the panel, and the narrow
// layout (D3/§5): below 900px the panel is a bottom sheet and Tune is hidden.

import { createRoot, createSignal } from "solid-js";
import { host } from "./host.ts";

export const NARROW = 900;

const size = () => ({ w: host().window.innerWidth, h: host().window.innerHeight });

export const win = createRoot(() => {
  const [get, set] = createSignal(size());
  host().window.addEventListener("resize", () => set(size()));
  return get;
});

export const narrow = () => win().w < NARROW;
