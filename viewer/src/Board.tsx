// The moodboard: every decision so far, packed tight. One tile per state a
// variant has been accepted for, pictured with everything the user has
// settled (answers and tuning) and with its components as they are now, so the
// board grows as answers arrive and always shows the current whole. Pages
// first, then the components they are built from. A tile opens its mock's
// place in the tree.

import { createMemo, For, Show } from "solid-js";
import { surfaceUrl, type TreeNode, type TreeVariant } from "./api.ts";
import { designWidth } from "./canvasLayout.ts";
import { focusPath, linkClick } from "./route.ts";
import { theme } from "./theme.ts";
import { Thumb } from "./Thumb.tsx";

interface BoardTile {
  node: TreeNode;
  state: string | null;
  variant: TreeVariant;
}

export function Board(props: { project: string; nodes: TreeNode[] }) {
  const ordered = createMemo(() => {
    const byAge = (a: TreeNode, b: TreeNode) => a.createdAt.localeCompare(b.createdAt);
    return [
      ...props.nodes.filter((n) => n.kind === "page").sort(byAge),
      ...props.nodes.filter((n) => n.kind !== "page").sort(byAge),
    ];
  });
  const tiles = createMemo(() => {
    const out: BoardTile[] = [];
    for (const node of ordered()) {
      for (const state of node.states) {
        const variant = node.variants.find((v) => v.state === state && v.status === "accepted");
        if (variant && variant.surface >= 0) out.push({ node, state, variant });
      }
    }
    return out;
  });
  const total = createMemo(() => ordered().reduce((n, m) => n + m.states.length, 0));

  return (
    <div class="mood">
      <p class="home-lead">
        {`${tiles().length} of ${total()} ${total() === 1 ? "state" : "states"} decided`}
      </p>
      <Show
        when={tiles().length}
        fallback={
          <p class="home-empty">Nothing accepted yet. Decisions land here as you send them.</p>
        }
      >
        <div class="mood-grid">
          <For each={tiles()}>
            {(t) => {
              const href = () => focusPath(props.project, t.node.slug);
              const phone = () => designWidth(t.node) < 700;
              return (
                <a
                  class="mood-tile"
                  classList={{ phone: phone() }}
                  href={href()}
                  data-board={`${t.node.slug}${t.state ? `/${t.state}` : ""}`}
                  onClick={(e) => linkClick(e, href())}
                >
                  <Thumb
                    src={surfaceUrl(t.variant.postId, t.variant.surface, {
                      version: t.variant.version,
                      mode: theme(),
                      e: t.variant.embedsKey,
                    })}
                    width={designWidth(t.node)}
                    grow={phone() ? 2.4 : 1.2}
                    knobs={t.node.settled}
                    title={t.node.title}
                  />
                  <span class="mood-cap">
                    <b>{t.node.title}</b>
                    {[t.state, t.variant.variant].filter(Boolean).join(" · ")}
                  </span>
                </a>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
