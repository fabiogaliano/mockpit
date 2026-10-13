// Where the question card can rest over the canvas, after tunekit's panel: it
// snaps to the nearest of a few spots, and pushed against an edge it docks as
// a small handle there. tunekit snaps to six spots along the top and bottom;
// the card adds the middle of each side, where thumbs rest on an iPad held in
// two hands, and there it turns into a narrow column.

export type Spot =
  | "top-left"
  | "top-center"
  | "top-right"
  | "mid-left"
  | "mid-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";
export type Edge = "left" | "right" | "top" | "bottom";
export type Anchor = "start" | "center" | "end";
export interface Docked {
  edge: Edge;
  anchor: Anchor;
}
export interface CardPlace {
  at: Spot;
  docked: Docked | null;
}
// The area the card lives in: the screen under the canvas header.
export interface Area {
  top: number;
  w: number;
  h: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const SPOTS: Spot[] = [
  "top-left",
  "top-center",
  "top-right",
  "mid-left",
  "mid-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];
export const INSET = 12;
// The handle a docked card leaves on its edge.
export const HANDLE_T = 30;
export const HANDLE_L = 64;
// A finger this close to an edge while carrying the card docks it there.
export const DOCK_EDGE = 22;
// Released this far from every edge, a dragged handle opens the card again.
export const OPEN_ZONE = 140;

export const isColumn = (at: Spot) => at.startsWith("mid");

export function cardWidth(at: Spot, area: Area): number {
  return isColumn(at)
    ? Math.round(Math.min(280, area.w * 0.42))
    : Math.round(Math.min(520, area.w - INSET * 2));
}

export function spotRect(at: Spot, w: number, h: number, area: Area): Rect {
  const [v, side] = at.split("-");
  const x = side === "left" ? INSET : side === "right" ? area.w - w - INSET : (area.w - w) / 2;
  const top = area.top + INSET;
  const y =
    v === "top"
      ? top
      : v === "bottom"
        ? area.top + area.h - h - INSET
        : Math.max(top, area.top + (area.h - h) / 2);
  return { x, y, w, h };
}

// The spot for a point: the area in thirds, the middle row only at the sides.
export function spotAt(px: number, py: number, area: Area): Spot {
  const y = py - area.top;
  const v = y < area.h / 3 ? "top" : y > (area.h * 2) / 3 ? "bottom" : "mid";
  if (v === "mid") return px < area.w / 2 ? "mid-left" : "mid-right";
  const side = px < area.w / 3 ? "left" : px > (area.w * 2) / 3 ? "right" : "center";
  return `${v}-${side}` as Spot;
}

export const edgeDistance = (px: number, py: number, area: Area): number =>
  Math.min(px, area.w - px, py - area.top, area.top + area.h - py);

// The edge nearest a point, and the third of it the point is in.
export function dockAt(px: number, py: number, area: Area): Docked {
  const d: Record<Edge, number> = {
    left: px,
    right: area.w - px,
    top: py - area.top,
    bottom: area.top + area.h - py,
  };
  const edge = (Object.keys(d) as Edge[]).reduce((a, b) => (d[b] < d[a] ? b : a));
  const vertical = edge === "left" || edge === "right";
  const along = vertical ? py - area.top : px;
  const span = vertical ? area.h : area.w;
  const anchor: Anchor = along < span / 3 ? "start" : along > (span * 2) / 3 ? "end" : "center";
  return { edge, anchor };
}

export function handleRect(d: Docked, area: Area): Rect {
  const vertical = d.edge === "left" || d.edge === "right";
  const span = vertical ? area.h : area.w;
  const off =
    d.anchor === "start"
      ? INSET
      : d.anchor === "end"
        ? span - HANDLE_L - INSET
        : (span - HANDLE_L) / 2;
  return vertical
    ? { x: d.edge === "left" ? 0 : area.w - HANDLE_T, y: area.top + off, w: HANDLE_T, h: HANDLE_L }
    : {
        x: off,
        y: d.edge === "top" ? area.top : area.top + area.h - HANDLE_T,
        w: HANDLE_L,
        h: HANDLE_T,
      };
}

// A handle opened by a tap reopens at the spot nearest it.
export function spotForHandle(d: Docked): Spot {
  if (d.edge === "left" || d.edge === "right") {
    if (d.anchor === "center") return d.edge === "left" ? "mid-left" : "mid-right";
    return `${d.anchor === "start" ? "top" : "bottom"}-${d.edge}` as Spot;
  }
  const side = d.anchor === "start" ? "left" : d.anchor === "end" ? "right" : "center";
  return `${d.edge}-${side}` as Spot;
}

export const PLACE_KEY = "mockpit-card";

export function readPlace(raw: string | null): CardPlace {
  const fallback: CardPlace = { at: "bottom-center", docked: null };
  try {
    const v = JSON.parse(raw ?? "null") as Partial<CardPlace> | null;
    if (!v || !SPOTS.includes(v.at as Spot)) return fallback;
    const d = v.docked;
    const docked =
      d &&
      ["left", "right", "top", "bottom"].includes(d.edge) &&
      ["start", "center", "end"].includes(d.anchor)
        ? { edge: d.edge, anchor: d.anchor }
        : null;
    return { at: v.at as Spot, docked };
  } catch {
    return fallback;
  }
}
