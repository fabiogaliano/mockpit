// Built from: the side drawer (a bottom sheet on a phone). What this state
// embeds, each row opening that component; its parts, each opening its knobs
// (tunekit, see tune.ts) with what is tuned riding in the next answer; and the
// mock's other states. A component's screen says where it is used instead.

import { createEffect, createMemo, createResource, For, Index, on, Show } from "solid-js";
import { api, surfaceUrl, type TreeNode } from "./api.ts";
import { host } from "./host.ts";
import { Icon } from "./icons.tsx";
import { designWidth, screenPicture, versionName } from "./logic.ts";
import { linkClick, mockPath } from "./route.ts";
import type { MockScreenState } from "./state.ts";
import { theme } from "./theme.ts";
import { Thumb } from "./Thumb.tsx";
import type { TuneState } from "./tune.ts";
import { phoneLayout } from "./viewport.ts";

// A tree node's design in use (else its newest live one), as a picture.
function nodePicture(node: TreeNode): string | null {
  const pic = screenPicture(node, node.inUse[0]?.state ?? node.states[0] ?? null);
  return pic
    ? surfaceUrl(pic.postId, pic.surface, { version: pic.version, mode: theme(), e: pic.embedsKey })
    : null;
}

export function BuiltFrom(props: { s: MockScreenState; t: TuneState }) {
  const s = props.s;
  const t = props.t;
  const project = () => s.mock()?.project ?? s.project;
  // Refetched whenever the mock changes, so a newly embedded component shows.
  const [tree] = createResource(
    () => (s.drawer() ? `${project()}\u0000${s.mock()?.updatedAt ?? ""}` : null),
    () => api.tree(project()).then((r) => r.tree),
  );
  const bySlug = createMemo(() => new Map((tree() ?? []).map((n) => [n.slug, n])));
  const me = () => bySlug().get(s.slug);
  const component = () => s.mock()?.kind === "component";
  const uses = () => (me()?.uses ?? []).flatMap((slug) => bySlug().get(slug) ?? []);
  const usedIn = () => (me()?.usedIn ?? []).flatMap((slug) => bySlug().get(slug) ?? []);
  const parts = () =>
    t.components().filter((c) => c.paths.length || s.mixOpts().some((o) => o.part === c.part));
  const tuned = () => Object.keys(s.draft()?.tuned ?? {}).length;
  const others = () => s.states().filter((st) => st !== s.activeState());
  let panel!: HTMLElement;
  // A part tapped with Tune on opens here, scrolled into view.
  createEffect(
    on(
      () => [s.drawer(), s.tuneOpen()] as const,
      ([open, part]) => {
        if (!open || part === false) return;
        host().window.requestAnimationFrame(() =>
          panel
            ?.querySelector(`[data-tune-part="${CSS.escape(part ?? "")}"]`)
            ?.scrollIntoView({ block: "nearest" }),
        );
      },
    ),
  );
  const close = () => s.setDrawer(false);
  const go = (slug: string) => mockPath(project(), slug);
  return (
    <aside
      class="drawer"
      classList={{ open: s.drawer() }}
      aria-label={component() ? "Appears in" : "Built from"}
      aria-hidden={!s.drawer()}
      inert={!s.drawer() || undefined}
      ref={(el) => (panel = el)}
    >
      <div class="dhead">
        <h2>{component() ? "Appears in" : "Built from"}</h2>
        <button type="button" class="ib" aria-label="Close" onClick={close}>
          <Icon name="close" />
        </button>
      </div>
      <Show when={component()}>
        <section>
          <Show
            when={usedIn().length}
            fallback={<p class="dnote">No mock embeds this component yet.</p>}
          >
            <div class="minis">
              <For each={usedIn()}>
                {(n) => (
                  <a class="mini" href={go(n.slug)} onClick={(e) => linkClick(e, go(n.slug))}>
                    <Show when={nodePicture(n)}>
                      {(u) => (
                        <Thumb src={u()} width={designWidth(n)} class="mini-thumb" fit whole />
                      )}
                    </Show>
                    <span>{n.title}</span>
                  </a>
                )}
              </For>
            </div>
          </Show>
        </section>
      </Show>
      <Show when={uses().length}>
        <section>
          <h3>Components</h3>
          <div class="chips">
            <For each={uses()}>
              {(n) => {
                const part = () => parts().find((c) => c.part === n.slug);
                return (
                  <div class="crow" classList={{ open: !!part() && s.tuneOpen() === n.slug }}>
                    <div class="chead">
                      <a class="chip" href={go(n.slug)} onClick={(e) => linkClick(e, go(n.slug))}>
                        <Show when={nodePicture(n)}>
                          {(u) => (
                            <Thumb src={u()} width={designWidth(n)} class="chip-thumb" fit whole />
                          )}
                        </Show>
                        <span>
                          <span class="nm">{n.title}</span>
                          <span class="sm">
                            {n.inUse[0]
                              ? `${versionName(
                                  n.inUse[0],
                                  n.variants.filter((v) => v.state === n.inUse[0].state).length > 1,
                                )} in use`
                              : `${n.variants.length} variants`}
                          </span>
                        </span>
                      </a>
                      <Show when={part()}>
                        {(c) => <PartToggle s={s} part={c().part} label={n.title} />}
                      </Show>
                    </div>
                    <Show when={part() && s.tuneOpen() === n.slug}>
                      <PartKnobs s={s} part={n.slug} />
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </section>
      </Show>
      <Show when={parts().length}>
        <section>
          <h3>Parts</h3>
          <Show when={tuned()}>
            <div class="tunedbar" role="status">
              <span>{`${tuned()} tuned · goes with your next answer`}</span>
              <button type="button" onClick={() => s.replaceTuned({})}>
                Reset
              </button>
            </div>
          </Show>
          <div class="chips">
            {/* By part name: the components are rebuilt on every parts report,
                and remounting a row would move the knobs out from under the pointer. */}
            <For each={parts().map((c) => c.part)}>
              {(part) => {
                const c = () =>
                  parts().find((x) => x.part === part) ?? { part, label: part ?? "", paths: [] };
                return (
                  <div
                    class="crow"
                    classList={{ open: s.tuneOpen() === part }}
                    data-tune-part={part ?? ""}
                  >
                    <div class="chead">
                      <span class="chip">
                        <span class="nm">{c().label}</span>
                        <Show when={t.tunedIn(c())}>
                          <span class="sm">tuned</span>
                        </Show>
                      </span>
                      <PartToggle s={s} part={part} label={c().label} />
                    </div>
                    <Show when={s.tuneOpen() === part}>
                      <PartKnobs s={s} part={part} />
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </section>
      </Show>
      <Show when={others().length}>
        <section>
          <h3>{`${s.mock()?.title ?? ""} · other states`}</h3>
          <div class="minis">
            <For each={others()}>
              {(st) => {
                const src = () => {
                  const v = s.variantFor(st, false);
                  const i = v?.surfaces.findIndex((x) => x.kind === "html") ?? -1;
                  return v && i >= 0
                    ? surfaceUrl(v.postId, i, {
                        version: s.frameVersionOf(v),
                        mode: theme(),
                        e: v.embedsKey,
                      })
                    : null;
                };
                return (
                  <button
                    type="button"
                    class="mini"
                    onClick={() => {
                      s.showState(st);
                      if (phoneLayout()) close();
                    }}
                  >
                    <Show when={src()} fallback={<span class="mini-blank" />}>
                      {(u) => <Thumb src={u()} width={s.frameW()} class="mini-thumb" fit whole />}
                    </Show>
                    <span>{st}</span>
                  </button>
                );
              }}
            </For>
          </div>
        </section>
      </Show>
    </aside>
  );
}

function PartToggle(props: { s: MockScreenState; part: string | null; label: string }) {
  const open = () => props.s.tuneOpen() === props.part;
  return (
    <button
      type="button"
      class="ib tog"
      aria-expanded={open()}
      aria-label={`Tune ${props.label}`}
      onClick={() => props.s.openTune(open() ? false : props.part)}
    >
      <Icon name="down" />
    </button>
  );
}

// The open part's knobs: tunekit's pane moves in here, then any borrow from
// another look.
function PartKnobs(props: { s: MockScreenState; part: string | null }) {
  const s = props.s;
  const borrow = () => s.mixOpts().filter((o) => o.part === props.part);
  return (
    <div class="knobs">
      <div class="tune-knobs" ref={(el) => s.setTuneHost(el)} />
      {/* By position: the options are rebuilt on every parts report, and a
          row remounted under the pointer would lose its hover. */}
      <Index each={borrow()}>
        {(o) => {
          const on = () => s.draft()?.mix[o().part] === o().variant;
          return (
            <button
              type="button"
              class="borrow-row"
              classList={{ on: on() }}
              aria-pressed={on()}
              onMouseEnter={() =>
                s.setPreview({
                  key: `mix:${o().part}:${o().variant}`,
                  variant: o().variant,
                  part: o().part,
                })
              }
              onMouseLeave={() => s.setPreview(null)}
              onClick={() => s.toggleMix(o())}
            >
              <span>{`${o().part} as in ${o().variant}`}</span>
              <span class="borrow-act">{on() ? "Borrowed" : "Borrow"}</span>
            </button>
          );
        }}
      </Index>
    </div>
  );
}
