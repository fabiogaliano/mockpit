// The bottom panel, opened from the version label: the state's History (one
// line per variant, its versions along it, the one in use marked) and the
// Thread with the agent.

import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { surfaceUrl } from "./api.ts";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import {
  type HistoryCell,
  historyLayout,
  sameVersion,
  type VersionStep,
  widthKind,
} from "./logic.ts";
import { Answered } from "./Questions.tsx";
import type { MockScreenState } from "./state.ts";
import { theme } from "./theme.ts";
import { Thread } from "./Thread.tsx";
import { Thumb } from "./Thumb.tsx";

export function BottomPanel(props: { s: MockScreenState; onHeight: (h: number) => void }) {
  const s = props.s;
  let el!: HTMLElement;
  const [body, setBody] = createSignal<HTMLElement>();
  onMount(() => {
    const ro = new ResizeObserver(() => props.onHeight(el.offsetHeight));
    ro.observe(el);
    props.onHeight(el.offsetHeight);
    onCleanup(() => {
      ro.disconnect();
      props.onHeight(0);
    });
  });
  const tab = () => s.panel() ?? "history";
  return (
    <section class="bpanel" aria-label="History and thread" ref={(e) => (el = e)}>
      <div class="bphead">
        <div class="ptabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab() === "history"}
            classList={{ on: tab() === "history" }}
            onClick={() => s.setPanel("history")}
          >
            History
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab() === "thread"}
            classList={{ on: tab() === "thread" }}
            onClick={() => s.setPanel("thread")}
          >
            Thread
          </button>
        </div>
        <Show when={tab() === "history"}>
          <HistoryHead s={s} />
        </Show>
        <span class="grow" />
        <button
          type="button"
          class="ib"
          aria-label="Close history and thread"
          onClick={() => s.setPanel(null)}
        >
          <Icon name="close" />
        </button>
      </div>
      <div class="bpbody" ref={setBody}>
        <Show
          when={tab() === "history"}
          fallback={
            <div class="bpthread">
              <Answered s={s} scope="all" />
              <Thread s={s} scroller={body} />
            </div>
          }
        >
          <History s={s} />
        </Show>
      </div>
    </section>
  );
}

// Shared by the head's controls and the tree below them.
const [showHidden, setShowHidden] = createSignal(false);
const [usedOnly, setUsedOnly] = createSignal(false);

function HistoryHead(props: { s: MockScreenState }) {
  const s = props.s;
  const hidden = () => s.steps().filter((x) => x.hidden).length;
  const visible = () => s.steps().length - hidden();
  const step = () => s.stageStep();
  const inUse = () => sameVersion(s.onStage(), s.inUse());
  return (
    <div class="hh">
      <span class="hcount">{`${visible()} ${visible() === 1 ? "version" : "versions"}`}</span>
      <Show when={hidden()}>
        <button type="button" class="hidlink" onClick={() => setShowHidden(!showHidden())}>
          {showHidden() ? "Fold hidden" : `${hidden()} hidden`}
        </button>
      </Show>
      <Show when={!readonly() && step()}>
        {(st) => (
          <Show
            when={st().hidden}
            fallback={
              <button
                type="button"
                class="ib hbin"
                classList={{ off: inUse() }}
                aria-disabled={inUse()}
                aria-label={
                  inUse()
                    ? `${s.nameOf(st())} is in use and can't be hidden`
                    : `Hide ${s.nameOf(st())}`
                }
                title={inUse() ? "In use. Use another version first." : `Hide ${s.nameOf(st())}`}
                onClick={() => !inUse() && void s.hideVersion(st(), true)}
              >
                <Icon name="trash" />
              </button>
            }
          >
            <button
              type="button"
              class="btn hrestore"
              onClick={() => void s.hideVersion(st(), false)}
            >
              Restore
            </button>
          </Show>
        )}
      </Show>
      <label class="honly">
        <input
          type="checkbox"
          checked={usedOnly()}
          onChange={(e) => setUsedOnly(e.currentTarget.checked)}
        />
        Only ones I used
      </label>
    </div>
  );
}

// Thumb sizes in the tree: a phone design reads as a phone, a wide one as a screen.
const TALL = { w: 44, h: 88 };
const FLAT = { w: 96, h: 64 };
const GAP_X = 26;
const GAP_Y = 30;

function History(props: { s: MockScreenState }) {
  const s = props.s;
  const used = (x: VersionStep) =>
    sameVersion(x, s.inUse()) || s.usedBefore().some((r) => sameVersion(r, x));
  const shown = createMemo(() =>
    s
      .steps()
      .filter(
        (x) =>
          (showHidden() || !x.hidden || sameVersion(x, s.onStage())) && (!usedOnly() || used(x)),
      ),
  );
  const layout = createMemo(() => historyLayout(shown()));
  const size = () => (widthKind(s.frameW()) === "phone" ? TALL : FLAT);
  const x = (c: HistoryCell) => 6 + c.col * (size().w + GAP_X);
  const y = (c: HistoryCell) => 8 + c.row * (size().h + GAP_Y);
  return (
    <Show
      when={shown().length}
      fallback={<p class="hempty">{usedOnly() ? "Nothing used yet." : "No versions yet."}</p>}
    >
      <div class="hscroll">
        <Show
          when={!usedOnly()}
          fallback={
            <div class="hrow">
              <For each={shown()}>{(st) => <HistoryThumb s={s} step={st} size={size()} />}</For>
            </div>
          }
        >
          <div
            class="htree"
            style={{
              width: `${12 + layout().cols * (size().w + GAP_X)}px`,
              height: `${8 + layout().rows * (size().h + GAP_Y)}px`,
            }}
          >
            <svg aria-hidden="true">
              <For each={layout().edges}>
                {(e) => {
                  const d = () => {
                    const x1 = x(e.from) + size().w;
                    const y1 = y(e.from) + size().h / 2;
                    const x2 = x(e.to);
                    const y2 = y(e.to) + size().h / 2;
                    return `M${x1} ${y1} C ${x1 + 12} ${y1}, ${x2 - 12} ${y2}, ${x2} ${y2}`;
                  };
                  return <path d={d()} />;
                }}
              </For>
            </svg>
            <For each={layout().cells}>
              {(c) => (
                <div class="hcell" style={{ left: `${x(c)}px`, top: `${y(c)}px` }}>
                  <HistoryThumb s={s} step={c.step} size={size()} />
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}

function HistoryThumb(props: {
  s: MockScreenState;
  step: VersionStep;
  size: { w: number; h: number };
}) {
  const s = props.s;
  const on = () => sameVersion(props.step, s.onStage());
  const current = () => sameVersion(props.step, s.inUse());
  const was = () => !current() && s.usedBefore().some((r) => sameVersion(r, props.step));
  const src = () => {
    const i = props.step.kinds.findIndex((k) => k === "html");
    return i < 0
      ? null
      : surfaceUrl(props.step.postId, i, { version: props.step.version, mode: theme() });
  };
  return (
    <button
      type="button"
      class="hthumb"
      classList={{ on: on(), hid: props.step.hidden }}
      style={{ width: `${props.size.w}px`, height: `${props.size.h}px` }}
      aria-label={`${s.nameOf(props.step)}${current() ? ", in use" : ""}${props.step.hidden ? ", hidden" : ""}`}
      aria-pressed={on()}
      data-version={props.step.n}
      onClick={() => s.showVersion(props.step)}
    >
      <Show when={src()} fallback={<span class="hkind">{props.step.kinds[0] ?? ""}</span>}>
        {(u) => <Thumb src={u()} width={s.frameW()} fit whole />}
      </Show>
      <Show when={current()}>
        <span class="mk cur" aria-hidden="true">
          <Icon name="check" />
        </span>
      </Show>
      <Show when={was()}>
        <span class="mk was" aria-hidden="true" />
      </Show>
      <span class="n">{`#${props.step.version}`}</span>
    </button>
  );
}
