// The alternatives of the state on stage, in Focus. On the left, beside the states: each
// live one to put on stage (a variants design's are its variants, which all ship), with
// its pick or Main, and the archived ones folded under "N archived" to bring back. Over the
// frame's corner, on an idea: what to do with the one on stage, the frame's actions.

import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { isLive } from "../../server/types.ts";
import { assetUrl } from "./api.ts";
import { ArchivedGhost } from "./ArchivedGhost.tsx";
import { readonly } from "./host.ts";
import { canFrame, frameActions, type FrameRef, hasActs } from "./frameActions.ts";
import { Icon } from "./icons.tsx";
import { alternativeName, sameVersion, type VersionStep } from "./logic.ts";
import { MarkPill } from "./MarkPill.tsx";
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
  const archived = () => here().filter((v) => !isLive(v.status));
  const [unfold, setUnfold] = createSignal(false);
  const used = () => s.inUse()?.alternative;
  return (
    <Show when={here().length > 1}>
      <section class="lm-sec lm-alts">
        <h3>{s.design()?.variants ? "Variants" : s.design()?.set ? "Set" : "Alternatives"}</h3>
        {/* One just archived keeps its place a moment, as its ghost. */}
        <For each={here().filter((v) => isLive(v.status) || s.ghostOn(v.state, v.alternative))}>
          {(v) => {
            const step = () => newestOf(s, v.alternative);
            const on = () => s.activeAlternative()?.alternative === v.alternative;
            return (
              <Show
                when={!s.ghostOn(v.state, v.alternative)}
                fallback={<ArchivedGhost s={s} line={s.ghost()!} />}
              >
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
                  <Show when={s.frameMark(v.state, v.alternative)}>
                    {(k) => (
                      <span
                        class="lm-mark"
                        classList={{ main: k() === "main" }}
                        title={k() === "main" ? "Main" : "Bookmarked"}
                      >
                        <Icon name={k() === "main" ? "star" : "bookmark"} />
                        <span class="sr-only">{k() === "main" ? ", Main" : ", bookmarked"}</span>
                      </span>
                    )}
                  </Show>
                </button>
              </Show>
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

// What can be done with the frame on stage, over its corner and never on it, since Try
// hands the frame's clicks to the page: the pill's actions, and behind ⋯ those that open
// something here (frameActions.ts says which the frame has). A cell open from the sheet is
// marked as the cell, worn in its values.
export function AlternativeActs(props: { s: DesignScreenState; sl: Shortlists }) {
  const s = props.s;
  const step = () => s.stageStep();
  const frame = (): FrameRef | null => {
    const v = s.activeAlternative();
    if (!v || !isLive(v.status)) return null;
    const held = s.sheet.held();
    return held?.v === v ? { v, col: held.col } : { v };
  };
  const inUse = () => sameVersion(s.inUse(), step() ?? null);
  const [saving, setSaving] = createSignal<{ from: HTMLElement; move: boolean } | null>(null);
  const [borrowing, setBorrowing] = createSignal(false);
  const [menu, setMenu] = createSignal(false);
  let menuBtn: HTMLButtonElement | undefined;
  const name = () => {
    const st = step();
    return st ? s.nameOf(st) : "";
  };
  const inMenu = () => {
    const f = frame();
    return f ? frameActions(s, f).filter((a) => a.menu) : [];
  };
  const saveFor = (st: VersionStep) => saveForStep(s, st, inUse());
  const choose = (id: string) => {
    setMenu(false);
    if (id === "borrow") setBorrowing(!borrowing());
    else if (menuBtn) setSaving({ from: menuBtn, move: id === "move" });
  };
  return (
    <Show when={frame() && hasActs(s, frame()!) && step()} keyed>
      {(st) => (
        <>
          <div class="altacts" role="group" aria-label={`What to do with ${name()}`}>
            <div class="altacts-row">
              <MarkPill s={s} f={frame()!} inline />
              <Show when={inMenu().length}>
                <span
                  class="altacts-more"
                  onFocusOut={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setMenu(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Escape" || !menu()) return;
                    e.stopPropagation();
                    setMenu(false);
                    menuBtn?.focus();
                  }}
                >
                  <button
                    type="button"
                    class="ib"
                    ref={(el) => (menuBtn = el)}
                    aria-label={`More for ${name()}`}
                    aria-haspopup="menu"
                    aria-expanded={menu()}
                    title="More"
                    onClick={() => setMenu(!menu())}
                  >
                    <Icon name="more" />
                  </button>
                  <Show when={menu()}>
                    <div class="optmenu" role="menu" aria-label={name()}>
                      <For each={inMenu()}>
                        {(a) => (
                          <button type="button" role="menuitem" onClick={() => choose(a.id)}>
                            <Icon name={a.icon} />
                            {a.label}
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </span>
              </Show>
            </div>
            <Show when={borrowing()}>
              <div class="altacts-pop">
                <BorrowBox s={s} to={st} onDone={() => setBorrowing(false)} />
              </div>
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
          </div>
        </>
      )}
    </Show>
  );
}

// Copy puts it in a gathered idea or another design; Move also takes it from here, which
// archives it, unless it is in use.
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

// The live frame of the state on stage an answer names: its row's Borrow and Move are that
// frame's, where it has them.
export function answerFrame(s: DesignScreenState, alternative: string | undefined) {
  if (!alternative) return undefined;
  const v = s
    .alternatives()
    .find((x) => x.state === s.activeState() && x.alternative === alternative);
  return v && isLive(v.status) ? v : undefined;
}
export function answerAlternative(s: DesignScreenState, alternative: string | undefined) {
  const v = answerFrame(s, alternative);
  return v && canFrame(s, "move", { v }) ? newestOf(s, v.alternative) : undefined;
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
// part when the pages declare any; it goes with the next Send.
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
    const ok = s.steer({
      alternative: props.to.alternative,
      version: props.to.version,
      text: text().trim(),
      borrow: { from: f, ...(part() ? { part: part()! } : {}) },
    });
    if (ok) s.setToast({ text: `Borrow into ${s.nameOf(props.to)}, in Send` });
    props.onDone();
  };
  return (
    <Show when={others().length} fallback={<p class="altacts-none">Nothing to borrow from</p>}>
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
          placeholder="Which part?"
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
