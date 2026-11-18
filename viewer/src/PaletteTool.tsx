// What the frames are viewed in: light or dark and the project's visible palettes, from
// Focus's ⋯, or on a phone a tiny swatch of the palette on screen. View settings kept per project;
// they settle nothing and send nothing. Shown once the project has a palette.

import { createSignal, For, Show } from "solid-js";
import type { PaletteChoice } from "./api.ts";
import { usePopover } from "./popover.ts";
import type { DesignScreenState } from "./state.ts";
import { modePick, palettePick, setModePick, setPalettePick } from "./systemRev.ts";
import { type Theme, theme } from "./theme.ts";

const ORDER = { default: 0, kept: 1, open: 2, hidden: 3 } as const;
const STATUS_WORD = { default: "Default", kept: "Kept", open: "", hidden: "" } as const;

function PaletteDot(props: { p: PaletteChoice; small?: boolean; mode?: Theme }) {
  return (
    <span class="pdot" classList={{ sm: !!props.small }} aria-hidden="true">
      <For each={props.p.swatch[props.mode ?? theme()]}>
        {(c) => <i style={{ "background-color": c }} />}
      </For>
    </span>
  );
}

const MODES: { id: Theme; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

// The palettes worth switching between, default first.
export const paletteChoices = (s: DesignScreenState): PaletteChoice[] =>
  (s.design()?.palettes ?? [])
    .filter((p) => p.status !== "hidden")
    .sort((a, b) => ORDER[a.status] - ORDER[b.status]);

// The palette on screen and the mode it's seen in, as the button or the ⋯ item shows it.
export function paletteNow(s: DesignScreenState) {
  const project = () => s.design()?.project;
  const visible = () => paletteChoices(s);
  const def = () => visible().find((p) => p.status === "default");
  // A pick the system no longer offers reads as the default, as the server renders it.
  const current = () => visible().find((p) => p.id === palettePick(project())) ?? def();
  const mode = () => modePick(project()) ?? theme();
  const label = () => {
    const c = current();
    if (!c) return "";
    return `View in: ${c.label}${c.status === "default" ? ", the default" : ""}, ${mode()}`;
  };
  return { project, visible, current, mode, label };
}

export function PaletteDotNow(props: { s: DesignScreenState }) {
  const { current, mode } = paletteNow(props.s);
  return <Show when={current()}>{(c) => <PaletteDot p={c()} small mode={mode()} />}</Show>;
}

export function PalettePanel(props: {
  s: DesignScreenState;
  onDone: () => void;
  ref?: (el: HTMLDivElement) => void;
}) {
  const { project, visible, current, mode } = paletteNow(props.s);
  const pickMode = (m: Theme) => {
    const proj = project();
    if (proj) setModePick(proj, m);
  };
  const choose = (p: PaletteChoice) => {
    const proj = project();
    if (proj) setPalettePick(proj, p.status === "default" ? null : p.id);
    props.onDone();
  };
  return (
    <Show when={current()}>
      {(c) => (
        <div class="wpop" ref={props.ref}>
          <div class="wmenu pmenu" role="menu" aria-label="View in">
            <div class="pmenu-hd">View in</div>
            <div class="vswitch pmode" role="group" aria-label="Mode">
              <For each={MODES}>
                {(m) => (
                  <button
                    type="button"
                    aria-pressed={mode() === m.id}
                    disabled={!!c().oneMode}
                    onClick={() => pickMode(m.id)}
                  >
                    {m.label}
                  </button>
                )}
              </For>
            </div>
            <Show when={visible().length > 1}>
              <span class="wpop-sep" />
            </Show>
            <For each={visible().length > 1 ? visible() : []}>
              {(p, i) => (
                <>
                  <Show
                    when={i() > 0 && p.status === "open" && visible()[i() - 1].status !== "open"}
                  >
                    <span class="wpop-sep" />
                  </Show>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={c().id === p.id}
                    onClick={() => choose(p)}
                  >
                    <PaletteDot p={p} small mode={mode()} />
                    {p.label}
                    <small>{STATUS_WORD[p.status]}</small>
                  </button>
                </>
              )}
            </For>
            <span class="wpop-sep" />
            <div class="pmenu-note">Preview only</div>
          </div>
        </div>
      )}
    </Show>
  );
}

export function PaletteTool(props: { s: DesignScreenState }) {
  const { current, mode, label } = paletteNow(props.s);
  const [open, setOpen] = createSignal(false);
  let btn: HTMLButtonElement | undefined;
  let pop: HTMLDivElement | undefined;
  usePopover(
    open,
    () => setOpen(false),
    () => btn,
    () => pop,
  );
  // Away from what the app shows unasked: a palette not the default, or the other mode.
  const away = () => current()?.status !== "default" || mode() !== theme();
  return (
    <Show when={current()}>
      {(c) => (
        <div class="wpick">
          <button
            type="button"
            class="ib ppick"
            classList={{ on: open(), off: away() }}
            ref={(el) => (btn = el)}
            aria-haspopup="menu"
            aria-expanded={open()}
            aria-label={label()}
            title={label()}
            onClick={() => setOpen(!open())}
          >
            <PaletteDot p={c()} mode={mode()} />
          </button>
          <Show when={open()}>
            <PalettePanel s={props.s} onDone={() => setOpen(false)} ref={(el) => (pop = el)} />
          </Show>
        </div>
      )}
    </Show>
  );
}
