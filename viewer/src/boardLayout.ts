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
// Room the page's header card and the hint bar take, so a fit isn't hidden under them; the
// Board measures the card where it can, since its map makes it taller.
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
  opts: { pad: number; frame: boolean; top?: number },
): View {
  const top = opts.top ?? RESERVE_TOP;
  const room = { w: stage.w - opts.pad * 2, h: stage.h - top - RESERVE_BOTTOM };
  const k = clampZoom(
    Math.min(room.w / box.w, room.h / box.h, opts.frame ? FIT_MAX_FRAME : FIT_MAX),
  );
  // Too big to fit even at the least zoom (a long Ideas page): it starts at its top left,
  // where reading starts, rather than at its middle.
  return {
    k,
    x: box.w * k > room.w ? opts.pad - box.x * k : stage.w / 2 - (box.x + box.w / 2) * k,
    y: box.h * k > room.h ? top - box.y * k : top + room.h / 2 - (box.y + box.h / 2) * k,
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

// Sections flow left to right and wrap, as words do, so a page of a few wide sections and
// a few narrow ones reads as a sheet rather than one long column. The page is as wide as
// the run of sections whose wrapped rows best fill a room of the stage's shape: every
// width a run of whole sections makes is tried, so a row always ends at a section's edge.
export const SECTION_GAP = 90;
export const WORLD_PAD = 60;

const wrappedHeight = (sizes: { w: number; h: number }[], width: number): number => {
  let x = 0;
  let row = 0;
  let total = 0;
  for (const s of sizes) {
    if (x > 0 && x + SECTION_GAP + s.w > width) {
      total += row + SECTION_GAP;
      x = 0;
      row = 0;
    }
    x += (x > 0 ? SECTION_GAP : 0) + s.w;
    row = Math.max(row, s.h);
  }
  return total + row;
};

export function wrapWidth(sizes: { w: number; h: number }[], aspect: number): number | null {
  if (!sizes.length) return null;
  const widest = Math.max(...sizes.map((s) => s.w));
  const widths = new Set([widest]);
  for (let i = 0; i < sizes.length; i++) {
    let w = 0;
    for (let j = i; j < sizes.length; j++) {
      w += (j > i ? SECTION_GAP : 0) + sizes[j]!.w;
      if (w > widest) widths.add(w);
    }
  }
  let best = widest;
  let score = -1;
  for (const w of widths) {
    const h = wrappedHeight(sizes, w);
    // The zoom a room of this shape fits the page at, up to a constant.
    const at = Math.min(aspect / (w + WORLD_PAD * 2), 1 / (h + WORLD_PAD * 2));
    if (at > score) {
      score = at;
      best = w;
    }
  }
  // A pixel over, so rounding in the browser's own line breaking never wraps a row early.
  return Math.ceil(best) + 1;
}
