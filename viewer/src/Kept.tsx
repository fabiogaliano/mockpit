// What stays reachable after a question is answered: each answered question as one line
// in the panel, the answers it kept for later folded into it, and the same as pills on the
// design's top edge to look at without changing anything. Values follow every new version
// by themselves; a kept screen doesn't, so it says how far behind it is and how to bring
// it along.

import { createSignal, For, Show } from "solid-js";
import type { Ask, AskOption } from "../../server/types.ts";
import { canDesign } from "./frameActions.ts";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { answerIds, splitLabel } from "./logic.ts";
import { optionPicture, saidOf } from "./Questions.tsx";
import { AnsweredCard, pictured } from "./SideBySide.tsx";
import type { DesignScreenState } from "./state.ts";
import { Thumb } from "./Thumb.tsx";

export interface KeptGroup {
  ask: Ask;
  inUse: AskOption[];
  kept: AskOption[];
}

// The answered questions on the state on stage that kept answers for later.
export function keptGroups(s: DesignScreenState): KeptGroup[] {
  return s.closedAsks("state").flatMap((ask) => {
    const chosen = answerIds(ask.answer);
    const kept = ask.options.filter((o) => s.isPicked(ask, o.id) && !chosen.includes(o.id));
    if (!kept.length) return [];
    return [{ ask, kept, inUse: ask.options.filter((o) => chosen.includes(o.id)) }];
  });
}

// How many versions the screen in use gained since the kept one last changed.
function behind(s: DesignScreenState, ask: Ask, kept: AskOption, inUse: AskOption[]): number {
  const pic = optionPicture(s, ask, kept);
  const used = inUse.find((o) => o.alternative);
  if (!pic || !used?.alternative) return 0;
  const mine = s
    .alternatives()
    .find((v) => v.state === pic.state && v.alternative === used.alternative);
  if (!mine) return 0;
  const waited = s.standingFor(ask).since?.[kept.id] ?? "";
  const since = waited > pic.alternative.updatedAt ? waited : pic.alternative.updatedAt;
  return (mine.history ?? []).filter((h) => !("hidden" in h && h.hidden) && h.at > since).length;
}

// The answered questions on the state on stage, one line each: what was asked, what was
// said, and how many answers it kept. Opened, a line holds the rest: the answers as they
// were left, the kept ones with what can be done with them, and Change answer.
export function AnsweredLines(props: { s: DesignScreenState }) {
  const s = props.s;
  return (
    <Show when={s.closedAsks("state").length}>
      <section class="anslines" aria-label="Answered">
        <h4 class="anslines-hd">Answered</h4>
        <For each={s.closedAsks("state")}>{(a) => <AnsweredLine s={s} ask={a} />}</For>
      </section>
    </Show>
  );
}

function AnsweredLine(props: { s: DesignScreenState; ask: Ask }) {
  const s = props.s;
  const [open, setOpen] = createSignal(false);
  const group = () => keptGroups(s).find((g) => g.ask.id === props.ask.id);
  const kept = () => group()?.kept.length ?? 0;
  return (
    <div class="ansline" classList={{ open: open() }} data-answered={props.ask.id}>
      <button
        type="button"
        class="ansline-hd"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <span class="ansline-q">{props.ask.text}</span>
        <span class="ansline-said" classList={{ dismissed: !!props.ask.dismissed }}>
          {`${saidOf(props.ask)}${kept() ? ` · ${kept()} picked` : ""}`}
        </span>
        <span class="ansline-chev" aria-hidden="true">
          ›
        </span>
      </button>
      <Show when={open()}>
        <div class="ansline-more">
          <Show
            when={!props.ask.dismissed && pictured(s, props.ask)}
            fallback={
              <>
                <Show when={props.ask.comment && !props.ask.dismissed}>
                  <span class="answered-note">
                    <span class="sr-only">Comment: </span>
                    {props.ask.comment}
                  </span>
                </Show>
                <Show when={!readonly() && !props.ask.dismissed}>
                  <button
                    type="button"
                    class="secondary answered-change"
                    aria-label={`Change answer: ${props.ask.text}`}
                    onClick={() => s.changeAnswer(props.ask)}
                  >
                    Change answer
                  </button>
                </Show>
              </>
            }
          >
            <AnsweredCard s={s} ask={props.ask} bare />
          </Show>
          <Show when={group()}>
            {(g) => (
              <ul class="keptans" aria-label={`Picked: ${props.ask.text}`}>
                <For each={g().kept}>{(o) => <KeptRow s={s} group={g()} option={o} />}</For>
              </ul>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}

function KeptRow(props: { s: DesignScreenState; group: KeptGroup; option: AskOption }) {
  const s = props.s;
  const ask = () => props.group.ask;
  const o = () => props.option;
  const pic = () => optionPicture(s, ask(), o());
  const screen = () => !!o().alternative;
  const late = () => (screen() ? behind(s, ask(), o(), props.group.inUse) : 0);
  const carried = () => s.isCarried(ask(), o().id);
  const inUseName = () =>
    props.group.inUse.map((x) => splitLabel(x.label).name).join(", ") || "the one in use";
  const [busy, setBusy] = createSignal(false);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    await f();
    setBusy(false);
  };
  const preview = () => s.previewOf(ask(), o().id);
  return (
    <li
      class="keptrow"
      classList={{ previewing: s.preview()?.key === preview()?.key }}
      onPointerEnter={(e) => e.pointerType === "mouse" && s.setHoveredPreview(preview())}
      onPointerLeave={(e) => e.pointerType === "mouse" && s.setHoveredPreview(null)}
    >
      <Show when={pic()} fallback={<span class="keptrow-pic empty" />}>
        {(p) => (
          <span class="keptrow-pic">
            <Thumb width={s.frameW()} class="crop" fit whole src={p().src} knobs={p().knobs} />
          </span>
        )}
      </Show>
      <div class="keptrow-col">
        <span class="keptrow-name">{splitLabel(o().label).name}</span>
        <Show when={splitLabel(o().label).sub ?? pic()?.alternative.description}>
          {(d) => <span class="keptrow-desc">{d()}</span>}
        </Show>
        <Show when={screen()}>
          <span class="keptrow-late" classList={{ due: late() > 0 && !carried() }}>
            {carried()
              ? `Changed along with ${inUseName()}`
              : late()
                ? `Missing ${late()} update${late() > 1 ? "s" : ""}`
                : "Up to date"}
          </span>
        </Show>
        <Show when={!readonly()}>
          <span class="keptrow-acts">
            {/* A screen or a component has no entry to choose: its newest is current. */}
            <Show when={!screen() || canDesign(s, "use")}>
              <button
                type="button"
                class="btn"
                disabled={busy()}
                onClick={() => void run(() => s.useInstead(ask(), o()))}
              >
                {ask().multi ? "Use this too" : "Use this instead"}
              </button>
            </Show>
            <Show when={screen() && late() > 0 && !carried()}>
              <button
                type="button"
                class="btn"
                disabled={busy()}
                onClick={() => void run(async () => s.updateOnce(ask(), o()))}
              >
                Update now
              </button>
            </Show>
            <button
              type="button"
              class="optic optkeep on"
              aria-label={`Unpick ${o().label}`}
              title="Picked"
              onClick={() => s.togglePicked(ask(), o())}
            >
              <Icon name="check" />
            </button>
          </span>
          <Show when={screen()}>
            <fieldset class="keptrow-mode">
              <legend>{`When ${inUseName()} changes`}</legend>
              <span class="seg">
                <label title="It falls behind, and you can update it when you want it.">
                  <input
                    type="radio"
                    name={`carry-${ask().id}-${o().id}`}
                    checked={!carried()}
                    disabled={busy()}
                    onChange={() => void run(() => s.carryKept(ask(), o(), false))}
                  />
                  Leave as is
                </label>
                <label title="Always current, but the agent makes every change twice.">
                  <input
                    type="radio"
                    name={`carry-${ask().id}-${o().id}`}
                    checked={carried()}
                    disabled={busy()}
                    onChange={() => void run(() => s.carryKept(ask(), o(), true))}
                  />
                  Keep in sync
                </label>
              </span>
            </fieldset>
          </Show>
        </Show>
      </div>
    </li>
  );
}

// On the design's top edge: the answer in use and the kept ones.
// Hovering one shows it; a click holds it there. Neither changes anything.
export function AnswerPills(props: { s: DesignScreenState }) {
  const s = props.s;
  // A question whose answers have pictures keeps them in its own row instead.
  const groups = () => keptGroups(s).filter((g) => !pictured(s, g.ask));
  const hold = (p: ReturnType<typeof s.previewOf>) => {
    if (!p) return;
    if (s.heldPreview()?.key === p.key) s.setPreview(null);
    else s.setHeldPreview(p);
  };
  const pill = (
    key: string | undefined,
    label: string,
    p: () => ReturnType<typeof s.previewOf>,
    use?: boolean,
  ) => (
    <button
      type="button"
      class="apill"
      classList={{ on: !!key && s.preview()?.key === key, use: !!use }}
      aria-pressed={!!key && s.heldPreview()?.key === key}
      onPointerEnter={(e) => e.pointerType === "mouse" && !use && s.setHoveredPreview(p())}
      onPointerLeave={(e) => e.pointerType === "mouse" && s.setHoveredPreview(null)}
      onClick={() => (use ? s.setPreview(null) : hold(p()))}
    >
      {label}
    </button>
  );
  return (
    <Show when={groups().length}>
      <div class="apills" role="group" aria-label="Picked answers: look without changing">
        <For each={groups()}>
          {(g) => (
            <span class="apills-row">
              {pill(
                undefined,
                g.inUse.map((o) => splitLabel(o.label).name).join(", ") || "In use",
                () => null,
                true,
              )}
              <For each={g.kept}>
                {(o) =>
                  pill(s.previewOf(g.ask, o.id)?.key, splitLabel(o.label).name, () =>
                    s.previewOf(g.ask, o.id),
                  )
                }
              </For>
            </span>
          )}
        </For>
      </div>
    </Show>
  );
}
