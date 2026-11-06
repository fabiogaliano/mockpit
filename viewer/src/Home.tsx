// A project at a glance: a sidebar of what it holds, and the shelf picked from it.
// Sections light up by use: screens and components as declared, flows once one is,
// and the rest as ideas or documents by what they contain (albums.ts). Albums that
// wait on the user glow, and so does the project's name. A project of one or two
// designs has no sidebar and shows large covers; a phone gets the sidebar as a drawer.
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
import {
  api,
  type DesignSummary,
  readAt,
  type RestoreUndo,
  subscribe,
  type TreeNode,
} from "./api.ts";
import { Album, DocRow, FlowStepTile } from "./Album.tsx";
import {
  DATED_FROM,
  dateGroups,
  lastWork,
  newestFirst,
  questions,
  type Section,
  SECTION_LABEL,
  sectionOf,
  type ShelfSection,
  SIDEBAR_FROM,
  sidebarOf,
  usedIn,
} from "./albums.ts";
import { CardMenu } from "./CardMenu.tsx";
import { Archive } from "./Archive.tsx";
import { createDecisions } from "./Decisions.tsx";
import { DesignThumb, Recent } from "./Recent.tsx";
import { setCarried } from "./carry.ts";
import { useSwipeAction } from "./gestures.ts";
import { AddCandidates } from "./AddCandidates.tsx";
import {
  readHomeProjects,
  readHomeSnapshot,
  saveHomeProjects,
  saveHomeSnapshot,
} from "./homeCache.ts";
import { host, readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { openJump } from "./Jump.tsx";
import {
  type AreaGroup,
  flowArea,
  groupByArea,
  nextOwedDesign,
  shortSource,
  timeAgo,
  versionStamp,
  keepSame,
} from "./logic.ts";
import {
  type HomePlace,
  linkClick,
  designPath,
  navigate,
  projectPath,
  questionPath,
  type RecentShow,
  rememberHomePlace,
  rootPath,
} from "./route.ts";
import { NotFound } from "./NotFound.tsx";
import { ProjectSwitcher } from "./ProjectSwitcher.tsx";
import { createShortlists } from "./shortlist.ts";
import { unseen } from "./seen.ts";
import { setTheme } from "./theme.ts";
import { Sidebar } from "./Sidebar.tsx";
import { SystemPlace } from "./SystemPlace.tsx";
import { Toast, type ToastLine } from "./toast.tsx";
import { TopBar } from "./TopBar.tsx";
import { phoneLayout } from "./viewport.ts";

// Where each place was scrolled to, so coming back to it lands where it was.
const scrolls = new Map<string, number>();
// Which date headings and folds the user opened or shut, for the same reason.
const folds = new Map<string, boolean>();

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
  show: RecentShow | null;
}) {
  // Home shows where every design stands; a Send carried from a design ends here.
  setCarried(null);
  const [rawProjects, { refetch: refetchProjects }] = createResource(() => api.projects());
  // What this browser last saw stands in until the server answers.
  const rememberedProjects = readHomeProjects();
  const projects = () => rawProjects() ?? rememberedProjects ?? undefined;
  const project = createMemo(() => props.project ?? projects()?.[0]?.name ?? null);
  const noSuchProject = () => {
    const known = rawProjects();
    return !!known && !!props.project && !known.some((p) => p.name === props.project);
  };
  const remembered = createMemo(() => {
    const p = project();
    return p ? readHomeSnapshot(p) : null;
  });
  const [rawList, { refetch: refetchList }] = createResource(project, (p) =>
    api.designs(p).then((data) => ({ project: p, data })),
  );
  const [rawTree, { refetch: refetchTree }] = createResource(project, (p) => api.tree(p));
  // A resource keeps its last value while the next loads: the other project's
  // sections mustn't stand in for this one's.
  const freshTree = () => {
    const t = rawTree();
    return t && t.project === project() ? t : undefined;
  };
  const tree = () => freshTree() ?? remembered()?.tree;
  const freshList = () => {
    const l = rawList();
    return l && l.project === project() ? l.data : undefined;
  };
  const list = () => freshList() ?? remembered()?.list;
  const decisions = createDecisions(project);
  const decisionCount = () => {
    const d = decisions.list();
    return d && d.project === project() ? d.lines.length : (remembered()?.decisions ?? 0);
  };
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

  // After the page has what it needs: a save blocks, and a publishing agent
  // refreshes this often.
  let saveTimer = 0;
  createEffect(() => {
    const p = project();
    const t = freshTree();
    const l = freshList();
    if (!p || !t || !l) return;
    const count = decisionCount();
    host().window.clearTimeout(saveTimer);
    saveTimer = host().window.setTimeout(
      () => saveHomeSnapshot(p, { tree: t, list: l, decisions: count }),
      1000,
    );
  });
  onCleanup(() => host().window.clearTimeout(saveTimer));
  createEffect(() => {
    const known = rawProjects.state === "ready" ? rawProjects() : undefined;
    if (known) saveHomeProjects(known);
  });

  // Oldest first, as the agent made them, for the declared shelves.
  const byAge = (a: TreeNode, b: TreeNode) => a.createdAt.localeCompare(b.createdAt);
  const nodes = createMemo<TreeNode[]>(
    (was) => keepSame(was, [...(tree()?.tree ?? [])].sort(byAge), (n) => n.slug),
    [],
  );
  const bySlug = createMemo(() => new Map(nodes().map((n) => [n.slug, n])));
  // Archived a moment ago, before the tree catches up.
  const [leaving, setLeaving] = createSignal<Record<string, true>>({});
  const areaOrder = createMemo(() => tree()?.areaOrder ?? []);
  const allRows = createMemo<Row[]>(
    (was) =>
      keepSame(
        was,
        (tree()?.flows ?? []).map((f) => ({ name: f.name, flow: f.name, steps: f.steps })),
        (r) => r.name,
      ),
    [],
  );
  const side = createMemo(() =>
    sidebarOf(
      nodes().filter((n) => !leaving()[n.id]),
      allRows().length,
      areaOrder(),
    ),
  );
  const onShow = () => side().onShow;
  const archived = () => side().archived;
  const areas = () => side().areas;
  const counts = () => side().counts;
  const lit = () => side().lit;
  // An area the project no longer has is all of them.
  const area = createMemo(() => (props.area && areas().includes(props.area) ? props.area : null));

  // A flow belongs to every area one of its screens is in.
  const rowIn = (r: Row, a: string | null) =>
    a === null
      ? !r.steps.some((x) => bySlug().get(x.design)?.area)
      : r.steps.some((x) => bySlug().get(x.design)?.area === a);
  const rowArea = (r: Row) => flowArea(r.steps, (slug) => bySlug().get(slug)?.area);

  const inSection = (sec: ShelfSection, a: string | null = null) =>
    onShow().filter((n) => sectionOf(n) === sec && (a === null || n.area === a));
  const landing = (): Section | null => lit().rows[0] ?? lit().foot;
  const isLit = (s: HomePlace): s is Section =>
    lit().rows.includes(s as Section) || lit().foot === s;

  // How much the project holds, known as soon as the project list is: the shape of
  // the page shouldn't wait for the tree.
  const held = () =>
    tree()?.tree.length ?? projects()?.find((p) => p.name === project())?.designs ?? null;
  const tiny = () => {
    const n = held();
    return n !== null && n < SIDEBAR_FROM;
  };
  const hasSidebar = () => {
    const n = held();
    return n !== null && n >= SIDEBAR_FROM && !noSuchProject();
  };

  const all = createMemo(() =>
    [...(list()?.designs ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );
  const designs = createMemo(() => all().filter((m) => !m.archivedAt && !leaving()[m.id]));
  // Rows are keyed by id, so a refetch mid-swipe updates a row in place
  // instead of remounting it out from under the finger.
  const byId = createMemo(() => Object.fromEntries(all().map((m) => [m.id, m])));
  const waiting = createMemo(() =>
    designs()
      .filter((m) => m.open > 0)
      .map((m) => m.id),
  );
  const open = () => list()?.open ?? 0;
  const next = createMemo(() => nextOwedDesign(designs(), null));

  // A place in the URL stands until the data says it's empty. Before then it isn't
  // known to be wrong, and flashing the first section at a reload would be a lie.
  const shown = createMemo<Shown | null>(() => {
    const sec = props.sec;
    const loaded = !!tree() && !!list();
    if (sec && !loaded) return sec;
    if (sec === "needs" && waiting().length) return sec;
    if (sec === "archive" && archived().length) return sec;
    if (sec === "recent" && nodes().length) return sec;
    if (sec === "system" && tree()?.hasSystem) return sec;
    if (tiny()) return loaded ? "tiny" : null;
    if (sec && isLit(sec)) return sec;
    if (area()) return "area";
    // Everything archived: that's all there is to show.
    return landing() ?? (loaded && archived().length ? "archive" : null);
  });
  createEffect(() => {
    const p = project();
    if (p) rememberHomePlace(p, props.sec, area(), props.show);
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
  async function end(m: { id: string; title: string }) {
    setLeaving({ ...leaving(), [m.id]: true });
    try {
      const { reason } = await api.archiveDesign(m.id);
      await refetch();
      setToast({
        text: `Archived “${m.title}”`,
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
      await api.restoreDesign(id);
      await refetch();
    } catch (e) {
      setToast({ text: `Couldn't restore: ${e instanceof Error ? e.message : e}` });
    }
  }
  // Out of the Archive, one or a whole day of it. Undo puts each back on the day it
  // went, not today.
  async function restore(list: TreeNode[]) {
    setToast(null);
    setLeaving({ ...leaving(), ...Object.fromEntries(list.map((n) => [n.id, true as const])) });
    const done: { id: string; undo: RestoreUndo }[] = [];
    try {
      for (const n of list) {
        const { undo } = await api.restoreDesign(n.id);
        if (undo) done.push({ id: n.id, undo });
      }
      await refetch();
      setToast({
        text: list.length === 1 ? `Restored “${list[0].title}”` : `Restored ${list.length}`,
        undo: () => void rearchive(done),
      });
    } catch (e) {
      await refetch();
      setToast({ text: `Couldn't restore: ${e instanceof Error ? e.message : e}` });
    } finally {
      setLeaving(
        Object.fromEntries(
          Object.entries(leaving()).filter(([id]) => !list.some((n) => n.id === id)),
        ) as Record<string, true>,
      );
    }
  }
  async function rearchive(done: { id: string; undo: RestoreUndo }[]) {
    setToast(null);
    try {
      for (const { id, undo } of done) await api.rearchive(id, undo);
      await refetch();
    } catch (e) {
      await refetch();
      setToast({ text: `Couldn't put it back: ${e instanceof Error ? e.message : e}` });
    }
  }
  const saveReasons = (list: TreeNode[], reason: string | null) =>
    void Promise.all(list.map((n) => api.reason(n.id, { reason }))).then(
      () => refetch(),
      (e) => setToast({ text: `Couldn't keep that: ${e instanceof Error ? e.message : e}` }),
    );

  const [feedAt, setFeedAt] = createSignal<number | null>(null);
  const stop = subscribe((e) => {
    if (e.type === "theme-changed") {
      setTheme(e.mode === "light" ? "light" : "dark");
      // Which stills show depends on the mode they were taken in.
      void refetch();
    } else if (e.type === "system-changed") {
      // The System place appears with a first write, and stills taken under the
      // old revision stop showing.
      if (e.project === project()) refetchSoon();
    } else if (
      e.type.startsWith("design-") ||
      e.type.startsWith("post-") ||
      e.type === "comment-created" ||
      // A cover's word follows its last Send, and no other project's agent moves it.
      ((e.type === "comment-delivered" || e.type === "agent-called") &&
        nodes().some((n) => n.lastSend?.sessionId === e.sessionId)) ||
      // Once, as a draft starts: a save per keystroke needn't reread a whole project.
      (e.type === "draft-updated" && nodes().some((n) => n.id === e.designId && !n.drafting))
    ) {
      refetchSoon();
    }
  }, setFeedAt);
  onCleanup(stop);

  // The feed opens as the first reads are landing, and refetching then throws them
  // away and pays for all of it twice. So wait for them, and read again only if they
  // began before something the feed won't repeat.
  createEffect(() => {
    const at = feedAt();
    if (at === null) return;
    const reads = [rawProjects, rawList, rawTree, decisions.list];
    if (reads.some((r) => r.loading)) return;
    setFeedAt(null);
    const missedNothing =
      reads.every((r) => r.state === "ready") &&
      [rawProjects(), rawList()?.data, rawTree(), decisions.list()].every(
        (body) => readAt(body) >= at,
      );
    if (!missedNothing) void refetch();
  });

  // Each place keeps its own scroll; the albums' boxes are sized before their
  // pictures load, so the place is right as soon as the tree is in.
  let main!: HTMLElement;
  const scrollKey = () =>
    `${project() ?? ""}|${props.sec}|${shown()}|${area() ?? ""}|${props.show ?? ""}`;
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

  const countIn = (a: string) => onShow().filter((n) => n.area === a).length;
  const sidebar = (inDrawer: boolean) => (
    <Sidebar
      project={project() ?? ""}
      projects={projects() ?? []}
      place={shown()}
      area={area()}
      open={open()}
      rows={lit().rows}
      foot={lit().foot}
      areas={areas()}
      tree={side().tree}
      archived={archived().length}
      recent={nodes().length > 0}
      system={!!tree()?.hasSystem}
      go={swap}
      onNav={() => setDrawer(false)}
      drawer={inDrawer}
      inert={inDrawer && !drawer()}
    />
  );

  const menuFor = (n: TreeNode) =>
    readonly() ? undefined : (
      <CardMenu
        design={n}
        areas={areas()}
        endLabel="Archive"
        onClose={() => void end(n)}
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
      {...(readonly()
        ? {}
        : n.planned
          ? { onEnd: () => void end(n), endLabel: "Not needed" }
          : sectionOf(n) === "ideas"
            ? { onEnd: () => void end(n) }
            : {})}
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
            <Show when={bySlug().get(x.design)}>
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
        : s === "archive"
          ? "Archive"
          : s === "recent"
            ? "Recent"
            : s === "system"
              ? null
              : SECTION_LABEL[s];
    if (label === null) return null;
    return a && shelfOn() ? `${label} in ${a}` : label;
  };
  // How much of the shelf is still only a plan.
  const notDrawn = () => {
    const sec = shelfOn();
    if (sec !== "screens" && sec !== "components") return 0;
    return inSection(sec, area()).filter((n) => n.planned).length;
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
    !rawProjects.loading && (!project() || (!!tree() && nodes().length === 0));

  // No heading and nothing to say: a tiny project opens straight on its covers.
  // Beside a sidebar its Needs you row already says this; the Needs you page still
  // offers the next one, and without a column in view this is the only place to.
  const leadTellsOpen = () => open() > 0 && (!hasSidebar() || phoneLayout() || shown() === "needs");
  const tinySystem = () => tiny() && !!tree()?.hasSystem && shown() !== "system";
  const leadHasWords = () => leadTellsOpen() || (tiny() && decisionCount() > 0) || tinySystem();

  const [archivedOpen, setArchivedOpen] = createSignal(false);
  const archive = () => (
    <Archive
      project={project()!}
      nodes={archived()}
      fresh={fresh()}
      onRestore={(list) => void restore(list)}
      onReason={saveReasons}
    />
  );
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
                      <Show when={notDrawn()}>
                        {(n) => (
                          <span class="home-head-n home-head-plan">{`${n()} not drawn yet`}</span>
                        )}
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
                  <Show when={leadTellsOpen()}>
                    <Show
                      when={shown() !== "needs"}
                      fallback={<span class="home-count">{questions(open())}</span>}
                    >
                      <a
                        class="home-count"
                        href={projectPath(project()!, "needs")}
                        onClick={(e) => swap(e, projectPath(project()!, "needs"))}
                      >
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
                  <Show when={tiny() && decisionCount() > 0 && shown() !== "recent"}>
                    <Show when={leadTellsOpen()}>
                      <span class="sep">·</span>
                    </Show>
                    <a
                      class="home-next"
                      href={projectPath(project()!, "recent", null, "decisions")}
                      onClick={(e) => swap(e, projectPath(project()!, "recent", null, "decisions"))}
                    >
                      {`Decisions ${decisionCount()} ›`}
                    </a>
                  </Show>
                  <Show when={tinySystem()}>
                    <Show when={leadTellsOpen() || (decisionCount() > 0 && shown() !== "recent")}>
                      <span class="sep">·</span>
                    </Show>
                    <a
                      class="home-next"
                      href={projectPath(project()!, "system")}
                      onClick={(e) => swap(e, projectPath(project()!, "system"))}
                    >
                      System ›
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
                    <Show when={archivedOpen()}>{archive()}</Show>
                  </section>
                </Show>
              </Show>
              <Show when={shown() === "area"}>{wholeArea()}</Show>
              <Show when={shown() === "ideas"}>{sectionShelf("ideas")}</Show>
              <Show when={shown() === "screens"}>{sectionShelf("screens")}</Show>
              <Show when={shown() === "components"}>{sectionShelf("components")}</Show>
              <Show when={shown() === "documents"}>{sectionShelf("documents")}</Show>
              <Show when={shown() === "flows"}>{flowsAll()}</Show>
              <Show when={shown() === "archive"}>{archive()}</Show>
            </Show>

            <Show when={shown() === "needs"}>
              <div class="home-waiting">
                <ol class="home-list">
                  <For each={waiting()}>
                    {(id) => (
                      <Show when={byId()[id]}>
                        {(m) => (
                          <DesignRow
                            design={m()}
                            project={project()!}
                            {...(readonly()
                              ? {}
                              : {
                                  onResolve: () => void end(m()),
                                })}
                          />
                        )}
                      </Show>
                    )}
                  </For>
                </ol>
              </div>
            </Show>

            <Show when={shown() === "system" && project()}>
              {(p) => <SystemPlace project={p()} toast={setToast} />}
            </Show>

            <Show when={shown() === "recent"}>
              <Recent
                project={project()!}
                designs={all()}
                workedAt={(m) => {
                  const node = bySlug().get(m.slug);
                  return node ? lastWork(node) : m.updatedAt;
                }}
                lines={decisions.list()?.lines ?? []}
                show={props.show}
                go={swap}
                onDecisions={(n) => decisions.mutate(n)}
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

function DesignRow(props: {
  design: DesignSummary;
  project: string;
  onResolve?: () => void;
  // Only saying what changed when, not asking anything of the user.
  plain?: boolean;
}) {
  const href = () => designPath(props.project, props.design.slug);
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
          Archive
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
          data-design={props.design.slug}
        >
          <div class="home-thumb">
            <DesignThumb design={props.design} />
          </div>
          <div class="home-text">
            <div class="home-name">{props.design.title}</div>
            <div class="home-sub">
              {props.design.stateCount === 1 ? "1 state" : `${props.design.stateCount} states`}
              <Show when={props.design.source}>
                {(src) => <span class="home-src" title={src()}>{` · ${shortSource(src())}`}</span>}
              </Show>
              <Show when={props.design.drafted !== undefined && props.design.open > 0}>
                <span class="home-draft" title="Answered, not sent yet">
                  {` · draft ${props.design.drafted}/${props.design.open}`}
                </span>
              </Show>
            </div>
          </div>
          <Show
            when={props.design.open > 0}
            fallback={
              <Show when={!props.plain} fallback={<span />}>
                <span class="home-done" title="decided">
                  ✓
                </span>
              </Show>
            }
          >
            <span class="home-chip">{questions(props.design.open)}</span>
          </Show>
          <span class="home-ago">{timeAgo(props.design.updatedAt)}</span>
        </a>
        <Show when={props.onResolve}>
          <button
            type="button"
            class="home-act"
            aria-label={`Archive ${props.design.title}`}
            title={`Archive: it goes to the Archive, with its open questions`}
            onClick={commit}
          >
            Archive
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
