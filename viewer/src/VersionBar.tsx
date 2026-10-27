// The one bar floating on the canvas: ask for a New version, step through the
// state's versions (the label opens the history and the thread), put the one
// on stage in use, and the canvas tools.

import { Show } from "solid-js";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { neighbourStep, sameVersion, stepFor } from "./logic.ts";
import type { MockScreenState } from "./state.ts";

export function VersionBar(props: { s: MockScreenState }) {
  const s = props.s;
  const step = () => s.stageStep();
  const total = () => s.steps().length;
  // What this version is: what prompted it, else the variant's own note, else its name.
  const note = () => step()?.prompt ?? s.activeVariant()?.note ?? step()?.variant ?? "";
  const inUse = () => sameVersion(s.onStage(), s.inUse());
  const usedStep = () => stepFor(s.steps(), s.inUse());
  // The question card is the decision while it is open: no Use this beside it.
  const cardOpen = () => !!s.curAsk() && !s.cardMin() && !s.panel();
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
    <div class="vbar" role="toolbar" aria-label="Versions and tools">
      <Show when={!readonly()}>
        <button
          type="button"
          class="btn go vnew"
          aria-label="New version"
          title="Ask your agent for a new version"
          disabled={s.sending() || !s.onStage()}
          onClick={() => s.askNew()}
        >
          <Icon name="spark" />
          <span class="lbl">New</span>
        </button>
        <span class="vsep" />
      </Show>
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
          classList={{ on: !!s.panel() }}
          aria-expanded={!!s.panel()}
          aria-label={`Version ${step()?.n ?? 1} of ${total() || 1}${note() ? `, ${note()}` : ""}. Show history and thread`}
          onClick={() => s.setPanel(s.panel() ? null : "history")}
        >
          <span class="v num">
            {`v${step()?.n ?? 1}`}
            <span class="of">{` of ${total() || 1}`}</span>
          </span>
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
      <Show when={!readonly() && !cardOpen()}>
        <Show when={usedStep() && !inUse()}>
          <button
            type="button"
            class="away"
            aria-label={`Back to v${usedStep()!.n}, the version in use`}
            title={`Back to v${usedStep()!.n}, in use`}
            onClick={() => s.showVersion(s.inUse()!)}
          >
            <Icon name="undo" />
            {`v${usedStep()!.n}`}
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
      <span class="vsep" />
      <div class="tools">
        {tool("try", "Try", "Try: use the design as a prototype")}
        <Show when={!readonly()}>
          {tool("mark", "Mark", "Mark: tap the design to leave a comment there")}
        </Show>
        <Show when={s.tunable().length}>
          {tool("tune", "Tune", "Tune: tap a part to adjust it")}
        </Show>
      </div>
    </div>
  );
}
