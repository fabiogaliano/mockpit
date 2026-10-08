// D8: the thread lives in the panel. Agent rows come from publishes and the
// agent's comments; your Sends show ✓ once stored and ✓✓ once the agent's
// feedback cursor has passed them.

import { createEffect, createMemo, For, Show } from "solid-js";
import { threadRows, timeAgo } from "./logic.ts";
import type { MockScreenState } from "./state.ts";

export function useThreadRows(s: MockScreenState) {
  return createMemo(() => {
    const m = s.mock();
    return m ? threadRows(s.comments(), s.variants(), m) : [];
  });
}

export function Thread(props: { s: MockScreenState; scroller: () => HTMLElement | undefined }) {
  const rows = useThreadRows(props.s);
  createEffect(() => {
    rows();
    const el = props.scroller();
    if (el) requestAnimationFrame(() => (el.scrollTop = el.scrollHeight));
  });
  return (
    <div class="thread">
      <Show when={rows().length} fallback={<div class="tempty">Nothing here yet.</div>}>
        <For each={rows()}>
          {(r) => (
            <div class={`trow ${r.who}`} data-row={r.id}>
              <div class="tmeta">{`${r.who} · ${timeAgo(r.at)}`}</div>
              <div class="ttext">{r.text}</div>
              <Show when={r.quote}>
                <div class="tquote">{r.quote}</div>
              </Show>
              <Show when={r.who === "you"}>
                <div class="tseen" classList={{ ok: r.seen }}>
                  <span class="tick">{r.seen ? "✓✓" : "✓"}</span>
                  {r.seen ? "seen" : "sent"}
                </div>
              </Show>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}
