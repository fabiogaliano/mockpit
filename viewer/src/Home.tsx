// D10: the project's mocks, newest activity first — thumbnail · name · states ·
// draft progress · open count · age — under one line that says what is waiting
// and links the next mock to answer, in the agent's order (nextOwedMock).
// A swipe left on a row (or its Resolve button) resolves the mock: its open
// questions close unanswered and it moves to a folded Resolved list, where
// Reopen brings it back.

import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { api, type MockSummary, subscribe, surfaceUrl } from "./api.ts";
import { setCarried } from "./carry.ts";
import { useSwipeAction } from "./gestures.ts";
import { host, readonly } from "./host.ts";
import { nextOwedMock, timeAgo } from "./logic.ts";
import { linkClick, mockPath, navigate, projectPath } from "./route.ts";
import { setTheme, theme } from "./theme.ts";
import { Thumb } from "./Thumb.tsx";
import { TopBar } from "./TopBar.tsx";

export function Home(props: { project: string | null }) {
  // Home shows where every mock stands; a Send carried from a mock ends here.
  setCarried(null);
  const [projects, { refetch: refetchProjects }] = createResource(() => api.projects());
  const project = createMemo(() => props.project ?? projects()?.[0]?.name ?? null);
  const [list, { refetch }] = createResource(project, (p) => api.mocks(p));
  // Resolved a moment ago, before the list catches up.
  const [leaving, setLeaving] = createSignal<Record<string, true>>({});
  const all = createMemo(() =>
    [...(list()?.mocks ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );
  const mocks = createMemo(() => all().filter((m) => !m.resolvedAt && !leaving()[m.id]));
  const resolved = createMemo(() =>
    all()
      .filter((m) => m.resolvedAt)
      .sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? "")),
  );
  // Rows are keyed by id, so a refetch mid-swipe updates a row in place
  // instead of remounting it out from under the finger.
  const byId = createMemo(() => Object.fromEntries(all().map((m) => [m.id, m])));
  const [resolvedOpen, setResolvedOpen] = createSignal(false);
  const open = () => list()?.open ?? 0;
  const next = createMemo(() => nextOwedMock(mocks(), null));

  // One line after a resolve, with Undo, since a swipe is easy to make by mistake.
  const [toast, setToast] = createSignal<{ text: string; undo?: string } | null>(null);
  let toastTimer = 0;
  const say = (t: { text: string; undo?: string }) => {
    host().window.clearTimeout(toastTimer);
    setToast(t);
    toastTimer = host().window.setTimeout(() => setToast(null), 6000);
  };
  onCleanup(() => host().window.clearTimeout(toastTimer));
  async function resolve(m: MockSummary) {
    setLeaving({ ...leaving(), [m.id]: true });
    try {
      await api.resolve(m.id);
      await refetch();
      say({ text: `Resolved “${m.title}”`, undo: m.id });
    } catch (e) {
      say({ text: `Couldn't resolve “${m.title}”: ${e instanceof Error ? e.message : e}` });
    } finally {
      const { [m.id]: _, ...rest } = leaving();
      setLeaving(rest);
    }
  }
  async function reopen(id: string) {
    host().window.clearTimeout(toastTimer);
    setToast(null);
    try {
      await api.reopen(id);
      await refetch();
    } catch (e) {
      say({ text: `Couldn't reopen: ${e instanceof Error ? e.message : e}` });
    }
  }

  const stop = subscribe(
    (e) => {
      if (e.type === "theme-changed") setTheme(e.mode === "light" ? "light" : "dark");
      else if (
        e.type.startsWith("mock-") ||
        e.type.startsWith("post-") ||
        e.type === "comment-created"
      ) {
        void refetch();
        if (e.type === "mock-created" || e.type === "mock-deleted") void refetchProjects();
      }
    },
    () => void refetch(),
  );
  onCleanup(stop);

  return (
    <div class="screen home">
      <TopBar
        left={
          <>
            <span>mockpit</span>
            <span class="sep">·</span>
            <Show when={(projects()?.length ?? 0) > 1} fallback={<b>{project() ?? ""}</b>}>
              <label class="home-project">
                <select
                  aria-label="Project"
                  value={project() ?? ""}
                  onChange={(e) => navigate(projectPath(e.currentTarget.value))}
                >
                  <For each={projects()}>{(p) => <option value={p.name}>{p.name}</option>}</For>
                </select>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <path d="M6 9.5L12 15.5L18 9.5" />
                </svg>
              </label>
            </Show>
          </>
        }
      />
      <main class="home-main">
        <div class="home-col">
          <Show
            when={project()}
            fallback={
              <Show when={!projects.loading}>
                <p class="home-empty">
                  Nothing published yet. Agents publish with `mockpit publish`.
                </p>
              </Show>
            }
          >
            <p class="home-lead">
              <Show
                when={open() > 0}
                fallback={
                  <>
                    <i class="dot ok" />0 open · all answered
                  </>
                }
              >
                <i class="dot" />
                {`${open()} open across ${list()?.openMocks ?? 0} ${list()?.openMocks === 1 ? "mock" : "mocks"} ·`}
                <a
                  class="home-next"
                  href={mockPath(project()!, next()?.slug ?? "")}
                  title={next()?.title}
                  onClick={(e) => linkClick(e, mockPath(project()!, next()?.slug ?? ""))}
                >
                  Answer next ›
                </a>
              </Show>
            </p>
            <ol class="home-list">
              <For each={mocks().map((m) => m.id)}>
                {(id) => (
                  <Show when={byId()[id]}>
                    {(m) => (
                      <MockRow
                        mock={m()}
                        project={project()!}
                        {...(readonly() ? {} : { onResolve: () => void resolve(m()) })}
                      />
                    )}
                  </Show>
                )}
              </For>
            </ol>
            <Show when={resolved().length}>
              <section class="home-resolved" aria-label="Resolved">
                <button
                  type="button"
                  class="home-resolved-hd"
                  aria-expanded={resolvedOpen()}
                  onClick={() => setResolvedOpen(!resolvedOpen())}
                >
                  <span class="answered-chev" aria-hidden="true">
                    ›
                  </span>
                  {`Resolved · ${resolved().length}`}
                </button>
                <Show when={resolvedOpen()}>
                  <ol class="home-list">
                    <For each={resolved().map((m) => m.id)}>
                      {(id) => (
                        <Show when={byId()[id]}>
                          {(m) => (
                            <MockRow
                              mock={m()}
                              project={project()!}
                              {...(readonly() ? {} : { onReopen: () => void reopen(id) })}
                            />
                          )}
                        </Show>
                      )}
                    </For>
                  </ol>
                </Show>
              </section>
            </Show>
          </Show>
        </div>
      </main>
      <Show when={toast()}>
        {(t) => (
          <div class="home-toast" role="status">
            <span>{t().text}</span>
            <Show when={t().undo}>
              {(id) => (
                <button type="button" class="home-toast-undo" onClick={() => void reopen(id())}>
                  Undo
                </button>
              )}
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

const reducedMotion = () =>
  host().window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function MockRow(props: {
  mock: MockSummary;
  project: string;
  onResolve?: () => void;
  onReopen?: () => void;
}) {
  const href = () => mockPath(props.project, props.mock.slug);
  const thumb = () => props.mock.thumbnail;
  // How far a finger has pulled the row left; null at rest.
  const [dx, setDx] = createSignal<number | null>(null);
  const [gone, setGone] = createSignal(false);
  let slide!: HTMLDivElement;
  const armed = () => {
    const d = dx();
    return d !== null && d < -Math.min(140, (slide?.clientWidth ?? 0) * 0.4);
  };
  // The row slides off before the list moves it into Resolved.
  const commit = () => {
    if (!props.onResolve || gone()) return;
    setGone(true);
    setDx(null);
    host().window.setTimeout(() => props.onResolve?.(), reducedMotion() ? 0 : 180);
  };
  return (
    <li
      class="home-item"
      classList={{ "is-resolved": !!props.onReopen, swiping: dx() !== null || gone() }}
    >
      <Show when={props.onResolve}>
        <div class="home-swipe-act" classList={{ armed: armed() || gone() }} aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <path d="M3.5 8.5l3 3 6-7" />
          </svg>
          Resolve
        </div>
      </Show>
      <div
        class="home-slide"
        classList={{ dragging: dx() !== null, gone: gone() }}
        style={dx() === null ? {} : { transform: `translate3d(${dx()}px, 0, 0)` }}
        ref={(el) => {
          slide = el;
          if (props.onResolve) useSwipeAction(el, { enabled: () => !gone(), move: setDx, commit });
        }}
      >
        <a
          class="home-row"
          href={href()}
          onClick={(e) => linkClick(e, href())}
          data-mock={props.mock.slug}
        >
          <div class="home-thumb">
            <Show when={thumb()}>
              {(t) => (
                <Thumb
                  src={surfaceUrl(t().postId, t().surface, { version: t().version, mode: theme() })}
                />
              )}
            </Show>
          </div>
          <div class="home-text">
            <div class="home-name">{props.mock.title}</div>
            <div class="home-sub">
              {props.mock.stateCount === 1 ? "1 state" : `${props.mock.stateCount} states`}
              <Show when={props.mock.resolvedAt}>{(at) => ` · resolved ${timeAgo(at())}`}</Show>
              <Show when={props.mock.drafted !== undefined && props.mock.open > 0}>
                <span class="home-draft" title="Answered, not sent yet">
                  {` · draft ${props.mock.drafted}/${props.mock.open}`}
                </span>
              </Show>
            </div>
          </div>
          <Show
            when={props.mock.open > 0}
            fallback={
              <span class="home-done" title="decided">
                ✓
              </span>
            }
          >
            <span class="home-chip">
              <i class="dot" />
              {`${props.mock.open} open`}
            </span>
          </Show>
          <span class="home-ago">{timeAgo(props.mock.updatedAt)}</span>
        </a>
        <Show when={props.onResolve}>
          <button
            type="button"
            class="home-act"
            aria-label={`Resolve ${props.mock.title}`}
            title="Resolve: close its open questions unanswered"
            onClick={commit}
          >
            Resolve
          </button>
        </Show>
        <Show when={props.onReopen}>
          <button
            type="button"
            class="home-act reopen"
            aria-label={`Reopen ${props.mock.title}`}
            onClick={() => props.onReopen?.()}
          >
            Reopen
          </button>
        </Show>
      </div>
    </li>
  );
}
