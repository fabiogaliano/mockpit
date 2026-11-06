// The palette the frames are viewed in: a tiny swatch of the palette on screen
// that opens a menu of the project's visible palettes. A view setting kept per
// project; it settles nothing and sends nothing. Shown once there are two palettes
// to look between.

import { createSignal, For, Show } from "solid-js";
import type { PaletteChoice } from "./api.ts";
import { usePopover } from "./popover.ts";
import type { DesignScreenState } from "./state.ts";
import { palettePick, setPalettePick } from "./systemRev.ts";
import { theme } from "./theme.ts";

const ORDER = { default: 0, kept: 1, open: 2, hidden: 3 } as const;
const STATUS_WORD = { default: "Default", kept: "Kept", open: "", hidden: "" } as const;

export function PaletteDot(props: { p: PaletteChoice; small?: boolean }) {
  return (
    <span class="pdot" classList={{ sm: !!props.small }} aria-hidden="true">
      <For each={props.p.swatch[theme()]}>{(c) => <i style={{ "background-color": c }} />}</For>
    </span>
  );
}

// The palettes worth switching between, default first.
export const paletteChoices = (s: DesignScreenState): PaletteChoice[] =>
  (s.design()?.palettes ?? [])
    .filter((p) => p.status !== "hidden")
    .sort((a, b) => ORDER[a.status] - ORDER[b.status]);

export function PaletteTool(props: { s: DesignScreenState }) {
  const [open, setOpen] = createSignal(false);
  let btn: HTMLButtonElement | undefined;
  let pop: HTMLDivElement | undefined;
  usePopover(
    open,
    () => setOpen(false),
    () => btn,
    () => pop,
  );
  const project = () => props.s.design()?.project;
  const visible = () => paletteChoices(props.s);
  const def = () => visible().find((p) => p.status === "default");
  // A pick the system no longer offers reads as the default, as the server renders it.
  const current = () => visible().find((p) => p.id === palettePick(project())) ?? def();
  const label = () => {
    const c = current();
    return c ? `View in: ${c.label}${c.status === "default" ? ", the default" : ""}` : "";
  };
  const choose = (p: PaletteChoice) => {
    const proj = project();
    if (proj) setPalettePick(proj, p.status === "default" ? null : p.id);
    setOpen(false);
  };
  return (
    <Show when={visible().length > 1 && current()}>
      {(c) => (
        <div class="wpick">
          <button
            type="button"
            class="ib ppick"
            classList={{ on: open(), off: c().status !== "default" }}
            ref={(el) => (btn = el)}
            aria-haspopup="menu"
            aria-expanded={open()}
            aria-label={label()}
            title={label()}
            onClick={() => setOpen(!open())}
          >
            <PaletteDot p={c()} />
          </button>
          <Show when={open()}>
            <div class="wpop" ref={(el) => (pop = el)}>
              <div class="wmenu pmenu" role="menu" aria-label="View in">
                <div class="pmenu-hd">View in</div>
                <For each={visible()}>
                  {(p, i) => (
                    <>
                      <Show
                        when={
                          i() > 0 && p.status === "open" && visible()[i() - 1].status !== "open"
                        }
                      >
                        <span class="wpop-sep" />
                      </Show>
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={c().id === p.id}
                        onClick={() => choose(p)}
                      >
                        <PaletteDot p={p} small />
                        {p.label}
                        <small>{STATUS_WORD[p.status]}</small>
                      </button>
                    </>
                  )}
                </For>
                <span class="wpop-sep" />
                <div class="pmenu-note">Only changes what you see here. Nothing is sent.</div>
              </div>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}
