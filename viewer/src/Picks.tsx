// Picks: every decision so far, one row per mock with its states in order and
// how many are decided, each pictured with everything the user has settled
// (answers and tuning) and with its components as they are now, so the view
// grows as answers arrive. Starred shows the favourites instead. A tile opens
// its mock on that state and variant.

import { createMemo, createSignal, For, Show } from "solid-js";
import { surfaceUrl, type TreeNode, type TreeVariant } from "./api.ts";
import { designWidth } from "./canvasLayout.ts";
import { linkClick, mockPath } from "./route.ts";
import { theme } from "./theme.ts";
import { Thumb } from "./Thumb.tsx";

export function Picks(props: { project: string; nodes: TreeNode[] }) {
  const [starred, setStarred] = createSignal(false);
  const pick = (v: TreeVariant) => (starred() ? !!v.starred : v.status === "accepted");
  const groups = createMemo(() => {
    const byAge = (a: TreeNode, b: TreeNode) => a.createdAt.localeCompare(b.createdAt);
    return [
      ...props.nodes.filter((n) => n.kind === "page").sort(byAge),
      ...props.nodes.filter((n) => n.kind !== "page").sort(byAge),
    ]
      .map((node) => ({
        node,
        decided: node.states.filter((s) =>
          node.variants.some((v) => v.state === s && v.status === "accepted"),
        ).length,
        tiles: node.variants.filter((v) => v.surface >= 0 && pick(v)),
      }))
      .filter((g) => g.tiles.length);
  });
  const total = createMemo(() => props.nodes.reduce((n, m) => n + m.states.length, 0));
  const decided = createMemo(() =>
    props.nodes.reduce(
      (n, m) =>
        n +
        m.states.filter((s) => m.variants.some((v) => v.state === s && v.status === "accepted"))
          .length,
      0,
    ),
  );

  return (
    <div class="mood">
      <div class="mood-head">
        <p class="home-lead">{`${decided()} of ${total()} states decided`}</p>
        <div class="vseg" role="group" aria-label="Show">
          <button type="button" aria-pressed={!starred()} onClick={() => setStarred(false)}>
            Chosen
          </button>
          <button type="button" aria-pressed={starred()} onClick={() => setStarred(true)}>
            ★ Starred
          </button>
        </div>
      </div>
      <Show
        when={groups().length}
        fallback={
          <p class="home-empty">
            {starred()
              ? "Nothing starred yet. Star a variant from its stage or the Library."
              : "Nothing chosen yet. Decisions land here as you send them."}
          </p>
        }
      >
        <For each={groups()}>
          {(g) => (
            <section class="mood-group" data-pick={g.node.slug}>
              <header class="mood-group-head">
                <a
                  href={mockPath(props.project, g.node.slug)}
                  onClick={(e) => linkClick(e, mockPath(props.project, g.node.slug))}
                >
                  {g.node.title}
                </a>
                <span class="pc-kind">{`${g.decided} of ${g.node.states.length} decided`}</span>
              </header>
              <div class="mood-row">
                <For each={g.tiles}>
                  {(v) => {
                    const href = () =>
                      mockPath(props.project, g.node.slug, { state: v.state, variant: v.variant });
                    const phone = () => designWidth(g.node) < 700;
                    return (
                      <a
                        class="mood-tile"
                        classList={{ phone: phone() }}
                        href={href()}
                        onClick={(e) => linkClick(e, href())}
                      >
                        <span class="mood-cap">
                          {[v.state, v.variant].filter(Boolean).join(" · ")}
                        </span>
                        <Thumb
                          src={surfaceUrl(v.postId, v.surface, {
                            version: v.version,
                            mode: theme(),
                            e: v.embedsKey,
                          })}
                          width={designWidth(g.node)}
                          grow={phone() ? 2.4 : 1.2}
                          knobs={g.node.settled}
                          title={g.node.title}
                        />
                      </a>
                    );
                  }}
                </For>
              </div>
            </section>
          )}
        </For>
      </Show>
    </div>
  );
}
