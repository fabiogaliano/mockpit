// The last Send, carried to the next design: Send moves the user on, and its
// Delivered / Not seen yet must stay in sight there, or a reply the agent never
// picked up goes unnoticed. Lives outside any one screen, since the screen that
// sent it is gone by then.

import { createEffect, createSignal, on, onCleanup } from "solid-js";
import { api, subscribe } from "./api.ts";

// How long a Send gets to reach a live agent before the user is offered a way to
// wake it. A held watch takes it in moments; this only has to outlast a slow network.
export const BEAT_MS = 4000;

export interface Carried {
  project: string;
  slug: string;
  title: string;
  designId: string;
  replyId: string;
}

const [carried, setCarriedSignal] = createSignal<Carried | null>(null);
const [delivered, setDelivered] = createSignal(false);
const [listening, setListening] = createSignal(false);
export { carried };

export function setCarried(c: Carried | null) {
  setDelivered(false);
  setListening(false);
  setCarriedSignal(c);
}

// Whether the carried reply has reached the agent, and whether a watcher is there to
// take it, kept fresh from the live feed while a screen shows it.
export function useCarriedDelivery() {
  const load = async () => {
    const c = carried();
    if (!c) return;
    const { comments } = await api.comments(c.designId).catch(() => ({ comments: [] }));
    // The carried reply may have been replaced while this was in flight.
    if (carried() !== c) return;
    const row = comments.find((x) => x.id === c.replyId);
    setDelivered(!!row?.delivered);
    setListening(!!row?.listening);
  };
  createEffect(on(carried, () => void load()));
  const stop = subscribe(
    (e) => {
      if (e.type === "comment-delivered" || e.type === "comment-deleted") void load();
    },
    () => void load(),
  );
  onCleanup(stop);
  return { delivered, listening, reload: load };
}
