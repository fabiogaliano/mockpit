// A design whose entries are many takes a section of its own on the Board: an idea, with
// its alternatives down and its states across, or a variants design, its variants down
// and its states across. Built from the tree the Board already reads, every cell a still.
// Where the same names run across the states the rows line up under their names; where
// each state has its own (a lab), a grid would be mostly empty, so each state is a
// column of its own alternatives.

import { flowFor, isLive } from "../../server/types.ts";
import type { TreeNode } from "./api.ts";
import { foldText } from "./logic.ts";

interface GridCell {
  alternative: string;
  state: string | null;
  poster?: string;
  archived: boolean;
  inUse: boolean;
  description?: string;
}

export interface Grid {
  slug: string;
  title: string;
  idea: boolean;
  // What the section is, beside its name: "idea for Today", "becomes system", "variants".
  label: string;
  cols: (string | null)[];
  // Every name, live ones first, in the order they were made.
  rows: string[];
  aligned: boolean;
  cells: GridCell[];
  width: number | null;
  open: number;
  live: number;
  archived: number;
}

// A section this long gets a filter on its header: about a screenful of rows.
export const FILTER_FROM = 20;

export function gridOf(node: TreeNode, titleOf: (slug: string) => string | undefined): Grid {
  const cols: (string | null)[] = node.states.length ? node.states : [null];
  const cells: GridCell[] = node.alternatives
    .filter((v) => cols.includes(v.state))
    .map((v) => ({
      alternative: v.alternative,
      state: v.state,
      ...(v.poster ? { poster: v.poster } : {}),
      archived: !isLive(v.status),
      inUse: v.status === "inUse",
      ...(v.description ? { description: v.description } : {}),
    }));
  const liveNames = [...new Set(cells.filter((c) => !c.archived).map((c) => c.alternative))];
  const rows = [...new Set([...liveNames, ...cells.map((c) => c.alternative)])];
  const filled = cells.filter((c) => !c.archived).length;
  const flow = flowFor(node.for);
  const target = flow ?? (node.for ? titleOf(node.for) : undefined);
  return {
    slug: node.slug,
    title: node.title,
    idea: node.kind === "idea",
    label:
      node.kind !== "idea"
        ? "variants"
        : node.for
          ? `idea for ${target ?? node.for}`
          : node.becomes
            ? `becomes ${node.becomes}`
            : "idea",
    cols,
    rows,
    aligned: filled * 2 > liveNames.length * cols.length,
    cells,
    width: node.widths[0] ?? null,
    open: node.open,
    live: new Set(cells.filter((c) => !c.archived).map((c) => c.alternative)).size,
    archived: new Set(cells.filter((c) => c.archived).map((c) => c.alternative)).size,
  };
}

// The filter on a long section: a name or a description holding every word typed,
// accents and case aside.
export function cellShown(c: GridCell, query: string): boolean {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = foldText(`${c.alternative} ${c.description ?? ""}`);
  return words.every((w) => hay.includes(w));
}
