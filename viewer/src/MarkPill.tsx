// The pill over the corner of the frame on stage, always there, and on a sheet cell while
// the pointer is on it: pick, Main and archive, then more like this and comment
// (frameActions.ts says which the frame has). P, M and X do the same from the keyboard.

import { For, Show } from "solid-js";
import { type FrameAction, frameActions, type FrameRef, runFrameAction } from "./frameActions.ts";
import { Icon } from "./icons.tsx";
import type { DesignScreenState } from "./state.ts";

const MARKS = new Set(["pick", "main", "archive"]);

export function MarkPill(props: {
  s: DesignScreenState;
  f: FrameRef;
  // In the panel's row or the stage's caption, always shown.
  inline?: boolean;
}) {
  const acts = () => frameActions(props.s, props.f).filter((a) => !a.menu);
  const marks = () => acts().filter((a) => MARKS.has(a.id));
  const asks = () => acts().filter((a) => !MARKS.has(a.id));
  const button = (a: FrameAction) => (
    <button
      type="button"
      classList={{ on: !!a.on, star: a.id === "main", "mp-ask": !MARKS.has(a.id) }}
      aria-pressed={a.id === "pick" || a.id === "main" ? !!a.on : undefined}
      aria-label={a.label}
      title={a.key ? `${a.label} (${a.key})` : a.label}
      onClick={(e) => {
        e.stopPropagation();
        runFrameAction(props.s, a.id, props.f);
      }}
      onDblClick={(e) => e.stopPropagation()}
    >
      <Icon name={a.icon} />
    </button>
  );
  // Marks are what the pill is for: a frame with none to make gets no pill.
  return (
    <Show when={marks().length}>
      <span
        class="markpill"
        classList={{ inline: !!props.inline }}
        role="toolbar"
        aria-label={`Mark ${props.f.v.alternative}`}
      >
        <For each={marks()}>{button}</For>
        <Show when={asks().length}>
          <i aria-hidden="true" />
          <For each={asks()}>{button}</For>
        </Show>
      </span>
    </Show>
  );
}
