// Tune presets (+ / preset ▾): named snapshots of a mock's tuned values, kept in
// this browser per mock. tunekit has presets of its own, but they are per panel
// and snapshot every value in it; ours span every component and keep only what
// was tuned, so an untouched part knob still follows the global it refines.

import type { KnobValue } from "../../server/types.ts";
import { host } from "./host.ts";

export interface Preset {
  name: string;
  tuned: Record<string, KnobValue>;
}

const key = (mockId: string) => `mockpit-presets:${mockId}`;

export function parsePresets(raw: string | null): Preset[] {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.flatMap((p) =>
      p &&
      typeof p === "object" &&
      typeof p.name === "string" &&
      p.tuned &&
      typeof p.tuned === "object" &&
      !Array.isArray(p.tuned)
        ? [{ name: p.name, tuned: p.tuned as Record<string, KnobValue> }]
        : [],
    );
  } catch {
    return [];
  }
}

export function loadPresets(mockId: string): Preset[] {
  try {
    return parsePresets(host().storage?.getItem(key(mockId)) ?? null);
  } catch {
    return [];
  }
}

export function storePresets(mockId: string, list: Preset[]) {
  try {
    host().storage?.setItem(key(mockId), JSON.stringify(list));
  } catch {
    // Quota or privacy mode: the presets live for this page only.
  }
}
