// Studio's Palettes arrangement: the state on stage in the default and each kept
// palette, a column per palette with light over dark. The pictures are ordinary Thumbs,
// which load a few at a time, and two per column stay within the live-frame budget;
// nothing here settles a palette (the System page and questions do).

import { For, Show } from "solid-js";
import { surfaceUrl } from "./api.ts";
import { CANVAS_MAX } from "./logic.ts";
import { PaletteDot, paletteChoices } from "./PaletteTool.tsx";
import type { DesignScreenState } from "./state.ts";
import { Thumb } from "./Thumb.tsx";

const STATUS_WORD = { default: "Default", kept: "Kept" } as const;
// A column is two live pages, light and dark.
const MAX_COLUMNS = CANVAS_MAX / 2;

// The palettes the board compares: the default and the kept ones.
export const boardPalettes = (s: DesignScreenState) =>
  paletteChoices(s).filter((p) => p.status === "default" || p.status === "kept");

export function PalettesBoard(props: { s: DesignScreenState }) {
  const s = props.s;
  const alternative = () => s.activeAlternative();
  const surface = () => alternative()?.surfaces.findIndex((x) => x.kind === "html") ?? -1;
  const picture = (palette: string, mode: "light" | "dark") => {
    const v = alternative();
    if (!v || surface() < 0) return null;
    return surfaceUrl(v.postId, surface(), {
      version: s.frameVersionOf(v),
      mode,
      p: palette,
      e: v.instancesKey,
      w: v.rewrites,
    });
  };
  return (
    <Show
      when={surface() >= 0}
      fallback={<p class="pboard-empty">This state has no page to picture in a palette.</p>}
    >
      <div class="pboard">
        <For each={boardPalettes(s).slice(0, MAX_COLUMNS)}>
          {(p) => (
            <div class="pboard-col">
              <div class="pboard-hd">
                <PaletteDot p={p} small />
                <b>{p.label}</b>
                <Show when={p.status === "default" || p.status === "kept"}>
                  <span class={`sys-st ${p.status}`}>
                    {STATUS_WORD[p.status as "default" | "kept"]}
                  </span>
                </Show>
              </div>
              <For each={["light", "dark"] as const}>
                {(mode) => (
                  <Show when={picture(p.id, mode)}>
                    {(src) => (
                      <div class="pboard-cell">
                        <span class="pboard-mode">{mode === "light" ? "Light" : "Dark"}</span>
                        <Thumb
                          src={src()}
                          width={s.frameW()}
                          grow={2.2}
                          title={`${p.label}, ${mode}`}
                        />
                      </div>
                    )}
                  </Show>
                )}
              </For>
            </div>
          )}
        </For>
        <Show when={boardPalettes(s).length > MAX_COLUMNS}>
          <p class="pboard-empty">
            {`+${boardPalettes(s).length - MAX_COLUMNS} more kept palettes: the tool strip's palette switcher shows any of them`}
          </p>
        </Show>
      </div>
    </Show>
  );
}
