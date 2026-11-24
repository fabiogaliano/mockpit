import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { stillCompatibility, stillKey } from "../../server/stills.ts";
import { assetUrl, type AlternativeView } from "./api.ts";
import { canFrame, subjectOf } from "./frameActions.ts";
import { host } from "./host.ts";
import { Icon } from "./icons.tsx";
import { alternativeName } from "./logic.ts";
import { MarkPill } from "./MarkPill.tsx";
import { MAX_COLUMNS, type SheetColumn } from "./sheet.ts";
import type { DesignScreenState } from "./state.ts";
import { peekRev } from "./systemRev.ts";
import { Thumb } from "./Thumb.tsx";

const LIVE_LIMIT = 8;
const LIFT_KEY = "mockpit.sheet.hoverLift";

const COLOUR_SWATCHES = new Map([
  ["apricot", "#ffbc97"],
  ["deep blue", "#343e94"],
]);

function columnSwatch(col: SheetColumn, knob: string | null | undefined) {
  if (!knob || !/(^|\.)colou?r$/.test(knob)) return;
  const value = col.values[knob];
  if (typeof value !== "string") return;
  return (
    COLOUR_SWATCHES.get(value.toLowerCase()) ?? (CSS.supports("color", value) ? value : undefined)
  );
}

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
  const [items, setItems] = createSignal<SheetItem[]>([]);
  const [visible, setVisible] = createSignal<Set<HTMLButtonElement>>(new Set());
  const [liftOn, setLiftOn] = createSignal(host().storage?.getItem(LIFT_KEY) !== "0");
  const toggleLift = () => {
    const next = !liftOn();
    setLiftOn(next);
    try {
      host().storage?.setItem(LIFT_KEY, next ? "1" : "0");
    } catch {
      // Storage can be read-only in locked-down contexts.
    }
  };
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
    };
  }
  onMount(() => {
    let inset = -1;
    const measure = () => {
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

  const at = () => sh.view();
  const pick = (knob: string | null) => sh.open({ knob, one: at()?.one ?? null });
  const one = () => sh.rows().length === 1 && at()?.one !== null;
  const rowMain = (v: AlternativeView) =>
    s.frameKnobMark(v.state, v.alternative, at()?.knob ?? null) === "main";
  const setStarred = () => sh.frames().filter(rowMain).length;
  const subjectsOf = (col: SheetColumn) => sh.frames().map((v) => subjectOf({ v, col }));
  const deletedColumns = createMemo(() => {
    const deleted = new Set<string>();
    if (!sh.frames().length) return deleted;
    for (const col of sh.columns()) {
      if (subjectsOf(col).every((subject) => s.markOf(subject) === "deleted")) deleted.add(col.key);
    }
    return deleted;
  });
  const [showDeleted, setShowDeleted] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const activeColumns = () => sh.columns().length - deletedColumns().size;
  const columns = createMemo(() =>
    sh
      .columns()
      .filter((col) => showDeleted() || !activeColumns() || !deletedColumns().has(col.key))
      .map((col) => col.key),
  );
  const rowIds = createMemo(() => sh.rows().map((v) => v.postId));
  let deletedToggle: HTMLButtonElement | undefined;
  async function deleteColumn(col: SheetColumn, button: HTMLButtonElement) {
    if (deleting()) return;
    const doc = button.ownerDocument;
    setDeleting(true);
    try {
      const removed = await s.deleteCells(subjectsOf(col), col.label);
      if (removed && !button.isConnected && doc.activeElement === doc.body) {
        deletedToggle?.focus({ preventScroll: true });
      }
    } finally {
      setDeleting(false);
    }
  }
  return (
    <div class="sheet" ref={(el) => (region = el)} role="region" aria-label="Sheet">
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
              Presets
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
        <span class="sheet-sep" />
        <button
          type="button"
          class="fchip"
          classList={{ on: liftOn() }}
          aria-pressed={liftOn()}
          title="Expand cells on hover"
          onClick={toggleLift}
        >
          Hover zoom
        </button>
        <Show when={deletedColumns().size && activeColumns()}>
          <button
            type="button"
            class="fchip"
            classList={{ on: showDeleted() }}
            aria-pressed={showDeleted()}
            ref={(el) => (deletedToggle = el)}
            onClick={() => setShowDeleted(!showDeleted())}
          >
            {`Deleted columns · ${deletedColumns().size}`}
          </button>
        </Show>
        <Show when={s.design()?.set && sh.frames().length}>
          <span class="sheet-progress num" title="Items with a Main choice on this knob">
            {`${setStarred()}/${sh.frames().length} ★`}
          </span>
        </Show>
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
        classList={{ "lift-on": liftOn() }}
        style={{
          "grid-template-columns": `var(--sheet-label-width, 150px) repeat(${columns().length}, minmax(0, 1fr))`,
        }}
      >
        <div />
        <For each={columns()}>
          {(key) => {
            const col = () => sh.column(key);
            const swatch = () => {
              const current = col();
              return current && columnSwatch(current, at()?.knob);
            };
            const canDelete = () => {
              const current = col();
              const frame = sh.frames()[0];
              return (
                current &&
                frame &&
                activeColumns() > 1 &&
                !deletedColumns().has(key) &&
                canFrame(s, "delete", { v: frame, col: current })
              );
            };
            const label = () => {
              const current = col();
              if (!current) return "";
              const count = subjectsOf(current).filter(
                (subject) => s.markOf(subject) !== "deleted",
              ).length;
              return `Delete ${current.label} column · ${count} ${count === 1 ? "cell" : "cells"}`;
            };
            return (
              <div
                class="sheet-h"
                classList={{
                  mine: !!col()?.mine,
                  hot: sh.pointedKey()?.column === key,
                  "has-delete": !!canDelete(),
                }}
                title={col()?.label}
              >
                <Show when={swatch()}>
                  {(color) => (
                    <span class="sheet-swatch" style={{ background: color() }} aria-hidden="true" />
                  )}
                </Show>
                <span class="sheet-h-label">{col()?.label}</span>
                <Show when={canDelete() && col()}>
                  {(current) => (
                    <button
                      type="button"
                      class="sheet-delete-column"
                      title={label()}
                      aria-label={label()}
                      aria-disabled={deleting()}
                      onClick={(e) => void deleteColumn(current(), e.currentTarget)}
                    >
                      <Icon name="trash" />
                    </button>
                  )}
                </Show>
              </div>
            );
          }}
        </For>
        <For each={rowIds()}>
          {(id, rowIndex) => (
            <Show when={sh.row(id)}>
              {(v) => (
                <>
                  <div
                    class="sheet-l"
                    classList={{ main: rowMain(v()), hot: sh.pointedKey()?.post === v().postId }}
                    title={v().alternative}
                  >
                    {alternativeName(v().alternative)}
                    <Show when={rowMain(v())}>
                      <span class="sheet-star" title="Main">
                        <Icon name="star" />
                      </span>
                    </Show>
                  </div>
                  <For each={columns()}>
                    {(key, colIndex) => (
                      <Show when={sh.column(key)}>
                        {(col) => (
                          <SheetCellView
                            s={s}
                            v={v()}
                            col={col()}
                            ox={() => {
                              const n = columns().length;
                              if (n <= 1) return "50%";
                              if (colIndex() === 0) return "0%";
                              if (colIndex() === n - 1) return "100%";
                              return "50%";
                            }}
                            oy={() => {
                              const n = rowIds().length;
                              if (n <= 1 || rowIndex() === 0) return "0%";
                              if (rowIndex() === n - 1) return "100%";
                              return "50%";
                            }}
                            register={register}
                            seen={(el) => visible().has(el)}
                            live={(el) => slots().has(el)}
                            capture={() => !live() && sh.stills.capability() === "capture"}
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
    </div>
  );
}

function SheetCellView(props: {
  s: DesignScreenState;
  v: AlternativeView;
  col: SheetColumn;
  ox: () => string;
  oy: () => string;
  register: (item: SheetItem) => () => void;
  seen: (el: HTMLButtonElement) => boolean;
  live: (el: HTMLButtonElement) => boolean;
  capture: () => boolean;
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
  const deleted = createMemo(() => mark() === "deleted");
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
    if (!el || deleted()) return;
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
    if (c && el && !deleted() && props.capture() && props.seen(el)) sh.stills.want(c);
  });
  const source = createMemo(
    () => {
      const c = exact();
      if (!c || deleted()) return null;
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
  return (
    <Show
      when={!deleted()}
      fallback={
        <div class="sheet-cellw deleted" aria-label={`${label()}, deleted`}>
          <button
            type="button"
            class="sheet-restore"
            onClick={() => void props.s.setMark(subjectOf(f()), null)}
          >
            Restore
          </button>
        </div>
      }
    >
      <div
        class="sheet-cellw"
        classList={{ main: mark() === "main", keep: mark() === "keep" }}
        style={{ "--ox": props.ox(), "--oy": props.oy() }}
        onPointerEnter={() => point(true)}
        onPointerLeave={() => point(focused())}
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
        <div class="sheet-card">
          <div class="sheet-frame" aria-hidden="true" />
          <button
            type="button"
            class="sheet-cell"
            ref={setElement}
            aria-label={`${label()}${mark() === "main" ? ", Main" : mark() === "keep" ? ", Bookmarked" : ""}`}
            onClick={() => sh.openCell(props.v, props.col)}
          >
            <Show
              when={painted()}
              fallback={
                <Show when={showLive()}>
                  {(c) => (
                    <Thumb
                      src={c().src}
                      width={c().width}
                      part={c().part}
                      class="sheet-pic"
                      sheet
                    />
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
          <Show when={mark() === "main" || mark() === "keep"}>
            <span class="sheet-badge" aria-hidden="true">
              <Icon name={mark() === "main" ? "star" : "bookmark"} />
            </span>
          </Show>
          <div class="sheet-top">
            <span class="sheet-top-label">{label()}</span>
            <MarkPill s={props.s} f={f()} />
          </div>
        </div>
      </div>
    </Show>
  );
}
