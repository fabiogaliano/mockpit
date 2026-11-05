import type { Mode } from "./themes.ts";

export type FeedEvent =
  | { type: "session-created" | "session-updated" | "session-deleted"; id: string }
  // A design's own fields changed (title, states, asks, knobs) or it was created.
  | { type: "design-created" | "design-updated"; id: string; project: string }
  | { type: "design-deleted"; id: string; project: string }
  // The user's draft changed, so other open tabs on the design refresh it.
  | { type: "draft-updated"; designId: string }
  | {
      type: "post-created" | "post-updated";
      id: string;
      designId: string;
      sessionId: string;
      version: number;
      // Who caused it: the viewer's own restores and Send's accept/archive
      // flips are "user", so a listener can tell them from the agent's work.
      by: "agent" | "user";
    }
  | { type: "post-deleted"; id: string; designId: string; sessionId: string }
  | {
      type: "comment-created";
      id: string;
      sessionId: string;
      designId: string | null;
      postId: string | null;
      seq: number;
    }
  | { type: "comment-deleted"; id: string; sessionId: string }
  // The session's agent cursor (agentSeq) moved: comments up to `seq` are delivered.
  | { type: "comment-delivered"; sessionId: string; seq: number }
  // The session's agent made a call of its own, as opposed to a watch re-arming.
  // At most one every few seconds per session.
  | { type: "agent-called"; sessionId: string }
  // Workspace light/dark mode changed. Other open tabs re-theme.
  | { type: "theme-changed"; mode: Mode };

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
