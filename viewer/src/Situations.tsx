// A state's situations: the quiet switch under the design that flips one
// moment between its renders, and every one of them side by side, opened from
// the version bar. Neither exists for a state with only its own render.

import { For, Show } from "solid-js";
import { surfaceUrl } from "./api.ts";
import type { MockScreenState } from "./state.ts";
import { theme } from "./theme.ts";
import { Thumb } from "./Thumb.tsx";

export function SituationSwitch(props: { s: MockScreenState }) {
  const s = props.s;
  return (
    <Show when={s.situations().length > 1}>
      <div class="sitswitch" role="radiogroup" aria-label="Situation">
        <For each={s.situations()}>
          {(x) => (
            <button
              type="button"
              role="radio"
              aria-checked={x.state === s.activeState()}
              classList={{ on: x.state === s.activeState() }}
              onClick={() => {
                s.setAllSituations(false);
                if (x.state !== s.activeState()) s.showState(x.state);
              }}
            >
              {x.name}
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}

export function SituationGrid(props: { s: MockScreenState; top: number; bottom: number }) {
  const s = props.s;
  const picture = (state: string) => {
    const v = s.variantFor(state, false);
    const i = v?.surfaces.findIndex((y) => y.kind === "html") ?? -1;
    return v && i >= 0
      ? surfaceUrl(v.postId, i, { version: s.frameVersionOf(v), mode: theme(), e: v.embedsKey })
      : null;
  };
  return (
    <Show when={s.allSituations() && s.situations().length > 1}>
      <div
        class="sitgrid"
        role="list"
        aria-label={`Every situation of ${s.moment() ?? ""}`}
        style={{ top: `${props.top}px`, bottom: `${props.bottom}px` }}
      >
        <For each={s.situations()}>
          {(x) => (
            <button
              type="button"
              role="listitem"
              class="sitcell"
              classList={{ on: x.state === s.activeState() }}
              aria-label={`Open ${x.name}`}
              onClick={() => {
                s.setAllSituations(false);
                if (x.state !== s.activeState()) s.showState(x.state);
              }}
            >
              <Show when={picture(x.state)} fallback={<span class="sitblank" />}>
                {(u) => (
                  <Thumb
                    src={u()}
                    width={s.frameW()}
                    class={s.frameW() > 600 ? "sitthumb flat" : "sitthumb"}
                    fit
                    whole
                  />
                )}
              </Show>
              <span class="lbl">{x.name}</span>
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}
