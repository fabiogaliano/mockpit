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
import type { StillCell } from "../../server/stills.ts";
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
  knobPart,
  type KnobContext,
  resolveKnobs,
  settledOf,
  spokenName,
  tunedWithLook,
} from "./logic.ts";
import type { Preview, SheetView, Tool } from "./onScreen.ts";
import { designPath, navigate, SHEET_LOOKS } from "./route.ts";
import { framePalette, frameMode, peekRev, systemRev } from "./systemRev.ts";
import type { Stills } from "./stills.ts";

// Past this a cell is too small to tell anything by.
export const MAX_COLUMNS = 12;

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
    const configs = new Map(Object.entries(m.knobs));
    for (const v of frames()) for (const [p, c] of Object.entries(v.knobs ?? {})) configs.set(p, c);
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
  const columnsAll = createMemo<SheetColumn[]>(() => {
    const at = view();
    if (!at) return [];
    if (at.knob === null) return d.looksHere().map(lookColumn);
    const knob = choiceKnobs().find((k) => k.path === at.knob);
    return (knob?.values ?? []).map((o) => ({
      key: `${knob!.path}=${o.value}`,
      label: o.label,
      values: { [knob!.path]: o.value },
    }));
  });
  const columns = createMemo(() => columnsAll().slice(0, MAX_COLUMNS));
  const rows = createMemo(() => {
    const at = view();
    if (!at) return [];
    const all = frames();
    if (at.one === null) return all;
    const one = all.find((v) => v.alternative === at.one);
    return one ? [one] : all.slice(0, 1);
  });

  // The part a column's values all belong to, where the frame's state declares it.
  const cropTo = (state: string | null, values: Record<string, KnobValue>): string | null => {
    const m = d.design();
    const parts = new Set(Object.keys(values).map(knobPart));
    if (!m || parts.size !== 1) return null;
    const [part] = parts;
    const declared = m.parts.some(
      (s) => (s.state === state || s.state === null) && s.parts.some((p) => p.name === part),
    );
    return part && declared ? part : null;
  };

  function cell(v: AlternativeView, col: SheetColumn): SheetCell | null {
    const m = d.design();
    if (!m) return null;
    const version = d.frameVersionOf(v);
    const surface = pageOf(v, version);
    if (surface < 0) return null;
    const ctx: KnobContext = {
      knobs: { ...m.knobs, ...v.knobs },
      asks: m.asks,
      answers: d.draft()?.answers ?? {},
      tuned: d.draft()?.tunedOn[v.alternative] ?? {},
      settled: settledOf(m, v.alternative),
    };
    const tuned = col.look ? tunedWithLook(ctx, col.values) : { ...ctx.tuned, ...col.values };
    const knobs = resolveKnobs({ ...ctx, tuned });
    const rewrites = version === v.version ? (v.rewrites ?? 0) : 0;
    const mode = frameMode();
    const part = cropTo(v.state, col.values);
    return {
      src: surfaceUrl(v.postId, surface, {
        version,
        mode,
        knobs,
        e: v.instancesKey,
        w: rewrites || undefined,
      }),
      knobs,
      part,
      width: m.widths[0] ?? 820,
      // A palette picked to view in, or an older system looked at, is drawn live.
      still:
        framePalette() === null && peekRev() === null
          ? {
              postId: v.postId,
              version,
              rewrites,
              e: v.instancesKey ?? "",
              knobs,
              part,
              mode,
              system: systemRev() ?? 0,
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

  // The state it was opened on: another has frames of its own to lay out.
  let openedOn: string | null = null;
  createEffect(() => {
    const st = d.activeState();
    if (view() && st !== openedOn) setView(null);
  });

  function open(at: SheetView) {
    if (d.product()) return void inIdea(at);
    if (d.tool() === "tune") d.toggleTool("tune");
    const knobs = choiceKnobs();
    const knob =
      at.knob !== null && !knobs.some((k) => k.path === at.knob)
        ? (knobs[0]?.path ?? null)
        : at.knob;
    lastKnob = knob;
    openedOn = d.activeState();
    setView({ ...at, knob });
  }
  // Spread: the frame on stage in every value of the knob.
  const spread = (path: string) =>
    open({ knob: path, one: d.activeAlternative()?.alternative ?? null });
  const close = () => {
    setPointed(null);
    setView(null);
  };

  // The cell under the pointer or the keyboard's focus, which P, M and X mark.
  const [pointed, setPointed] = createSignal<{ v: AlternativeView; col: SheetColumn } | null>(null);

  // A double-click: the frame on stage, held in those values until let go.
  function openCell(v: AlternativeView, col: SheetColumn) {
    const c = cell(v, col);
    if (!c) return;
    d.chooseAlternative(v.alternative);
    d.setHeldPreview({
      key: `sheet:${v.alternative}:${col.key}`,
      label: `${v.alternative} · ${col.label}`,
      alternative: v.alternative,
      state: v.state,
      knobs: c.knobs,
    });
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
    openCell,
    pointed,
    setPointed,
    stills: d.stills,
  };
}

export type Sheet = ReturnType<typeof createSheet>;
