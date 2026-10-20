// The project tree one level at a time, for a phone where a canvas is too
// small to read: a mock's variants per state (the chosen one first, archived
// and dropped folded away), the components it is built from and the mocks it
// is built into. Tapping a component goes one level down; the breadcrumb goes
// back up. Open takes the mock to its screen.

import { createMemo, createSignal, For, Show } from "solid-js";
import { surfaceUrl, type TreeNode, type TreeVariant } from "./api.ts";
import { designWidth } from "./canvasLayout.ts";
import { mockPath, navigate } from "./route.ts";
import { theme } from "./theme.ts";
import { Thumb } from "./Thumb.tsx";

const rank = (v: TreeVariant) =>
  v.status === "accepted" ? 0 : v.status === "open" ? 1 : v.status === "archived" ? 2 : 3;

export function TreeDrill(props: {
  project: string;
  nodes: TreeNode[];
  start: string;
  onClose: () => void;
}) {
  const [path, setPath] = createSignal<string[]>([props.start]);
  const bySlug = createMemo(() => new Map(props.nodes.map((n) => [n.slug, n])));
  const node = createMemo(() => bySlug().get(path()[path().length - 1]));
  const go = (slug: string) => setPath([...path(), slug]);
  const back = (i: number) => setPath(path().slice(0, i + 1));

  return (
    <div class="drill" role="dialog" aria-modal="true" aria-label="Project tree">
      <nav class="drill-crumbs" aria-label="Breadcrumb">
        <button type="button" class="drill-close" aria-label="Close tree" onClick={props.onClose}>
          ✕
        </button>
        <For each={path()}>
          {(slug, i) => (
            <>
              <span class="sep">›</span>
              <button
                type="button"
                aria-current={i() === path().length - 1 ? "page" : undefined}
                onClick={() => back(i())}
              >
                {bySlug().get(slug)?.title ?? slug}
              </button>
            </>
          )}
        </For>
      </nav>
      <Show when={node()}>
        {(n) => (
          <div class="drill-body">
            <header class="drill-head">
              <h2>{n().title}</h2>
              <span class="pc-kind">{n().kind}</span>
              <button
                type="button"
                class="drill-open"
                onClick={() => navigate(mockPath(props.project, n().slug))}
              >
                Open ›
              </button>
            </header>
            <For each={n().states}>
              {(state) => {
                const inState = () =>
                  n()
                    .variants.filter((v) => v.state === state)
                    .sort((a, b) => rank(a) - rank(b));
                const live = () => inState().filter((v) => rank(v) < 2);
                const archived = () => inState().filter((v) => v.status === "archived");
                const dropped = () => inState().filter((v) => v.status === "dropped");
                return (
                  <section class="drill-state">
                    <Show when={n().states.length > 1}>
                      <h3>{state}</h3>
                    </Show>
                    <For each={live()}>{(v) => <VariantRow node={n()} v={v} />}</For>
                    <Show when={archived().length}>
                      <details class="drill-fold">
                        <summary>{`Archived (${archived().length})`}</summary>
                        <For each={archived()}>{(v) => <VariantRow node={n()} v={v} />}</For>
                      </details>
                    </Show>
                    <Show when={dropped().length}>
                      <details class="drill-fold">
                        <summary>{`Dropped (${dropped().length})`}</summary>
                        <For each={dropped()}>{(v) => <VariantRow node={n()} v={v} />}</For>
                      </details>
                    </Show>
                  </section>
                );
              }}
            </For>
            <Links title="Built from" slugs={n().uses} nodes={bySlug()} onGo={go} />
            <Links title="Used in" slugs={n().usedIn} nodes={bySlug()} onGo={go} />
          </div>
        )}
      </Show>
    </div>
  );
}

function VariantRow(props: { node: TreeNode; v: TreeVariant }) {
  return (
    <div
      class="drill-row"
      classList={{ muted: props.v.status === "archived" || props.v.status === "dropped" }}
    >
      <div class="drill-thumb">
        <Show when={props.v.surface >= 0}>
          <Thumb
            src={surfaceUrl(props.v.postId, props.v.surface, {
              version: props.v.version,
              mode: theme(),
              e: props.v.embedsKey,
            })}
            width={designWidth(props.node)}
            knobs={props.node.settled}
          />
        </Show>
      </div>
      <div class="drill-text">
        <span class="drill-name">
          {props.v.variant}
          <Show when={props.v.status === "accepted"}>
            <span class="vok" aria-label="accepted">
              ✓
            </span>
          </Show>
        </span>
        <span class="drill-sub">
          {[
            props.v.status,
            `v${props.v.version}`,
            props.v.forkedFrom && `from ${props.v.forkedFrom.variant}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
    </div>
  );
}

function Links(props: {
  title: string;
  slugs: string[];
  nodes: Map<string, TreeNode>;
  onGo: (slug: string) => void;
}) {
  return (
    <Show when={props.slugs.length}>
      <section class="drill-links">
        <h3>{props.title}</h3>
        <For each={props.slugs}>
          {(slug) => (
            <button type="button" class="drill-link" onClick={() => props.onGo(slug)}>
              <span>{props.nodes.get(slug)?.title ?? slug}</span>
              <span class="drill-chev" aria-hidden="true">
                ›
              </span>
            </button>
          )}
        </For>
      </section>
    </Show>
  );
}
