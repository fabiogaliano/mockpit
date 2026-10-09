// The mock screen: top bar, the stage with its state strip, and the panel.

import { Show } from "solid-js";
import { linkClick, projectPath } from "./route.ts";
import { Panel } from "./Panel.tsx";
import { Stage } from "./Stage.tsx";
import { createMockScreen } from "./state.ts";
import { Strip } from "./Strip.tsx";
import { createTune } from "./tune.ts";
import { TopBar } from "./TopBar.tsx";

export function MockScreen(props: { project: string; slug: string }) {
  const s = createMockScreen(props.project, props.slug);
  const t = createTune(s);
  const home = () => projectPath(props.project);
  return (
    <div class="screen mock-screen">
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
        right={
          <Show
            when={s.sent()}
            fallback={
              <Show when={s.mode() !== "questions" && s.owed().length > 0}>
                <button
                  type="button"
                  class="pill reopen"
                  onClick={() => {
                    const first = s.owed()[0];
                    const i = s
                      .questions()
                      .findIndex((q) => q.kind === "ask" && q.ask.id === first.id);
                    s.goQuestion(Math.max(0, i));
                  }}
                >
                  <i class="dot" />
                  {`${s.owed().length} open ›`}
                </button>
              </Show>
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
        }
      />
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
              <Strip s={s} />
            </Show>
          </div>
        </main>
        <Show when={s.mock()}>
          <Panel s={s} t={t} />
        </Show>
      </Show>
    </div>
  );
}
