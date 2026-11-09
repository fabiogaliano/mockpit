// The Board's geometry: how big a frame is in the world, and the transforms that fit a box
// or zoom about a point. The world is the designs' own pixels, so a 390-wide screen is 390
// across at 100%.

export interface View {
  x: number;
  y: number;
  k: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 3;
// Fit never blows a page up past its size, and a single frame only a little past it.
const FIT_MAX = 1;
const FIT_MAX_FRAME = 1.1;
// Room the page's header card and the hint bar take, so a fit isn't hidden under them.
export const RESERVE_TOP = 130;
export const RESERVE_BOTTOM = 56;
export const FIT_MS = 420;
// A design that declares no width is drawn at the poster worker's.
export const DEFAULT_WIDTH = 820;

// A screen shows its first screenful, as a phone or a window would: a phone-width page at
// a phone's height, a wider one at a laptop's proportions. Its poster is cropped to that
// from the top. A component is as tall as its still, so it has no fixed height.
export const frameHeight = (width: number): number =>
  Math.round(width < 700 ? (width * 844) / 390 : width * 0.625);

export const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

export function fitView(
  box: Box,
  stage: { w: number; h: number },
  opts: { pad: number; frame: boolean },
): View {
  const room = { w: stage.w - opts.pad * 2, h: stage.h - RESERVE_TOP - RESERVE_BOTTOM };
  const k = clampZoom(
    Math.min(room.w / box.w, room.h / box.h, opts.frame ? FIT_MAX_FRAME : FIT_MAX),
  );
  // Too big to fit even at the least zoom (a long Ideas page): it starts at its top left,
  // where reading starts, rather than at its middle.
  return {
    k,
    x: box.w * k > room.w ? opts.pad - box.x * k : stage.w / 2 - (box.x + box.w / 2) * k,
    y:
      box.h * k > room.h
        ? RESERVE_TOP - box.y * k
        : RESERVE_TOP + room.h / 2 - (box.y + box.h / 2) * k,
  };
}

// Zoom by `by` keeping the world point under (cx, cy), in stage pixels, where it is.
export function zoomAbout(v: View, by: number, cx: number, cy: number): View {
  const k = clampZoom(v.k * by);
  return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
}

export const unionBox = (boxes: Box[]): Box | null => {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const b = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: b - y };
};
