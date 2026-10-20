// The mock screen: top bar, the stage with its state strip, and the panel.
// Where the panel does not fit beside the stage, the stage is a canvas under
// its own header and the questions float over it as a card.

import { type JSX, Show } from "solid-js";
import { CanvasHead } from "./CanvasHead.tsx";
import { useFlowKeys } from "./flowKeys.ts";
import { CarriedChip } from "./NextCard.tsx";
import { linkClick, projectPath } from "./route.ts";
import { Panel } from "./Panel.tsx";
import { QuestionCard } from "./QuestionCard.tsx";
import { Stage } from "./Stage.tsx";
import { createMockScreen } from "./state.ts";
import { Strip } from "./Strip.tsx";
import { createTune } from "./tune.ts";
import { TopBar } from "./TopBar.tsx";
import { canvasLayout, phoneLayout } from "./viewport.ts";

export function MockScreen(props: {
  project: string;
  slug: string;
  open?: { state: string | null; variant: string } | null;
}) {
  const s = createMockScreen(props.project, props.slug, props.open ?? null);
  const t = createTune(s);
  useFlowKeys(s);
  const home = () => projectPath(props.project);
  // What the top bar says on its right: an open count, or how a Send went.
  const status = (): JSX.Element => (
    <Show
      when={s.sent()}
      fallback={
        <>
          <CarriedChip project={props.project} slug={props.slug} />
          <Show when={s.mode() !== "questions" && s.owed().length > 0}>
            <button type="button" class="pill reopen" onClick={() => s.goOwed()}>
              <i class="dot" />
              {`${s.owed().length} open ›`}
            </button>
          </Show>
        </>
      }
    >
      <Show when={s.nudgeAgent()}>
        <span class="sent-hint" role="status">
          tell your agent you've answered
        </span>
      </Show>
      <button
        type="button"
        class="pill count"
        classList={{ waiting: s.sentDelivered() === false }}
        onClick={() => s.setMode("thread")}
      >
        <i class="dot" classList={{ ok: s.sentDelivered() !== false }} />
        <span>{`Sent · ${s.sentDelivered() === false ? "Not seen yet" : "Delivered"}`}</span>
      </button>
    </Show>
  );
  return (
    <div
      class="screen mock-screen"
      classList={{ "on-canvas": canvasLayout(), phone: phoneLayout(), inspecting: s.inspect() }}
    >
      <Show
        when={canvasLayout()}
        fallback={
          <TopBar
            left={
              <>
                <a class="home" href={home()} onClick={(e) => linkClick(e, home())}>
                  {`‹ ${props.project}`}
                </a>
                <span class="sep">/</span>
                <b>{s.mock()?.title ?? props.slug}</b>
              </>
            }
            right={status()}
          />
        }
      >
        <Show when={s.mock()} fallback={<div />}>
          <CanvasHead s={s} project={props.project} right={status()} />
        </Show>
      </Show>
      <Show
        when={!s.missing()}
        fallback={
          <main class="main">
            <p class="home-empty">{`No mock "${props.slug}" in ${props.project}.`}</p>
          </main>
        }
      >
        <main class="main">
          <div class="col">
            <Show when={s.mock()}>
              <Stage s={s} />
              <Show when={!canvasLayout()}>
                <Strip s={s} />
              </Show>
            </Show>
          </div>
        </main>
        <Show when={s.mock()}>
          <Show when={canvasLayout()} fallback={<Panel s={s} t={t} />}>
            <Show when={!s.inspect()}>
              <QuestionCard s={s} t={t} />
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
