// What a declared screen doesn't have yet. The standard states it lacks fold behind
// + New state: the card it opens offers them by name, each with a way to ask for it and a
// way to say it doesn't apply. A whole screen or state that was planned and not drawn
// stands on the canvas as an outline of its own, where the design will go.

import { createSignal, For, Show } from "solid-js";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { specShown } from "./Spec.tsx";
import type { DesignScreenState } from "./state.ts";

const MAX_NAME = 120;
const MAX_DETAIL = 500;

// The row in the left margin, under the states.
export function OutlineRows(props: { s: DesignScreenState }) {
  return (
    <button
      type="button"
      class="lm-row lm-new"
      onClick={() => props.s.setAskingState({ name: "" })}
    >
      <Icon name="plus" />
      New state
    </button>
  );
}

// The same in the flow bar, where margins can't stand.
export function OutlineChips(props: { s: DesignScreenState }) {
  return (
    <button
      type="button"
      class="ftab ftab-new"
      aria-label="New state"
      onClick={() => props.s.setAskingState({ name: "" })}
    >
      <Icon name="plus" />
      <span>New state</span>
    </button>
  );
}

// Asking for a state: one of the standard states the screen lacks, or typed. It goes as
// a reply of its own and nothing waits for it.
export function StateAsk(props: { s: DesignScreenState }) {
  const s = props.s;
  const [typed, setTyped] = createSignal("");
  const [detail, setDetail] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  // A standard state picked from the card's own list, else the one it opened on.
  const [chosen, setChosen] = createSignal("");
  const fixed = () => chosen() || (s.askingState()?.name ?? "");
  const name = () => (fixed() || typed()).trim();
  const requested = () => s.stateOutlines().find((o) => o.name === fixed())?.requested ?? false;
  const shut = () => {
    setChosen("");
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
        <Show when={!fixed() && s.stateOutlines().length}>
          <div class="stateask-owed" role="group" aria-label="States it may need">
            <For each={s.stateOutlines()}>
              {(o) => (
                <button
                  type="button"
                  class="btn"
                  title={o.requested ? "Already asked for" : undefined}
                  onClick={() => setChosen(o.name)}
                >
                  {o.name}
                </button>
              )}
            </For>
          </div>
        </Show>
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
            Ask
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
  const whole = () => !s.alternatives().length;
  const state = () => s.activeState();
  return (
    <div class="planned-stage">
      <div class="planned-card" classList={{ phone: s.frameW() <= 600 }}>
        <span class="planned-tag">Planned</span>
        <h2>{state() ?? m()?.title}</h2>
        <Show when={m()?.source}>{(src) => <p class="planned-src">{src()}</p>}</Show>
        <div class="planned-acts">
          <Show when={!readonly() && !m()?.archivedAt}>
            <button type="button" class="btn" onClick={() => void s.askToDraw()}>
              Ask to draw
            </button>
          </Show>
          <Show when={specShown(s)}>
            <button type="button" class="btn" onClick={() => s.setPanel("spec")}>
              Spec
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
