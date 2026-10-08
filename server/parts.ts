// The parts an agent marked in its html (`data-part`, optional `data-part-label`
// and `data-part-key`). Read server-side from the markup string with a regex —
// geometry is the bridge's job, identity is declared, so no DOM is needed.

import type { Surface } from "./types.ts";

export interface PartInfo {
  name: string;
  label?: string;
  // Instance keys seen for this part, in document order.
  keys?: string[];
}

export interface PartChanges {
  vanished: string[];
  renamed: { from: string; to: string }[];
}

const TAG_RE = /<[A-Za-z][\w:-]*(\s[^<>]*)?>/g;
const ATTR_RE = /\sdata-part(-label|-key)?\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
const MAX_PARTS = 200;

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

export function partsInHtml(html: string): PartInfo[] {
  const byName = new Map<string, PartInfo>();
  for (const tag of html.matchAll(TAG_RE)) {
    const attrs = tag[1];
    if (!attrs || !attrs.includes("data-part")) continue;
    let name: string | undefined;
    let label: string | undefined;
    let key: string | undefined;
    for (const a of attrs.matchAll(ATTR_RE)) {
      const value = decode(a[2] ?? a[3] ?? a[4] ?? "").slice(0, 200);
      if (a[1] === "-label") label = value;
      else if (a[1] === "-key") key = value;
      else name = value;
    }
    if (!name) continue;
    let part = byName.get(name);
    if (!part) {
      if (byName.size >= MAX_PARTS) break;
      part = { name };
      byName.set(name, part);
    }
    if (label && !part.label) part.label = label;
    if (key) {
      part.keys ??= [];
      if (!part.keys.includes(key)) part.keys.push(key);
    }
  }
  return [...byName.values()];
}

export function partsInSurfaces(surfaces: Surface[]): PartInfo[] {
  return mergeParts(surfaces.flatMap((s) => (s.kind === "html" ? [partsInHtml(s.html)] : [])));
}

// Union several part lists by name, first occurrence first.
export function mergeParts(lists: PartInfo[][]): PartInfo[] {
  const byName = new Map<string, PartInfo>();
  for (const list of lists) {
    for (const p of list) {
      const have = byName.get(p.name);
      if (!have) {
        byName.set(p.name, { ...p, ...(p.keys ? { keys: [...p.keys] } : {}) });
        continue;
      }
      if (p.label && !have.label) have.label = p.label;
      for (const k of p.keys ?? []) {
        have.keys ??= [];
        if (!have.keys.includes(k)) have.keys.push(k);
      }
    }
  }
  return [...byName.values()];
}

// What happened to the previous version's parts. A part that disappeared but
// whose key or label reappears under a new name was renamed — comments anchored
// on it re-anchor by key, so the agent should know which name it now answers to.
export function diffParts(before: PartInfo[], after: PartInfo[]): PartChanges {
  const afterNames = new Set(after.map((p) => p.name));
  const beforeNames = new Set(before.map((p) => p.name));
  const added = after.filter((p) => !beforeNames.has(p.name));
  const vanished: string[] = [];
  const renamed: { from: string; to: string }[] = [];
  const taken = new Set<string>();
  for (const old of before) {
    if (afterNames.has(old.name)) continue;
    const match = added.find(
      (p) =>
        !taken.has(p.name) &&
        ((old.keys ?? []).some((k) => (p.keys ?? []).includes(k)) ||
          (!!old.label && old.label === p.label)),
    );
    if (match) {
      taken.add(match.name);
      renamed.push({ from: old.name, to: match.name });
    } else vanished.push(old.name);
  }
  return { vanished, renamed };
}
