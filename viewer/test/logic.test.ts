import { describe, expect, it } from "vitest";
import type { Ask } from "../../server/types.ts";
import type { CommentRow, DraftInput, MockDetail, VariantView } from "../src/api.ts";
import {
  askPick,
  builtinAsks,
  carryOver,
  liveVariants,
  needsBuiltinAsk,
  draftIsEmpty,
  emptyDraft,
  pickInDraft,
  tapPicks,
  setAskField,
  tuneVisible,
  unanswered,
  clampZoom,
  createHitRefs,
  defaultDeviceWidth,
  DESKTOP_W,
  DEVICE_WIDTHS,
  panelBeside,
  PANEL_W,
  readDeviceWidth,
  zoomScroll,
  draftKnobValues,
  fitThumb,
  frameVersion,
  type KnobContext,
  knobAsk,
  anchorPoint,
  layoutPins,
  markPins,
  mixOptions,
  mixSettled,
  pruneMix,
  nextMark,
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
  flowKey,
  nextOwedMock,
  queueOrder,
  reviewRows,
  swipeStep,
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

  it("names a built-in answer by the ask it stood for", () => {
    const text = summarizeReply(
      { answers: { variant: "b", "variant:Lab open": "a" }, mix: {}, tuned: {}, comments: [] },
      { asks: [] },
    );
    expect(text).toBe("Sent · look b · lab open a");
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
  it("drops a part an answered mock- or state-wide ask settled", () => {
    const wide = mixSettled(
      [{ ...accent, options: [{ id: "big", label: "Big title", set: { "title.size": 30 } }] }],
      { accent: "big" },
    );
    expect(mixOptions(mock, variants, "quiet", reportOf, wide).map((o) => o.part)).toEqual([
      "toast",
      "lab",
    ]);
    const narrow = mixSettled(
      [
        {
          ...accent,
          scope: "state",
          state: "Lab open",
          options: [{ id: "big", label: "Big title", set: { "title.size": 30 } }],
        },
      ],
      { accent: "big" },
    );
    // The title is decided in Lab open only; Writing still offers it.
    expect(mixOptions(mock, variants, "quiet", reportOf, narrow).map((o) => o.part)).toContain(
      "title",
    );
  });

  it("never offers a part that wraps the whole frame, in the picked look or the donor", () => {
    const pickedWhole = (state: string | null, v: string) =>
      state === "Lab open" ? report(box("lab", v === "dark" ? 800 : 760, 590)) : reportOf(state, v);
    expect(mixOptions(mock, variants, "quiet", pickedWhole).map((o) => o.part)).not.toContain(
      "lab",
    );
    const donorWhole = (state: string | null, v: string) =>
      state === "Lab open" && v === "dark" ? report(box("lab", 800, 590)) : reportOf(state, v);
    expect(mixOptions(mock, variants, "quiet", donorWhole).map((o) => o.part)).not.toContain("lab");
  });

  it("offers nothing where a worded answer closed Mix", () => {
    const worded = mixSettled([accent], { accent: "olive" });
    expect(mixOptions(mock, variants, "quiet", reportOf, worded)).toEqual([]);
    const inLab = mixSettled([{ ...accent, scope: "state", state: "Lab open" }], {
      accent: "olive",
    });
    expect(mixOptions(mock, variants, "quiet", reportOf, inLab).map((o) => o.part)).toEqual([
      "title",
      "toast",
    ]);
  });
});

const accent: Ask = {
  id: "accent",
  text: "Which accent means progress?",
  scope: "mock",
  options: [
    { id: "olive", label: "Olive" },
    { id: "orange", label: "Orange" },
    { id: "warm", label: "Warm", set: { accent: "#e8590c" } },
  ],
  at: "t",
};

describe("mixSettled", () => {
  const none = { decided: [], closed: [] };

  it("a worded answer closes Mix in its scope; a global knob set does not", () => {
    expect(mixSettled([look, accent], { look: "quiet", accent: "olive" })).toEqual({
      decided: [],
      closed: [null],
    });
    expect(mixSettled([accent], {}, { accent: "teal" }).closed).toEqual([null]);
    expect(mixSettled([accent], { accent: "warm" })).toEqual(none);
  });

  it("a part knob set, an answered part ask or a tuned part knob decides the part", () => {
    const state: Ask = {
      ...accent,
      scope: "state",
      state: "Lab open",
      options: [{ id: "w", label: "Wide", set: { "lab.width": 300, accent: "#000" } }],
    };
    expect(mixSettled([state], { accent: "w" }).decided).toEqual([
      { part: "lab", state: "Lab open" },
    ]);
    expect(mixSettled([trim], { trim: "above" }).decided).toEqual([{ part: "trim", state: null }]);
    expect(mixSettled([], {}, {}, { "body.size": 18, size: 3 }).decided).toEqual([
      { part: "body", state: null },
    ]);
  });

  it("unanswered asks and the Look ask never count", () => {
    expect(mixSettled([accent, trim], {})).toEqual(none);
    expect(mixSettled([look], { look: "dark" })).toEqual(none);
  });
});

describe("pruneMix", () => {
  const statesOf = (part: string) => (part === "lab" ? ["Lab open"] : ["Writing", "Lab open"]);
  const mix = { title: "editorial", lab: "dark" };

  it("drops a borrow the user's later choice decided, keeps the rest", () => {
    const later = mixSettled([trim], { trim: "above" }, {}, { "title.size": 40 });
    expect(pruneMix({ ...mix, trim: "dark" }, later, statesOf)).toEqual({ lab: "dark" });
  });

  it("drops a borrow from any state a worded answer closed", () => {
    const closedLab = mixSettled([{ ...accent, scope: "state", state: "Lab open" }], {
      accent: "olive",
    });
    expect(pruneMix(mix, closedLab, statesOf)).toEqual({});
    const closedWriting = mixSettled([{ ...accent, scope: "state", state: "Writing" }], {
      accent: "olive",
    });
    expect(pruneMix(mix, closedWriting, statesOf)).toEqual({ lab: "dark" });
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
      otherImages: {},
      noteImages: {},
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
        otherImages: {},
        noteImages: {},
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
        otherImages: {},
        noteImages: {},
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

  it("flags a mark placed at another stage width", () => {
    const at = (width?: number) => ({
      part: null,
      state: null,
      text: "x",
      anchor: { offset: [0.5, 0.5] as [number, number], ...(width ? { width } : {}) },
    });
    const pins = markPins([at(390), at(800), at()], null, doc());
    expect(pins.map((p) => p.placedAt)).toEqual([390, null, null]);
  });
});

describe("the stage on any screen", () => {
  it("opens a phone at phone width and everything else at desktop width", () => {
    expect(defaultDeviceWidth(390, true)).toBe(390);
    expect(defaultDeviceWidth(744, true)).toBe(DESKTOP_W);
    expect(defaultDeviceWidth(390, false)).toBe(DESKTOP_W);
  });

  it("remembers only a width it still offers", () => {
    expect(readDeviceWidth("744")).toBe(744);
    expect(readDeviceWidth("1280")).toBe(1280);
    expect(readDeviceWidth("500")).toBe(null);
    expect(readDeviceWidth(null)).toBe(null);
    expect(readDeviceWidth("wide")).toBe(null);
    expect(DEVICE_WIDTHS.map((d) => d.w)).toContain(DESKTOP_W);
  });

  it("keeps the panel beside the stage only while the stage stays readable", () => {
    expect(panelBeside(1133)).toBe(true);
    expect(panelBeside(744)).toBe(false);
    expect(panelBeside(390)).toBe(false);
    expect(panelBeside(PANEL_W + 72 + 480)).toBe(true);
    expect(panelBeside(PANEL_W + 72 + 479)).toBe(false);
  });

  it("clamps zoom between fit (never above 100%) and 200%", () => {
    expect(clampZoom(5, 0.5)).toBe(2);
    expect(clampZoom(0.1, 0.5)).toBe(0.5);
    expect(clampZoom(1.3, 0.5)).toBe(1.3);
    // A design narrower than the screen fits at 100%, and may still shrink to it.
    expect(clampZoom(0.8, 1.6)).toBe(1);
    expect(clampZoom(Number.NaN, 0.5)).toBe(0.5);
  });

  it("keeps the point under a pinch still as the scale changes", () => {
    // At 1×, scrolled 100 with the pinch 50px in: the point is at 150. At 2× it
    // is at 300, so the scroll that keeps it 50px in is 250.
    expect(zoomScroll(100, 50, 1, 2)).toBe(250);
    expect(zoomScroll(250, 50, 2, 1)).toBe(100);
    expect(zoomScroll(0, 50, 2, 1)).toBe(0);
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
          delivered: false,
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

describe("tapPicks", () => {
  const tap = { hover: false, previewing: false, canPreview: true, unpicks: false };
  it("on touch, an option with a preview previews first and picks on the second tap", () => {
    expect(tapPicks(tap)).toBe(false);
    expect(tapPicks({ ...tap, previewing: true })).toBe(true);
  });
  it("on touch, an option with nothing to preview picks on the first tap", () => {
    expect(tapPicks({ ...tap, canPreview: false })).toBe(true);
  });
  it("on touch, taking back a multi pick needs one tap", () => {
    expect(tapPicks({ ...tap, unpicks: true })).toBe(true);
  });
  it("with hover, a click always picks", () => {
    expect(tapPicks({ ...tap, hover: true })).toBe(true);
  });
});

describe("attached images", () => {
  it("keeps a write-in or a note while it has text or images, and drops it once both are empty", () => {
    let d = setAskField(emptyDraft(1), "panel", "note", "", ["a"]);
    expect(d.notes).toEqual({ panel: "" });
    expect(d.noteImages).toEqual({ panel: ["a"] });
    expect(draftIsEmpty(d)).toBe(false);
    d = setAskField(d, "panel", "note", "like this", []);
    expect(d.notes).toEqual({ panel: "like this" });
    expect(d.noteImages).toEqual({});
    d = setAskField(d, "panel", "note", "  ", []);
    expect(d.notes).toEqual({});
    expect(setAskField(emptyDraft(1), "panel", "other", "", ["a"]).otherImages).toEqual({
      panel: ["a"],
    });
  });

  it("drops a write-in's images with the write-in when an option is picked", () => {
    const d = setAskField(emptyDraft(1), "panel", "other", "", ["a"]);
    const r = pickInDraft(d, panel, "margin", true);
    expect(r.draft.others).toEqual({});
    expect(r.draft.otherImages).toEqual({});
  });

  it("shows a reply's images under their question, and an image-only note as no text", () => {
    const payload = {
      mockId: "m",
      version: 1,
      answers: {},
      mix: {},
      tuned: {},
      comments: [],
      others: { panel: "" },
      notes: { look: "" },
      otherImages: { panel: ["a"] },
      noteImages: { look: ["b", "c"] },
    };
    expect(summarizeReply(payload, mock)).toBe("Sent · look noted · versions open an image");
    const [row] = threadRows(
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
          delivered: false,
          payload,
        } as CommentRow,
      ],
      [],
      mock,
    );
    expect(row.notes).toBeUndefined();
    expect(row.images).toEqual([
      { ask: panel.text, ids: ["a"] },
      { ask: "Which look?", ids: ["b", "c"] },
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
      delivered: false,
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
          delivered: true,
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
    expect(rows.map((r) => [r.who, r.text, r.quote, r.delivered])).toEqual([
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
    // Never past the overlay's right edge, which clips.
    expect(p).toEqual({ x: 776, y: 6 });
    expect(p.y + 22).toBeLessThanOrEqual(box.y);
  });
  it("keeps a finger's wider hit area inside the overlay too", () => {
    const edge = (44 - 28) / 2;
    const p = partPinSpot({ x: 0, y: 0, w: 800, h: 20 }, 800, 28, edge);
    expect(p).toEqual({ x: 800 - edge - 28, y: edge });
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

describe("the built-in Which one?", () => {
  const row = (state: string | null, variant: string, status = "open") => ({
    state,
    variant,
    status: status as VariantView["status"],
  });
  const opts = (a: Ask) => a.options.map((o) => [o.id, o.label, o.variant]);

  it("counts only non-archived variants of the state as live", () => {
    const vs = [row("A", "x"), row("A", "y", "archived"), row("A", "z", "accepted"), row("B", "x")];
    expect(liveVariants(vs, "A")).toEqual(["x", "z"]);
    expect(liveVariants(vs, "B")).toEqual(["x"]);
  });

  it("needs one for 2+ live variants no applicable agent ask binds", () => {
    const vs = [row(null, "a"), row(null, "b")];
    expect(needsBuiltinAsk([], vs, null)).toBe(true);
    expect(needsBuiltinAsk([], [row(null, "a"), row(null, "b", "archived")], null)).toBe(false);
    const binds: Ask = {
      id: "pick",
      text: "?",
      scope: "mock",
      options: [
        { id: "1", label: "A", variant: "a" },
        { id: "2", label: "B", variant: "b" },
      ],
      at: "t",
    };
    expect(needsBuiltinAsk([binds], vs, null)).toBe(false);
    // Binding only some of them leaves the choice unasked.
    expect(needsBuiltinAsk([{ ...binds, options: binds.options.slice(0, 1) }], vs, null)).toBe(
      true,
    );
    // A part ask is a mix, not a verdict; a state ask covers only its own state.
    expect(needsBuiltinAsk([{ ...binds, scope: "part", part: "title" }], vs, null)).toBe(true);
    const sv = [row("A", "a"), row("A", "b"), row("B", "a"), row("B", "b")];
    const onA: Ask = { ...binds, scope: "state", state: "A" };
    expect(needsBuiltinAsk([onA], sv, "A")).toBe(false);
    expect(needsBuiltinAsk([onA], sv, "B")).toBe(true);
  });

  it("is one mock-wide ask when the names line up in every state", () => {
    const vs = ["A", "B"].flatMap((st) => [row(st, "a"), row(st, "b")]);
    const asks = builtinAsks({ asks: [], states: ["A", "B"] }, vs);
    expect(asks).toHaveLength(1);
    expect([asks[0].id, asks[0].scope, asks[0].state, asks[0].text]).toEqual([
      "variant",
      "mock",
      undefined,
      "Which one?",
    ]);
    expect(opts(asks[0])).toEqual([
      ["a", "a", "a"],
      ["b", "b", "b"],
    ]);
    expect(builtinAsks({ asks: [], states: [] }, [row(null, "a"), row(null, "b")])[0].id).toBe(
      "variant",
    );
  });

  it("is one ask per state when the names differ or a state is covered", () => {
    const vs = [row("A", "a"), row("A", "b"), row("B", "a"), row("B", "c"), row("C", "solo")];
    const asks = builtinAsks({ asks: [], states: ["A", "B", "C"] }, vs);
    expect(asks.map((a) => [a.id, a.scope, a.state, opts(a).map((o) => o[0])])).toEqual([
      ["variant:A", "state", "A", ["a", "b"]],
      ["variant:B", "state", "B", ["a", "c"]],
    ]);
    const same = ["A", "B"].flatMap((st) => [row(st, "a"), row(st, "b")]);
    const onA: Ask = {
      id: "s",
      text: "?",
      scope: "state",
      state: "A",
      options: [
        { id: "a", label: "a", variant: "a" },
        { id: "b", label: "b", variant: "b" },
      ],
      at: "t",
    };
    expect(builtinAsks({ asks: [onA], states: ["A", "B"] }, same).map((a) => a.id)).toEqual([
      "variant:B",
    ]);
  });

  it("is gone once an agent ask binds the variants, or one is left", () => {
    const vs = [row(null, "a"), row(null, "b")];
    expect(builtinAsks({ asks: [look], states: [] }, vs)).toHaveLength(1);
    const binds: Ask = {
      ...look,
      options: vs.map((v) => ({ id: v.variant, label: v.variant, variant: v.variant })),
    };
    expect(builtinAsks({ asks: [binds], states: [] }, vs)).toEqual([]);
    expect(
      builtinAsks({ asks: [], states: [] }, [
        row(null, "a", "accepted"),
        row(null, "b", "archived"),
      ]),
    ).toEqual([]);
  });
});

describe("the decision flow", () => {
  const m = (slug: string, open: number, createdAt: string) => ({ slug, open, createdAt });
  // Published direction → floors → day; the agent then asked on day last.
  const kitchen = [
    m("day", 3, "t3"),
    m("direction", 4, "t1"),
    m("floors", 2, "t2"),
    m("x", 0, "t0"),
  ];

  it("queues mocks oldest first, the order the agent published them in", () => {
    expect(queueOrder(kitchen).map((x) => x.slug)).toEqual(["x", "direction", "floors", "day"]);
    expect(queueOrder([m("b", 1, "t"), m("a", 1, "t")]).map((x) => x.slug)).toEqual(["a", "b"]);
  });

  it("Home's next is the oldest owed mock; after one, the next owed after it, wrapping", () => {
    expect(nextOwedMock(kitchen, null)?.slug).toBe("direction");
    expect(nextOwedMock(kitchen, "direction")?.slug).toBe("floors");
    expect(nextOwedMock(kitchen, "day")?.slug).toBe("direction");
    expect(nextOwedMock(kitchen, "direction", -1)?.slug).toBe("day");
    expect(nextOwedMock(kitchen, null, -1)?.slug).toBe("day");
    // A mock that no longer owes anything is skipped, and so is the current one.
    expect(nextOwedMock(kitchen, "x")?.slug).toBe("direction");
    expect(nextOwedMock([m("a", 2, "t1"), m("b", 0, "t2")], "a")).toBeNull();
    expect(nextOwedMock([], null)).toBeNull();
    // A slug no longer listed (deleted mid-queue) restarts from the top.
    expect(nextOwedMock(kitchen, "gone")?.slug).toBe("direction");
  });

  it("review rows read each question as it stands: picks, a write-in, a note, or owed", () => {
    const pick = (a: Ask) =>
      a.id === "look"
        ? { ids: ["dark"], other: undefined, note: undefined }
        : a.id === "trim"
          ? { ids: [], other: "inline", note: "x" }
          : { ids: [], other: undefined, note: "later" };
    const rows = reviewRows(
      [
        { kind: "ask", ask: look },
        { kind: "ask", ask: trim },
        { kind: "ask", ask: { ...trim, id: "n" } },
        { kind: "mix" },
      ],
      {
        name: (a) => a.id,
        pick,
        owed: (a) => a.id === "n",
        mix: { versions: "editorial" },
        mixAnswered: true,
      },
    );
    expect(rows.map((r) => [r.index, r.name, r.said, r.option, r.owed])).toEqual([
      [0, "look", ["Dark"], "dark", false],
      [1, "trim", ["“inline”"], null, false],
      [2, "n", ["a note"], null, true],
      [3, "Mix", ["versions · editorial's"], null, false],
    ]);
    expect(rows[3].optional).toBe(true);
    const untouched = reviewRows([{ kind: "mix" }], {
      name: () => "",
      pick,
      owed: () => false,
      mix: {},
      mixAnswered: false,
    });
    expect(untouched[0].said).toEqual([]);
    const none = reviewRows([{ kind: "mix" }], {
      name: () => "",
      pick,
      owed: () => false,
      mix: {},
      mixAnswered: true,
    });
    expect(none[0].said).toEqual(["none"]);
    const imageOnly = reviewRows([{ kind: "ask", ask: trim }], {
      name: () => "",
      pick: () => ({ ids: [], other: "", note: undefined }),
      owed: () => false,
      mix: {},
      mixAnswered: false,
    });
    expect(imageOnly[0].said).toEqual(["an image"]);
  });

  it("maps keys to flow actions, and leaves typing, chords and focused buttons alone", () => {
    const k = (key: string, over: Partial<Parameters<typeof flowKey>[0]> = {}) =>
      flowKey({
        key,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        typing: false,
        onControl: false,
        ...over,
      });
    expect(k("1")).toEqual({ kind: "pick", n: 0 });
    expect(k("9")).toEqual({ kind: "pick", n: 8 });
    expect(k("0")).toBeNull();
    expect(k("ArrowRight")).toEqual({ kind: "step", by: 1 });
    expect(k("ArrowLeft")).toEqual({ kind: "step", by: -1 });
    expect(k("]")).toEqual({ kind: "mock", by: 1 });
    expect(k("[")).toEqual({ kind: "mock", by: -1 });
    expect(k("Escape")).toEqual({ kind: "clear" });
    expect(k("?")).toEqual({ kind: "help" });
    expect(k("Enter")).toEqual({ kind: "primary" });
    expect(k("Enter", { onControl: true })).toBeNull();
    expect(k("1", { typing: true })).toBeNull();
    expect(k("Escape", { typing: true })).toBeNull();
    expect(k("1", { metaKey: true })).toBeNull();
    expect(k("[", { ctrlKey: true })).toBeNull();
    expect(k("a")).toBeNull();
  });

  it("a mostly horizontal swipe steps questions; a scroll or a tap does not", () => {
    expect(swipeStep(-80, 10)).toBe(1);
    expect(swipeStep(80, -10)).toBe(-1);
    expect(swipeStep(-40, 0)).toBe(0);
    expect(swipeStep(-80, 60)).toBe(0);
    expect(swipeStep(0, -200)).toBe(0);
  });
});
