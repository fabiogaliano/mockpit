// D8: the frame's "v3 ▾" opens the version list (version · ago · note ·
// author). Picking an older one loads it dimmed under a banner; Esc or a click
// outside closes the list.

import { createMemo, For, onCleanup, onMount } from "solid-js";
import { root } from "./host.ts";
import { timeAgo } from "./logic.ts";
import type { MockScreenState } from "./state.ts";

export function Versions(props: { s: MockScreenState; anchor: HTMLElement | undefined }) {
  const s = props.s;
  let pop!: HTMLDivElement;
  const variant = () => s.activeVariant();
  const rows = createMemo(() => {
    const v = variant();
    if (!v) return [];
    return (
      v.history ?? [{ version: v.version, at: v.updatedAt, prompt: v.prompt, author: v.author }]
    )
      .slice()
      .sort((a, b) => b.version - a.version);
  });
  const shown = () => (variant() ? s.frameVersionOf(variant()!) : 0);

  onMount(() => {
    const doc = root();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") s.setVersionsOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.contains(t) && !props.anchor?.contains(t)) s.setVersionsOpen(false);
    };
    doc.addEventListener("keydown", onKey);
    doc.addEventListener("pointerdown", onDown, true);
    onCleanup(() => {
      doc.removeEventListener("keydown", onKey);
      doc.removeEventListener("pointerdown", onDown, true);
    });
  });

  const left = () => Math.max(0, (props.anchor?.offsetLeft ?? 120) - 8);

  return (
    <div
      class="vpop"
      ref={(el) => (pop = el)}
      role="menu"
      style={{ left: `${left()}px`, top: "40px" }}
    >
      <For each={rows()}>
        {(r) => (
          <button
            type="button"
            role="menuitem"
            class="vrow"
            classList={{ cur: r.version === variant()?.version, on: r.version === shown() }}
            data-version={r.version}
            onClick={() => s.viewOld(r.version === variant()?.version ? s.latest() : r.version)}
          >
            <span class="vv">{`v${r.version}`}</span>
            <span class="vmeta">
              {[timeAgo(r.at), r.prompt || (r.version === 1 ? "first version" : "")]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <span class="vby">{r.author ?? "agent"}</span>
          </button>
        )}
      </For>
    </div>
  );
}
