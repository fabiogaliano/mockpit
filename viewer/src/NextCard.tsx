// After a Send: where to go next. The next design that still owes answers, the
// screen moving there by itself after a beat unless the user stays; or, with
// nothing left, the way back to the project under the Send's status. And on that next
// design, the chip that keeps the last Send's Delivered / Not seen yet in sight, with
// the line that wakes an agent nothing is listening for.

import { createSignal, onCleanup, Show } from "solid-js";
import { BEAT_MS, carried, setCarried, useCarriedDelivery } from "./carry.ts";
import { CopyButton } from "./CopyButton.tsx";
import { host } from "./host.ts";
import { homePath, linkClick, designPath } from "./route.ts";
import type { DesignScreenState } from "./state.ts";

const questions = (n: number) => (n === 1 ? "1 question" : `${n} questions`);

// For an agent nothing will wake. What the server knows is that no watch is held open
// for its session, not that the agent is stopped, so that's all this claims: a busy
// agent reads the reply on its next call anyway.
export function WakeLine(props: { slug: string }) {
  const line = () =>
    `Read my mockpit reply on ${props.slug}: run mockpit feedback, or call your feedback tool.`;
  return (
    <div class="wake">
      <p>No watcher is open, so your agent hears this on its next call. To wake it now, tell it:</p>
      <div class="wake-line">
        <code>{line()}</code>
        <CopyButton text={line()} label="Copy the line for your agent" />
      </div>
    </div>
  );
}

export function NextCard(props: { s: DesignScreenState }) {
  const s = props.s;
  const home = () => homePath(s.project);
  // A question that has come in since is what's next, right here.
  const shown = () => {
    const a = s.afterSend();
    return a && (a.next || !s.curAsk()) ? a : null;
  };
  return (
    <Show when={shown()}>
      {(a) => (
        <div class="nextcard" role="status">
          <Show
            when={a().next}
            fallback={
              <p class="nextcard-done">
                {"Nothing else to answer here. "}
                <a class="lnk" href={home()} onClick={(e) => linkClick(e, home())}>
                  {`Back to ${s.project}`}
                </a>
              </p>
            }
          >
            {(next) => (
              <>
                <button
                  type="button"
                  class="primary nextcard-go"
                  classList={{ auto: a().auto }}
                  data-next={next().slug}
                  title={`Next: ${next().title} · ${questions(next().open)}`}
                  onClick={() => s.goNext()}
                >
                  <span class="nextcard-label">{`Next: ${next().title}`}</span>
                  <span class="nextcard-n">{` · ${questions(next().open)} ›`}</span>
                  <Show when={a().auto}>
                    <i class="nextcard-bar" aria-hidden="true" />
                  </Show>
                </button>
                <Show when={a().auto}>
                  <button type="button" class="lnk nextcard-stay" onClick={() => s.stayHere()}>
                    Stay here
                  </button>
                </Show>
              </>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
}

// The Send made on the design before this one, until this one sends its own.
export function CarriedChip(props: { project: string; slug: string }) {
  const { delivered, listening, reload } = useCarriedDelivery();
  const [beat, setBeat] = createSignal(false);
  const timer = host().window.setTimeout(() => {
    setBeat(true);
    void reload();
  }, BEAT_MS);
  onCleanup(() => host().window.clearTimeout(timer));
  const shown = () => {
    const c = carried();
    return c && c.project === props.project && c.slug !== props.slug ? c : null;
  };
  // Once a screen has shown it Delivered, it has done its job; until then it
  // keeps following the user from design to design.
  onCleanup(() => {
    if (shown() && delivered()) setCarried(null);
  });
  return (
    <Show when={shown()}>
      {(c) => (
        <>
          <a
            class="pill count carried"
            classList={{ waiting: !delivered() }}
            href={designPath(c().project, c().slug)}
            title={`Your reply on ${c().title}`}
            onClick={(e) => linkClick(e, designPath(c().project, c().slug))}
          >
            <i class="dot" classList={{ ok: delivered() }} />
            <span class="carried-title">{c().title}</span>
            <span>{` · ${delivered() ? "Delivered" : "Not seen yet"}`}</span>
          </a>
          <Show when={beat() && !delivered() && !listening()}>
            <WakeLine slug={c().slug} />
          </Show>
        </>
      )}
    </Show>
  );
}
