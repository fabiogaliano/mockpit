// Browser notifications while a viewer tab is open (no service worker, no Web
// Push): the bell's state, the permission request behind it, and the feed
// listener that raises one Notification per mock when the user is elsewhere.

import { createEffect, createSignal, onCleanup } from "solid-js";
import { api, subscribe } from "./api.ts";
import { host, root } from "./host.ts";
import {
  away,
  bellState,
  type Candidate,
  candidateFor,
  createBatcher,
  mergeNotices,
  type Notice,
  noticeFromComment,
  noticeFromVariant,
  notificationText,
  parseBellPref,
} from "./notifyRules.ts";
import { mockPath, navigate } from "./route.ts";

const KEY = "mockpit-notify";

const ctor = (): typeof Notification | undefined =>
  (host().window as Window & typeof globalThis).Notification;

function readPref(): boolean {
  try {
    return parseBellPref(host().storage?.getItem(KEY) ?? null);
  } catch {
    return false;
  }
}

const [enabled, setEnabled] = createSignal(readPref());
const [permission, setPermission] = createSignal<NotificationPermission>(
  ctor()?.permission ?? "default",
);

export const bell = () => bellState(Boolean(ctor()), permission(), enabled());

function persist(on: boolean) {
  setEnabled(on);
  try {
    host().storage?.setItem(KEY, on ? "on" : "off");
  } catch {
    // Quota or privacy mode: the choice lasts for this page only.
  }
}

// Browsers only grant permission from a user gesture, so this click handler is
// the one place that asks.
export async function toggleBell() {
  const N = ctor();
  if (!N) return;
  if (bell() === "on") return persist(false);
  let p = N.permission;
  if (p === "default") p = await N.requestPermission();
  setPermission(p);
  if (p === "granted") persist(true);
}

const userAway = () => away(root().visibilityState, root().hasFocus());

async function deliver(mockId: string, items: Candidate[]) {
  const N = ctor();
  if (!N || bell() !== "on" || !userAway()) return;
  const seqs = items.flatMap((c) => (c.source === "comment" ? [c.seq] : []));
  const fetched = await Promise.all([
    api.mockHead(mockId),
    seqs.length ? api.comments(mockId, Math.min(...seqs) - 1) : null,
  ]).catch(() => null);
  // The mock was deleted or the server is gone; nothing worth saying.
  if (!fetched) return;
  const [mock, thread] = fetched;
  const notices = items.flatMap((c): Notice[] => {
    if (c.source === "comment") {
      const row = thread?.comments.find((r) => r.id === c.commentId);
      const n = row ? noticeFromComment(row) : null;
      return n ? [n] : [];
    }
    const v = mock.variants.find((x) => x.postId === c.postId);
    return v ? [noticeFromVariant(mock.title, v, c.version)] : [];
  });
  const notice = mergeNotices(notices);
  // Re-checked after the fetch: the user may have come back meanwhile.
  if (!notice || bell() !== "on" || !userAway()) return;
  const text = notificationText(mock, notice);
  const path = mockPath(mock.project, mock.slug);
  const n = new N(text.title, { body: text.body, tag: text.tag });
  n.onclick = () => {
    host().window.focus();
    if (host().location.pathname !== path) navigate(path);
    n.close();
  };
}

// Mounted once by App. Listens to the feed only while the bell is on.
export function startNotifier() {
  if (!ctor()) return;
  const win = host().window;
  const refresh = () => setPermission(ctor()?.permission ?? "default");
  win.addEventListener("focus", refresh);
  root().addEventListener("visibilitychange", refresh);
  onCleanup(() => {
    win.removeEventListener("focus", refresh);
    root().removeEventListener("visibilitychange", refresh);
  });

  createEffect(() => {
    if (bell() !== "on") return;
    const batch = createBatcher<Candidate>((mockId, items) => void deliver(mockId, items), {
      set: (fn, ms) => win.setTimeout(fn, ms),
      clear: (id) => win.clearTimeout(id),
    });
    const stop = subscribe((e) => {
      const c = candidateFor(e);
      if (c && userAway()) batch.add(c.mockId, c, Date.now());
    });
    onCleanup(() => {
      stop();
      batch.cancel();
    });
  });
}
