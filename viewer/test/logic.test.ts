import { describe, expect, it } from "vitest";
import type { Ask } from "../../server/types.ts";
import type { CommentRow, MockDetail, VariantView } from "../src/api.ts";
import {
  carryOver,
  createHitRefs,
  draftKnobValues,
  frameVersion,
  mixOptions,
  overriddenAsks,
  reportIsCurrent,
  sendCount,
  summarizeReply,
  threadRows,
} from "../src/logic.ts";

const look: Ask = {
  id: "look",
  text: "Which look?",
  scope: "mock",
  options: [
    { id: "quiet", label: "Quiet", variant: "quiet" },
    { id: "dark", label: "Dark", variant: "dark" },
    { id: "editorial", label: "Editorial", variant: "editorial" },
  ],
  at: "t",
};
const trim: Ask = {
  id: "trim",
  text: "Trim above or below?",
  scope: "part",
  part: "trim",
  options: [
    { id: "above", label: "Above", set: { "trim.position": "top" } },
    { id: "below", label: "Below", set: { "trim.position": "bottom" } },
  ],
  at: "t",
};
const panel: Ask = {
  id: "panel",
  text: "Where do versions live?",
  scope: "state",
  state: "Versions open",
  options: [
    { id: "drawer", label: "Drawer" },
    { id: "margin", label: "Margin" },
  ],
  at: "t",
};

const mock = {
  asks: [look, trim, panel],
  states: ["Writing", "Lab open"],
  title: "Writer",
  knobs: { "trim.position": { type: "select", options: ["top", "bottom"] }, "body.size": 17 },
} as unknown as MockDetail;

const variant = (state: string, name: string, parts: string[]): VariantView =>
  ({
    postId: `${state}-${name}`,
    state,
    variant: name,
    status: "open",
    version: 1,
    parts,
    surfaces: [],
  }) as unknown as VariantView;

describe("summarizeReply", () => {
  it("names each answer by its topic, then mix, tuned and comments", () => {
    const text = summarizeReply(
      {
        answers: { look: "quiet", trim: "below", panel: "drawer" },
        mix: { versions: "editorial" },
        tuned: { "body.size": 18, "toast.show": false },
        comments: [{ part: "title", state: "Writing", text: "bigger" }],
      },
      mock,
    );
    expect(text).toBe(
      "Sent · look quiet · trim below · versions open drawer · mix versions · editorial's · tuned body.size 18, toast.show off · title: “bigger”",
    );
  });

  it("carries a plain verdict and its note", () => {
    const text = summarizeReply(
      {
        answers: {},
        mix: {},
        tuned: {},
        comments: [],
        text: "tighten it",
        decision: { kind: "revise", state: null, variant: "default" },
      },
      { asks: [] },
    );
    expect(text).toBe("Sent · revise default · “tighten it”");
  });

  it("joins multi answers", () => {
    const multi: Ask = { ...panel, id: "m", multi: true };
    expect(
      summarizeReply(
        { answers: { m: ["drawer", "margin"] }, mix: {}, tuned: {}, comments: [] },
        {
          asks: [multi],
        },
      ),
    ).toBe("Sent · versions open drawer + margin");
  });
});

describe("mixOptions", () => {
  const variants = [
    variant("Writing", "quiet", ["title", "body", "toast"]),
    variant("Writing", "dark", ["title", "body"]),
    variant("Writing", "editorial", ["title", "toast", "margin"]),
    variant("Lab open", "quiet", ["lab"]),
    variant("Lab open", "dark", ["lab"]),
  ];

  it("offers each other look for parts more than one look renders", () => {
    expect(mixOptions(mock, variants, "quiet")).toEqual([
      { part: "title", variant: "dark" },
      { part: "title", variant: "editorial" },
      { part: "body", variant: "dark" },
      { part: "toast", variant: "editorial" },
      { part: "lab", variant: "dark" },
    ]);
  });

  it("is empty before a look is picked, or without a Look ask", () => {
    expect(mixOptions(mock, variants, null)).toEqual([]);
    expect(mixOptions({ ...mock, asks: [trim] }, variants, "quiet")).toEqual([]);
  });

  it("ignores archived variants", () => {
    const archived = variants.map((v) =>
      v.variant === "editorial" ? ({ ...v, status: "archived" } as VariantView) : v,
    );
    expect(mixOptions(mock, archived, "quiet").some((o) => o.variant === "editorial")).toBe(false);
  });
});

describe("overriddenAsks", () => {
  it("flags an answered part ask whose part Mix borrows", () => {
    expect(overriddenAsks(mock.asks, { trim: "above" }, { trim: "dark" })).toEqual({
      trim: "dark",
    });
  });
  it("leaves unanswered asks and other parts alone", () => {
    expect(overriddenAsks(mock.asks, {}, { trim: "dark" })).toEqual({});
    expect(overriddenAsks(mock.asks, { trim: "above" }, { body: "dark" })).toEqual({});
  });
});

describe("carryOver", () => {
  const variants = [
    variant("Writing", "quiet", ["trim", "body"]),
    variant("Writing", "dark", ["body"]),
  ];
  it("keeps picks that still exist and flags the rest", () => {
    const draft = {
      version: 3,
      answers: { look: "editorial", trim: "below", gone: "x" },
      mix: { body: "dark", trim: "dark" },
      tuned: { "body.size": 19, "old.knob": 1 },
      comments: [
        { part: "body", state: "Writing", text: "keep" },
        { part: "vanished", state: "Writing", text: "drop" },
        { part: null, state: "Writing", text: "page-wide" },
      ],
    };
    const { draft: next, flagged } = carryOver(draft, mock, variants, 4);
    expect(next.version).toBe(4);
    expect(next.answers).toEqual({ trim: "below" });
    expect(flagged.sort()).toEqual(["gone", "look"]);
    expect(next.mix).toEqual({ body: "dark" });
    expect(next.tuned).toEqual({ "body.size": 19 });
    expect(next.comments.map((c) => c.text)).toEqual(["keep", "page-wide"]);
  });
});

describe("hit refs", () => {
  it("answers only the latest hover and every click once", () => {
    const refs = createHitRefs();
    const h1 = refs.hover();
    const c1 = refs.click();
    const h2 = refs.hover();
    expect(refs.resolve(h1)).toBe(null);
    expect(refs.resolve(h2)).toBe("hover");
    expect(refs.resolve(c1)).toBe("click");
    expect(refs.resolve(c1)).toBe(null);
    refs.leave();
    expect(refs.resolve(h2)).toBe(null);
    expect(refs.resolve("1")).toBe(null);
  });

  it("drops parts reports from a document that is not the loaded version", () => {
    expect(reportIsCurrent(2, 2)).toBe(true);
    expect(reportIsCurrent(2, 1)).toBe(false);
    expect(reportIsCurrent(2, null)).toBe(false);
  });
});

describe("versions and knobs", () => {
  it("shows each variant as it stood at a mock version", () => {
    const v = {
      version: 3,
      history: [{ version: 3 }, { version: 1 }],
    } as unknown as VariantView;
    expect(frameVersion(v, 3)).toBe(3);
    expect(frameVersion(v, 2)).toBe(1);
    expect(frameVersion(v, 5)).toBe(3);
  });

  it("layers defaults, picked knob sets and tuned values", () => {
    const values = draftKnobValues(
      mock,
      { "body.size": [16, 12, 20] },
      {
        version: 1,
        answers: { trim: "below" },
        mix: {},
        tuned: { "body.size": 19 },
        comments: [],
      },
    );
    expect(values).toEqual({ "trim.position": "bottom", "body.size": 19 });
    expect(draftKnobValues(mock, undefined, null)).toEqual({
      "trim.position": "top",
      "body.size": 17,
    });
  });

  it("counts everything a Send carries", () => {
    expect(
      sendCount({
        version: 1,
        answers: { a: "x", b: ["y"] },
        mix: { p: "v" },
        tuned: { k: 1 },
        comments: [{ part: null, state: null, text: "c" }],
      }),
    ).toBe(5);
  });
});

describe("threadRows", () => {
  const comment = (over: Partial<CommentRow>): CommentRow =>
    ({
      id: "c",
      seq: 1,
      sessionId: "s",
      mockId: "m",
      postId: null,
      author: "designer",
      text: "",
      createdAt: "2026-01-01T00:00:02Z",
      kind: "comment",
      anchors: [],
      postVersion: null,
      viewport: null,
      seen: false,
      ...over,
    }) as CommentRow;
  const variants = [
    {
      version: 2,
      updatedAt: "2026-01-01T00:00:05Z",
      history: [
        { version: 2, at: "2026-01-01T00:00:05Z" },
        { version: 1, at: "2026-01-01T00:00:01Z" },
      ],
    },
  ] as unknown as VariantView[];

  it("folds an ask or reply into the publish before it", () => {
    const rows = threadRows(
      [
        comment({
          id: "a",
          kind: "ask",
          text: "Which look?\nTrim?",
          createdAt: "2026-01-01T00:00:02Z",
        }),
        comment({
          id: "r",
          author: "user",
          kind: "reply",
          seen: true,
          createdAt: "2026-01-01T00:00:03Z",
          payload: {
            mockId: "m",
            version: 1,
            answers: { look: "dark" },
            mix: {},
            tuned: {},
            comments: [],
          },
        }),
        comment({ id: "t", text: "Done.", createdAt: "2026-01-01T00:00:06Z" }),
      ],
      variants,
      mock,
    );
    expect(rows.map((r) => [r.who, r.text, r.quote, r.seen])).toEqual([
      ["agent", "published v1 · asked 2", undefined, undefined],
      ["you", "Sent · look dark", undefined, true],
      ["agent", "published v2 · replied:", "Done.", undefined],
    ]);
  });
});
