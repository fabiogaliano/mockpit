// D4: Tune — a component selector (‹ ›) over "Look" and the parts with knobs or
// an ask, that component's knobs (tunekit, see tune.ts), where else the part
// appears, and its comments. Clicking a part on the stage selects it here.

import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { root } from "./host.ts";
import type { TuneComponent } from "./logic.ts";
import type { MockScreenState } from "./state.ts";
import type { TuneState } from "./tune.ts";

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

// The states whose renders mark a part, in strip order.
function statesWith(s: MockScreenState, part: string): (string | null)[] {
  return (s.mock()?.parts ?? [])
    .filter((p) => p.parts.some((x) => x.name === part))
    .map((p) => p.state);
}

// Selecting a part the state on stage does not show moves to one that does.
function choose(s: MockScreenState, c: TuneComponent) {
  s.selectPart(c.part);
  if (c.part === null) return;
  const where = statesWith(s, c.part);
  if (where.length && !where.includes(s.activeState())) s.showState(where[0]);
}

export function PartSelector(props: { s: MockScreenState; t: TuneState }) {
  const s = props.s;
  const t = props.t;
  const [open, setOpen] = createSignal(false);
  let trigger!: HTMLButtonElement;
  let list: HTMLDivElement | undefined;
  const index = () => t.components().findIndex((c) => c.part === t.current()?.part);
  const step = (d: number) => {
    const list = t.components();
    // An untunable part shown from a stage click sits outside the list; ‹ › start over.
    const c = list[index() < 0 ? (d > 0 ? 0 : list.length - 1) : index() + d];
    if (c) choose(s, c);
  };
  onMount(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (open() && !trigger.contains(target) && !list?.contains(target)) setOpen(false);
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
          disabled={!t.components().length}
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
            <span class="up-select-value">{t.current()?.label ?? "none"}</span>
            <Chevron open={open()} />
          </span>
        </button>
        <Show when={open()}>
          <div class="up-select-dropdown" role="listbox" ref={(el) => (list = el)}>
            <For each={t.components()}>
              {(c) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={c.part === t.current()?.part}
                  class="up-select-option"
                  classList={{ "up-select-option-selected": c.part === t.current()?.part }}
                  data-part={c.part ?? ""}
                  onClick={() => {
                    setOpen(false);
                    choose(s, c);
                  }}
                >
                  <span class="up-comp-opt">
                    {c.label}
                    <Show when={t.tunedIn(c)}>
                      <i class="dot" aria-label="tuned" />
                    </Show>
                  </span>
                  <Show when={c.part === t.current()?.part}>
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
        disabled={index() === 0}
        onClick={() => step(-1)}
      >
        ‹
      </button>
      <button
        type="button"
        class="nav"
        title="Next component"
        disabled={index() >= t.components().length - 1}
        onClick={() => step(1)}
      >
        ›
      </button>
    </div>
  );
}

export function Tune(props: { s: MockScreenState; t: TuneState }) {
  const s = props.s;
  const t = props.t;
  const [shut, setShut] = createSignal(false);
  const [text, setText] = createSignal("");
  const part = () => t.current()?.part ?? null;
  // D2: a part exists once; where else it appears is a sentence with links.
  const usedIn = createMemo(() => {
    const p = part();
    return p ? statesWith(s, p) : [];
  });
  const mine = createMemo(() => (s.draft()?.comments ?? []).filter((c) => c.part === part()));
  const submit = () => {
    const body = text().trim();
    if (!body) return;
    s.addComment(part(), s.activeState(), body);
    setText("");
  };
  return (
    <>
      <Show when={part() !== null && usedIn().length && s.states().length > 1}>
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
      <Show when={!t.current()?.paths.length}>
        <div class="up-note">
          {part() === null ? "No page-wide knobs." : `No knobs on ${part()}.`}
        </div>
      </Show>
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
          <Show when={mine().length}>
            <div class="clines">
              <For each={mine()}>{(c) => <div class="cline">{c.text}</div>}</For>
            </div>
          </Show>
          <label class="up-text-row">
            <span class="up-text-label">Comment</span>
            <input
              class="up-text-input"
              placeholder={`on ${part() ?? "the page"}…`}
              value={text()}
              onInput={(e) => setText(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </label>
        </Show>
      </section>
    </>
  );
}
