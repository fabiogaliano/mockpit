// Images the user attaches to a write-in or a note. They are for a model to
// read, so each is made model-sized before upload: long edge capped, bytes
// under the limit an agent's model accepts, orientation baked in. Re-encoding
// also drops EXIF (GPS) from photos.

import { ATTACHABLE_IMAGE_TYPES } from "../../server/types.ts";
import { host } from "./host.ts";

export const ACCEPT = [...ATTACHABLE_IMAGE_TYPES].join(",");
// Past ~2000px a model downsamples anyway; text in a screenshot stays legible.
export const MAX_EDGE = 2048;
// Under the 5 MiB asset cap and a model's ~5 MB per-image limit once base64'd.
export const MAX_BYTES = 3.5 * 1024 * 1024;
// A raw file this large is refused before decoding it.
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;

export function fitWithin(w: number, h: number, max = MAX_EDGE): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

// Why a file can't be attached, said so the user can act on it; null if it can.
export function rejectReason(file: Pick<File, "type" | "size" | "name">): string | null {
  if (!ATTACHABLE_IMAGE_TYPES.has(file.type)) {
    return `${file.name || "That file"} isn't a PNG, JPEG, WebP or GIF image`;
  }
  if (file.size > MAX_SOURCE_BYTES) return `${file.name || "That image"} is too large`;
  if (file.type === "image/gif" && file.size > MAX_BYTES) {
    return `${file.name || "That GIF"} is over ${MAX_BYTES / 1024 / 1024} MB`;
  }
  return null;
}

// The files a paste or a drop carries. Clipboard screenshots arrive unnamed or
// all as "image.png", so each gets a name that says where it came from.
export function filesOf(data: DataTransfer | null, source: "paste" | "drop"): File[] {
  if (!data) return [];
  const files: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    const f = item.getAsFile();
    if (f) files.push(f);
  }
  if (!files.length) files.push(...Array.from(data.files ?? []));
  return files.map((f, i) =>
    source === "paste" && (!f.name || f.name === "image.png")
      ? new File([f], `pasted-${i + 1}.${f.type.split("/")[1] || "png"}`, { type: f.type })
      : f,
  );
}

export const hasFiles = (data: DataTransfer | null): boolean =>
  !!data && Array.from(data.types ?? []).includes("Files");

// The bytes to upload: the file itself when it already fits (and is a GIF,
// whose animation a canvas would flatten), else a scaled re-encode — PNG first
// for crisp screenshots, then WebP, then JPEG, whichever fits first.
export async function prepareImage(file: File): Promise<Blob> {
  if (file.type === "image/gif") return file;
  const win = host().window;
  const bitmap = await win.createImageBitmap(file, { imageOrientation: "from-image" });
  const { w, h } = fitWithin(bitmap.width, bitmap.height);
  if (w === bitmap.width && file.size <= MAX_BYTES && file.type !== "image/jpeg") {
    bitmap.close();
    return file;
  }
  const canvas = win.document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("couldn't read that image");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const encode = (type: string, quality?: number) =>
    new Promise<Blob | null>((done) => canvas.toBlob(done, type, quality));
  const tries: [string, number | undefined][] = [
    ...(file.type === "image/png" ? [["image/png", undefined] as [string, undefined]] : []),
    ["image/webp", 0.9],
    ["image/jpeg", 0.88],
    ["image/jpeg", 0.75],
  ];
  for (const [type, quality] of tries) {
    const blob = await encode(type, quality);
    // A browser that can't encode a type hands back PNG instead.
    if (blob && blob.type === type && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error(`${file.name || "That image"} is too large to attach`);
}

export function extensionOf(type: string): string {
  return type === "image/jpeg" ? "jpg" : type.split("/")[1] || "png";
}
