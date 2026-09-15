import { expect, test } from "vitest";
import {
  anchorsFor,
  appendToken,
  markerLabel,
  nextRef,
  refsInText,
  removeToken,
  type Marker,
} from "../src/markers.ts";

const marker = (over: Partial<Marker> = {}): Marker => ({
  ref: 1,
  shape: "pin",
  x: 0.25,
  y: 0.5,
  w: 0,
  h: 0,
  surfaceIndex: 0,
  ...over,
});

test("refs are minted above every marker already drawn, sent ones included", () => {
  expect(nextRef([])).toBe(1);
  expect(nextRef([marker({ ref: 1 }), marker({ ref: 4 })])).toBe(5);
});

test("the comment text is authoritative for which markers exist", () => {
  const text = appendToken(appendToken("make", 1), 2);
  expect(text).toBe("make @1 @2 ");
  expect([...refsInText(text)]).toEqual([1, 2]);
  expect([...refsInText(removeToken(text, 1))]).toEqual([2]);
});

test("a pin anchors a point and a box anchors a rect, at the reviewed viewport", () => {
  const anchors = anchorsFor(
    [marker(), marker({ ref: 2, shape: "rect", x: 0.1234567, y: 0.2, w: 0.3, h: 0.4 })],
    3,
    820,
  );
  expect(anchors[0]).toEqual({
    ref: "@1",
    shape: "pin",
    box: [0.25, 0.5],
    surfaceIndex: 0,
    postVersion: 3,
    viewport: 820,
  });
  expect(anchors[1].box).toEqual([0.123, 0.2, 0.3, 0.4]);
});

test("the hit-test reply labels a marker when it named an element", () => {
  expect(markerLabel(marker({ text: "Pro", path: "div.tier" }))).toBe("Pro");
  expect(markerLabel(marker({ path: "div.tier" }))).toBe("div.tier");
  expect(markerLabel(marker())).toBe("pin");
});
