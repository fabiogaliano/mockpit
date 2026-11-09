// Two versions of the state on stage in one frame, as a design tool compares a before and
// an after: the one picked on the left of a divider, the one on stage on its right. Drag
// the divider, or use ← and →; Esc or × ends it. Both are sandboxed frames at the same
// scale, top-aligned, so what moved between them is what changes as the divider passes.

import { createSignal, onCleanup, onMount } from "solid-js";
import { surfaceUrl } from "./api.ts";
import { root } from "./host.ts";
import { Icon } from "./icons.tsx";
import type { VersionStep } from "./logic.ts";
import type { DesignScreenState } from "./state.ts";
import { frameMode } from "./systemRev.ts";
import { Thumb } from "./Thumb.tsx";

const pageOf = (st: VersionStep) => {
  const i = st.kinds.indexOf("html");
  return i < 0
    ? null
    : surfaceUrl(st.postId, i, { version: st.version, mode: frameMode(), w: st.rewrites });
};

// The versions a version can be compared with: the state's others that draw a page.
export const comparable = (s: DesignScreenState) => {
  const on = s.stageStep();
  return s.steps().filter((x) => pageOf(x) && (!on || x.n !== on.n));
};

export function CompareTwo(props: {
  s: DesignScreenState;
  before: VersionStep;
  after: VersionStep;
  // The one on the left is what this browser last had on screen (seen.ts).
  saw?: boolean;
  onClose: () => void;
}) {
  const s = props.s;
  // Where the divider stands, as a share of the frame's width.
  const [at, setAt] = createSignal(0.5);
  let box: HTMLDivElement | undefined;
  const moveTo = (x: number) => {
    if (!box) return;
    const r = box.getBoundingClientRect();
    setAt(Math.min(1, Math.max(0, (x - r.left) / r.width)));
  };
  const down = (e: PointerEvent) => {
    e.preventDefault();
    box?.setPointerCapture(e.pointerId);
    moveTo(e.clientX);
  };
  const move = (e: PointerEvent) => {
    if (box?.hasPointerCapture(e.pointerId)) moveTo(e.clientX);
  };
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setAt(Math.max(0, at() - 0.05));
      else if (e.key === "ArrowRight") setAt(Math.min(1, at() + 0.05));
      else if (e.key === "Escape") props.onClose();
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    // Ahead of the screen's own keys: ← and → step versions there, Esc goes to the Board.
    root().addEventListener("keydown", onKey, true);
    onCleanup(() => root().removeEventListener("keydown", onKey, true));
  });
  const width = () => s.frameW();
  return (
    <div
      class="cmp2"
      role="dialog"
      aria-label="Compare two versions"
      style={{ "--cmp-w": `${width()}px` }}
    >
      <div class="cmp2-head">
        <span class="cmp2-side">
          {`◀ ${props.saw ? "What you saw, " : ""}${s.nameOf(props.before)}`}
        </span>
        <span class="cmp2-side cmp2-after">{`${s.nameOf(props.after)} ▶`}</span>
        <button
          type="button"
          class="ib"
          aria-label="End the comparison"
          title="End (Esc)"
          onClick={() => props.onClose()}
        >
          <Icon name="close" />
        </button>
      </div>
      <div
        class="cmp2-frame"
        ref={(el) => (box = el)}
        style={{ "--at": `${at() * 100}%` }}
        onPointerDown={down}
        onPointerMove={move}
      >
        <div class="cmp2-layer">
          <Thumb src={pageOf(props.after) ?? ""} width={width()} first />
        </div>
        <div class="cmp2-layer cmp2-before">
          <Thumb src={pageOf(props.before) ?? ""} width={width()} first />
        </div>
        <div
          class="cmp2-divider"
          role="slider"
          aria-label="Divider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(at() * 100)}
          tabIndex={0}
        />
      </div>
    </div>
  );
}
