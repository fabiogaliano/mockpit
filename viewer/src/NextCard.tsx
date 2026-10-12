// After a Send: where to go next. The next mock that still owes answers, the
// screen moving there by itself after a beat unless the user stays; or, with
// nothing left, the way back to the project. And on that next mock, the chip
// that keeps the last Send's Delivered / Not seen yet in sight.

import { Show } from "solid-js";
import { carried, useCarriedDelivery } from "./carry.ts";
import { linkClick, mockPath, projectPath } from "./route.ts";
import type { MockScreenState } from "./state.ts";

const questions = (n: number) => (n === 1 ? "1 question" : `${n} questions`);

export function NextCard(props: { s: MockScreenState }) {
  const s = props.s;
  const home = () => projectPath(s.project);
  return (
    <Show when={s.afterSend()}>
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

// The Send made on the mock before this one, until this one sends its own.
export function CarriedChip(props: { project: string; slug: string }) {
  const delivered = useCarriedDelivery();
  const shown = () => {
    const c = carried();
    return c && c.project === props.project && c.slug !== props.slug ? c : null;
  };
  return (
    <Show when={shown()}>
      {(c) => (
        <a
          class="pill count carried"
          classList={{ waiting: !delivered() }}
          href={mockPath(c().project, c().slug)}
          title={`Your reply on ${c().title}`}
          onClick={(e) => linkClick(e, mockPath(c().project, c().slug))}
        >
          <i class="dot" classList={{ ok: delivered() }} />
          <span class="carried-title">{c().title}</span>
          <span>{` · ${delivered() ? "Delivered" : "Not seen yet"}`}</span>
        </a>
      )}
    </Show>
  );
}
