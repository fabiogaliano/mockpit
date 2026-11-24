// Where a choice knob's stills differ: the box, in fractions of the still, holding every
// pixel that isn't the same in all of them. A knob that changes three small covers changes a
// corner of a 1280-wide page, and a tile showing the whole page shows that corner as a few
// pixels; framed on the box, the difference reads at tile size. Worked out once every still
// of the group is in, so the tiles never re-frame as they arrive.

export interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Small enough to compare quickly, large enough that a cover's edge still shows.
const SAMPLE_W = 160;
// Per-channel difference that counts as changed: past JPEG's noise.
const THRESHOLD = 48;
// Past this share of the still, the difference is the page: it is shown whole.
const WHOLE_AREA = 0.6;
// Room around what changed, as a share of the still's width.
const PAD = 0.04;

const load = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });

// How a group's tiles frame its stills, the tile `tileRatio` wide per unit high: on what
// differs, or null for the whole still.
export async function groupCrop(urls: string[], tileRatio: number): Promise<CropBox | null> {
  const found = await diffBox(urls).catch(() => null);
  return found ? fitBox(found.box, found.ratio, tileRatio) : null;
}

// The box of what differs across the stills, with the stills' width per unit of height; null
// for the whole still: when they are one picture, sized differently, or differ over most of it.
export async function diffBox(urls: string[]): Promise<{ box: CropBox; ratio: number } | null> {
  if (urls.length < 2) return null;
  const imgs = await Promise.all(urls.map(load));
  const { naturalWidth: nw, naturalHeight: nh } = imgs[0];
  if (!nw || !nh || imgs.some((i) => i.naturalWidth !== nw || i.naturalHeight !== nh)) return null;
  const w = Math.min(SAMPLE_W, nw);
  const h = Math.max(1, Math.round((nh * w) / nw));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const pixels = imgs.map((img) => {
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  });
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  const base = pixels[0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const changed = pixels.some(
        (p) =>
          Math.abs(p[i] - base[i]) > THRESHOLD ||
          Math.abs(p[i + 1] - base[i + 1]) > THRESHOLD ||
          Math.abs(p[i + 2] - base[i + 2]) > THRESHOLD,
      );
      if (!changed) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const pad = PAD * w;
  const box = {
    x: Math.max(0, x0 - pad) / w,
    y: Math.max(0, y0 - pad) / h,
    w: (Math.min(w, x1 + 1 + pad) - Math.max(0, x0 - pad)) / w,
    h: (Math.min(h, y1 + 1 + pad) - Math.max(0, y0 - pad)) / h,
  };
  return box.w * box.h > WHOLE_AREA ? null : { box, ratio: nw / nh };
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
