// A project at a glance, in a tab per kind of structure the agent declared,
// each showing the design in use for every screen (else its newest live
// version, unmarked): Pages, each page with its states; Flows, the declared
// flows as rows of screens in order; Components, each with where it is used;
// Sketches, everything else. A tab with nothing in it is not shown, and one
// alone needs no tab bar. Once the project names areas, a rail beside the tabs
// (a row of chips on a phone) picks one, in the project's area order, and an
// All tab shows every kind at once; the two combine, both in the URL. Each
// mock's card says where it stands (mockStatus), marks a version this browser
// hasn't opened (seen.ts), and has a ⋯ menu to move or close it. Above them,
// one line says what is waiting and links the next mock to
// answer, in the agent's order (nextOwedMock). The count opens the waiting
// mocks as rows; a swipe left on one (or its Close button) closes it: its
// open questions close unanswered and it moves to a folded Closed list,
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
import { Dynamic } from "solid-js/web";
import type { FlowStep, MockKind } from "../../server/types.ts";
import { api, type MockSummary, subscribe, surfaceUrl, type TreeNode } from "./api.ts";
import { CardMenu } from "./CardMenu.tsx";
import { setCarried } from "./carry.ts";
import { useSwipeAction } from "./gestures.ts";
import { host, readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import {
  type AreaGroup,
  designWidth,
  flowArea,
  groupByArea,
  type MockStatus,
  mockStatus,
  nextOwedMock,
  orderAreas,
  screenPicture,
  shortSource,
  timeAgo,
  versionStamp,
} from "./logic.ts";
import {
  type HomeView,
  linkClick,
  mockPath,
  navigate,
  projectPath,
  rememberHomeView,
} from "./route.ts";
import { unseen } from "./seen.ts";
import { setTheme, theme } from "./theme.ts";
import { Thumb } from "./Thumb.tsx";
import { TopBar } from "./TopBar.tsx";
import { phoneLayout } from "./viewport.ts";

const TABS: { view: HomeView; label: string }[] = [
  { view: "pages", label: "Pages" },
  { view: "flows", label: "Flows" },
  { view: "components", label: "Components" },
  { view: "sketches", label: "Sketches" },
];
const ALL_TAB = { view: "all" as const, label: "All" };

// Where each tab was scrolled to, so coming back to it lands where it was.
const scrolls = new Map<string, number>();

interface Row {
  name: string;
  // The declared flow the row is, carried into the screens it opens.
  flow: string;
  steps: FlowStep[];
}

// One area's (or the whole project's) mocks, by kind.
interface Slice {
  pages: TreeNode[];
  rows: Row[];
  components: TreeNode[];
  sketches: TreeNode[];
}

export function Home(props: {
  project: string | null;
  view: HomeView | null;
  area: string | null;
}) {
  // Home shows where every mock stands; a Send carried from a mock ends here.
  setCarried(null);
  const [projects, { refetch: refetchProjects }] = createResource(() => api.projects());
  const project = createMemo(() => props.project ?? projects()?.[0]?.name ?? null);
  const [list, { refetch: refetchList }] = createResource(project, (p) => api.mocks(p));
  const [tree, { refetch: refetchTree }] = createResource(project, (p) => api.tree(p));
  const refetch = () => Promise.all([refetchList(), refetchTree()]);

  // Oldest first, as the agent made them; a closed mock goes last in its group.
  const byAge = (a: TreeNode, b: TreeNode) =>
    Number(!!a.closedAt) - Number(!!b.closedAt) || a.createdAt.localeCompare(b.createdAt);
  const nodes = createMemo(() => [...(tree()?.tree ?? [])].sort(byAge));
  const bySlug = createMemo(() => new Map(nodes().map((n) => [n.slug, n])));
  const areaOrder = createMemo(() => tree()?.areaOrder ?? []);
  const areas = createMemo(() =>
    orderAreas(
      nodes().flatMap((n) => (n.area ? [n.area] : [])),
      areaOrder(),
    ),
  );
  const hasAreas = () => areas().length > 0;
  // The area the rail picked; one the project no longer has is all of them.
  const area = createMemo(() => (props.area && areas().includes(props.area) ? props.area : null));
  createEffect(() => {
    const p = project();
    if (p) rememberHomeView(p, props.view, area());
  });

  const allRows = createMemo<Row[]>(() =>
    (tree()?.flows ?? []).map((f) => ({ name: f.name, flow: f.name, steps: f.steps })),
  );
  const areaOf = (n: TreeNode) => n.area;
  const rowArea = (r: Row) => flowArea(r.steps, (slug) => bySlug().get(slug)?.area);
  // A flow belongs to every area one of its screens is in.
  const rowIn = (r: Row, a: string | null) =>
    a === null
      ? !r.steps.some((x) => bySlug().get(x.mock)?.area)
      : r.steps.some((x) => bySlug().get(x.mock)?.area === a);
  const slice = (keep: (n: TreeNode) => boolean, rows: Row[]): Slice => {
    const mine = nodes().filter(keep);
    return {
      pages: mine.filter((n) => n.kind === "page"),
      rows,
      components: mine.filter((n) => n.kind === "component"),
      sketches: mine.filter((n) => n.kind === "sketch"),
    };
  };
  const whole = createMemo(() => slice(() => true, allRows()));
  // What the rail leaves on screen: one area's mocks, or all of them.
  const shownSlice = createMemo(() => {
    const a = area();
    return a === null
      ? whole()
      : slice(
          (n) => n.area === a,
          allRows().filter((r) => rowIn(r, a)),
        );
  });
  const one = (rows: TreeNode[]): AreaGroup<TreeNode>[] => [{ area: null, rows }];
  const grouped = (rows: TreeNode[]) =>
    area() === null ? groupByArea(rows, areaOf, areaOrder()) : one(rows);
  const flowGroups = createMemo(() =>
    area() === null
      ? groupByArea(allRows(), rowArea, areaOrder())
      : [{ area: null, rows: shownSlice().rows }],
  );
  // The tabs count the whole project, so picking an area never moves them.
  const shown = createMemo(() => {
    const w = whole();
    const count: Record<Exclude<HomeView, "all">, number> = {
      pages: w.pages.length,
      flows: w.rows.length,
      components: w.components.length,
      sketches: w.sketches.length,
    };
    const kinds = TABS.filter((t) => count[t.view as keyof typeof count] > 0);
    return hasAreas() && kinds.length ? [ALL_TAB, ...kinds] : kinds;
  });
  const view = createMemo(() =>
    shown().some((t) => t.view === props.view) ? props.view : (shown()[0]?.view ?? null),
  );
  const fresh = createMemo(() => {
    const t = tree();
    if (!t || t.project !== project()) return new Set<string>();
    return unseen(
      t.project,
      t.tree.map((n) => ({ id: n.id, stamp: versionStamp(n.variants) })),
    );
  });

  // Resolved a moment ago, before the list catches up.
  const [leaving, setLeaving] = createSignal<Record<string, true>>({});
  const all = createMemo(() =>
    [...(list()?.mocks ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );
  const mocks = createMemo(() => all().filter((m) => !m.closedAt && !leaving()[m.id]));
  const resolved = createMemo(() =>
    all()
      .filter((m) => m.closedAt)
      .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "")),
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
  async function resolve(m: { id: string; title: string }) {
    setLeaving({ ...leaving(), [m.id]: true });
    try {
      await api.close(m.id);
      await refetch();
      say({ text: `Closed “${m.title}”`, undo: m.id });
    } catch (e) {
      say({ text: `Couldn't close “${m.title}”: ${e instanceof Error ? e.message : e}` });
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
  const scrollKey = () => `${project() ?? ""}|${view()}|${area() ?? ""}`;
  createEffect(
    on([scrollKey, () => !!tree()], ([key, loaded]) => {
      if (!loaded) return;
      host().window.requestAnimationFrame(() => {
        if (main) main.scrollTop = scrolls.get(key) ?? 0;
      });
    }),
  );

  // Plain clicks swap what Home shows in place; the history keeps one entry.
  const swap = (e: MouseEvent, path: string) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(path, { replace: true });
  };

  const tabs = () => (
    <Show when={shown().length > 1 && project()}>
      {(p) => (
        <nav class="home-tabs" aria-label="View">
          <For each={shown()}>
            {(t) => (
              <a
                href={projectPath(p(), t.view, area())}
                aria-current={view() === t.view ? "page" : undefined}
                onClick={(e) => swap(e, projectPath(p(), t.view, area()))}
              >
                {t.label}
              </a>
            )}
          </For>
        </nav>
      )}
    </Show>
  );

  const countIn = (a: string) => nodes().filter((n) => n.area === a).length;
  const owesIn = (a: string) => nodes().some((n) => n.area === a && n.open > 0);
  const rail = () => (
    <Show when={hasAreas() && project()}>
      {(p) => (
        <nav
          class="home-rail"
          classList={{ chips: phoneLayout() }}
          aria-label="Areas"
          // A row of chips scrolls sideways: the picked one stays in view.
          ref={(el) =>
            createEffect(
              on(
                area,
                () =>
                  phoneLayout() &&
                  host().window.requestAnimationFrame(() =>
                    el
                      .querySelector('[aria-current="page"]')
                      ?.scrollIntoView({ block: "nearest", inline: "nearest" }),
                  ),
              ),
            )
          }
        >
          <a
            href={projectPath(p(), props.view, null)}
            aria-current={area() === null ? "page" : undefined}
            onClick={(e) => swap(e, projectPath(p(), props.view, null))}
          >
            <span class="nm">All</span>
            <span class="n">{nodes().length}</span>
          </a>
          <For each={areas()}>
            {(a) => (
              <a
                href={projectPath(p(), props.view, a)}
                aria-current={area() === a ? "page" : undefined}
                data-area={a}
                onClick={(e) => swap(e, projectPath(p(), props.view, a))}
              >
                <span class="nm">
                  <Show when={owesIn(a)}>
                    <i class="dot" aria-label="open questions" />
                  </Show>
                  {a}
                </span>
                <span class="n">{countIn(a)}</span>
              </a>
            )}
          </For>
        </nav>
      )}
    </Show>
  );

  const card = (n: TreeNode, label: JSX.Element) => (
    <Card project={project()!} node={n} label={label} fresh={fresh().has(n.id)} menu={menuFor(n)} />
  );
  const menuFor = (n: TreeNode) =>
    readonly() ? undefined : (
      <CardMenu
        mock={n}
        areas={areas()}
        onClose={() => void resolve(n)}
        onReopen={() => void reopen(n.id)}
        onEdited={() => void refetch()}
      />
    );
  const screen = (n: TreeNode, state: string | null, flow: string | null, label: JSX.Element) => (
    <Screen project={project()!} node={n} state={state} flow={flow} label={label} />
  );
  const source = (n: TreeNode) => (
    <Show when={n.source}>
      {(src) => (
        <span class="home-src" title={src()}>
          {shortSource(src())}
        </span>
      )}
    </Show>
  );

  // The renderers, one per kind, shared by the kind tabs and All.
  const pagesOf = (groups: AreaGroup<TreeNode>[], level: 2 | 3 | 4) => (
    <Areas groups={groups} level={level}>
      {(n, h) => (
        <section class="home-sec" classList={{ closed: !!n.closedAt }} data-page={n.slug}>
          <Dynamic component={h} class="home-page-hd">
            <span class="home-page-title">{n.title}</span>
            {/* After the name, not before it: a leading dot reads as the
                rail's open-question bullet. */}
            <Show when={fresh().has(n.id)}>
              <i class="home-new" aria-label="new" />
            </Show>
            {source(n)}
            <StatusChip status={mockStatus(n)} />
            {menuFor(n)}
          </Dynamic>
          <div class="home-states">
            <For each={n.states}>{(state) => screen(n, state, null, state ?? n.title)}</For>
          </div>
        </section>
      )}
    </Areas>
  );
  // A flow no one area claims may still walk several: it is across them.
  const restOfFlows = (groups: AreaGroup<Row>[]) =>
    groups.some((g) => g.area === null && g.rows.some((r) => !rowIn(r, null)))
      ? "Across areas"
      : undefined;
  const flowsOf = (groups: AreaGroup<Row>[], level: 2 | 3 | 4) => (
    <Areas groups={groups} level={level} rest={restOfFlows(groups)}>
      {(row, h) => (
        <section class="home-sec">
          <Dynamic component={h}>
            {row.name}
            <span>{`${row.steps.length} ${row.steps.length === 1 ? "step" : "steps"}`}</span>
          </Dynamic>
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
                        <>
                          <b>{n().title}</b>
                          {x.state === null ? "" : ` · ${x.state}`}
                        </>,
                      )}
                    </>
                  )}
                </Show>
              )}
            </For>
          </div>
        </section>
      )}
    </Areas>
  );
  const componentsOf = (groups: AreaGroup<TreeNode>[], level: 2 | 3 | 4) => (
    <Areas groups={groups} level={level} grid>
      {(n) =>
        card(
          n,
          <>
            <span class="home-tl">
              <b>{n.title}</b>
              {source(n)}
            </span>
            <Show when={n.embeddedIn.length}>
              {`appears in ${n.embeddedIn.length} ${n.embeddedIn.length === 1 ? "mock" : "mocks"}`}
            </Show>
          </>,
        )
      }
    </Areas>
  );
  const sketchesOf = (groups: AreaGroup<TreeNode>[], level: 2 | 3 | 4) => (
    <Areas groups={groups} level={level} grid>
      {(n) =>
        card(
          n,
          <span class="home-tl">
            <b>{n.title}</b>
            {source(n)}
          </span>,
        )
      }
    </Areas>
  );
  // Every kind of one slice, in the order they are built: page, flows, the
  // components they embed, then the sketches; each under a small kind label.
  const kinds = (s: Slice, level: 2 | 3) => {
    const sub = (level + 1) as 3 | 4;
    const part = (label: string, count: number, body: () => JSX.Element) => (
      <Show when={count}>
        <section class="home-kind">
          <Dynamic component={`h${level}`} class="home-kind-hd">
            {label}
          </Dynamic>
          {body()}
        </section>
      </Show>
    );
    return (
      <>
        {part("Pages", s.pages.length, () => pagesOf(one(s.pages), sub))}
        {part("Flows", s.rows.length, () => flowsOf([{ area: null, rows: s.rows }], sub))}
        {part("Components", s.components.length, () => componentsOf(one(s.components), sub))}
        {part("Sketches", s.sketches.length, () => sketchesOf(one(s.sketches), sub))}
      </>
    );
  };
  // All with every area: each area (in the project's order, the unnamed last)
  // with its kinds.
  const everyArea = createMemo(() => {
    const groups = areas().map((a) => ({
      area: a as string | null,
      slice: slice(
        (n) => n.area === a,
        allRows().filter((r) => rowIn(r, a)),
      ),
    }));
    const rest = slice(
      (n) => !n.area,
      allRows().filter((r) => rowIn(r, null)),
    );
    const empty = (s: Slice) =>
      !s.pages.length && !s.rows.length && !s.components.length && !s.sketches.length;
    return empty(rest) ? groups : [...groups, { area: null, slice: rest }];
  });
  const nothing = () => {
    const s = shownSlice();
    const n = {
      all: s.pages.length + s.rows.length + s.components.length + s.sketches.length,
      pages: s.pages.length,
      flows: s.rows.length,
      components: s.components.length,
      sketches: s.sketches.length,
    };
    const v = view();
    return !!tree() && area() !== null && v !== null && n[v] === 0;
  };

  return (
    <div
      class="screen home"
      classList={{ "home-phone": phoneLayout(), "has-rail": hasAreas() && !phoneLayout() }}
    >
      <TopBar
        right={<Show when={!phoneLayout()}>{tabs()}</Show>}
        left={
          <>
            <span class="home-brand">mockpit</span>
            <span class="sep home-brand">·</span>
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
        <Show when={phoneLayout()}>{rail()}</Show>
        <Show when={phoneLayout() && shown().length > 1}>
          <div class="home-tabs-row">{tabs()}</div>
        </Show>
        <div class="home-body">
          <Show when={!phoneLayout()}>{rail()}</Show>
          <div class="home-content">
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
                    <section class="home-resolved" aria-label="Closed">
                      <button
                        type="button"
                        class="home-resolved-hd"
                        aria-expanded={resolvedOpen()}
                        onClick={() => setResolvedOpen(!resolvedOpen())}
                      >
                        <span class="answered-chev" aria-hidden="true">
                          ›
                        </span>
                        {`Closed · ${resolved().length}`}
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

              <Show when={nothing()}>
                <p class="home-empty">{`Nothing here in ${area()}.`}</p>
              </Show>

              <Show when={view() === "all"}>
                <Show when={area() === null} fallback={kinds(shownSlice(), 2)}>
                  <For each={everyArea()}>
                    {(g) => (
                      <section class="home-area">
                        <h2 class="home-area-hd">{g.area ?? "No area"}</h2>
                        {kinds(g.slice, 3)}
                      </section>
                    )}
                  </For>
                </Show>
              </Show>

              <Show when={view() === "flows"}>{flowsOf(flowGroups(), 2)}</Show>
              <Show when={view() === "pages"}>{pagesOf(grouped(shownSlice().pages), 2)}</Show>
              <Show when={view() === "components"}>
                {componentsOf(grouped(shownSlice().components), 2)}
              </Show>
              <Show when={view() === "sketches"}>
                {sketchesOf(grouped(shownSlice().sketches), 2)}
              </Show>
            </Show>
          </div>
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

type Heading = "h2" | "h3" | "h4" | "h5";

// A tab's rows under their area headings, the unnamed under "No area"; with no
// area named, just the rows, as before areas. `level` is the heading level the
// area takes; a row's own title takes the next one.
function Areas<T>(props: {
  groups: AreaGroup<T>[];
  level: 2 | 3 | 4;
  // The heading of the rows no area claims.
  rest?: string;
  // Rows laid out as a grid of pictures (components, sketches), one per area.
  grid?: boolean;
  children: (row: T, heading: Heading) => JSX.Element;
}) {
  const grouped = () => props.groups.some((g) => g.area !== null);
  const own = (): Heading => `h${grouped() ? props.level + 1 : props.level}` as Heading;
  const rows = (g: AreaGroup<T>) => {
    const list = <For each={g.rows}>{(row) => props.children(row, own())}</For>;
    return props.grid ? <div class="home-comps">{list}</div> : list;
  };
  return (
    <Show when={grouped()} fallback={<For each={props.groups}>{(g) => rows(g)}</For>}>
      <For each={props.groups}>
        {(g) => (
          <section class="home-area">
            <Dynamic component={`h${props.level}`} class="home-area-hd">
              {g.area ?? props.rest ?? "No area"}
            </Dynamic>
            {rows(g)}
          </section>
        )}
      </For>
    </Show>
  );
}

const STATUS_TEXT: Record<Exclude<MockStatus["kind"], "open">, string> = {
  changed: "Changed",
  decided: "Decided",
  exploring: "Exploring",
};

// Where a mock stands, in one or two words (logic.ts mockStatus).
function StatusChip(props: { status: MockStatus | null }) {
  return (
    <Show when={props.status}>
      {(st) => (
        <span class="home-status" data-status={st().kind}>
          {st().kind === "open"
            ? `${(st() as { n: number }).n} open`
            : STATUS_TEXT[st().kind as Exclude<MockStatus["kind"], "open">]}
        </span>
      )}
    </Show>
  );
}

// A component or sketch as a card: its picture opens it; the status sits on
// the picture, the ⋯ menu beside its name.
function Card(props: {
  project: string;
  node: TreeNode;
  label: JSX.Element;
  fresh: boolean;
  menu: JSX.Element | undefined;
}) {
  return (
    <div class="home-card" classList={{ closed: !!props.node.closedAt, "with-menu": !!props.menu }}>
      <Screen
        project={props.project}
        node={props.node}
        state={props.node.inUse[0]?.state ?? props.node.states[0] ?? null}
        flow={null}
        label={props.label}
        card
        fresh={props.fresh}
      />
      {props.menu}
    </div>
  );
}

// The picture a kind gets: a component fitted whole into a wide tile; a page
// or a sketch shaped to the width it is designed at, as a phone or a screen.
const tileOf = (kind: MockKind, width: number): "comp" | "phone" | "wide" =>
  kind === "component" ? "comp" : width < 700 ? "phone" : "wide";

// One screen as a picture that opens it. On a state of a page or a flow step,
// the design in use carries the check in its corner; a card says where the
// whole mock stands instead (StatusChip).
function Screen(props: {
  project: string;
  node: TreeNode;
  state: string | null;
  flow: string | null;
  label: JSX.Element;
  card?: boolean;
  fresh?: boolean;
}) {
  const pic = createMemo(() => screenPicture(props.node, props.state));
  const href = () =>
    mockPath(
      props.project,
      props.node.slug,
      props.state === null ? null : { state: props.state, variant: null },
      props.flow,
    );
  const tile = () => tileOf(props.node.kind, designWidth(props.node));
  const whole = () => tile() === "comp";
  return (
    <a
      class="home-step"
      classList={{
        phone: tile() === "phone",
        comp: tile() === "comp",
        card: !!props.card,
      }}
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
              fit={whole()}
              whole={whole()}
            />
          )}
        </Show>
        <Show
          when={props.card}
          fallback={
            <Show when={pic()?.inUse}>
              <span class="mk cur" aria-hidden="true">
                <Icon name="check" />
              </span>
            </Show>
          }
        >
          <StatusChip status={mockStatus(props.node)} />
          <Show when={props.fresh}>
            <i class="home-new" aria-label="new" />
          </Show>
        </Show>
      </span>
      <span class="home-lbl">
        {props.label}
        <Show when={!props.card && pic()?.inUse}>
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
          Close
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
              <Show when={props.mock.source}>
                {(src) => <span class="home-src" title={src()}>{` · ${shortSource(src())}`}</span>}
              </Show>
              <Show when={props.mock.closedAt}>{(at) => ` · closed ${timeAgo(at())}`}</Show>
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
            aria-label={`Close ${props.mock.title}`}
            title="Close: leave its open questions unanswered"
            onClick={commit}
          >
            Close
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
