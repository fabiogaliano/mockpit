// Shortcuts behind a "?" (the button, and the ? key where the screen listens for it): the
// button says "? shortcuts" until it has been opened once, then "?" alone. The Board and
// Focus each keep their own, since each lists its own keys; Focus's change with where the
// user is (FocusShortcuts).

import { createEffect, createSignal, type JSX, Show } from "solid-js";
import { canFrame } from "./frameActions.ts";
import { host, readonly } from "./host.ts";
import type { DesignScreenState } from "./state.ts";

export function createShortcuts(storageKey: string) {
  const [known, setKnown] = createSignal(host().storage?.getItem(storageKey) === "known");
  const [open, setOpen] = createSignal(false);
  createEffect(() => {
    if (!open() || known()) return;
    setKnown(true);
    host().storage?.setItem(storageKey, "known");
  });
  return { known, open, setOpen, toggle: () => setOpen(!open()) };
}
export type Shortcuts = ReturnType<typeof createShortcuts>;

export function ShortcutsButton(props: {
  k: Shortcuts;
  id: string;
  // Where it stands: the Board's corner, or Focus's canvas.
  class?: string;
  children: JSX.Element;
}) {
  return (
    <>
      <button
        type="button"
        class={`bkeys-btn ${props.class ?? ""}`}
        classList={{ first: !props.k.known() }}
        aria-label="Shortcuts"
        aria-expanded={props.k.open()}
        aria-controls={props.id}
        title="Shortcuts (?)"
        onClick={() => props.k.toggle()}
      >
        ?
        <Show when={!props.k.known()}>
          <span>shortcuts</span>
        </Show>
      </button>
      <Show when={props.k.open()}>
        <div
          class={`bkeys ${props.class ?? ""}`}
          id={props.id}
          role="dialog"
          aria-label="Shortcuts"
        >
          {props.children}
        </div>
      </Show>
    </>
  );
}

// Focus's keys, for where the user is: the sheet, a cell open from it, or one frame. P, M
// and X act on the cell under the pointer on the sheet, else on what is on stage.
export function FocusShortcuts(props: {
  s: DesignScreenState;
  k: Shortcuts;
  // A document: read, not tried, commented on by paragraph.
  reading: boolean;
  // A page on stage, which Comment acts on.
  page: boolean;
}) {
  const s = props.s;
  const sheet = () => !!s.sheet.view();
  const held = () => !!s.sheet.held();
  const marks = () =>
    sheet()
      ? s.sheet.frames().length > 1 && !readonly()
      : !props.reading &&
        (s.sheet.held()
          ? canFrame(s, "pick", { v: s.sheet.held()!.v, col: s.sheet.held()!.col })
          : !!s.activeAlternative() && canFrame(s, "pick", { v: s.activeAlternative()! }));
  const across = () => (s.sheet.held()?.at.knob === null ? "look" : "value");
  return (
    <ShortcutsButton k={props.k} id="focus-keys" class="fkeys">
      <dl>
        <Show when={sheet()}>
          <dt>
            <kbd>↵</kbd>
          </dt>
          <dd>Open, or double-click</dd>
        </Show>
        <Show when={held()}>
          <dt>
            <kbd>⇧↑</kbd> <kbd>⇧↓</kbd>
          </dt>
          <dd>Previous or next frame</dd>
          <dt>
            <kbd>⇧←</kbd> <kbd>⇧→</kbd>
          </dt>
          <dd>{`Previous or next ${across()}`}</dd>
        </Show>
        <Show when={!sheet()}>
          <dt>
            <kbd>←</kbd> <kbd>→</kbd>
          </dt>
          <dd>Previous or next version</dd>
        </Show>
        <Show when={marks()}>
          <dt>
            <kbd>P</kbd>
          </dt>
          <dd>Pick</dd>
          <dt>
            <kbd>M</kbd>
          </dt>
          <dd>Main</dd>
          <dt>
            <kbd>X</kbd>
          </dt>
          <dd>Archive</dd>
        </Show>
        <Show when={!sheet() && props.page && !props.reading && !readonly()}>
          <dt>
            <kbd>C</kbd>
          </dt>
          <dd>Comment</dd>
        </Show>
        <Show when={!sheet() && s.curAsk() && !readonly()}>
          <dt>
            <kbd>1</kbd>–<kbd>9</kbd>
          </dt>
          <dd>Choose an answer</dd>
          <Show when={s.commitKind()}>
            {(kind) => (
              <>
                <dt>
                  <kbd>↵</kbd>
                </dt>
                <dd>{kind() === "next" ? "Next question" : "Send"}</dd>
              </>
            )}
          </Show>
        </Show>
        <dt>
          <kbd>Esc</kbd>
        </dt>
        <dd>
          {held() ? "Back to the Sheet" : sheet() ? "Back to one frame" : "Back to the Board"}
        </dd>
      </dl>
    </ShortcutsButton>
  );
}
