// Where everything sits on the project canvas — pure, so the same tree always
// lands in the same place. One cluster per mock: per state a row with the
// chosen variant large, the open alternatives small beside it, and the
// archived ones as a muted stack that fans out when opened; dropped variants
// are left out. Pages go on the first shelves and the components they are
// built from on the shelves below, each in the order it was made, so a new
// mock only ever appends and nothing the user has learned to find moves.

import { isLive } from "../../server/types.ts";
import type { TreeNode, TreeVariant } from "./api.ts";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TileBox extends Rect {
  slug: string;
  variant: TreeVariant;
  role: "main" | "alt" | "archived";
}

export interface StackBox extends Rect {
  slug: string;
  state: string | null;
  count: number;
}

export interface RowBox {
  state: string | null;
  y: number;
}

export interface ClusterBox extends Rect {
  node: TreeNode;
  rows: RowBox[];
}

export interface Edge {
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Layout {
  clusters: ClusterBox[];
  tiles: TileBox[];
  stacks: StackBox[];
  edges: Edge[];
  w: number;
  h: number;
}

const GAP = 12;
const PAD = 20;
export const CLUSTER_HEAD = 48;
const ROW_LABEL = 22;
const CLUSTER_GAP = 72;
const SHELF_W = 2600;
// A design narrower than this is judged at phone width: its tiles stand up.
const PHONE_MAX = 700;

export const stackKey = (slug: string, state: string | null) => `${slug}::${state ?? ""}`;

// The width a node's designs lay out at, which sets its tiles' shape.
export const designWidth = (node: TreeNode): number => node.widths[0] ?? 1280;

function tileSizes(node: TreeNode) {
  return designWidth(node) < PHONE_MAX
    ? { main: { w: 220, h: 400 }, alt: { w: 104, h: 194 } }
    : { main: { w: 360, h: 240 }, alt: { w: 174, h: 114 } };
}

export function layoutProject(nodes: TreeNode[], expanded: ReadonlySet<string>): Layout {
  const byAge = (a: TreeNode, b: TreeNode) => a.createdAt.localeCompare(b.createdAt);
  const pages = nodes.filter((n) => n.kind === "page").sort(byAge);
  const components = nodes.filter((n) => n.kind !== "page").sort(byAge);

  const clusters: ClusterBox[] = [];
  const tiles: TileBox[] = [];
  const stacks: StackBox[] = [];
  let shelfX = 0;
  let shelfY = 0;
  let shelfH = 0;
  let width = 0;
  const newShelf = () => {
    if (shelfX === 0) return;
    shelfY += shelfH + CLUSTER_GAP;
    shelfX = 0;
    shelfH = 0;
  };

  const place = (node: TreeNode) => {
    const size = tileSizes(node);
    const local: { tiles: TileBox[]; stacks: StackBox[]; rows: RowBox[] } = {
      tiles: [],
      stacks: [],
      rows: [],
    };
    const multi = node.states.length > 1;
    let y = CLUSTER_HEAD;
    let w = 0;
    for (const state of node.states) {
      const inState = node.variants.filter((v) => v.state === state);
      const live = inState.filter((v) => isLive(v.status));
      const archived = inState.filter((v) => v.status === "archived");
      if (!live.length && !archived.length) continue;
      if (multi) y += ROW_LABEL;
      local.rows.push({ state, y });
      const main = live.find((v) => v.status === "accepted") ?? live[0];
      let x = PAD;
      let rowH = size.alt.h;
      if (main) {
        local.tiles.push({ slug: node.slug, variant: main, role: "main", x, y, ...size.main });
        x += size.main.w + GAP;
        rowH = size.main.h;
      }
      // The small ones fill columns two high beside the large one.
      const small: (TileBox | StackBox)[] = live
        .filter((v) => v !== main)
        .map((variant) => ({
          slug: node.slug,
          variant,
          role: "alt" as const,
          x: 0,
          y: 0,
          ...size.alt,
        }));
      if (archived.length) {
        if (expanded.has(stackKey(node.slug, state))) {
          for (const variant of archived) {
            small.push({ slug: node.slug, variant, role: "archived", x: 0, y: 0, ...size.alt });
          }
        }
        small.push({ slug: node.slug, state, count: archived.length, x: 0, y: 0, ...size.alt });
      }
      const perColumn = Math.max(1, Math.floor((rowH + GAP) / (size.alt.h + GAP)));
      small.forEach((b, i) => {
        b.x = x + Math.floor(i / perColumn) * (size.alt.w + GAP);
        b.y = y + (i % perColumn) * (size.alt.h + GAP);
        if ("variant" in b) local.tiles.push(b);
        else local.stacks.push(b);
      });
      const columns = Math.ceil(small.length / perColumn);
      w = Math.max(w, x + columns * (size.alt.w + GAP) - GAP);
      y += rowH + GAP;
    }
    const cw = Math.max(280, w + PAD);
    const ch = y - GAP + PAD;
    if (shelfX > 0 && shelfX + cw > SHELF_W) newShelf();
    const ox = shelfX;
    const oy = shelfY;
    clusters.push({
      node,
      x: ox,
      y: oy,
      w: cw,
      h: ch,
      rows: local.rows.map((r) => ({ ...r, y: r.y + oy })),
    });
    for (const t of local.tiles) tiles.push({ ...t, x: t.x + ox, y: t.y + oy });
    for (const s of local.stacks) stacks.push({ ...s, x: s.x + ox, y: s.y + oy });
    shelfX += cw + CLUSTER_GAP;
    shelfH = Math.max(shelfH, ch);
    width = Math.max(width, ox + cw);
  };

  for (const n of pages) place(n);
  newShelf();
  for (const n of components) place(n);

  const at = new Map(clusters.map((c) => [c.node.slug, c]));
  const edges: Edge[] = [];
  for (const c of clusters) {
    for (const slug of c.node.uses) {
      const to = at.get(slug);
      if (!to || to === c) continue;
      edges.push({
        from: c.node.slug,
        to: slug,
        x1: c.x + c.w / 2,
        y1: c.y + c.h,
        x2: to.x + to.w / 2,
        y2: to.y,
      });
    }
  }
  return { clusters, tiles, stacks, edges, w: width, h: shelfY + shelfH };
}

// The tiles worth a live picture: on screen, largest first, at most `cap`,
// so a zoomed-out canvas of many designs never loads a frame per tile.
export function tilesToRender(
  tiles: TileBox[],
  view: { x: number; y: number; scale: number; w: number; h: number },
  cap: number,
): Set<string> {
  const on = tiles
    .map((t) => {
      const x = t.x * view.scale + view.x;
      const y = t.y * view.scale + view.y;
      const w = t.w * view.scale;
      const h = t.h * view.scale;
      const visible = x + w > 0 && y + h > 0 && x < view.w && y < view.h;
      return { id: t.variant.postId, area: w * h, visible };
    })
    .filter((t) => t.visible)
    .sort((a, b) => b.area - a.area)
    .slice(0, cap);
  return new Set(on.map((t) => t.id));
}
