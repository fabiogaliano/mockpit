// Markers: the pins/boxes a user draws over a rendered surface, and the `@n`
// tokens that keep the comment text and the drawing in agreement.
import type { Anchor } from "./projects.ts";

export type MarkerShape = "pin" | "rect" | "circle";

export interface Marker {
  ref: number;
  shape: MarkerShape;
  // Normalized to the rendered frame, 0..1.
  x: number;
  y: number;
  w: number;
  h: number;
  surfaceIndex: number;
  // The element the sandbox's hit-test reported, treated as data (rendered as
  // text only — never as markup).
  path?: string;
  text?: string;
  // The rect the hit-test reported, so a pin can snap to its element when the
  // user reshapes it into a box or a circle.
  rect?: number[];
}

export function nextRef(markers: readonly Marker[]): number {
  return markers.reduce((max, m) => Math.max(max, m.ref), 0) + 1;
}

// Which `@n` tokens the text mentions. Typing over a token is how a marker is
// removed from the keyboard, so the text is authoritative for membership.
export function refsInText(text: string): Set<number> {
  return new Set([...text.matchAll(/@(\d+)/g)].map((m) => Number(m[1])));
}

export function appendToken(text: string, ref: number): string {
  return `${text.replace(/\s*$/, "")} @${ref} `.replace(/^ /, "");
}

export function removeToken(text: string, ref: number): string {
  return text.replace(new RegExp(`\\s?@${ref}\\b`, "g"), "").replace(/ {2,}/g, " ");
}

export function anchorsFor(
  markers: readonly Marker[],
  postVersion: number,
  viewport: number,
): Anchor[] {
  return markers.map((m) => ({
    ref: `@${m.ref}`,
    shape: m.shape,
    box:
      m.shape === "pin"
        ? [round(m.x), round(m.y)]
        : [round(m.x), round(m.y), round(m.w), round(m.h)],
    surfaceIndex: m.surfaceIndex,
    postVersion,
    ...(m.path ? { path: m.path } : {}),
    ...(m.text ? { text: m.text } : {}),
    viewport,
  }));
}

const round = (n: number) => Math.round(n * 1000) / 1000;

// The label a chip / thread ref shows: the element's own text when the sandbox
// could name it, else its css path.
export function markerLabel(m: Marker): string {
  return m.text || m.path || m.shape;
}
