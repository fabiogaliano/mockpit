// Who gets this Send, when the agent that asked isn't listening and another is. It is
// only there then: while the owner can hear, Send needs no second thought. What it
// sets rides on every reply until the owner changes, and the pick becomes the owner.

import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import type { SendRecipient } from "./api.ts";
import { host, readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { activeLabel } from "./logic.ts";
import type { DesignScreenState } from "./state.ts";

const FOLDED = 2;

function subline(r: SendRecipient): string {
  if (r.asked) return "Asked this · hears it on its next call";
  if (r.designs.length === 0) return "No designs yet";
  const more = r.designs.length - FOLDED;
  return `On ${r.designs.slice(0, FOLDED).join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

export function SendTo(props: { s: DesignScreenState }) {
  const s = props.s;
  const [open, setOpen] = createSignal(false);
  let wrap: HTMLDivElement | undefined;
  let btn: HTMLButtonElement | undefined;

  createEffect(() => {
    if (!open()) return;
    const doc = host().window.document;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      btn?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (!wrap?.contains(e.target as Node)) setOpen(false);
    };
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("pointerdown", onDown, true);
    onCleanup(() => {
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("pointerdown", onDown, true);
    });
  });

  const rows = (r: SendRecipient) => (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={s.sendTo()?.id === r.id}
      onClick={() => {
        s.setPickedTo(r.id);
        setOpen(false);
        btn?.focus();
      }}
    >
      <i class="dot" classList={{ ok: r.listening, quiet: !r.listening }} />
      <span class="sendto-row">
        <span class="sendto-name">
          {r.name}
          <span class="sendto-when">{` · ${activeLabel(r.lastCallAt, Date.now())}`}</span>
        </span>
        <span class="sendto-sub">{subline(r)}</span>
      </span>
      <Show when={s.sendTo()?.id === r.id}>
        <Icon name="check" />
      </Show>
    </button>
  );

  return (
    <Show when={!readonly() && s.sendTo()}>
      {(cur) => (
        <div class="sendto" ref={(el) => (wrap = el)}>
          <span class="sendto-k">To</span>
          <button
            type="button"
            class="sendto-btn"
            ref={(el) => (btn = el)}
            aria-haspopup="menu"
            aria-expanded={open()}
            onClick={() => setOpen(!open())}
          >
            <i class="dot" classList={{ ok: cur().listening, quiet: !cur().listening }} />
            <span class="sendto-cur">
              {cur().name}
              <span class="sendto-when">{` · ${activeLabel(cur().lastCallAt, Date.now())}`}</span>
            </span>
            <Icon name="down" />
          </button>
          <Show when={open()}>
            <div class="cmenu sendto-menu" role="menu" aria-label="Who gets this Send">
              <div class="cmenu-h">Listening now</div>
              <For each={s.recipients().recipients.filter((r) => r.listening)}>{rows}</For>
              <Show when={s.recipients().recipients.some((r) => !r.listening)}>
                <div class="cmenu-sep" role="separator" />
                <div class="cmenu-h">Not listening</div>
                <For each={s.recipients().recipients.filter((r) => !r.listening)}>{rows}</For>
              </Show>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}
