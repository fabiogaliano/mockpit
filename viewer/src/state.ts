// Workspace-wide state that isn't project/item shaped: the live feed, toasts,
// the update notice, and the standalone post page. Project › item state lives in
// projects.ts, which subscribes to the feed through onFeedEvent below.
import { createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import {
  api,
  appPath,
  isReadonly,
  publicReadMode,
  type Comment,
  type SessionRow,
  type Post,
  type VersionInfo,
} from "./api.ts";
import { host } from "./host.ts";
import { DEFAULT_THEME_ID } from "../../server/themes.ts";
import { applyTheme } from "./theme.ts";

// A comment as the viewer renders it: server comments plus the optimistic
// local echo (pending until the POST confirms).
export type ViewComment = Comment & { pending?: boolean };

const [sessionsStore, setSessionsInternal] = createStore<SessionRow[]>([]);
export const sessions = sessionsStore;

// Standalone (direct-link) mode: a bare /p/:id route with no session shows that
// one post full-page. It is also what the server screenshots for /p/:id.png.
const [standaloneState, setStandaloneInternal] = createSignal<Post | null>(null);
export const standalonePost = standaloneState;

const [commentsState, setCommentsInternal] = createSignal<ViewComment[]>([]);
export const comments = commentsState;

// False until the initial route has resolved, so neither the empty-workspace
// copy nor an embedding host's overlay flips to real content too early.
const [initialLoadedState, setInitialLoadedInternal] = createSignal(false);
export const initialLoaded = initialLoadedState;
export const setInitialLoaded = setInitialLoadedInternal;
const [liveState, setLiveInternal] = createSignal(false);
export const live = liveState;
export const [navOpen, setNavOpen] = createSignal(false);
// Post id the next mounted card should scroll to (standalone never sets it; the
// Card reads it unconditionally).
export const [scrollTarget, setScrollTarget] = createSignal<string | null>(null);

const [toastTextState, setToastTextInternal] = createSignal("");
export const toastText = toastTextState;
const [toastShowState, setToastShowInternal] = createSignal(false);
export const toastShow = toastShowState;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(text: string) {
  setToastTextInternal(text);
  setToastShowInternal(true);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setToastShowInternal(false), 4000);
}

// Update notice: shown when the server reports a newer release the user has
// not dismissed. Dismissal stores the version, not a flag, so dismissing
// 0.4.0 keeps it gone until 0.5.0 actually ships.
const DISMISSED_UPDATE_KEY = "mockpit-dismissed-update";
const [versionInfo, setVersionInfo] = createSignal<VersionInfo | null>(null);
const [dismissedUpdate, setDismissedUpdate] = createSignal(
  localStorage.getItem(DISMISSED_UPDATE_KEY),
);

export async function checkVersion() {
  setVersionInfo(await api<VersionInfo>("/api/version").catch(() => null));
}

export function dismissUpdate(version: string) {
  localStorage.setItem(DISMISSED_UPDATE_KEY, version);
  setDismissedUpdate(version);
}

export function updateNotice(): VersionInfo | null {
  const v = versionInfo();
  return v?.updateAvailable && v.latest && v.latest !== dismissedUpdate() ? v : null;
}

export async function refreshSessionsQuiet() {
  if (isReadonly() && publicReadMode() === "session") return;
  const next = await api<SessionRow[]>("/api/sessions").catch(() => null);
  if (next) setSessionsInternal(reconcile(next, { key: "id" }));
}

// Entry point on load for the standalone permalink: a bare post route (/p/:id,
// no session) opens the full-page view. Returns true when it took over.
export async function enterStandalone(id: string): Promise<boolean> {
  if (standalonePost()?.id === id) return true;
  const post = await api<Post>(`/api/posts/${encodeURIComponent(id)}`).catch(() => null);
  if (post) setStandaloneInternal(post);
  return !!post;
}

export function leaveStandalone() {
  if (standalonePost()) setStandaloneInternal(null);
}

export function isConnectRoute(): boolean {
  return location.pathname === appPath("/connect");
}

// Kept for the Card's deep-link scroll contract; standalone has no session
// route to reflect, so this is a no-op there.
export function focusPost(_postId: string) {}

export async function deleteComment(id: string): Promise<string | null> {
  const prior = commentsState();
  setCommentsInternal((prev) => prev.filter((c) => c.id !== id));
  try {
    await api(`/api/comments/${encodeURIComponent(id)}`, { method: "DELETE" });
    return null;
  } catch (err) {
    setCommentsInternal(prior);
    return err instanceof Error && err.message ? err.message : "network error";
  }
}

let localSeq = 0;

// Echo the comment immediately (pending until the POST confirms), and on
// failure report the error so the composer can put the text back — a user
// message must never be silently lost. Returns the error message, or null.
export async function sendComment(
  body: Record<string, unknown>,
  postId: string | null,
  text: string,
): Promise<string | null> {
  const anchor = body.anchor as Comment["anchor"] | undefined;
  const local: ViewComment = {
    id: `local-${++localSeq}`,
    seq: 0,
    sessionId: "",
    postId,
    postTitle: null,
    author: "user",
    text,
    createdAt: new Date().toISOString(),
    kind: "comment",
    anchors: [],
    draft: false,
    postVersion: null,
    viewport: null,
    ...(anchor && { anchor }),
    pending: true,
  };
  setCommentsInternal((prev) => [...prev, local]);
  try {
    const created = await api<Comment>("/api/comments", {
      method: "POST",
      body: JSON.stringify(body),
    });
    setCommentsInternal((prev) => {
      if (prev.some((c) => c.id === created.id)) return prev.filter((c) => c.id !== local.id);
      return prev.map((c) => (c.id === local.id ? created : c));
    });
    return null;
  } catch (err) {
    setCommentsInternal((prev) => prev.filter((c) => c.id !== local.id));
    return err instanceof Error && err.message ? err.message : "network error";
  }
}

export interface FeedEvent {
  type: string;
  id: string;
  sessionId?: string;
  surfaceId?: string | null;
}

// Feed fan-out. The live connection is owned here; every view that wants to
// refetch on activity subscribes instead of re-opening its own stream.
type FeedListener = (event: FeedEvent) => void;
const feedListeners = new Set<FeedListener>();
export function onFeedEvent(listener: FeedListener): () => void {
  feedListeners.add(listener);
  return () => feedListeners.delete(listener);
}

const WS_HEARTBEAT_MS = 30_000;
const WS_RECONNECT_MS = 1000;

function handleFeedData(data: string) {
  if (data === "pong") return;
  let event: FeedEvent;
  try {
    event = JSON.parse(data) as FeedEvent;
  } catch {
    return;
  }
  // A theme switch must re-theme the chrome AND every rendered frame, so it is
  // applied centrally rather than by a subscriber.
  if (event.type === "theme-changed") applyTheme(DEFAULT_THEME_ID);
  for (const listener of feedListeners) listener(event);
}

function eventsPath(): string {
  const route = host().router.get();
  const sessionId = route.sessionId ?? standalonePost()?.sessionId;
  return isReadonly() && publicReadMode() === "session" && sessionId
    ? `/api/events?session=${encodeURIComponent(sessionId)}`
    : "/api/events";
}

function wsAppUrl(path: string): string {
  const url = new URL(appPath(path), window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

export function connect(): () => void {
  if (host().liveTransport === "ws") return connectWebSocket();
  return connectSse();
}

function connectSse(): () => void {
  const es = new EventSource(appPath(eventsPath()));
  let everConnected = false;
  es.onopen = () => {
    setLiveInternal(true);
    // Events that fired during a gap are gone for good — tell subscribers to
    // resync so the workspace can't silently go stale while still looking live.
    if (everConnected) handleFeedData(JSON.stringify({ type: "resync", id: "" }));
    everConnected = true;
  };
  es.onerror = () => setLiveInternal(false);
  es.onmessage = (ev) => handleFeedData(ev.data);
  return () => {
    es.close();
    setLiveInternal(false);
  };
}

function connectWebSocket(): () => void {
  const url = wsAppUrl(eventsPath());
  let everConnected = false;
  let closed = false;
  let ws: WebSocket | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;

  const clearHeartbeat = () => {
    clearInterval(heartbeat);
    heartbeat = undefined;
  };

  const open = () => {
    if (closed) return;
    ws = new WebSocket(url);
    ws.onopen = () => {
      setLiveInternal(true);
      clearHeartbeat();
      heartbeat = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) ws.send("ping");
      }, WS_HEARTBEAT_MS);
      if (everConnected) handleFeedData(JSON.stringify({ type: "resync", id: "" }));
      everConnected = true;
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") handleFeedData(ev.data);
    };
    ws.onerror = () => setLiveInternal(false);
    ws.onclose = () => {
      setLiveInternal(false);
      clearHeartbeat();
      if (!closed) reconnect = setTimeout(open, WS_RECONNECT_MS);
    };
  };

  open();
  return () => {
    closed = true;
    clearTimeout(reconnect);
    clearHeartbeat();
    ws?.close();
    setLiveInternal(false);
  };
}
