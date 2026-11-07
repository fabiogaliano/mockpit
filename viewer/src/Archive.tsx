// What has left the shelf, under the day it went: things go in batches, so a batch
// is what's remembered, and one reason or one Restore can speak for it. A picture on
// each, because a name alone doesn't say what the thing was.

import { createMemo, For, Show } from "solid-js";
import type { TreeNode } from "./api.ts";
import { albumPicture, bothWidths, byDay, plural, sectionOf, SECTION_LABEL } from "./albums.ts";
import { Picture } from "./Album.tsx";
import { readonly } from "./host.ts";
import { designWidth } from "./logic.ts";
import { Reason } from "./Reason.tsx";
import { linkClick, designPath } from "./route.ts";

const WIDE_FROM = 700;

const SINGULAR: Record<string, string> = {
  Ideas: "idea",
  Screens: "screen",
  Components: "component",
  Documents: "document",
};

// "9 ideas", or "6 ideas, 2 screens": what the group is, in Home's own words.
function kinds(nodes: TreeNode[]): string {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const label = SECTION_LABEL[sectionOf(n)];
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, n]) => plural(n, SINGULAR[label] ?? label)).join(", ");
}

export function Archive(props: {
  project: string;
  nodes: TreeNode[];
  fresh: Set<string>;
  onRestore: (nodes: TreeNode[]) => void;
  onReason: (nodes: TreeNode[], reason: string | null) => void;
}) {
  const days = createMemo(() =>
    byDay(
      props.nodes,
      (n) => n.leftAt,
      (n) => n.id,
    ),
  );
  return (
    <div class="arch">
      <For each={days()}>
        {(day) => {
          const nodes = () => day.rows;
          const reasons = () => nodes().map((n) => n.archiveReason ?? null);
          const same = () => reasons().every((r) => r === reasons()[0]);
          const unopened = () => nodes().filter((n) => props.fresh.has(n.id)).length;
          const areas = () => [...new Set(nodes().flatMap((n) => (n.area ? [n.area] : [])))];
          const alternatives = () => nodes().reduce((sum, n) => sum + n.alternatives.length, 0);
          const emptyLabel = () =>
            nodes().length === 1
              ? "Add a reason"
              : same()
                ? `Add one reason for all ${nodes().length}`
                : `Reasons differ. Add one for all ${nodes().length}`;
          return (
            <section class="arch-day" aria-label={day.label}>
              <div class="arch-head">
                <h2>{day.label}</h2>
                <p class="arch-sum">
                  {[kinds(nodes()), plural(alternatives(), "alternative"), areas().join(", ")]
                    .filter(Boolean)
                    .join(" · ")}
                  <Show when={unopened() > 0}>
                    <span class="arch-unopened">
                      {" · "}
                      <i aria-hidden="true" />
                      {unopened() === nodes().length && nodes().length > 1
                        ? `All ${unopened()} not opened`
                        : unopened() === 1 && nodes().length === 1
                          ? "Not opened"
                          : `${unopened()} not opened`}
                    </span>
                  </Show>
                </p>
                <div class="arch-why">
                  <Reason
                    value={same() ? reasons()[0] : null}
                    empty={emptyLabel()}
                    onSave={(r) => props.onReason(nodes(), r)}
                  />
                </div>
                <Show when={nodes().length > 1 && !readonly()}>
                  <button
                    type="button"
                    class="btn arch-all"
                    onClick={() => props.onRestore(nodes())}
                  >
                    {`Restore all ${nodes().length}`}
                  </button>
                </Show>
              </div>
              <div class="arch-tiles">
                <For each={nodes()}>
                  {(n) => (
                    <Tile
                      project={props.project}
                      node={n}
                      fresh={props.fresh.has(n.id)}
                      reason={same() ? null : (n.archiveReason ?? null)}
                      onRestore={() => props.onRestore([n])}
                    />
                  )}
                </For>
              </div>
            </section>
          );
        }}
      </For>
    </div>
  );
}

function Tile(props: {
  project: string;
  node: TreeNode;
  fresh: boolean;
  reason: string | null;
  onRestore: () => void;
}) {
  const n = () => props.node;
  const pic = createMemo(() => albumPicture(n()));
  const width = () => bothWidths(n())?.wide ?? designWidth(n());
  const part = () => n().kind === "component";
  const href = () => designPath(props.project, n().slug);
  return (
    <article class="arch-tile" classList={{ wide: part() || width() >= WIDE_FROM }}>
      <a
        class="home-pic arch-cover"
        href={href()}
        tabIndex={-1}
        aria-hidden="true"
        onClick={(e) => linkClick(e, href())}
      >
        <Show when={pic()}>{(p) => <Picture pic={p()} width={width()} whole={part()} />}</Show>
      </a>
      <Show when={!readonly()}>
        <button
          type="button"
          class="btn arch-restore"
          aria-label={`Restore ${n().title}`}
          onClick={props.onRestore}
        >
          Restore
        </button>
      </Show>
      <a class="arch-title" href={href()} onClick={(e) => linkClick(e, href())}>
        <Show when={props.fresh}>
          <i class="arch-dot" role="img" aria-label="Not opened" title="Not opened" />
        </Show>
        {n().title}
      </a>
      <span class="arch-inside">{plural(n().alternatives.length, "alternative")}</span>
      <Show when={props.reason}>{(r) => <span class="arch-said">{r()}</span>}</Show>
    </article>
  );
}
