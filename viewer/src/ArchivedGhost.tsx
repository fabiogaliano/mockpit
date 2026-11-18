// What was just archived, said where it was: a dashed row in the list of alternatives and a
// dashed card among the answers, each with a reason to add and Undo, for a few seconds. It
// stays while the pointer or focus is on it, so it never leaves from under a click.

import { createMemo, onCleanup, onMount } from "solid-js";
import { Reason } from "./Reason.tsx";
import type { DesignScreenState } from "./state.ts";

export interface GhostLine {
  label: string;
  // The frames that went, and the answer when it was archived from its card.
  frames: { state: string | null; alternative: string }[];
  answer?: { ask: string; option: string };
  undo: () => void;
  saveReason: (reason: string | null) => void;
}

// Long enough to read it and reach for Undo.
export const GHOST_MS = 5000;

// Mounted only where its place is on screen: the count tells the state whether any is.
export function ArchivedGhost(props: { s: DesignScreenState; line: GhostLine; card?: boolean }) {
  const s = props.s;
  // The ghost is cleared a beat before its place unmounts: keep the last line till then.
  const line = createMemo<GhostLine>((was) => props.line ?? was, props.line);
  onMount(() => s.ghostPlace(1));
  onCleanup(() => {
    s.ghostPlace(-1);
    s.holdGhost(false);
  });
  return (
    <div
      class="ghost"
      classList={{ card: !!props.card }}
      role="status"
      onPointerEnter={() => s.holdGhost(true)}
      onPointerLeave={() => s.holdGhost(false)}
      onFocusIn={() => s.holdGhost(true)}
      onFocusOut={() => s.holdGhost(false)}
    >
      <span class="ghost-text">{`Archived ${line().label}`}</span>
      <span class="ghost-acts">
        <Reason value={null} onSave={(why) => line().saveReason(why)} />
        <button type="button" class="toast-undo" onClick={() => line().undo()}>
          Undo
        </button>
      </span>
    </div>
  );
}
