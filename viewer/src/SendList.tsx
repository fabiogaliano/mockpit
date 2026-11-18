// Send, with what is in it: the count on the button, and the list it opens, each line as the
// agent will read it, each one to take back, and a message for the whole. Nothing goes until
// the list's own Send.

import { createSignal, For, Show } from "solid-js";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { usePopover } from "./popover.ts";
import type { DesignScreenState } from "./state.ts";

export function SendButton(props: { s: DesignScreenState; class?: string }) {
  const s = props.s;
  const [open, setOpen] = createSignal(false);
  let btn: HTMLButtonElement | undefined;
  let pop: HTMLDivElement | undefined;
  usePopover(
    open,
    () => setOpen(false),
    () => btn,
    () => pop,
  );
  const lines = () => s.sendList();
  // The message is the field below the lines, not a line of its own.
  const listed = () => lines().filter((l) => l.of.kind !== "message");
  const n = () => lines().length;
  const go = () => {
    setOpen(false);
    s.sendDraft();
  };
  return (
    <Show when={!readonly()}>
      <div class="sendat">
        <button
          type="button"
          class={`btn go fsend ${props.class ?? ""}`}
          classList={{ quiet: !n() }}
          aria-haspopup="dialog"
          aria-expanded={open()}
          disabled={s.sending()}
          ref={(el) => (btn = el)}
          onClick={() => setOpen(!open())}
        >
          {n() ? `Send · ${n()}` : "Send"}
        </button>
        <Show when={open()}>
          <div class="sendpop" role="dialog" aria-label="Send" ref={(el) => (pop = el)}>
            <Show when={listed().length} fallback={<p class="sendnone">Nothing yet</p>}>
              <ul class="sendlines">
                <For each={listed()}>
                  {(l) => (
                    <li>
                      <span>{l.text}</span>
                      <button
                        type="button"
                        class="ib"
                        aria-label={`Take back: ${l.text}`}
                        title="Undo"
                        onClick={() => s.undoLine(l.of)}
                      >
                        <Icon name="undo" />
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <textarea
              aria-label="Message"
              placeholder="Message"
              rows={2}
              value={s.draft()?.text ?? ""}
              onInput={(e) => s.setMessage(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && s.sendable()) {
                  e.preventDefault();
                  go();
                }
              }}
            />
            <button
              type="button"
              class="btn go"
              disabled={!s.sendable() || s.sending()}
              onClick={go}
            >
              Send
            </button>
          </div>
        </Show>
      </div>
    </Show>
  );
}
