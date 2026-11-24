// The Choices panel's groups: the state's alternatives, then each choice knob the frame on
// stage reads (logic.ts isChoiceKnob, readsKnob), the knobs that reshape it, then under
// Fine-tune every other knob it reads, so there is one place to choose. A value picked holds
// across the state's live frames that have the knob; marks are the Sheet's cells', so the two
// agree. A knob whose `when` its frame doesn't meet is left out, with a line saying why. What
// is new is per browser (choicesSeen.ts), as is the user's own fold of a group.

import { batch, createMemo } from "solid-js";
import { explicitKnob } from "../../server/knobs.ts";
import { isLive, type KnobConfig, type KnobValue } from "../../server/types.ts";
import type { AlternativeView } from "./api.ts";
import { knownChoices, markChoiceKnown, ownFolds, setOwnFold } from "./choicesSeen.ts";
import { canFrame, subjectOf } from "./frameActions.ts";
import { readonly } from "./host.ts";
import {
  ALTERNATIVES_GROUP,
  choiceFolds,
  choiceWrites,
  draftKnobValues,
  frameKnobContext,
  knobAsk,
  partLabel,
  readsKnob,
} from "./logic.ts";
import { knobName, type SheetColumn } from "./sheet.ts";
import type { DesignScreenState } from "./state.ts";

export interface ChoiceGroup {
  path: string;
  label: string;
  // A colour with options: one row of swatches.
  colour: boolean;
  values: { value: string; label: string }[];
}

// A knob under Fine-tune: drawn by its declared control.
export interface FineKnob {
  path: string;
  label: string;
  cfg: KnobConfig;
}

// A knob the frame reads but whose `when` it doesn't meet: what it changes can't be seen.
export interface IdleKnob {
  path: string;
  label: string;
  // The knob it waits on, and the values that would show it.
  on: string;
  values: string[];
}

export const knobGroup = (path: string) => `knob:${path}`;
export const FINE_GROUP = "fine";
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export function createChoices(s: DesignScreenState) {
  // The frame the panel is about: the one on stage, never the one under the pointer.
  const frame = () => s.alternativeFor(s.activeState(), false);
  const live = () => s.inState(s.activeState()).filter((v) => isLive(v.status));
  const knobsOf = (v: AlternativeView) => ({ ...s.design()?.knobs, ...v.knobs });
  const reads = (v: AlternativeView, path: string) =>
    readsKnob(v, s.frameVersionOf(v), path, knobsOf(v));
  const hasAlternatives = () =>
    !s.design()?.archivedAt &&
    s.alternatives().filter((v) => v.state === s.activeState()).length > 1;

  // The knob a `when` waits on, with what would show it; null where it is met.
  const idleOn = (path: string): { on: string; values: string[] } | null => {
    const v = frame();
    const m = s.design();
    if (!v || !m) return null;
    const knobs = knobsOf(v);
    const cfg = knobs[path];
    const when = cfg !== undefined ? explicitKnob(cfg).when : undefined;
    if (!when) return null;
    const now = draftKnobValues(m, v, s.draft());
    for (const [other, values] of Object.entries(when)) {
      if (knobs[other] === undefined) continue;
      if (!values.some((x) => same(x, now[other])))
        return { on: other, values: values.map(String) };
    }
    return null;
  };
  const labelOf = (path: string) => {
    const m = s.design();
    const v = frame();
    if (m && v?.swaps?.some((sl) => sl.part === path)) return partLabel(m, path);
    const part = path.includes(".") ? path.slice(0, path.indexOf(".")) : null;
    const name = knobName(path);
    return part && m ? `${partLabel(m, part)} · ${name}` : name;
  };

  const groups = createMemo<ChoiceGroup[]>(() => {
    const m = s.design();
    const v = frame();
    if (!m || !v || m.archivedAt) return [];
    const knobs = knobsOf(v);
    const swaps = (v.swaps ?? []).map((sl) => sl.part);
    return s.sheet
      .choiceKnobs()
      .filter((k) => knobs[k.path] !== undefined && reads(v, k.path) && !idleOn(k.path))
      .map((k) => ({
        path: k.path,
        label: swaps.includes(k.path) ? partLabel(m, k.path) : k.label,
        colour: explicitKnob(knobs[k.path]).type === "color",
        values: k.values,
      }));
  });
  const paths = createMemo(() => groups().map((g) => g.path), [], { equals: sameList });
  // Every other knob the frame reads, in the order declared.
  const fine = createMemo<FineKnob[]>(() => {
    const m = s.design();
    const v = frame();
    if (!m || !v || m.archivedAt) return [];
    const knobs = knobsOf(v);
    const choice = new Set(s.sheet.choiceKnobs().map((k) => k.path));
    return Object.entries(knobs)
      .filter(([path]) => !choice.has(path) && reads(v, path) && !idleOn(path))
      .map(([path, cfg]) => ({ path, label: labelOf(path), cfg }));
  });
  const idle = createMemo<IdleKnob[]>(() => {
    const m = s.design();
    const v = frame();
    if (!m || !v || m.archivedAt) return [];
    return Object.keys(knobsOf(v)).flatMap((path) => {
      const why = reads(v, path) ? idleOn(path) : null;
      return why ? [{ path, label: labelOf(path), on: labelOf(why.on), values: why.values }] : [];
    });
  });
  const group = (path: string) => groups().find((g) => g.path === path);

  // New: every choice knob of the state's frames this browser doesn't know yet.
  const known = createMemo(() => {
    const m = s.design();
    if (!m) return new Set<string>();
    const changedAt = m.alternatives.reduce((at, v) => (v.updatedAt > at ? v.updatedAt : at), "");
    return knownChoices(
      m.project,
      m.id,
      s.sheet.choiceKnobs().map((k) => k.path),
      changedAt,
    );
  });
  const isNew = (path: string) => !known().has(path);
  const newHere = createMemo(() => paths().filter(isNew), [], { equals: sameList });
  const settle = (path: string) => {
    const m = s.design();
    if (m && isNew(path)) markChoiceKnown(m.project, m.id, path);
  };

  const folds = createMemo(() => {
    const m = s.design();
    return choiceFolds(
      [
        ...(hasAlternatives() ? [{ id: ALTERNATIVES_GROUP, isNew: false }] : []),
        ...paths().map((p) => ({ id: knobGroup(p), isNew: isNew(p) })),
      ],
      m ? ownFolds(m.id) : {},
    );
  });
  // Fine-tune is folded until opened: the big choices come first.
  const isOpen = (id: string) => {
    if (id !== FINE_GROUP) return !!folds()[id];
    const m = s.design();
    return !!m && (ownFolds(m.id)[FINE_GROUP] ?? false);
  };
  const toggle = (id: string) => {
    const m = s.design();
    if (m) setOwnFold(m.id, id, !isOpen(id));
  };

  // The value the frame on stage shows, as the stage draws it.
  const value = (path: string): KnobValue | undefined => {
    const m = s.design();
    const v = frame();
    return m && v ? draftKnobValues(m, v, s.draft())[path] : undefined;
  };
  const valueLabel = (g: ChoiceGroup) => {
    const now = value(g.path);
    return (
      g.values.find((x) => same(x.value, now))?.label ?? (now === undefined ? "" : String(now))
    );
  };
  const isPicked = (path: string, v: KnobValue) => same(value(path), v);
  // Changed: the frame on stage shows the knob apart from what the agent sent, the value it
  // has with nothing of this draft.
  const changed = (path: string) => {
    const m = s.design();
    const v = frame();
    return !!m && !!v && !same(value(path), draftKnobValues(m, v, null)[path]);
  };
  // Back to the agent's value wherever a pick put it: each frame's own value of it off, and a
  // question the knob answered unanswered.
  function reset(path: string) {
    const m = s.design();
    const v = frame();
    if (!m || !v || readonly()) return;
    const ask = knobAsk(path, knobsOf(v), m.asks);
    batch(() => {
      if (ask && s.draft()?.answers[ask.id] !== undefined) s.pick(ask, null);
      for (const x of live()) {
        if (path in (s.draft()?.tunedOn[x.alternative] ?? {})) {
          s.setTuned(path, undefined, x.alternative);
        }
      }
    });
  }
  // The live frames a pick of the knob is written to: each that has it and reads it.
  const writesTo = (path: string) =>
    live().filter((x) => knobsOf(x)[path] !== undefined && reads(x, path));
  // Where a pick applies, said on its group: nothing to say with one alternative.
  const scope = (path: string): string => {
    const all = live().length;
    const n = writesTo(path).length;
    if (all < 2 || n === 0) return "";
    if (n === 1) return "this alternative only";
    return n === all ? `on all ${n} alternatives` : `on ${n} of ${all} alternatives`;
  };

  function pick(path: string, v: KnobValue) {
    const m = s.design();
    if (!m || readonly()) return;
    settle(path);
    if (isPicked(path, v)) return;
    const frames = writesTo(path);
    const w = choiceWrites(
      path,
      v,
      frames.map((x) => ({ alternative: x.alternative, ctx: frameKnobContext(m, x, s.draft()) })),
    );
    batch(() => {
      if (w.answer) s.pick(w.answer.ask, w.answer.option);
      for (const t of w.tuned) s.setTuned(path, t.value, t.alternative);
    });
  }

  const previewKey = (path: string, v: string) => `choice:${path}=${v}`;
  function preview(g: ChoiceGroup, v: { value: string; label: string }) {
    const f = frame();
    if (!f) return;
    s.setHoveredPreview({
      key: previewKey(g.path, v.value),
      label: `${g.label} · ${v.label}`,
      alternative: f.alternative,
      state: f.state,
      knobs: { [g.path]: v.value },
    });
  }
  const unpreview = (path: string, v: string) => {
    if (s.hoveredPreview()?.key === previewKey(path, v)) s.setHoveredPreview(null);
  };

  // A value as the Sheet lays it out: the same column, so the same cells and stills.
  const column = (path: string, v: { value: string; label: string }): SheetColumn => ({
    key: `${path}=${v.value}`,
    label: v.label,
    values: { [path]: v.value },
  });
  const markOf = (path: string, v: { value: string; label: string }) => {
    const f = frame();
    return f ? s.markOf(subjectOf({ v: f, col: column(path, v) })) : null;
  };
  const shown = (g: ChoiceGroup) => g.values.filter((v) => markOf(g.path, v) !== "deleted");
  const ruledOut = (g: ChoiceGroup) => g.values.filter((v) => markOf(g.path, v) === "deleted");
  // Ruling a value out is the Sheet's Delete of its column: every frame of the state in that
  // value, which the agent hears as ruledOut. Never the value on stage, nor the last one left.
  const subjects = (col: SheetColumn) => s.sheet.frames().map((v) => subjectOf({ v, col }));
  const canRuleOut = (g: ChoiceGroup, v: { value: string; label: string }) => {
    const f = frame();
    return (
      !!f &&
      !isPicked(g.path, v.value) &&
      shown(g).length > 1 &&
      canFrame(s, "delete", { v: f, col: column(g.path, v) })
    );
  };
  async function ruleOut(g: ChoiceGroup, v: { value: string; label: string }) {
    if (!canRuleOut(g, v)) return;
    settle(g.path);
    unpreview(g.path, v.value);
    await s.deleteCells(subjects(column(g.path, v)));
  }
  const restore = (g: ChoiceGroup, v: { value: string; label: string }) =>
    void s.restoreCells(subjects(column(g.path, v)));
  const canCompare = (path: string) => s.sheet.spreadable(path);
  function compare(path: string) {
    settle(path);
    s.setHoveredPreview(null);
    s.sheet.spread(path);
  }
  // The alternatives side by side: every frame of the state in the Sheet.
  const alternativesCompare = () => s.sheet.available();
  const compareAlternatives = () => {
    s.setHoveredPreview(null);
    s.sheet.open({ ...s.sheet.defaultView(), one: null });
  };

  return {
    designId: () => s.design()?.id,
    frame,
    hasAlternatives,
    groups,
    paths,
    fine,
    idle,
    group,
    isNew,
    newHere,
    isOpen,
    toggle,
    value,
    valueLabel,
    isPicked,
    changed,
    reset,
    scope,
    pick,
    preview,
    unpreview,
    markOf,
    shown,
    ruledOut,
    canRuleOut,
    ruleOut,
    restore,
    canCompare,
    compare,
    alternativesCompare,
    compareAlternatives,
    stills: s.sheet.stills,
  };
}

export type Choices = ReturnType<typeof createChoices>;
