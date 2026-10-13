import { describe, expect, it } from "vitest";
import type { PartComment } from "../../server/types.ts";
import type { CommentRow, FeedEvent, VariantView } from "../src/api.ts";
import { countMayChange, titleWithCount } from "../src/badgeRules.ts";
import { carryOver, summarizeReply, threadRows } from "../src/logic.ts";
import {
  commentText,
  reactionOf,
  reactionSpot,
  reactionStatus,
  reactionWhere,
  toggleReaction,
} from "../src/reactionRules.ts";
import { withoutKey } from "../src/route.ts";

describe("withoutKey", () => {
  it("drops ?key= and keeps the rest of the URL", () => {
    expect(withoutKey("https://m.dev/project/a/b?key=s3cret")).toBe("/project/a/b");
    expect(withoutKey("https://m.dev/mp/?x=1&key=s3cret#t")).toBe("/mp/?x=1#t");
  });

  it("leaves a URL without a key alone", () => {
    expect(withoutKey("https://m.dev/project/a?x=1")).toBeNull();
  });
});

describe("reactionSpot", () => {
  const bar = { w: 200, h: 50 };
  it("sits under the part, clamped to the overlay's current width", () => {
    const part = { x: 300, y: 100, w: 100, h: 40 };
    expect(reactionSpot(part, bar, { width: 800, height: 900 })).toEqual({ left: 300, top: 148 });
    // Narrower after a rotation or a width change: pulled back inside.
    expect(reactionSpot(part, bar, { width: 390, height: 900 }).left).toBe(186);
  });

  it("clears a name tag drawn under a part at the top of the page", () => {
    expect(reactionSpot({ x: 0, y: 0, w: 100, h: 40 }, bar, { width: 800, height: 900 })).toEqual({
      left: 4,
      top: 70,
    });
  });

  it("goes above when there is no room below, else inside the top edge", () => {
    const low = { x: 10, y: 700, w: 100, h: 180 };
    expect(reactionSpot(low, bar, { width: 800, height: 900 }).top).toBe(620);
    const tall = { x: 10, y: 40, w: 100, h: 850 };
    expect(reactionSpot(tall, bar, { width: 800, height: 900 }).top).toBe(48);
  });
});

const hero = { part: "hero", state: null, variant: "B" };

describe("toggleReaction", () => {
  it("adds, replaces and takes back one reaction per target", () => {
    let list: PartComment[] = [];
    list = toggleReaction(list, hero, "up");
    expect(list).toEqual([{ part: "hero", state: null, text: "", reaction: "up", variant: "B" }]);
    list = toggleReaction(list, hero, "down");
    expect(list).toHaveLength(1);
    expect(reactionOf(list, hero)).toBe("down");
    list = toggleReaction(list, hero, "down");
    expect(list).toEqual([]);
    expect(reactionOf(list, hero)).toBeNull();
  });

  it("keeps targets apart: another variant, the variant itself, typed comments", () => {
    const typed: PartComment = { part: "hero", state: null, text: "tighter" };
    let list = toggleReaction([typed], hero, "up");
    list = toggleReaction(list, { ...hero, variant: "A" }, "more");
    list = toggleReaction(list, { ...hero, part: null }, "down");
    expect(list).toHaveLength(4);
    expect(list[0]).toBe(typed);
    expect(reactionOf(list, hero)).toBe("up");
    expect(reactionOf(list, { ...hero, variant: "A" })).toBe("more");
    expect(reactionOf(list, { ...hero, part: null })).toBe("down");
  });
});

describe("reaction wording", () => {
  it("says what a tap did", () => {
    expect(reactionStatus("hero", "up")).toBe("Liked hero");
    expect(reactionStatus("hero", "down")).toBe("Disliked hero");
    expect(reactionStatus("variant B", "more")).toBe("Asked for more like variant B");
    expect(reactionStatus("hero", null)).toBe("Removed your reaction to hero");
  });

  it("shows a reaction in the thread by its mark and where it was left", () => {
    const r: PartComment = {
      part: "hero",
      state: "Mobile",
      text: "",
      reaction: "up",
      variant: "B",
    };
    expect(commentText(r)).toBe("👍");
    expect(commentText({ ...r, reaction: "more", text: "bolder" })).toBe("More like this · bolder");
    expect(commentText({ part: null, state: null, text: "plain" })).toBe("plain");
    expect(reactionWhere(r)).toBe("hero · B · Mobile");
    expect(reactionWhere({ ...r, part: null, state: null })).toBe("B");
  });
});

describe("reactions in a Send", () => {
  const reply = {
    answers: {},
    mix: {},
    tuned: {},
    comments: [
      { part: "hero", state: null, text: "tighter" },
      { part: "hero", state: null, text: "", reaction: "up" as const, variant: "B" },
      { part: null, state: null, text: "", reaction: "down" as const, variant: "A" },
    ],
  };

  it("counts reactions apart from comments in the summary line", () => {
    expect(summarizeReply(reply, { asks: [] })).toBe("Sent · 1 comment · 2 reactions");
  });

  it("lists each reaction under the Send", () => {
    const row = {
      id: "r",
      seq: 1,
      sessionId: "s",
      mockId: "m",
      postId: null,
      author: "user",
      text: "",
      createdAt: "2026-01-01T00:00:02Z",
      kind: "reply",
      anchors: [],
      postVersion: null,
      viewport: null,
      delivered: false,
      payload: { mockId: "m", version: 1, ...reply },
    } as unknown as CommentRow;
    const [sent] = threadRows([row], [], { asks: [] });
    expect(sent.comments).toEqual([
      { where: "hero", text: "tighter" },
      { where: "hero · B", text: "👍" },
      { where: "A", text: "👎" },
    ]);
  });

  it("drops a reaction on a variant that is gone when the draft moves on", () => {
    const variants = [{ variant: "B", parts: ["hero"], knobs: {} }] as unknown as VariantView[];
    const { draft } = carryOver(
      {
        version: 1,
        answers: {},
        mix: {},
        tuned: {},
        comments: reply.comments,
        others: {},
        notes: {},
        otherImages: {},
        noteImages: {},
      },
      { asks: [], knobs: {} },
      variants,
      2,
    );
    expect(draft.comments.map((c) => c.reaction ?? c.text)).toEqual(["tighter", "up"]);
  });
});

describe("badge", () => {
  it("prefixes the title with the count and strips it at 0", () => {
    expect(titleWithCount("Writer", 3)).toBe("(3) Writer");
    expect(titleWithCount("(3) Writer", 1)).toBe("(1) Writer");
    expect(titleWithCount("(3) Writer", 0)).toBe("Writer");
    expect(titleWithCount("(draft) Writer", 0)).toBe("(draft) Writer");
  });

  it("refetches on what can change the count, not on drafts", () => {
    const e = (type: string) => ({ type }) as FeedEvent;
    expect(countMayChange(e("mock-updated"))).toBe(true);
    expect(countMayChange(e("post-created"))).toBe(true);
    expect(countMayChange(e("comment-created"))).toBe(true);
    expect(countMayChange(e("draft-updated"))).toBe(false);
    expect(countMayChange(e("theme-changed"))).toBe(false);
  });
});
