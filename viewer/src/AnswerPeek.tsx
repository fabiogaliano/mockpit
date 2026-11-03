// The answer under the pointer when its question is about another state: a
// picture of that state beside the stage. The stage itself never moves on a
// hover, since the pointer crosses options on its way to one and the screen
// would jump under it.

import { createEffect, createMemo, createSignal, Show } from "solid-js";
import type { KnobValue } from "../../server/types.ts";
import { optionPicture } from "./Questions.tsx";
import type { DesignScreenState } from "./state.ts";
import { Thumb } from "./Thumb.tsx";

export function AnswerPeek(props: { s: DesignScreenState }) {
  const s = props.s;
  const picture = createMemo(() => {
    const p = s.preview()?.peek;
    const ask = p && s.design()?.asks.find((a) => a.id === p.ask);
    const option = ask?.options.find((o) => o.id === p?.option);
    return ask && option ? optionPicture(s, ask, option) : null;
  });
  // The frame outlives each hover and takes the next answer as knob values, so
  // sweeping across the answers does not reload it each time.
  const [held, setHeld] = createSignal<{
    ask: string;
    state: string | null;
    postId: string;
    src: string;
    knobs: Record<string, KnobValue>;
  } | null>(null);
  createEffect(() => {
    const ask = s.curAsk();
    const pic = picture();
    const was = held();
    if (was && (ask?.id !== was.ask || s.activeState() === was.state)) return setHeld(null);
    if (!pic || !ask) return;
    const same = was && was.state === pic.state && was.postId === pic.variant.postId;
    setHeld({
      ask: ask.id,
      state: pic.state,
      postId: pic.variant.postId,
      src: same ? was.src : pic.src,
      knobs: pic.knobs,
    });
  });
  return (
    <Show when={held()}>
      {(h) => (
        <aside class="answer-peek" classList={{ on: !!picture() }} aria-hidden="true">
          <div class="answer-peek-cap">
            <b>{h().state}</b>
            Preview only
          </div>
          <Thumb
            class={`answer-peek-frame ${s.frameW() < 500 ? "tall" : "wide"}`}
            width={s.frameW()}
            fit
            whole
            first
            src={h().src}
            knobs={h().knobs}
          />
        </aside>
      )}
    </Show>
  );
}
