// Focus's copy of the design as the server last sent it, and what follows from that
// alone: its alternatives (an archive on its way already counted), its states and its
// newest version. The view (what is on stage) and the draft live in state.ts.

import { createMemo, createSignal } from "solid-js";
import type { DesignDetail } from "./api.ts";
import { designVersion, keepSame } from "./logic.ts";

export function createDesignData() {
  const [design, putDesign] = createSignal<DesignDetail | null>(null);
  const setDesign = (m: DesignDetail) =>
    putDesign((was) =>
      was ? { ...m, alternatives: keepSame(was.alternatives, m.alternatives, (v) => v.postId) } : m,
    );
  const [missing, setMissing] = createSignal(false);

  // Archives on their way: an alternative leaves the screen on the click rather than
  // when the server has answered, and a read that crosses the write can't bring
  // it back.
  const [archiving, setArchiving] = createSignal<ReadonlySet<string>>(new Set());
  const archiveKey = (state: string | null, alternative: string) =>
    JSON.stringify([state, alternative]);
  const alternatives = createMemo(() => {
    const going = archiving();
    const all = design()?.alternatives ?? [];
    if (!going.size) return all;
    return all.map((v) =>
      going.has(archiveKey(v.state, v.alternative)) ? { ...v, status: "archived" as const } : v,
    );
  });
  const states = createMemo<(string | null)[]>(() => {
    const m = design();
    return m && m.states.length ? m.states : [null];
  });
  const latest = createMemo(() => designVersion(alternatives()));
  const inState = (state: string | null) => alternatives().filter((v) => v.state === state);

  return {
    design,
    setDesign,
    missing,
    setMissing,
    archiving,
    setArchiving,
    archiveKey,
    alternatives,
    states,
    latest,
    inState,
  };
}

export type DesignData = ReturnType<typeof createDesignData>;
