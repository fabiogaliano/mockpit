// The mock screen's keyboard: flowKey (logic.ts) says what a key means, this
// applies it: number keys pick on the question card, ←/→ step through the
// versions, ↑/↓ through the situations of a state, Enter sends on. The Mark
// tool owns its keys while on.
// Any key or press on the screen also keeps it from moving on by itself after
// a Send: the user is reading or doing something here.

import { onCleanup, onMount } from "solid-js";
import { root } from "./host.ts";
import { flowKey } from "./logic.ts";
import type { MockScreenState } from "./state.ts";

const FIELD = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
const CONTROL = "button, a[href], summary, [role='button'], [role='tab'], [role='option']";

export function useFlowKeys(s: MockScreenState) {
  onMount(() => {
    const stay = () => {
      if (s.afterSend()?.auto) s.stayHere();
    };
    const onKey = (e: KeyboardEvent) => {
      stay();
      if (e.defaultPrevented || e.isComposing || s.marking()) return;
      // tunekit's controls live in a shadow root: the event's own target is
      // retargeted to the host, the first node of its path is the real one.
      const el = e.composedPath()[0];
      const at = el instanceof Element ? el : null;
      const key = flowKey({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        typing: !!at?.closest(FIELD),
        onControl: !!at?.closest(CONTROL),
      });
      if (!key) return;
      switch (key.kind) {
        case "pick":
          s.chooseNth(key.n);
          break;
        case "step":
          s.stepVersion(key.by);
          break;
        case "primary":
          if (s.afterSend()?.next) s.goNext();
          else if (s.commitKind() && !s.cardMin() && !s.panel()) s.commit();
          else return;
          break;
        case "mock":
          void s.goOwedMock(key.by);
          break;
        // Only where there are situations to move through: otherwise the
        // arrows still scroll.
        case "situation":
          if (!s.stepSituation(key.by)) return;
          break;
        case "clear":
          if (!s.preview() && !s.afterSend()?.auto) return;
          s.setPreview(null);
          s.stayHere();
          break;
      }
      e.preventDefault();
    };
    root().addEventListener("keydown", onKey);
    root().addEventListener("pointerdown", stay, true);
    onCleanup(() => {
      root().removeEventListener("keydown", onKey);
      root().removeEventListener("pointerdown", stay, true);
    });
  });
}
