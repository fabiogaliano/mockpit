// Orphaned replies: a Send lands on the session that owns the mock, and when
// that agent restarts into a new session (a new conversation, /clear, a crash)
// nobody would ever read it. The rule below decides when a newer session may
// take such a reply instead. Runtime-agnostic (no node imports).
//
// The danger is the other way round: two agents can work in one repo at once,
// and an agent waiting on the user looks exactly like a dead one — both are
// silent. So each clause narrows who counts as "the same agent, restarted":
//
// - Same project, same cwd, same agent name. A restart reopens the same harness
//   in the same checkout; a different worktree or tool is a parallel worker.
// - The owner was created first and has made no call since the taker appeared
//   (agentActiveAt, which the user's own Sends don't bump). An owner that kept
//   working after the taker started is running alongside it, not gone.
// - The owner has no feedback long-poll open right now (`mockpit watch`).
//
// A reply also waits HANDOFF_GRACE_MS after the Send, so the owner — the agent
// the user is most likely about to tell — gets first claim. The one exception:
// a keyless owner (no harness conversation id) can never come back, so a reply
// it got before the taker existed goes at once — the user answered, then
// restarted. A keyed owner always gets the grace: its conversation may resume.

import type { Comment, Session } from "./types.ts";

export const HANDOFF_GRACE_MS = 2 * 60_000;

export const HANDOFF_NOTE =
  "Sent to an earlier agent session in this project that has gone quiet; it is yours now. Read the mock before acting.";

export const ownerActiveAt = (s: Session): string => s.agentActiveAt ?? s.lastActiveAt;

export function supersedes(taker: Session, owner: Session, listening: boolean): boolean {
  return (
    owner.id !== taker.id &&
    owner.project !== null &&
    owner.project === taker.project &&
    owner.cwd === taker.cwd &&
    owner.agent === taker.agent &&
    owner.createdAt < taker.createdAt &&
    ownerActiveAt(owner) < taker.createdAt &&
    !listening
  );
}

export function handoffReady(
  comment: Comment,
  owner: Session,
  taker: Session,
  now: number,
): boolean {
  return (
    (!owner.keyed && comment.createdAt < taker.createdAt) ||
    now - Date.parse(comment.createdAt) >= HANDOFF_GRACE_MS
  );
}
