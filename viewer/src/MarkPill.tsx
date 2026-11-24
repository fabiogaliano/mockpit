// The pill over the corner of the frame on stage, always there, and on a sheet cell while
// the pointer is on it: Main and Bookmark, then comment and more like this, then Delete
// (frameActions.ts says which the frame has). M, K and X do the same from the keyboard.

import { For, Show } from "solid-js";
import {
  type FrameAction,
  type FrameActionId,
  frameActions,
  type FrameRef,
  runFrameAction,
} from "./frameActions.ts";
import { Icon } from "./icons.tsx";
import type { DesignScreenState } from "./state.ts";

const MARKS = new Set(["main", "keep", "delete"]);

export function MarkPill(props: {
  s: DesignScreenState;
  f: FrameRef;
  // In the panel's row or the stage's caption, always shown.
  inline?: boolean;
  // The few a place has room for: a row in the panel sorts, the stage does the rest.
  only?: readonly FrameActionId[];
}) {
  const acts = () =>
    frameActions(props.s, props.f).filter(
      (a) => !a.menu && (!props.only || props.only.includes(a.id)),
    );
  const marks = () => acts().filter((a) => MARKS.has(a.id));
  const groups = () =>
    [
      acts().filter((a) => a.id === "main" || a.id === "keep"),
      acts().filter((a) => !MARKS.has(a.id)),
      acts().filter((a) => a.id === "delete"),
    ].filter((g) => g.length);
  const button = (a: FrameAction) => (
    <button
      type="button"
      classList={{
        on: !!a.on,
        star: a.id === "main",
        keep: a.id === "keep",
        del: a.id === "delete",
        "mp-ask": !MARKS.has(a.id),
      }}
      aria-pressed={a.id === "main" || a.id === "keep" ? !!a.on : undefined}
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
        <For each={groups()}>
          {(g, n) => (
            <>
              <Show when={n() > 0}>
                <i aria-hidden="true" />
              </Show>
              <For each={g}>{button}</For>
            </>
          )}
        </For>
      </span>
    </Show>
  );
}
