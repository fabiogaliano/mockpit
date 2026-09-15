import assert from "node:assert/strict";
import { test } from "node:test";
import { expandSlots, parseSlotTags, resolveSlots } from "../server/slots.ts";

// `<sideshow-slot>` is how a page item includes a component by reference. The
// parser reads markup we did not write, so it must be tolerant and never throw.

test("parseSlotTags reads slug, variant and version in every tag spelling", () => {
  const tags = parseSlotTags(`
    <sideshow-slot slug="pricing-card"></sideshow-slot>
    <sideshow-slot slug='hero' variant='quiet' version='2'/>
    <sideshow-slot slug=faq variant=default>
    <sideshow-slot item="legacy-name">
  `);
  assert.deepEqual(
    tags.map(({ slug, variant, version }) => ({ slug, variant, version })),
    [
      { slug: "pricing-card", variant: "default", version: null },
      { slug: "hero", variant: "quiet", version: 2 },
      { slug: "faq", variant: "default", version: null },
      { slug: "legacy-name", variant: "default", version: null },
    ],
  );
});

test("parseSlotTags ignores a tag with no slug and a nonsense version", () => {
  assert.deepEqual(parseSlotTags("<sideshow-slot variant=quiet></sideshow-slot>"), []);
  assert.deepEqual(parseSlotTags("<p>no slots here</p>"), []);
  const [tag] = parseSlotTags('<sideshow-slot slug="x" version="0">');
  assert.equal(tag.version, null, "a version must be a positive integer");
  assert.equal(parseSlotTags('<sideshow-slot slug="x" version="later">')[0].version, null);
});

test("resolveSlots pins a missing version to the component's current one", () => {
  const current = (slug: string, variant: string) =>
    slug === "pricing-card" ? (variant === "quiet" ? 7 : 3) : null;
  assert.deepEqual(
    resolveSlots(
      `<sideshow-slot slug="pricing-card"></sideshow-slot>
       <sideshow-slot slug="pricing-card" variant="quiet"></sideshow-slot>
       <sideshow-slot slug="pricing-card" version="1"></sideshow-slot>
       <sideshow-slot slug="gone"></sideshow-slot>`,
      current,
    ),
    [
      { slug: "pricing-card", variant: "default", version: 3 },
      { slug: "pricing-card", variant: "quiet", version: 7 },
      { slug: "pricing-card", variant: "default", version: 1 },
    ],
    "an unresolvable reference is not snapshotted",
  );
});

test("expandSlots inlines the resolved body and marks a broken reference", () => {
  const html = expandSlots(
    `<main><sideshow-slot slug="pricing-card" version="2"></sideshow-slot>
     <sideshow-slot slug="gone"></sideshow-slot></main>`,
    ({ slug, version }) => (slug === "pricing-card" ? `<p>card v${version}</p>` : null),
  );
  assert.ok(
    html.includes(
      '<div data-sideshow-slot="pricing-card" data-sideshow-variant="default" data-sideshow-version="2"><p>card v2</p></div>',
    ),
  );
  // A broken reference stays visible in review instead of silently vanishing.
  assert.ok(
    html.includes(
      '<div data-sideshow-slot="gone" data-sideshow-variant="default" data-sideshow-missing="1"></div>',
    ),
  );
  assert.ok(!html.includes("<sideshow-slot"));
});

test("expandSlots escapes attribute values and leaves a slug-less tag alone", () => {
  const html = expandSlots(`<sideshow-slot slug='a"b' variant='c&d'></sideshow-slot>`, () => "x");
  assert.ok(html.includes('data-sideshow-slot="a&quot;b"'));
  assert.ok(html.includes('data-sideshow-variant="c&amp;d"'));

  const untouched = "<sideshow-slot variant=quiet></sideshow-slot>";
  assert.equal(
    expandSlots(untouched, () => "x"),
    untouched,
  );
});
