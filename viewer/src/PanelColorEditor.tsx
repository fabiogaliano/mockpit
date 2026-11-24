import { createEffect, createSignal, createUniqueId, onCleanup } from "solid-js";
import { PaneStore } from "tunekit/core";
import type { Preview } from "./onScreen.ts";
import type { DesignScreenState } from "./state.ts";
import { mountTunePane, tunePalette } from "./tune.ts";
import { safeColor } from "./logic.ts";

/** Preview a color without writing either a tune or an answer to the draft. */
export function PanelColorEditor(props: {
  s: DesignScreenState;
  path: string;
  initial: string;
  preview?: Preview;
  submit: string;
  onSave?: (value: string) => void;
  onClose: () => void;
}) {
  const s = props.s;
  const id = `mockpit-color:${createUniqueId()}`;
  const pane = mountTunePane(id);
  const [value, setValue] = createSignal(props.initial);
  const [busy, setBusy] = createSignal(false);
  const valid = () => safeColor(value()) && CSS.supports("color", value());
  createEffect(() => {
    const config = {
      Colour: { type: "color" as const, value: props.initial, palette: tunePalette(s) },
    };
    PaneStore.registerPanel(id, "Colour", config);
    const stop = PaneStore.subscribe(id, () => {
      const next = PaneStore.getValues(id).Colour;
      if (typeof next !== "string" || !safeColor(next) || !CSS.supports("color", next)) return;
      setValue(next);
      s.setHoveredPreview({
        ...props.preview,
        key: id,
        label: next,
        knobs: { ...props.preview?.knobs, [props.path]: next },
      });
    });
    onCleanup(() => {
      stop();
      PaneStore.unregisterPanel(id);
    });
  });
  onCleanup(() => {
    if (s.hoveredPreview()?.key === id) s.setHoveredPreview(null);
  });
  async function save() {
    if (busy() || !valid() || value() === props.initial) return;
    const chosen = value();
    setBusy(true);
    try {
      if (!(await s.saveColorChoice(props.path, chosen))) return;
      props.onSave?.(chosen);
      props.onClose();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div class="panel-colour-edit">
      <div ref={(el) => el.append(pane)} />
      <div class="colour-edit-actions">
        <button
          type="button"
          class="btn go"
          disabled={busy() || !valid() || value() === props.initial}
          onClick={() => void save()}
        >
          {props.submit}
        </button>
        <button type="button" class="btn" disabled={busy()} onClick={props.onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
