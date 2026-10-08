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
export type CommentRow = Comment & { seen: boolean };
export type { FeedEvent, ProjectSummary };

// What the viewer edits: a Draft minus the server's timestamp.
export interface DraftInput {
  version: number;
  answers: Record<string, AskAnswer>;
  mix: Record<string, string>;
  tuned: Record<string, KnobValue>;
  comments: PartComment[];
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
    headers: init?.body ? { "content-type": "application/json" } : undefined,
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
  comments: (mockId: string) =>
    call<{ comments: CommentRow[]; lastSeq: number }>(
      `/api/comments?mock=${encodeURIComponent(mockId)}`,
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

// The live feed. EventSource reconnects on its own; `onOpen` lets callers
// refetch after a gap so nothing broadcast while disconnected is missed.
export function subscribe(onEvent: (e: FeedEvent) => void, onOpen?: () => void): () => void {
  const Source = (host().window as Window & typeof globalThis).EventSource;
  if (!Source) return () => {};
  const es = new Source(url("/api/events"));
  es.onmessage = (m: MessageEvent<string>) => {
    try {
      onEvent(JSON.parse(m.data) as FeedEvent);
    } catch {
      // A malformed frame is dropped; the next event or reconnect refetches.
    }
  };
  if (onOpen) es.addEventListener("hello", onOpen);
  return () => es.close();
}
