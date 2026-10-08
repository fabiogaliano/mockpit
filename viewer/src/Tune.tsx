// D4: Tune — a component selector (‹ ›) over the parts on stage, that part's
// knobs, and a comment field. Clicking a part on the stage selects it here.
// The knob controls themselves are phase 4b (tunekit mounts into `tuneHost`).

import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { root } from "./host.ts";
import type { MockScreenState } from "./state.ts";

function useParts(s: MockScreenState) {
  const parts = createMemo(() => {
    const m = s.mock();
    return m?.parts.find((p) => p.state === s.activeState())?.parts ?? [];
  });
  const current = createMemo(() => {
    const sel = s.selectedPart();
    return parts().find((p) => p.name === sel) ?? parts()[0] ?? null;
  });
  return { parts, current };
}

const Chevron = (props: { open?: boolean }) => (
  <svg
    class="up-select-chevron"
    classList={{ "up-select-chevron-open": props.open }}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M6 9.5L12 15.5L18 9.5" />
  </svg>
);
export { Chevron };

export function PartSelector(props: { s: MockScreenState }) {
  const s = props.s;
  const { parts, current } = useParts(s);
  const [open, setOpen] = createSignal(false);
  let trigger!: HTMLButtonElement;
  let list: HTMLDivElement | undefined;
  const index = () => parts().findIndex((p) => p.name === current()?.name);
  const step = (d: number) => {
    const p = parts()[index() + d];
    if (p) s.selectPart(p.name);
  };
  onMount(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (open() && !trigger.contains(t) && !list?.contains(t)) setOpen(false);
    };
    root().addEventListener("pointerdown", onDown, true);
    onCleanup(() => root().removeEventListener("pointerdown", onDown, true));
  });
  return (
    <div class="up-comp-row">
      <div class="up-comp-wrap">
        <button
          type="button"
          ref={(el) => (trigger = el)}
          class="up-select-trigger up-comp-trigger"
          classList={{ "up-select-trigger-open": open() }}
          aria-haspopup="listbox"
          aria-expanded={open()}
          disabled={!parts().length}
          onClick={() => setOpen(!open())}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowRight") step(1);
            else if (e.key === "ArrowUp" || e.key === "ArrowLeft") step(-1);
            else return;
            e.preventDefault();
          }}
        >
          <span class="up-select-label">Component</span>
          <span class="up-select-right">
            <span class="up-select-value">{current()?.name ?? "none marked"}</span>
            <Chevron open={open()} />
          </span>
        </button>
        <Show when={open()}>
          <div class="up-select-dropdown" role="listbox" ref={(el) => (list = el)}>
            <For each={parts()}>
              {(p) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={p.name === current()?.name}
                  class="up-select-option"
                  classList={{ "up-select-option-selected": p.name === current()?.name }}
                  onClick={() => {
                    setOpen(false);
                    s.selectPart(p.name);
                  }}
                >
                  <span class="up-comp-opt">
                    {p.name}
                    <Show when={p.label && p.label !== p.name}>
                      <span class="up-comp-sub">{p.label}</span>
                    </Show>
                  </span>
                  <Show when={p.name === current()?.name}>
                    <i class="up-select-check" />
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
      <button
        type="button"
        class="nav"
        title="Previous component"
        disabled={index() <= 0}
        onClick={() => step(-1)}
      >
        ‹
      </button>
      <button
        type="button"
        class="nav"
        title="Next component"
        disabled={index() < 0 || index() >= parts().length - 1}
        onClick={() => step(1)}
      >
        ›
      </button>
    </div>
  );
}

export function Tune(props: { s: MockScreenState }) {
  const s = props.s;
  const { current } = useParts(s);
  const [shut, setShut] = createSignal(false);
  const [text, setText] = createSignal("");
  // D2: a part exists once; where else it appears is a sentence with links.
  const usedIn = createMemo(() => {
    const name = current()?.name;
    const m = s.mock();
    if (!name || !m) return [];
    return m.parts.filter((p) => p.parts.some((x) => x.name === name)).map((p) => p.state);
  });
  const mine = createMemo(() =>
    (s.draft()?.comments ?? []).filter((c) => c.part === (current()?.name ?? null)),
  );
  const submit = () => {
    const t = text().trim();
    if (!t) return;
    s.addComment(current()?.name ?? null, s.activeState(), t);
    setText("");
  };
  return (
    <>
      <Show when={current() && s.states().length > 1}>
        <div class="usage">
          <Show
            when={usedIn().length === s.states().length}
            fallback={
              <>
                {usedIn().length === 1 ? "Only in " : "In "}
                <For each={usedIn()}>
                  {(st, k) => (
                    <>
                      {k() > 0 ? (k() === usedIn().length - 1 ? " and " : ", ") : ""}
                      <button type="button" class="lnk" onClick={() => s.showState(st)}>
                        {st}
                      </button>
                    </>
                  )}
                </For>
                .
              </>
            }
          >
            {"Same in "}
            <button
              type="button"
              class="lnk"
              onClick={() => {
                const all = s.states();
                s.showState(all[(all.indexOf(s.activeState()) + 1) % all.length]);
              }}
            >
              {`all ${s.states().length} states`}
            </button>
            .
          </Show>
        </div>
      </Show>
      <div class="tune-knobs" ref={(el) => s.setTuneHost(el)} />
      <hr class="up-rule" />
      <section class="up-group">
        <button
          type="button"
          class="up-group-hd"
          classList={{ "up-group-shut": shut() }}
          aria-expanded={!shut()}
          onClick={() => setShut(!shut())}
        >
          <span>{mine().length ? `Comments · ${mine().length}` : "Comments"}</span>
          <Chevron />
        </button>
        <Show when={!shut()}>
          <label class="up-text-row">
            <span class="up-text-label">Comment</span>
            <input
              class="up-text-input"
              placeholder={`on ${current()?.name ?? "the page"}…`}
              value={text()}
              onInput={(e) => setText(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </label>
          <Show when={mine().length}>
            <div class="clines">
              <For each={mine()}>{(c) => <div class="cline">{c.text}</div>}</For>
            </div>
          </Show>
        </Show>
      </section>
    </>
  );
}
