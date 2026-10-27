// A project at a glance, in three tabs, each showing the design in use for
// every screen (else its newest live version, unmarked): Flows, the declared
// flows as rows of screens in order (with none declared, each page's own
// states); Pages, each page with its states; Components, each with where it is
// used. Above them, one line says what is waiting and links the next mock to
// answer, in the agent's order (nextOwedMock). The count opens the waiting
// mocks as rows; a swipe left on one (or its Resolve button) resolves it: its
// open questions close unanswered and it moves to a folded Resolved list,
// where Reopen brings it back.

import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  Show,
} from "solid-js";
import type { FlowStep } from "../../server/types.ts";
import { api, type MockSummary, subscribe, surfaceUrl, type TreeNode } from "./api.ts";
import { setCarried } from "./carry.ts";
import { useSwipeAction } from "./gestures.ts";
import { host, readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { designWidth, nextOwedMock, screenPicture, timeAgo } from "./logic.ts";
import {
  type HomeView,
  linkClick,
  mockPath,
  navigate,
  projectPath,
  rememberHomeView,
} from "./route.ts";
import { setTheme, theme } from "./theme.ts";
import { Thumb } from "./Thumb.tsx";
import { TopBar } from "./TopBar.tsx";
import { phoneLayout } from "./viewport.ts";

const TABS: { view: HomeView; label: string }[] = [
  { view: "flows", label: "Flows" },
  { view: "pages", label: "Pages" },
  { view: "components", label: "Components" },
];

// Where each tab was scrolled to, so coming back to it lands where it was.
const scrolls = new Map<string, number>();

interface Row {
  name: string;
  // The declared flow the row is, carried into the screens it opens.
  flow: string | null;
  steps: FlowStep[];
}

export function Home(props: { project: string | null; view: HomeView }) {
  // Home shows where every mock stands; a Send carried from a mock ends here.
  setCarried(null);
  const [projects, { refetch: refetchProjects }] = createResource(() => api.projects());
  const project = createMemo(() => props.project ?? projects()?.[0]?.name ?? null);
  const [list, { refetch: refetchList }] = createResource(project, (p) => api.mocks(p));
  const [tree, { refetch: refetchTree }] = createResource(project, (p) => api.tree(p));
  const refetch = () => Promise.all([refetchList(), refetchTree()]);
  createEffect(() => {
    const p = project();
    if (p) rememberHomeView(p, props.view);
  });

  const byAge = (a: TreeNode, b: TreeNode) => a.createdAt.localeCompare(b.createdAt);
  const nodes = createMemo(() => [...(tree()?.tree ?? [])].sort(byAge));
  const bySlug = createMemo(() => new Map(nodes().map((n) => [n.slug, n])));
  const pages = createMemo(() => nodes().filter((n) => n.kind === "page"));
  const components = createMemo(() => nodes().filter((n) => n.kind !== "page"));
  // With no flow declared, each page's own states make a row; a project of
  // components only shows those, so the first tab is never empty.
  const rows = createMemo<Row[]>(() => {
    const flows = tree()?.flows ?? [];
    if (flows.length) return flows.map((f) => ({ name: f.name, flow: f.name, steps: f.steps }));
    return (pages().length ? pages() : nodes()).map((n) => ({
      name: n.title,
      flow: null,
      steps: n.states.map((state) => ({ mock: n.slug, state })),
    }));
  });

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
  const waiting = createMemo(() =>
    mocks()
      .filter((m) => m.open > 0)
      .map((m) => m.id),
  );
  const [listOpen, setListOpen] = createSignal(false);
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

  // Each tab keeps its own scroll; the screens' boxes are sized before their
  // pictures load, so the place is right as soon as the tree is in.
  let main!: HTMLElement;
  const scrollKey = () => `${project() ?? ""}|${props.view}`;
  createEffect(
    on([scrollKey, () => !!tree()], ([key, loaded]) => {
      if (!loaded) return;
      host().window.requestAnimationFrame(() => {
        if (main) main.scrollTop = scrolls.get(key) ?? 0;
      });
    }),
  );

  const tabs = () => (
    <Show when={project()}>
      {(p) => (
        <nav class="home-tabs" aria-label="View">
          <For each={TABS}>
            {(t) => (
              <a
                href={projectPath(p(), t.view)}
                aria-current={props.view === t.view ? "page" : undefined}
                onClick={(e) => {
                  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  navigate(projectPath(p(), t.view), { replace: true });
                }}
              >
                {t.label}
              </a>
            )}
          </For>
        </nav>
      )}
    </Show>
  );

  const screen = (n: TreeNode, state: string | null, flow: string | null, label: JSX.Element) => (
    <Screen project={project()!} node={n} state={state} flow={flow} label={label} />
  );

  return (
    <div class="screen home" classList={{ "home-phone": phoneLayout() }}>
      <TopBar
        right={<Show when={!phoneLayout()}>{tabs()}</Show>}
        left={
          <>
            <span>mockpit</span>
            <span class="sep">·</span>
            <Show when={(projects()?.length ?? 0) > 1} fallback={<b>{project() ?? ""}</b>}>
              <label class="home-project">
                <select
                  aria-label="Project"
                  value={project() ?? ""}
                  onChange={(e) => navigate(projectPath(e.currentTarget.value, props.view))}
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
      <main
        class="home-main"
        ref={(el) => (main = el)}
        onScroll={() => scrolls.set(scrollKey(), main.scrollTop)}
      >
        <Show when={phoneLayout()}>
          <div class="home-tabs-row">{tabs()}</div>
        </Show>
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
          <div class="home-lead">
            <Show
              when={waiting().length || resolved().length}
              fallback={
                <span class="home-count">
                  <i class="dot ok" />0 open · all answered
                </span>
              }
            >
              <button
                type="button"
                class="home-count"
                aria-expanded={listOpen()}
                onClick={() => setListOpen(!listOpen())}
              >
                <i class="dot" classList={{ ok: open() === 0 }} />
                {open() > 0
                  ? `${open()} open across ${list()?.openMocks ?? 0} ${list()?.openMocks === 1 ? "mock" : "mocks"}`
                  : "0 open · all answered"}
              </button>
            </Show>
            <Show when={open() > 0}>
              <span class="sep">·</span>
              <a
                class="home-next"
                href={mockPath(project()!, next()?.slug ?? "")}
                title={next()?.title}
                onClick={(e) => linkClick(e, mockPath(project()!, next()?.slug ?? ""))}
              >
                Answer next ›
              </a>
            </Show>
          </div>
          <Show when={listOpen() && (waiting().length || resolved().length)}>
            <div class="home-waiting">
              <ol class="home-list">
                <For each={waiting()}>
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
            </div>
          </Show>

          <Show when={props.view === "flows"}>
            <For each={rows()}>
              {(row) => (
                <section class="home-sec">
                  <h2>
                    {row.name}
                    <Show when={row.flow}>
                      <span>{`${row.steps.length} ${row.steps.length === 1 ? "step" : "steps"}`}</span>
                    </Show>
                  </h2>
                  <div class="home-flow">
                    <For each={row.steps}>
                      {(x, i) => (
                        <Show when={bySlug().get(x.mock)}>
                          {(n) => (
                            <>
                              <Show when={i() > 0}>
                                <span class="home-arrow" aria-hidden="true" />
                              </Show>
                              {screen(
                                n(),
                                x.state,
                                row.flow,
                                row.flow ? (
                                  <>
                                    <b>{n().title}</b>
                                    {x.state === null ? "" : ` · ${x.state}`}
                                  </>
                                ) : (
                                  (x.state ?? n().title)
                                ),
                              )}
                            </>
                          )}
                        </Show>
                      )}
                    </For>
                  </div>
                </section>
              )}
            </For>
          </Show>

          <Show when={props.view === "pages"}>
            <For each={pages()}>
              {(n) => (
                <section class="home-sec">
                  <h2>{n.title}</h2>
                  <div class="home-states">
                    <For each={n.states}>{(state) => screen(n, state, null, state ?? n.title)}</For>
                  </div>
                </section>
              )}
            </For>
          </Show>

          <Show when={props.view === "components"}>
            <div class="home-comps">
              <For each={components()}>
                {(n) =>
                  screen(
                    n,
                    n.inUse[0]?.state ?? n.states[0] ?? null,
                    null,
                    <>
                      <b>{n.title}</b>
                      <Show when={n.usedIn.length}>
                        {`in ${n.usedIn.length} ${n.usedIn.length === 1 ? "screen" : "screens"}`}
                      </Show>
                    </>,
                  )
                }
              </For>
            </div>
          </Show>
        </Show>
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

// One screen as a picture that opens it: the design in use carries the check
// in its corner; anything else is shown unmarked.
function Screen(props: {
  project: string;
  node: TreeNode;
  state: string | null;
  flow: string | null;
  label: JSX.Element;
}) {
  const pic = createMemo(() => screenPicture(props.node, props.state));
  const href = () =>
    mockPath(
      props.project,
      props.node.slug,
      props.state === null ? null : { state: props.state, variant: null },
      props.flow,
    );
  const component = () => props.node.kind !== "page";
  const phone = () => designWidth(props.node) < 700;
  return (
    <a
      class="home-step"
      classList={{ phone: phone() && !component(), comp: component() }}
      href={href()}
      onClick={(e) => linkClick(e, href())}
      data-mock={props.node.slug}
      data-state={props.state ?? ""}
    >
      <span class="home-pic">
        <Show when={pic()}>
          {(p) => (
            <Thumb
              src={surfaceUrl(p().postId, p().surface, {
                version: p().version,
                mode: theme(),
                e: p().embedsKey,
              })}
              width={designWidth(props.node)}
              fit={component()}
              whole={component()}
            />
          )}
        </Show>
        <Show when={pic()?.inUse}>
          <span class="mk cur" aria-hidden="true">
            <Icon name="check" />
          </span>
        </Show>
      </span>
      <span class="home-lbl">
        {props.label}
        <Show when={pic()?.inUse}>
          <span class="sr-only">, in use</span>
        </Show>
      </span>
    </a>
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
