// Why something went: optional, one line, and asked for only after it has gone, so
// taking something away never waits on an explanation. Kept as information, and always
// the user's own words or the note they had already written.

import { createEffect, createSignal, Show } from "solid-js";
import { readonly } from "./host.ts";

export function Reason(props: {
  value: string | null | undefined;
  onSave: (reason: string | null) => void;
}) {
  const [said, setSaid] = createSignal(props.value ?? null);
  const [writing, setWriting] = createSignal(false);
  createEffect(() => setSaid(props.value ?? null));
  // Enter and a click away both land here, and Esc leaves without saving.
  const commit = (text: string) => {
    if (!writing()) return;
    setWriting(false);
    const next = text.trim() || null;
    if (next === said()) return;
    setSaid(next);
    props.onSave(next);
  };
  return (
    <Show
      when={writing()}
      fallback={
        <Show
          when={!readonly()}
          fallback={<Show when={said()}>{(text) => <span class="reason">{text()}</span>}</Show>}
        >
          <button
            type="button"
            class="reason reason-btn"
            classList={{ empty: !said() }}
            title={said() ? "Change the reason" : undefined}
            onClick={() => setWriting(true)}
          >
            {said() ?? "Add a reason"}
          </button>
        </Show>
      }
    >
      <input
        class="reason-in"
        type="text"
        maxLength={280}
        placeholder="Why? One line, if you like"
        aria-label="Why"
        value={said() ?? ""}
        ref={(el) => queueMicrotask(() => el.focus())}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commit(e.currentTarget.value);
          else if (e.key === "Escape") setWriting(false);
        }}
        onBlur={(e) => commit(e.currentTarget.value)}
      />
    </Show>
  );
}
