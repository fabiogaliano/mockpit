// What a declared screen doesn't have yet. A missing standard state is an outline in the
// list of states, with a way to say it doesn't apply and a way to ask for it, both
// beside + New state. A whole screen or state that was planned and not drawn stands on
// the canvas as an outline of its own, where the design will go.

import { createSignal, For, Show } from "solid-js";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { notesShown } from "./Notes.tsx";
import type { DesignScreenState } from "./state.ts";

const MAX_NAME = 120;
const MAX_DETAIL = 500;

// Rows in the left margin, under the states.
export function OutlineRows(props: { s: DesignScreenState }) {
  const s = props.s;
  return (
    <>
      <For each={s.stateOutlines()}>
        {(o) => (
          <div class="lm-item lm-outline">
            <button
              type="button"
              class="lm-row"
              aria-label={`${o.name}, ${o.requested ? "asked for" : "not drawn"}`}
              onClick={() => s.setAskingState({ name: o.name })}
            >
              <span class="lm-pic lm-dash" classList={{ flat: s.frameW() > 600 }} />
              <span class="lm-text">
                <b>{o.name}</b>
                <small>{o.requested ? "Asked for" : "Not drawn"}</small>
              </span>
            </button>
            <button
              type="button"
              class="ib lm-hide x-remove"
              aria-label={`${o.name} doesn't apply`}
              title="Doesn't apply"
              onClick={() => void s.dismissOutline(o.name)}
            >
              <Icon name="close" />
            </button>
          </div>
        )}
      </For>
      <button type="button" class="lm-row lm-new" onClick={() => s.setAskingState({ name: "" })}>
        <Icon name="plus" />
        New state
      </button>
    </>
  );
}

// The same in the flow bar, where margins can't stand. A tap opens the card below, which
// holds "doesn't apply" too: no room here for a target that small.
export function OutlineChips(props: { s: DesignScreenState }) {
  const s = props.s;
  return (
    <>
      <For each={s.stateOutlines()}>
        {(o) => (
          <button
            type="button"
            class="ftab ftab-outline"
            aria-label={`${o.name}, ${o.requested ? "asked for" : "not drawn"}`}
            onClick={() => s.setAskingState({ name: o.name })}
          >
            <span>{o.name}</span>
          </button>
        )}
      </For>
      <button
        type="button"
        class="ftab ftab-new"
        aria-label="New state"
        onClick={() => s.setAskingState({ name: "" })}
      >
        <Icon name="plus" />
        <span>New state</span>
      </button>
    </>
  );
}

// Asking for a state: named by the outline it came from, or typed. It goes as a reply of
// its own and nothing waits for it.
export function StateAsk(props: { s: DesignScreenState }) {
  const s = props.s;
  const [typed, setTyped] = createSignal("");
  const [detail, setDetail] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const fixed = () => s.askingState()?.name ?? "";
  const name = () => (fixed() || typed()).trim();
  const requested = () => s.stateOutlines().find((o) => o.name === fixed())?.requested ?? false;
  const shut = () => {
    setTyped("");
    setDetail("");
    s.setAskingState(null);
  };
  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (!name() || busy()) return;
    setBusy(true);
    const sent = await s.askForState(name(), detail());
    setBusy(false);
    if (sent) shut();
  };
  return (
    <Show when={s.askingState()}>
      <form class="stateask" aria-label="Ask for a state" onSubmit={submit}>
        <div class="stateask-top">
          <Show
            when={fixed()}
            fallback={
              <input
                class="stateask-name"
                aria-label="Name of the state"
                placeholder="Name of the state"
                maxLength={MAX_NAME}
                value={typed()}
                onInput={(e) => setTyped(e.currentTarget.value)}
                ref={(el) => queueMicrotask(() => el.focus())}
              />
            }
          >
            <b>{fixed()}</b>
            <Show when={requested()}>
              <span class="stateask-note">Already asked for</span>
            </Show>
          </Show>
          <span class="grow" />
          <button type="button" class="ib" aria-label="Close" title="Close" onClick={shut}>
            <Icon name="close" />
          </button>
        </div>
        <input
          class="stateask-detail"
          aria-label="What it should show"
          placeholder="What it should show (optional)"
          maxLength={MAX_DETAIL}
          value={detail()}
          onInput={(e) => setDetail(e.currentTarget.value)}
        />
        <div class="stateask-acts">
          <button type="submit" class="btn" disabled={!name() || busy()}>
            Ask your agent
          </button>
          <Show when={fixed()}>
            <button
              type="button"
              class="btn"
              onClick={() => {
                const was = fixed();
                shut();
                void s.dismissOutline(was);
              }}
            >
              Doesn't apply
            </button>
          </Show>
        </div>
      </form>
    </Show>
  );
}

// Planned and not drawn, as big as a design would be: what it's called, and what the user
// can do about it. The agent's next publish here takes its place.
export function PlannedStage(props: { s: DesignScreenState }) {
  const s = props.s;
  const m = () => s.design();
  const whole = () => !s.variants().length;
  const state = () => s.activeState();
  return (
    <div class="planned-stage">
      <div class="planned-card" classList={{ phone: s.frameW() <= 600 }}>
        <span class="planned-tag">Planned</span>
        <h2>{state() ?? m()?.title}</h2>
        <p>Not drawn yet. It fills in when your agent publishes here.</p>
        <Show when={m()?.source}>{(src) => <p class="planned-src">{src()}</p>}</Show>
        <div class="planned-acts">
          <Show when={!readonly() && !m()?.archivedAt}>
            <button type="button" class="btn" onClick={() => void s.askToDraw()}>
              Ask your agent to draw it
            </button>
          </Show>
          <Show when={notesShown(s)}>
            <button type="button" class="btn" onClick={() => s.setPanel("notes")}>
              Notes
            </button>
          </Show>
          <Show when={!readonly() && !m()?.archivedAt}>
            <button
              type="button"
              class="btn"
              onClick={() => void (whole() ? s.archiveDesign() : s.dropPlannedState(state() ?? ""))}
            >
              Not needed
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
}
