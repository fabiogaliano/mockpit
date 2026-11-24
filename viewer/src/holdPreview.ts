// A row that previews on the stage: a mouse on it shows it at once, and one that rests
// there holds it after the pointer leaves. An answer's card and an alternative's row share
// the rule. Touch never previews, having no hover: there a tap chooses.

import { createSignal, onCleanup } from "solid-js";
import { host } from "./host.ts";

// Long enough that a pointer crossing the list on its way somewhere holds nothing.
export const HOLD_MS = 750;

export function createHold(o: {
  onEnter: () => void;
  onLeave: () => void;
  // What a rest does; nothing when the stage can't show the row.
  onHold: () => (() => void) | undefined;
  // Already holding the stage: a rest has nothing to add.
  held: () => boolean;
}) {
  const [resting, setResting] = createSignal(false);
  let timer = 0;
  const stop = () => {
    host().window.clearTimeout(timer);
    setResting(false);
  };
  onCleanup(stop);
  // A row can land under a mouse that hasn't moved, when new ones arrive or the list
  // reflows. Only a mouse that moved means the user is looking at this one.
  let hovering = false;
  const hover = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || hovering || (!e.movementX && !e.movementY)) return;
    hovering = true;
    o.onEnter();
    const hold = o.onHold();
    if (!hold || o.held()) return;
    setResting(true);
    timer = host().window.setTimeout(() => {
      setResting(false);
      hold();
    }, HOLD_MS);
  };
  const leave = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    hovering = false;
    stop();
    o.onLeave();
  };
  return {
    resting,
    stop,
    on: { onPointerEnter: hover, onPointerMove: hover, onPointerLeave: leave },
  };
}
