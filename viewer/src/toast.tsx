// The line an action leaves, with its Undo. A screen shows its own; when an action
// empties a mock the user lands on Home, and the line goes along, or the Undo
// would leave with the screen that made it.

import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import { host } from "./host.ts";
import { Icon } from "./icons.tsx";
import { navigate, route } from "./route.ts";

export type ToastLine = { text: string; undo?: () => void };

const LINE_MS = 2400;
// Long enough to read it and reach for Undo.
const UNDO_MS = 6000;

export function Toast(props: { toast: ToastLine | null; onDismiss: () => void }) {
  // Not while the pointer or focus is on it: it mustn't leave from under the click.
  const [held, setHeld] = createSignal(false);
  createEffect(() => {
    const line = props.toast;
    if (!line || held()) return;
    const timer = host().window.setTimeout(props.onDismiss, line.undo ? UNDO_MS : LINE_MS);
    onCleanup(() => host().window.clearTimeout(timer));
  });
  return (
    <div
      class="toast"
      classList={{ on: !!props.toast }}
      role="status"
      aria-live="polite"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocusIn={() => setHeld(true)}
      onFocusOut={() => setHeld(false)}
    >
      <Show when={props.toast}>
        {(tst) => (
          <>
            <span>{tst().text}</span>
            <Show when={tst().undo}>
              {(undo) => (
                <>
                  <button type="button" class="toast-undo" onClick={() => undo()()}>
                    Undo
                  </button>
                  <button
                    type="button"
                    class="ib toast-x"
                    aria-label="Dismiss"
                    onClick={props.onDismiss}
                  >
                    <Icon name="close" />
                  </button>
                </>
              )}
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

const [carried, setCarried] = createSignal<{ line: ToastLine; back: string; at: string } | null>(
  null,
);

// `back` is the screen it came from, which its Undo returns to.
export function carryToast(line: ToastLine | null, back: string) {
  setCarried(line && { line, back, at: host().location.pathname });
}

export function CarriedToast() {
  createEffect(
    on(route, () => {
      const c = carried();
      if (c && host().location.pathname !== c.at) setCarried(null);
    }),
  );
  const line = () => {
    const c = carried();
    const undo = c?.line.undo;
    if (!c || !undo) return c?.line ?? null;
    return {
      text: c.line.text,
      undo: () => {
        undo();
        navigate(c.back);
      },
    };
  };
  return <Toast toast={line()} onDismiss={() => setCarried(null)} />;
}
