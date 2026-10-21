// Try: the design on stage takes taps, scrolls and its own motion, so a
// prototype can be clicked through; off again, taps select and mark parts.

import { Show } from "solid-js";
import { Icon } from "./icons.tsx";
import type { MockScreenState } from "./state.ts";

export function TryButton(props: { s: MockScreenState; label?: boolean }) {
  return (
    <button
      type="button"
      class="trybtn"
      classList={{ on: props.s.trying() }}
      aria-pressed={props.s.trying()}
      title="Try: use the design as a prototype. Taps go to it, not to parts."
      aria-label={props.label === false ? "Try" : undefined}
      onClick={() => props.s.setTrying(!props.s.trying())}
    >
      <Icon name="try" />
      <Show when={props.label !== false}>
        <span class="tool-label">Try</span>
      </Show>
    </button>
  );
}
