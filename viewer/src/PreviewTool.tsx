// How the design is being previewed: the widths to see it at, and the code to feel it on
// the device it's for. Focus's ⋯ opens the panel; a phone has no ⋯ and is already that
// device, so it keeps the widths as a button in its top row.

import { createSignal, For, Show } from "solid-js";
import { Icon, type IconName } from "./icons.tsx";
import { wideWidth, widthChoices, widthKind, widthLabel } from "./logic.ts";
import { usePopover } from "./popover.ts";
import { QrBody } from "./QrTool.tsx";
import type { DesignScreenState } from "./state.ts";
import { phoneLayout } from "./viewport.ts";

// What the preview offers now, which names the button or the menu item that opens it.
export function previewNow(s: DesignScreenState) {
  const widths = () => widthChoices(s.design()?.widths ?? []);
  // One width is no choice: the label on the artboard already names it.
  const choosing = () => widths().length > 1;
  const iconOf = (w: number): IconName => (w === wideWidth(widths()) ? "wide" : widthKind(w));
  const current = (): { icon: IconName; label: string } => {
    if (!choosing()) return { icon: "qr", label: "Open on a phone or iPad" };
    if (s.zoom() === "all") return { icon: "all", label: "Preview: All widths" };
    const w = s.frameW();
    return { icon: iconOf(w), label: `Preview: ${widthLabel(w)} · ${w}px` };
  };
  return { widths, choosing, iconOf, current };
}

export function PreviewPanel(props: {
  s: DesignScreenState;
  qr: boolean;
  onDone: () => void;
  ref?: (el: HTMLDivElement) => void;
}) {
  const s = props.s;
  const { widths, choosing, iconOf } = previewNow(s);
  const [codeOpen, setCodeOpen] = createSignal(false);
  // A phone shows one artboard at a time, never the row of them.
  const all = () => choosing() && !phoneLayout();
  const choose = (w: number | "all") => {
    if (w === "all") s.setZoom("all");
    else {
      if (w !== s.frameW()) s.setFrameW(w);
      s.setZoom("fit");
    }
    props.onDone();
  };
  return (
    <div
      class="wpop"
      classList={{ "wpop-code": codeOpen() || !choosing() }}
      role="dialog"
      aria-label="Preview"
      ref={props.ref}
    >
      <Show when={choosing()}>
        <div class="wmenu" role="menu" aria-label="Width">
          <For each={widths()}>
            {(w) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={s.frameW() === w && s.zoom() !== "all"}
                data-w={w}
                onClick={() => choose(w)}
              >
                <Icon name={iconOf(w)} />
                {widthLabel(w)}
                <small>{w}</small>
              </button>
            )}
          </For>
          <Show when={all()}>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={s.zoom() === "all"}
              data-w="all"
              onClick={() => choose("all")}
            >
              <Icon name="all" />
              All widths
            </button>
          </Show>
        </div>
        <Show when={props.qr}>
          <div class="wmenu">
            <span class="wpop-sep" />
            <button
              type="button"
              aria-expanded={codeOpen()}
              onClick={() => setCodeOpen(!codeOpen())}
            >
              <Icon name="qr" />
              Open on a phone or iPad
            </button>
          </div>
        </Show>
      </Show>
      {/* Only once asked for: it reads what a phone could reach from the server. */}
      <Show when={props.qr && (codeOpen() || !choosing())}>
        <div class="qrpop inset">
          <QrBody s={s} />
        </div>
      </Show>
    </div>
  );
}

export function PreviewTool(props: { s: DesignScreenState; qr: boolean }) {
  const { choosing, current } = previewNow(props.s);
  const [open, setOpen] = createSignal(false);
  let btn: HTMLButtonElement | undefined;
  let pop: HTMLDivElement | undefined;
  usePopover(
    open,
    () => setOpen(false),
    () => btn,
    () => pop,
  );
  return (
    <Show when={choosing() || props.qr}>
      <div class="wpick">
        <button
          type="button"
          class="ib"
          classList={{ on: open() }}
          ref={(el) => (btn = el)}
          aria-haspopup="dialog"
          aria-expanded={open()}
          aria-label={current().label}
          title={current().label}
          onClick={() => setOpen(!open())}
        >
          <Icon name={current().icon} />
        </button>
        <Show when={open()}>
          <PreviewPanel
            s={props.s}
            qr={props.qr}
            onDone={() => setOpen(false)}
            ref={(el) => (pop = el)}
          />
        </Show>
      </div>
    </Show>
  );
}
