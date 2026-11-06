// An agent changed the project's system while this design was on screen: every frame
// already wears it, so the note names the change and offers the way back. See before
// only looks (frames peek at the older revision through `sys`); Restore is the user's
// own change, a new revision the agent hears.

import { createSignal, Show } from "solid-js";
import { api } from "./api.ts";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import type { DesignScreenState } from "./state.ts";
import {
  agentChangesBetween,
  dismissSystemChange,
  peekRev,
  setPeek,
  systemChange,
} from "./systemRev.ts";

export function SystemNote(props: { s: DesignScreenState }) {
  const [busy, setBusy] = createSignal(false);
  const live = () => {
    const c = systemChange();
    return !readonly() && c && c.project === props.s.design()?.project ? c : null;
  };
  async function restore(project: string, rev: number) {
    const answering = systemChange()?.to ?? rev;
    setBusy(true);
    try {
      const done = await api.systemDecide(project, { restore: rev });
      dismissSystemChange();
      // What an agent changed while this was in flight was replaced too: say so.
      const meanwhile = agentChangesBetween(project, answering, done.rev);
      props.s.setToast({
        text: meanwhile.length
          ? `Restored the system to r${rev}, which also undid what the agent changed meanwhile: ${meanwhile.join("; ")}.`
          : `Restored the system to r${rev}. The agent will hear it.`,
      });
    } catch (err) {
      props.s.setToast({ text: err instanceof Error ? err.message : "Couldn't restore it" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Show when={live()}>
      {(c) => (
        <div class="changed-note" role="status">
          <Show
            when={c().from > 0 && peekRev() === c().from}
            fallback={
              <>
                <Show
                  when={c().from > 0}
                  fallback={
                    <span class="changed-see">
                      <i class="dot sys" />
                      <span>{`System added: ${c().summary}`}</span>
                    </span>
                  }
                >
                  <button type="button" class="changed-see" onClick={() => setPeek(c().from)}>
                    <i class="dot sys" />
                    <span>{`System changed: ${c().summary} · See before ›`}</span>
                  </button>
                  <button
                    type="button"
                    class="btn"
                    disabled={busy()}
                    onClick={() => void restore(c().project, c().from)}
                  >
                    <span class="changed-name">{`Restore r${c().from}`}</span>
                  </button>
                </Show>
                <button
                  type="button"
                  class="ib"
                  aria-label="Keep the change"
                  title="Keep the change"
                  onClick={dismissSystemChange}
                >
                  <Icon name="close" />
                </button>
              </>
            }
          >
            <span class="changed-name changed-text">{`Seeing r${c().from}, before the change`}</span>
            <button type="button" class="btn" onClick={() => setPeek(null)}>
              <span class="changed-name">Back to now</span>
            </button>
            <button
              type="button"
              class="btn go"
              disabled={busy()}
              onClick={() => void restore(c().project, c().from)}
            >
              <span class="changed-name">{`Restore r${c().from}`}</span>
            </button>
          </Show>
        </div>
      )}
    </Show>
  );
}
