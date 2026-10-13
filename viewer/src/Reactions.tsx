// The one-tap reaction row: like, dislike, "more like this". Used on a part
// picked on the stage and on the variant in the stage head; each tap is a draft
// reaction that goes out with the next Send.

import { createSignal, For, type JSX, onCleanup, onMount } from "solid-js";
import { REACTIONS, type Reaction } from "../../server/types.ts";
import { REACTION_LABEL, reactionSpot } from "./reactionRules.ts";
import type { MockScreenState } from "./state.ts";

const Thumb = (props: { down?: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style={props.down ? { transform: "scaleY(-1)" } : undefined}
  >
    <path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3Z" />
    <path d="M7 10l4-7a2.5 2.5 0 0 1 2.9 2.8L13 10h5.6a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17.2 21H7" />
  </svg>
);

const ICON: Record<Reaction, () => JSX.Element> = {
  up: () => <Thumb />,
  down: () => <Thumb down />,
  more: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
};

export function ReactionBar(props: {
  s: MockScreenState;
  // null: the variant on stage itself.
  part: string | null;
  // What the reaction is about, for the group's name ("hero", "variant B").
  about: string;
  // Shown before the buttons where nothing nearby names the target.
  name?: string;
  class?: string;
  style?: JSX.CSSProperties;
  ref?: (el: HTMLDivElement) => void;
}) {
  const s = props.s;
  return (
    <div
      ref={(el) => props.ref?.(el)}
      class={`reactions ${props.class ?? ""}`}
      role="group"
      aria-label={`React to ${props.about}`}
      style={props.style}
      data-reactions={props.part ?? ""}
      // The overlay under it treats a click as a hit on the page.
      onClick={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
    >
      {props.name ? (
        <span class="react-about" aria-hidden="true">
          {props.name}
        </span>
      ) : null}
      <For each={REACTIONS}>
        {(r) => (
          <button
            type="button"
            class="react"
            classList={{ on: s.reactionOn(props.part) === r, wide: r === "more" }}
            aria-pressed={s.reactionOn(props.part) === r}
            aria-label={r === "more" ? undefined : REACTION_LABEL[r]}
            title={REACTION_LABEL[r]}
            data-reaction={r}
            onClick={() => s.react(props.part, r)}
          >
            {ICON[r]()}
            {r === "more" ? <span>{REACTION_LABEL.more}</span> : null}
          </button>
        )}
      </For>
    </div>
  );
}
// The reaction row for the picked part: under it, else above its label, else
// inside its top edge, always within the overlay's box.
export function PartReactions(props: {
  s: MockScreenState;
  r: { x: number; y: number; w: number; h: number };
  part: string;
  label: string;
  // The overlay's size, in its px.
  width: number;
  height: number;
}) {
  const [size, setSize] = createSignal({ w: 0, h: 0 });
  let el: HTMLDivElement | undefined;
  onMount(() => {
    if (!el) return;
    const node = el;
    const measure = () => setSize({ w: node.offsetWidth, h: node.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    onCleanup(() => ro.disconnect());
  });
  const spot = () => reactionSpot(props.r, size(), { width: props.width, height: props.height });
  return (
    <ReactionBar
      s={props.s}
      part={props.part}
      about={props.label}
      class="part-reactions"
      ref={(node) => (el = node)}
      style={{ left: `${spot().left}px`, top: `${spot().top}px` }}
    />
  );
}
