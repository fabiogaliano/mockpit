// D4: the panel — header (mock · N tuned), the preset row, the mode row
// (Questions · Tune · Thread) and the mode's content.

import { createSignal, Match, Show, Switch } from "solid-js";
import { host } from "./host.ts";
import { Questions } from "./Questions.tsx";
import type { MockScreenState, Mode } from "./state.ts";
import { Thread, useThreadRows } from "./Thread.tsx";
import { Chevron, PartSelector, Tune } from "./Tune.tsx";

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

export function Panel(props: { s: MockScreenState }) {
  const s = props.s;
  const [content, setContent] = createSignal<HTMLElement>();
  const [copied, setCopied] = createSignal(false);
  const rows = useThreadRows(s);
  const tuned = () => Object.keys(s.draft()?.tuned ?? {}).length;

  // Until tunekit's presets arrive (4b), Copy hands over the tuned values as JSON.
  const copy = async () => {
    const text = JSON.stringify(s.draft()?.tuned ?? {}, null, 2);
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
      onClick={() => s.mode() !== k && s.setMode(k)}
    >
      {label}
      <Show when={k === "questions" && s.owed().length > 0}>
        <i class="dot" aria-label="open questions" />
      </Show>
      <Show when={k === "thread"}>
        <span class="n">{rows().length}</span>
      </Show>
    </button>
  );

  return (
    <aside class="up-shell" aria-label="Panel">
      <div class="up-header">
        <span class="up-header-title">{s.mock()?.title}</span>
        <div class="up-header-right">
          <span class="tcount" classList={{ on: tuned() > 0 }}>{`${tuned()} tuned`}</span>
          <span class="up-header-btn" aria-hidden="true">
            <Icon d={["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", "M15 5v4", "M9 15v4"]} />
          </span>
        </div>
      </div>
      <div class="up-preset-bar">
        <button
          type="button"
          class="up-preset-add"
          title="Save as preset"
          aria-label="Save as preset"
        >
          <Icon d={["M12 5v14M5 12h14"]} />
        </button>
        <button type="button" class="up-preset-trigger" aria-label="Preset">
          <span>default</span>
          <Chevron />
        </button>
        <button
          type="button"
          class="up-copy-btn"
          title="Copy what you tuned, for the agent"
          data-copied={copied() ? "" : undefined}
          onClick={() => void copy()}
        >
          <Icon d={copied() ? ["M5 12.5l4.5 4.5L19 7"] : COPY} />
          {copied() ? "Copied" : "Copy"}
        </button>
      </div>
      <div class="up-tabs-wrap">
        <div class="up-tabs">
          <div class="up-modes" role="tablist">
            {modeButton("questions", "Questions")}
            {modeButton("tune", "Tune")}
            {modeButton("thread", "Thread")}
          </div>
          <Show when={s.mode() === "tune"}>
            <PartSelector s={s} />
          </Show>
        </div>
      </div>
      <div class="up-content" ref={setContent}>
        <Switch>
          <Match when={s.mode() === "questions"}>
            <Questions s={s} />
          </Match>
          <Match when={s.mode() === "tune"}>
            <Tune s={s} />
          </Match>
          <Match when={s.mode() === "thread"}>
            <Thread s={s} scroller={content} />
          </Match>
        </Switch>
      </div>
    </aside>
  );
}
