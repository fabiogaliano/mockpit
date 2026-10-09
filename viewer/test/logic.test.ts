import { describe, expect, it } from "vitest";
import type { Ask } from "../../server/types.ts";
import type { CommentRow, DraftInput, MockDetail, VariantView } from "../src/api.ts";
import {
  askPick,
  carryOver,
  draftIsEmpty,
  emptyDraft,
  pickInDraft,
  tuneVisible,
  unanswered,
  createHitRefs,
  draftKnobValues,
  fitThumb,
  frameVersion,
  type KnobContext,
  knobAsk,
  anchorPoint,
  layoutPins,
  markPins,
  mixOptions,
  nextMark,
  overriddenAsks,
  partPinSpot,
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
      "Sent · look quiet · trim below · versions open drawer · mix versions · editorial's · tuned body.size 18, toast.show off · 1 comment",
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
    width: 820,
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
      others: { panel: "a tab", gone: "x" },
      notes: { look: "on mobile", gone: "y" },
    };
    const { draft: next, flagged } = carryOver(draft, mock, variants, 4);
    expect(next.version).toBe(4);
    expect(next.answers).toEqual({ trim: "below" });
    expect(flagged.sort()).toEqual(["gone", "look"]);
    expect(next.mix).toEqual({ body: "dark" });
    expect(next.tuned).toEqual({ "body.size": 19 });
    expect(next.comments.map((c) => c.text)).toEqual(["keep", "page-wide"]);
    expect(next.others).toEqual({ panel: "a tab" });
    expect(next.notes).toEqual({ look: "on mobile" });
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
    const m1 = refs.mark();
    expect(refs.resolve(m1)).toBe("mark");
    expect(refs.resolve(m1)).toBe(null);
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
        others: { panel: "a tab" },
        notes: {},
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
        others: {},
        notes: {},
      }),
    ).toBe(5);
  });

  it("counts a question once, however it was answered", () => {
    const d = {
      ...emptyDraft(1),
      answers: { a: "x" },
      others: { b: "mine" },
      notes: { a: "n", c: "n" },
    };
    expect(sendCount(d)).toBe(3);
    expect(draftIsEmpty(d)).toBe(false);
    expect(draftIsEmpty({ ...emptyDraft(1), notes: { c: "only a note" } })).toBe(false);
    expect(draftIsEmpty(emptyDraft(1))).toBe(true);
  });
});

describe("marks", () => {
  const part = (name: string, x: number, y: number, w: number, h: number): PartBox => ({
    name,
    label: name,
    box: { x, y, w, h },
    visible: true,
    depth: 0,
    order: 0,
  });
  const doc = (...parts: PartBox[]) => ({ parts, width: 800, height: 400 });
  // Left at (200, 100) on the title, whose box was 100,80 200×40: a quarter in, half down.
  const onTitle = {
    part: "title",
    state: "At rest",
    text: "bolder",
    anchor: { offset: [0.25, 0.25] as [number, number], box: [100, 80, 200, 40] },
  };

  it("follows the part to its live box, at the same relative spot", () => {
    expect(anchorPoint(onTitle, doc(part("title", 100, 80, 200, 40)))).toEqual({
      x: 200,
      y: 100,
      moved: false,
    });
    expect(anchorPoint(onTitle, doc(part("title", 300, 200, 400, 80)))).toEqual({
      x: 500,
      y: 240,
      moved: false,
    });
  });

  it("stays inside the part when the document around it grew", () => {
    const p = anchorPoint(onTitle, { ...doc(part("title", 100, 80, 200, 40)), height: 2000 });
    expect(p).toEqual({ x: 200, y: 120, moved: false });
  });

  it("falls back to the last box, flagged, when the part is gone", () => {
    expect(anchorPoint(onTitle, doc(part("body", 0, 0, 800, 400)))).toEqual({
      x: 200,
      y: 100,
      moved: true,
    });
    const hidden = { ...part("title", 0, 0, 10, 10), visible: false };
    expect(anchorPoint(onTitle, doc(hidden))?.moved).toBe(true);
  });

  it("places a page mark by its offset, or its box without one", () => {
    const page = { part: null, anchor: { offset: [0.5, 0.5] as [number, number] } };
    expect(anchorPoint(page, doc())).toEqual({ x: 400, y: 200, moved: false });
    const boxOnly = { part: null, anchor: { box: [10, 20, 30, 40] } };
    expect(anchorPoint(boxOnly, doc())).toEqual({ x: 25, y: 40, moved: false });
    expect(anchorPoint({ part: null }, doc())).toBe(null);
  });

  it("numbers marks across the draft and shows only the state on stage", () => {
    const comments = [
      { part: "title", state: "At rest", text: "plain part comment" },
      onTitle,
      {
        part: null,
        state: "Lab open",
        text: "here",
        anchor: { offset: [0.1, 0.1] as [number, number] },
      },
      { ...onTitle, text: "again" },
    ];
    const pins = markPins(comments, "At rest", doc(part("title", 100, 80, 200, 40)));
    expect(pins.map((p) => [p.n, p.index, p.text])).toEqual([
      [1, 1, "bolder"],
      [3, 3, "again"],
    ]);
    expect(markPins(comments, "Lab open", doc()).map((p) => p.n)).toEqual([2]);
    expect(markPins(comments, "At rest", undefined)).toEqual([]);
    expect(nextMark(comments)).toBe(4);
    expect(nextMark([])).toBe(1);
  });
});

describe("notes and Other…", () => {
  const multi: Ask = { ...panel, id: "m", multi: true };

  it("keeps Other or one option on a single ask, and toggles it on a multi ask", () => {
    let r = pickInDraft({ ...emptyDraft(1), answers: { panel: "drawer" } }, panel, null, false);
    expect(r.otherOpen).toBe(true);
    expect(r.draft.answers).toEqual({});
    r = pickInDraft({ ...r.draft, others: { panel: "a tab" } }, panel, "margin", r.otherOpen);
    expect(r).toMatchObject({
      otherOpen: false,
      draft: { answers: { panel: "margin" }, others: {} },
    });

    r = pickInDraft({ ...emptyDraft(1), answers: { m: ["drawer"] } }, multi, null, false);
    expect(r.otherOpen).toBe(true);
    expect(r.draft.answers).toEqual({ m: ["drawer"] });
    r = pickInDraft({ ...r.draft, others: { m: "tab" } }, multi, "margin", true);
    expect(r.draft.answers).toEqual({ m: ["drawer", "margin"] });
    expect(r.draft.others).toEqual({ m: "tab" });
    r = pickInDraft(r.draft, multi, null, true);
    expect(r).toMatchObject({ otherOpen: false, draft: { others: {} } });
  });

  it("reads the draft over what was sent; a note on its own", () => {
    const sent = { ...panel, answer: "drawer", note: "old" };
    expect(askPick(sent, null)).toEqual({ ids: ["drawer"], other: undefined, note: "old" });
    expect(askPick(sent, { ...emptyDraft(1), others: { panel: "tab" } })).toEqual({
      ids: [],
      other: "tab",
      note: "old",
    });
    expect(askPick(sent, { ...emptyDraft(1), notes: { panel: "new" } }).ids).toEqual(["drawer"]);
  });

  it("counts a write-in or a note alone as answering; a sent one closes the ask", () => {
    const m = { ...mock, asks: [look, trim, panel] } as MockDetail;
    const owed = (d: Partial<DraftInput>) =>
      unanswered(m, { ...emptyDraft(1), ...d }).map((a) => a.id);
    expect(owed({})).toEqual(["look", "trim", "panel"]);
    expect(owed({ others: { look: "both" }, notes: { trim: "neither, because…" } })).toEqual([
      "panel",
    ]);
    const sent = { ...m, asks: [{ ...look, other: "both" }, { ...trim, note: "n" }, panel] };
    expect(unanswered(sent as MockDetail, null).map((a) => a.id)).toEqual(["panel"]);
  });

  it("summarizes a write-in and a note-only answer, and lists notes under their question", () => {
    const payload = {
      mockId: "m",
      version: 1,
      answers: { look: "dark" },
      mix: {},
      tuned: {},
      comments: [],
      others: { panel: "a tab" },
      notes: { look: "on desktop", trim: "neither fits" },
    };
    expect(summarizeReply(payload, mock)).toBe(
      "Sent · look dark · trim noted · versions open “a tab”",
    );
    const rows = threadRows(
      [
        {
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
          seen: false,
          payload,
        } as CommentRow,
      ],
      [],
      mock,
    );
    expect(rows[0].notes).toEqual([
      { ask: "Which look?", text: "on desktop" },
      { ask: "Trim above or below?", text: "neither fits" },
    ]);
  });
});

describe("tuneVisible", () => {
  const bare = { knobs: {}, parts: [], asks: [] } as unknown as MockDetail;
  it("hides Tune when nothing is tunable or markable", () => {
    expect(tuneVisible(bare, [])).toBe(false);
    expect(tuneVisible(bare, [{ knobs: {} } as VariantView])).toBe(false);
    expect(tuneVisible({ ...bare, parts: [{ state: null, parts: [] }] } as MockDetail, [])).toBe(
      false,
    );
  });
  it("shows it for page knobs, a variant's knobs, a marked part, or a part ask", () => {
    expect(tuneVisible({ ...bare, knobs: { size: 16 } } as MockDetail, [])).toBe(true);
    expect(tuneVisible(bare, [{ knobs: { "body.size": 16 } } as unknown as VariantView])).toBe(
      true,
    );
    expect(
      tuneVisible(
        { ...bare, parts: [{ state: "B", parts: [{ name: "title" }] }] } as unknown as MockDetail,
        [],
      ),
    ).toBe(true);
    expect(tuneVisible({ ...bare, asks: [trim] } as unknown as MockDetail, [])).toBe(true);
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
            comments: [
              { part: "title", state: "At rest", text: "bolder" },
              { part: null, state: null, text: "here" },
            ],
          },
        }),
        comment({ id: "t", text: "Done.", createdAt: "2026-01-01T00:00:06Z" }),
      ],
      variants,
      mock,
    );
    expect(rows.map((r) => [r.who, r.text, r.quote, r.seen])).toEqual([
      ["agent", "published v1 · asked 2", undefined, undefined],
      ["you", "Sent · look dark · 2 comments", undefined, true],
      ["agent", "published v2 · replied:", "Done.", undefined],
    ]);
    expect(rows[1].comments).toEqual([
      { where: "title · At rest", text: "bolder" },
      { where: "page", text: "here" },
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

describe("partPinSpot", () => {
  const box = { x: 40, y: 30, w: 600, h: 20 };
  it("sits past the top-right corner, centred on the top edge, clear of the box", () => {
    const p = partPinSpot(box, 800);
    expect(p).toEqual({ x: 642, y: 19 });
    expect(p.x).toBeGreaterThanOrEqual(box.x + box.w);
  });
  it("moves above the corner when there is no room on the right", () => {
    const p = partPinSpot({ ...box, w: 750 }, 800);
    expect(p).toEqual({ x: 779, y: 6 });
    expect(p.y + 22).toBeLessThanOrEqual(box.y);
  });
  it("stays inside the overlay at its top edge", () => {
    expect(partPinSpot({ x: 0, y: 0, w: 100, h: 20 }, 800)).toEqual({ x: 102, y: 2 });
  });
});

describe("fitThumb", () => {
  it("fills the width and is as tall as a short page, no band below", () => {
    const f = fitThumb(164, 123, 452, null, 820);
    expect(f.s).toBeCloseTo(0.2);
    expect(f.h).toBe(90);
    expect(f.h).toBeLessThanOrEqual(452 * f.s);
    expect(f.frameH).toBe(452);
  });
  it("caps a tall page at the picture height", () => {
    expect(fitThumb(164, 123, 2000, null, 820).h).toBe(123);
  });
  it("uses the cap until the page reports its height", () => {
    expect(fitThumb(164, 123, null, null, 820).h).toBe(123);
  });
  it("never leaves a band beside or under a focused part", () => {
    const f = fitThumb(164, 123, 452, { x: 40, y: 400, w: 200, h: 30 }, 820);
    expect(f.s).toBeGreaterThanOrEqual(164 / 820);
    expect(f.x).toBeLessThanOrEqual(0);
    expect(f.x + 820 * f.s).toBeGreaterThanOrEqual(164 - 1e-9);
    expect(f.y).toBeLessThanOrEqual(0);
    expect(f.y + 452 * f.s).toBeGreaterThanOrEqual(f.h - 1e-9);
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
