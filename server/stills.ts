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

// Bumped when a capture draws the same cell differently: 2 loads the blob: textures a model
// fetches. An older still stays the cell's picture while its own is taken.
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
  priority: "visible" | "warm";
}

/** The index can be reconciled with the live feed by its revision. */
export interface StillsIndex {
  stills: Stills;
  taking: boolean;
  pending: Record<string, StillPending>;
  legacyPalettes: Record<number, string | null>;
  revision: number;
}

/** A retry can identify the failed asset without removing a newer replacement. */
export type StillRequestCell = StillCell & { retryAsset?: string };

/** Every requested key is either cached, pending, or absent from both. */
export type StillsRequest = Pick<StillsIndex, "stills" | "pending" | "revision">;

export const stillsSetting = (designId: string) => `stills:${designId}`;
// Past this a design's oldest stills go: twelve columns of a few dozen frames, twice over.
export const MAX_STILLS_PER_DESIGN = 600;
// What one sheet may ask for at once: the cells in view.
export const MAX_STILLS_ASKED = 120;

// key → asset id, oldest first.
export type Stills = Record<string, string>;

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
