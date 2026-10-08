import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkKnobConfig,
  checkKnobs,
  checkKnobValue,
  checkKnobValues,
  discreteChoices,
  explicitKnob,
  knobFor,
} from "../server/knobs.ts";

const ok = <T>(r: { ok: true; value: T } | { ok: false; error: string }) => {
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.value;
};
const err = (r: { ok: boolean; error?: string }) => {
  assert.equal(r.ok, false);
  return r.error!;
};

test("tunekit shorthands expand like tunekit's own parser", () => {
  assert.deepEqual(explicitKnob([16, 12, 24, 1]), {
    type: "slider",
    value: 16,
    min: 12,
    max: 24,
    step: 1,
  });
  assert.deepEqual(explicitKnob(0.5), { type: "slider", value: 0.5, min: 0, max: 1 });
  assert.deepEqual(explicitKnob(8), { type: "slider", value: 8, min: 0, max: 24 });
  assert.deepEqual(explicitKnob(-2), { type: "slider", value: -2, min: -6, max: 6 });
  assert.deepEqual(explicitKnob(true), { type: "toggle", value: true });
  assert.deepEqual(explicitKnob("#ff0000"), { type: "color", value: "#ff0000" });
  assert.deepEqual(explicitKnob("oklch(70% 0.1 200)"), {
    type: "color",
    value: "oklch(70% 0.1 200)",
  });
  assert.deepEqual(explicitKnob("Hello"), { type: "text", value: "Hello" });
});

test("knob configs are validated and stripped of unknown keys", () => {
  assert.deepEqual(
    ok(checkKnobConfig("s", { type: "slider", value: 2, min: 0, max: 4, extra: 1 })),
    {
      type: "slider",
      value: 2,
      min: 0,
      max: 4,
    },
  );
  assert.match(err(checkKnobConfig("s", [5, 0, 4])), /default is outside/);
  assert.match(err(checkKnobConfig("s", [1, 4, 0])), /min is above max/);
  assert.match(err(checkKnobConfig("s", [1, 0, 4, 0])), /step must be positive/);
  assert.match(err(checkKnobConfig("t", { type: "toggle", value: "yes" })), /boolean/);
  assert.match(
    err(checkKnobConfig("p", { type: "select", options: ["a", "b"], value: "c" })),
    /not one of its options/,
  );
  assert.match(
    err(checkKnobConfig("c", { type: "color", value: "red; background:url(x)" })),
    /CSS color/,
  );
  assert.match(
    err(checkKnobConfig("e", { type: "easing", duration: 1, ease: [0, 1] })),
    /four numbers/,
  );
  assert.match(err(checkKnobConfig("x", { type: "wobble" })), /unknown type "wobble"/);
  assert.deepEqual(
    ok(checkKnobConfig("pad", { type: "pad", x: [0, -1, 1], labels: { x: "L", z: 1 } })),
    {
      type: "pad",
      x: [0, -1, 1],
      labels: { x: "L" },
    },
  );
});

test("knob paths must be name or part.name so they are safe as CSS vars and attributes", () => {
  assert.deepEqual(ok(checkKnobs({ size: [1, 0, 2], "body.size": 0.5 })), {
    size: [1, 0, 2],
    "body.size": 0.5,
  });
  assert.match(err(checkKnobs({ "body size": 1 })), /must be "name" or "part.name"/);
  assert.match(err(checkKnobs({ "a;b": 1 })), /knob path/);
  assert.match(err(checkKnobs([1])), /must be an object/);
  assert.deepEqual(ok(checkKnobs(undefined)), {});
});

test("values are checked against the declared knob", () => {
  assert.equal(ok(checkKnobValue("s", [16, 12, 24], 20)), 20);
  assert.match(err(checkKnobValue("s", [16, 12, 24], 30)), /within 12..24/);
  assert.match(err(checkKnobValue("t", true, "on")), /true or false/);
  assert.equal(
    ok(checkKnobValue("p", { type: "select", options: [{ value: "top", label: "Top" }] }, "top")),
    "top",
  );
  assert.match(
    err(checkKnobValue("p", { type: "select", options: ["top"] }, "left")),
    /one of top/,
  );
  assert.match(err(checkKnobValue("c", "#fff", "url(javascript:x);")), /CSS color/);
  assert.deepEqual(ok(checkKnobValue("pad", { type: "pad", x: [0, 0, 10] }, { x: 5, y: 0.5 })), {
    x: 5,
    y: 0.5,
  });
  assert.match(err(checkKnobValue("pad", { type: "pad" }, { x: 2, y: 0 })), /pad's range/);
  // A transition knob may be switched between modes in the panel.
  assert.deepEqual(
    ok(
      checkKnobValue(
        "t",
        { type: "spring", stiffness: 100 },
        { type: "easing", duration: 0.2, ease: [0, 0, 1, 1] },
      ),
    ),
    { type: "easing", duration: 0.2, ease: [0, 0, 1, 1] },
  );
});

test("a value may target a mock knob or a variant-only knob, never an undeclared one", () => {
  const mock = { knobs: { size: [16, 12, 24] as [number, number, number] } };
  const posts = [{ knobs: { "toast.show": true } }, {}];
  assert.deepEqual(knobFor("toast.show", mock, posts), true);
  assert.equal(knobFor("nope", mock, posts), undefined);
  assert.deepEqual(ok(checkKnobValues({ size: 18, "toast.show": false }, mock, posts, "tuned")), {
    size: 18,
    "toast.show": false,
  });
  assert.match(err(checkKnobValues({ nope: 1 }, mock, posts, "tuned")), /tuned: no knob "nope"/);
  assert.match(err(checkKnobValues({ size: 99 }, mock, posts, "tuned")), /within 12..24/);
});

test("discrete knobs report their choice count; continuous ones report null", () => {
  assert.equal(discreteChoices(true), 2);
  assert.equal(discreteChoices({ type: "select", options: ["a", "b", "c"] }), 3);
  assert.equal(discreteChoices({ type: "image", options: ["a.png"] }), 1);
  assert.equal(discreteChoices({ type: "image" }), null);
  assert.equal(discreteChoices([1, 0, 2]), null);
  assert.equal(discreteChoices("#000"), null);
});
