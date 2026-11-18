// Sheet stills: one picture of a frame wearing some knob values, cropped to a part or
// whole. A sheet is frames × values, which grows fast, so each is made once, the first
// time a sheet shows that cell, and kept by everything that changes how it looks: the
// frame's version and rewrites, its instances, the values, the part, the mode and the
// system's revision. Shared with the viewer, which looks cells up by the same key.
//
// The stills of a design live in one setting, newest last, capped: they are a cache, so
// what falls off or whose image the workspace evicted is made again when next in view.

import type { KnobValue } from "./types.ts";

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
}

// Keys in a fixed order, so two writers of the same values agree.
const canonical = (v: unknown): string =>
  v && typeof v === "object" && !Array.isArray(v)
    ? `{${Object.keys(v)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
        .join(",")}}`
    : JSON.stringify(v);

export const stillKey = (c: StillCell): string =>
  [c.postId, c.version, c.rewrites, c.e, c.mode, c.system, c.part ?? "", canonical(c.knobs)].join(
    "|",
  );

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
