import assert from "node:assert/strict";
import { test } from "node:test";
import { expandSlots, parseSlotTags, resolveSlots } from "../server/slots.ts";

// `<mockpit-slot>` is how a page item includes a component by reference. The
// parser reads markup we did not write, so it must be tolerant and never throw.

test("parseSlotTags reads slug, variant and version in every quoting style", () => {
  const tags = parseSlotTags(`
    <mockpit-slot slug="pricing-card"></mockpit-slot>
    <mockpit-slot slug='hero' variant='quiet' version='2'/>
    <mockpit-slot slug=faq variant=default>
  `);
  assert.deepEqual(
    tags.map(({ slug, variant, version }) => ({ slug, variant, version })),
    [
      { slug: "pricing-card", variant: "default", version: null },
      { slug: "hero", variant: "quiet", version: 2 },
      { slug: "faq", variant: "default", version: null },
    ],
  );
});

test("parseSlotTags ignores a tag with no slug and a nonsense version", () => {
  assert.deepEqual(parseSlotTags("<mockpit-slot variant=quiet></mockpit-slot>"), []);
  assert.deepEqual(parseSlotTags("<p>no slots here</p>"), []);
  const [tag] = parseSlotTags('<mockpit-slot slug="x" version="0">');
  assert.equal(tag.version, null, "a version must be a positive integer");
  assert.equal(parseSlotTags('<mockpit-slot slug="x" version="later">')[0].version, null);
});

test("resolveSlots pins a missing version to the component's current one", () => {
  const current = (slug: string, variant: string) =>
    slug === "pricing-card" ? (variant === "quiet" ? 7 : 3) : null;
  assert.deepEqual(
    resolveSlots(
      `<mockpit-slot slug="pricing-card"></mockpit-slot>
       <mockpit-slot slug="pricing-card" variant="quiet"></mockpit-slot>
       <mockpit-slot slug="pricing-card" version="1"></mockpit-slot>
       <mockpit-slot slug="gone"></mockpit-slot>`,
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
    `<main><mockpit-slot slug="pricing-card" version="2"></mockpit-slot>
     <mockpit-slot slug="gone"></mockpit-slot></main>`,
    ({ slug, version }) => (slug === "pricing-card" ? `<p>card v${version}</p>` : null),
  );
  assert.ok(
    html.includes(
      '<div data-mockpit-slot="pricing-card" data-mockpit-variant="default" data-mockpit-version="2"><p>card v2</p></div>',
    ),
  );
  // A broken reference stays visible in review instead of silently vanishing.
  assert.ok(
    html.includes(
      '<div data-mockpit-slot="gone" data-mockpit-variant="default" data-mockpit-missing="1"></div>',
    ),
  );
  assert.ok(!html.includes("<mockpit-slot"));
});

test("expandSlots escapes attribute values and leaves a slug-less tag alone", () => {
  const html = expandSlots(`<mockpit-slot slug='a"b' variant='c&d'></mockpit-slot>`, () => "x");
  assert.ok(html.includes('data-mockpit-slot="a&quot;b"'));
  assert.ok(html.includes('data-mockpit-variant="c&amp;d"'));

  const untouched = "<mockpit-slot variant=quiet></mockpit-slot>";
  assert.equal(
    expandSlots(untouched, () => "x"),
    untouched,
  );
});
