// D1: the states of one mock under its stage; picking one switches the stage.
// Wider than the screen, the row scrolls; its edges fade where more states
// hide, and the count says how many there are.
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import type { MockScreenState } from "./state.ts";
import { sheet } from "./viewport.ts";

export function Strip(props: { s: MockScreenState }) {
  const s = props.s;
  const [edges, setEdges] = createSignal({ start: false, end: false });
  let row: HTMLDivElement | undefined;
  const measure = () => {
    if (!row) return;
    const max = row.scrollWidth - row.clientWidth;
    setEdges({ start: row.scrollLeft > 1, end: row.scrollLeft < max - 1 });
  };
  const attach = (el: HTMLDivElement) => {
    row = el;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    onCleanup(() => ro.disconnect());
  };
  // The state on stage stays in view, even when picked from a question.
  createEffect(
    on(
      () => s.activeState(),
      () => {
        const tab = row?.querySelector<HTMLElement>('[aria-selected="true"]');
        if (!row || !tab) return;
        // scrollLeft, not scrollIntoView: that would also scroll the clipped
        // ancestors the stage lives in.
        // .strip is positioned, so offsetLeft is within the row.
        const left = tab.offsetLeft;
        if (left < row.scrollLeft) row.scrollLeft = left - 24;
        else if (left + tab.offsetWidth > row.scrollLeft + row.clientWidth)
          row.scrollLeft = left + tab.offsetWidth - row.clientWidth + 24;
      },
    ),
  );
  const n = () => s.states().length;
  return (
    <Show when={n() > 1}>
      <div class="stripwrap">
        <div class="cap">{sheet() ? `${n()} states` : `showing ${n()} UI states`}</div>
        <div
          class="strip"
          classList={{ "fade-start": edges().start, "fade-end": edges().end }}
          role="tablist"
          aria-label="UI states"
          ref={attach}
          onScroll={measure}
        >
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
