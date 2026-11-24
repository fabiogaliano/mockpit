// Sheet stills: one picture of a frame wearing some knob values, cropped to a part or
// whole. A sheet is frames × values, which grows fast, so each is made once, the first
// time a sheet shows that cell, and kept by everything that changes how it looks: the
// frame's version and rewrites, its instances, the values, the part, the mode and the
// system's revision. Shared with the viewer, which looks cells up by the same key.
//
// The stills of a design live in one setting, newest last, capped: they are a cache, so
// what falls off or whose image the workspace evicted is made again when next in view.

import { knobPart } from "./knobValues.ts";
import type { Knobs, KnobValue } from "./types.ts";

export interface StillCell {
  postId: string;
  version: number;
  rewrites: number;
  // The alternative's instances key: a component it includes changed.
  e: string;
  knobs: Record<string, KnobValue>;
  // The part the cell is cropped to; null is the whole frame.
  part: string | null;
  mode: string;
  system: number;
  surface: number;
  width: number;
  palette: string | null;
}

// Keys in a fixed order, so two writers of the same values agree.
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
          .join(",")}}`
      : JSON.stringify(v);

/** Compatibility follows the settings and crop the user is comparing. */
export const stillCompatibility = (c: StillCell): string =>
  canonical([c.postId, c.surface, c.width, c.mode, c.palette, c.part, canonical(c.knobs)]);

// Bumped when a capture draws the same cell differently: 2 records the page's live canvases
// (stillMasks) and loads the blob: textures a model fetches. An older still stays the cell's
// picture while its own is taken.
const STILL_CAPTURE = 2;

/** The exact identity adds the content that renders those settings. */
export const stillKey = (c: StillCell): string =>
  JSON.stringify([stillCompatibility(c), c.version, c.rewrites, c.e, c.system, STILL_CAPTURE]);

// The old key stored a revision but lacked the actual default palette and crop geometry.
const legacyKey = /^([^|]+)\|\d+\|\d+\|[^|]*\|([^|]+)\|(\d+)\|([^|]*)\|(.*)$/;

/** Recover the system revision a pre-existing default-palette cache entry wore. */
export function legacyStillRevision(key: string): number | undefined {
  const match = legacyKey.exec(key);
  return match ? Number(match[3]) : undefined;
}

/** Older pictures from other contents of the same cell are useful while it updates. */
export function olderStillCompatibility(
  key: string,
  palettes: Record<number, string | null>,
): string | null {
  try {
    if (key.startsWith("[")) {
      const [compatible] = JSON.parse(key);
      return typeof compatible === "string" ? compatible : null;
    }
    const match = legacyKey.exec(key);
    const palette = match && palettes[Number(match[3])];
    return match && palette !== undefined
      ? canonical([match[1], match[2], palette, match[4] || null, match[5]])
      : null;
  } catch {
    return null;
  }
}

/** Legacy geometry qualifies as a temporary picture only. */
export const legacyStillCompatibility = (c: StillCell): string =>
  canonical([c.postId, c.mode, c.palette, c.part, canonical(c.knobs)]);

/** Both capture paths use this inset when framing a part. */
export const SHEET_PART_PAD = 16;
/** Very tall documents are represented by their top in a thumbnail. */
export const SHEET_MAX_HEIGHT_RATIO = 3;
/** The default layout width is shared by capture and live thumbnails. */
export const SHEET_WIDTH = 820;
/** The viewer and publish warming lay out the same choice columns. */
export const MAX_SHEET_COLUMNS = 12;

/** Identifies a single queue attempt on either side of the worker boundary. */
export interface StillPending {
  attempt: string;
  expires: number;
  // "lead": what the user is choosing between right now, before anything else visible.
  priority: "lead" | "visible" | "warm";
}

/** The index can be reconciled with the live feed by its revision. */
export interface StillsIndex {
  stills: Stills;
  masks: StillMasks;
  taking: boolean;
  pending: Record<string, StillPending>;
  legacyPalettes: Record<number, string | null>;
  revision: number;
}

/** A retry can identify the failed asset without removing a newer replacement. */
export type StillRequestCell = StillCell & { retryAsset?: string };

/** Every requested key is either cached, pending, or absent from both. */
export type StillsRequest = Pick<StillsIndex, "stills" | "masks" | "pending" | "revision">;

export const stillsSetting = (designId: string) => `stills:${designId}`;
// Past this a design's oldest stills go: twelve columns of a few dozen frames, twice over.
export const MAX_STILLS_PER_DESIGN = 600;
// What one sheet may ask for at once: the cells in view.
export const MAX_STILLS_ASKED = 120;

// key → asset id, oldest first.
export type Stills = Record<string, string>;

// Where a still's page drew a live canvas (WebGL, WebGPU, or one handed to a worker), in
// fractions of the still. Such a canvas draws a moving scene, never twice alike, so what
// differs inside it between two stills is the moment, not the value: the viewer leaves it
// out when it frames or judges a knob's stills. A 2-D canvas is not one: what it draws
// follows the page, as markup does.
export interface StillBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
// key → its live canvases, for stills taken since they were recorded: none is [].
export type StillMasks = Record<string, StillBox[]>;
export const stillMasksSetting = (designId: string) => `still-masks:${designId}`;
const MAX_MASKS = 16;

export function readStillMasks(raw: string | null): StillMasks {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as StillMasks) : {};
  } catch {
    return {};
  }
}

const unit = (n: unknown): n is number => typeof n === "number" && n >= 0 && n <= 1;

/** A capture's boxes, or null when they aren't boxes inside the still. */
export function checkStillMasks(raw: unknown): StillBox[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_MASKS) return null;
  const out: StillBox[] = [];
  for (const b of raw) {
    if (!b || typeof b !== "object") return null;
    const { x, y, w, h } = b as Record<string, unknown>;
    if (![x, y, w, h].every(unit)) return null;
    out.push({ x: x as number, y: y as number, w: w as number, h: h as number });
  }
  return out;
}

/** The masks with one still's, kept only for stills the design still has. */
export function withStillMasks(
  masks: StillMasks,
  stills: Stills,
  key: string,
  boxes: StillBox[],
): StillMasks {
  const out: StillMasks = {};
  for (const k of Object.keys(stills)) if (masks[k]) out[k] = masks[k];
  if (stills[key]) out[key] = boxes;
  return out;
}

/** The masks of these stills only. */
export const masksOf = (masks: StillMasks, stills: Stills): StillMasks =>
  Object.fromEntries(Object.keys(stills).flatMap((k) => (masks[k] ? [[k, masks[k]]] : [])));

export function readStills(raw: string | null): Stills {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Stills) : {};
  } catch {
    return {};
  }
}

export function withStill(stills: Stills, key: string, asset: string): Stills {
  const { [key]: _was, ...rest } = stills;
  const keys = Object.keys(rest);
  const drop = keys.length + 1 - MAX_STILLS_PER_DESIGN;
  const kept = drop > 0 ? keys.slice(drop) : keys;
  return { ...Object.fromEntries(kept.map((k) => [k, rest[k]])), [key]: asset };
}

/** Crop when all the column values belong to the same declared part. */
export function sheetCrop(values: Record<string, KnobValue>, declared: (part: string) => boolean) {
  const parts = new Set(Object.keys(values).map(knobPart));
  const [part] = parts;
  return parts.size === 1 && part && declared(part) ? part : null;
}

/** A state's last override supplies a choice knob's columns across its rows. */
export function sheetKnobs(design: Knobs, frames: { knobs?: Knobs }[]): Map<string, Knobs[string]> {
  const configs = new Map(Object.entries(design));
  for (const frame of frames) {
    for (const [path, config] of Object.entries(frame.knobs ?? {})) configs.set(path, config);
  }
  return configs;
}
