import { describe, expect, it } from "vitest";
import type { Ask } from "../../server/types.ts";
import type { CommentRow, MockDetail, VariantView } from "../src/api.ts";
import {
  carryOver,
  createHitRefs,
  draftKnobValues,
  frameVersion,
  type KnobContext,
  knobAsk,
  layoutPins,
  mixOptions,
  overriddenAsks,
  type PartBox,
  type PartsReport,
  reportIsCurrent,
  resolveKnobs,
  safeColor,
  sendCount,
  summarizeReply,
  threadRows,
  tuneComponents,
  tunedLines,
  tuneWrite,
  untunedValue,
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
  const box = (name: string, w: number, h: number, label = name): PartBox => ({
    name,
    label,
    box: { x: 0, y: 0, w, h },
    visible: true,
    depth: 0,
    order: 0,
  });
  const report = (...parts: PartBox[]): PartsReport => ({
    version: 1,
    parts,
    height: 600,
    scroll: { x: 0, y: 0 },
  });
  // quiet and dark draw title and body alike (only colors change); editorial's
  // title is larger and its toast is relabelled; dark's lab panel is wider.
  const reports: Record<string, PartsReport> = {
    "Writing/quiet": report(box("title", 600, 34), box("body", 600, 120), box("toast", 120, 30)),
    "Writing/dark": report(box("title", 600, 34), box("body", 600.4, 120)),
    "Writing/editorial": report(
      box("title", 600, 48),
      box("toast", 120, 30, "Saved"),
      box("margin", 80, 400),
    ),
    "Lab open/quiet": report(box("lab", 220, 400)),
    "Lab open/dark": report(box("lab", 260, 400)),
  };
  const reportOf = (state: string | null, v: string) => reports[`${state}/${v}`];

  it("offers another look's part only where it is drawn differently", () => {
    expect(mixOptions(mock, variants, "quiet", reportOf)).toEqual([
      { part: "title", variant: "editorial" },
      { part: "toast", variant: "editorial" },
      { part: "lab", variant: "dark" },
    ]);
  });

  it("offers nothing for a frame that has not reported yet", () => {
    const partial = (state: string | null, v: string) =>
      v === "editorial" ? undefined : reportOf(state, v);
    expect(mixOptions(mock, variants, "quiet", partial)).toEqual([
      { part: "lab", variant: "dark" },
    ]);
  });

  it("is empty before a look is picked, or without a Look ask", () => {
    expect(mixOptions(mock, variants, null, reportOf)).toEqual([]);
    expect(mixOptions({ ...mock, asks: [trim] }, variants, "quiet", reportOf)).toEqual([]);
  });

  it("ignores archived variants", () => {
    const archived = variants.map((v) =>
      v.variant === "editorial" ? ({ ...v, status: "archived" } as VariantView) : v,
    );
    expect(
      mixOptions(mock, archived, "quiet", reportOf).some((o) => o.variant === "editorial"),
    ).toBe(false);
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

describe("tune", () => {
  const knobs = {
    size: [17, 14, 22, 0.5],
    "body.size": [17, 14, 22, 0.5],
    "body.measure": 64,
    "trim.position": { type: "select", options: ["top", "bottom"], value: "top" },
    "title.weight": { type: "slider", value: 500, min: 300, max: 700 },
  } as KnobContext["knobs"];
  const ctx = (over: Partial<KnobContext> = {}): KnobContext => ({
    knobs,
    asks: [look, trim, panel],
    answers: {},
    tuned: {},
    ...over,
  });

  it("starts each knob at its declared default", () => {
    expect(resolveKnobs(ctx())).toEqual({
      size: 17,
      "body.size": 17,
      "body.measure": 64,
      "trim.position": "top",
      "title.weight": 500,
    });
  });

  it("lets a part knob follow the global it refines until it is tuned itself", () => {
    const followed = resolveKnobs(ctx({ tuned: { size: 19 } }));
    expect(followed["body.size"]).toBe(19);
    expect(untunedValue("body.size", ctx({ tuned: { size: 19, "body.size": 16 } }))).toBe(19);
    const own = resolveKnobs(ctx({ tuned: { size: 19, "body.size": 16 } }));
    expect(own["body.size"]).toBe(16);
    expect(own.size).toBe(19);
  });

  it("takes an answered knob-set option over the default, and a tuned value over both", () => {
    expect(resolveKnobs(ctx({ answers: { trim: "below" } }))["trim.position"]).toBe("bottom");
    const v = resolveKnobs(ctx({ answers: { trim: "below" }, tuned: { "trim.position": "top" } }));
    expect(v["trim.position"]).toBe("top");
  });

  it("drops a tuned value that is back at its untuned value", () => {
    expect(tuneWrite("title.weight", 600, ctx())).toEqual({
      kind: "tuned",
      path: "title.weight",
      value: 600,
    });
    expect(tuneWrite("title.weight", 500, ctx({ tuned: { "title.weight": 600 } }))).toEqual({
      kind: "tuned",
      path: "title.weight",
      value: undefined,
    });
    // Back at the inherited global counts as untuned too.
    expect(tuneWrite("body.size", 19, ctx({ tuned: { size: 19, "body.size": 16 } }))).toEqual({
      kind: "tuned",
      path: "body.size",
      value: undefined,
    });
  });

  it("answers the ask a discrete knob is bound to instead of tuning it", () => {
    expect(knobAsk("trim.position", knobs, [look, trim])).toBe(trim);
    expect(knobAsk("title.weight", knobs, [look, trim])).toBeUndefined();
    expect(tuneWrite("trim.position", "bottom", ctx())).toEqual({
      kind: "answer",
      ask: trim,
      option: "below",
    });
    // A value no option sets is a tuned value.
    const wider = {
      ...knobs,
      "trim.position": { type: "select", options: ["top", "bottom", "side"] },
    };
    expect(
      tuneWrite("trim.position", "side", ctx({ knobs: wider as KnobContext["knobs"] })),
    ).toEqual({ kind: "tuned", path: "trim.position", value: "side" });
  });

  it("lists Look, then the parts with knobs or an ask", () => {
    const m = {
      asks: [look, trim],
      parts: [
        { state: "Writing", parts: [{ name: "trim" }, { name: "title" }, { name: "menu" }] },
        { state: "Lab open", parts: [{ name: "body" }, { name: "lab" }] },
      ],
    } as unknown as MockDetail;
    expect(tuneComponents(m, knobs).map((c) => [c.part, c.paths])).toEqual([
      [null, ["size"]],
      ["trim", ["trim.position"]],
      ["title", ["title.weight"]],
      ["body", ["body.size", "body.measure"]],
    ]);
  });

  it("copies tuned values as path: value lines and keeps image colors out", () => {
    expect(tunedLines({ "body.size": 18, "toast.show": false })).toBe(
      "body.size: 18\ntoast.show: false",
    );
    expect(safeColor("#fff")).toBe(true);
    expect(safeColor("linear-gradient(#000, #fff)")).toBe(true);
    expect(safeColor("url(//example.com/x.png)")).toBe(false);
    expect(safeColor("image-set(x 1x)")).toBe(false);
  });
});

describe("layoutPins", () => {
  it("lines pins that want the same corner up in a row", () => {
    const pins = layoutPins([
      { index: 0, x: -10, y: -10 },
      { index: 1, x: -10, y: -10 },
      { index: 2, x: -10, y: -10 },
    ]);
    expect(pins.map((p) => [p.x, p.y])).toEqual([
      [-10, -10],
      [18, -10],
      [46, -10],
    ]);
  });

  it("leaves pins apart alone and steps around every placed pin", () => {
    const pins = layoutPins([
      { index: 0, x: 100, y: 40 },
      { index: 1, x: 300, y: 40 },
      { index: 2, x: 100, y: 200 },
      { index: 3, x: 105, y: 45 },
      { index: 4, x: 100, y: 40 },
    ]);
    expect(pins.map((p) => p.x)).toEqual([100, 300, 100, 133, 184]);
    for (const a of pins)
      for (const b of pins)
        if (a !== b) expect(Math.abs(a.x - b.x) >= 22 || Math.abs(a.y - b.y) >= 22).toBe(true);
  });
});
