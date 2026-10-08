import assert from "node:assert/strict";
import { test } from "node:test";
import {
  diffParts,
  mergeParts,
  partsInHtml,
  partsInSurfaces,
  spliceParts,
  splicePart,
} from "../server/parts.ts";
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

// --- splicePart / spliceParts ---

const spliced = (html: string, target: string, replacement = "<new/>") => {
  const r = splicePart(html, target, replacement);
  if ("error" in r) assert.fail(r.error);
  return r.html;
};
const spliceError = (html: string, target: string) => {
  const r = splicePart(html, target, "<new/>");
  assert.ok("error" in r, "expected an error");
  return r.error;
};

test("splice replaces the whole element, balancing nested tags of the same name", () => {
  const html = `<main><div data-part="body"><div>a<div>b</div></div><p>c</p></div><div>after</div></main>`;
  assert.equal(spliced(html, "body"), `<main><new/><div>after</div></main>`);
});

test("splice targets the part as first or last node of the document", () => {
  assert.equal(spliced(`<h1 data-part="t">x</h1><p>y</p>`, "t"), `<new/><p>y</p>`);
  assert.equal(spliced(`<p>y</p><h1 data-part="t">x</h1>`, "t"), `<p>y</p><new/>`);
  assert.equal(spliced(`<h1 data-part="t">x</h1>`, "t", ""), ``);
});

test("splice picks one keyed instance; a bare name with several instances lists keys", () => {
  const html = `<ul><li data-part="row" data-part-key="a">A</li><li data-part='row' data-part-key=b>B</li></ul>`;
  assert.equal(
    spliced(html, "row#b"),
    `<ul><li data-part="row" data-part-key="a">A</li><new/></ul>`,
  );
  assert.match(spliceError(html, "row"), /2 instances; target one: row#a, row#b/);
  assert.match(spliceError(html, "row#z"), /no key "z"; instances: row#a, row#b/);
  assert.match(
    spliceError(`<i data-part="x">1</i><i data-part="x">2</i>`, "x"),
    /without data-part-key/,
  );
});

test("a missing part lists the parts present", () => {
  const html = `<h1 data-part="title">x</h1><p data-part="body">y</p>`;
  assert.equal(spliceError(html, "nav"), 'no part "nav"; parts present: title, body');
  assert.match(spliceError("<p>no parts</p>", "nav"), /none \(mark parts with data-part\)/);
});

test("void elements inside the part and as the part itself", () => {
  const html = `<div data-part="form"><img src="a.png"><br><input type=text><div><hr></div></div><p>x</p>`;
  assert.equal(spliced(html, "form"), `<new/><p>x</p>`);
  assert.equal(spliced(`<p>a<img data-part="pic" src="x">b</p>`, "pic"), `<p>a<new/>b</p>`);
});

test("self-closing tags and a part inside svg", () => {
  const html = `<svg viewBox="0 0 10 10"><g data-part="mark"><path d="M0 0"/><g><circle r="1" /></g></g><rect/></svg>`;
  assert.equal(spliced(html, "mark"), `<svg viewBox="0 0 10 10"><new/><rect/></svg>`);
  assert.equal(
    spliced(`<svg><use data-part="icon" href="#i"/></svg>`, "icon"),
    `<svg><new/></svg>`,
  );
});

test("tag names match case-insensitively", () => {
  assert.equal(spliced(`<DIV data-part="x"><div>a</DIV></Div>!`, "x"), `<new/>!`);
});

test("a > inside a quoted attribute does not end the tag", () => {
  const html = `<div data-part="x" title="a > b" data-note='</div>'><span title="<div>">y</span></div>z`;
  assert.equal(spliced(html, "x"), `<new/>z`);
});

test("comments and raw text are not markup", () => {
  const html = `<div data-part="x"><!-- </div> <div data-part="ghost"> --><script>if (a < b) document.write("</div>")</script><style>p::after{content:"</div>"}</style></div>!`;
  assert.equal(spliced(html, "x"), `<new/>!`);
  assert.match(spliceError(html, "ghost"), /no part "ghost"/);
});

test("CRLF input keeps its line endings outside the splice", () => {
  const html = `<main>\r\n  <p data-part="a">\r\n    x\r\n  </p>\r\n</main>\r\n`;
  assert.equal(
    spliced(html, "a", '<p data-part="a">y</p>'),
    `<main>\r\n  <p data-part="a">y</p>\r\n</main>\r\n`,
  );
});

test("unbalanced markup is a clear error", () => {
  assert.match(
    spliceError(`<div data-part="x"><div>never closed</div>`, "x"),
    /<div> is never closed/,
  );
});

test("spliceParts applies several edits, independent of order, and refuses overlaps", () => {
  const surfaces = [
    {
      id: "s0",
      kind: "html",
      html: `<h1 data-part="title">T</h1><p data-part="body">B</p>`,
      kits: ["ui"],
    },
    { id: "s1", kind: "markdown", markdown: "# notes" },
    { id: "s2", kind: "html", html: `<nav data-part="nav">N</nav>` },
  ] as Surface[];
  const r = spliceParts(surfaces, {
    body: `<p data-part="body">B2</p>`,
    title: `<h2 data-part="heading">T2</h2>`,
    nav: `<nav data-part="nav">N2</nav>`,
  });
  assert.ok(r.ok);
  assert.deepEqual(r.applied, ["body", "title", "nav"]);
  assert.deepEqual(r.surfaces, [
    {
      id: "s0",
      kind: "html",
      html: `<h2 data-part="heading">T2</h2><p data-part="body">B2</p>`,
      kits: ["ui"],
    },
    surfaces[1],
    { id: "s2", kind: "html", html: `<nav data-part="nav">N2</nav>` },
  ]);

  const nested = [
    { id: "a", kind: "html", html: `<div data-part="card"><b data-part="price">1</b></div>` },
  ] as Surface[];
  const overlap = spliceParts(nested, { card: "<x/>", price: "<y/>" });
  assert.deepEqual(overlap, { ok: false, error: 'parts "card" and "price" overlap; send one' });
});

test("spliceParts errors: ambiguous across surfaces, missing, no html surface", () => {
  const twice = [
    { id: "a", kind: "html", html: `<i data-part="x">1</i>` },
    { id: "b", kind: "html", html: `<i data-part="x">2</i><b data-part="y">3</b>` },
  ] as Surface[];
  const ambiguous = spliceParts(twice, { x: "" });
  assert.ok(!ambiguous.ok && /several html surfaces \(0, 1\)/.test(ambiguous.error));
  const missing = spliceParts(twice, { z: "" });
  assert.ok(!missing.ok && /parts present: x, y/.test(missing.error));
  const none = spliceParts([{ id: "m", kind: "markdown", markdown: "x" }] as Surface[], { x: "" });
  assert.ok(!none.ok && /needs an html surface/.test(none.error));
});
