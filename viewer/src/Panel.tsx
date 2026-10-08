// D4: the panel — header (mock · N tuned), the preset row, the mode row
// (Questions · Tune · Thread) and the mode's content. On a narrow screen it is
// a bottom sheet (§5): collapsed to its mode row, dragged or tapped open, and
// without Tune.

import {
  createEffect,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js";
import { host, root } from "./host.ts";
import { tunedLines } from "./logic.ts";
import { loadPresets, type Preset, storePresets } from "./presets.ts";
import { Questions } from "./Questions.tsx";
import type { MockScreenState, Mode } from "./state.ts";
import { Thread, useThreadRows } from "./Thread.tsx";
import type { TuneState } from "./tune.ts";
import { Chevron, PartSelector, Tune } from "./Tune.tsx";
import { narrow } from "./viewport.ts";

const Icon = (props: { d: string[] }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    {props.d.map((d) => (
      <path d={d} />
    ))}
  </svg>
);

const COPY = [
  "M8 6C8 4.34 9.34 3 11 3h2c1.66 0 3 1.34 3 3v1H8V6Z",
  "M16 5h1c1.66 0 3 1.34 3 3v10c0 1.66-1.34 3-3 3H7c-1.66 0-3-1.34-3-3V8c0-1.66 1.34-3 3-3h1",
];

export function Panel(props: { s: MockScreenState; t: TuneState }) {
  const s = props.s;
  const [content, setContent] = createSignal<HTMLElement>();
  const [copied, setCopied] = createSignal(false);
  const [sheetOpen, setSheetOpen] = createSignal(false);
  const rows = useThreadRows(s);
  const tuned = () => Object.keys(s.draft()?.tuned ?? {}).length;

  const copy = async () => {
    const text = tunedLines(s.draft()?.tuned ?? {});
    try {
      await host().window.navigator.clipboard?.writeText(text);
    } catch {
      // Clipboard denied: nothing to undo, the button just doesn't confirm.
      return;
    }
    setCopied(true);
    host().window.setTimeout(() => setCopied(false), 1400);
  };

  const modeButton = (k: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      class="up-mode"
      classList={{ "up-mode-active": s.mode() === k }}
      aria-selected={s.mode() === k}
      data-mode={k}
      onClick={() => {
        if (narrow()) setSheetOpen(true);
        if (s.mode() !== k) s.setMode(k);
      }}
    >
      {label}
      <Show when={k === "questions" && s.owed().length > 0}>
        <i class="dot" aria-label="open questions" />
      </Show>
      <Show when={k === "tune" && tuned() > 0}>
        <i class="dot" aria-label="tuned" />
      </Show>
      <Show when={k === "thread"}>
        <span class="n">{rows().length}</span>
      </Show>
    </button>
  );

  return (
    <aside
      class="up-shell"
      classList={{ sheet: narrow(), open: narrow() && sheetOpen() }}
      aria-label="Panel"
    >
      <Show when={narrow()}>
        <SheetHandle open={sheetOpen()} setOpen={setSheetOpen} />
      </Show>
      <div class="up-header">
        <span class="up-header-title">{s.mock()?.title}</span>
        <div class="up-header-right">
          <span class="tcount" classList={{ on: tuned() > 0 }}>{`${tuned()} tuned`}</span>
          <span class="up-header-btn" aria-hidden="true">
            <Icon d={["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", "M15 5v4", "M9 15v4"]} />
          </span>
        </div>
      </div>
      <PresetBar s={s} copied={copied()} onCopy={() => void copy()} />
      <div class="up-tabs-wrap">
        <div class="up-tabs">
          <div class="up-modes" role="tablist">
            {modeButton("questions", "Questions")}
            <Show when={!narrow()}>{modeButton("tune", "Tune")}</Show>
            {modeButton("thread", "Thread")}
          </div>
          <Show when={s.mode() === "tune"}>
            <PartSelector s={s} t={props.t} />
          </Show>
        </div>
      </div>
      <div class="up-content" ref={setContent}>
        <Switch>
          <Match when={s.mode() === "questions"}>
            <Questions s={s} />
          </Match>
          <Match when={s.mode() === "tune"}>
            <Tune s={s} t={props.t} />
          </Match>
          <Match when={s.mode() === "thread"}>
            <Thread s={s} scroller={content} />
          </Match>
        </Switch>
      </div>
    </aside>
  );
}

// + saves what is tuned as a named preset, ▾ restores one ("default" is
// nothing tuned), Copy hands the tuned values to the agent as text.
function PresetBar(props: { s: MockScreenState; copied: boolean; onCopy: () => void }) {
  const s = props.s;
  const [list, setList] = createSignal<Preset[]>([]);
  const [active, setActive] = createSignal<number | null>(null);
  const [open, setOpen] = createSignal(false);
  let wrap!: HTMLDivElement;
  createEffect(
    on(
      () => s.mock()?.id,
      (id) => {
        setList(id ? loadPresets(id) : []);
        setActive(null);
      },
    ),
  );
  onMount(() => {
    const onDown = (e: PointerEvent) => {
      if (open() && !wrap.contains(e.target as Node)) setOpen(false);
    };
    root().addEventListener("pointerdown", onDown, true);
    onCleanup(() => root().removeEventListener("pointerdown", onDown, true));
  });
  const save = () => {
    const id = s.mock()?.id;
    if (!id) return;
    const next = [
      ...list(),
      { name: `preset ${list().length + 1}`, tuned: { ...s.draft()?.tuned } },
    ];
    setList(next);
    setActive(next.length - 1);
    storePresets(id, next);
  };
  const restore = (i: number | null) => {
    setOpen(false);
    setActive(i);
    s.replaceTuned(i === null ? {} : (list()[i]?.tuned ?? {}));
  };
  return (
    <div class="up-preset-bar">
      <button
        type="button"
        class="up-preset-add"
        title="Save as preset"
        aria-label="Save as preset"
        onClick={save}
      >
        <Icon d={["M12 5v14M5 12h14"]} />
      </button>
      <div class="up-preset-wrap" ref={(el) => (wrap = el)}>
        <button
          type="button"
          class="up-preset-trigger"
          aria-label="Preset"
          aria-haspopup="listbox"
          aria-expanded={open()}
          onClick={() => setOpen(!open())}
        >
          <span>{active() === null ? "default" : list()[active()!]?.name}</span>
          <Chevron open={open()} />
        </button>
        <Show when={open()}>
          <div class="up-select-dropdown" role="listbox">
            <For each={[null, ...list().map((_, i) => i)]}>
              {(i) => (
                <button
                  type="button"
                  role="option"
                  class="up-select-option"
                  classList={{ "up-select-option-selected": active() === i }}
                  aria-selected={active() === i}
                  onClick={() => restore(i)}
                >
                  <span>{i === null ? "default" : list()[i].name}</span>
                  <Show when={active() === i}>
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
        class="up-copy-btn"
        title="Copy what you tuned, for the agent"
        data-copied={props.copied ? "" : undefined}
        onClick={() => props.onCopy()}
      >
        <Icon d={props.copied ? ["M5 12.5l4.5 4.5L19 7"] : COPY} />
        {props.copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

// The sheet's grip: a tap toggles it, a drag up opens and a drag down closes.
function SheetHandle(props: { open: boolean; setOpen: (v: boolean) => void }) {
  let startY = 0;
  let moved = 0;
  const onDown = (e: PointerEvent) => {
    startY = e.clientY;
    moved = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (e.buttons === 0 && e.pointerType === "mouse") return;
    moved = e.clientY - startY;
  };
  const onUp = () => {
    if (Math.abs(moved) < 8) props.setOpen(!props.open);
    else props.setOpen(moved < 0);
  };
  return (
    <button
      type="button"
      class="sheet-handle"
      aria-label={props.open ? "Collapse panel" : "Expand panel"}
      aria-expanded={props.open}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      <i />
    </button>
  );
}
