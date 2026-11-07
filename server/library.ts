// The component library: shared components (no area), each in the group that says
// what it does, beside each area's own. A group is any word and exists only while a
// component names it. A component of one area that screens of several areas show is
// offered a move to shared, never moved. Runtime-agnostic; the viewer shares these.

import type { Design } from "./types.ts";

// The usual five, offered first and only as suggestions: the project's own words count.
export const SUGGESTED_GROUPS = ["Actions", "Inputs", "Navigation", "Feedback", "Containers"];

export const isShared = (design: Pick<Design, "kind" | "area">) =>
  design.kind === "component" && !design.area;

// By component slug, the areas of the live screens that show it, nested instances
// included: `screens` is each such screen's area and what it is built from.
export function areasShowing(
  screens: { area: string | null; builtFrom: string[] }[],
): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  for (const s of screens) {
    if (!s.area) continue;
    for (const slug of s.builtFrom) out.set(slug, (out.get(slug) ?? new Set()).add(s.area));
  }
  return new Map([...out].map(([slug, areas]) => [slug, [...areas].sort()]));
}

// Where a component of one area shows in screens of two or more, the areas; else null.
export function spansAreas(
  design: Pick<Design, "kind" | "area" | "archivedAt">,
  areas: string[] | undefined,
): string[] | null {
  if (design.kind !== "component" || !design.area || design.archivedAt) return null;
  return areas && areas.length >= 2 ? areas : null;
}

const listed = (names: string[]) =>
  names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

export const inAreasLine = (title: string, areas: string[]) => `${title} is in ${listed(areas)}`;

export const sharedNudge = (design: Pick<Design, "slug" | "title">, areas: string[]) =>
  `${inAreasLine(design.title, areas)}; make it shared: \`edit ${design.slug} --area ''\``;
