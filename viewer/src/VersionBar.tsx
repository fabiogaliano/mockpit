// What acts on the version on stage: New version (ask for one), stepping through
// the state's versions, putting one in use, and the canvas tools. On a phone they
// float together as one bar; beside margins they sit in Focus's top bar, the versions
// behind one menu (VersionMenu).

import { createSignal, For, Show } from "solid-js";
import { colorQuestionPath } from "../../server/colorChoices.ts";
import { explicitKnob } from "../../server/knobs.ts";
import { framePicks } from "../../server/marks.ts";
import { tunedCount } from "../../server/types.ts";
import { backFromChanged } from "./ChangedNote.tsx";
import { comparable } from "./Compare.tsx";
import { canDesign } from "./frameActions.ts";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { neighbourStep, sameVersion, stepFor, type VersionRef, type VersionStep } from "./logic.ts";
import { usePopover } from "./popover.ts";
import { SendButton } from "./SendList.tsx";
import type { DesignScreenState } from "./state.ts";

// Asks for a new version of the one on stage; the request waits in Send.
export function NewVersionButton(props: { s: DesignScreenState; item?: boolean }) {
  const s = props.s;
  return (
    <button
      type="button"
      class={props.item ? "vnew" : "btn vnew"}
      role={props.item ? "menuitem" : undefined}
      aria-label="New version"
      title="Ask for a new version"
      disabled={!s.onStage()}
      onClick={() => s.askNew()}
    >
      <Icon name="plus" />
      <span class="lbl">New version</span>
    </button>
  );
}

// The arrows step; the label opens wherever this screen lists the versions.
export function VersionStepper(props: {
  s: DesignScreenState;
  listOpen: boolean;
  listNames: string;
  onList: () => void;
}) {
  const s = props.s;
  const step = () => s.stageStep();
  const name = () => {
    const at = s.stageLabel();
    return at ? s.nameOf(at) : "v1";
  };
  // What this version is: what prompted it, else the alternative's own note, else
  // its name when the label doesn't already say it.
  const note = () =>
    step()?.prompt ??
    s.activeAlternative()?.description ??
    (name() === `v${s.stageLabel()?.version ?? 1}` ? (step()?.alternative ?? "") : "");
  return (
    <div class="vgroup">
      <button
        type="button"
        class="ib"
        aria-label="Previous version"
        disabled={!neighbourStep(s.listed(), s.onStage(), -1)}
        onClick={() => s.stepVersion(-1)}
      >
        <Icon name="prev" />
      </button>
      <button
        type="button"
        class="vlabel"
        classList={{ on: props.listOpen }}
        aria-expanded={props.listOpen}
        aria-label={`Version ${name()}${note() ? `, ${note()}` : ""}. Show ${props.listNames}`}
        onClick={() => props.onList()}
      >
        <span class="v num">{name()}</span>
        <Show when={note()}>
          <span class="note" title={note()}>
            {note()}
          </span>
        </Show>
      </button>
      <button
        type="button"
        class="ib"
        aria-label="Next version"
        disabled={!neighbourStep(s.listed(), s.onStage(), 1)}
        onClick={() => s.stepVersion(1)}
      >
        <Icon name="next" />
      </button>
    </div>
  );
}

// Use: the picks go into the design the idea is for, Main first, and the way back to the
// version in use. With nothing picked it takes the frame on screen, and the question is the
// decision while it is open: no Use beside it. A screen or a component has nothing to put in
// use: its newest version is current, and Ready is its mark.
export function UseButton(props: { s: DesignScreenState; primary?: boolean }) {
  const s = props.s;
  const isSet = () => !!s.design()?.set;
  const picks = () => framePicks(s.marks(), { isSet: isSet(), rows: s.alternatives() });
  const setProgress = () => {
    if (!isSet()) return null;
    const frames = s.sheet.frames();
    if (!frames.length) return null;
    const knob = s.sheet.view()?.knob ?? s.sheet.held()?.at.knob ?? s.sheet.choiceKnobs()[0]?.path;
    if (knob === undefined) return null;
    const starred = frames.filter(
      (v) => s.frameKnobMark(v.state, v.alternative, knob) === "main",
    ).length;
    return { starred, total: frames.length };
  };
  const inUse = () => sameVersion(s.onStage(), s.inUse());
  const usedStep = () => stepFor(s.steps(), s.inUse());
  const questionOpen = () => !!s.curAsk() && !s.questionHidden();
  // On a newer version taking over, ChangedNote holds both ways out, so they'd show twice.
  const noteHasIt = () =>
    !s.design()?.archivedAt && !!s.changed() && sameVersion(s.onStage(), s.changed()?.to);
  // An idea for a screen or a component changes it: the button says which.
  const into = () => s.design()?.target?.title;
  // Used as they stand: nothing to take again until a pick moves.
  const pickedUsed = () => !!s.lastUse() && !s.changedSinceUse();
  const usedLabel = () => {
    const work = s.design()?.ideaWork;
    if (work === "placement") return "Awaiting placement";
    return work === "inProduct" ? "In product" : "In use";
  };
  const usedButton = () => (
    <button type="button" class="btn use on" disabled aria-label={usedLabel()}>
      <Icon name="check" />
      <span class="lbl">{usedLabel()}</span>
    </button>
  );
  const picksLabel = () => {
    if (!isSet()) return `Use · ${picks().length}`;
    const p = setProgress();
    return p ? `Use set · ${p.starred}/${p.total} ★` : `Use set · ${picks().length}`;
  };
  return (
    <Show when={!readonly() && canDesign(s, "use")}>
      <Show
        when={picks().length}
        fallback={
          <Show when={!questionOpen() && !noteHasIt()}>
            <Show when={usedStep() && !inUse()}>
              <button
                type="button"
                class="away"
                aria-label={`Back to ${s.nameOf(usedStep()!)} (in use)`}
                title={`Back to ${s.nameOf(usedStep()!)} (in use)`}
                onClick={() => s.showVersion(s.inUse()!)}
              >
                <Icon name="undo" />
                {s.nameOf(usedStep()!)}
              </button>
            </Show>
            <Show when={inUse()} fallback={useOne()}>
              {usedButton()}
            </Show>
          </Show>
        }
      >
        <Show when={!pickedUsed()} fallback={usedButton()}>
          <Show when={s.changedSinceUse()}>
            <span class="usechanged">Changed since Use</span>
          </Show>
          <button
            type="button"
            class="btn use"
            classList={{ go: props.primary }}
            aria-label={
              isSet()
                ? `Use set (${picks().length} items)${into() ? ` in ${into()}` : ""}`
                : `Use ${picks().length} picked${into() ? ` in ${into()}` : ""}`
            }
            title={into() ? `Into ${into()}` : undefined}
            onClick={() => void s.use()}
          >
            <span class="lbl">{picksLabel()}</span>
            <span class="sh">{isSet() ? "Use set" : "Use"}</span>
          </button>
        </Show>
      </Show>
    </Show>
  );
  function useOne() {
    return (
      <button
        type="button"
        class="btn use"
        classList={{ go: props.primary }}
        aria-label={into() ? `Use this version in ${into()}` : "Use this version"}
        title={into() ? `Use in ${into()}` : undefined}
        disabled={!s.onStage()}
        onClick={() => void s.use()}
      >
        <span class="lbl" classList={{ into: !!into() }}>
          {into() ? `Use in ${into()}` : "Use"}
        </span>
        <span class="sh">Use</span>
      </button>
    );
  }
}

// Try and Comment need a page to hand taps to or pin on; Tune needs something to tune.
export function CanvasTools(props: {
  s: DesignScreenState;
  page: boolean;
  colourPanelVisible?: boolean;
}) {
  const s = props.s;
  const tuned = () => tunedCount(s.draft()?.tunedOn) > 0;
  const contextualColour = () => {
    if (!props.colourPanelVisible || readonly() || s.tool() === "tune") return false;
    const knobs = s.knobContext().knobs;
    const held = s.sheet.held();
    if (held) {
      const cfg = held.at.knob ? knobs[held.at.knob] : undefined;
      return cfg !== undefined && explicitKnob(cfg).type === "color";
    }
    const ask = s.curAsk();
    return !!ask && !s.questionHidden() && !s.waitingOn(ask) && !!colorQuestionPath(ask, knobs, []);
  };
  const tool = (name: "try" | "mark" | "tune", label: string) => (
    <button
      type="button"
      class="ib tool"
      classList={{ on: s.tool() === name }}
      aria-pressed={s.tool() === name}
      aria-label={label}
      title={label}
      onClick={() => {
        if (name === "tune" && contextualColour()) s.openColorEditor();
        else s.toggleTool(name);
      }}
    >
      <Icon name={name} />
      <Show when={name === "tune" && tuned()}>
        <span class="tdot" aria-hidden="true" />
      </Show>
    </button>
  );
  return (
    <>
      <Show when={props.page}>
        {tool("try", "Try")}
        <Show when={!readonly()}>{tool("mark", "Comment")}</Show>
      </Show>
      <Show when={s.tunable().length}>{tool("tune", "Tune")}</Show>
    </>
  );
}

export function VersionBar(props: { s: DesignScreenState; reading?: boolean }) {
  const s = props.s;
  return (
    <div class="vbar" role="toolbar" aria-label="Versions and tools">
      <Show when={!readonly()}>
        <NewVersionButton s={s} />
        <span class="vsep" />
      </Show>
      <VersionStepper
        s={s}
        listOpen={!!s.panel()}
        listNames="history and activity"
        onList={() => s.setPanel(s.panel() ? null : "history")}
      />
      {/* A document is read and answered, not put in use, and has no page to try. */}
      <Show when={!props.reading}>
        <UseButton s={s} />
        <span class="vsep" />
        <div class="tools">
          <CanvasTools s={s} page />
        </div>
        <SendButton s={s} />
      </Show>
    </div>
  );
}

// A version newer than the one on stage that hasn't taken the stage by itself, because
// something unsent is bound to this one or the user is busy here: the way to it, and
// the dot on the version button that says it is there.
function newer(s: DesignScreenState): { label: string; title?: string; go: () => void } | null {
  const looking = (ref: VersionRef | null | undefined) => !!ref && sameVersion(s.onStage(), ref);
  if (s.boundVersion() !== null) {
    // An answer's own page is a hidden version: what came is new answers, not a version.
    const n = s.latest();
    const answers = s
      .alternatives()
      .filter((v) => v.version === n)
      .every((v) => v.history?.some((h) => h.version === n && "hidden" in h && h.hidden));
    const bound = s.arrived()?.bound;
    return {
      label: answers ? "New answers · View" : "New version · View",
      ...(bound ? { title: `Answers stay on ${bound}` } : {}),
      go: s.viewNewVersion,
    };
  }
  const c = !s.design()?.archivedAt && !readonly() ? s.changed() : null;
  if (c && !looking(c.to))
    return { label: `New: ${s.nameOf(c.to)} ›`, go: () => s.showVersion(c.to) };
  const a = s.sinceSend();
  if (a && !looking(a) && !sameVersion(c?.to, a))
    return { label: `New: ${s.nameOf(a)} ›`, go: s.seeSinceSend };
  return null;
}

// The version on stage, and the versions behind it: the others to step to, a newer one
// waiting, Compare and New version. Nothing about versions stands on the canvas.
export function VersionMenu(props: {
  s: DesignScreenState;
  // The version this browser last had on screen, when a newer one is on stage.
  saw?: VersionStep | null;
  onCompare?: (with_: VersionStep) => void;
}) {
  const s = props.s;
  const [open, setOpen] = createSignal(false);
  let btn: HTMLButtonElement | undefined;
  let pop: HTMLDivElement | undefined;
  usePopover(
    open,
    () => setOpen(false),
    () => btn,
    () => pop,
  );
  const name = () => {
    const at = s.stageLabel();
    return at ? s.nameOf(at) : "v1";
  };
  const waiting = () => newer(s);
  // An unmarked screen or component moved on by itself: the way back to what it showed,
  // which ChangedNote holds for the rest.
  const back = () => {
    const c = s.changed();
    return c && !canDesign(s, "use") && !c.marked && !readonly() && sameVersion(s.onStage(), c.to)
      ? c.use
      : null;
  };
  const rows = () => [...s.steps()].reverse();
  const lines = () => new Set(s.steps().map((x) => x.alternative)).size > 1;
  const act = (f: () => void) => () => {
    setOpen(false);
    f();
  };
  return (
    <div class="vmenu-at">
      <button
        type="button"
        class="btn vmenu-btn"
        classList={{ on: open() }}
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-label={`Version ${name()}${waiting() ? ", a newer one is waiting" : ""}`}
        ref={(el) => (btn = el)}
        onClick={() => setOpen(!open())}
      >
        <span class="num">{name()}</span>
        <Show when={waiting()}>
          <i class="dot ok vmenu-dot" aria-hidden="true" />
        </Show>
        <Icon name="down" />
      </button>
      <Show when={open()}>
        <div class="wmenu vmenu" role="menu" aria-label="Versions" ref={(el) => (pop = el)}>
          <Show when={waiting()}>
            {(x) => (
              <button
                type="button"
                role="menuitem"
                class="vmenu-new"
                title={x().title}
                onClick={act(x().go)}
              >
                <i class="dot ok" aria-hidden="true" />
                {x().label}
              </button>
            )}
          </Show>
          <Show when={back()}>
            {(to) => (
              <button
                type="button"
                role="menuitem"
                class="vmenu-new"
                onClick={act(() => backFromChanged(s))}
              >
                <Icon name="undo" />
                {`Back to ${s.nameOf(to())}`}
              </button>
            )}
          </Show>
          <Show when={s.steps().length > 1}>
            <div class="vmenu-list">
              <For each={rows()}>{(step) => <VersionItem s={s} step={step} named={lines()} />}</For>
            </div>
          </Show>
          <Show when={props.onCompare && props.saw}>
            {(saw) => (
              <button
                type="button"
                role="menuitem"
                title={`Last seen: ${s.nameOf(saw())}`}
                onClick={act(() => props.onCompare?.(saw()))}
              >
                Compare with last seen
              </button>
            )}
          </Show>
          <Show when={props.onCompare && comparable(s).length}>
            <select
              class="vmenu-compare"
              aria-label="Compare with another version"
              title="Compare side by side"
              value=""
              onChange={(e) => {
                const n = Number(e.currentTarget.value);
                e.currentTarget.value = "";
                const to = comparable(s).find((x) => x.n === n);
                setOpen(false);
                if (to) props.onCompare?.(to);
              }}
            >
              <option value="">Compare…</option>
              <For each={comparable(s).toReversed()}>
                {(x) => <option value={x.n}>{s.nameOf(x)}</option>}
              </For>
            </select>
          </Show>
          <Show when={!readonly()}>
            <span class="vmenu-wrap" onClick={() => setOpen(false)}>
              <NewVersionButton s={s} item />
            </span>
          </Show>
        </div>
      </Show>
    </div>
  );
}

// One version in the menu: the one on stage checked, the one in use ticked, a hidden one
// dimmed. The one on stage can be hidden from here, or restored.
function VersionItem(props: { s: DesignScreenState; step: VersionStep; named: boolean }) {
  const s = props.s;
  const on = () => sameVersion(props.step, s.onStage());
  const current = () => sameVersion(props.step, s.inUse());
  const note = () => {
    const v = s
      .alternatives()
      .find((o) => o.state === s.activeState() && o.alternative === props.step.alternative);
    return props.step.prompt ?? (v?.version === props.step.version ? v?.description : undefined);
  };
  return (
    <div class="vmenu-row" classList={{ hid: props.step.hidden }}>
      <button
        type="button"
        role="menuitemradio"
        aria-checked={on()}
        title={note()}
        onClick={() => s.showVersion(props.step)}
      >
        <span class="num">{props.named ? s.nameOf(props.step) : `v${props.step.version}`}</span>
        <Show when={note()}>
          <small class="vmenu-note">{note()}</small>
        </Show>
        <Show when={current()}>
          <Icon name="check" />
        </Show>
      </button>
      <Show when={on() && !readonly()}>
        <Show
          when={props.step.hidden}
          fallback={
            <button
              type="button"
              class="ib x-remove"
              classList={{ off: current() }}
              aria-disabled={current()}
              aria-label={current() ? "In use" : `Hide ${s.nameOf(props.step)}`}
              title={current() ? "In use" : `Hide ${s.nameOf(props.step)}`}
              onClick={() => !current() && void s.hideVersion(props.step, true)}
            >
              <Icon name="close" />
            </button>
          }
        >
          <button
            type="button"
            class="vrestore"
            onClick={() => void s.hideVersion(props.step, false)}
          >
            Restore
          </button>
        </Show>
      </Show>
    </div>
  );
}
