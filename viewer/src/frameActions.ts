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
  | "pick"
  | "main"
  | "archive"
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
  // Pressed: picked, Main.
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
    case "pick":
    case "main":
      return exploring && liveHere(s, v).length > 1;
    case "archive":
      return exploring && v.status !== "inUse";
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

const ORDER: FrameActionId[] = [
  "pick",
  "main",
  "archive",
  "more",
  "comment",
  "borrow",
  "copy",
  "move",
];

// How each action reads and looks, wherever it is drawn.
export const FACE: Record<FrameActionId, { label: string; icon: IconName }> = {
  pick: { label: "Pick", icon: "check" },
  main: { label: "Make main", icon: "star" },
  archive: { label: "Archive", icon: "archive" },
  more: { label: "More like this", icon: "spark" },
  comment: { label: "Comment", icon: "mark" },
  borrow: { label: "Borrow a part", icon: "borrow" },
  copy: { label: "Copy to…", icon: "copy" },
  move: { label: "Move to…", icon: "move" },
};
const KEYS: Partial<Record<FrameActionId, string>> = { pick: "P", main: "M", archive: "X" };
const IN_MENU = new Set<FrameActionId>(["borrow", "copy", "move"]);

// The frame's actions, in the order every place draws them.
export function frameActions(s: DesignScreenState, f: FrameRef): FrameAction[] {
  const mark = s.markOf(subjectOf(f));
  const on: Partial<Record<FrameActionId, boolean>> = { pick: !!mark, main: mark === "main" };
  const said: Partial<Record<FrameActionId, string>> = {
    ...(mark ? { pick: "Picked" } : {}),
    ...(mark === "main" ? { main: "Main" } : {}),
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
    case "pick":
      return s.togglePick(subjectOf(f));
    case "main":
      return s.toggleMain(subjectOf(f));
    case "archive": {
      // The frame on stage leaves it for its neighbour, as the list reads.
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
      return void s.steer({ alternative: v.alternative, version, reaction: "more" }).then(
        (ok) =>
          ok &&
          s.setToast({
            text: `More like ${s.nameOf({ alternative: v.alternative, version })}, sent`,
          }),
      );
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
