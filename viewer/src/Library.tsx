// Every mock and all its variants, one row per mock (per state when it has
// several): each variant pictured whole, with its status, version, lineage and
// star. Filters narrow to pages or components, starred, or one status. A
// variant opens its mock on that state and variant; the star marks a favourite
// without deciding anything.

import { createMemo, createSignal, For, Show } from "solid-js";
import type { PostStatus } from "../../server/types.ts";
import { api, surfaceUrl, type TreeNode, type TreeVariant } from "./api.ts";
import { designWidth } from "./canvasLayout.ts";
import { readonly } from "./host.ts";
import { linkClick, mockPath } from "./route.ts";
import { StatusChip } from "./StatusChip.tsx";
import { theme } from "./theme.ts";
import { Thumb } from "./Thumb.tsx";

type Kind = "all" | "page" | "component";
type Status = "live" | PostStatus;

const STATUSES: { id: Status; label: string }[] = [
  { id: "live", label: "Open and chosen" },
  { id: "accepted", label: "Chosen" },
  { id: "open", label: "Open" },
  { id: "archived", label: "Archived" },
  { id: "dropped", label: "Dropped" },
];

export function Library(props: { project: string; nodes: TreeNode[]; onChanged: () => void }) {
  const [kind, setKind] = createSignal<Kind>("all");
  const [starredOnly, setStarredOnly] = createSignal(false);
  const [status, setStatus] = createSignal<Status>("live");
  const keep = (v: TreeVariant) =>
    (status() === "live"
      ? v.status === "open" || v.status === "accepted"
      : v.status === status()) &&
    (!starredOnly() || !!v.starred);
  const rows = createMemo(() =>
    [...props.nodes]
      .filter((n) => kind() === "all" || n.kind === kind())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((node) => ({
        node,
        states: node.states
          .map((state) => ({
            state,
            variants: node.variants.filter((v) => v.state === state && keep(v)),
          }))
          .filter((s) => s.variants.length),
      }))
      .filter((r) => r.states.length),
  );
  const star = async (node: TreeNode, v: TreeVariant) => {
    await api.star(node.id, v.state, v.variant, !v.starred);
    props.onChanged();
  };

  return (
    <div class="lib">
      <nav class="lib-filters" aria-label="Filter">
        <div class="vseg" role="group" aria-label="Kind">
          <For each={["all", "page", "component"] as Kind[]}>
            {(k) => (
              <button type="button" aria-pressed={kind() === k} onClick={() => setKind(k)}>
                {k === "all" ? "All" : k === "page" ? "Pages" : "Components"}
              </button>
            )}
          </For>
        </div>
        <button
          type="button"
          class="lib-starred"
          aria-pressed={starredOnly()}
          onClick={() => setStarredOnly(!starredOnly())}
        >
          ★ Starred
        </button>
        <label class="lib-status">
          <span class="sr-only">Status</span>
          <select value={status()} onChange={(e) => setStatus(e.currentTarget.value as Status)}>
            <For each={STATUSES}>{(s) => <option value={s.id}>{s.label}</option>}</For>
          </select>
        </label>
      </nav>
      <Show when={rows().length} fallback={<p class="home-empty">Nothing matches.</p>}>
        <For each={rows()}>
          {(r) => (
            <section class="lib-mock" data-lib={r.node.slug}>
              <header class="lib-head">
                <a
                  href={mockPath(props.project, r.node.slug)}
                  onClick={(e) => linkClick(e, mockPath(props.project, r.node.slug))}
                >
                  {r.node.title}
                </a>
                <span class="pc-kind">{r.node.kind}</span>
                <Show when={r.node.open > 0}>
                  <span class="home-chip">
                    <i class="dot" />
                    {`${r.node.open} open`}
                  </span>
                </Show>
                <Show when={r.node.usedIn.length}>
                  <span class="pc-used">{`used in ${r.node.usedIn.length}`}</span>
                </Show>
              </header>
              <div class="lib-states">
                <For each={r.states}>
                  {(st) => (
                    <div class="lib-state">
                      <Show when={r.node.states.length > 1}>
                        <span class="lib-state-name">{st.state}</span>
                      </Show>
                      <div class="lib-strip">
                        <For each={st.variants}>
                          {(v) => {
                            const href = () =>
                              mockPath(props.project, r.node.slug, {
                                state: v.state,
                                variant: v.variant,
                              });
                            return (
                              <div class="lib-variant" data-variant={v.variant}>
                                <a
                                  class="lib-thumb"
                                  href={href()}
                                  onClick={(e) => linkClick(e, href())}
                                  aria-label={`Open ${r.node.title} · ${v.variant}`}
                                >
                                  <Show when={v.surface >= 0}>
                                    <Thumb
                                      src={surfaceUrl(v.postId, v.surface, {
                                        version: v.version,
                                        mode: theme(),
                                        e: v.embedsKey,
                                      })}
                                      width={designWidth(r.node)}
                                      knobs={r.node.settled}
                                      whole
                                    />
                                  </Show>
                                </a>
                                <div class="lib-meta">
                                  <Show
                                    when={!readonly()}
                                    fallback={<span>{v.starred ? "★" : ""}</span>}
                                  >
                                    <button
                                      type="button"
                                      class="starbtn"
                                      classList={{ on: !!v.starred }}
                                      aria-pressed={!!v.starred}
                                      aria-label={
                                        v.starred ? `Unstar ${v.variant}` : `Star ${v.variant}`
                                      }
                                      onClick={() => void star(r.node, v)}
                                    >
                                      {v.starred ? "★" : "☆"}
                                    </button>
                                  </Show>
                                  <span class="lib-name">{v.variant}</span>
                                  <span class="lib-faint">{`v${v.version}`}</span>
                                </div>
                                <div class="lib-meta">
                                  <StatusChip status={v.status} />
                                  <Show when={v.forkedFrom}>
                                    {(f) => <span class="lib-faint">{`from ${f().variant}`}</span>}
                                  </Show>
                                </div>
                              </div>
                            );
                          }}
                        </For>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </section>
          )}
        </For>
      </Show>
    </div>
  );
}
