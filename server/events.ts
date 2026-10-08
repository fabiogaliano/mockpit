export type FeedEvent =
  | { type: "session-created" | "session-updated" | "session-deleted"; id: string }
  // A mock's own fields changed (title, states, asks, knobs) or it was created.
  | { type: "mock-created" | "mock-updated"; id: string; project: string }
  | { type: "mock-deleted"; id: string; project: string }
  // The user's draft changed, so other open tabs on the mock refresh it.
  | { type: "draft-updated"; mockId: string }
  | {
      type: "post-created" | "post-updated";
      id: string;
      mockId: string;
      sessionId: string;
      version: number;
    }
  | { type: "post-deleted"; id: string; mockId: string; sessionId: string }
  | {
      type: "comment-created";
      id: string;
      sessionId: string;
      mockId: string | null;
      postId: string | null;
      seq: number;
    }
  | { type: "comment-deleted"; id: string; sessionId: string }
  // Workspace theme changed; `id` is the new theme id. Other open tabs re-theme.
  | { type: "theme-changed"; id: string };

type Listener = (event: FeedEvent) => void;

// One bus per app instance. On Cloudflare, each workspace is a single Durable
// Object running one app, so in-memory listeners are correct there too —
// a module-level singleton would leak events across workspaces sharing an isolate.
export class EventBus {
  private listeners = new Set<Listener>();

  broadcast(event: FeedEvent) {
    for (const fn of this.listeners) fn(event);
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
