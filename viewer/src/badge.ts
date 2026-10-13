// How many mocks owe the user answers, across the workspace, on the installed
// app's icon (`navigator.setAppBadge`, where the browser has it) and in the tab
// title. Live from the feed while the viewer is open; nothing runs once it is
// closed (no Web Push yet).

import { onCleanup } from "solid-js";
import { api, subscribe } from "./api.ts";
import { countMayChange, titleWithCount } from "./badgeRules.ts";
import { host, readonly, root } from "./host.ts";

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

  const show = (n: number) => {
    const doc = root();
    doc.title = titleWithCount(doc.title, n);
    if (n === last) return;
    last = n;
    // Rejects without notification permission on some platforms; the title still counts.
    if (n > 0) nav.setAppBadge?.(n).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  };
  const refresh = async () => {
    try {
      show((await api.allMocks()).openMocks);
    } catch {
      // Offline or signed out: keep the last count rather than guess.
    }
  };
  const soon = () => {
    win.clearTimeout(timer);
    timer = win.setTimeout(() => void refresh(), SETTLE_MS);
  };

  const stop = subscribe((e) => countMayChange(e) && soon(), soon);
  onCleanup(() => {
    stop();
    win.clearTimeout(timer);
  });
}
