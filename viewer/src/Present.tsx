// A flow played full screen from the Board: each step's page live and alone, walked
// with → and ← as Try walks a flow (flowNav), R from the first step again. Esc ends it on
// the Board, fit to the step it ended on.

import { onCleanup, onMount, Show } from "solid-js";
import type { FlowNav } from "./flowNav.ts";
import { FullView } from "./FullView.tsx";
import { root } from "./host.ts";
import type { DesignScreenState } from "./state.ts";

export function Present(props: { s: DesignScreenState; nav: FlowNav; onEnd: () => void }) {
  const src = () => props.nav.picture(props.nav.here());
  const title = () => {
    const at = props.nav.at();
    return `${props.nav.name()} · ${at + 1} of ${props.nav.steps().length} · ${props.nav.label(props.nav.here())}`;
  };
  onMount(() => {
    // Before the design screen's own keys, where ← and → step through versions.
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight" || e.key === " ") props.nav.step(1);
      else if (e.key === "ArrowLeft") props.nav.step(-1);
      else if (e.key === "r" || e.key === "R") {
        const first = props.nav.steps()[0];
        if (first) props.nav.go(first);
      } else if (e.key === "Escape") props.onEnd();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    root().addEventListener("keydown", onKey, true);
    onCleanup(() => root().removeEventListener("keydown", onKey, true));
  });
  return (
    <Show
      when={src()}
      fallback={
        <div class="present-empty" role="dialog" aria-label={title()}>
          <p>{`${title()}: nothing is drawn at this step yet`}</p>
        </div>
      }
    >
      {(u) => (
        <FullView
          src={u()}
          width={props.s.design()?.widths[0] ?? 820}
          title={title()}
          onClose={props.onEnd}
        />
      )}
    </Show>
  );
}
