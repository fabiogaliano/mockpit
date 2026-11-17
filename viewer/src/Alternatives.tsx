// The alternatives of the state on stage, in Focus. On the left, beside the states: each
// live one to put on stage (a variants design's are its variants, which all ship), the
// archived ones folded under "N archived" to bring back. In the panel, on an idea: what
// to do with the one on stage, More like this, Borrow, Keep, Move and Archive, each its
// own reply or its own move.

import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { isLive } from "../../server/types.ts";
import { assetUrl } from "./api.ts";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { alternativeName, sameVersion, type VersionStep } from "./logic.ts";
import { SaveMenu, type SaveFor } from "./SaveMenu.tsx";
import type { Shortlists } from "./shortlist.ts";
import type { DesignScreenState } from "./state.ts";
import { posterShown } from "./systemRev.ts";

// Each alternative's newest version still shown, in the order the state lists them.
function newestOf(s: DesignScreenState, alternative: string): VersionStep | undefined {
  return s
    .steps()
    .filter((x) => x.alternative === alternative && !x.hidden)
    .at(-1);
}

export function AlternativeList(props: { s: DesignScreenState }) {
  const s = props.s;
  const here = createMemo(() => s.alternatives().filter((v) => v.state === s.activeState()));
  const live = () => here().filter((v) => isLive(v.status));
  const archived = () => here().filter((v) => !isLive(v.status));
  const [unfold, setUnfold] = createSignal(false);
  const used = () => s.inUse()?.alternative;
  return (
    <Show when={here().length > 1}>
      <section class="lm-sec lm-alts">
        <h3>{s.design()?.variants ? "Variants" : "Alternatives"}</h3>
        <For each={live()}>
          {(v) => {
            const step = () => newestOf(s, v.alternative);
            const on = () => s.activeAlternative()?.alternative === v.alternative;
            return (
              <button
                type="button"
                class="lm-row lm-alt"
                classList={{ on: on() }}
                aria-current={on() ? "true" : undefined}
                title={v.description}
                onClick={() => {
                  const st = step();
                  if (st) s.showVersion(st);
                }}
              >
                <span class="lm-pic" classList={{ flat: s.frameW() > 600 }}>
                  <Show when={posterShown(step()?.poster)}>
                    {(id) => <img src={assetUrl(id())} alt="" loading="lazy" decoding="async" />}
                  </Show>
                </span>
                <span class="lm-text">
                  <b>{alternativeName(v.alternative)}</b>
                  <Show when={used() === v.alternative}>
                    <small>In use</small>
                  </Show>
                </span>
              </button>
            );
          }}
        </For>
        <Show when={archived().length}>
          <button
            type="button"
            class="lm-fold"
            aria-expanded={unfold()}
            onClick={() => setUnfold(!unfold())}
          >
            {`${archived().length} archived ${unfold() ? "▾" : "▸"}`}
          </button>
          <Show when={unfold()}>
            <For each={archived()}>
              {(v) => (
                <div class="lm-archived" title={v.archiveReason ?? v.description}>
                  <span>{alternativeName(v.alternative)}</span>
                  <Show when={!readonly()}>
                    <button
                      type="button"
                      class="vrestore"
                      onClick={() =>
                        void s
                          .restoreAlternative(v.alternative, [s.activeState()])
                          .then(() => s.setToast({ text: `Restored ${v.alternative}` }))
                      }
                    >
                      Restore
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </section>
    </Show>
  );
}

// What can be done with the alternative on stage of an idea.
export function AlternativeActs(props: { s: DesignScreenState; sl: Shortlists }) {
  const s = props.s;
  const step = () => s.stageStep();
  const live = () => {
    const v = s.activeAlternative();
    return !!v && isLive(v.status);
  };
  const inUse = () => sameVersion(s.inUse(), step() ?? null);
  const [saving, setSaving] = createSignal<{ from: HTMLElement; move: boolean } | null>(null);
  const [borrowing, setBorrowing] = createSignal(false);
  const name = () => {
    const st = step();
    return st ? s.nameOf(st) : "";
  };
  const more = () => {
    const st = step();
    if (!st) return;
    void s
      .steer({ alternative: st.alternative, version: st.version, reaction: "more" })
      .then((ok) => ok && s.setToast({ text: `More like ${s.nameOf(st)}, sent` }));
  };
  const archive = () => {
    const st = step();
    if (st && !inUse()) void s.archiveAlternatives([st.alternative]);
  };
  const saveFor = (st: VersionStep) => saveForStep(s, st, inUse());
  const saved = () => {
    const m = s.design();
    const st = step();
    return (
      !!m &&
      !!st &&
      props.sl.isSaved({
        design: m.id,
        state: s.activeState(),
        alternative: st.alternative,
        version: st.version,
      })
    );
  };
  const open = (e: MouseEvent, move: boolean) => {
    const from = e.currentTarget as HTMLElement;
    setSaving(saving()?.from === from ? null : { from, move });
  };
  return (
    <Show when={!readonly() && !s.product() && live() && step()} keyed>
      {(st) => (
        <Show when={!answeredInRow(s, st.alternative)}>
          <section class="altacts" aria-label={`What to do with ${name()}`}>
            <h3>{name()}</h3>
            <div class="altacts-row">
              <button type="button" class="btn" onClick={more}>
                <Icon name="spark" />
                More like this
              </button>
              <button
                type="button"
                class="btn"
                aria-expanded={borrowing()}
                onClick={() => setBorrowing(!borrowing())}
              >
                <Icon name="borrow" />
                Borrow
              </button>
              <button
                type="button"
                class="btn"
                aria-pressed={saved()}
                onClick={(e) => open(e, false)}
              >
                <Icon name="bookmark" />
                {saved() ? "Kept" : "Keep"}
              </button>
              <button type="button" class="btn" onClick={(e) => open(e, true)}>
                <Icon name="move" />
                Move
              </button>
              <Show when={!inUse()}>
                <button type="button" class="btn quiet" onClick={archive}>
                  Archive
                </button>
              </Show>
            </div>
            <Show when={borrowing()}>
              <BorrowBox s={s} to={st} onDone={() => setBorrowing(false)} />
            </Show>
            <Show when={saving()} keyed>
              {(at) => (
                <Show when={saveFor(st)}>
                  {(item) => (
                    <SaveMenu
                      sl={props.sl}
                      project={s.project}
                      anchor={at.from}
                      item={item()}
                      move={at.move}
                      onClose={() => setSaving(null)}
                    />
                  )}
                </Show>
              )}
            </Show>
          </section>
        </Show>
      )}
    </Show>
  );
}

// Keep copies it into a gathered idea or another design; Move also takes it from here,
// which archives it, unless it is in use.
function saveForStep(s: DesignScreenState, st: VersionStep, inUse: boolean): SaveFor | null {
  const m = s.design();
  if (!m) return null;
  const state = s.activeState();
  const leaves = !inUse;
  return {
    items: [
      {
        ref: { design: m.id, state, alternative: st.alternative, version: st.version },
        name: s.nameOf(st),
      },
    ],
    here: state ? `${m.title} · ${state}` : m.title,
    leaves: leaves ? "archived" : null,
    out: leaves ? 1 : 0,
    archives: leaves ? [st.alternative] : [],
    leave: () => s.archiveAlternatives([st.alternative], st.alternative, true),
  };
}

// The question on the card answers with this alternative, so its row carries what to do
// with it, and the panel says it once.
function answeredInRow(s: DesignScreenState, alternative: string): boolean {
  const ask = s.curAsk();
  return !!ask && s.shownOptions(ask).some((o) => o.alternative === alternative);
}

// An answer that is a live alternative of an idea's state on stage: Borrow and Move apply.
export function answerAlternative(s: DesignScreenState, alternative: string | undefined) {
  if (!alternative || readonly() || s.product()) return undefined;
  const v = s
    .alternatives()
    .find((x) => x.state === s.activeState() && x.alternative === alternative);
  return v && isLive(v.status) ? newestOf(s, alternative) : undefined;
}

// What an answer's ⋯ opened for its alternative: Borrow under the row, Move as a menu.
export function AnswerAlternativeTools(props: {
  s: DesignScreenState;
  sl?: Shortlists;
  step: VersionStep;
  borrowing: boolean;
  moving: HTMLElement | null;
  onDone: () => void;
}) {
  const s = props.s;
  const inUse = () => sameVersion(s.inUse(), props.step);
  return (
    <>
      <Show when={props.borrowing}>
        <BorrowBox s={s} to={props.step} onDone={props.onDone} />
      </Show>
      <Show when={props.sl && props.moving} keyed>
        {(anchor) => (
          <Show when={saveForStep(s, props.step, inUse())}>
            {(item) => (
              <SaveMenu
                sl={props.sl!}
                project={s.project}
                anchor={anchor}
                item={item()}
                move
                onClose={props.onDone}
              />
            )}
          </Show>
        )}
      </Show>
    </>
  );
}

// What to borrow into the alternative on stage, from which of its neighbours, aimed at a
// part when the pages declare any; sent as its own reply.
function BorrowBox(props: { s: DesignScreenState; to: VersionStep; onDone: () => void }) {
  const s = props.s;
  const others = () =>
    s
      .alternatives()
      .filter(
        (v) =>
          v.state === s.activeState() && isLive(v.status) && v.alternative !== props.to.alternative,
      )
      .flatMap((v) => {
        const st = newestOf(s, v.alternative);
        return st ? [st] : [];
      });
  const [from, setFrom] = createSignal<VersionStep | undefined>(others()[0]);
  const [part, setPart] = createSignal<string | null>(null);
  const [text, setText] = createSignal("");
  const parts = () =>
    s
      .alternatives()
      .find((v) => v.state === s.activeState() && v.alternative === from()?.alternative)?.parts ??
    [];
  let input: HTMLInputElement | undefined;
  onMount(() => input?.focus());
  const send = () => {
    const f = from();
    if (!f) return;
    void s
      .steer({
        alternative: props.to.alternative,
        version: props.to.version,
        text: text().trim(),
        borrow: { from: f, ...(part() ? { part: part()! } : {}) },
      })
      .then((ok) => ok && s.setToast({ text: `Borrow into ${s.nameOf(props.to)}, sent` }));
    props.onDone();
  };
  return (
    <Show
      when={others().length}
      fallback={<p class="altacts-none">There is no other alternative here to borrow from.</p>}
    >
      <form
        class="borrowbox"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label>
          <span>From</span>
          <select
            value={from() ? from()!.alternative : ""}
            onChange={(e) => setFrom(others().find((x) => x.alternative === e.currentTarget.value))}
          >
            <For each={others()}>
              {(x) => <option value={x.alternative}>{alternativeName(x.alternative)}</option>}
            </For>
          </select>
        </label>
        <Show when={parts().length}>
          <div class="borrowbox-parts" role="group" aria-label="Part">
            <For each={parts()}>
              {(p) => (
                <button
                  type="button"
                  class="chip"
                  aria-pressed={part() === p}
                  onClick={() => setPart(part() === p ? null : p)}
                >
                  {p}
                </button>
              )}
            </For>
          </div>
        </Show>
        <input
          ref={(el) => (input = el)}
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
          placeholder="What should it take? e.g. the face"
          aria-label={`What ${s.nameOf(props.to)} should take`}
          autocomplete="off"
        />
        <div class="borrowbox-foot">
          <button type="button" class="btn" onClick={props.onDone}>
            Cancel
          </button>
          <button type="submit" class="btn go">
            Send
          </button>
        </div>
      </form>
    </Show>
  );
}
