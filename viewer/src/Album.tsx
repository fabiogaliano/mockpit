// One thing and all its pictures, as a cover: a phone shape, a wide one, both side
// by side, or a part fitted whole. A stack of sheets behind it says there's more
// inside, and a flat cover says there isn't. Whose turn it is and what's inside sit
// under the title and never on the art, which is the design's own. Something to
// read has no useful picture at that size, so it gets a text cover or a dated row.

import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import { assetUrl, surfaceUrl, type TreeNode } from "./api.ts";
import {
  albumInside,
  albumPicture,
  bothWidths,
  coverShape,
  lastWork,
  shortDate,
  stackDepth,
  turnWord,
} from "./albums.ts";
import { host, readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import {
  designWidth,
  screenPicture,
  shortSource,
  type ScreenPicture,
  type StatusNode,
} from "./logic.ts";
import { linkClick, mockPath } from "./route.ts";
import { theme } from "./theme.ts";
import { Thumb } from "./Thumb.tsx";

// The picture of one version: its poster where the agent gave one, else the page
// itself, shrunk in a sandboxed frame that starts only when near the screen.
function Picture(props: { pic: ScreenPicture; width: number; whole: boolean }) {
  return (
    <Show
      when={props.pic.poster}
      fallback={
        <Thumb
          src={surfaceUrl(props.pic.postId, props.pic.surface, {
            version: props.pic.version,
            mode: theme(),
            e: props.pic.embedsKey,
            w: props.pic.rewrites,
          })}
          width={props.width}
          fit={props.whole}
          whole={props.whole}
        />
      }
    >
      {(id) => (
        <img
          class="home-poster"
          classList={{ whole: props.whole }}
          src={assetUrl(id())}
          alt=""
          loading="lazy"
          decoding="async"
        />
      )}
    </Show>
  );
}

// "Agent working" lapses by itself, with no event to say so.
const [turnClock, setTurnClock] = createSignal(Date.now());
host().window.setInterval(() => setTurnClock(Date.now()), 30_000);
export { turnClock };

export function useTurn(node: () => StatusNode | null) {
  return createMemo(
    () => {
      const n = node();
      return n ? turnWord(n, turnClock()) : null;
    },
    undefined,
    { equals: (a, b) => a?.kind === b?.kind && a?.text === b?.text },
  );
}

// The words every album and row carries: whose turn, what's inside, and whether
// there's work this browser hasn't opened (a word and a mark, not just a colour).
export function AlbumWords(props: { node: TreeNode; fresh: boolean; extra?: string }) {
  const turn = useTurn(() => props.node);
  const inside = createMemo(() =>
    [albumInside(props.node), props.extra].filter(Boolean).join(" · "),
  );
  return (
    <span class="alb-words">
      <Show when={turn()}>
        {(t) => (
          <span class="alb-turn" data-turn={t().kind}>
            {t().text}
          </span>
        )}
      </Show>
      <Show when={props.fresh}>
        <span class="alb-new">
          <i aria-hidden="true" />
          New
        </span>
      </Show>
      <Show when={inside()}>{(text) => <span class="alb-inside">{text()}</span>}</Show>
    </span>
  );
}

export function Album(props: {
  project: string;
  node: TreeNode;
  fresh: boolean;
  menu: JSX.Element | undefined;
  // Words that only the shelf knows: where a component appears.
  extra?: string;
  // Ideas end with a quiet × on the cover, as a design leaves Studio, and an outline
  // nobody needs goes the same way.
  onEnd?: () => void;
  endLabel?: string;
}) {
  const n = () => props.node;
  const shape = createMemo(() => coverShape(n()));
  const pic = createMemo(() => albumPicture(n()));
  const depth = createMemo(() => stackDepth(n()));
  const widths = createMemo(() => bothWidths(n()));
  const href = () => mockPath(props.project, n().slug);
  const waiting = () => n().open > 0 && !readonly();
  return (
    <div class="alb" classList={{ waiting: waiting() }} data-shape={shape()}>
      <div class="alb-front">
        {/* One stop per album for the keyboard: the title below carries it, except on
          a text cover, where the title is the cover. */}
        <a
          class="home-step alb-cover"
          href={href()}
          tabIndex={shape() === "text" ? undefined : -1}
          aria-hidden={shape() === "text" ? undefined : "true"}
          data-mock={n().slug}
          onClick={(e) => linkClick(e, href())}
        >
          <For each={Array.from({ length: depth() }, (_, i) => depth() - i)}>
            {(i) => <span class="alb-sheet" style={{ "--i": i }} />}
          </For>
          <span class="home-pic alb-art">
            <Show
              when={shape() !== "text" && pic()}
              fallback={
                <Show
                  when={n().planned}
                  fallback={
                    <span class="alb-text">
                      <span class="alb-text-title">{n().title}</span>
                      <span class="alb-text-date">{shortDate(lastWork(n()))}</span>
                    </span>
                  }
                >
                  <span class="alb-plan">Planned</span>
                </Show>
              }
            >
              {(p) => (
                <>
                  <Picture
                    pic={p()}
                    width={widths()?.wide ?? designWidth(n())}
                    whole={shape() === "part"}
                  />
                  <Show when={shape() === "both"}>
                    <span class="alb-phone">
                      <Picture pic={p()} width={widths()?.phone ?? 390} whole={false} />
                    </span>
                  </Show>
                </>
              )}
            </Show>
          </span>
        </a>
        <Show when={props.onEnd}>
          <button
            type="button"
            class="ib x-remove alb-x"
            aria-label={`${props.endLabel ?? "End"}: ${n().title}`}
            title={props.endLabel ?? "End this idea"}
            onClick={() => props.onEnd?.()}
          >
            <Icon name="close" />
          </button>
        </Show>
      </div>
      <div class="alb-cap">
        <Show when={shape() !== "text"}>
          <a class="alb-title" href={href()} onClick={(e) => linkClick(e, href())}>
            {n().title}
          </a>
        </Show>
        <AlbumWords node={n()} fresh={props.fresh} extra={props.extra} />
        <Show when={n().source}>
          {(src) => (
            <span class="home-src alb-src" title={src()}>
              {shortSource(src())}
            </span>
          )}
        </Show>
        {props.menu}
      </div>
    </div>
  );
}

// A written page in the dated list: its name and when, with nothing to squint at.
export function DocRow(props: {
  project: string;
  node: TreeNode;
  fresh: boolean;
  menu: JSX.Element | undefined;
}) {
  const n = () => props.node;
  const href = () => mockPath(props.project, n().slug);
  return (
    <li class="home-doc">
      <a
        class="home-doc-link"
        href={href()}
        data-mock={n().slug}
        onClick={(e) => linkClick(e, href())}
      >
        <span class="home-doc-title">{n().title}</span>
        <AlbumWords node={n()} fresh={props.fresh} />
        <time datetime={lastWork(n())}>{shortDate(lastWork(n()))}</time>
      </a>
      {props.menu}
    </li>
  );
}

// A state of a declared screen as a step of a flow: the one picture that still opens
// its state directly, with the check that says it's the design in use.
export function FlowStepTile(props: {
  project: string;
  node: TreeNode;
  state: string | null;
  flow: string;
}) {
  const pic = createMemo(() => screenPicture(props.node, props.state));
  const href = () =>
    mockPath(
      props.project,
      props.node.slug,
      props.state === null ? null : { state: props.state, variant: null },
      props.flow,
    );
  const width = () => designWidth(props.node);
  // Drawn with nothing to picture (an image, some json) isn't the same as not drawn.
  const planned = () => !props.node.variants.some((v) => v.state === props.state);
  return (
    <a
      class="home-step"
      classList={{ phone: width() < 700, planned: planned() }}
      href={href()}
      onClick={(e) => linkClick(e, href())}
      data-mock={props.node.slug}
      data-state={props.state ?? ""}
    >
      <span class="home-pic">
        <Show when={pic()} fallback={planned() ? <span class="alb-plan">Planned</span> : null}>
          {(p) => <Picture pic={p()} width={width()} whole={false} />}
        </Show>
        <Show when={pic()?.inUse}>
          <span class="mk cur" aria-hidden="true">
            <Icon name="check" />
          </span>
        </Show>
      </span>
      <span class="home-lbl">
        <b>{props.node.title}</b>
        {props.state === null ? "" : ` · ${props.state}`}
        <Show when={pic()?.inUse}>
          <span class="sr-only">, in use</span>
        </Show>
      </span>
    </a>
  );
}
