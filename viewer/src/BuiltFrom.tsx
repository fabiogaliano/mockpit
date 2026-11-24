// Instances: the components this state includes and its own parts, each opening its
// knobs (tunekit, see tune.ts) with what is tuned riding in the next answer. In the
// panel's Spec, and as the panel itself while Tune is on (a bottom sheet on a phone).
// What sits around the design is in About, under its name.

import { createEffect, createMemo, createResource, For, Index, on, Show } from "solid-js";
import { api, surfaceUrl, type TreeNode } from "./api.ts";
import { host, readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import {
  designWidth,
  knobPart,
  partLabel,
  screenPicture,
  tuneListed,
  versionName,
} from "./logic.ts";
import { linkClick, designPath } from "./route.ts";
import { SaveLook } from "./Looks.tsx";
import type { DesignScreenState } from "./state.ts";
import { frameMode } from "./systemRev.ts";
import { Thumb } from "./Thumb.tsx";
import type { TuneState } from "./tune.ts";
import { phoneLayout } from "./viewport.ts";

// A tree node's design in use (else its newest live one), as a picture.
function nodePicture(node: TreeNode): string | null {
  const pic = screenPicture(node, node.inUse[0]?.state ?? node.states[0] ?? null);
  return pic
    ? surfaceUrl(pic.postId, pic.surface, {
        version: pic.version,
        mode: frameMode(),
        e: pic.instancesKey,
        w: pic.rewrites,
      })
    : null;
}

export function BuiltFrom(props: {
  s: DesignScreenState;
  t: TuneState;
  // In the panel, which has its own head and close, and only mounts this while shown.
  inline?: boolean;
}) {
  const s = props.s;
  const t = props.t;
  const shown = () => !!props.inline || s.drawer();
  const project = () => s.design()?.project ?? s.project;
  // Refetched whenever the design changes, so a newly included component shows.
  const [tree] = createResource(
    () => (shown() ? `${project()}\u0000${s.design()?.updatedAt ?? ""}` : null),
    () => api.tree(project()).then((r) => r.tree),
  );
  const bySlug = createMemo(() => new Map((tree() ?? []).map((n) => [n.slug, n])));
  const me = () => bySlug().get(s.slug);
  const uses = () => (me()?.instances ?? []).flatMap((slug) => bySlug().get(slug) ?? []);
  const parts = () =>
    t.components().filter((c) =>
      tuneListed(
        c,
        s.design()?.asks ?? [],
        s.mixOpts().map((o) => o.part),
      ),
    );
  // The frame on stage's own: tuning one leaves its siblings as they were. Only what Tune
  // lists counts: a value picked among choices is the Choices panel's.
  const listedPaths = () => parts().flatMap((c) => c.paths);
  const tuned = () => listedPaths().filter((p) => p in s.knobContext().tuned).length;
  const frameName = () => {
    const v = s.activeAlternative();
    return v && s.inState(v.state).length > 1 ? v.alternative : null;
  };
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
  // Tune holding one group opens on it.
  createEffect(
    on(
      () => (s.tool() === "tune" && parts().length === 1 ? parts()[0].part : undefined),
      (only) => {
        if (only !== undefined && s.tuneOpen() === false) s.openTune(only);
      },
    ),
  );
  // Closing the drawer puts Tune down with it.
  const close = () => (s.tool() === "tune" ? s.toggleTool("tune") : s.setDrawer(false));
  const go = (slug: string) => designPath(project(), slug);
  return (
    <aside
      class={props.inline ? "builtfrom" : "drawer"}
      classList={{ open: shown() }}
      aria-label={props.inline ? "Instances" : "Tune"}
      aria-hidden={!shown()}
      inert={!shown() || undefined}
      ref={(el) => (panel = el)}
    >
      <Show when={!props.inline}>
        <div class="dhead">
          <h2>Tune</h2>
          <button type="button" class="ib" aria-label="Close" onClick={close}>
            <Icon name="close" />
          </button>
        </div>
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
                          <span class="sm" data-ready={n.status}>
                            {/* A component's own mark; an idea included here says what's in use. */}
                            {n.status ??
                              (n.inUse[0]
                                ? `${versionName(
                                    n.inUse[0],
                                    n.alternatives.filter((v) => v.state === n.inUse[0].state)
                                      .length > 1,
                                  )} in use`
                                : `${n.alternatives.length} alternatives`)}
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
              <span>{`${tuned()} tuned${frameName() ? ` on ${frameName()}` : ""}`}</span>
              <button type="button" onClick={() => s.resetTuned(listedPaths())}>
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
                  parts().find((x) => x.part === part) ?? {
                    part,
                    label: part ? partLabel(s.design() ?? { parts: [] }, part) : "",
                    paths: [],
                  };
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
      <Show when={s.tool() === "tune" && !readonly() && parts().some((c) => c.paths.length)}>
        <section>
          <SaveLook s={s} />
        </section>
      </Show>
    </aside>
  );
}

function PartToggle(props: { s: DesignScreenState; part: string | null; label: string }) {
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
function PartKnobs(props: { s: DesignScreenState; part: string | null }) {
  const s = props.s;
  const borrow = () => s.mixOpts().filter((o) => o.part === props.part);
  // A phone has no Choices panel: its choice knobs stay here, each with its Sheet.
  const spreads = () =>
    phoneLayout() && s.sheet.available()
      ? s.sheet.choiceKnobs().filter((k) => knobPart(k.path) === props.part)
      : [];
  return (
    <div class="knobs">
      <div class="tune-knobs" ref={(el) => s.setTuneHost(el)} />
      <For each={spreads()}>
        {(k) => (
          <button
            type="button"
            class="spread-row"
            title={`This frame in every ${k.label.toLowerCase()}, side by side`}
            onClick={() => s.sheet.spread(k.path)}
          >
            <span>{k.label}</span>
            <span class="borrow-act">Sheet</span>
          </button>
        )}
      </For>
      {/* By position: the options are rebuilt on every parts report, and a
          row remounted under the pointer would lose its hover. */}
      <Index each={borrow()}>
        {(o) => {
          const on = () => s.draft()?.borrowed[o().part] === o().alternative;
          return (
            <button
              type="button"
              class="borrow-row"
              classList={{ on: on() }}
              aria-pressed={on()}
              onMouseEnter={() =>
                s.setPreview({
                  key: `borrow:${o().part}:${o().alternative}`,
                  alternative: o().alternative,
                  part: o().part,
                })
              }
              onMouseLeave={() => s.setHoveredPreview(null)}
              onClick={() => s.toggleMix(o())}
            >
              <span>{`${partLabel(s.design() ?? { parts: [] }, o().part)} as in ${o().alternative}`}</span>
              <span class="borrow-act">{on() ? "Borrowed" : "Borrow"}</span>
            </button>
          );
        }}
      </Index>
    </div>
  );
}
