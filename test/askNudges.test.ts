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
    { id: "a", label: "A", variant: "a" },
    { id: "b", label: "B", variant: "b" },
  ],
});

test("visual words read visual; copy and behavior do not", () => {
  for (const t of ["Thicker border", "Blue", "8px gap", "Rounded corners", "#e8590c", "Serif"])
    assert.ok(looksVisual(t), t);
  for (const t of ["Yes", "Tabs", "Through chat", "Friendly voice", "Ship it"])
    assert.ok(!looksVisual(t), t);
});

test("a plain option labelled visually is nudged; a set or variant option is not", () => {
  const pills = ask({
    options: [
      { id: "b", label: "Blue" },
      { id: "y", label: "Yes" },
    ],
  });
  assert.match(askNudges([pills], [pills])[0], /ask "q": "Blue" look visual/);
  const set = ask({ options: [{ id: "b", label: "Blue", set: { accent: "#00f" } }] });
  assert.deepEqual(askNudges([set], [set]), []);
  assert.deepEqual(askNudges([look], [look]), []);
});

test("a visual question with plain options names them all", () => {
  const q = ask({ text: "Which border?", options: [{ id: "a", label: "A" }] });
  assert.match(askNudges([q], [q])[0], /"A" look visual/);
});

test("a plain ask next to a look ask is nudged once", () => {
  const plain = ask({});
  assert.deepEqual(askNudges([plain], [plain]), []);
  const out = askNudges([plain], [look, plain]);
  assert.equal(out.length, 1);
  assert.match(out[0], /ask "q" may re-ask what the variants in "look" decide/);
  // A part ask and a look for another state stand apart.
  assert.deepEqual(askNudges([ask({ scope: "part", part: "x" })], [look]), []);
  const other: Ask = { ...look, scope: "state", state: "A" };
  assert.deepEqual(askNudges([ask({ scope: "state", state: "B" })], [other]), []);
  assert.equal(askNudges([ask({ scope: "state", state: "A" })], [other]).length, 1);
});
