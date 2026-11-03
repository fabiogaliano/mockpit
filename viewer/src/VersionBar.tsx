// What acts on the version on stage: Revise (ask for a new one), stepping through
// the state's versions, putting one in use, and the canvas tools. On a phone they
// float together as one bar, with every situation side by side when there is one
// variant to see them in; beside margins each sits where it belongs (Margins.tsx).

import { Show } from "solid-js";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { neighbourStep, sameVersion, stepFor } from "./logic.ts";
import type { MockScreenState } from "./state.ts";

export function ReviseButton(props: { s: MockScreenState }) {
  const s = props.s;
  return (
    <button
      type="button"
      class="btn vnew"
      aria-label="Revise"
      title="Ask your agent for a new version"
      disabled={s.sending() || !s.onStage()}
      onClick={() => s.askNew()}
    >
      <Icon name="spark" />
      <span class="lbl">Revise</span>
    </button>
  );
}

// The arrows step; the label opens wherever this screen lists the versions.
export function VersionStepper(props: {
  s: MockScreenState;
  listOpen: boolean;
  listNames: string;
  onList: () => void;
}) {
  const s = props.s;
  const step = () => s.stageStep();
  const name = () => {
    const st = step();
    return st ? s.nameOf(st) : "#1";
  };
  // What this version is: what prompted it, else the variant's own note, else
  // its name when the label doesn't already say it.
  const note = () =>
    step()?.prompt ??
    s.activeVariant()?.note ??
    (name().startsWith("#") ? (step()?.variant ?? "") : "");
  return (
    <div class="vgroup">
      <button
        type="button"
        class="ib"
        aria-label="Previous version"
        disabled={!neighbourStep(s.steps(), s.onStage(), -1)}
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
        disabled={!neighbourStep(s.steps(), s.onStage(), 1)}
        onClick={() => s.stepVersion(1)}
      >
        <Icon name="next" />
      </button>
    </div>
  );
}

// Use this, and the way back to the version in use. The question is the decision
// while it is open: no Use this beside it.
export function UseThis(props: { s: MockScreenState }) {
  const s = props.s;
  const inUse = () => sameVersion(s.onStage(), s.inUse());
  const usedStep = () => stepFor(s.steps(), s.inUse());
  const questionOpen = () => !!s.curAsk() && !s.questionHidden();
  return (
    <Show when={!readonly() && !questionOpen()}>
      <Show when={usedStep() && !inUse()}>
        <button
          type="button"
          class="away"
          aria-label={`Back to ${s.nameOf(usedStep()!)}, the version in use`}
          title={`Back to ${s.nameOf(usedStep()!)}, in use`}
          onClick={() => s.showVersion(s.inUse()!)}
        >
          <Icon name="undo" />
          {s.nameOf(usedStep()!)}
        </button>
      </Show>
      <Show
        when={inUse()}
        fallback={
          <button
            type="button"
            class="btn use"
            aria-label="Use this version"
            disabled={!s.onStage()}
            onClick={() => void s.useThis()}
          >
            <span class="lbl">Use this</span>
            <span class="sh">Use</span>
          </button>
        }
      >
        <button type="button" class="btn use on" disabled aria-label="In use">
          <Icon name="check" />
          <span class="lbl">In use</span>
        </button>
      </Show>
    </Show>
  );
}

// Try and Comment need a page to hand taps to or pin on; Tune needs something to tune.
export function CanvasTools(props: { s: MockScreenState; page: boolean }) {
  const s = props.s;
  const tuned = () => Object.keys(s.draft()?.tuned ?? {}).length > 0;
  const tool = (name: "try" | "mark" | "tune", label: string, title: string) => (
    <button
      type="button"
      class="ib tool"
      classList={{ on: s.tool() === name }}
      aria-pressed={s.tool() === name}
      aria-label={label}
      title={title}
      onClick={() => s.toggleTool(name)}
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
        {tool("try", "Try", "Try: use the design as a prototype")}
        <Show when={!readonly()}>
          {tool("mark", "Comment", "Comment: tap the design to leave a comment there")}
        </Show>
      </Show>
      <Show when={s.tunable().length}>{tool("tune", "Tune", "Tune: tap a part to adjust it")}</Show>
    </>
  );
}

export function SituationsButton(props: { s: MockScreenState }) {
  const s = props.s;
  const sits = () => s.situations().length;
  return (
    <button
      type="button"
      class="btn vall"
      classList={{ on: s.allSituations() }}
      aria-pressed={s.allSituations()}
      aria-label={`${sits()} situations`}
      title="See every situation side by side"
      onClick={() => s.setAllSituations(!s.allSituations())}
    >
      <Icon name="grid" />
      <span>{sits()}</span>
      <span class="lbl">situations</span>
    </button>
  );
}

export function VersionBar(props: { s: MockScreenState; studio: boolean }) {
  const s = props.s;
  return (
    <div class="vbar" role="toolbar" aria-label="Versions and tools">
      <Show when={!props.studio && s.situations().length > 1}>
        <SituationsButton s={s} />
        <span class="vsep" />
      </Show>
      <Show when={!readonly()}>
        <ReviseButton s={s} />
        <span class="vsep" />
      </Show>
      <VersionStepper
        s={s}
        listOpen={!!s.panel()}
        listNames="history and thread"
        onList={() => s.setPanel(s.panel() ? null : "history")}
      />
      <UseThis s={s} />
      <span class="vsep" />
      <div class="tools">
        <CanvasTools s={s} page />
      </div>
    </div>
  );
}
