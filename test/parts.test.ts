import assert from "node:assert/strict";
import { test } from "node:test";
import { diffParts, mergeParts, partsInHtml, partsInSurfaces } from "../server/parts.ts";
import type { Surface } from "../server/types.ts";

test("parts are read from data-part with label and instance keys, first occurrence wins", () => {
  const html = `
    <header data-part="trim" data-part-label="Top bar">x</header>
    <li data-part=row data-part-key='a'>1</li>
    <li data-part="row" data-part-key="b">2</li>
    <li data-part="row" data-part-key="a">dup key</li>
    <p data-part="trim" data-part-label="ignored later label">y</p>
    <span data-partial="no">not a part</span>
    <div data-part-label="orphan label only"></div>`;
  assert.deepEqual(partsInHtml(html), [
    { name: "trim", label: "Top bar" },
    { name: "row", keys: ["a", "b"] },
  ]);
});

test("attribute values are entity-decoded and trimmed", () => {
  assert.deepEqual(
    partsInHtml('<b data-part=" title " data-part-label="A &amp; B &quot;C&quot;">'),
    [{ name: "title", label: 'A & B "C"' }],
  );
});

test("part names are capped so a pathological document cannot blow up the result", () => {
  const html = Array.from({ length: 250 }, (_, i) => `<i data-part="p${i}"></i>`).join("");
  assert.equal(partsInHtml(html).length, 200);
});

test("only html surfaces contribute parts, merged across surfaces", () => {
  const surfaces = [
    { id: "a", kind: "html", html: '<div data-part="card" data-part-key="1"></div>' },
    { id: "b", kind: "markdown", markdown: '<div data-part="ignored"></div>' },
    {
      id: "c",
      kind: "html",
      html: '<div data-part="card" data-part-key="2" data-part-label="Card"></div>',
    },
  ] as Surface[];
  assert.deepEqual(partsInSurfaces(surfaces), [{ name: "card", label: "Card", keys: ["1", "2"] }]);
});

test("mergeParts does not alias the input's keys array", () => {
  const first = [{ name: "row", keys: ["a"] }];
  const merged = mergeParts([first, [{ name: "row", keys: ["b"] }]]);
  assert.deepEqual(merged[0].keys, ["a", "b"]);
  assert.deepEqual(first[0].keys, ["a"]);
});

test("diffParts reports renames by shared key or label and the rest as vanished", () => {
  const before = [
    { name: "title" },
    { name: "row", keys: ["k1"] },
    { name: "toast", label: "Saved toast" },
    { name: "gone" },
  ];
  const after = [
    { name: "title" },
    { name: "item", keys: ["k1", "k2"] },
    { name: "notice", label: "Saved toast" },
    { name: "fresh" },
  ];
  assert.deepEqual(diffParts(before, after), {
    vanished: ["gone"],
    renamed: [
      { from: "row", to: "item" },
      { from: "toast", to: "notice" },
    ],
  });
});

test("one new part cannot absorb two renames", () => {
  const changes = diffParts(
    [
      { name: "a", label: "Same" },
      { name: "b", label: "Same" },
    ],
    [{ name: "c", label: "Same" }],
  );
  assert.deepEqual(changes, { vanished: ["b"], renamed: [{ from: "a", to: "c" }] });
});
