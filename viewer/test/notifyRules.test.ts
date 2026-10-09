import { describe, expect, it } from "vitest";
import type { CommentRow, FeedEvent, VariantView } from "../src/api.ts";
import {
  away,
  bellState,
  candidateFor,
  clip,
  createBatcher,
  mergeNotices,
  noticeFromComment,
  noticeFromVariant,
  notificationText,
  parseBellPref,
} from "../src/notifyRules.ts";

const row = (over: Partial<CommentRow>): CommentRow =>
  ({
    id: "c1",
    seq: 1,
    sessionId: "s1",
    mockId: "m1",
    postId: null,
    author: "claude",
    text: "",
    createdAt: "2026-10-09T00:00:00Z",
    kind: "comment",
    anchors: [],
    postVersion: null,
    viewport: null,
    seen: false,
    ...over,
  }) as CommentRow;

const variant = (over: Partial<VariantView>): VariantView =>
  ({ postId: "p1", state: null, variant: "default", version: 1, ...over }) as VariantView;

describe("bellState", () => {
  it("hides without the Notification API", () => {
    expect(bellState(false, "granted", true)).toBe("hidden");
  });
  it("is blocked when permission is denied, whatever the pref", () => {
    expect(bellState(true, "denied", true)).toBe("blocked");
    expect(bellState(true, "denied", false)).toBe("blocked");
  });
  it("is on only with the pref and a grant", () => {
    expect(bellState(true, "granted", true)).toBe("on");
    expect(bellState(true, "granted", false)).toBe("off");
    expect(bellState(true, "default", true)).toBe("off");
  });
});

it("parseBellPref reads only an explicit on", () => {
  expect(parseBellPref("on")).toBe(true);
  expect(parseBellPref("off")).toBe(false);
  expect(parseBellPref(null)).toBe(false);
  expect(parseBellPref("true")).toBe(false);
});

it("away is hidden or unfocused", () => {
  expect(away("visible", true)).toBe(false);
  expect(away("visible", false)).toBe(true);
  expect(away("hidden", true)).toBe(true);
});

describe("candidateFor", () => {
  it("takes agent posts and mock comments", () => {
    const post: FeedEvent = {
      type: "post-updated",
      id: "p1",
      mockId: "m1",
      sessionId: "s1",
      version: 3,
      by: "agent",
    };
    expect(candidateFor(post)).toEqual({ mockId: "m1", source: "post", postId: "p1", version: 3 });
    const comment: FeedEvent = {
      type: "comment-created",
      id: "c1",
      sessionId: "s1",
      mockId: "m1",
      postId: null,
      seq: 7,
    };
    expect(candidateFor(comment)).toEqual({
      mockId: "m1",
      source: "comment",
      commentId: "c1",
      seq: 7,
    });
  });
  it("skips the user's own post changes, mockless comments and everything else", () => {
    expect(
      candidateFor({
        type: "post-updated",
        id: "p1",
        mockId: "m1",
        sessionId: "s1",
        version: 3,
        by: "user",
      }),
    ).toBeNull();
    expect(
      candidateFor({
        type: "comment-created",
        id: "c1",
        sessionId: "s1",
        mockId: null,
        postId: null,
        seq: 1,
      }),
    ).toBeNull();
    expect(candidateFor({ type: "draft-updated", mockId: "m1" })).toBeNull();
    expect(candidateFor({ type: "mock-updated", id: "m1", project: "p" })).toBeNull();
  });
});

describe("noticeFromComment", () => {
  it("never speaks for the user or their reply", () => {
    expect(noticeFromComment(row({ author: "user", text: "hi" }))).toBeNull();
    expect(noticeFromComment(row({ kind: "reply", text: "sent" }))).toBeNull();
  });
  it("turns an ask comment into its first question", () => {
    expect(noticeFromComment(row({ kind: "ask", text: "Which look?" }))).toEqual({
      kind: "ask",
      text: "New question: Which look?",
    });
    expect(noticeFromComment(row({ kind: "ask", text: "Which look?\nHow dense?\n" }))).toEqual({
      kind: "ask",
      text: "New question: Which look? (+1 more)",
    });
  });
  it("turns an agent comment into a reply and drops empty ones", () => {
    expect(noticeFromComment(row({ text: "Tightened the header." }))).toEqual({
      kind: "reply",
      text: "Agent replied: Tightened the header.",
    });
    expect(noticeFromComment(row({ text: "  " }))).toBeNull();
  });
});

it("noticeFromVariant names the state and a non-default variant", () => {
  expect(noticeFromVariant("Writer", variant({}), 1).text).toBe("New version of Writer (v1)");
  expect(noticeFromVariant("Writer", variant({ state: "empty", variant: "quiet" }), 4).text).toBe(
    "New version of Writer (empty, quiet, v4)",
  );
});

describe("mergeNotices", () => {
  it("lets the question speak for a burst", () => {
    const merged = mergeNotices([
      { kind: "version", text: "New version of A (v2)" },
      { kind: "ask", text: "New question: Which?" },
      { kind: "reply", text: "Agent replied: ok" },
    ]);
    expect(merged).toEqual({ kind: "ask", text: "New question: Which? · +2 more" });
  });
  it("passes one notice through and nothing as null", () => {
    const one = { kind: "reply" as const, text: "Agent replied: ok" };
    expect(mergeNotices([one])).toEqual(one);
    expect(mergeNotices([])).toBeNull();
  });
});

describe("notificationText", () => {
  it("titles by mock, tags by mock, clips the body", () => {
    const long = `Agent replied: ${"word ".repeat(60)}`;
    const t = notificationText(
      { id: "m1", title: "Writer", slug: "writer" },
      { kind: "reply", text: long },
    );
    expect(t.title).toBe("mockpit · Writer");
    expect(t.tag).toBe("mockpit:m1");
    expect(t.body.length).toBeLessThanOrEqual(120);
    expect(t.body.endsWith("…")).toBe(true);
  });
  it("falls back to the slug", () => {
    expect(
      notificationText({ id: "m1", title: " ", slug: "writer" }, { kind: "ask", text: "q" }).title,
    ).toBe("mockpit · writer");
  });
});

it("clip flattens whitespace and keeps short text whole", () => {
  expect(clip("a\n\n  b")).toBe("a b");
  expect(clip("abcdef", 4)).toBe("abc…");
});

describe("createBatcher", () => {
  function fakeClock() {
    let now = 0;
    let next = 1;
    const pending = new Map<number, { at: number; fn: () => void }>();
    return {
      now: () => now,
      timers: {
        set: (fn: () => void, ms: number) => {
          pending.set(next, { at: now + ms, fn });
          return next++;
        },
        clear: (id: number) => void pending.delete(id),
      },
      advance(ms: number) {
        now += ms;
        for (const [id, t] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
          if (t.at <= now) {
            pending.delete(id);
            t.fn();
          }
        }
      },
    };
  }

  it("folds a burst into one flush per key", () => {
    const clock = fakeClock();
    const flushed: [string, string[]][] = [];
    const b = createBatcher<string>((k, items) => flushed.push([k, items]), clock.timers, 1500);
    b.add("A", "publish", clock.now());
    clock.advance(400);
    b.add("A", "publish again", clock.now());
    b.add("B", "other mock", clock.now());
    clock.advance(400);
    b.add("A", "ask", clock.now());
    clock.advance(1499);
    expect(flushed).toEqual([["B", ["other mock"]]]);
    clock.advance(1);
    expect(flushed).toEqual([
      ["B", ["other mock"]],
      ["A", ["publish", "publish again", "ask"]],
    ]);
  });

  it("flushes a steady stream by the max wait", () => {
    const clock = fakeClock();
    const flushed: number[][] = [];
    const b = createBatcher<number>((_, items) => flushed.push(items), clock.timers, 1000, 3000);
    for (let i = 0; i < 6; i++) {
      b.add("A", i, clock.now());
      clock.advance(800);
    }
    expect(flushed[0]).toEqual([0, 1, 2, 3]);
  });

  it("cancel drops what is pending", () => {
    const clock = fakeClock();
    const flushed: string[] = [];
    const b = createBatcher<string>((k) => flushed.push(k), clock.timers);
    b.add("A", "x", clock.now());
    b.cancel();
    clock.advance(10_000);
    expect(flushed).toEqual([]);
  });
});
