// Where a bookmark saves to: the project's shortlists, each with its count, and
// a name for a new one. Opened from a card it saves that version (and takes it
// back from a list that has it); opened from the top bar it only chooses which
// list the next one-click save goes to. Fixed to the window, since Studio's
// scroller would clip it.

import { createEffect, For, onCleanup, onMount, Show } from "solid-js";
import type { SaveCandidate } from "./api.ts";
import { host, root } from "./host.ts";
import { Icon } from "./icons.tsx";
import type { Shortlists } from "./shortlist.ts";

const WIDTH = 260;

export type MenuFor = { ref: SaveCandidate; name: string } | null;

export function ShortlistMenu(props: {
  sl: Shortlists;
  anchor: HTMLElement;
  // The version being saved; null to choose the list.
  item: MenuFor;
  onClose: () => void;
}) {
  const sl = props.sl;
  let menu: HTMLDivElement | undefined;
  const place = () => {
    const r = props.anchor.getBoundingClientRect();
    const w = host().window;
    const left = Math.max(8, Math.min(r.right - WIDTH, w.innerWidth - WIDTH - 8));
    return r.bottom > w.innerHeight * 0.6
      ? { left: `${left}px`, bottom: `${w.innerHeight - r.top + 4}px` }
      : { left: `${left}px`, top: `${r.bottom + 4}px` };
  };
  const shut = (focus = false) => {
    props.onClose();
    if (focus) props.anchor.focus();
  };
  createEffect(() => {
    const doc = root();
    const win = host().window;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      shut(true);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu?.contains(t) && !props.anchor.contains(t)) shut();
    };
    // It is placed once, so it would float off its card as Studio scrolls.
    const onScroll = () => shut();
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("pointerdown", onDown, true);
    win.addEventListener("scroll", onScroll, true);
    onCleanup(() => {
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("pointerdown", onDown, true);
      win.removeEventListener("scroll", onScroll, true);
    });
  });
  onMount(() => menu?.querySelector<HTMLElement>("button, input")?.focus({ preventScroll: true }));
  const chosen = (id: string) => {
    const it = props.item;
    if (!it) return sl.current()?.id === id;
    const list = sl.lists().find((l) => l.id === id);
    return !!list && sl.has(list, it.ref);
  };
  return (
    <div
      class="cmenu slmenu"
      role="menu"
      aria-label={props.item ? `Save ${props.item.name}` : "Shortlist to save to"}
      ref={(el) => (menu = el)}
      style={place()}
    >
      <Show when={sl.lists().length}>
        <div class="cmenu-h">{props.item ? `Save ${props.item.name} to` : "Save to"}</div>
        <For each={sl.lists()}>
          {(l) => (
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={chosen(l.id)}
              onClick={() => {
                const it = props.item;
                const had = chosen(l.id);
                shut(true);
                if (!it) sl.pick(l.id);
                else if (had) void sl.unsave(l, it.ref, it.name);
                else void sl.save(it.ref, it.name, { to: l.id });
              }}
            >
              <span class="slmenu-nm">{l.title}</span>
              <Show when={chosen(l.id)} fallback={<span class="n">{l.candidates.length}</span>}>
                <Icon name="check" />
              </Show>
            </button>
          )}
        </For>
      </Show>
      <Show
        when={props.item}
        fallback={
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              shut(true);
              sl.pick(null);
            }}
          >
            Name a new one on the next save
          </button>
        }
      >
        {(it) => (
          <>
            <Show when={sl.lists().length}>
              <div class="cmenu-sep" role="separator" />
            </Show>
            <form
              class="slmenu-new"
              onSubmit={(e) => {
                e.preventDefault();
                const input = e.currentTarget.elements.namedItem("name") as HTMLInputElement;
                const title = input.value.trim();
                if (!title) return input.focus();
                const { ref, name } = it();
                shut(true);
                void sl.save(ref, name, { title });
              }}
            >
              <input
                name="name"
                type="text"
                placeholder="New shortlist name"
                aria-label="New shortlist name"
                maxLength={120}
              />
              <button type="submit" class="btn">
                Create
              </button>
            </form>
          </>
        )}
      </Show>
    </div>
  );
}
