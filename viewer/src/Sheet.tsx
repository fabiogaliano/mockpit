import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { stillCompatibility, stillKey } from "../../server/stills.ts";
import { assetUrl, type AlternativeView } from "./api.ts";
import { subjectOf } from "./frameActions.ts";
import { host } from "./host.ts";
import { Icon } from "./icons.tsx";
import { alternativeName } from "./logic.ts";
import { MarkPill } from "./MarkPill.tsx";
import { MAX_COLUMNS, type SheetColumn } from "./sheet.ts";
import type { DesignScreenState } from "./state.ts";
import { peekRev } from "./systemRev.ts";
import { Thumb } from "./Thumb.tsx";

const PEEK_W = 416;
const LIVE_LIMIT = 8;

interface Picture {
  url: string;
  ratio: number;
  key: string;
  compatible: string;
}

interface SheetItem {
  element: HTMLButtonElement;
  focused: () => boolean;
  pending: () => boolean;
  failed: () => boolean;
}

export function Sheet(props: { s: DesignScreenState }) {
  const s = props.s;
  const sh = s.sheet;
  const [peek, setPeek] = createSignal<{
    element: HTMLButtonElement;
    picture: () => Picture | null;
    label: () => string;
  } | null>(null);
  const [layout, relayout] = createSignal(0);
  const [items, setItems] = createSignal<SheetItem[]>([]);
  const [visible, setVisible] = createSignal<Set<HTMLButtonElement>>(new Set());
  let region: HTMLDivElement | undefined;
  let bar: HTMLDivElement | undefined;
  let observer: IntersectionObserver | undefined;
  const live = () =>
    sh.stills.capability() === "live" ||
    (sh.stills.capability() !== "loading" && peekRev() !== null);
  const slots = createMemo(() => {
    if (!live()) return new Set<HTMLButtonElement>();
    const all = items();
    const focus = all.find((item) => item.focused());
    const near = all.filter((item) => item !== focus && visible().has(item.element));
    // Registration order survives refreshes and does not depend on observer delivery order.
    return new Set([...(focus ? [focus] : []), ...near].slice(0, LIVE_LIMIT).map((i) => i.element));
  });
  const counts = createMemo(() => {
    const shown = items().filter((item) => visible().has(item.element));
    return {
      pending: shown.filter((item) => item.pending()).length,
      failed: shown.filter((item) => item.failed()).length,
    };
  });
  function register(item: SheetItem) {
    setItems((list) => [...list, item]);
    observer?.observe(item.element);
    return () => {
      observer?.unobserve(item.element);
      setItems((list) => list.filter((i) => i !== item));
      setVisible((before) => {
        const next = new Set(before);
        next.delete(item.element);
        return next;
      });
      if (peek()?.element === item.element) setPeek(null);
    };
  }
  onMount(() => {
    let inset = -1;
    const measure = () => {
      relayout((n) => n + 1);
      const height = Math.ceil(bar?.getBoundingClientRect().height ?? 0);
      if (inset === height) return;
      inset = height;
      observer?.disconnect();
      observer = new IntersectionObserver(
        (entries) => {
          setVisible((before) => {
            const next = new Set(before);
            for (const entry of entries) {
              if (!(entry.target instanceof HTMLButtonElement)) continue;
              if (entry.isIntersecting && entry.intersectionRatio > 0 && entry.target.isConnected) {
                next.add(entry.target);
              } else {
                next.delete(entry.target);
              }
            }
            return next;
          });
        },
        { root: region, rootMargin: `${-height}px 0px 0px 0px` },
      );
      for (const item of items()) observer.observe(item.element);
    };
    const resize = new ResizeObserver(measure);
    if (region) resize.observe(region);
    if (bar) resize.observe(bar);
    const window = host().window;
    window.addEventListener("resize", measure);
    measure();
    onCleanup(() => {
      observer?.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", measure);
    });
  });

  const preview = createMemo(() => {
    const held = peek();
    const picture = held?.picture();
    if (!held || !picture || !region || !visible().has(held.element)) return null;
    void layout();
    const bounds = region.getBoundingClientRect();
    const cell = held.element.getBoundingClientRect();
    const left = Math.max(0, bounds.left) + 8;
    const right = Math.min(host().window.innerWidth, bounds.left + region.clientWidth) - 8;
    const top = Math.max(0, bounds.top, bar?.getBoundingClientRect().bottom ?? 0) + 8;
    const bottom = Math.min(host().window.innerHeight, bounds.top + region.clientHeight) - 8;
    if (right <= left || bottom - top < 40) return null;
    const width = Math.min(PEEK_W, right - left);
    const height = Math.min(bottom - top - 26, width / picture.ratio);
    const x = cell.right + 8 + width <= right ? cell.right + 8 : cell.left - 8 - width;
    return {
      picture,
      label: held.label(),
      width,
      height,
      x: Math.max(left, Math.min(x, right - width)),
      y: Math.max(top, Math.min(cell.top, bottom - height - 26)),
    };
  });
  const at = () => sh.view();
  const pick = (knob: string | null) => sh.open({ knob, one: at()?.one ?? null });
  const one = () => sh.rows().length === 1 && at()?.one !== null;
  const rowMain = (v: AlternativeView) => s.frameMark(v.state, v.alternative) === "main";
  const columns = createMemo(() => sh.columns().map((col) => col.key));
  return (
    <div
      class="sheet"
      ref={(el) => (region = el)}
      onScroll={() => relayout((n) => n + 1)}
      role="region"
      aria-label="Sheet"
    >
      <div class="sheet-bar" ref={(el) => (bar = el)} role="toolbar" aria-label="Sheet">
        <div class="fchips" role="group" aria-label="Across">
          <For each={sh.choiceKnobs()}>
            {(k) => (
              <button
                type="button"
                class="fchip"
                classList={{ on: at()?.knob === k.path }}
                aria-pressed={at()?.knob === k.path}
                onClick={() => pick(k.path)}
              >
                {k.label}
              </button>
            )}
          </For>
          <Show when={s.looksHere().length}>
            <button
              type="button"
              class="fchip"
              classList={{ on: at()?.knob === null }}
              aria-pressed={at()?.knob === null}
              onClick={() => pick(null)}
            >
              Looks
            </button>
          </Show>
        </div>
        <span class="sheet-sep" />
        <div class="fchips" role="group" aria-label="Down">
          <Show when={at()?.one ?? s.activeAlternative()?.alternative}>
            {(alt) => (
              <button
                type="button"
                class="fchip"
                classList={{ on: one() }}
                aria-pressed={one()}
                onClick={() => sh.open({ knob: at()?.knob ?? null, one: alt() })}
              >
                {alternativeName(alt())}
              </button>
            )}
          </Show>
          <button
            type="button"
            class="fchip"
            classList={{ on: !one() }}
            aria-pressed={!one()}
            onClick={() => sh.open({ knob: at()?.knob ?? null, one: null })}
          >
            {`All ${sh.frames().length}`}
          </button>
        </div>
        {/* Its keys are behind Focus's "?". */}
        <Show when={sh.total() > MAX_COLUMNS}>
          <span class="sheet-keys">{`${MAX_COLUMNS} of ${sh.total()}`}</span>
        </Show>
        <Show when={counts().pending}>
          <span class="sheet-keys" role="status">{`Rendering ${counts().pending}`}</span>
        </Show>
        <Show when={counts().failed}>
          <span class="sheet-keys">{`${counts().failed} need retry`}</span>
        </Show>
        <Show when={sh.stills.indexError()}>
          <button type="button" class="fchip" onClick={() => void sh.stills.refresh()}>
            Retry loading pictures
          </button>
        </Show>
      </div>

      <div
        class="sheet-grid"
        style={{ "grid-template-columns": `150px repeat(${columns().length}, minmax(0, 1fr))` }}
      >
        <div />
        <For each={columns()}>
          {(key) => {
            const col = () => sh.column(key);
            return (
              <div class="sheet-h" classList={{ mine: !!col()?.mine }} title={col()?.label}>
                {col()?.label}
              </div>
            );
          }}
        </For>
        <For each={sh.rows().map((v) => v.postId)}>
          {(id) => (
            <Show when={sh.row(id)}>
              {(v) => (
                <>
                  <div class="sheet-l" classList={{ main: rowMain(v()) }} title={v().alternative}>
                    {alternativeName(v().alternative)}
                    <Show when={rowMain(v())}>
                      <span class="sheet-star" title="Main">
                        <Icon name="star" />
                      </span>
                    </Show>
                  </div>
                  <For each={columns()}>
                    {(key) => (
                      <Show when={sh.column(key)}>
                        {(col) => (
                          <SheetCellView
                            s={s}
                            v={v()}
                            col={col()}
                            register={register}
                            seen={(el) => visible().has(el)}
                            live={(el) => slots().has(el)}
                            capture={() => !live() && sh.stills.capability() === "capture"}
                            onPeek={setPeek}
                          />
                        )}
                      </Show>
                    )}
                  </For>
                </>
              )}
            </Show>
          )}
        </For>
      </div>
      <Show when={preview()}>
        {(p) => (
          <div
            class="sheet-peek"
            style={{ left: `${p().x}px`, top: `${p().y}px`, width: `${p().width}px` }}
            aria-hidden="true"
          >
            <img src={p().picture.url} alt="" style={{ height: `${p().height}px` }} />
            <div>{p().label}</div>
          </div>
        )}
      </Show>
    </div>
  );
}

function SheetCellView(props: {
  s: DesignScreenState;
  v: AlternativeView;
  col: SheetColumn;
  register: (item: SheetItem) => () => void;
  seen: (el: HTMLButtonElement) => boolean;
  live: (el: HTMLButtonElement) => boolean;
  capture: () => boolean;
  onPeek: (
    peek: { element: HTMLButtonElement; picture: () => Picture | null; label: () => string } | null,
  ) => void;
}) {
  const sh = props.s.sheet;
  const cell = createMemo(() => sh.cell(props.v, props.col));
  const exact = () => cell()?.still;
  const compatible = () => {
    const c = exact();
    return c ? stillCompatibility(c) : null;
  };
  const [decoded, setDecoded] = createSignal<Picture | null>(null);
  const [focused, setFocused] = createSignal(false);
  const [element, setElement] = createSignal<HTMLButtonElement>();
  const painted = () => {
    const picture = decoded();
    return picture && picture.compatible === compatible() ? picture : null;
  };
  const f = () => ({ v: props.v, col: props.col });
  const mark = createMemo(() => props.s.markOf(subjectOf(f())));
  const label = () => `${alternativeName(props.v.alternative)} · ${props.col.label}`;
  const showLive = () => {
    const el = element();
    return el && props.live(el) ? cell() : null;
  };
  const older = () => {
    const c = exact();
    const picture = painted();
    return !!(c && picture && picture.key !== stillKey(c));
  };
  const failed = () => {
    const c = exact();
    return !!c && props.capture() && sh.stills.failed(c);
  };
  createEffect(() => {
    const el = element();
    if (!el) return;
    onCleanup(
      props.register({
        element: el,
        focused,
        failed,
        pending: () => {
          const c = exact();
          return !!c && props.capture() && sh.stills.pending(c);
        },
      }),
    );
  });
  createEffect(() => {
    const c = exact();
    const el = element();
    if (c && el && props.capture() && props.seen(el)) sh.stills.want(c);
  });
  const source = createMemo(
    () => {
      const c = exact();
      if (!c) return null;
      const shot = sh.stills.picture(c);
      return shot ? { key: shot.key, asset: shot.asset, compatible: stillCompatibility(c) } : null;
    },
    null,
    {
      equals: (a, b) =>
        a?.key === b?.key && a?.asset === b?.asset && a?.compatible === b?.compatible,
    },
  );
  createEffect(() => {
    const identity = compatible();
    setDecoded((picture) => (picture?.compatible === identity ? picture : null));
  });
  createEffect(() => {
    const shot = source();
    if (!shot) return;
    const url = assetUrl(shot.asset);
    const image = host().window.document.createElement("img");
    let active = true;
    onCleanup(() => {
      active = false;
    });
    image.src = url;
    void image.decode().then(
      () => {
        if (!active) return;
        setDecoded({
          url,
          key: shot.key,
          compatible: shot.compatible,
          ratio: image.naturalWidth / image.naturalHeight,
        });
      },
      () => {
        if (active) sh.stills.broken(shot.key, shot.asset);
      },
    );
  });

  const point = (on: boolean) => {
    const key = { post: props.v.postId, column: props.col.key };
    const selected = sh.pointedKey();
    if (on) sh.setPointedKey(key);
    else if (selected?.post === key.post && selected.column === key.column) sh.setPointedKey(null);
  };
  createEffect(() => {
    const l = sh.landing();
    const el = element();
    if (!l || l.alternative !== props.v.alternative || l.col !== props.col.key || !el) return;
    sh.setLanding(null);
    el.scrollIntoView({ block: "nearest" });
    el.focus({ preventScroll: true });
    point(true);
  });
  let hold = 0;
  const stopPeek = () => {
    host().window.clearTimeout(hold);
    props.onPeek(null);
  };
  onCleanup(() => host().window.clearTimeout(hold));

  return (
    <div
      class="sheet-cellw"
      classList={{ main: mark() === "main", picked: !!mark() }}
      onPointerEnter={(e) => {
        point(true);
        const el = element();
        if (e.pointerType !== "mouse" || !el) return;
        hold = host().window.setTimeout(
          () => props.onPeek({ element: el, picture: painted, label }),
          250,
        );
      }}
      onPointerLeave={() => {
        stopPeek();
        point(focused());
      }}
      onFocusIn={() => {
        setFocused(true);
        point(true);
      }}
      onFocusOut={(e) => {
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
        setFocused(false);
        point(e.currentTarget.matches(":hover"));
      }}
    >
      <button
        type="button"
        class="sheet-cell"
        ref={setElement}
        aria-label={`${label()}${mark() === "main" ? ", Main" : mark() === "pick" ? ", picked" : ""}`}
        onDblClick={() => {
          stopPeek();
          sh.openCell(props.v, props.col);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") sh.openCell(props.v, props.col);
        }}
      >
        <Show
          when={painted()}
          fallback={
            <Show when={showLive()}>
              {(c) => (
                <Thumb src={c().src} width={c().width} part={c().part} class="sheet-pic" sheet />
              )}
            </Show>
          }
        >
          {(picture) => <img src={picture().url} alt="" draggable={false} />}
        </Show>
        <Show when={older()}>
          <span class="sheet-updating" title="Updating picture" aria-label="Updating picture" />
        </Show>
      </button>
      <Show when={failed()}>
        <button
          type="button"
          class="sheet-retry"
          aria-label={`Retry ${label()} picture`}
          onClick={() => {
            const c = exact();
            if (c) sh.stills.want(c, true);
          }}
        >
          Retry
        </button>
      </Show>
      <Show when={mark() === "main" || mark() === "pick"}>
        <span class="sheet-badge" aria-hidden="true">
          <Icon name={mark() === "main" ? "star" : "check"} />
        </span>
      </Show>
      <MarkPill s={props.s} f={f()} />
    </div>
  );
}
