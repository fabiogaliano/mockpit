// How Home sorts and pictures a project, read off what each design holds, so a
// project gets structure by being used and an agent files nothing. Screens and
// components stay as declared; the rest is an idea or a document by its contents.
// Pure rules: Album.tsx and Home.tsx draw them.

import { isLive } from "../../server/types.ts";
import type { TreeNode } from "./api.ts";
import {
  designWidth,
  groupByArea,
  designStatus,
  type DesignStatus,
  nothingLeft,
  orderAreas,
  screenPicture,
  type ScreenPicture,
  type StatusNode,
} from "./logic.ts";

export type Section = "ideas" | "screens" | "flows" | "components" | "documents";
export type ShelfSection = Exclude<Section, "flows">;

export const SECTION_LABEL: Record<Section, string> = {
  ideas: "Ideas",
  screens: "Screens",
  flows: "Flows",
  components: "Components",
  documents: "Documents",
};

// One render, nothing asked and no design width is something to read. A declared
// width means someone is designing for a device, however few pictures it has so
// far; on the real data that keeps a lone phone idea out of Documents.
export function sectionOf(node: {
  kind: TreeNode["kind"];
  shortlist?: boolean;
  asked?: number;
  states: (string | null)[];
  variants: unknown[];
  widths: number[];
}): ShelfSection {
  if (node.kind === "screen") return "screens";
  if (node.kind === "component") return "components";
  if (node.shortlist || node.asked || node.variants.length > 1) return "ideas";
  if (node.states.filter((s) => s !== null).length > 1 || node.widths.length) return "ideas";
  return "documents";
}

// The product is what ships: its sections come first, and Home opens on them.
export const PRODUCT_SECTIONS: Section[] = ["screens", "flows", "components"];

// The sections a project has lit: the product's first, then Ideas, where exploring
// happens. Documents wait at the foot of the sidebar.
export function litSections(count: Record<Section, number>): {
  rows: Section[];
  foot: Section | null;
} {
  const rows = [...PRODUCT_SECTIONS, "ideas" as const].filter((s) => count[s] > 0);
  return { rows, foot: count.documents ? "documents" : null };
}

export type CoverShape = "phone" | "wide" | "both" | "part" | "text";

// The picture an album opens on: the design in use, else the first state with one.
export function albumPicture(
  node: Pick<TreeNode, "inUse" | "variants" | "states">,
): ScreenPicture | null {
  for (const state of [...node.inUse.map((u) => u.state), ...node.states]) {
    const pic = screenPicture(node, state);
    if (pic) return pic;
  }
  return null;
}

const PHONE_MAX = 700;

// The two widths a design ships at when they read as different devices.
export function bothWidths(node: Pick<TreeNode, "widths">): { phone: number; wide: number } | null {
  const phone = Math.min(...node.widths);
  const wide = Math.max(...node.widths);
  return node.widths.length > 1 && phone < PHONE_MAX && wide >= PHONE_MAX ? { phone, wide } : null;
}

export function coverShape(node: TreeNode): CoverShape {
  // Planned has no picture yet but it does have a shape: its outline is where the
  // picture will go, and a wrong shape would jump when the first one comes.
  if (node.planned) {
    if (node.kind === "component") return "part";
    return designWidth(node) < PHONE_MAX ? "phone" : "wide";
  }
  const pic = albumPicture(node);
  if (!pic || sectionOf(node) === "documents") return "text";
  if (node.kind === "component") return "part";
  // A poster is one still at one width, with no second width to put beside it.
  if (bothWidths(node) && !pic.poster) return "both";
  return designWidth(node) < PHONE_MAX ? "phone" : "wide";
}

const liveVariants = (node: Pick<TreeNode, "variants">) =>
  node.variants.filter((v) => isLive(v.status)).length;

// How many sheets stack behind the cover: states, else attempts, else none. Plain
// sheets rather than the pictures themselves: each of those would be a whole page
// loading, and a stack is only saying there's more inside.
export function stackDepth(node: Pick<TreeNode, "states" | "variants">): number {
  const states = node.states.filter((s) => s !== null).length;
  const pictures = states > 1 ? states : liveVariants(node);
  return Math.min(Math.max(pictures - 1, 0), 2);
}

// Named by the agent and with nothing in them yet.
const undrawnStates = (node: Pick<TreeNode, "states" | "variants">) =>
  node.states.filter((st) => st !== null && !node.variants.some((v) => v.state === st)).length;

export function albumInside(node: TreeNode): string {
  const states = node.states.filter((s) => s !== null).length;
  const live = liveVariants(node);
  const parts: string[] = [];
  if (node.planned) parts.push("Planned");
  if (node.shortlist) parts.push("Gathered");
  if (states > 1) parts.push(`${states} states`);
  const notYet = node.planned ? 0 : undrawnStates(node);
  if (notYet) parts.push(`${notYet} not drawn`);
  if (live > 1 && live !== states) parts.push(`${live} variants`);
  if (bothWidths(node)) parts.push("Phone and desktop");
  return parts.join(" · ");
}

export type TurnKind = DesignStatus["kind"] | "idle" | "inDesign";

const TURN_TEXT: Record<Exclude<TurnKind, "open">, string> = {
  draft: "Draft to send",
  changed: "New version",
  unseen: "Not seen yet",
  working: "Agent working",
  decided: "In use",
  // Delivered, with no call from the agent since: all that can honestly be said.
  sent: "Sent",
  exploring: "Exploring",
  idle: "Nothing waiting",
  inDesign: "in design",
};

// What still says whose turn it is on a screen or a component. Nothing there is chosen or
// in use, so the rest give way to its mark.
const ACTIVITY = new Set<TurnKind>(["open", "draft", "unseen", "working", "sent"]);

// A project this small is one or two things to look at, not a place to navigate.
export const SIDEBAR_FROM = 3;
// Up to this many designs in a lone section, the sidebar lists them by name.
const TREE_UP_TO = 12;

// One way off the shelf, however it got there: archived by hand, or with every variant
// archived. A plan has nothing live because nothing is drawn yet, which is not the same.
export const inArchive = (n: TreeNode) => !!n.archivedAt || (nothingLeft(n) && !n.planned);

// What the sidebar holds, for Home and for the one that opens over a design.
// `order`: the project's areas in the order it lists them.
export function sidebarOf(nodes: TreeNode[], flows: number, order: string[]) {
  const onShow = nodes.filter((n) => !inArchive(n));
  const inSection = (sec: ShelfSection) => onShow.filter((n) => sectionOf(n) === sec);
  const counts: Record<Section, number> = {
    ideas: inSection("ideas").length,
    screens: inSection("screens").length,
    components: inSection("components").length,
    documents: inSection("documents").length,
    flows,
  };
  const lit = litSections(counts);
  // The lone section, whose designs the sidebar can list by name: there's no section
  // choice to make there, and the shelf beside it is the same few things larger. A
  // dated list already is the names.
  const lone =
    lit.rows.length === 1 && !lit.foot && lit.rows[0] !== "flows" && lit.rows[0] !== "documents"
      ? inSection(lit.rows[0] as ShelfSection)
      : null;
  return {
    onShow,
    archived: nodes.filter(inArchive),
    counts,
    lit,
    areas: orderAreas(
      onShow.flatMap((n) => (n.area ? [n.area] : [])),
      order,
    ),
    tree:
      lone && lone.length <= TREE_UP_TO
        ? groupByArea(lone, (n) => n.area, order).map((g) => ({ area: g.area, nodes: g.rows }))
        : null,
  };
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const questions = (n: number) => plural(n, "question");

// Whose turn it is, in a word, on anything still on a shelf: an archived design has left,
// and its place in the Archive says so.
export function turnWord(node: StatusNode, now: number): { kind: TurnKind; text: string } | null {
  if (node.archivedAt) return null;
  if (node.status !== undefined) {
    const status = designStatus(
      { ...node, variants: node.variants.map((v) => ({ ...v, changedTo: undefined })) },
      now,
    );
    if (status && ACTIVITY.has(status.kind)) {
      return status.kind === "open"
        ? { kind: "open", text: questions(status.n) }
        : { kind: status.kind, text: TURN_TEXT[status.kind] };
    }
    // Marked, the cover's dot says Ready or Changed (and the status line, on a phone).
    return node.status === "in design"
      ? { kind: "inDesign", text: TURN_TEXT.inDesign }
      : { kind: "idle", text: TURN_TEXT.idle };
  }
  const status = designStatus(node, now);
  if (!status) return { kind: "idle", text: TURN_TEXT.idle };
  return status.kind === "open"
    ? { kind: "open", text: questions(status.n) }
    : { kind: status.kind, text: TURN_TEXT[status.kind] };
}

// Where a component appears. Hosts needn't be declared screens, and calling a
// idea a screen would make the count say something untrue.
export function usedIn(node: TreeNode, kindOf: (slug: string) => string | undefined): string {
  const n = node.embeddedIn.length;
  if (!n) return "";
  const screens = node.embeddedIn.every((s) => kindOf(s) === "screen");
  const word = screens ? "screen" : "design";
  return `in ${n} ${word}${n === 1 ? "" : "s"}`;
}

// When a design last had new work. Not the design's own updatedAt, which a draft or an
// ending also moves: what's newest shouldn't reshuffle because of a click.
export function lastWork(node: Pick<TreeNode, "variants" | "createdAt">): string {
  return node.variants.reduce((t, v) => (v.updatedAt > t ? v.updatedAt : t), node.createdAt);
}

export const newestFirst = (a: TreeNode, b: TreeNode) => lastWork(b).localeCompare(lastWork(a));

export interface DateGroup {
  key: string;
  label: string;
  rows: TreeNode[];
  open: boolean;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const shortDate = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
};

// "Today", "Yesterday", then the date, in the viewer's own time.
function dayLabel(d: Date, now: Date): string {
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const daysAgo = Math.round((midnight(now) - midnight(d)) / 86_400_000);
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  const year = d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}${year}`;
}

// Rows under the day they happened, newest day and newest row first. A row with no
// date can't be placed, so it goes last under its own heading rather than being lost.
export function byDay<T>(
  rows: readonly T[],
  at: (row: T) => string | null | undefined,
  id: (row: T) => string,
  now = new Date(),
): { key: string; label: string; rows: T[] }[] {
  const days = new Map<string, { key: string; label: string; t: number; rows: T[] }>();
  const sorted = [...rows].sort(
    (a, b) => (at(b) ?? "").localeCompare(at(a) ?? "") || id(a).localeCompare(id(b)),
  );
  for (const row of sorted) {
    const iso = at(row);
    const d = iso ? new Date(iso) : null;
    const key = d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : "undated";
    const day = days.get(key);
    if (day) day.rows.push(row);
    else {
      days.set(key, {
        key,
        label: d ? dayLabel(d, now) : "No date",
        t: d ? d.getTime() : 0,
        rows: [row],
      });
    }
  }
  return [...days.values()].sort((a, b) => b.t - a.t);
}

// From here a section gets headings by date; ia.md's threshold, an inference.
export const DATED_FROM = 13;
// Enough open to work with on arrival. Below this a project whose newest month is
// sparse (`workspace`: 2 pages in September, 90 before) would land on almost nothing.
const OPEN_UNTIL = 12;

// Rows newest first under date headings, which give a burst of work a place. With
// `byDay` the newest month goes by day; older months always go by month. Older
// groups start folded, unless something in them waits on the user.
export function dateGroups(rows: TreeNode[], byDay: boolean, now = new Date()): DateGroup[] {
  const sorted = [...rows].sort(newestFirst);
  const month = (d: Date) => d.getFullYear() * 12 + d.getMonth();
  const newest = sorted.length ? month(new Date(lastWork(sorted[0]))) : 0;
  const groups = new Map<string, DateGroup>();
  for (const row of sorted) {
    const d = new Date(lastWork(row));
    const daily = byDay && month(d) === newest;
    const key = daily
      ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      : `${d.getFullYear()}-${d.getMonth()}`;
    const year = d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`;
    const label = daily
      ? `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}${year}`
      : `${MONTHS[d.getMonth()]}${year}`;
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { key, label, rows: [row], open: false });
  }
  let shown = 0;
  for (const group of groups.values()) {
    group.open = shown < OPEN_UNTIL || group.rows.some((r) => r.open > 0);
    if (group.open) shown += group.rows.length;
  }
  return [...groups.values()];
}
