// Dark and light (D9). The tokens live in styles.css under [data-theme]; this
// module only decides which one is on. localStorage gives the first paint (the
// inline script in index.html reads it before any CSS), the workspace setting
// is the source of truth across devices.

import { createSignal } from "solid-js";
import { api } from "./api.ts";
import { host, root } from "./host.ts";

export type Theme = "dark" | "light";
const KEY = "mockpit-theme";

const initial = (): Theme => (root().documentElement.dataset.theme === "light" ? "light" : "dark");
const [theme, setThemeSignal] = createSignal<Theme>(initial());
export { theme };

let fadeTimer = 0;

function apply(next: Theme, fade: boolean) {
  const el = root().documentElement;
  if (fade) {
    // Transitions only during the switch, so hovers and drags keep their own timing.
    el.classList.add("theming");
    host().window.clearTimeout(fadeTimer);
    fadeTimer = host().window.setTimeout(() => el.classList.remove("theming"), 200);
  }
  el.dataset.theme = next;
  try {
    host().storage?.setItem(KEY, next);
  } catch {
    // Quota or privacy mode: the server copy still persists the choice.
  }
  setThemeSignal(next);
}

export function setTheme(next: Theme, opts: { persist?: boolean; fade?: boolean } = {}) {
  if (next === theme() && root().documentElement.dataset.theme === next) return;
  apply(next, opts.fade ?? true);
  if (opts.persist) api.putTheme(next).catch(() => {});
}

export const toggleTheme = () => setTheme(theme() === "dark" ? "light" : "dark", { persist: true });

export async function syncTheme() {
  try {
    const { mode } = await api.theme();
    setTheme(mode === "light" ? "light" : "dark", { fade: false });
  } catch {
    // Offline or read-only: keep what localStorage painted.
  }
}
