// Browser notifications, the pure half: which feed events mean "the agent wants
// you", what the notification says, and how a burst folds into one per design.
// notify.ts owns the permission, the timers and the Notification itself.

import type { CommentRow, FeedEvent, AlternativeView } from "./api.ts";
import { versionName } from "./logic.ts";

export type Bell = "hidden" | "off" | "on" | "blocked";

export function bellState(
  supported: boolean,
  permission: NotificationPermission,
  enabled: boolean,
): Bell {
  if (!supported) return "hidden";
  if (permission === "denied") return "blocked";
  return enabled && permission === "granted" ? "on" : "off";
}

export const parseBellPref = (raw: string | null): boolean => raw === "on";

// Visible and focused means the user is already looking at the viewer.
export const away = (visibility: DocumentVisibilityState, focused: boolean): boolean =>
  visibility !== "visible" || !focused;

// What an event points at, before the fetch that says whether it is worth a
// notification. Comments are decided on their row (author, kind); the event
// alone can't tell an agent's comment from the user's Send.
export type Candidate =
  | { designId: string; source: "comment"; commentId: string; seq: number }
  | { designId: string; source: "post"; postId: string; version: number };

export function candidateFor(e: FeedEvent): Candidate | null {
  switch (e.type) {
    case "comment-created":
      return e.designId
        ? { designId: e.designId, source: "comment", commentId: e.id, seq: e.seq }
        : null;
    case "post-created":
    case "post-updated":
      return e.by === "agent"
        ? { designId: e.designId, source: "post", postId: e.id, version: e.version }
        : null;
    default:
      return null;
  }
}

export type NoticeKind = "ask" | "reply" | "version";

export interface Notice {
  kind: NoticeKind;
  text: string;
}

export function noticeFromComment(row: CommentRow): Notice | null {
  if (row.author === "user" || row.kind === "reply") return null;
  if (row.kind === "ask") {
    // An ask call lands as one comment, one question per line.
    const lines = row.text.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return null;
    const more = lines.length > 1 ? ` (+${lines.length - 1} more)` : "";
    return { kind: "ask", text: `New question: ${lines[0]}${more}` };
  }
  return row.text.trim() ? { kind: "reply", text: `Agent: ${row.text}` } : null;
}

// Named as the version bar names it: "New version of Writer: Writing, Dark #3".
export function noticeFromAlternative(
  designTitle: string,
  v: AlternativeView,
  version: number,
  alternatives: Pick<AlternativeView, "state">[],
): Notice {
  const named = alternatives.filter((x) => x.state === v.state).length > 1;
  const where = [v.state, versionName({ alternative: v.alternative, version }, named)].filter(
    Boolean,
  );
  return { kind: "version", text: `New version of ${designTitle}: ${where.join(", ")}` };
}

// The loudest thing in a burst speaks for it: a question outranks a reply,
// which outranks a new version.
const rank: Record<NoticeKind, number> = { ask: 0, reply: 1, version: 2 };

export function mergeNotices(list: Notice[]): Notice | null {
  if (list.length === 0) return null;
  const top = [...list].sort((a, b) => rank[a.kind] - rank[b.kind])[0];
  const rest = list.length - 1;
  return rest > 0 ? { kind: top.kind, text: `${top.text} · +${rest} more` } : top;
}

export const BODY_MAX = 120;

export function clip(text: string, max = BODY_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export interface NotificationText {
  title: string;
  body: string;
  tag: string;
}

export function notificationText(
  design: { id: string; title: string; slug: string },
  notice: Notice,
): NotificationText {
  return {
    title: `mockpit · ${design.title.trim() || design.slug}`,
    body: clip(notice.text),
    tag: `mockpit:${design.id}`,
  };
}

// Groups items by key and hands each group over once the key has been quiet
// for `quiet` ms, or `max` ms after its first item, whichever comes first.
export interface Timers {
  set: (fn: () => void, ms: number) => number;
  clear: (id: number) => void;
}

export function createBatcher<T>(
  onFlush: (key: string, items: T[]) => void,
  timers: Timers,
  quiet = 1500,
  max = 5000,
) {
  const open = new Map<string, { items: T[]; timer: number; started: number }>();
  const flush = (key: string) => {
    const group = open.get(key);
    if (!group) return;
    open.delete(key);
    onFlush(key, group.items);
  };
  return {
    add(key: string, item: T, now: number) {
      const group = open.get(key);
      if (!group) {
        open.set(key, { items: [item], timer: timers.set(() => flush(key), quiet), started: now });
        return;
      }
      timers.clear(group.timer);
      group.items.push(item);
      const wait = Math.max(0, Math.min(quiet, group.started + max - now));
      group.timer = timers.set(() => flush(key), wait);
    },
    cancel() {
      for (const g of open.values()) timers.clear(g.timer);
      open.clear();
    },
  };
}
