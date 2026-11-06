// Studio's one row of controls: which state, which of them, arranged how. It sits in the
// design's header rather than over the cards, so it keeps its place whichever arrangement
// is up and whether or not a preview stands beside them. Each control is there only when
// it has more than one thing to offer.

import { createSignal, For, type JSX, Show } from "solid-js";
import { Icon, type IconName } from "./icons.tsx";
import { usePopover } from "./popover.ts";
import { phoneLayout } from "./viewport.ts";

export type Arrangement = "answers" | "wall" | "columns" | "palettes" | "grid";

const ARRANGEMENTS: Record<Arrangement, { icon: IconName; label: string }> = {
  answers: { icon: "question", label: "Answers" },
  wall: { icon: "grid", label: "Wall" },
  columns: { icon: "columns", label: "Columns" },
  palettes: { icon: "palette", label: "Palettes" },
  grid: { icon: "table", label: "Grid" },
};

export function ArrangeSwitch(props: {
  on: Arrangement;
  options: Arrangement[];
  onPick: (to: Arrangement) => void;
}) {
  return (
    <div class="vswitch sbar-arrange" role="group" aria-label="Arrange">
      <For each={props.options}>
        {(id) => (
          <button
            type="button"
            aria-pressed={props.on === id}
            aria-label={ARRANGEMENTS[id].label}
            title={ARRANGEMENTS[id].label}
            onClick={() => props.onPick(id)}
          >
            <Icon name={ARRANGEMENTS[id].icon} />
          </button>
        )}
      </For>
    </div>
  );
}

export type BarTab = {
  id: string;
  label: string;
  n: number;
  on: boolean;
  owes?: boolean;
  onPick: () => void;
};

export type BarShow = { id: string; label: string; n: number };

function ShowMenu(props: { options: BarShow[]; on: string; onPick: (id: string) => void }) {
  const [open, setOpen] = createSignal(false);
  let button: HTMLButtonElement | undefined;
  let pop: HTMLDivElement | undefined;
  usePopover(
    open,
    () => setOpen(false),
    () => button,
    () => pop,
  );
  const current = () => props.options.find((x) => x.id === props.on);
  return (
    <div class="sbar-show">
      <button
        type="button"
        class="sbar-showb"
        ref={(el) => (button = el)}
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={() => setOpen((on) => !on)}
      >
        {current()?.label}
        <span class="n">{current()?.n}</span>
        <Icon name="down" />
      </button>
      <Show when={open()}>
        <div class="wmenu" role="menu" ref={(el) => (pop = el)}>
          <For each={props.options}>
            {(x) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={x.id === props.on}
                onClick={() => {
                  props.onPick(x.id);
                  setOpen(false);
                }}
              >
                {x.label}
                <small>{x.n}</small>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export function StudioBar(props: {
  tabs?: BarTab[];
  query?: string;
  onQuery?: (q: string) => void;
  show?: BarShow[];
  showOn?: string;
  onShow?: (id: string) => void;
  onAdd?: () => void;
  arrange?: JSX.Element;
}) {
  const tabs = () => props.tabs ?? [];
  const shows = () => props.show ?? [];
  return (
    <div class="sbar" classList={{ phone: phoneLayout() }}>
      <Show when={tabs().length > 1}>
        <div class="sbar-tabs" role="radiogroup" aria-label="State">
          <For each={tabs()}>
            {(t) => (
              <button
                type="button"
                role="radio"
                aria-checked={t.on}
                aria-label={
                  t.owes ? `${t.label}, ${t.n}, a question is waiting` : `${t.label}, ${t.n}`
                }
                onClick={() => t.onPick()}
              >
                {t.label}
                <span class="n">{t.n}</span>
                <Show when={t.owes}>
                  <i class="ftab-q" aria-hidden="true" />
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
      <span class="sbar-sp" />
      <Show when={props.onAdd}>
        {(add) => (
          <button type="button" class="sbar-showb" onClick={() => add()()}>
            <Icon name="plus" />
            Add candidate
          </button>
        )}
      </Show>
      <Show when={props.onQuery && !phoneLayout()}>
        <input
          class="slpick-filter sbar-find"
          type="search"
          placeholder="Filter"
          aria-label="Filter by name or description"
          title="By name or description"
          value={props.query ?? ""}
          onInput={(e) => props.onQuery?.(e.currentTarget.value)}
        />
      </Show>
      <Show when={shows().length > 1}>
        <ShowMenu options={shows()} on={props.showOn ?? ""} onPick={(id) => props.onShow?.(id)} />
      </Show>
      {props.arrange}
    </div>
  );
}
