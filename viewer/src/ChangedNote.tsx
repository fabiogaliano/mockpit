// A newer version than the one in use takes over by itself: the stage moves to it once the
// tab has focus, and ten seconds later it goes in use. Nothing is written until then,
// because Use wakes the agent and records a decision, so going back costs only a stay and
// the agent hears nothing. On a screen or a component the newer version is already
// current, so nothing counts down: the note is the way back, to the version marked Ready
// or, unmarked, to the one shown before, until the user keeps the newest.

import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js";
import { host, readonly, root } from "./host.ts";
import { Icon } from "./icons.tsx";
import { sameVersion, type VersionRef } from "./logic.ts";
import { away } from "./notifyRules.ts";
import type { DesignScreenState } from "./state.ts";

const TAKEOVER_MS = 10_000;
const TICK_MS = 100;

export function ChangedNote(props: { s: DesignScreenState; onStageView: boolean }) {
  const s = props.s;
  const [counting, setCounting] = createSignal(false);
  // Once stopped it never counts again for this version: the user is looking closely,
  // and a timer starting up again would decide under them.
  const [stopped, setStopped] = createSignal(false);
  const [left, setLeft] = createSignal(TAKEOVER_MS);
  const [held, setHeld] = createSignal(false);
  let note: HTMLDivElement | undefined;
  let touched = false;
  // A frame that already had focus when the count began says nothing about this version.
  let focusedAtStart: Element | null = null;

  const live = createMemo(() => !readonly() && !s.design()?.archivedAt && !!s.changed());
  const looking = () => sameVersion(s.onStage(), s.changed()?.to);
  // Beside each other the design is the same one, so only the number tells them apart.
  const name = (ref: VersionRef) =>
    ref.alternative === s.changed()?.to.alternative &&
    ref.alternative === s.changed()?.use.alternative
      ? `#${ref.version}`
      : s.nameOf(ref);

  // What the user has underway belongs to the version on stage, so it must not move.
  const busy = () =>
    s.boundVersion() !== null ||
    (!!s.curAsk() && !s.questionHidden()) ||
    s.tool() !== null ||
    !!s.preview() ||
    !!root().activeElement?.matches("input, textarea, select, [contenteditable]");

  function tick(elapsed: number) {
    const c = s.changed();
    if (!c || stopped() || s.product()) return;
    const here = props.onStageView && !away(root().visibilityState, root().hasFocus());
    if (!counting()) {
      if (!here || busy()) return;
      s.showVersion(c.to);
      touched = false;
      focusedAtStart = root().activeElement;
      setLeft(TAKEOVER_MS);
      setCounting(true);
      return;
    }
    const active = root().activeElement;
    const inFrame = active?.tagName === "IFRAME" && active !== focusedAtStart;
    if (touched || inFrame || !sameVersion(s.onStage(), c.to)) {
      setCounting(false);
      setStopped(true);
      return;
    }
    // Coming back is a fresh look, so the ten seconds start over.
    if (!here) {
      setLeft(TAKEOVER_MS);
      return;
    }
    if (held() || busy()) return;
    const next = left() - elapsed;
    if (next > 0) {
      setLeft(next);
      return;
    }
    setCounting(false);
    // Stopped first: if the write fails the note stays as a choice instead of retrying.
    setStopped(true);
    void s.useThis(c.to);
  }

  // A memo, since `changed` is a new object on every reload of the design and only a
  // different version may start the count over.
  const key = createMemo(() => {
    const c = s.changed();
    return c ? `${String(s.activeState())}:${c.to.alternative}:${c.to.version}` : null;
  });
  createEffect(
    on(key, () => {
      setCounting(false);
      setStopped(false);
      setHeld(false);
      setLeft(TAKEOVER_MS);
    }),
  );

  createEffect(() => {
    if (!live()) return;
    const win = host().window;
    let last = win.performance.now();
    const timer = win.setInterval(() => {
      const now = win.performance.now();
      tick(now - last);
      last = now;
    }, TICK_MS);
    const touch = (e: Event) => {
      if (!note?.contains(e.target as Node)) touched = true;
    };
    root().addEventListener("pointerdown", touch, true);
    root().addEventListener("wheel", touch, { capture: true, passive: true });
    onCleanup(() => {
      win.clearInterval(timer);
      root().removeEventListener("pointerdown", touch, true);
      root().removeEventListener("wheel", touch, true);
    });
  });

  function goBack() {
    const c = s.changed();
    if (!c) return;
    if (s.product()) s.followShown();
    else s.showVersion(c.use);
    s.stayOnUse();
  }

  return (
    <Show when={live() && s.changed()}>
      {(c) => (
        <div
          ref={(el) => (note = el)}
          class="changed-note"
          role="status"
          onPointerEnter={() => setHeld(true)}
          onPointerLeave={() => setHeld(false)}
          onFocusIn={() => setHeld(true)}
          onFocusOut={() => setHeld(false)}
        >
          <Show
            when={counting()}
            fallback={
              <Show
                when={looking()}
                fallback={
                  <>
                    <button
                      type="button"
                      class="changed-see"
                      onClick={() => {
                        // Asking to see it is looking closely, so no timer follows.
                        setStopped(true);
                        s.showVersion(c().to);
                      }}
                    >
                      <i class="dot ok" />
                      <span>{`New version · See ${name(c().to)} ›`}</span>
                    </button>
                    <button
                      type="button"
                      class="ib"
                      aria-label={`Keep ${name(c().use)}`}
                      onClick={s.stayOnUse}
                    >
                      <Icon name="close" />
                    </button>
                  </>
                }
              >
                <Show when={c().marked}>
                  <span class="changed-name changed-text">Changed since Ready</span>
                </Show>
                <button type="button" class="btn" onClick={goBack}>
                  <span class="changed-name">{`Back to ${name(c().use)}`}</span>
                </button>
                <Show when={s.product() && !c().marked}>
                  <button
                    type="button"
                    class="ib"
                    aria-label={`Keep ${name(c().to)}`}
                    title={`Keep ${name(c().to)}`}
                    onClick={s.keepNewest}
                  >
                    <Icon name="close" />
                  </button>
                </Show>
                <Show when={!s.product()}>
                  <button type="button" class="btn go" onClick={() => void s.useThis(c().to)}>
                    <span class="changed-name">{`Use ${name(c().to)}`}</span>
                  </button>
                </Show>
              </Show>
            }
          >
            <span class="changed-name changed-text">{`Now on ${name(c().to)}`}</span>
            <button
              type="button"
              class="btn changed-back"
              aria-label={`Back to ${name(c().use)}`}
              onClick={goBack}
            >
              <span class="changed-name">{`Back to ${name(c().use)}`}</span>
              {/* Never live: a number read out every second would drown the page. */}
              <span class="changed-count" aria-hidden="true">
                {Math.ceil(left() / 1000)}
              </span>
              <i class="changed-drain" style={{ transform: `scaleX(${left() / TAKEOVER_MS})` }} />
            </button>
          </Show>
        </div>
      )}
    </Show>
  );
}
