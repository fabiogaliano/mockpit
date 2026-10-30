import assert from "node:assert/strict";
import { test } from "node:test";
import { decisionsFor } from "../server/decisions.ts";
import { composeFills, scanFills, slotCss, slotKnobs, spliceFills } from "../server/fills.ts";
import type { Mock, Post, Surface } from "../server/types.ts";

const PAGE = `<main>
  <p data-part="message">Bife</p>
  <section data-part="entry" data-part-label="Entry" data-fill="dots" data-fill-label="Typing dots">···</section>
  <section data-part="entry" data-fill="skeleton">
    <div data-part="rows" data-fill="shimmer">~</div>
    <div data-part="rows" data-fill="static">=</div>
  </section>
  <section data-part="entry" data-fill="filling" data-fill-default>2 of 3</section>
  <script>const s = '<div data-part="x" data-fill="a">';</script>
</main>`;

test("a slot is a part with two or more fills; nested slots know their fill", () => {
  const { slots } = scanFills(PAGE);
  assert.deepEqual(
    slots.map((s) => [s.part, s.fills.map((f) => f.name), s.default, s.parent]),
    [
      ["entry", ["dots", "skeleton", "filling"], "filling", null],
      ["rows", ["shimmer", "static"], "shimmer", { part: "entry", fill: "skeleton" }],
    ],
  );
  assert.equal(slots[0].label, "Entry");
  assert.equal(slots[0].fills[0].label, "Typing dots");
});

test("a lone fill, a plain part and markup inside a script are not slots", () => {
  const { slots } = scanFills(
    `<div data-part="a" data-fill="one"></div><p data-part="b"></p><script>"<i data-part='c' data-fill='x'></i><i data-part='c' data-fill='y'></i>"</script>`,
  );
  assert.deepEqual(slots, []);
});

test("slot knobs are selects over the fills; the css never styles the chosen fill", () => {
  const { slots } = scanFills(PAGE);
  assert.deepEqual(slotKnobs(slots).entry, {
    type: "select",
    options: [{ value: "dots", label: "Typing dots" }, "skeleton", "filling"],
    value: "filling",
  });
  const css = slotCss(slots);
  assert.match(
    css,
    /html\[data-k-entry\]:not\(\[data-k-entry="filling"\]\) \[data-part="entry"\]\[data-fill="filling"\]/,
  );
  assert.match(
    css,
    /html:not\(\[data-k-entry="dots"\]\) \[data-part="entry"\]\[data-fill="dots"\]/,
  );
});

test("compose keeps the chosen fills, cuts the rest with what they held, drops the marks", () => {
  const out = composeFills(PAGE, { entry: "skeleton", rows: "static" });
  assert.doesNotMatch(out, /···|2 of 3|~/);
  assert.match(out, /<section data-part="entry">/);
  assert.match(out, /<div data-part="rows">=<\/div>/);
  assert.match(out, /<script>const s = '<div data-part="x" data-fill="a">';<\/script>/);
  // A slot inside a cut fill goes with it.
  assert.doesNotMatch(composeFills(PAGE, {}), /data-part="rows"/);
});

const html = (h: string): Surface[] => [{ id: "s1", kind: "html", html: h } as Surface];
const htmlOf = (r: ReturnType<typeof spliceFills>) => {
  assert.ok(r.ok, r.ok ? "" : r.error);
  return (r.surfaces[0] as { html: string }).html;
};

test("splice replaces a fill, adding the marks it lacks", () => {
  const out = htmlOf(spliceFills(html(PAGE), { "entry#dots": "<section>• • •</section>" }));
  assert.match(out, /<section data-part="entry" data-fill="dots">• • •<\/section>/);
  assert.doesNotMatch(out, /···/);
  assert.deepEqual(
    scanFills(out).slots[0].fills.map((f) => f.name),
    ["dots", "skeleton", "filling"],
  );
});

test("splice adds a new fill after the slot's last, in listed order, and can make a slot", () => {
  const out = htmlOf(
    spliceFills(html(PAGE), {
      "entry#sheet": "<section>sheet</section>",
      "entry#toast": "<section>toast</section>",
    }),
  );
  assert.deepEqual(
    scanFills(out).slots[0].fills.map((f) => f.name),
    ["dots", "skeleton", "filling", "sheet", "toast"],
  );
  const two = htmlOf(
    spliceFills(html('<b data-part="a" data-fill="one">1</b><i>after</i>'), {
      "a#two": "<b>2</b>",
    }),
  );
  assert.equal(
    two,
    '<b data-part="a" data-fill="one">1</b>\n<b data-part="a" data-fill="two">2</b><i>after</i>',
  );
});

test("splice refuses bad keys, unknown slots, contradicting marks and overlaps", () => {
  const err = (edits: Record<string, string>) => {
    const r = spliceFills(html(PAGE), edits);
    assert.equal(r.ok, false);
    return r.ok ? "" : r.error;
  };
  assert.match(err({ entry: "<b></b>" }), /part#fill/);
  assert.match(err({ "message#big": "<p></p>" }), /no fills of "message"/);
  assert.match(
    err({ "entry#dots": '<section data-fill="skeleton"></section>' }),
    /marked data-fill="skeleton"/,
  );
  assert.match(err({ "entry#dots": "just text" }), /starting with its element/);
  assert.match(
    err({ "entry#skeleton": "<section></section>", "rows#static": "<div></div>" }),
    /overlap/,
  );
});

test("decisions follow the chosen fill down, and list only the knobs that are not slots", () => {
  const mock = {
    states: [],
    asks: [
      {
        id: "entry",
        text: "Which entry?",
        options: [{ id: "a", label: "Skeleton", set: { entry: "skeleton" } }],
      },
    ],
  } as unknown as Mock;
  const post = {
    state: null,
    variant: "default",
    status: "open",
    surfaces: html(PAGE),
  } as unknown as Post;
  const d = decisionsFor(mock, [post], {
    answers: { entry: "a" },
    tuned: { gap: 8 },
    borrowed: {},
  });
  assert.deepEqual(d, {
    states: {
      "": {
        variant: "default",
        parts: { entry: { fill: "skeleton", parts: { rows: { fill: "shimmer" } } } },
      },
    },
    knobs: { gap: 8 },
  });
});
