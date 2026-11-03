// Copies a line, and says so on the button. Plain http on a LAN address has no
// clipboard, so the line beside it stays selectable and the button says to select it.

import { createSignal, onCleanup } from "solid-js";
import { host } from "./host.ts";

export function CopyButton(props: { text: string; label: string }) {
  const [said, setSaid] = createSignal<string | null>(null);
  let timer = 0;
  onCleanup(() => host().window.clearTimeout(timer));
  const say = (word: string) => {
    setSaid(word);
    host().window.clearTimeout(timer);
    timer = host().window.setTimeout(() => setSaid(null), 2000);
  };
  const copy = () => {
    const copying = host().window.navigator.clipboard?.writeText(props.text);
    if (!copying) return say("Select it");
    copying.then(
      () => say("Copied"),
      () => say("Select it"),
    );
  };
  return (
    <button type="button" class="btn copybtn" aria-label={props.label} onClick={copy}>
      <span aria-live="polite">{said() ?? "Copy"}</span>
    </button>
  );
}
