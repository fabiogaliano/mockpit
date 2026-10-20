// Try: the design on stage takes taps, scrolls and its own motion, so a
// prototype can be clicked through; off again, taps select and mark parts.

import { Show } from "solid-js";
import type { MockScreenState } from "./state.ts";

export function TryButton(props: { s: MockScreenState; label?: boolean }) {
  return (
    <button
      type="button"
      class="trybtn"
      classList={{ on: props.s.trying() }}
      aria-pressed={props.s.trying()}
      title="Try: use the design as a prototype. Taps go to it, not to parts."
      onClick={() => props.s.setTrying(!props.s.trying())}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V12m0-1a1.5 1.5 0 0 1 3 0v4a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7l-2.6-4a1.5 1.5 0 0 1 2.4-1.8L9 15" />
      </svg>
      <Show when={props.label !== false}>
        <span class="tool-label">Try</span>
      </Show>
    </button>
  );
}
