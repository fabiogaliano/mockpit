// D1: the states of one mock under its stage; picking one switches the stage.
import { For, Show } from "solid-js";
import type { MockScreenState } from "./state.ts";

export function Strip(props: { s: MockScreenState }) {
  const s = props.s;
  return (
    <Show when={s.states().length > 1}>
      <div class="stripwrap">
        <div class="cap">{`showing ${s.states().length} UI states`}</div>
        <div class="strip" role="tablist" aria-label="UI states">
          <For each={s.states()}>
            {(state) => (
              <button
                type="button"
                role="tab"
                aria-selected={state === s.activeState()}
                classList={{ on: state === s.activeState() }}
                onClick={() => s.showState(state)}
              >
                {state}
              </button>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
