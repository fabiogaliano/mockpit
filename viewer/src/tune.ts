// Tune's knob controls are tunekit's: its store (`PaneStore`) and its controls,
// mounted once per mock screen into an element we own (`initPane({ host })`).
// Two renderers share this page (§8), so tunekit keeps its own shadow root and
// we talk to it only through `PaneStore`: one panel at a time, the component
// selected in Tune, with values pushed in from the draft and changes read back.
//
// The one other contact is a stylesheet added to its (open) shadow root:
// tunekit declares its palette on its own root element, where custom properties
// set on the host cannot reach, and it has no light palette. The sheet maps
// those tokens onto the viewer's theme variables, which do inherit through the
// shadow boundary, so a theme switch restyles the knobs with no extra code. It
// also hides tunekit's header and preset row: the panel shell owns both.

import { createEffect, createMemo, on, onCleanup, untrack } from "solid-js";
import type { KnobConfig, KnobValue, Knobs } from "../../server/types.ts";
import { initPane, type PaneConfig, type PaneValue, PaneStore } from "tunekit/core";
import { root } from "./host.ts";
import { resolveKnobs, safeColor, type TuneComponent, tuneComponents, tuneWrite } from "./logic.ts";
import type { MockScreenState } from "./state.ts";

const BRIDGE = `
.up-root, .up-portal {
  --up-bg: var(--panel);
  --up-surface: var(--row);
  --up-surface-hover: var(--row-hover);
  --up-surface-active: var(--fill);
  --up-border: var(--line);
  --up-border-hover: var(--fill);
  --up-text-1: var(--t1);
  --up-text-2: var(--t2);
  --up-text-3: var(--t3);
  --up-text-4: var(--t4);
  --up-radius: var(--r);
  --up-row-h: var(--row-h);
  --up-accent: var(--accent);
  --dial-surface-subtle: var(--row);
  --dial-glass-bg: var(--panel);
  --dial-dropdown-bg: var(--panel);
  --dial-focus-ring: var(--t4);
  --dial-shadow: var(--dd-shadow);
  --dial-shadow-dropdown: var(--dd-shadow);
  font-family: var(--sans);
}
.up-shell-hosted { background: transparent; }
.up-shell-hosted .up-header, .up-shell-hosted .up-preset-bar { display: none; }
.up-shell-hosted .up-content { padding: 0; }
.up-panel-section { display: flex; flex-direction: column; gap: 8px; }
.up-slider-fill { background: var(--fill) !important; }
.up-slider-active .up-slider-fill, .up-slider-dragging .up-slider-fill { background: var(--fill-hover) !important; }
.up-slider-handle { background: var(--handle); }
.up-select-dropdown, .up-preset-dropdown { background: var(--panel); box-shadow: var(--dd-shadow); }
.up-slider-label, .up-slider-value, .up-select-trigger, .up-labeled-row-label,
.up-text-label, .up-text-input, .up-seg-btn, .up-select-option, .dialkit-segmented-button,
.dialkit-color-label, .dialkit-color-value { font-size: 15px; }
.up-slider-label, .up-select-trigger, .up-labeled-row-label, .up-text-label { color: var(--t3); }
.up-slider-label, .up-slider-value { padding: 0 4px; }
`;

const panelId = (mockId: string, c: TuneComponent) => `mockpit:${mockId}:${c.part ?? "look"}`;
// Inside a part's panel a knob is named without its part ("body.size" → "size").
const keyOf = (c: TuneComponent, path: string) =>
  c.part === null ? path : path.slice(c.part.length + 1);

// The control tunekit draws for a knob. An image knob becomes a select over its
// option names: tunekit would load each option as an <img> here, in the trusted
// document. A color whose value is not plainly a color is shown as text.
export function paneControl(cfg: KnobConfig): PaneConfig[string] {
  if (typeof cfg === "string") return safeColor(cfg) ? cfg : { type: "text", value: cfg };
  if (typeof cfg !== "object" || Array.isArray(cfg)) return cfg as PaneConfig[string];
  if (cfg.type === "image") {
    const options = cfg.options ?? (cfg.value ? [cfg.value] : []);
    return options.length
      ? ({
          type: "select",
          options,
          ...(cfg.value ? { value: cfg.value } : {}),
        } as PaneConfig[string])
      : { type: "text", value: cfg.value ?? "" };
  }
  if (cfg.type === "color" && cfg.value !== undefined && !safeColor(cfg.value)) {
    return { type: "text", value: cfg.value };
  }
  return cfg as PaneConfig[string];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function createTune(s: MockScreenState) {
  const components = createMemo(() => {
    const m = s.mock();
    return m ? tuneComponents(m, s.knobContext().knobs) : [];
  });
  // A part clicked on the stage that has nothing to tune still shows, so it can
  // take a comment; the selector's list and ‹ › only walk the tunable ones.
  const current = createMemo<TuneComponent | null>(() => {
    const list = components();
    const sel = s.selectedPart();
    return (
      list.find((c) => c.part === sel) ??
      (sel !== null ? { part: sel, label: sel, paths: [] } : (list[0] ?? null))
    );
  });
  const tunedIn = (c: TuneComponent) => c.paths.some((p) => p in s.knobContext().tuned);

  const pane = root().createElement("div");
  pane.className = "tune-pane";
  const unmount = initPane({ host: pane });
  const sheet = root().createElement("style");
  sheet.textContent = BRIDGE;
  pane.firstElementChild?.shadowRoot?.append(sheet);

  // Tune's content is rebuilt each time the mode opens; the pane (and the
  // tunekit tree inside it) moves into the new spot instead of remounting.
  createEffect(() => {
    const spot = s.tuneHost();
    if (spot && pane.parentNode !== spot) spot.append(pane);
  });

  // One panel: the current component's knobs, as declared, then set to the
  // values in force.
  let registered: string | null = null;
  let stopListening: (() => void) | null = null;
  const release = () => {
    stopListening?.();
    stopListening = null;
    if (registered) PaneStore.unregisterPanel(registered);
    registered = null;
  };

  const config = createMemo(() => {
    const c = current();
    const m = s.mock();
    if (!c || !m || !c.paths.length) return null;
    const knobs: Knobs = s.knobContext().knobs;
    const out: PaneConfig = {};
    for (const path of c.paths) out[keyOf(c, path)] = paneControl(knobs[path]);
    return { id: panelId(m.id, c), name: c.label, c, out, sig: JSON.stringify(out) };
  });

  const push = (id: string, c: TuneComponent) => {
    const values = resolveKnobs(s.knobContext());
    const have = PaneStore.getValues(id);
    const next: Record<string, PaneValue> = {};
    for (const path of c.paths) {
      const k = keyOf(c, path);
      const v = values[path];
      if (v !== undefined && k in have && !same(have[k], v)) next[k] = v as PaneValue;
    }
    if (Object.keys(next).length) PaneStore.updateValues(id, next);
  };

  // Re-registered only when the component or its declared knobs change, not
  // on every value change.
  const panelKey = createMemo(() => {
    const cfg = config();
    return cfg ? `${cfg.id}\u0000${cfg.sig}` : "";
  });
  createEffect(
    on(panelKey, () => {
      release();
      const cfg = untrack(config);
      if (!cfg) return;
      PaneStore.registerPanel(cfg.id, cfg.name, cfg.out);
      registered = cfg.id;
      untrack(() => push(cfg.id, cfg.c));
      stopListening = PaneStore.subscribe(cfg.id, () => {
        const ctx = untrack(s.knobContext);
        const values = resolveKnobs(ctx);
        const now = PaneStore.getValues(cfg.id);
        for (const path of cfg.c.paths) {
          const v = now[keyOf(cfg.c, path)] as KnobValue | undefined;
          if (v === undefined || same(v, values[path])) continue;
          const w = tuneWrite(path, v, ctx);
          if (w.kind === "answer") s.pick(w.ask, w.option);
          else s.setTuned(w.path, w.value);
        }
      });
    }),
  );

  // The draft can change under the knobs (a preset, an answer, another tab).
  createEffect(() => {
    s.knobContext();
    const cfg = config();
    if (cfg && registered === cfg.id) untrack(() => push(cfg.id, cfg.c));
  });

  onCleanup(() => {
    release();
    unmount();
    pane.remove();
  });

  return { components, current, tunedIn };
}

export type TuneState = ReturnType<typeof createTune>;
