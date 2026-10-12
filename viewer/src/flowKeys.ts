// The mock screen's keyboard: flowKey (logic.ts) says what a key means, this
// applies it. The Mark tool and the Versions popover own their keys while open.

import { onCleanup, onMount } from "solid-js";
import { root } from "./host.ts";
import { flowKey } from "./logic.ts";
import type { MockScreenState } from "./state.ts";

const FIELD = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
const CONTROL = "button, a[href], summary, [role='button'], [role='tab'], [role='option']";

export function useFlowKeys(s: MockScreenState) {
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || s.marking() || s.versionsOpen()) return;
      // Tune's controls live in a shadow root: the event's own target is
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
      const questions = s.mode() === "questions";
      switch (key.kind) {
        case "pick":
          if (!questions || s.reviewing()) return;
          s.chooseNth(key.n);
          break;
        case "step":
          if (!questions) return;
          s.step(key.by);
          break;
        case "primary":
          if (s.afterSend()?.next) s.goNext();
          else if (questions && s.primary()) s.runPrimary();
          else return;
          break;
        case "mock":
          void s.goOwedMock(key.by);
          break;
        case "clear":
          if (!s.preview() && !s.afterSend()?.auto && !s.keysOpen()) return;
          s.setPreview(null);
          s.stayHere();
          s.setKeysOpen(false);
          break;
        case "help":
          if (!questions) return;
          s.setKeysOpen(!s.keysOpen());
          break;
      }
      e.preventDefault();
    };
    root().addEventListener("keydown", onKey);
    onCleanup(() => root().removeEventListener("keydown", onKey));
  });
}
