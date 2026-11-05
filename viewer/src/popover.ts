import { createEffect, onCleanup } from "solid-js";
import { root } from "./host.ts";

// A popover shuts on Esc, handing focus back to its button, and on a press outside
// both. Capture, so Esc shuts this before the screen's own Esc shuts anything else.
export function usePopover(
  open: () => boolean,
  close: () => void,
  button: () => HTMLElement | undefined,
  pop: () => HTMLElement | undefined,
) {
  createEffect(() => {
    if (!open()) return;
    const doc = root();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close();
      button()?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop()?.contains(t) && !button()?.contains(t)) close();
    };
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("pointerdown", onDown, true);
    onCleanup(() => {
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("pointerdown", onDown, true);
    });
  });
}
