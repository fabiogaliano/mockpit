// The decided part of the project as cards, for a tablet held sideways: pages,
// then the components they are made of (what still waits on the user is listed
// above as rows, which swipe to resolve). A card
// pictures the mock's chosen design (else its first) and says how many screens
// and versions it has; a tap opens its place in the tree.

import { createMemo, For, Show } from "solid-js";
import { surfaceUrl, type TreeNode } from "./api.ts";
import { designWidth } from "./canvasLayout.ts";
import { theme } from "./theme.ts";
import { Thumb } from "./Thumb.tsx";

export function TreeCards(props: { nodes: TreeNode[]; onOpen: (slug: string) => void }) {
  const live = createMemo(() =>
    [...props.nodes]
      .filter((n) => !n.resolvedAt)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );
  const groups = createMemo(() =>
    [
      { title: "Pages", nodes: live().filter((n) => n.open === 0 && n.kind === "page") },
      { title: "Components", nodes: live().filter((n) => n.open === 0 && n.kind !== "page") },
    ].filter((g) => g.nodes.length),
  );
  return (
    <div class="tcards">
      <For each={groups()}>
        {(g) => (
          <section class="tcards-group">
            <h3>{g.title}</h3>
            <div class="tcards-grid">
              <For each={g.nodes}>
                {(n) => {
                  const v = () =>
                    n.variants.find((x) => x.status === "accepted" && x.surface >= 0) ??
                    n.variants.find((x) => x.surface >= 0);
                  const versions = () => n.variants.filter((x) => x.status !== "dropped").length;
                  return (
                    <button
                      type="button"
                      class="tcard"
                      data-card={n.slug}
                      onClick={() => props.onOpen(n.slug)}
                    >
                      <span class="tcard-pic">
                        <Show when={v()}>
                          {(x) => (
                            <Thumb
                              src={surfaceUrl(x().postId, x().surface, {
                                version: x().version,
                                mode: theme(),
                                e: x().embedsKey,
                              })}
                              width={designWidth(n)}
                              knobs={n.settled}
                              whole
                            />
                          )}
                        </Show>
                      </span>
                      <span class="tcard-name">
                        <b>{n.title}</b>
                        <Show
                          when={n.open > 0}
                          fallback={
                            <span class="home-done" title="decided">
                              ✓
                            </span>
                          }
                        >
                          <span class="home-chip">
                            <i class="dot" />
                            {`${n.open} open`}
                          </span>
                        </Show>
                      </span>
                      <span class="tcard-sub">
                        {`${n.states.length} ${n.kind === "page" ? "screen" : "look"}${n.states.length === 1 ? "" : "s"} · ${versions()} version${versions() === 1 ? "" : "s"}`}
                        <Show when={n.usedIn.length}>{` · on ${n.usedIn.length}`}</Show>
                      </span>
                    </button>
                  );
                }}
              </For>
            </div>
          </section>
        )}
      </For>
    </div>
  );
}
