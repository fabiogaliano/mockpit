// Looks: named knob values, the way a frame's tune travels to its siblings and to other
// designs with the same knobs. The strip under the frame offers the design's own and
// those of designs that declare every knob a look sets; Tune saves the frame's as one.

import { createSignal, For, Show } from "solid-js";
import type { LookView } from "./api.ts";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { lookLine } from "./logic.ts";
import type { DesignScreenState } from "./state.ts";

// Hovering a look shows the frame on stage in it; a click gives the frame that look.
export function LooksStrip(props: { s: DesignScreenState }) {
  const s = props.s;
  const where = (l: LookView) =>
    [lookLine(l.values), l.design !== s.slug ? `from ${l.design}` : ""].filter(Boolean).join(" · ");
  return (
    <Show when={s.looksHere().length}>
      <div class="looks" role="group" aria-label="Looks">
        <For each={s.looksHere()}>
          {(l) => (
            <span
              class="look"
              classList={{
                on: s.lookOn(l),
                mine: l.author === "user",
                previewing: s.preview()?.key === s.lookKey(l),
              }}
            >
              <button
                type="button"
                class="look-b"
                title={where(l)}
                aria-pressed={s.lookOn(l)}
                disabled={readonly()}
                onPointerEnter={(e) =>
                  e.pointerType === "mouse" && s.setHoveredPreview(s.previewLook(l))
                }
                onPointerLeave={(e) => e.pointerType === "mouse" && s.setHoveredPreview(null)}
                onFocus={() => s.setHoveredPreview(s.previewLook(l))}
                onBlur={() => s.setHoveredPreview(null)}
                onClick={() => s.applyLook(l)}
              >
                {l.name}
              </button>
              <Show when={l.design === s.slug && !readonly()}>
                <button
                  type="button"
                  class="look-x"
                  aria-label={`Remove the look ${l.name}`}
                  title="Remove"
                  onClick={() => s.removeLook(l)}
                >
                  <Icon name="close" />
                </button>
              </Show>
            </span>
          )}
        </For>
      </div>
    </Show>
  );
}

// In Tune: the frame's values, saved under a name.
export function SaveLook(props: { s: DesignScreenState }) {
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
          class="btn savelook"
          disabled={empty()}
          title={empty() ? "Tune something first" : lookLine(s.lookFromFrame())}
          onClick={() => setNaming(true)}
        >
          Save as look…
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
          placeholder="Look name"
          aria-label="Look name"
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
