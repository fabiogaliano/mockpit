// Where a choice knob's stills differ: the box, in fractions of the still, holding every
// pixel that isn't the same in all of them. A knob that changes three small covers changes a
// corner of a 1280-wide page, and a tile showing the whole page shows that corner as a few
// pixels; framed on the box, the difference reads at tile size. Worked out once every still
// of the group is in, so the tiles re-frame once, not as each arrives.
//
// The same comparison tells a knob that changes nothing on this frame: the page names it,
// so it is listed (server/knobReads.ts), but every value draws the same picture.

export interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// `same`: every value draws one picture. Said only of a group whose every value has its
// still, compared at full size, so a small real change is never taken for none.
export type GroupLook = { same: true } | { same: false; box: CropBox | null };

// Small enough to compare quickly, large enough that a cover's edge still shows.
const SAMPLE_W = 160;
// Per-channel difference that counts as changed: past JPEG's noise.
const THRESHOLD = 48;
// At full size, for "nothing changed": one render encoded twice is the same bytes, so any
// difference past rounding is the page's.
const STRICT = 8;
// Past this share of the still, the difference is the page: it is shown whole.
const WHOLE_AREA = 0.6;
// Room around what changed, as a share of the still's width.
const PAD = 0.04;

const WHOLE: GroupLook = { same: false, box: null };

const load = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });

// How a group's tiles frame its stills, the tile `tileRatio` wide per unit high. `complete`:
// these are every value's stills, none missing or failed.
export async function groupLook(
  stills: { url: string; asset: string }[],
  tileRatio: number,
  complete: boolean,
): Promise<GroupLook> {
  if (stills.length < 2) return WHOLE;
  // Stills are stored by their bytes: one asset is one picture, with nothing to decode.
  if (complete && stills.every((s) => s.asset === stills[0].asset)) return { same: true };
  const imgs = await Promise.all(stills.map((s) => load(s.url))).catch(() => null);
  if (!imgs) return WHOLE;
  const { naturalWidth: nw, naturalHeight: nh } = imgs[0];
  // A different height is a different page.
  if (!nw || !nh || imgs.some((i) => i.naturalWidth !== nw || i.naturalHeight !== nh)) {
    return WHOLE;
  }
  const ratio = nw / nh;
  const framed = (box: CropBox): GroupLook => ({
    same: false,
    box: box.w * box.h > WHOLE_AREA ? null : fitBox(box, ratio, tileRatio),
  });
  const sampled = changedBox(imgs, Math.min(SAMPLE_W, nw), THRESHOLD);
  if (sampled === undefined) return WHOLE;
  if (sampled) return framed(sampled);
  // Nothing past the noise at a tile's size: either a change too fine to sample, which the
  // full size frames, or none at all.
  const fine = changedBox(imgs, nw, STRICT);
  if (fine === undefined) return WHOLE;
  if (fine) return framed(fine);
  return complete ? { same: true } : WHOLE;
}

// The padded box of pixels any image differs from the first in, drawn `w` wide; null where
// none does, undefined where they can't be read. One image at a time against the first, so a
// group of full-size stills never sits in memory at once.
function changedBox(
  imgs: HTMLImageElement[],
  w: number,
  threshold: number,
): CropBox | null | undefined {
  const h = Math.max(1, Math.round((imgs[0].naturalHeight * w) / imgs[0].naturalWidth));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return undefined;
  const draw = (img: HTMLImageElement) => {
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  };
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  const base = draw(imgs[0]);
  for (const img of imgs.slice(1)) {
    const p = draw(img);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (
          Math.abs(p[i] - base[i]) <= threshold &&
          Math.abs(p[i + 1] - base[i + 1]) <= threshold &&
          Math.abs(p[i + 2] - base[i + 2]) <= threshold
        )
          continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const pad = PAD * w;
  const left = Math.max(0, x0 - pad);
  const top = Math.max(0, y0 - pad);
  return {
    x: left / w,
    y: top / h,
    w: (Math.min(w, x1 + 1 + pad) - left) / w,
    h: (Math.min(h, y1 + 1 + pad) - top) / h,
  };
}

// The box grown to the tile's shape (width / height, in pixels of a still `ratio` wide per
// unit high), centred on what changed and kept inside the still.
export function fitBox(box: CropBox, stillRatio: number, tileRatio: number): CropBox | null {
  // In still pixels with the still's height as 1.
  let w = box.w * stillRatio;
  let h = box.h;
  if (w / h < tileRatio) w = h * tileRatio;
  else h = w / tileRatio;
  if (w > stillRatio) [w, h] = [stillRatio, stillRatio / tileRatio];
  if (h > 1) [w, h] = [tileRatio, 1];
  // Too short or too narrow a still to take the tile's shape: it is shown whole.
  if (w > stillRatio + 1e-6) return null;
  const cx = (box.x + box.w / 2) * stillRatio;
  const cy = box.y + box.h / 2;
  const x = Math.min(Math.max(0, cx - w / 2), stillRatio - w);
  const y = Math.min(Math.max(0, cy - h / 2), 1 - h);
  return { x: x / stillRatio, y, w: w / stillRatio, h };
}
