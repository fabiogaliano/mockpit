// The app badge and the tab title count, the pure half: which feed events can
// change how many mocks owe answers, and how the count reads in a title.
// badge.ts owns the fetch, the timer and the navigator calls.

import type { FeedEvent } from "./api.ts";

// A mock gains asks or variants (mock-*, post-*), or a Send answers them
// (comment-created, then mock-updated). Drafts never change what is owed.
export const countMayChange = (e: FeedEvent): boolean =>
  e.type.startsWith("mock-") || e.type.startsWith("post-") || e.type === "comment-created";

const COUNT = /^\(\d+\) /;

// "(3) Writer" while 3 mocks owe answers, the bare title at 0.
export function titleWithCount(title: string, n: number): string {
  const bare = title.replace(COUNT, "");
  return n > 0 ? `(${n}) ${bare}` : bare;
}
