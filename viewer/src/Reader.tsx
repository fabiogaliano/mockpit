// A document: written content as one column on one page scroll, with no device
// frame, no width and no Use this. Each surface stays in its own sandboxed frame,
// sized to its whole height, so a stack reads as one text with nothing nested to
// scroll. A click or tap on a block comes out of the frame as data (a number, then
// the text from the frame's own report), and the comment goes in the draft like any
// other; the pins here are drawn from those numbers, and text only ever as text.

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { createStore } from "solid-js/store";
import {
  isSandboxedSurfaceKind,
  PARAGRAPH_TEXT_MAX,
  PARAGRAPHS_MAX,
  type Surface,
} from "../../server/types.ts";
import { surfaceUrl } from "./api.ts";
import { host, readonly, root } from "./host.ts";
import {
  historyRow,
  type ParagraphBlock,
  paragraphPins,
  paragraphQuote,
  reportIsCurrent,
  runsWide,
  sendCount,
} from "./logic.ts";
import type { Margins } from "./Margins.tsx";
import { WithThisSend } from "./Margins.tsx";
import { ArrivedBanner, httpUrl, MarkField, NativeSurface, num } from "./Stage.tsx";
import type { DesignScreenState } from "./state.ts";
import { frameMode } from "./systemRev.ts";
import { cardInset, coarse } from "./viewport.ts";

const MAX_HEIGHT = 60000;
// Where pins stand in the frame's left padding (READ_CSS gives it 28px).
const PIN_X = 3;
const PIN_STEP = 26;
const MAX_MESSAGE = 4000;

// Everything a frame says is untrusted: plain strings and numbers out, clipped.
function readBlocks(d: Record<string, unknown>): ParagraphBlock[] | null {
  if (!Array.isArray(d.blocks)) return null;
  return d.blocks.slice(0, PARAGRAPHS_MAX).flatMap((raw: Record<string, unknown>) => {
    if (!raw || typeof raw !== "object") return [];
    const text = String(raw.text ?? "").slice(0, PARAGRAPH_TEXT_MAX);
    const b = (raw.box ?? {}) as Record<string, unknown>;
    if (!text) return [];
    return [
      {
        index: num(raw.i),
        kind: String(raw.kind ?? "").slice(0, 20) || "p",
        text,
        box: { x: num(b.x), y: num(b.y), w: num(b.w), h: num(b.h) },
      },
    ];
  });
}

// What stands for a surface drawn here as data, which reports nothing: the whole of
// it is one block, named by its caption or by the data itself.
function nativeBlock(surface: Surface | undefined): ParagraphBlock | null {
  const box = { x: 0, y: 0, w: 0, h: 0 };
  if (surface?.kind === "image") {
    const text = surface.caption || surface.alt || "Image";
    return { index: 0, kind: "image", text: text.slice(0, PARAGRAPH_TEXT_MAX), box };
  }
  if (surface?.kind === "json") {
    const text = JSON.stringify(surface.data) ?? "";
    return { index: 0, kind: "json", text: text.slice(0, PARAGRAPH_TEXT_MAX), box };
  }
  return null;
}

interface Pending {
  surface: number;
  block: ParagraphBlock;
}

export function Reader(props: { s: DesignScreenState; head?: JSX.Element }) {
  const s = props.s;
  const alternative = () => s.activeAlternative();
  const version = createMemo(() => {
    const v = alternative();
    return v ? s.frameVersionOf(v) : 0;
  });
  const current = () => version() === alternative()?.version;
  const kinds = createMemo<string[]>(() => {
    const v = alternative();
    if (!v) return [];
    return (historyRow(v, version())?.surfaceKinds ?? v.surfaces.map((x) => x.kind)) as string[];
  });
  const [blocks, setBlocks] = createStore<Record<number, ParagraphBlock[] | undefined>>({});
  const [widths, setWidths] = createStore<Record<number, number>>({});
  const [heights, setHeights] = createStore<Record<number, number>>({});
  const [pending, setPending] = createSignal<Pending | null>(null);
  const frames = new Map<HTMLIFrameElement, { index: number; version: number }>();

  const onMessage = (e: MessageEvent) => {
    const d = e.data as Record<string, unknown> | null;
    if (!d || typeof d !== "object" || d.__mockpit !== true) return;
    let info: { index: number; version: number } | undefined;
    for (const [el, i] of frames) if (el.contentWindow === e.source) info = i;
    if (!info) return;
    if (d.type === "resize") {
      setHeights(info.index, Math.max(1, Math.min(num(d.height), MAX_HEIGHT)));
    } else if (d.type === "open-link") {
      const url = httpUrl(d.url);
      if (url) host().window.open(url, "_blank", "noopener");
    } else if (d.type === "copy") {
      void host()
        .window.navigator.clipboard?.writeText(String(d.text ?? "").slice(0, MAX_MESSAGE))
        .catch(() => {});
    } else if (d.type === "paragraphs") {
      if (!reportIsCurrent(info.version, d.version)) return;
      const list = readBlocks(d);
      if (!list) return;
      setBlocks(info.index, list);
      setWidths(info.index, num(d.width));
    } else if (d.type === "paragraph-tap" && !readonly()) {
      if (!reportIsCurrent(info.version, d.version)) return;
      // By number, against the report: what the comment quotes is never what a tap says.
      const at = num(d.i, -1);
      const block = blocks[info.index]?.find((b) => b.index === at);
      if (block) setPending({ surface: info.index, block });
    }
  };
  host().window.addEventListener("message", onMessage);
  onCleanup(() => host().window.removeEventListener("message", onMessage));

  // Another document on screen: a half-written comment was about the last one.
  createEffect(
    on(
      () => `${s.activeState()}\n${alternative()?.alternative}\n${version()}`,
      () => setPending(null),
      { defer: true },
    ),
  );
  let scroller: HTMLDivElement | undefined;
  createEffect(
    on(
      () => `${s.activeState()}\n${alternative()?.alternative}`,
      () => scroller?.scrollTo(0, 0),
      { defer: true },
    ),
  );
  // The field opens under its paragraph, which a long one can put off the screen.
  createEffect(
    on(pending, (p) => {
      if (!p) return;
      queueMicrotask(() =>
        scroller?.querySelector(".markfield")?.scrollIntoView({ block: "nearest" }),
      );
    }),
  );
  // Esc drops a half-written comment first; the screen's own Esc waits for the next.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !pending()) return;
      setPending(null);
      e.preventDefault();
    };
    root().addEventListener("keydown", onKey, true);
    onCleanup(() => root().removeEventListener("keydown", onKey, true));
  });

  const pins = createMemo(() =>
    paragraphPins(
      s.draft()?.comments ?? [],
      { state: s.activeState(), alternative: alternative()?.alternative ?? null },
      kinds().map((_, i) => blocks[i]),
    ),
  );
  const nextPin = () => (s.draft()?.comments ?? []).filter((c) => c.anchor).length + 1;
  const save = (p: Pending, text: string) => {
    const v = alternative();
    if (!v) return;
    const b = p.block;
    s.addComment(
      null,
      s.activeState(),
      text,
      {
        paragraph: { surface: p.surface, index: b.index, kind: b.kind, text: b.text },
        box: [b.box.x, b.box.y, b.box.w, b.box.h].map((n) => Math.round(n * 10) / 10),
      },
      { alternative: v.alternative, version: version() },
    );
    setPending(null);
  };
  const hint = () =>
    !readonly() && !pins().length && !pending()
      ? `${coarse() ? "Tap" : "Click"} a paragraph to comment on it`
      : null;

  return (
    <div class="reader" ref={(el) => (scroller = el)}>
      <ArrivedBanner s={s} />
      <article
        class="reader-col"
        aria-label={s.design()?.title}
        style={{ "padding-bottom": `${Math.max(120, cardInset().bottom)}px` }}
      >
        {props.head}
        <Show when={hint()}>{(h) => <p class="reader-hint">{h()}</p>}</Show>
        <For each={kinds()}>
          {(kind, i) => {
            const sandboxed = isSandboxedSurfaceKind(kind);
            const surface = () =>
              current() ? (alternative()?.surfaces[i()] as Surface | undefined) : undefined;
            const src = () => {
              const v = alternative();
              if (!v || !sandboxed) return null;
              const url = surfaceUrl(v.postId, i(), {
                version: version(),
                mode: frameMode(),
                e: v.instancesKey,
                w: v.rewrites,
              });
              return `${url}#read`;
            };
            const here = () => pins().filter((p) => p.surface === i());
            let box: HTMLElement | undefined;
            let frame: HTMLIFrameElement | undefined;
            // Data has nothing to report: it is its own one block.
            createEffect(() => {
              if (sandboxed) return;
              const b = nativeBlock(surface());
              setBlocks(i(), b ? [b] : []);
            });
            // Which blocks the frame tints. Numbers, and only to a document that has
            // said it's listening, since a new one starts with none.
            createEffect(() => {
              if (!sandboxed || !blocks[i()]) return;
              const on = pending()?.surface === i() ? pending()!.block.index : null;
              const marked = here().flatMap((p) => (p.block === null ? [] : [p.block]));
              frame?.contentWindow?.postMessage(
                { __mockpit: true, type: "paragraph-marks", marked, on },
                "*",
              );
            });
            const openNative = (e: MouseEvent) => {
              if (readonly() || (e.target as Element).closest("summary, a, button")) return;
              const b = blocks[i()]?.[0];
              if (!b || !box) return;
              setPending({
                surface: i(),
                block: { ...b, box: { x: 0, y: 0, w: box.offsetWidth, h: box.offsetHeight } },
              });
            };
            return (
              <section
                class="reader-sf"
                classList={{ wide: runsWide(kind) }}
                ref={(el) => (box = el)}
              >
                <Show
                  when={sandboxed}
                  fallback={
                    <div class="reader-native" onClick={openNative}>
                      <NativeSurface kind={kind} surface={surface()} version={version()} />
                    </div>
                  }
                >
                  {/* A new document gets a new element: navigating a frame would add
                      a joint-history entry, and Back would walk the frames. */}
                  <Show when={src()} keyed>
                    {(url) => (
                      <iframe
                        ref={(el) => {
                          frame = el;
                          frames.set(el, { index: i(), version: version() });
                          setBlocks(i(), undefined);
                          onCleanup(() => frames.delete(el));
                        }}
                        src={url}
                        sandbox="allow-scripts"
                        title={`${alternative()?.alternative ?? ""} ${kind}`}
                        height={heights[i()] ?? 240}
                      />
                    )}
                  </Show>
                </Show>
                <div class="reader-layer">
                  <For each={here()}>
                    {(p) => {
                      const gone = () => p.block === null;
                      const said = () =>
                        gone()
                          ? `${p.text} · its paragraph has changed or gone: ${paragraphQuote(p.quote, 120)}`
                          : p.text;
                      return (
                        <button
                          type="button"
                          class="pin mark reader-pin"
                          classList={{ moved: gone() }}
                          style={{
                            left: `${PIN_X}px`,
                            top: `${p.y + p.step * PIN_STEP}px`,
                          }}
                          title={said()}
                          aria-label={`Comment ${p.n}: ${said()}`}
                          data-mark={p.n}
                          onClick={() => {
                            s.showTalk();
                            // No hover on a phone to read the warning from.
                            if (gone()) {
                              s.setToast({
                                text: `Its paragraph has changed or gone: ${paragraphQuote(p.quote, 120)}`,
                              });
                            }
                          }}
                        >
                          {String(p.n)}
                        </button>
                      );
                    }}
                  </For>
                  <Show when={pending()?.surface === i() ? pending() : null}>
                    {(p) => (
                      <MarkField
                        n={nextPin()}
                        at={{ x: PIN_X + 11, y: p().block.box.y + 11 }}
                        under={p().block.box.h + 6}
                        width={widths[i()] || box?.offsetWidth || 320}
                        height={Infinity}
                        where={paragraphQuote(p().block.text, 32)}
                        onSave={(text) => save(p(), text)}
                        onCancel={() => setPending(null)}
                      />
                    )}
                  </Show>
                </div>
              </section>
            );
          }}
        </For>
      </article>
    </div>
  );
}

// A phone has no margin to read comments back in and no question card to send them
// from when nothing was asked: this is that, above the version bar.
export function ReaderSend(props: { s: DesignScreenState; m: Margins }) {
  const s = props.s;
  const [open, setOpen] = createSignal(false);
  const n = () => {
    const d = s.draft();
    return d ? sendCount(d) : 0;
  };
  return (
    <Show when={s.sendable() && (!s.curAsk() || s.questionHidden())}>
      <section class="rsend" aria-label="With this Send">
        <Show when={open()}>
          <div class="rsend-list">
            <WithThisSend s={s} m={props.m} />
          </div>
        </Show>
        <div class="rsend-row">
          <button type="button" class="lnk" aria-expanded={open()} onClick={() => setOpen(!open())}>
            {`${n()} to send`}
          </button>
          <button type="button" class="btn go" disabled={s.sending()} onClick={() => s.sendDraft()}>
            Send
          </button>
        </div>
      </section>
    </Show>
  );
}
