// A Home card's ⋯ menu: the user moves the mock themselves (another kind,
// another area) or closes it. Moves go through the same edit the agent uses,
// with its rules (a mock still embedded stays a component), and the agent
// hears each one in its next feedback; a refusal shows here, briefly.

import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import type { MockKind } from "../../server/types.ts";
import { api } from "./api.ts";
import { host, root } from "./host.ts";
import { Icon } from "./icons.tsx";

const KINDS: { kind: MockKind; label: string }[] = [
  { kind: "page", label: "Pages" },
  { kind: "component", label: "Components" },
  { kind: "sketch", label: "Sketches" },
];

const ERROR_MS = 5000;

export function CardMenu(props: {
  mock: { id: string; title: string; kind: MockKind; area?: string; resolvedAt: string | null };
  // The project's areas, in its order, to pick from.
  areas: string[];
  onClose: () => void;
  onReopen: () => void;
  onEdited: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  let btn!: HTMLButtonElement;
  let menu: HTMLDivElement | undefined;
  let errTimer = 0;
  onCleanup(() => host().window.clearTimeout(errTimer));
  const shut = (focus = false) => {
    setOpen(false);
    setError(null);
    if (focus) btn.focus();
  };
  // It opens to the right of the button, or to its left where the window ends.
  const [flip, setFlip] = createSignal(false);
  createEffect(() => {
    if (!open()) return setFlip(false);
    host().window.requestAnimationFrame(() => {
      const r = menu?.getBoundingClientRect();
      if (r && r.right > host().window.innerWidth - 8) setFlip(true);
    });
  });
  createEffect(() => {
    if (!open()) return;
    const doc = root();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      shut(true);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu?.contains(t) && !btn.contains(t)) shut();
    };
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("pointerdown", onDown, true);
    onCleanup(() => {
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("pointerdown", onDown, true);
    });
  });

  async function edit(body: { kind?: MockKind; area?: string | null }) {
    if (busy()) return;
    setBusy(true);
    host().window.clearTimeout(errTimer);
    setError(null);
    try {
      await api.editMock(props.mock.id, body);
      props.onEdited();
      shut(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      errTimer = host().window.setTimeout(() => setError(null), ERROR_MS);
    } finally {
      setBusy(false);
    }
  }
  const area = () => props.mock.area ?? null;

  return (
    <div class="home-more-wrap" classList={{ open: open() }}>
      <button
        type="button"
        class="ib home-more"
        ref={(el) => (btn = el)}
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-label={`More for ${props.mock.title}`}
        onClick={(e) => {
          e.preventDefault();
          if (open()) shut();
          else setOpen(true);
        }}
      >
        <Icon name="more" />
      </button>
      <Show when={open()}>
        <div
          class="cmenu"
          classList={{ flip: flip() }}
          role="menu"
          aria-label={props.mock.title}
          aria-busy={busy()}
          ref={(el) => (menu = el)}
        >
          <div class="cmenu-h">Move to</div>
          <For each={KINDS}>
            {(k) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={props.mock.kind === k.kind}
                onClick={() =>
                  props.mock.kind === k.kind ? shut(true) : void edit({ kind: k.kind })
                }
              >
                {k.label}
                <Show when={props.mock.kind === k.kind}>
                  <Icon name="check" />
                </Show>
              </button>
            )}
          </For>
          <div class="cmenu-sep" role="separator" />
          <div class="cmenu-h">Area</div>
          <For each={props.areas}>
            {(a) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={area() === a}
                onClick={() => (area() === a ? shut(true) : void edit({ area: a }))}
              >
                {a}
                <Show when={area() === a}>
                  <Icon name="check" />
                </Show>
              </button>
            )}
          </For>
          <Show when={area() !== null}>
            <button type="button" role="menuitem" onClick={() => void edit({ area: null })}>
              No area
            </button>
          </Show>
          <form
            class="cmenu-new"
            onSubmit={(e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.namedItem("area") as HTMLInputElement;
              const name = input.value.trim();
              if (name) void edit({ area: name });
            }}
          >
            <input
              name="area"
              type="text"
              placeholder="New area"
              aria-label="New area"
              maxLength={120}
            />
          </form>
          <div class="cmenu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              shut();
              if (props.mock.resolvedAt) props.onReopen();
              else props.onClose();
            }}
          >
            {props.mock.resolvedAt ? "Reopen" : "Close"}
          </button>
          <Show when={error()}>
            {(msg) => (
              <p class="cmenu-err" role="alert">
                {msg()}
              </p>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}
