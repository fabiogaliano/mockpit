// The agent's question: its words, the options, and Send. Beside the design it
// fills the margin with pictures to read; on a phone it is one compact card above
// the bottom bar, whose × tucks it into a tab on the canvas's edge, as does opening
// the history. A tap puts an option on the stage as your pick; the same option
// again, or Send, moves on to the next question still owed, or sends the reply
// when none is.

import { createSignal, type JSX, Show } from "solid-js";
import type { Ask } from "../../server/types.ts";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { isBuiltinAsk, partLabel } from "./logic.ts";
import { AskBody } from "./Questions.tsx";
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
  // The built-in Which variant? comes last and isn't a question anyone asked, so
  // the count reads the same as Home's.
  const counted = (a: Ask) => asked() > 1 && !isBuiltinAsk(a);
  const asked = () => s.questions().filter((q) => q.kind === "ask" && !isBuiltinAsk(q.ask)).length;
  // No answer yet, yet comments or tuning to send: they go, and the question stays open.
  const sendsAnyway = () => !s.commitKind() && s.sendable();
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
                    <Show when={counted(ask()) || s.askSlot(ask()) || s.stageOffer(ask())}>
                      <span class="qs">
                        <Show when={counted(ask())}>
                          <span class="qcount">{`${i() + 1} of ${asked()}`}</span>
                        </Show>
                        <Show when={s.stageOffer(ask())} keyed>
                          {(o) => {
                            return "show" in o ? (
                              <span class="qabout">
                                {"About "}
                                <b>{o.show}</b>
                                <button
                                  type="button"
                                  class="lnk"
                                  onClick={() => s.showAskState(ask())}
                                >
                                  Show
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                class="lnk qabout"
                                onClick={() => s.backFromAsk(ask())}
                              >
                                {`Back to ${o.back}`}
                              </button>
                            );
                          }}
                        </Show>
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
                  <Show when={!props.beside}>
                    <button
                      type="button"
                      class="ib qx"
                      aria-label="Minimise the question"
                      title="Minimise"
                      onClick={() => s.setCardMin(true)}
                    >
                      <Icon name="close" />
                    </button>
                  </Show>
                </div>
                <div class="qscroll">
                  <AskBody
                    s={s}
                    ask={ask()}
                    noteOpen={noteFor() === ask().id}
                    beside={props.beside}
                  />
                  {props.below}
                </div>
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

// The question tucked away on a phone: a tab on the canvas's right edge. It stays as
// long as anything can still be sent, a question with a drafted answer too, or
// minimising that one would leave no way back to its Send. A tap brings the card back.
export function QuestionTab(props: { s: DesignScreenState }) {
  const s = props.s;
  const asks = () => new Set(s.flow().map((e) => e.ask.id));
  const n = () => [...asks()].filter((id) => !isBuiltinAsk({ id })).length;
  const hidden = () => s.cardMin() || !!s.panel() || !s.curAsk();
  return (
    <Show when={hidden() && asks().size > 0 && !s.design()?.archivedAt}>
      <button
        type="button"
        class="qtab"
        aria-label={n() ? `Show the question, ${n()} open` : "Show the choice of variant"}
        onClick={() => s.goOwed()}
      >
        <Show when={n()} fallback="Pick one">
          <b>{n()}</b>
          {n() === 1 ? "Question" : "Questions"}
        </Show>
      </button>
    </Show>
  );
}
