import assert from "node:assert/strict";
import { test } from "node:test";
import { askNudges, looksVisual } from "../server/askNudges.ts";
import type { Ask } from "../server/types.ts";

const ask = (over: Partial<Ask>): Ask => ({
  id: "q",
  text: "Ready to build?",
  scope: "mock",
  options: [
    { id: "yes", label: "Yes" },
    { id: "no", label: "No" },
  ],
  at: "t",
  ...over,
});
const look = ask({
  id: "look",
  text: "Which look?",
  options: [
    { id: "quiet", label: "Quiet", variant: "quiet" },
    { id: "dark", label: "Dark", variant: "dark-v2" },
  ],
});
const pills = (...labels: string[]) => labels.map((label) => ({ id: label, label }));

test("visual words read visual; copy, behavior and ambiguous words do not", () => {
  for (const t of ["Thicker border", "Blue", "8px gap", "Rounded corners", "#e8590c", "Serif"])
    assert.ok(looksVisual(t), t);
  for (const t of [
    "Yes",
    "Tabs",
    "Through chat",
    "Friendly voice",
    "Ship it",
    "Smaller file size",
    "In the background",
    "Compact summary",
    "Whitelist",
    "White-label",
  ])
    assert.ok(!looksVisual(t), t);
});

test("a plain option labelled visually is nudged; a set or variant option is not", () => {
  const blue = ask({ options: pills("Blue", "Yes") });
  assert.deepEqual(askNudges([blue], [blue]), [
    `ask "q": "Blue" look visual. Give each a knob set or variant.`,
  ]);
  const set = ask({ options: [{ id: "b", label: "Blue", set: { accent: "#00f" } }] });
  assert.deepEqual(askNudges([set], [set]), []);
  assert.deepEqual(askNudges([look], [look]), []);
});

test("the question text alone never flags its pills", () => {
  for (const text of ["Which border?", "What size should exports be?", "Keep it compact?"]) {
    const q = ask({ text, options: pills("Small", "Large") });
    assert.deepEqual(askNudges([q], [q]), [], text);
  }
});

test("a plain ask beside a Look ask is nudged only when a pill names a look or reads visual", () => {
  // The guide's own example: a mock-wide Look plus a plain question on another axis.
  const versions = ask({ id: "versions", options: pills("Drawer", "Margin") });
  assert.deepEqual(askNudges([versions], [look, versions]), []);
  // A pill named after a variant's label or its name, in any case.
  const named = ask({ options: pills("quiet", "DARK-V2", "Neither") });
  assert.deepEqual(askNudges([named], [look, named]), [
    `ask "q": "quiet", "DARK-V2" may re-ask what "look" decides. Drop it or use knob sets.`,
  ]);
  // A visual pill beside a Look gets the re-ask nudge alone, not both.
  const navy = ask({ options: pills("Navy") });
  const out = askNudges([navy], [look, navy]);
  assert.equal(out.length, 1);
  assert.match(out[0], /"Navy" may re-ask/);
  // A part ask and a Look for another state stand apart.
  const part = ask({ scope: "part", part: "x", options: pills("Quiet") });
  assert.deepEqual(askNudges([part], [look, part]), []);
  const other: Ask = { ...look, scope: "state", state: "A" };
  const inB = ask({ scope: "state", state: "B", options: pills("Quiet") });
  assert.deepEqual(askNudges([inB], [other]), []);
  const inA = ask({ scope: "state", state: "A", options: pills("Quiet") });
  assert.equal(askNudges([inA], [other]).length, 1);
});
