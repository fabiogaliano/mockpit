// The last Send, carried to the next mock: Send moves the user on, and its
// Delivered / Not seen yet must stay in sight there, or a reply the agent never
// picked up goes unnoticed. Lives outside any one screen, since the screen that
// sent it is gone by then.

import { createEffect, createSignal, on, onCleanup } from "solid-js";
import { api, subscribe } from "./api.ts";

export interface Carried {
  project: string;
  slug: string;
  title: string;
  mockId: string;
  replyId: string;
}

const [carried, setCarriedSignal] = createSignal<Carried | null>(null);
const [delivered, setDelivered] = createSignal(false);
export { carried };

export function setCarried(c: Carried | null) {
  setDelivered(false);
  setCarriedSignal(c);
}

// Whether the carried reply has reached the agent, kept fresh from the live
// feed while a screen shows it.
export function useCarriedDelivery(): () => boolean {
  const load = async () => {
    const c = carried();
    if (!c) return;
    const { comments } = await api.comments(c.mockId).catch(() => ({ comments: [] }));
    // The carried reply may have been replaced while this was in flight.
    if (carried() === c) setDelivered(!!comments.find((x) => x.id === c.replyId)?.delivered);
  };
  createEffect(on(carried, () => void load()));
  const stop = subscribe(
    (e) => {
      if (e.type === "comment-delivered" || e.type === "comment-deleted") void load();
    },
    () => void load(),
  );
  onCleanup(stop);
  return delivered;
}
