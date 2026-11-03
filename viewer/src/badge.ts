// How many questions wait on the user: across the workspace on the installed
// app's icon (`navigator.setAppBadge`, where the browser has it), and for the
// project on screen in the tab title, which sits beside that project's page and
// should say what the page says. Live from the feed while the viewer is open;
// nothing runs once it is closed (no Web Push yet).

import { createEffect, on, onCleanup } from "solid-js";
import { api, subscribe } from "./api.ts";
import { countMayChange, titleWithCount } from "./badgeRules.ts";
import { host, readonly, root } from "./host.ts";
import { route } from "./route.ts";

type BadgeNavigator = Navigator & {
  setAppBadge?: (n?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

// A burst of events (a Send flips several variants) costs one fetch.
const SETTLE_MS = 300;

export function startBadge() {
  // A public read-only viewer owes nothing to anyone.
  if (readonly()) return;
  const win = host().window;
  const nav = win.navigator as BadgeNavigator;
  let last: number | null = null;
  let timer = 0;

  const show = (here: number, everywhere: number) => {
    const doc = root();
    doc.title = titleWithCount(doc.title, here);
    if (everywhere === last) return;
    last = everywhere;
    // Rejects without notification permission on some platforms; the title still counts.
    if (everywhere > 0) nav.setAppBadge?.(everywhere).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  };
  const onScreen = () => {
    const r = route();
    return r.screen === "missing" ? null : r.project;
  };
  const refresh = async () => {
    try {
      const projects = await api.projects();
      // No project in the address is the most recent one, as on Home.
      const here = projects.find((p) => p.name === onScreen()) ?? projects[0];
      show(
        here?.open ?? 0,
        projects.reduce((n, p) => n + p.open, 0),
      );
    } catch {
      // Offline or signed out: keep the last count rather than guess.
    }
  };
  const soon = () => {
    win.clearTimeout(timer);
    timer = win.setTimeout(() => void refresh(), SETTLE_MS);
  };

  const stop = subscribe((e) => countMayChange(e) && soon(), soon);
  createEffect(on(onScreen, soon, { defer: true }));
  onCleanup(() => {
    stop();
    win.clearTimeout(timer);
  });
}
