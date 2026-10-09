// Typed client for the routes the viewer reads and writes. Response types come
// straight from the server's view functions, so a contract change breaks the
// viewer's typecheck instead of its runtime.

import type { mockDetailView, mockSummaryView, variantView } from "../../server/apiViews.ts";
import type { FeedEvent } from "../../server/events.ts";
import type {
  AskAnswer,
  Comment,
  Draft,
  KnobValue,
  PartComment,
  ProjectSummary,
  ReplyDecision,
} from "../../server/types.ts";
import { basePath, host } from "./host.ts";

export type MockSummary = ReturnType<typeof mockSummaryView>;
export type MockDetail = ReturnType<typeof mockDetailView>;
export type VariantView = ReturnType<typeof variantView>;
export type HistoryRow = NonNullable<VariantView["history"]>[number];
export type CommentRow = Comment & { delivered: boolean };
export type { FeedEvent, ProjectSummary };

// What the viewer edits: a Draft minus the server's timestamp.
export interface DraftInput {
  version: number;
  answers: Record<string, AskAnswer>;
  mix: Record<string, string>;
  tuned: Record<string, KnobValue>;
  comments: PartComment[];
  others: Record<string, string>;
  notes: Record<string, string>;
  otherImages: Record<string, string[]>;
  noteImages: Record<string, string[]>;
}

export interface MockList {
  project?: string;
  mocks: MockSummary[];
  open: number;
  openMocks: number;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const url = (path: string) => `${basePath()}${path}`;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url(path), {
    ...init,
    headers: init?.headers ?? (init?.body ? { "content-type": "application/json" } : undefined),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.error ?? res.statusText);
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

export const api = {
  projects: () => call<ProjectSummary[]>("/api/projects"),
  mocks: (project: string) => call<MockList>(`/api/mocks?project=${encodeURIComponent(project)}`),
  mock: (id: string) => call<MockDetail>(`/api/mocks/${encodeURIComponent(id)}?history=1`),
  // The same view without version rows: enough to name a mock and its variants.
  mockHead: (id: string) => call<MockDetail>(`/api/mocks/${encodeURIComponent(id)}`),
  draft: (id: string) =>
    call<{ draft: Draft | null }>(`/api/mocks/${encodeURIComponent(id)}/draft`),
  putDraft: (id: string, draft: DraftInput) =>
    call<{ draft: Draft }>(`/api/mocks/${encodeURIComponent(id)}/draft`, json("PUT", draft)),
  reply: (id: string, body: DraftInput & { text?: string; decision?: ReplyDecision }) =>
    call<{ reply: CommentRow }>(`/api/mocks/${encodeURIComponent(id)}/reply`, json("POST", body)),
  // A new version of the variant made from an older one ("restore as vN").
  restoreVersion: (id: string, postId: string, version: number) =>
    call<unknown>(
      `/api/mocks/${encodeURIComponent(id)}/variants/${encodeURIComponent(postId)}/restore`,
      json("POST", { version }),
    ),
  // Un-archive one variant of one state (D13).
  restoreVariant: (id: string, state: string | null, variant: string) =>
    call<unknown>(`/api/mocks/${encodeURIComponent(id)}/restore`, json("POST", { state, variant })),
  // A plain comment from the user, outside a reply.
  comment: (mockId: string, text: string) =>
    call<CommentRow>("/api/comments", json("POST", { mock: mockId, text, author: "user" })),
  comments: (mockId: string, after?: number) =>
    call<{ comments: CommentRow[]; lastSeq: number }>(
      `/api/comments?mock=${encodeURIComponent(mockId)}${after === undefined ? "" : `&after=${after}`}`,
    ),
  // An image the user attaches to a write-in or a note; the bytes go up raw.
  attach: (mockId: string, image: Blob, filename: string) =>
    call<{ id: string }>(
      `/api/assets?mock=${encodeURIComponent(mockId)}&kind=image&filename=${encodeURIComponent(filename)}`,
      { method: "POST", body: image, headers: { "content-type": image.type } },
    ),
  theme: () => call<{ mode: "dark" | "light" }>("/api/theme"),
  putTheme: (mode: "dark" | "light") => call<{ mode: string }>("/api/theme", json("PUT", { mode })),
};

// A surface document for a frame or a thumbnail. Every input that changes the
// pixels is in the URL, so a version-pinned document is cacheable.
export function surfaceUrl(
  postId: string,
  surface: number,
  opts: { version?: number; mode?: string; knobs?: Record<string, KnobValue> } = {},
): string {
  const q = new URLSearchParams({ surface: String(surface) });
  if (opts.version) q.set("ver", String(opts.version));
  if (opts.mode) q.set("mode", opts.mode);
  if (opts.knobs && Object.keys(opts.knobs).length) q.set("k", JSON.stringify(opts.knobs));
  return url(`/s/${encodeURIComponent(postId)}?${q}`);
}

export const assetUrl = (id: string) => url(`/a/${encodeURIComponent(id)}`);

// The live feed: one EventSource per tab, shared by every subscriber, since
// browsers hold at most six HTTP/1.1 connections per origin across all tabs.
// EventSource reconnects on its own; `onOpen` runs on each (re)connect so
// callers refetch after a gap and nothing broadcast while disconnected is missed.
type Listener = { onEvent: (e: FeedEvent) => void; onOpen?: () => void };
const listeners = new Set<Listener>();
let feed: { close: () => void } | null = null;
// The mock this tab has on screen, sent as `?viewing=` so the agent's
// pending.viewerOpen is per mock.
let viewingId: string | null = null;

function connect(): { close: () => void } | null {
  const Source = (host().window as Window & typeof globalThis).EventSource;
  if (!Source) return null;
  const path = viewingId ? `/api/events?viewing=${encodeURIComponent(viewingId)}` : "/api/events";
  const es = new Source(url(path));
  es.onmessage = (m: MessageEvent<string>) => {
    let event: FeedEvent;
    try {
      event = JSON.parse(m.data) as FeedEvent;
    } catch {
      // A malformed frame is dropped; the next event or reconnect refetches.
      return;
    }
    for (const l of listeners) l.onEvent(event);
  };
  es.addEventListener("hello", () => {
    for (const l of listeners) l.onOpen?.();
  });
  return { close: () => es.close() };
}

export function subscribe(onEvent: (e: FeedEvent) => void, onOpen?: () => void): () => void {
  const entry = { onEvent, onOpen };
  listeners.add(entry);
  feed ??= connect();
  return () => {
    listeners.delete(entry);
    if (listeners.size === 0) {
      feed?.close();
      feed = null;
    }
  };
}

// Marks `mockId` as on screen until the returned release runs. Changing it
// reconnects the feed, whose hello refetches like any other gap. The release
// only clears its own id, so a screen torn down after the next one mounted
// can't unmark the new one.
export function watchMock(mockId: string): () => void {
  setViewing(mockId);
  return () => {
    if (viewingId === mockId) setViewing(null);
  };
}

function setViewing(id: string | null) {
  if (viewingId === id) return;
  viewingId = id;
  if (feed) {
    feed.close();
    feed = connect();
  }
}
