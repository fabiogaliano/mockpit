// The sheet in place of the frame (sheet.ts): frames down, values or looks across. A cell is
// its still once made, else the frame drawn live and frozen, cropped to the part the column
// changes; the pointer resting on one shows the whole frame, a double-click opens it, and
// the sheet opens again on the cell last open (`landing`).

import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { AlternativeView } from "./api.ts";
import { subjectOf } from "./frameActions.ts";
import { host, readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { alternativeName } from "./logic.ts";
import { MarkPill } from "./MarkPill.tsx";
import { MAX_COLUMNS, type SheetColumn } from "./sheet.ts";
import type { DesignScreenState } from "./state.ts";
import { Thumb } from "./Thumb.tsx";

const PEEK_W = 416;
// The peek's picture and caption, as styles.css draws them.
const PEEK_H = 350;

export function Sheet(props: { s: DesignScreenState }) {
  const s = props.s;
  const sh = s.sheet;
  const [peek, setPeek] = createSignal<{
    v: AlternativeView;
    col: SheetColumn;
    x: number;
    y: number;
  } | null>(null);
  const at = () => sh.view();
  const pick = (knob: string | null) => sh.open({ knob, one: at()?.one ?? null });
  const one = () => sh.rows().length === 1 && at()?.one !== null;
  return (
    <div class="sheet" role="region" aria-label="Sheet">
      <div class="sheet-bar" role="toolbar" aria-label="Sheet">
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
        <span class="sheet-keys">
          <Show when={sh.total() > MAX_COLUMNS}>
            <span>{`${MAX_COLUMNS} of ${sh.total()}`}</span>
          </Show>
          <Show when={sh.frames().length > 1 && !readonly()}>
            <span>
              <kbd>P</kbd> pick
            </span>
            <span>
              <kbd>M</kbd> main
            </span>
            <span>
              <kbd>X</kbd> archive
            </span>
          </Show>
          <span>
            <kbd>double-click</kbd> open
          </span>
        </span>
      </div>
      <div
        class="sheet-grid"
        style={{ "grid-template-columns": `150px repeat(${sh.columns().length}, minmax(0, 1fr))` }}
      >
        <div />
        <For each={sh.columns()}>
          {(col) => (
            <div class="sheet-h" classList={{ mine: !!col.mine }} title={col.label}>
              {col.label}
            </div>
          )}
        </For>
        <For each={sh.rows()}>
          {(v) => (
            <>
              <div
                class="sheet-l"
                classList={{ main: s.frameMark(v.state, v.alternative) === "main" }}
                title={v.alternative}
              >
                {alternativeName(v.alternative)}
                <Show when={s.frameMark(v.state, v.alternative) === "main"}>
                  <span class="sheet-star" title="Main">
                    <Icon name="star" />
                  </span>
                </Show>
              </div>
              <For each={sh.columns()}>
                {(col) => (
                  <SheetCellView
                    s={s}
                    v={v}
                    col={col}
                    onPeek={(x, y) => setPeek(x === null ? null : { v, col, x, y })}
                  />
                )}
              </For>
            </>
          )}
        </For>
      </div>
      <Show when={peek()}>
        {(p) => {
          const c = () => sh.cell(p().v, p().col);
          return (
            <Show when={c()}>
              {(cell) => (
                <div
                  class="sheet-peek"
                  style={{ left: `${p().x}px`, top: `${p().y}px` }}
                  aria-hidden="true"
                >
                  <Thumb src={cell().src} width={cell().width} class="sheet-peek-pic" fit whole />
                  <div>
                    <span>{alternativeName(p().v.alternative)}</span>
                    <span>{p().col.label}</span>
                  </div>
                </div>
              )}
            </Show>
          );
        }}
      </Show>
    </div>
  );
}

function SheetCellView(props: {
  s: DesignScreenState;
  v: AlternativeView;
  col: SheetColumn;
  onPeek: (x: number | null, y: number) => void;
}) {
  const sh = props.s.sheet;
  const cell = () => sh.cell(props.v, props.col);
  const still = () => {
    const c = cell()?.still;
    return c ? sh.stills.of(c) : null;
  };
  // The cell's still is asked for once it is in view, so what is scrolled to comes first.
  const [seen, setSeen] = createSignal(false);
  const [broken, setBroken] = createSignal(false);
  let el!: HTMLButtonElement;
  onMount(() => {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    });
    io.observe(el);
    onCleanup(() => io.disconnect());
  });
  createEffect(() => {
    const c = cell()?.still;
    if (seen() && c && !still()) sh.stills.want(c);
  });
  // The cell last open from here: the sheet comes back to it, in view and pointed at.
  createEffect(() => {
    const l = sh.landing();
    if (!l || l.alternative !== props.v.alternative || l.col !== props.col.key) return;
    sh.setLanding(null);
    el.scrollIntoView({ block: "nearest" });
    el.focus({ preventScroll: true });
    sh.setPointed({ v: props.v, col: props.col });
  });
  let hold = 0;
  onCleanup(() => host().window.clearTimeout(hold));
  // Beside the cell, on whichever side has room, within the sheet's scrolled box.
  const peekAt = () => {
    const sheet = el.closest(".sheet");
    if (!sheet) return;
    const r = el.getBoundingClientRect();
    const pr = sheet.getBoundingClientRect();
    let left = r.right - pr.left + 8;
    if (left + PEEK_W > pr.width) left = Math.max(8, r.left - pr.left - PEEK_W - 8);
    const top = Math.max(50, Math.min(r.top - pr.top - 40, pr.height - PEEK_H));
    props.onPeek(left, top + sheet.scrollTop);
  };
  const f = () => ({ v: props.v, col: props.col });
  const mark = () => props.s.markOf(subjectOf(f()));
  const point = (on: boolean) => {
    if (on) sh.setPointed(f());
    else if (sh.pointed()?.v === props.v && sh.pointed()?.col === props.col) sh.setPointed(null);
  };
  return (
    <div
      class="sheet-cellw"
      classList={{ picked: !!mark(), main: mark() === "main" }}
      onPointerEnter={() => point(true)}
      onPointerLeave={() => point(false)}
      onFocusIn={() => point(true)}
      onFocusOut={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) point(false);
      }}
    >
      <button
        type="button"
        class="sheet-cell"
        ref={(b) => (el = b)}
        aria-label={`${alternativeName(props.v.alternative)} · ${props.col.label}${
          mark() === "main" ? ", Main" : mark() ? ", picked" : ""
        }`}
        onPointerEnter={(e) => {
          if (e.pointerType !== "mouse") return;
          hold = host().window.setTimeout(peekAt, 250);
        }}
        onPointerLeave={() => {
          host().window.clearTimeout(hold);
          props.onPeek(null, 0);
        }}
        onDblClick={() => {
          props.onPeek(null, 0);
          sh.openCell(props.v, props.col);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") sh.openCell(props.v, props.col);
        }}
      >
        <Show
          when={!broken() && still()}
          fallback={
            <Show when={cell()}>
              {(c) => (
                <Thumb src={c().src} width={c().width} part={c().part} class="sheet-pic" fit />
              )}
            </Show>
          }
        >
          {(src) => (
            <img
              src={src()}
              alt=""
              decoding="async"
              draggable={false}
              onError={() => setBroken(true)}
            />
          )}
        </Show>
      </button>
      <Show when={mark()}>
        {(k) => (
          <span class="sheet-badge" aria-hidden="true">
            <Icon name={k() === "main" ? "star" : "check"} />
          </span>
        )}
      </Show>
      <MarkPill s={props.s} f={f()} />
    </div>
  );
}
