// The agent's question: its words, the options, and Send. Beside the design it
// fills the margin with pictures to read; on a phone it is a sheet over the design's
// lower part, its answers one row a finger swipes, opened and closed from the bar under
// it (PhoneBar). A tap puts an option on the stage as your pick; the same option
// again, or Send, moves on to the next question still owed, or sends the reply
// when none is.

import { createSignal, type JSX, Show } from "solid-js";
import { specShown } from "./Spec.tsx";
import type { Ask } from "../../server/types.ts";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { isBuiltinAsk, partLabel } from "./logic.ts";
import { answersView, setAnswersView } from "./answersView.ts";
import { AskBody, listed } from "./Questions.tsx";
import { SendTo } from "./SendTo.tsx";
import { LayoutToggle, sideAsk } from "./SideBySide.tsx";
import type { DesignScreenState } from "./state.ts";

export function QuestionCard(props: {
  s: DesignScreenState;
  beside?: boolean;
  // What goes with this Send beside the question, scrolled with its options.
  below?: JSX.Element;
}) {
  const s = props.s;
  // The comment opens from the card's foot; it stays open once it holds something.
  const [noteFor, setNoteFor] = createSignal<string | null>(null);
  const shown = () => !s.questionHidden() && !s.design()?.archivedAt;
  const total = () => s.questions().length;
  const i = () => Math.min(s.cur(), total() - 1);
  // The built-in Which alternative? comes last and isn't a question anyone asked, so
  // the count reads the same as Needs you's.
  const counted = (a: Ask) => asked() > 1 && !isBuiltinAsk(a);
  const askAt = (id: string) => s.questions().findIndex((q) => q.kind === "ask" && q.ask.id === id);
  const asked = () => s.questions().filter((q) => q.kind === "ask" && !isBuiltinAsk(q.ask)).length;
  // No answer yet, yet comments or tuning to send: they go, and the question stays open.
  const sendsAnyway = () => !s.commitKind() && s.sendable();
  const showsList = (a: Ask) => !!props.beside && listed(s, a);
  return (
    // Keyed by the question's id, not its object: the asks are rebuilt whenever
    // a frame reports its parts, and remounting on that would drop the focus
    // out of a note mid-typing.
    <Show when={shown() ? s.curAsk()?.id : null} keyed>
      {(id) => (
        <Show when={s.curAsk()?.id === id ? s.curAsk() : null}>
          {(current) => {
            const ask = current;
            return (
              <section
                class="qcard"
                classList={{ beside: !!props.beside }}
                aria-label="Question"
                data-ask={ask().id}
              >
                <div class="sr-only" aria-live="polite">
                  {s.attachStatus()}
                </div>
                <div class="qhd">
                  <div class="qtext">
                    <Show
                      when={
                        showsList(ask()) ||
                        counted(ask()) ||
                        s.askSlot(ask()) ||
                        s.stageOffer(ask()) ||
                        s.shownWith(ask())
                      }
                    >
                      <span class="qs">
                        <span class="qs-row">
                          <Show when={counted(ask())}>
                            <span class="qcount">{`${i() + 1} of ${asked()}`}</span>
                          </Show>
                          <Show when={s.shownWith(ask())}>
                            {(w) => (
                              <span class="qwith">
                                <span class="qcut" title={`With ${w().labels}`}>
                                  {`With ${w().short}`}
                                </span>
                                <Show when={askAt(w().ask.id) >= 0}>
                                  <button
                                    type="button"
                                    class="lnk"
                                    aria-label={`Change answer: ${w().labels}`}
                                    onClick={() => s.goQuestion(askAt(w().ask.id))}
                                  >
                                    Change
                                  </button>
                                </Show>
                              </span>
                            )}
                          </Show>
                          <Show when={s.stageOffer(ask())} keyed>
                            {(o) =>
                              "show" in o ? (
                                <button
                                  type="button"
                                  class="qgo"
                                  title={`Go to ${o.show}`}
                                  onClick={() => s.showAskState(ask())}
                                >
                                  <span class="qcut">{`Go to ${o.show}`}</span>
                                  <Icon name="arrow" />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  class="lnk qback"
                                  title={`Back to ${o.back}`}
                                  onClick={() => s.backFromAsk(ask())}
                                >
                                  {`Back to ${o.back}`}
                                </button>
                              )
                            }
                          </Show>
                          <Show when={showsList(ask())}>
                            <span class="vswitch qview" role="group" aria-label="Show answers as">
                              <button
                                type="button"
                                aria-label="List"
                                title="List"
                                aria-pressed={answersView() === "list"}
                                onClick={() => setAnswersView("list")}
                              >
                                <Icon name="rows" />
                              </button>
                              <button
                                type="button"
                                aria-label="Pictures"
                                title="Pictures"
                                aria-pressed={answersView() === "grid"}
                                onClick={() => setAnswersView("grid")}
                              >
                                <Icon name="grid" />
                              </button>
                            </span>
                          </Show>
                        </span>
                        <Show when={s.askSlot(ask())}>
                          {(sl) => (
                            <span class="slotchip">{`Part · ${sl().label ?? partLabel(s.design() ?? { parts: [] }, sl().part)}`}</span>
                          )}
                        </Show>
                        <Show when={s.dormantOf(ask())}>
                          <span class="flag">inactive</span>
                        </Show>
                        <Show when={s.flagged().includes(ask().id)}>
                          <span class="flag">{`your pick is gone in ${s.arrived()?.name ?? "the new version"}`}</span>
                        </Show>
                      </span>
                    </Show>
                    <span class="qt">{ask().text}</span>
                  </div>
                </div>
                <Show when={props.beside}>
                  <div class="qlayout-row">
                    <LayoutToggle s={s} ask={ask()} />
                  </div>
                </Show>
                <div class="qscroll">
                  <AskBody
                    s={s}
                    ask={ask()}
                    noteOpen={noteFor() === ask().id}
                    beside={props.beside}
                    still={!!props.beside && sideAsk(s)?.id === ask().id}
                  />
                  {props.below}
                </div>
                <SendTo s={s} />
                <div class="qfoot">
                  <Show when={!readonly()}>
                    <button
                      type="button"
                      class={props.beside ? "qaddnote" : "ib qnote"}
                      classList={{ on: noteFor() === ask().id || s.commentOf(ask()) !== undefined }}
                      aria-label="Add a comment for the agent"
                      aria-expanded={noteFor() === ask().id || s.commentOf(ask()) !== undefined}
                      title="Comment for the agent"
                      onClick={() => setNoteFor(noteFor() === ask().id ? null : ask().id)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
                      </svg>
                      <Show when={props.beside}>
                        <span>Add a comment</span>
                      </Show>
                    </button>
                  </Show>
                  <Show when={s.flow().length > 1}>
                    <button
                      type="button"
                      class="ib"
                      aria-label="Previous question"
                      disabled={!s.stepTarget(-1)}
                      onClick={() => s.step(-1)}
                    >
                      <Icon name="prev" />
                    </button>
                    <button
                      type="button"
                      class="ib"
                      aria-label="Next question"
                      disabled={!s.stepTarget(1)}
                      onClick={() => s.step(1)}
                    >
                      <Icon name="next" />
                    </button>
                  </Show>
                  <span class="grow" />
                  <Show when={!readonly()}>
                    <button
                      type="button"
                      class="btn go qsend"
                      disabled={(!s.commitKind() && !sendsAnyway()) || s.sending()}
                      title={
                        !s.commitKind() && !sendsAnyway()
                          ? "Pick an answer, or add a comment"
                          : undefined
                      }
                      onClick={() => (sendsAnyway() ? s.sendDraft() : s.commit())}
                    >
                      {!sendsAnyway() && s.nextStop(i()) ? "Next" : "Send"}
                    </button>
                  </Show>
                </div>
              </section>
            );
          }}
        </Show>
      )}
    </Show>
  );
}

// A phone's foot: Question and Spec, each a sheet over the design's lower part. The
// question's opens by itself while one waits (the card shows unless put away), and this
// puts it away and brings it back, on the first question still owed. It stays while
// anything can still be sent, a question with a drafted answer too, or putting that one
// away would leave no way back to its Send. Spec is the bottom panel's Spec.
export function PhoneBar(props: { s: DesignScreenState; ref?: (el: HTMLElement) => void }) {
  const s = props.s;
  const asks = () => new Set(s.flow().map((e) => e.ask.id));
  const n = () => [...asks()].filter((id) => !isBuiltinAsk({ id })).length;
  const waiting = () => asks().size > 0 && !s.design()?.archivedAt;
  const up = () => !s.questionHidden() && !!s.curAsk() && !s.design()?.archivedAt;
  const spec = () => s.panel() === "spec";
  return (
    <nav class="pbar" aria-label="Question and spec" ref={(el) => props.ref?.(el)}>
      <button
        type="button"
        classList={{ q: waiting(), on: up() }}
        aria-pressed={up()}
        disabled={!waiting() && !up()}
        title={waiting() || up() ? undefined : "Nothing waits on you here"}
        onClick={() => (up() ? s.setCardMin(true) : s.goOwed())}
      >
        <Show when={n()} fallback={waiting() ? "Pick one" : "Question"}>
          {(k) => `Question · ${k()}`}
        </Show>
      </button>
      <Show when={specShown(s)}>
        <button
          type="button"
          classList={{ on: spec() }}
          aria-pressed={spec()}
          onClick={() => s.setPanel(spec() ? null : "spec")}
        >
          Spec
        </button>
      </Show>
    </nav>
  );
}
