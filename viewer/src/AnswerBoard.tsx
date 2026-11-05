// Studio's Answers: the open question with every answer laid out at once, for when
// there are too many to weigh in the margin. The cards are the margin's, with keep,
// hide and more like this; keys cull fast. On every state shows each answer down the
// states, since an answer fine on one can fail on another.

import { createSignal, For, Show } from "solid-js";
import type { Ask } from "../../server/types.ts";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { askStates, splitLabel } from "./logic.ts";
import { AskBody, flipCards, optionPicture } from "./Questions.tsx";
import type { DesignScreenState } from "./state.ts";
import { Thumb } from "./Thumb.tsx";

// The question Studio lays out: the one on the card, if its answers have pictures.
export function boardAsk(s: DesignScreenState): Ask | null {
  const a = s.curAsk();
  if (!a || s.dormantOf(a) || s.waitingOn(a)) return null;
  const pictured = a.options.filter((o) => optionPicture(s, a, o)).length;
  return pictured >= 2 ? a : null;
}

export function AnswerBoard(props: { s: DesignScreenState; ask: Ask }) {
  const s = props.s;
  const [every, setEvery] = createSignal(false);
  let box: HTMLDivElement | undefined;
  const states = () => {
    const m = s.design();
    return m ? askStates(props.ask, m, s.variants()) : [];
  };
  const kept = () => s.shownOptions(props.ask).filter((o) => s.isKept(props.ask, o.id)).length;
  // The answer a key was pressed on.
  const answerAt = (t: EventTarget | null) => {
    const el = (t as HTMLElement | null)?.closest<HTMLElement>("[data-option-card]");
    return props.ask.options.find((o) => o.id === el?.dataset.optionCard);
  };
  const cards = () => [...(box?.querySelectorAll<HTMLElement>(".optw > .opt") ?? [])];
  function onKey(e: KeyboardEvent) {
    if (readonly() || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.target as HTMLElement).closest("input, textarea")) return;
    const list = cards();
    const at = list.indexOf(e.target as HTMLElement);
    const go = (i: number) => list[Math.max(0, Math.min(list.length - 1, i))]?.focus();
    const o = answerAt(e.target);
    const k = e.key.toLowerCase();
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") go(at + (e.key === "ArrowRight" ? 1 : -1));
    else if (k === "k" && o) {
      s.toggleKept(props.ask, o);
      queueMicrotask(() =>
        box?.querySelector<HTMLElement>(`[data-option-card="${o.id}"] > .opt`)?.focus(),
      );
    } else if (k === "x" && o) {
      s.hideAnswer(props.ask, o);
      queueMicrotask(() => go(at));
    } else if (k === "z") s.toast()?.undo?.();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
  return (
    <div class="aboard" onKeyDown={onKey}>
      <header class="aboard-hd">
        <h2>{props.ask.text}</h2>
        <div class="aboard-bar">
          <span class="aboard-n">
            {`${s.shownOptions(props.ask).length} answers${kept() ? ` · ${kept()} kept` : ""}`}
          </span>
          <Show when={states().length > 1}>
            <label class="aboard-every">
              <input
                type="checkbox"
                checked={every()}
                onChange={(e) => setEvery(e.currentTarget.checked)}
              />
              On every state
            </label>
          </Show>
          <Show when={!readonly()}>
            <span class="aboard-keys" aria-hidden="true">
              <kbd>←</kbd>
              <kbd>→</kbd> move · <kbd>K</kbd> keep · <kbd>X</kbd> hide · <kbd>Enter</kbd> choose ·{" "}
              <kbd>Z</kbd> undo
            </span>
            <button
              type="button"
              class="btn go aboard-send"
              disabled={!s.sendable()}
              title={s.sendable() ? undefined : "Choose one first. Kept and hidden are saved."}
              onClick={() => void s.send()}
            >
              Send
            </button>
          </Show>
        </div>
      </header>
      <Show
        when={every()}
        fallback={
          <div class="aboard-grid" ref={(el) => (box = el)}>
            <AskBody s={s} ask={props.ask} />
          </div>
        }
      >
        <EveryState s={s} ask={props.ask} states={states()} />
      </Show>
    </div>
  );
}

// Answers across, states down: one column per answer, its pictures on each state.
function EveryState(props: { s: DesignScreenState; ask: Ask; states: (string | null)[] }) {
  const s = props.s;
  let box: HTMLDivElement | undefined;
  return (
    <div class="aevery" ref={(el) => (box = el)}>
      <For each={s.shownOptions(props.ask)}>
        {(o) => (
          <div class="aevery-col" classList={{ kept: s.isKept(props.ask, o.id) }}>
            <div class="aevery-hd">
              <button
                type="button"
                class="aevery-name"
                aria-pressed={s.answerOf(props.ask) === o.id}
                onClick={() => s.choose(props.ask, o.id)}
              >
                {splitLabel(o.label).name}
              </button>
              <Show when={!readonly()}>
                <button
                  type="button"
                  class="optic optkeep"
                  classList={{ on: s.isKept(props.ask, o.id) }}
                  aria-pressed={s.isKept(props.ask, o.id)}
                  aria-label={`Keep ${o.label}`}
                  onClick={() => flipCards(box, () => s.toggleKept(props.ask, o))}
                >
                  <Icon name="bookmark" />
                </button>
                <button
                  type="button"
                  class="optic"
                  aria-label={`Hide ${o.label}`}
                  onClick={(e) =>
                    flipCards(
                      box,
                      () => s.hideAnswer(props.ask, o),
                      e.detail ? e.currentTarget.closest(".aevery-col") : null,
                    )
                  }
                >
                  <Icon name="close" />
                </button>
              </Show>
            </div>
            <For each={props.states}>
              {(state) => (
                <Show when={optionPicture(s, props.ask, o, state)}>
                  {(p) => (
                    <figure class="aevery-pic">
                      <Thumb
                        width={s.frameW()}
                        class="crop"
                        fit
                        whole
                        src={p().src}
                        knobs={p().knobs}
                      />
                      <Show when={state !== null}>
                        <figcaption>{state}</figcaption>
                      </Show>
                    </figure>
                  )}
                </Show>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}
