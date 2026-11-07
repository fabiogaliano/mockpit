// Ready, beside a screen's or a component's name: the user's one mark that this is the
// version. It turns to Changed by itself when something newer shows, and a dot on it
// says a component inside isn't Ready. Ideas have none: they are where choosing happens.
// On a phone it is an icon alone, the word in its label: beside a device toggle and the
// view switch, the word left the design's name one letter.

import { createMemo, Show } from "solid-js";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import type { DesignScreenState } from "./state.ts";
import { phoneLayout } from "./viewport.ts";

export function ReadyMark(props: { s: DesignScreenState }) {
  const s = props.s;
  const m = () => s.design();
  const drawn = () => (m()?.alternatives.length ?? 0) > 0;
  const word = () => m()?.status ?? "In design";
  const set = () => word() !== "In design";
  // The components inside whose own mark isn't Ready, in the words their covers use.
  const notReady = createMemo(() =>
    (m()?.builtFrom ?? [])
      .filter((b) => !b.ready || b.changed)
      .map((b) => `${b.slug} (${b.ready ? "Changed" : "In design"})`),
  );
  const title = () => {
    const what =
      word() === "Changed"
        ? "Changed since it was marked Ready. Mark what shows now Ready"
        : word() === "Ready"
          ? "Ready: this is the version. Take the mark off"
          : "Mark Ready: this is the version";
    return notReady().length ? `${what}. Not Ready inside: ${notReady().join(", ")}` : what;
  };
  return (
    <Show when={s.product() && drawn()}>
      <Show
        when={!readonly()}
        fallback={
          <Show when={set()}>
            <span
              class="ready-mark"
              classList={{ compact: phoneLayout() }}
              data-ready={word()}
              title={word()}
            >
              <Show when={phoneLayout()} fallback={word()}>
                <Icon name={word() === "Changed" ? "recent" : "check"} />
                <span class="sr-only">{word()}</span>
              </Show>
            </span>
          </Show>
        }
      >
        <button
          type="button"
          class="ready-mark"
          classList={{ compact: phoneLayout() }}
          data-ready={word()}
          aria-pressed={set()}
          title={title()}
          aria-label={title()}
          onClick={() => void s.markReady()}
        >
          <Show
            when={phoneLayout()}
            fallback={
              <>
                <Show when={word() === "Ready"}>
                  <Icon name="check" />
                </Show>
                <span>{word() === "Changed" ? "Changed" : "Ready"}</span>
              </>
            }
          >
            <Icon name={word() === "Changed" ? "recent" : "check"} />
          </Show>
          <Show when={notReady().length}>
            <i class="ready-inside" aria-hidden="true" />
          </Show>
        </button>
      </Show>
    </Show>
  );
}
