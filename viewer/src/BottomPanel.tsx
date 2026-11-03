// A phone's bottom panel, opened from the version label: the state's History (one
// line per variant, its versions along it, the one in use marked), the mock's Notes
// where it has them, and the Thread with the agent.

import { createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { surfaceUrl } from "./api.ts";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import {
  type HistoryCell,
  historyLayout,
  sameVersion,
  variantName,
  type VersionStep,
  widthKind,
} from "./logic.ts";
import { Notes, notesShown } from "./Notes.tsx";
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
          <Show when={notesShown(s)}>
            <button
              type="button"
              role="tab"
              aria-selected={tab() === "notes"}
              classList={{ on: tab() === "notes" }}
              onClick={() => s.setPanel("notes")}
            >
              Notes
            </button>
          </Show>
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
        <Switch>
          <Match when={tab() === "history"}>
            <History s={s} />
          </Match>
          <Match when={tab() === "notes"}>
            <Notes s={s} />
          </Match>
          <Match when={tab() === "thread"}>
            <div class="bpthread">
              <Answered s={s} scope="all" />
              <Thread s={s} scroller={body} />
            </div>
          </Match>
        </Switch>
      </div>
    </section>
  );
}

function HistoryHead(props: { s: MockScreenState }) {
  const s = props.s;
  const hidden = () => s.steps().filter((x) => x.hidden).length;
  const visible = () => s.steps().length - hidden();
  const step = () => s.stageStep();
  const inUse = () => sameVersion(s.onStage(), s.inUse());
  return (
    <div class="hh">
      <span class="hcount">{`${visible()} ${visible() === 1 ? "version" : "versions"}`}</span>
      <Show when={!readonly() && step()}>
        {(st) => (
          <Show
            when={st().hidden}
            fallback={
              <button
                type="button"
                class="ib hbin x-remove"
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
                <Icon name="close" />
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
    </div>
  );
}

// Thumb sizes in the tree: a phone design reads as a phone, a wide one as a screen.
const TALL = { w: 44, h: 88 };
const FLAT = { w: 96, h: 64 };
const GAP_X = 26;
const GAP_Y = 30;
const LINE_NAME_H = 20;

function History(props: { s: MockScreenState }) {
  const s = props.s;
  const layout = createMemo(() => historyLayout(s.steps()));
  const size = () => (widthKind(s.frameW()) === "phone" ? TALL : FLAT);
  // Each variant numbers its own versions, so with several, "#1" alone says nothing
  // until its line is named.
  const lines = () => new Set(s.steps().map((st) => st.variant)).size > 1;
  const nameH = () => (lines() ? LINE_NAME_H : 0);
  const rowH = () => size().h + GAP_Y + nameH();
  const x = (c: HistoryCell) => 6 + c.col * (size().w + GAP_X);
  const y = (c: HistoryCell) => 8 + nameH() + c.row * rowH();
  const startsLine = (c: HistoryCell) =>
    lines() && layout().cells.find((o) => o.row === c.row) === c;
  return (
    <Show when={s.steps().length} fallback={<p class="hempty">No versions yet.</p>}>
      <div class="hscroll">
        <div
          class="htree"
          style={{
            width: `${12 + layout().cols * (size().w + GAP_X)}px`,
            height: `${8 + layout().rows * rowH()}px`,
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
                <Show when={startsLine(c)}>
                  <span class="hline">{variantName(c.step.variant)}</span>
                </Show>
                <HistoryThumb s={s} step={c.step} size={size()} />
              </div>
            )}
          </For>
        </div>
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
      : surfaceUrl(props.step.postId, i, {
          version: props.step.version,
          mode: theme(),
          w: props.step.rewrites,
        });
  };
  return (
    <button
      type="button"
      class="hthumb"
      classList={{ on: on(), hid: props.step.hidden }}
      style={{ width: `${props.size.w}px`, height: `${props.size.h}px` }}
      aria-label={`${s.nameOf(props.step)}${current() ? ", in use" : ""}${props.step.hidden ? ", hidden" : ""}`}
      aria-pressed={on()}
      title={s.nameOf(props.step)}
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
