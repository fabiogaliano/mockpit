// The agent's question, as one compact card floating above the bottom bar:
// its words, the options in an even grid, and Send. A tap puts an option on
// the stage as your pick; the same option again, or Send, moves on to the
// next question still owed, or sends the reply when none is. × tucks it into
// a tab on the canvas's edge, as does opening the history.

import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { hasFiles } from "./attach.ts";
import { host, readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { AskBody } from "./Questions.tsx";
import type { MockScreenState } from "./state.ts";

export function QuestionCard(props: { s: MockScreenState }) {
  const s = props.s;
  // The note opens from the card's foot; it stays open once it holds something.
  const [noteFor, setNoteFor] = createSignal<string | null>(null);
  // A file dropped beside a drop zone would make the browser open it and leave
  // the page; files land only where a zone takes them.
  onMount(() => {
    const win = host().window;
    const guard = (e: DragEvent) => {
      if (hasFiles(e.dataTransfer)) e.preventDefault();
    };
    win.addEventListener("dragover", guard);
    win.addEventListener("drop", guard);
    onCleanup(() => {
      win.removeEventListener("dragover", guard);
      win.removeEventListener("drop", guard);
    });
  });
  const shown = () => !s.cardMin() && !s.panel() && !s.mock()?.resolvedAt;
  const total = () => s.questions().length;
  const i = () => Math.min(s.cur(), total() - 1);
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
              <section class="qcard" aria-label="Question" data-ask={ask().id}>
                <div class="sr-only" aria-live="polite">
                  {s.attachStatus()}
                </div>
                <div class="qhd">
                  <div class="qtext">
                    <Show when={total() > 1 || s.askSlot(ask())}>
                      <span class="qs">
                        <Show when={total() > 1}>
                          <span class="qcount">{`${i() + 1} of ${total()}`}</span>
                        </Show>
                        <Show when={s.askSlot(ask())}>
                          {(sl) => (
                            <span class="slotchip">{`Part · ${sl().label ?? sl().part}`}</span>
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
                  <button
                    type="button"
                    class="ib qx"
                    aria-label="Minimise the question"
                    onClick={() => s.setCardMin(true)}
                  >
                    <Icon name="close" />
                  </button>
                </div>
                <AskBody s={s} ask={ask()} noteOpen={noteFor() === ask().id} />
                <div class="qfoot">
                  <Show when={!readonly()}>
                    <button
                      type="button"
                      class="ib qnote"
                      classList={{ on: noteFor() === ask().id || s.noteOf(ask()) !== undefined }}
                      aria-label="Add a note for the agent"
                      aria-expanded={noteFor() === ask().id || s.noteOf(ask()) !== undefined}
                      title="Note for the agent"
                      onClick={() => setNoteFor(noteFor() === ask().id ? null : ask().id)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
                      </svg>
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
                      disabled={!s.commitKind() || s.sending()}
                      onClick={() => s.commit()}
                    >
                      {s.nextStop(i()) ? "Next" : "Send"}
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

// The question tucked away: a tab on the canvas's right edge with how many are
// open; a tap brings the card back on the first still owed.
export function QuestionTab(props: { s: MockScreenState }) {
  const s = props.s;
  const n = () => s.owed().length;
  const hidden = () => s.cardMin() || !!s.panel() || !s.curAsk();
  return (
    <Show when={hidden() && n() > 0 && !s.mock()?.resolvedAt}>
      <button
        type="button"
        class="qtab"
        aria-label={`Show the question, ${n()} open`}
        onClick={() => s.goOwed()}
      >
        <b>{n()}</b>
        {n() === 1 ? "Question" : "Questions"}
      </button>
    </Show>
  );
}
