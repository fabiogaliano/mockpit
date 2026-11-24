// Presets: named knob values (stored and sent as looks), the way a frame's values travel
// to its siblings and to other designs with the same knobs. A row of chips at the top of the
// knobs, in the Choices panel and in Tune: a mouse on one shows the frame on stage in it, a
// click gives the frame its values and flashes the rows it changed. Save as preset keeps the
// frame's own.

import { createSignal, For, Show } from "solid-js";
import type { LookView } from "./api.ts";
import { readonly, root } from "./host.ts";
import { Icon } from "./icons.tsx";
import { lookLine } from "./logic.ts";
import type { DesignScreenState } from "./state.ts";

// The rows a preset set, flashed so the eye finds what moved. A row is the element that
// carries `data-knob-row="<path>"`.
export function flashRows(paths: string[]) {
  for (const path of paths) {
    for (const el of root().querySelectorAll<HTMLElement>(
      `[data-knob-row="${CSS.escape(path)}"]`,
    )) {
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
    }
  }
}

export function PresetsRow(props: { s: DesignScreenState }) {
  const s = props.s;
  const where = (l: LookView) =>
    [lookLine(l.values), l.design !== s.slug ? `from ${l.design}` : ""].filter(Boolean).join(" · ");
  const canSave = () => !readonly() && Object.keys(s.lookFromFrame()).length > 0;
  // There is no undo: removing one of the user's own asks twice, the second on the same spot.
  const [removing, setRemoving] = createSignal<string | null>(null);
  return (
    <Show when={s.looksHere().length || canSave()}>
      <section class="chg presets">
        <div class="chg-h">
          <span class="chg-title">
            <b>Presets</b>
          </span>
          <span class="chg-scope">set several knobs at once</span>
        </div>
        <div class="chips-row" role="group" aria-label="Presets">
          <For each={s.looksHere()}>
            {(l) => (
              <span
                class="chc-w"
                classList={{ mine: l.author === "user", removing: removing() === l.name }}
                onPointerLeave={() => removing() === l.name && setRemoving(null)}
              >
                <button
                  type="button"
                  class="chc"
                  classList={{ on: s.lookOn(l), previewing: s.preview()?.key === s.lookKey(l) }}
                  title={where(l)}
                  aria-pressed={s.lookOn(l)}
                  disabled={readonly()}
                  onPointerEnter={(e) =>
                    e.pointerType === "mouse" && s.setHoveredPreview(s.previewLook(l))
                  }
                  onPointerLeave={(e) => e.pointerType === "mouse" && s.setHoveredPreview(null)}
                  onFocus={() => s.setHoveredPreview(s.previewLook(l))}
                  onBlur={() => s.setHoveredPreview(null)}
                  onClick={() => {
                    s.applyLook(l);
                    flashRows(Object.keys(l.values));
                  }}
                >
                  {l.name}
                </button>
                <Show when={l.design === s.slug && !readonly()}>
                  <Show
                    when={removing() === l.name}
                    fallback={
                      <button
                        type="button"
                        class="chc-x"
                        aria-label={`Remove the preset ${l.name}`}
                        title="Remove"
                        onClick={() => setRemoving(l.name)}
                      >
                        <Icon name="close" />
                      </button>
                    }
                  >
                    <button
                      type="button"
                      class="chc-sure"
                      onClick={() => {
                        setRemoving(null);
                        s.removeLook(l);
                      }}
                    >
                      Remove
                    </button>
                  </Show>
                </Show>
              </span>
            )}
          </For>
          <Show when={canSave()}>
            <SaveLook s={s} compact />
          </Show>
        </div>
      </section>
    </Show>
  );
}

// The frame's values, saved under a name.
export function SaveLook(props: { s: DesignScreenState; compact?: boolean }) {
  const s = props.s;
  const [naming, setNaming] = createSignal(false);
  const [name, setName] = createSignal("");
  const empty = () => !Object.keys(s.lookFromFrame()).length;
  async function save() {
    const n = name().trim();
    if (!n) return;
    if (await s.saveLook(n)) {
      setNaming(false);
      setName("");
    }
  }
  return (
    <Show
      when={naming()}
      fallback={
        <button
          type="button"
          class={props.compact ? "chc chc-add" : "btn savelook"}
          disabled={empty()}
          title={empty() ? "Change something first" : lookLine(s.lookFromFrame())}
          onClick={() => setNaming(true)}
        >
          {props.compact ? "+ Save as preset" : "Save as preset…"}
        </button>
      }
    >
      <form
        class="savelook-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input
          type="text"
          maxLength={60}
          placeholder="Preset name"
          aria-label="Preset name"
          value={name()}
          ref={(el) => queueMicrotask(() => el.focus())}
          onInput={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") setNaming(false);
          }}
        />
        <button type="button" class="btn" onClick={() => setNaming(false)}>
          Cancel
        </button>
        <button type="submit" class="btn go" disabled={!name().trim()}>
          Save
        </button>
      </form>
    </Show>
  );
}
