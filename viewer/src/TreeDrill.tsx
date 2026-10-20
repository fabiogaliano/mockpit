// One mock's place in the tree, for a phone or a tablet: each of its screens
// (states; a component's looks) as a strip of its versions, pictured whole with
// status and star; then the components it is made of and the pages it appears
// on, as pictures that go one level deeper. The breadcrumb goes back up; Open
// takes the mock to its screen.

import { createMemo, createSignal, For, Show } from "solid-js";
import { surfaceUrl, type TreeNode, type TreeVariant } from "./api.ts";
import { designWidth } from "./canvasLayout.ts";
import { mockPath, navigate } from "./route.ts";
import { theme } from "./theme.ts";
import { Thumb } from "./Thumb.tsx";
import { VariantCard } from "./VariantCard.tsx";

const rank = (v: TreeVariant) =>
  v.status === "accepted" ? 0 : v.status === "open" ? 1 : v.status === "archived" ? 2 : 3;

export function TreeDrill(props: {
  project: string;
  nodes: TreeNode[];
  start: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [path, setPath] = createSignal<string[]>([props.start]);
  const bySlug = createMemo(() => new Map(props.nodes.map((n) => [n.slug, n])));
  const node = createMemo(() => bySlug().get(path()[path().length - 1]));
  const go = (slug: string) => setPath([...path(), slug]);
  const back = (i: number) => setPath(path().slice(0, i + 1));
  const summary = (n: TreeNode) => {
    const total = n.states.length;
    const decided = n.states.filter((s) =>
      n.variants.some((v) => v.state === s && v.status === "accepted"),
    ).length;
    const word = `${total} ${n.kind === "page" ? "screen" : "look"}${total === 1 ? "" : "s"}`;
    return `${word} · ${decided === total ? "all decided" : `${total - decided} to decide`}`;
  };

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
              <div class="drill-title">
                <h2>{n().title}</h2>
                <span class="drill-sum">{summary(n())}</span>
              </div>
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
                const versions = () =>
                  n()
                    .variants.filter((v) => v.state === state && v.status !== "dropped")
                    .sort((a, b) => rank(a) - rank(b));
                return (
                  <section class="drill-state">
                    <Show when={state !== null}>
                      <h3>{state}</h3>
                    </Show>
                    <div class="lib-strip">
                      <For each={versions()}>
                        {(v) => (
                          <VariantCard
                            project={props.project}
                            node={n()}
                            v={v}
                            onChanged={props.onChanged}
                          />
                        )}
                      </For>
                    </div>
                  </section>
                );
              }}
            </For>
            <Links
              title={`Components in this ${n().kind}`}
              slugs={n().uses}
              nodes={bySlug()}
              onGo={go}
            />
            <Links title="Appears on" slugs={n().usedIn} nodes={bySlug()} onGo={go} />
          </div>
        )}
      </Show>
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
        <div class="drill-comps">
          <For each={props.slugs}>
            {(slug) => {
              const n = () => props.nodes.get(slug);
              const v = () =>
                n()?.variants.find((x) => x.status === "accepted" && x.surface >= 0) ??
                n()?.variants.find((x) => x.surface >= 0);
              return (
                <button type="button" class="drill-comp" onClick={() => props.onGo(slug)}>
                  <span class="drill-comp-pic">
                    <Show when={n() && v()}>
                      <Thumb
                        src={surfaceUrl(v()!.postId, v()!.surface, {
                          version: v()!.version,
                          mode: theme(),
                          e: v()!.embedsKey,
                        })}
                        width={designWidth(n()!)}
                        knobs={n()!.settled}
                        whole
                      />
                    </Show>
                  </span>
                  <span>{n()?.title ?? slug}</span>
                </button>
              );
            }}
          </For>
        </div>
      </section>
    </Show>
  );
}
