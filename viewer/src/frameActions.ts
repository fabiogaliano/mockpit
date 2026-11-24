// What can be done with a design and with each of its frames: one action set, each action
// there when the design or the frame has what it needs. The pill on a frame or a sheet
// cell, the panel's row and an answer's row all draw from here, so no screen decides for
// itself what a kind of design allows.
//
// What an action needs: Pick and Main, something to choose between (an idea's state with
// two or more live frames); Use, a version to put in use, which a screen's or component's
// newest version already is; Ready, a screen or a component, whose frames ship; Archive,
// a live frame not in use; Comment, a page to comment on.

import type { MarkSubject } from "../../server/marks.ts";
import { type Ask, type AskOption, isLive } from "../../server/types.ts";
import type { AlternativeView } from "./api.ts";
import { readonly } from "./host.ts";
import type { IconName } from "./icons.tsx";
import { drawsAnswer, historyRow, moreAllowed } from "./logic.ts";
import type { SheetColumn } from "./sheet.ts";
import type { DesignScreenState } from "./state.ts";

export type FrameActionId =
  | "main"
  | "keep"
  | "delete"
  | "more"
  | "comment"
  | "borrow"
  | "copy"
  | "move";
// What the design as a whole offers.
export type DesignActionId = "use" | "ready" | "newIdea" | "exploreInIdea";

// A frame, or a sheet cell: the frame worn in a look or a knob's value.
export interface FrameRef {
  v: AlternativeView;
  col?: SheetColumn;
}

export interface FrameAction {
  id: FrameActionId;
  label: string;
  icon: IconName;
  // Its key while the pointer is on the frame.
  key?: string;
  // Pressed: Main, Bookmarked.
  on?: boolean;
  // Behind ⋯ where the actions are a row; never on the pill.
  menu?: boolean;
}

// What ships and what is explored: a screen's or component's frames ship as they are.
const ships = (s: DesignScreenState) => {
  const kind = s.design()?.kind;
  return kind !== undefined && kind !== "idea";
};

export function canDesign(s: DesignScreenState, id: DesignActionId): boolean {
  if (!s.design()) return false;
  switch (id) {
    case "use":
      return !ships(s);
    case "ready":
      return ships(s) && (s.design()?.alternatives.length ?? 0) > 0;
    case "newIdea":
      return ships(s) && !readonly();
    case "exploreInIdea":
      return ships(s);
  }
}

const liveHere = (s: DesignScreenState, v: AlternativeView) =>
  s.inState(v.state).filter((x) => isLive(x.status));
const hasPage = (s: DesignScreenState, v: AlternativeView) =>
  (
    historyRow(v, s.frameVersionOf(v))?.surfaceKinds ?? v.surfaces.map((x) => String(x.kind))
  ).includes("html");

export function canFrame(s: DesignScreenState, id: FrameActionId, f: FrameRef): boolean {
  const v = f.v;
  if (readonly() || !s.design() || !isLive(v.status)) return false;
  const exploring = !ships(s);
  switch (id) {
    case "main":
    case "keep":
      // On a sheet cell, choosing between knob values works even for a single frame.
      return exploring && (!!f.col || liveHere(s, v).length > 1);
    case "delete":
      return exploring && (!!f.col || v.status !== "inUse");
    case "more":
    case "copy":
    case "move":
      return exploring;
    case "borrow":
      return exploring && !f.col && liveHere(s, v).length > 1;
    case "comment":
      return hasPage(s, v);
  }
}

// What a mark on this frame or cell is on.
export function subjectOf(f: FrameRef): MarkSubject {
  const base = { state: f.v.state, alternative: f.v.alternative };
  const col = f.col;
  if (!col) return base;
  if (col.look) return { ...base, look: col.look.name, values: col.values };
  return Object.keys(col.values).length ? { ...base, values: col.values } : base;
}

// Marks, then what is asked of the agent, then Delete at the end, away from Bookmark.
const ORDER: FrameActionId[] = [
  "main",
  "keep",
  "comment",
  "more",
  "delete",
  "borrow",
  "copy",
  "move",
];

// How each action reads and looks, wherever it is drawn.
export const FACE: Record<FrameActionId, { label: string; icon: IconName }> = {
  main: { label: "Make main", icon: "star" },
  keep: { label: "Bookmark", icon: "bookmark" },
  delete: { label: "Delete", icon: "trash" },
  more: { label: "More like this", icon: "spark" },
  comment: { label: "Comment", icon: "mark" },
  borrow: { label: "Borrow a part", icon: "borrow" },
  copy: { label: "Copy to…", icon: "copy" },
  move: { label: "Move to…", icon: "move" },
};
const KEYS: Partial<Record<FrameActionId, string>> = { main: "M", keep: "K", delete: "X" };
const IN_MENU = new Set<FrameActionId>(["borrow", "copy", "move"]);

// The frame's actions, in the order every place draws them.
export function frameActions(s: DesignScreenState, f: FrameRef): FrameAction[] {
  const mark = s.markOf(subjectOf(f));
  const on: Partial<Record<FrameActionId, boolean>> = {
    main: mark === "main",
    keep: mark === "keep",
  };
  const said: Partial<Record<FrameActionId, string>> = {
    ...(mark === "main" ? { main: "Main" } : {}),
    ...(mark === "keep" ? { keep: "Bookmarked" } : {}),
  };
  return ORDER.filter((id) => canFrame(s, id, f)).map((id) => ({
    id,
    ...FACE[id],
    ...(said[id] ? { label: said[id]! } : {}),
    ...(KEYS[id] ? { key: KEYS[id] } : {}),
    ...(id in on ? { on: on[id] } : {}),
    ...(IN_MENU.has(id) ? { menu: true } : {}),
  }));
}

// Whether the panel has a row for the frame: something beyond a comment, which the canvas's
// own tool already offers.
export const hasActs = (s: DesignScreenState, f: FrameRef) =>
  frameActions(s, f).some((a) => a.id !== "comment");

// Does what the pill, a key or the panel asked. Borrow, Copy and Move open something where
// they were pressed, so their caller does them.
export function runFrameAction(s: DesignScreenState, id: FrameActionId, f: FrameRef) {
  if (!canFrame(s, id, f)) return;
  const v = f.v;
  switch (id) {
    case "main":
      return s.toggleMain(subjectOf(f));
    case "keep":
      return s.toggleKeep(subjectOf(f));
    case "delete": {
      // On a sheet cell, delete ONLY this knob/look cell (never archive the whole alternative!).
      if (f.col) {
        void s.deleteMark(subjectOf(f));
        // If we deleted the cell currently held on stage, advance to the next active option.
        const held = s.sheet.held();
        if (held && held.v.alternative === v.alternative && held.col.key === f.col.key) {
          const next = held.cols.find(
            (c) =>
              c.key !== f.col!.key &&
              s.markOf(subjectOf({ v, col: c })) !== "deleted" &&
              s.markOf(subjectOf({ v, col: c })) !== "keep",
          );
          if (next) s.sheet.focusCell(v, next);
        }
        return;
      }
      // Bare frame: archive the alternative, stepping to its neighbour.
      if (s.activeAlternative()?.alternative === v.alternative) {
        const live = liveHere(s, v);
        const at = live.findIndex((x) => x.alternative === v.alternative);
        const next = live[at + 1] ?? live[at - 1];
        const step =
          next &&
          s
            .steps()
            .filter((x) => x.alternative === next.alternative && !x.hidden)
            .at(-1);
        if (step) s.showVersion(step);
      }
      return void s.archiveAlternatives([v.alternative]);
    }
    case "more": {
      const version = s.frameVersionOf(v);
      if (s.steer({ alternative: v.alternative, version, reaction: "more", values: f.col?.values }))
        s.setToast({
          text: `More like ${s.nameOf({ alternative: v.alternative, version })}, in Send`,
        });
      return;
    }
    case "comment":
      // A cell is commented on as the frame it is, on stage.
      if (f.col) s.sheet.openCell(v, f.col);
      else s.chooseAlternative(v.alternative);
      return s.setMarking(true);
    default:
      return;
  }
}

// An answer's row: the same actions, routed through its question. Pick holds it beside the
// answer chosen (its frame's mark, or kept where it is on no frame); Archive takes it out of
// the running; More like this asks the question for more of it; Comment is on that answer.
export function answerActions(
  s: DesignScreenState,
  ask: Ask,
  o: AskOption,
  opts: { dormant: boolean; frame: AlternativeView | undefined },
) {
  const picked = s.isPicked(ask, o.id);
  if (readonly()) return picked ? { picked } : undefined;
  const acts = !opts.dormant;
  const curate = acts && drawsAnswer(o);
  const f = opts.frame ? { v: opts.frame } : null;
  return {
    picked,
    curate,
    like: acts && moreAllowed(ask),
    borrow: !!f && canFrame(s, "borrow", f),
    move: !!f && canFrame(s, "move", f),
  };
}
