// The sheet: frames down, the values of one choice knob or the design's looks across, each
// cell the frame wearing that value. It exists only where there is something to spread:
// two or more frames, and a choice knob or a look. Spread (beside a choice knob in Tune)
// opens it on the frame on stage; All widens it to every frame of the state. On a screen
// or a component it opens in an idea for it instead, holding copies of its frames, so
// exploring never changes the product design.
//
// Nothing here is stored: a cell is the frame's document with the values in its address
// (`?k=`). Its picture is a still once one is made (stills.ts), else the frame drawn live.

import { createEffect, createMemo, createSignal } from "solid-js";
import { choices } from "../../server/knobs.ts";
import { mainValuesFor } from "../../server/marks.ts";
import {
  MAX_SHEET_COLUMNS,
  SHEET_WIDTH,
  sheetCrop,
  sheetKnobs,
  type StillCell,
} from "../../server/stills.ts";
import type { KnobValue } from "../../server/types.ts";
import { isLive } from "../../server/types.ts";
import {
  api,
  surfaceUrl,
  type AlternativeView,
  type DesignDetail,
  type DraftInput,
  type LookView,
} from "./api.ts";
import { readonly } from "./host.ts";
import {
  historyRow,
  type KnobContext,
  resolveKnobs,
  settledOf,
  spokenName,
  tunedWithLook,
} from "./logic.ts";
import type { Preview, SheetView, Tool } from "./onScreen.ts";
import { designPath, navigate, SHEET_LOOKS } from "./route.ts";
import { framePalette, frameMode, peekRev } from "./systemRev.ts";
import type { Stills } from "./stills.ts";

// What a held preview's key starts with when it is a cell opened from the sheet.
const SHEET_HOLD = "sheet:";
export const isSheetHold = (key: string) => key.startsWith(SHEET_HOLD);

// Past this a cell is too small to tell anything by.
export const MAX_COLUMNS = MAX_SHEET_COLUMNS;

export interface SheetColumn {
  key: string;
  label: string;
  // What the cell wears over the frame's own values.
  values: Record<string, KnobValue>;
  // A look of the user's.
  mine?: boolean;
  // A look sets values; a knob's value is one.
  look?: LookView;
}

// The URL-safe value token of a sheet column: the knob's raw value, or the look's name.
export const valueOfCol = (col: SheetColumn, at: SheetView): string =>
  col.look ? col.look.name : String(at.knob ? (col.values[at.knob] ?? col.label) : col.label);

export interface SheetCell {
  src: string;
  knobs: Record<string, KnobValue>;
  part: string | null;
  // What its still is kept by, while frames are drawn as stills are taken.
  still: StillCell | null;
  width: number;
}

export interface ChoiceKnob {
  path: string;
  label: string;
  values: { value: string; label: string }[];
}

interface SheetDeps {
  project: string;
  design: () => DesignDetail | null;
  draft: () => DraftInput | null;
  activeState: () => string | null;
  activeAlternative: () => AlternativeView | undefined;
  inState: (state: string | null) => AlternativeView[];
  frameVersionOf: (v: AlternativeView) => number;
  looksHere: () => LookView[];
  product: () => boolean;
  view: readonly [() => SheetView | null, (v: SheetView | null) => void];
  chooseAlternative: (alternative: string) => void;
  heldPreview: () => Preview | null;
  setHeldPreview: (p: Preview | null) => void;
  tool: () => Tool | null;
  toggleTool: (t: Tool) => void;
  setToast: (line: { text: string } | null) => void;
  fail: (e: unknown) => void;
  stills: Stills;
}

// A knob's name in the user's words: its last segment ("figure.glyphs" → "Glyphs").
export const knobName = (path: string) => spokenName(path.slice(path.lastIndexOf(".") + 1));

// Where a sheet opens: the design's link with what it lays out, which lands in Focus.
export function sheetPath(project: string, slug: string, at: SheetView, state: string | null) {
  const base = designPath(project, slug, { state, alternative: null });
  const q = new URLSearchParams();
  q.set("sheet", at.knob ?? SHEET_LOOKS);
  if (at.one) q.set("one", at.one);
  return `${base}${base.includes("?") ? "&" : "?"}${q}`;
}

export function createSheet(d: SheetDeps) {
  const [view, setView] = d.view;
  const frames = createMemo(() => d.inState(d.activeState()).filter((v) => isLive(v.status)));
  const pageOf = (v: AlternativeView, version: number) =>
    (historyRow(v, version)?.surfaceKinds ?? v.surfaces.map((x) => x.kind)).indexOf("html");

  const choiceKnobs = createMemo<ChoiceKnob[]>(() => {
    const m = d.design();
    if (!m) return [];
    const configs = sheetKnobs(m.knobs, frames());
    return [...configs].flatMap(([path, config]) => {
      const values = choices(config);
      return values && values.length > 1 ? [{ path, label: knobName(path), values }] : [];
    });
  });
  // Two frames to set beside each other, a page to draw, and something to vary.
  const available = createMemo(() => {
    const v = d.activeAlternative();
    return (
      frames().length > 1 &&
      !!v &&
      pageOf(v, d.frameVersionOf(v)) >= 0 &&
      (choiceKnobs().length > 0 || d.looksHere().length > 0)
    );
  });
  const spreadable = (path: string) => available() && choiceKnobs().some((k) => k.path === path);
  // The knob the switch opens on: the last laid out here, else the first.
  let lastKnob: string | null | undefined;
  const defaultView = (): SheetView => {
    const knobs = choiceKnobs();
    const knob =
      lastKnob !== undefined && (lastKnob === null || knobs.some((k) => k.path === lastKnob))
        ? lastKnob
        : (knobs[0]?.path ?? null);
    return { knob, one: null };
  };

  const lookColumn = (l: LookView): SheetColumn => ({
    key: `look:${l.design}:${l.name}`,
    label: l.name,
    values: l.values,
    mine: l.author === "user",
    look: l,
  });
  const columnsOf = (at: SheetView | null): SheetColumn[] => {
    if (!at) return [];
    if (at.knob === null) return d.looksHere().map(lookColumn);
    const knob = choiceKnobs().find((k) => k.path === at.knob);
    return (knob?.values ?? []).map((o) => ({
      key: `${knob!.path}=${o.value}`,
      label: o.label,
      values: { [knob!.path]: o.value },
    }));
  };
  const rowsOf = (at: SheetView | null): AlternativeView[] => {
    if (!at) return [];
    const all = frames();
    if (at.one === null) return all;
    const one = all.find((v) => v.alternative === at.one);
    return one ? [one] : all.slice(0, 1);
  };
  const columnsAll = createMemo(() => columnsOf(view()));
  const columns = createMemo(() => columnsAll().slice(0, MAX_COLUMNS));
  const rows = createMemo(() => rowsOf(view()));

  // The part a column's values all belong to, where the frame's state declares it.
  const cropTo = (state: string | null, values: Record<string, KnobValue>): string | null => {
    const m = d.design();
    return sheetCrop(
      values,
      (part) =>
        !!m?.parts.some(
          (s) => (s.state === state || s.state === null) && s.parts.some((p) => p.name === part),
        ),
    );
  };

  function cell(v: AlternativeView, col: SheetColumn): SheetCell | null {
    const m = d.design();
    if (!m) return null;
    const version = d.frameVersionOf(v);
    const surface = pageOf(v, version);
    if (surface < 0) return null;
    // Merge accumulated Main picks on other knobs underneath this cell's value so
    // switching from glyphs to colour wears the chosen glyphs automatically.
    const mainVals = mainValuesFor(m.marks ?? [], v.state, v.alternative);
    const ctx: KnobContext = {
      knobs: { ...m.knobs, ...v.knobs },
      asks: m.asks,
      answers: d.draft()?.answers ?? {},
      tuned: { ...mainVals, ...d.draft()?.tunedOn[v.alternative] },
      settled: settledOf(m, v.alternative),
    };
    const tuned = col.look ? tunedWithLook(ctx, col.values) : { ...ctx.tuned, ...col.values };
    const knobs = resolveKnobs({ ...ctx, tuned });
    const rewrites = version === v.version ? (v.rewrites ?? 0) : 0;
    const mode = frameMode();
    const palette = framePalette() ?? m.defaultPalette ?? null;
    const e = version === v.version ? v.instancesKey : m.instanceHistory?.[v.postId]?.[version];
    const width = m.widths[0] ?? SHEET_WIDTH;
    const part = cropTo(v.state, col.values);
    return {
      src: surfaceUrl(v.postId, surface, {
        version,
        mode,
        knobs,
        e,
        w: rewrites || undefined,
      }),
      knobs,
      part,
      width,
      // Older system revisions can be inspected without changing current captures.
      still:
        peekRev() === null
          ? {
              postId: v.postId,
              version,
              rewrites: version === v.version ? rewrites : -1,
              e: e ?? "",
              knobs,
              part,
              mode,
              palette,
              surface,
              width,
              system: m.systemRev ?? 0,
            }
          : null,
    };
  }

  // On a screen or a component: into the idea for it and this knob, made the first time,
  // holding a copy of every frame of the state; the frame on stage's copy is the row.
  async function inIdea(at: SheetView) {
    const m = d.design();
    const all = frames();
    if (!m || !all.length || readonly()) return;
    const label = at.knob ? knobName(at.knob) : "Looks";
    try {
      const res = await api.saveCopies({
        title: `${m.title} · ${label}`,
        for: m.slug,
        candidates: all.map((v) => ({
          design: m.id,
          state: v.state,
          alternative: v.alternative,
          version: d.frameVersionOf(v),
        })),
      });
      const i = at.one === null ? -1 : all.findIndex((v) => v.alternative === at.one);
      const one = i >= 0 ? (res.saved[i]?.alternative ?? null) : null;
      navigate(sheetPath(d.project, res.to.slug, { knob: at.knob, one }, null), { focus: true });
    } catch (e) {
      d.fail(e);
    }
  }

  // Side-by-side canvas view for the open knob cell's active finalists.
  const [knobSide, setKnobSide] = createSignal(false);

  // The state it was opened on: another has frames of its own to lay out.
  let openedOn: string | null = null;
  createEffect(() => {
    const st = d.activeState();
    if (view() && st !== openedOn) setView(null);
  });

  function resolveKnob(knob: string | null) {
    const knobs = choiceKnobs();
    return knob !== null && !knobs.some((k) => k.path === knob) ? (knobs[0]?.path ?? null) : knob;
  }

  function open(at: SheetView) {
    if (d.product()) return void inIdea(at);
    if (d.tool() === "tune") d.toggleTool("tune");
    const knob = resolveKnob(at.knob);
    lastKnob = knob;
    openedOn = d.activeState();
    setKnobSide(false);
    setView({ ...at, knob });
  }
  // Spread: the frame on stage in every value of the knob.
  const spread = (path: string) =>
    open({ knob: path, one: d.activeAlternative()?.alternative ?? null });
  const close = () => {
    setPointedKey(null);
    setView(null);
  };

  // The cell under the pointer or the keyboard's focus, which M, K and X mark.
  const [pointedKey, setPointedKey] = createSignal<{ post: string; column: string } | null>(null);
  const row = (id: string) => rows().find((v) => v.postId === id);
  const column = (key: string) => columns().find((col) => col.key === key);
  const pointed = createMemo(() => {
    const key = pointedKey();
    const v = key && row(key.post);
    const col = key && column(key.column);
    return v && col ? { v, col } : null;
  });

  // The cell opened from the sheet, and the sheet as it was laid out, which its neighbours
  // and the way back come from. It stands while the stage holds that cell.
  const [opened, setOpened] = createSignal<{
    at: SheetView;
    alternative: string;
    col: string;
  } | null>(null);
  const heldKey = (alternative: string, col: string) => `${SHEET_HOLD}${alternative}:${col}`;
  const held = createMemo(() => {
    const o = opened();
    if (!o || d.heldPreview()?.key !== heldKey(o.alternative, o.col)) return null;
    const rows = rowsOf(o.at);
    const cols = columnsOf(o.at).slice(0, MAX_COLUMNS);
    const r = rows.findIndex((v) => v.alternative === o.alternative);
    const c = cols.findIndex((x) => x.key === o.col);
    if (r < 0 || c < 0) return null;
    return { at: o.at, rows, cols, r, c, v: rows[r], col: cols[c] };
  });
  createEffect(() => {
    if (!held()) setKnobSide(false);
  });
  // Where the sheet lands when it opens again: the cell last open, scrolled to and pointed.
  const [landing, setLanding] = createSignal<{ alternative: string; col: string } | null>(null);

  function hold(v: AlternativeView, col: SheetColumn, at: SheetView) {
    const c = cell(v, col);
    if (!c) return;
    d.chooseAlternative(v.alternative);
    setOpened({ at, alternative: v.alternative, col: col.key });
    d.setHeldPreview({
      key: heldKey(v.alternative, col.key),
      label: `${v.alternative} · ${col.label}`,
      alternative: v.alternative,
      state: v.state,
      knobs: c.knobs,
    });
  }
  // Open a cell from the Sheet grid: the frame on stage, held in those values with the
  // knob choice panel beside it.
  function openCell(v: AlternativeView, col: SheetColumn) {
    const at = view();
    if (!at) return;
    hold(v, col, at);
    close();
  }
  // Focus another option or frame while already inspecting a cell (updates URL via replaceState).
  function focusCell(v: AlternativeView, col: SheetColumn) {
    const at = held()?.at ?? view();
    if (!at) return;
    hold(v, col, at);
  }
  // Open a cell directly from URL parameters (`?alternative=...&sheet=...&value=...`) or Back/Forward.
  function openCellByValue(alternative: string | null, at: SheetView, value: string): boolean {
    if (d.product()) return false;
    const knob = resolveKnob(at.knob);
    const resolved: SheetView = { ...at, knob };
    const rs = rowsOf(resolved);
    const cs = columnsOf(resolved).slice(0, MAX_COLUMNS);
    const v =
      (alternative ? rs.find((x) => x.alternative === alternative) : undefined) ??
      d.activeAlternative() ??
      rs[0];
    const col = cs.find(
      (c) => valueOfCol(c, resolved) === value || c.label === value || c.key === value,
    );
    if (!v || !col) return false;
    lastKnob = knob;
    openedOn = d.activeState();
    hold(v, col, resolved);
    close();
    return true;
  }
  // From the open cell to its neighbour in the sheet it came from: across the row to the
  // next value or look, down the column to the next frame. Nothing past the edges.
  function step(down: number, across: number) {
    const h = held();
    if (!h) return;
    const v = h.rows[h.r + down];
    const col = h.cols[h.c + across];
    if (v && col) hold(v, col, h.at);
  }
  // Back to the sheet the open cell came from, landing on it.
  function back() {
    const h = held();
    if (!h) return;
    setLanding({ alternative: h.v.alternative, col: h.col.key });
    setKnobSide(false);
    d.setHeldPreview(null);
    open(h.at);
  }
  // Leave the sheet and any open sheet cell completely, returning to plain One view.
  function exit() {
    setKnobSide(false);
    if (held()) d.setHeldPreview(null);
    close();
  }

  return {
    view,
    available,
    choiceKnobs,
    spreadable,
    defaultView,
    columns,
    total: () => columnsAll().length,
    rows,
    frames,
    cell,
    lookColumn,
    open,
    spread,
    close,
    exit,
    openCell,
    focusCell,
    openCellByValue,
    held,
    knobSide,
    setKnobSide,
    step,
    back,
    landing,
    setLanding,
    pointed,
    pointedKey,
    setPointedKey,
    row,
    column,
    stills: d.stills,
  };
}

export type Sheet = ReturnType<typeof createSheet>;
