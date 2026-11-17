// The agent's question: its words, the options, and Send. Beside the design it
// fills the margin with pictures to read; on a phone it is a sheet over the design's
// lower part, its answers one row a finger swipes, opened and closed from the bar under
// it (PhoneBar), or swiped down to a dot that leaves the design the whole screen. A tap puts an option on the stage as your pick; the same option
// again, or Send, moves on to the next question still owed, or sends the reply
// when none is.

import { createSignal, type JSX, Show } from "solid-js";
import { specShown } from "./Spec.tsx";
import type { Ask } from "../../server/types.ts";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { isBuiltinAsk, partLabel } from "./logic.ts";
import { answersView, setAnswersView } from "./answersView.ts";
import { AskBody, listed, MoreAnswersButton } from "./Questions.tsx";
import { SendTo } from "./SendTo.tsx";
import type { Shortlists } from "./shortlist.ts";
import { sideAsk, SideBySideToggle } from "./SideBySide.tsx";
import type { DesignScreenState } from "./state.ts";
import { questionDotted } from "./QuestionDot.tsx";

// Under this a grabber was tapped; past SWIPE_AWAY a drag down puts the sheet away.
const GRAB_SLOP = 6;
const SWIPE_AWAY = 48;

export function QuestionCard(props: {
  s: DesignScreenState;
  beside?: boolean;
  // What goes with this Send beside the question, scrolled with its options.
  below?: JSX.Element;
  // For Move on an alternative answer.
  sl?: Shortlists;
}) {
  const s = props.s;
  // Send pressed with nothing to send: said beside it, rather than a greyed button that
  // can't say why.
  const [nothing, setNothing] = createSignal(false);
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
  // A phone's sheet follows a finger down its grabber and goes away past SWIPE_AWAY; a tap
  // puts it away at once. Where it goes is the question dot (QuestionDot.tsx).
  let sheet: HTMLElement | undefined;
  let grab: { id: number; y: number; dy: number } | null = null;
  const grabDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    grab = { id: e.pointerId, y: e.clientY, dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const grabMove = (e: PointerEvent) => {
    if (!grab || e.pointerId !== grab.id || !sheet) return;
    grab.dy = Math.max(0, e.clientY - grab.y);
    sheet.style.transition = "none";
    sheet.style.transform = `translateY(${grab.dy}px)`;
  };
  const grabUp = (e: PointerEvent) => {
    if (!grab || e.pointerId !== grab.id) return;
    const { dy } = grab;
    grab = null;
    if (sheet) Object.assign(sheet.style, { transition: "", transform: "" });
    if (dy < GRAB_SLOP || dy > SWIPE_AWAY) s.setCardMin(true);
  };
  const grabCancel = () => {
    grab = null;
    if (sheet) Object.assign(sheet.style, { transition: "", transform: "" });
  };
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
                ref={(el) => (sheet = el)}
              >
                <Show when={!props.beside}>
                  <button
                    type="button"
                    class="qgrab"
                    aria-label="Hide the question"
                    title="Hide the question to see the design; swipe down"
                    onPointerDown={grabDown}
                    onPointerMove={grabMove}
                    onPointerUp={grabUp}
                    onPointerCancel={grabCancel}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        s.setCardMin(true);
                      }
                    }}
                  />
                </Show>
                <div class="sr-only" aria-live="polite">
                  {s.attachStatus()}
                </div>
                <div class="qhd">
                  <div class="qtext">
                    <Show
                      when={
                        showsList(ask()) ||
                        s.askSlot(ask()) ||
                        s.stageOffer(ask()) ||
                        s.shownWith(ask())
                      }
                    >
                      <span class="qs">
                        <span class="qs-row">
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
                  <span class="qtools">
                    <MoreAnswersButton s={s} ask={ask()} />
                    <Show when={props.beside}>
                      <SideBySideToggle s={s} ask={ask()} />
                    </Show>
                  </span>
                </div>
                <div class="qscroll">
                  <AskBody
                    s={s}
                    ask={ask()}
                    sl={props.sl}
                    beside={props.beside}
                    still={!!props.beside && sideAsk(s)?.id === ask().id}
                  />
                  {props.below}
                </div>
                <SendTo s={s} />
                <div class="qfoot">
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
                    <Show when={counted(ask())}>
                      <span class="qcount">{`${i() + 1} of ${asked()}`}</span>
                    </Show>
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
                    <Show when={nothing() && !s.commitKind() && !sendsAnyway()}>
                      <span class="qnothing" role="status">
                        Pick an answer first
                      </span>
                    </Show>
                    <button
                      type="button"
                      class="btn go qsend"
                      disabled={s.sending()}
                      onClick={() => {
                        if (!s.commitKind() && !sendsAnyway()) return setNothing(true);
                        setNothing(false);
                        if (sendsAnyway()) s.sendDraft();
                        else s.commit();
                      }}
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
    <Show when={!questionDotted(s)}>
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
    </Show>
  );
}
