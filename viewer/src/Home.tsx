// A project at a glance: a sidebar of what it holds, and the shelf picked from it.
// Sections light up by use: screens and components as declared, flows once one is,
// and the rest as ideas or documents by what they contain (albums.ts). Albums that
// wait on the user glow, and so does the project's name. A project of one or two
// mocks has no sidebar and shows large covers; a phone gets the sidebar as a drawer.
// Everything in this file is one address: `?sec=` and `?area=` (route.ts), and each
// place keeps its own scroll.

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
import type { FlowStep } from "../../server/types.ts";
import { api, assetUrl, type MockSummary, subscribe, surfaceUrl, type TreeNode } from "./api.ts";
import { Album, DocRow, FlowStepTile } from "./Album.tsx";
import {
  DATED_FROM,
  dateGroups,
  litSections,
  newestFirst,
  questions,
  type Section,
  SECTION_LABEL,
  sectionOf,
  type ShelfSection,
  usedIn,
} from "./albums.ts";
import { CardMenu } from "./CardMenu.tsx";
import { createDecisions, Decisions } from "./Decisions.tsx";
import { setCarried } from "./carry.ts";
import { useSwipeAction } from "./gestures.ts";
import { AddCandidates } from "./AddCandidates.tsx";
import { host, readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { openJump } from "./Jump.tsx";
import {
  nothingLeft,
  type AreaGroup,
  flowArea,
  groupByArea,
  nextOwedMock,
  orderAreas,
  shortSource,
  timeAgo,
  versionStamp,
  keepSame,
} from "./logic.ts";
import {
  type HomePlace,
  linkClick,
  mockPath,
  navigate,
  projectPath,
  questionPath,
  rememberHomePlace,
  rootPath,
} from "./route.ts";
import { NotFound } from "./NotFound.tsx";
import { ProjectSwitcher } from "./ProjectSwitcher.tsx";
import { Reason } from "./Reason.tsx";
import { createShortlists } from "./shortlist.ts";
import { unseen } from "./seen.ts";
import { setTheme, theme } from "./theme.ts";
import { Sidebar } from "./Sidebar.tsx";
import { Thumb } from "./Thumb.tsx";
import { Toast, type ToastLine } from "./toast.tsx";
import { TopBar } from "./TopBar.tsx";
import { phoneLayout } from "./viewport.ts";

// Where each place was scrolled to, so coming back to it lands where it was.
const scrolls = new Map<string, number>();
// Which date headings and folds the user opened or shut, for the same reason.
const folds = new Map<string, boolean>();

// A project this small is one or two things to look at, not a place to navigate.
const SIDEBAR_FROM = 3;
// Up to this many mocks in a lone section, the sidebar lists them by name.
const TREE_UP_TO = 12;
const ACTIVITY_ROWS = 30;

interface Row {
  name: string;
  // The declared flow the row is, carried into the screens it opens.
  flow: string;
  steps: FlowStep[];
}

type Shown = HomePlace | "area" | "tiny";

export function Home(props: {
  project: string | null;
  sec: HomePlace | null;
  area: string | null;
}) {
  // Home shows where every mock stands; a Send carried from a mock ends here.
  setCarried(null);
  const [projects, { refetch: refetchProjects }] = createResource(() => api.projects());
  const project = createMemo(() => props.project ?? projects()?.[0]?.name ?? null);
  const noSuchProject = () => {
    const known = projects();
    return !!known && !!props.project && !known.some((p) => p.name === props.project);
  };
  const [list, { refetch: refetchList }] = createResource(project, (p) => api.mocks(p));
  const [rawTree, { refetch: refetchTree }] = createResource(project, (p) => api.tree(p));
  // A resource keeps its last value while the next loads: the other project's
  // sections mustn't stand in for this one's.
  const tree = () => {
    const t = rawTree();
    return t && t.project === project() ? t : undefined;
  };
  const decisions = createDecisions(project);
  const decisionCount = () => decisions.list()?.lines.length ?? 0;
  // The switcher's glow speaks for every project, so any change may move it.
  const refetch = () =>
    Promise.all([refetchList(), refetchTree(), decisions.refetch(), refetchProjects()]);
  // An agent publishing a batch fires an event per variant; one read covers them.
  let refetchTimer = 0;
  const refetchSoon = () => {
    if (refetchTimer) return;
    refetchTimer = host().window.setTimeout(() => {
      refetchTimer = 0;
      void refetch();
    }, 300);
  };
  onCleanup(() => host().window.clearTimeout(refetchTimer));

  // Oldest first, as the agent made them, for the declared shelves.
  const byAge = (a: TreeNode, b: TreeNode) => a.createdAt.localeCompare(b.createdAt);
  const nodes = createMemo<TreeNode[]>(
    (was) => keepSame(was, [...(tree()?.tree ?? [])].sort(byAge), (n) => n.slug),
    [],
  );
  const bySlug = createMemo(() => new Map(nodes().map((n) => [n.slug, n])));
  // Ended a moment ago, before the tree catches up.
  const [leaving, setLeaving] = createSignal<Record<string, true>>({});
  // One way off the shelf, however it got there: ended by hand, or with every design
  // archived. Both are in the Archive, the ended ones first and newest first.
  const inArchive = (n: TreeNode) => !!n.closedAt || nothingLeft(n);
  const onShow = createMemo(() => nodes().filter((n) => !inArchive(n) && !leaving()[n.id]));
  const archived = createMemo(() =>
    nodes()
      .filter(inArchive)
      .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "")),
  );
  const areaOrder = createMemo(() => tree()?.areaOrder ?? []);
  const areas = createMemo(() =>
    orderAreas(
      onShow().flatMap((n) => (n.area ? [n.area] : [])),
      areaOrder(),
    ),
  );
  // An area the project no longer has is all of them.
  const area = createMemo(() => (props.area && areas().includes(props.area) ? props.area : null));

  const allRows = createMemo<Row[]>(
    (was) =>
      keepSame(
        was,
        (tree()?.flows ?? []).map((f) => ({ name: f.name, flow: f.name, steps: f.steps })),
        (r) => r.name,
      ),
    [],
  );
  // A flow belongs to every area one of its screens is in.
  const rowIn = (r: Row, a: string | null) =>
    a === null
      ? !r.steps.some((x) => bySlug().get(x.mock)?.area)
      : r.steps.some((x) => bySlug().get(x.mock)?.area === a);
  const rowArea = (r: Row) => flowArea(r.steps, (slug) => bySlug().get(slug)?.area);

  const inSection = (sec: ShelfSection, a: string | null = null) =>
    onShow().filter((n) => sectionOf(n) === sec && (a === null || n.area === a));
  const counts = createMemo<Record<Section, number>>(() => ({
    ideas: inSection("ideas").length,
    screens: inSection("screens").length,
    components: inSection("components").length,
    documents: inSection("documents").length,
    flows: allRows().length,
  }));
  const lit = createMemo(() => litSections(counts()));
  const landing = (): Section | null => lit().rows[0] ?? lit().foot;
  const isLit = (s: HomePlace): s is Section =>
    lit().rows.includes(s as Section) || lit().foot === s;

  // How much the project holds, known as soon as the project list is: the shape of
  // the page shouldn't wait for the tree.
  const held = () =>
    tree()?.tree.length ?? projects()?.find((p) => p.name === project())?.mocks ?? null;
  const tiny = () => {
    const n = held();
    return n !== null && n < SIDEBAR_FROM;
  };
  const hasSidebar = () => {
    const n = held();
    return n !== null && n >= SIDEBAR_FROM && !noSuchProject();
  };

  const all = createMemo(() =>
    [...(list()?.mocks ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );
  const mocks = createMemo(() => all().filter((m) => !m.closedAt && !leaving()[m.id]));
  // Rows are keyed by id, so a refetch mid-swipe updates a row in place
  // instead of remounting it out from under the finger.
  const byId = createMemo(() => Object.fromEntries(all().map((m) => [m.id, m])));
  const waiting = createMemo(() =>
    mocks()
      .filter((m) => m.open > 0)
      .map((m) => m.id),
  );
  const open = () => list()?.open ?? 0;
  const next = createMemo(() => nextOwedMock(mocks(), null));

  // A place in the URL stands until the data says it's empty. Before then it isn't
  // known to be wrong, and flashing the first section at a reload would be a lie.
  const shown = createMemo<Shown | null>(() => {
    const sec = props.sec;
    const loaded = !!tree() && !!list();
    if (sec === "decisions" && (decisions.list.loading || decisionCount() > 0)) return sec;
    if (sec && !loaded && sec !== "decisions") return sec;
    if (sec === "needs" && waiting().length) return sec;
    if (sec === "archive" && archived().length) return sec;
    if (sec === "activity" && nodes().length) return sec;
    if (tiny()) return loaded ? "tiny" : null;
    if (sec && isLit(sec)) return sec;
    if (area()) return "area";
    // Everything archived: that's all there is to show.
    return landing() ?? (loaded && archived().length ? "archive" : null);
  });
  createEffect(() => {
    const p = project();
    if (p) rememberHomePlace(p, props.sec, area());
  });
  const shelfOn = (): Section | null => {
    const s = shown();
    return s === "ideas" ||
      s === "screens" ||
      s === "flows" ||
      s === "components" ||
      s === "documents"
      ? s
      : null;
  };

  const fresh = createMemo(() => {
    const t = tree();
    if (!t) return new Set<string>();
    return unseen(
      t.project,
      t.tree.map((n) => ({ id: n.id, stamp: versionStamp(n.variants) })),
    );
  });

  const [toast, setToast] = createSignal<ToastLine | null>(null);
  const saveReason = (id: string, reason: string | null) =>
    void api.reason(id, { reason }).then(
      () => refetch(),
      (e) => setToast({ text: `Couldn't keep that: ${e instanceof Error ? e.message : e}` }),
    );
  // One line after it goes, with Undo, since a swipe is easy to make by mistake, and
  // a place to say why. Nothing is asked first.
  async function end(m: { id: string; title: string }, word: "Ended" | "Archived") {
    setLeaving({ ...leaving(), [m.id]: true });
    try {
      const { reason } = await api.close(m.id);
      await refetch();
      setToast({
        text: `${word} “${m.title}”`,
        undo: () => void reopen(m.id),
        reason: { value: reason, save: (r) => saveReason(m.id, r) },
      });
    } catch (e) {
      setToast({ text: `Couldn't take away “${m.title}”: ${e instanceof Error ? e.message : e}` });
    } finally {
      const { [m.id]: _, ...rest } = leaving();
      setLeaving(rest);
    }
  }
  async function reopen(id: string) {
    setToast(null);
    try {
      await api.reopen(id);
      await refetch();
    } catch (e) {
      setToast({ text: `Couldn't restore: ${e instanceof Error ? e.message : e}` });
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
        refetchSoon();
      }
    },
    () => void refetch(),
  );
  onCleanup(stop);

  // Each place keeps its own scroll; the albums' boxes are sized before their
  // pictures load, so the place is right as soon as the tree is in.
  let main!: HTMLElement;
  const scrollKey = () => `${project() ?? ""}|${props.sec}|${shown()}|${area() ?? ""}`;
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

  const [drawer, setDrawer] = createSignal(false);
  createEffect(() => {
    if (!drawer()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawer(false);
    };
    host().window.addEventListener("keydown", onKey);
    onCleanup(() => host().window.removeEventListener("keydown", onKey));
  });
  // Nothing to fold away once the window is wide enough to show it.
  createEffect(() => {
    if (!phoneLayout()) setDrawer(false);
  });

  const owesIn = (a: string) => onShow().some((n) => n.area === a && n.open > 0);
  const countIn = (a: string) => onShow().filter((n) => n.area === a).length;
  // The lone section, whose mocks the sidebar can list by name: there's no section
  // choice to make there, and the shelf beside it is the same few things larger. A
  // dated list already is the names.
  const treeGroups = () => {
    const { rows, foot } = lit();
    if (rows.length !== 1 || foot || rows[0] === "flows" || rows[0] === "documents") return null;
    const only = inSection(rows[0] as ShelfSection);
    if (only.length > TREE_UP_TO) return null;
    return groupByArea(only, (n) => n.area, areaOrder()).map((g) => ({
      area: g.area,
      nodes: g.rows,
    }));
  };

  const sidebar = (inDrawer: boolean) => (
    <Sidebar
      project={project() ?? ""}
      projects={projects() ?? []}
      place={shown()}
      area={area()}
      open={open()}
      rows={lit().rows.map((sec) => ({ sec, count: counts()[sec] }))}
      foot={lit().foot ? { sec: lit().foot!, count: counts()[lit().foot!] } : null}
      areas={areas().map((name) => ({ name, count: countIn(name), waits: owesIn(name) }))}
      tree={treeGroups()}
      decisions={decisions.list() ?? null}
      onDecisions={(n) => decisions.mutate(n)}
      archived={archived().length}
      activity={nodes().length > 0}
      go={swap}
      onNav={() => setDrawer(false)}
      drawer={inDrawer}
      inert={inDrawer && !drawer()}
    />
  );

  const menuFor = (n: TreeNode) =>
    readonly() ? undefined : (
      <CardMenu
        mock={n}
        areas={areas()}
        endLabel={sectionOf(n) === "ideas" ? "End this idea" : "Archive"}
        onClose={() => void end(n, sectionOf(n) === "ideas" ? "Ended" : "Archived")}
        onEdited={() => void refetch()}
      />
    );
  const album = (n: TreeNode) => (
    <Album
      project={project()!}
      node={n}
      fresh={fresh().has(n.id)}
      menu={menuFor(n)}
      extra={n.kind === "component" ? usedIn(n, (s) => bySlug().get(s)?.kind) : undefined}
      {...(!readonly() && sectionOf(n) === "ideas" ? { onEnd: () => void end(n, "Ended") } : {})}
    />
  );
  const docRow = (n: TreeNode) => (
    <DocRow project={project()!} node={n} fresh={fresh().has(n.id)} menu={menuFor(n)} />
  );

  // A shelf is albums, or a dated list where they're written pages. Newest first
  // where work comes in bursts; as the agent ordered them where it's a declared map.
  const shelf = (
    sec: ShelfSection,
    rows: () => TreeNode[],
    dated: () => boolean,
    where: string,
  ) => {
    const newest = sec === "ideas" || sec === "documents";
    const live = createMemo(() => (newest ? [...rows()].sort(newestFirst) : rows()));
    const body = (list: () => TreeNode[]) =>
      sec === "documents" ? (
        <ul class="home-docs">
          <For each={list()}>{docRow}</For>
        </ul>
      ) : (
        <div class="albums">
          <For each={list()}>{album}</For>
        </div>
      );
    const groups = createMemo(() =>
      dated() && live().length >= DATED_FROM ? dateGroups(live(), sec === "ideas") : null,
    );
    const groupKeys = createMemo(() => groups()?.map((g) => g.key) ?? []);
    return (
      <>
        <Show when={groups()} fallback={<Show when={live().length}>{body(live)}</Show>}>
          <For each={groupKeys()}>
            {(key) => {
              const group = () => groups()?.find((g) => g.key === key);
              return (
                <Fold
                  id={`${project()}|${sec}|${where}|${key}`}
                  label={() => `${group()?.label ?? ""} · ${group()?.rows.length ?? 0}`}
                  startOpen={() => group()?.open ?? false}
                  class="home-date"
                >
                  {body(() => group()?.rows ?? [])}
                </Fold>
              );
            }}
          </For>
        </Show>
      </>
    );
  };

  // A section of the project, under the areas it names, or one area of it.
  const sectionShelf = (sec: ShelfSection) => {
    // Headings by area or by date, not both: one level of them is enough to scan.
    const noAreas = () => area() !== null || !areas().length;
    return (
      <Areas
        groups={
          noAreas()
            ? [{ area: null, rows: inSection(sec, area()) }]
            : groupByArea(inSection(sec), (n) => n.area, areaOrder())
        }
        level={2}
      >
        {(rows, name) => shelf(sec, rows, noAreas, name ?? area() ?? "")}
      </Areas>
    );
  };

  // A flow no one area claims may still walk several: it is across them.
  const restOfFlows = (groups: AreaGroup<Row>[]) =>
    groups.some((g) => g.area === null && g.rows.some((r) => !rowIn(r, null)))
      ? "Across areas"
      : undefined;
  const flowRow = (row: Row) => (
    <section class="home-sec">
      <h3>
        {row.name}
        <span>{`${row.steps.length} ${row.steps.length === 1 ? "step" : "steps"}`}</span>
      </h3>
      <div class="home-flow">
        <For each={row.steps}>
          {(x, i) => (
            <Show when={bySlug().get(x.mock)}>
              {(n) => (
                <>
                  <Show when={i() > 0}>
                    <span class="home-arrow" aria-hidden="true" />
                  </Show>
                  <FlowStepTile project={project()!} node={n()} state={x.state} flow={row.flow} />
                </>
              )}
            </Show>
          )}
        </For>
      </div>
    </section>
  );
  const flowsAll = () => {
    const groups = () =>
      area() === null
        ? groupByArea(allRows(), rowArea, areaOrder())
        : [{ area: null, rows: allRows().filter((r) => rowIn(r, area())) }];
    return (
      <Areas groups={groups()} level={2} rest={restOfFlows(groups())}>
        {(rows) => <For each={rows()}>{flowRow}</For>}
      </Areas>
    );
  };

  // Everything in one area, under the sections it spans; each heading narrows to it.
  const SECTIONS_OF_AREA: Section[] = ["screens", "flows", "components", "ideas", "documents"];
  const inAreaCount = (sec: Section, a: string) =>
    sec === "flows" ? allRows().filter((r) => rowIn(r, a)).length : inSection(sec, a).length;
  const wholeArea = () => (
    <For each={SECTIONS_OF_AREA.filter((sec) => inAreaCount(sec, area() ?? "") > 0)}>
      {(sec) => {
        const path = () => projectPath(project()!, sec, area());
        return (
          <section class="home-kind">
            <h2 class="home-kind-hd">
              <a href={path()} onClick={(e) => swap(e, path())}>
                {SECTION_LABEL[sec]}
              </a>
            </h2>
            {sec === "flows"
              ? flowsAll()
              : shelf(
                  sec,
                  () => inSection(sec, area()),
                  () => true,
                  area() ?? "",
                )}
          </section>
        );
      }}
    </For>
  );

  const heading = () => {
    const s = shown();
    const a = area();
    if (s === "tiny" || s === null) return null;
    if (s === "area") return a;
    const label =
      s === "needs"
        ? "Needs you"
        : s === "decisions"
          ? "Decisions"
          : s === "archive"
            ? "Archive"
            : s === "activity"
              ? "Activity"
              : SECTION_LABEL[s];
    return a && shelfOn() ? `${label} in ${a}` : label;
  };
  const headingCount = () => {
    const s = shown();
    const a = area();
    const sec = shelfOn();
    if (sec) {
      return a && sec !== "flows"
        ? inSection(sec, a).length
        : a
          ? inAreaCount(sec, a)
          : counts()[sec];
    }
    if (s === "area" && a) return countIn(a);
    if (s === "archive") return archived().length;
    if (s === "decisions") return decisionCount();
    return null;
  };
  // A place reached from a link, with no sidebar to leave by, brings its own way back.
  const noWayBack = () => tiny() && shown() !== "tiny" && shown() !== null;
  const emptyInArea = () => {
    const a = area();
    const sec = shelfOn();
    return !!tree() && !!a && !!sec && inAreaCount(sec, a) === 0;
  };
  const nothingPublished = () =>
    !projects.loading && (!project() || (!!tree() && nodes().length === 0));

  // No heading and nothing to say: a tiny project opens straight on its covers.
  const leadHasWords = () => open() > 0 || (tiny() && decisionCount() > 0);

  const [archivedOpen, setArchivedOpen] = createSignal(false);
  const archiveRow = (n: TreeNode) => {
    const href = () => mockPath(project()!, n.slug);
    return (
      <li class="home-arch">
        <a href={href()} onClick={(e) => linkClick(e, href())}>
          {n.title}
        </a>
        <span class="home-arch-when">
          {n.closedAt ? timeAgo(n.closedAt) : "every design archived"}
        </span>
        {/* Work can still land in something ended, and here is where it would wait. */}
        <Show when={fresh().has(n.id)}>
          <span class="alb-new">
            <i aria-hidden="true" />
            New
          </span>
        </Show>
        <Show when={n.closedAt}>
          <Reason value={n.closeReason} onSave={(r) => saveReason(n.id, r)} />
          <Show when={!readonly()}>
            <button
              type="button"
              class="btn home-arch-back"
              aria-label={`Restore ${n.title}`}
              onClick={() => void reopen(n.id)}
            >
              Restore
            </button>
          </Show>
        </Show>
      </li>
    );
  };
  const [gathering, setGathering] = createSignal(false);

  const switcher = () => (
    <ProjectSwitcher
      current={noSuchProject() ? null : project()}
      known={!noSuchProject()}
      projects={projects() ?? []}
    />
  );
  const searchButton = () => (
    <button
      type="button"
      class="themebtn"
      aria-label="Search"
      title="Search ( / or ⌘K )"
      onClick={openJump}
    >
      <Icon name="search" />
    </button>
  );

  return (
    <div
      class="screen home"
      classList={{
        "home-phone": phoneLayout(),
        "has-side": hasSidebar() && !phoneLayout(),
      }}
    >
      <Show when={hasSidebar() && !phoneLayout()}>{sidebar(false)}</Show>
      <Show when={hasSidebar() && phoneLayout()}>
        <div
          class="side-scrim"
          classList={{ on: drawer() }}
          aria-hidden="true"
          onClick={() => setDrawer(false)}
        />
        {sidebar(true)}
      </Show>
      <Show when={!hasSidebar() || phoneLayout()}>
        <TopBar
          bare={hasSidebar()}
          right={searchButton()}
          left={
            <>
              <Show when={hasSidebar()}>
                <button
                  type="button"
                  class="themebtn home-menu"
                  aria-label="Open project menu"
                  aria-expanded={drawer()}
                  onClick={() => setDrawer(true)}
                >
                  <Icon name="menu" />
                </button>
              </Show>
              <span class="home-brand">mockpit</span>
              <span class="sep home-brand">·</span>
              {switcher()}
            </>
          }
        />
      </Show>
      <main
        class="home-main"
        ref={(el) => (main = el)}
        onScroll={() => scrolls.set(scrollKey(), main.scrollTop)}
      >
        <Show
          when={!noSuchProject()}
          fallback={
            <NotFound
              title={`No project called “${props.project}”`}
              hint="It may have been renamed, or nothing has been published there yet."
              href={rootPath()}
              back="Go to your projects"
            />
          }
        >
          <Show
            when={!nothingPublished()}
            fallback={
              <p class="home-empty">
                Nothing published yet. Agents publish with `mockpit publish`.
              </p>
            }
          >
            <Show when={heading() || leadHasWords()}>
              <header class="home-head">
                <Show when={heading()}>
                  {(title) => (
                    <h1>
                      {title()}
                      <Show when={headingCount()}>
                        {(n) => <span class="home-head-n">{n()}</span>}
                      </Show>
                    </h1>
                  )}
                </Show>
                {/* Narrowed by both: the way back to the whole of either is here. */}
                <Show when={area() && shelfOn()}>
                  <a
                    class="home-next home-unfilter"
                    href={projectPath(project()!, null, area())}
                    onClick={(e) => swap(e, projectPath(project()!, null, area()))}
                  >
                    {`All of ${area()}`}
                  </a>
                </Show>
                <Show when={noWayBack()}>
                  <a
                    class="home-next home-unfilter"
                    href={projectPath(project()!)}
                    onClick={(e) => swap(e, projectPath(project()!))}
                  >
                    Back to designs
                  </a>
                </Show>
                <span class="grow" />
                <div class="home-lead">
                  {/* Until the list arrives there is no count to tell, not zero of one. */}
                  <Show when={open() > 0}>
                    <Show
                      when={shown() !== "needs"}
                      fallback={<span class="home-count">{questions(open())}</span>}
                    >
                      <a
                        class="home-count"
                        href={projectPath(project()!, "needs")}
                        onClick={(e) => swap(e, projectPath(project()!, "needs"))}
                      >
                        <i class="dot" aria-hidden="true" />
                        {questions(open())}
                      </a>
                    </Show>
                    <span class="sep">·</span>
                    <a
                      class="home-next"
                      href={questionPath(project()!, next()?.slug ?? "")}
                      title={next()?.title}
                      onClick={(e) => linkClick(e, questionPath(project()!, next()?.slug ?? ""))}
                    >
                      Answer next ›
                    </a>
                  </Show>
                  {/* No sidebar to find these in. */}
                  <Show when={tiny() && decisionCount() > 0 && shown() !== "decisions"}>
                    <Show when={open() > 0}>
                      <span class="sep">·</span>
                    </Show>
                    <a
                      class="home-next"
                      href={projectPath(project()!, "decisions")}
                      onClick={(e) => swap(e, projectPath(project()!, "decisions"))}
                    >
                      {`Decisions ${decisionCount()} ›`}
                    </a>
                  </Show>
                  <Show when={shelfOn() && !readonly()}>
                    <button
                      type="button"
                      class="btn home-gather"
                      onClick={() => setGathering(true)}
                    >
                      <Icon name="plus" />
                      New idea
                    </button>
                  </Show>
                </div>
              </header>
            </Show>

            {/* Empty tiles until the tree is in, so the page has its shape at once. */}
            <Show when={!tree() && !!project() && (shown() === null || shelfOn() !== null)}>
              <div class="albums home-skeleton" aria-hidden="true">
                <For each={[0, 1, 2, 3, 4, 5]}>
                  {() => (
                    <div class="alb" data-shape="wide">
                      <span class="alb-cover">
                        <span class="home-pic alb-art" />
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <Show when={tree()}>
              <Show when={emptyInArea()}>
                <p class="home-empty">
                  {`No ${(shelfOn() ? SECTION_LABEL[shelfOn()!] : "designs").toLowerCase()} in ${area()}. `}
                  <a
                    href={projectPath(project()!, null, area())}
                    onClick={(e) => swap(e, projectPath(project()!, null, area()))}
                  >
                    {`Show everything in ${area()}`}
                  </a>
                </p>
              </Show>
              <Show when={shown() === "tiny"}>
                <div class="albums large">
                  <For each={[...onShow()].sort(newestFirst)}>{album}</For>
                </div>
                <Show when={allRows().length}>{flowsAll()}</Show>
                <Show when={archived().length}>
                  <section class="home-archive" aria-label="Archived">
                    <button
                      type="button"
                      class="home-archive-hd"
                      aria-expanded={archivedOpen()}
                      onClick={() => setArchivedOpen(!archivedOpen())}
                    >
                      <span class="answered-chev" aria-hidden="true">
                        ›
                      </span>
                      {`Archived · ${archived().length}`}
                    </button>
                    <Show when={archivedOpen()}>
                      <ul class="home-archived">
                        <For each={archived()}>{archiveRow}</For>
                      </ul>
                    </Show>
                  </section>
                </Show>
              </Show>
              <Show when={shown() === "area"}>{wholeArea()}</Show>
              <Show when={shown() === "ideas"}>{sectionShelf("ideas")}</Show>
              <Show when={shown() === "screens"}>{sectionShelf("screens")}</Show>
              <Show when={shown() === "components"}>{sectionShelf("components")}</Show>
              <Show when={shown() === "documents"}>{sectionShelf("documents")}</Show>
              <Show when={shown() === "flows"}>{flowsAll()}</Show>
              <Show when={shown() === "archive"}>
                <ul class="home-archived home-archive-page">
                  <For each={archived()}>{archiveRow}</For>
                </ul>
              </Show>
            </Show>

            <Show when={shown() === "needs"}>
              <div class="home-waiting">
                <ol class="home-list">
                  <For each={waiting()}>
                    {(id) => (
                      <Show when={byId()[id]}>
                        {(m) => (
                          <MockRow
                            mock={m()}
                            project={project()!}
                            {...(readonly()
                              ? {}
                              : {
                                  onResolve: () =>
                                    void end(m(), m().kind === "sketch" ? "Ended" : "Archived"),
                                })}
                          />
                        )}
                      </Show>
                    )}
                  </For>
                </ol>
              </div>
            </Show>

            <Show when={shown() === "activity"}>
              <div class="home-waiting">
                <ol class="home-list">
                  <For
                    each={all()
                      .slice(0, ACTIVITY_ROWS)
                      .map((m) => m.id)}
                  >
                    {(id) => (
                      <Show when={byId()[id]}>
                        {(m) => <MockRow mock={m()} project={project()!} plain />}
                      </Show>
                    )}
                  </For>
                </ol>
              </div>
            </Show>

            <Show when={shown() === "decisions" && decisionCount() > 0}>
              <Decisions
                project={project()!}
                lines={decisions.list()?.lines ?? []}
                onChange={(n) => decisions.mutate(n)}
              />
            </Show>
          </Show>
        </Show>
      </main>
      <Toast toast={toast()} onDismiss={() => setToast(null)} />
      <Show when={gathering() && project()} keyed>
        {(p) => <NewIdea project={p} onClose={() => setGathering(false)} />}
      </Show>
    </div>
  );
}

// A heading that folds what's under it, and remembers for as long as the tab lives.
function Fold(props: {
  id: string;
  label: () => string;
  startOpen: () => boolean;
  class?: string;
  children: JSX.Element;
}) {
  const [touched, setTouched] = createSignal(folds.get(props.id));
  const open = () => touched() ?? props.startOpen();
  return (
    <section class={`home-fold ${props.class ?? ""}`}>
      <button
        type="button"
        class="home-archive-hd"
        aria-expanded={open()}
        onClick={() => {
          const next = !open();
          folds.set(props.id, next);
          setTouched(next);
        }}
      >
        <span class="answered-chev" aria-hidden="true">
          ›
        </span>
        {props.label()}
      </button>
      <Show when={open()}>{props.children}</Show>
    </section>
  );
}

type Heading = "h2" | "h3" | "h4";

// Rows under their area headings, the unnamed under "No area"; with no area named,
// just the rows, as if areas didn't exist.
function Areas<T>(props: {
  groups: AreaGroup<T>[];
  level: 2 | 3;
  // The heading of the rows no area claims.
  rest?: string;
  children: (rows: () => T[], area: string | null) => JSX.Element;
}) {
  const grouped = () => props.groups.some((g) => g.area !== null);
  // By name: the groups are rebuilt on every refetch, the areas rarely change, and
  // a redraw would restart every picture.
  const names = createMemo(() => props.groups.map((g) => g.area));
  return (
    <For each={names()}>
      {(area) => {
        const rows = () => props.groups.find((g) => g.area === area)?.rows ?? [];
        return (
          <Show when={grouped()} fallback={props.children(rows, area)}>
            <section class="home-area">
              <Dynamic component={`h${props.level}` as Heading} class="home-area-hd">
                {area ?? props.rest ?? "No area"}
              </Dynamic>
              {props.children(rows, area)}
            </section>
          </Show>
        );
      }}
    </For>
  );
}

const reducedMotion = () =>
  host().window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function MockRow(props: {
  mock: MockSummary;
  project: string;
  onResolve?: () => void;
  // Only saying what changed when, not asking anything of the user.
  plain?: boolean;
}) {
  const endWord = () => (props.mock.kind === "sketch" ? "End" : "Archive");
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
  // The row slides off before the list lets it go.
  const commit = () => {
    if (!props.onResolve || gone()) return;
    setGone(true);
    setDx(null);
    host().window.setTimeout(() => props.onResolve?.(), reducedMotion() ? 0 : 180);
  };
  return (
    <li class="home-item" classList={{ swiping: dx() !== null || gone() }}>
      <Show when={props.onResolve}>
        <div class="home-swipe-act" classList={{ armed: armed() || gone() }} aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <path d="M3.5 8.5l3 3 6-7" />
          </svg>
          {endWord()}
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
                <Show
                  when={t().poster}
                  fallback={
                    <Thumb
                      src={surfaceUrl(t().postId, t().surface, {
                        version: t().version,
                        mode: theme(),
                        w: t().rewrites,
                      })}
                    />
                  }
                >
                  {(id) => (
                    <img
                      class="home-poster"
                      src={assetUrl(id())}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                </Show>
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
              <Show when={!props.plain} fallback={<span />}>
                <span class="home-done" title="decided">
                  ✓
                </span>
              </Show>
            }
          >
            <span class="home-chip">
              <i class="dot" />
              {questions(props.mock.open)}
            </span>
          </Show>
          <span class="home-ago">{timeAgo(props.mock.updatedAt)}</span>
        </a>
        <Show when={props.onResolve}>
          <button
            type="button"
            class="home-act"
            aria-label={`${endWord()} ${props.mock.title}`}
            title={`${endWord()}: it goes to the Archive, with its open questions`}
            onClick={commit}
          >
            {endWord()}
          </button>
        </Show>
      </div>
    </li>
  );
}

// New idea: pick versions from across the project into an idea of their own. They come
// as copies, so the originals stay as they are, and replies reach whichever agent is
// working in the project until one writes to it.
function NewIdea(props: { project: string; onClose: () => void }) {
  const sl = createShortlists(props.project, () => {});
  return <AddCandidates sl={sl} project={props.project} onClose={props.onClose} />;
}
