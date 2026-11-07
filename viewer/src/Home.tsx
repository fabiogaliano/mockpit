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
import {
  type FlowStep,
  flowFor,
  type IdeaBecomes,
  MAX_PROJECT_DESCRIPTION,
} from "../../server/types.ts";
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
import { AddCandidates, type NewIdeaTyping } from "./AddCandidates.tsx";
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
  orderAreas,
  nextOwedDesign,
  shortSource,
  timeAgo,
  versionStamp,
  keepSame,
  rankedAreas,
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
  for: string | null;
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
    Promise.all([
      refetchList(),
      refetchTree(),
      decisions.refetch(),
      refetchProjects(),
      ...(area() ? [refetchArea()] : []),
    ]);
  // An agent publishing a batch fires an event per alternative; one read covers them.
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
  const areaRanks = createMemo(() => rankedAreas(tree()?.areas));
  // What each area is for, in the project's words: one line under its heading.
  const described = createMemo(
    () =>
      new Map(
        (tree()?.areas ?? []).flatMap((a) => (a.description ? [[a.name, a.description]] : [])),
      ),
  );
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
      areaRanks(),
    ),
  );
  const onShow = () => side().onShow;
  const archived = () => side().archived;
  const areas = () => side().areas;
  const counts = () => side().counts;
  const lit = () => side().lit;
  // An area the project no longer has is all of them.
  const area = createMemo(() => (props.area && areas().includes(props.area) ? props.area : null));
  // The area page is what `read --area` returns an agent, drawn: one view, two readers.
  const [rawAreaView, { refetch: refetchArea }] = createResource(
    () => {
      const p = project();
      const a = area();
      return p && a ? { p, a } : null;
    },
    ({ p, a }) => api.area(p, a).catch(() => null),
  );
  const areaView = () => {
    const v = rawAreaView();
    return v && v.project === project() && v.area.name === area() ? v : undefined;
  };

  // A flow belongs to every area one of its screens is in.
  const rowIn = (r: Row, a: string | null) =>
    a === null
      ? !r.steps.some((x) => bySlug().get(x.design)?.area)
      : r.steps.some((x) => bySlug().get(x.design)?.area === a);
  const rowArea = (r: Row) => flowArea(r.steps, (slug) => bySlug().get(slug)?.area);

  const inSection = (sec: ShelfSection, a: string | null = null) =>
    onShow().filter((n) => sectionOf(n) === sec && (a === null || n.area === a));
  // The library: the shared components (no area) by group, then each area's own.
  const shared = createMemo(() => inSection("components").filter((n) => n.shared));
  const libraryAreas = createMemo(() =>
    areas().filter((a) => inSection("components").some((n) => n.area === a)),
  );
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
    if (sec === "shared" && shared().length) return sec;
    // A cover's count asks for one design's ideas, even where a project is small enough
    // to show everything at once.
    if (sec === "ideas" && props.for) return sec;
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
      t.tree.map((n) => ({ id: n.id, stamp: versionStamp(n.alternatives) })),
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
      library={{ shared: shared().length > 0, areas: libraryAreas() }}
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
      target={n.for ? bySlug().get(n.for)?.title : undefined}
      {...(n.ideasFor?.length
        ? {
            ideas: {
              n: n.ideasFor.length,
              href: projectPath(project()!, "ideas", null, null, n.slug),
            },
          }
        : {})}
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
            : groupByArea(inSection(sec), (n) => n.area, areaRanks())
        }
        level={2}
        describe={(a) => described().get(a)}
      >
        {(rows, name) => shelf(sec, rows, noAreas, name ?? area() ?? "")}
      </Areas>
    );
  };

  // The Ideas shelf, grouped one way of three, remembered per project; or only the ideas
  // for one design, which a product cover's count opens.
  const [ideasBy, setIdeasBy] = createSignal<IdeasBy>("area");
  createEffect(on(project, (p) => setIdeasBy(p ? readIdeasBy(p) : "area")));
  const pickIdeasBy = (by: IdeasBy) => {
    setIdeasBy(by);
    const p = project();
    if (p) saveIdeasBy(p, by);
  };
  const forNode = () => (props.for ? (bySlug().get(props.for) ?? null) : null);
  const ideaGroups = createMemo((): AreaGroup<TreeNode>[] => {
    const rows = inSection("ideas", area()).filter((n) => !props.for || n.for === props.for);
    const by = props.for ? null : ideasBy();
    if (by === "for") {
      const named = (n: TreeNode) => {
        const flow = flowFor(n.for);
        if (flow !== null) return `For flow ${flow}`;
        const t = n.for ? bySlug().get(n.for) : undefined;
        return t ? `For ${t.title}` : null;
      };
      const keys = [...new Set(rows.map(named))].toSorted((a, b) =>
        a === null ? 1 : b === null ? -1 : a.localeCompare(b),
      );
      return keys.map((key) => ({ area: key, rows: rows.filter((n) => named(n) === key) }));
    }
    if (by === "use") {
      const used = rows.filter((n) => n.inUse.length > 0);
      return [
        ...(used.length ? [{ area: "In use", rows: used }] : []),
        { area: null, rows: rows.filter((n) => n.inUse.length === 0) },
      ].filter((g) => g.rows.length);
    }
    return by === "area" && area() === null && areas().length
      ? groupByArea(rows, (n) => n.area, areaRanks())
      : [{ area: null, rows }];
  });
  const ideasShelf = () => {
    const grouped = () => ideaGroups().some((g) => g.area !== null);
    return (
      <Areas
        groups={ideaGroups()}
        level={2}
        rest={
          ideasBy() === "for"
            ? "Not for a design yet"
            : ideasBy() === "use"
              ? "Not in use"
              : undefined
        }
        {...(ideasBy() === "area" ? { describe: (a: string) => described().get(a) } : {})}
      >
        {(rows, name) =>
          shelf("ideas", rows, () => !grouped(), `${ideasBy()}|${name ?? area() ?? ""}`)
        }
      </Areas>
    );
  };

  // The shared components under their groups, each group only while it holds one; the
  // ungrouped last, under a heading only beside groups.
  const sharedShelf = (level: 2 | 3) => {
    const groups = createMemo(() => {
      const by = new Map<string | null, TreeNode[]>();
      for (const n of shared()) by.set(n.group ?? null, [...(by.get(n.group ?? null) ?? []), n]);
      return [...by.keys()]
        .toSorted((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
        .map((group) => ({ area: group, rows: by.get(group) ?? [] }));
    });
    return (
      <Areas
        groups={groups()}
        level={level}
        rest="Other"
        {...(level === 3 ? { class: "home-group" } : {})}
      >
        {(rows, name) =>
          shelf(
            "components",
            rows,
            // Headings by group or by date, not both.
            () => level === 2 && groups().every((g) => g.area === null),
            `shared|${name ?? ""}`,
          )
        }
      </Areas>
    );
  };
  // Components: the library on one page, Shared first, then each area's own.
  // With no area holding a component, all of them are shared, and the page reads as if
  // areas didn't exist: just the groups.
  const componentsShelf = () => (
    <Show when={area() === null} fallback={sectionShelf("components")}>
      <Show when={libraryAreas().length} fallback={sharedShelf(2)}>
        <Show when={shared().length}>
          <section class="home-area home-library-shared">
            <h2 class="home-area-hd">
              <a
                href={projectPath(project()!, "shared")}
                onClick={(e) => swap(e, projectPath(project()!, "shared"))}
              >
                Shared
              </a>
            </h2>
            {sharedShelf(3)}
          </section>
        </Show>
        <Areas
          groups={groupByArea(
            inSection("components").filter((n) => !n.shared),
            (n) => n.area,
            areaRanks(),
          )}
          level={2}
          describe={(a) => described().get(a)}
        >
          {(rows, name) => shelf("components", rows, () => false, name ?? "")}
        </Areas>
      </Show>
    </Show>
  );

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
  // The states of an area's screens no flow walks, counted on the Flows shelf alone: a
  // screen's cover says nothing of it.
  const walked = createMemo(
    () =>
      new Set(allRows().flatMap((r) => r.steps.map((x) => JSON.stringify([x.design, x.state])))),
  );
  const statesInNoFlow = (a: string | null) =>
    onShow()
      .filter((n) => n.kind === "screen" && (n.area ?? null) === a)
      .flatMap((n) => n.states.map((st) => JSON.stringify([n.slug, st])))
      .filter((k) => !walked().has(k)).length;
  const flowsAll = () => {
    const groups = (): AreaGroup<Row>[] => {
      if (area() !== null) return [{ area: null, rows: allRows().filter((r) => rowIn(r, area())) }];
      const base = groupByArea(allRows(), rowArea, areaRanks());
      // An area whose screens no flow walks yet still gets its heading, for the count.
      const have = new Set(base.map((g) => g.area));
      const bare = new Set(
        onShow().flatMap((n) =>
          n.kind === "screen" && n.area && !have.has(n.area) && statesInNoFlow(n.area) > 0
            ? [n.area]
            : [],
        ),
      );
      if (!bare.size) return base;
      const rows = new Map<string, Row[]>([...bare].map((a) => [a, []]));
      for (const g of base) if (g.area !== null) rows.set(g.area, g.rows);
      return [
        ...orderAreas(rows.keys(), areaRanks()).map((a) => ({ area: a, rows: rows.get(a)! })),
        ...base.filter((g) => g.area === null && g.rows.length),
      ];
    };
    const rest = () => restOfFlows(groups());
    // The group no one area claims is either Across areas, which has no screens of its own
    // to count, or the screens with no area.
    const counted = (a: string | null) =>
      a ?? area() ?? (rest() === undefined || !groups().some((g) => g.area) ? null : undefined);
    return (
      <Areas groups={groups()} level={2} rest={rest()} describe={(a) => described().get(a)}>
        {(rows, a) => {
          const n = () => {
            const where = counted(a);
            return where === undefined ? 0 : statesInNoFlow(where);
          };
          return (
            <>
              <For each={rows()}>{flowRow}</For>
              <Show when={n()}>
                <p class="home-noflow">{`${n()} ${n() === 1 ? "state" : "states"} in no flow`}</p>
              </Show>
            </>
          );
        }}
      </Areas>
    );
  };

  // One area as the agent reads it: its screens, flows and components, what was
  // decided on them, and the ideas waiting in it. Each heading narrows to its shelf.
  const inAreaCount = (sec: Section, a: string) =>
    sec === "flows" ? allRows().filter((r) => rowIn(r, a)).length : inSection(sec, a).length;
  const nodesOf = (rows: { slug: string }[] | undefined) =>
    (rows ?? []).flatMap((r) => bySlug().get(r.slug) ?? []);
  const kindHead = (sec: Section, label: string) => {
    const path = () => projectPath(project()!, sec, area());
    return (
      <h2 class="home-kind-hd">
        <a href={path()} onClick={(e) => swap(e, path())}>
          {label}
        </a>
      </h2>
    );
  };
  const wholeArea = () => {
    const v = areaView;
    const screens = () => nodesOf(v()?.screens);
    const components = () => nodesOf(v()?.components);
    const ideas = () => nodesOf(v()?.ideasWaiting.flatMap((g) => g.ideas));
    const flows = () => (v()?.flows.length ?? 0) > 0;
    return (
      <>
        <Show when={screens().length}>
          <section class="home-kind">
            {kindHead("screens", SECTION_LABEL.screens)}
            {shelf("screens", screens, () => true, area() ?? "")}
          </section>
        </Show>
        <Show when={flows()}>
          <section class="home-kind">
            {kindHead("flows", SECTION_LABEL.flows)}
            {flowsAll()}
          </section>
        </Show>
        <Show when={components().length}>
          <section class="home-kind">
            {kindHead("components", SECTION_LABEL.components)}
            {shelf("components", components, () => true, area() ?? "")}
          </section>
        </Show>
        <Show when={v()?.decisions.length}>
          <section class="home-kind" aria-label="Decisions">
            <h2 class="home-kind-hd">{`Decisions · ${v()?.decisions.length ?? 0}`}</h2>
            <ul class="home-decisions">
              <For each={v()?.decisions ?? []}>
                {(d) => {
                  const href = () => designPath(project()!, d.design);
                  return (
                    <li class="home-decision">
                      <a
                        class="home-decision-on"
                        href={href()}
                        onClick={(e) => linkClick(e, href())}
                      >
                        {bySlug().get(d.design)?.title ?? d.design}
                      </a>
                      <span class="home-decision-text">{d.text}</span>
                    </li>
                  );
                }}
              </For>
            </ul>
          </section>
        </Show>
        <Show when={ideas().length}>
          <section class="home-kind">
            {kindHead("ideas", `Ideas · ${ideas().length}`)}
            <div class="albums">
              <For each={[...ideas()].sort(newestFirst)}>{album}</For>
            </div>
          </section>
        </Show>
      </>
    );
  };

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
              : s === "shared"
                ? "Shared components"
                : SECTION_LABEL[s];
    if (label === null) return null;
    if (s === "ideas" && forNode()) return `Ideas for ${forNode()!.title}`;
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
    if (sec === "ideas" && props.for) return ideaGroups().reduce((n, g) => n + g.rows.length, 0);
    if (sec) {
      return a && sec !== "flows"
        ? inSection(sec, a).length
        : a
          ? inAreaCount(sec, a)
          : counts()[sec];
    }
    if (s === "area" && a) return countIn(a);
    if (s === "archive") return archived().length;
    if (s === "shared") return shared().length;
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
                <Show when={shown() === "ideas" && props.for && !tiny()}>
                  <a
                    class="home-next home-unfilter"
                    href={projectPath(project()!, "ideas", area())}
                    onClick={(e) => swap(e, projectPath(project()!, "ideas", area()))}
                  >
                    All ideas
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
                  <Show when={shown() === "ideas" && !props.for && !tiny()}>
                    <div class="home-groupby" role="group" aria-label="Group by">
                      <span>Group by</span>
                      <div class="vswitch">
                        <For each={IDEAS_BY}>
                          {(by) => (
                            <button
                              type="button"
                              aria-pressed={ideasBy() === by.id}
                              onClick={() => pickIdeasBy(by.id)}
                            >
                              {by.label}
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                  <Show when={(shelfOn() || shown() === "area") && !readonly()}>
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

            <Show when={shown() === "area" && area()}>
              {(a) => (
                <AreaLine
                  project={project()!}
                  area={a()}
                  text={described().get(a()) ?? ""}
                  onSaved={() => void refetch()}
                  onFailed={(e) =>
                    setToast({ text: `Couldn't keep that: ${e instanceof Error ? e.message : e}` })
                  }
                />
              )}
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
              <Show when={shown() === "ideas"}>{ideasShelf()}</Show>
              <Show when={shown() === "screens"}>{sectionShelf("screens")}</Show>
              <Show when={shown() === "components"}>{componentsShelf()}</Show>
              <Show when={shown() === "shared"}>{sharedShelf(2)}</Show>
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
        {(p) => (
          <NewIdea
            project={p}
            typed={{
              ...(area() ? { area: area()! } : {}),
              ...(shown() === "ideas" && forNode()
                ? { for: { id: forNode()!.id, title: forNode()!.title } }
                : {}),
              ...(BECOMES_ON[shown() ?? ""] ? { becomes: BECOMES_ON[shown() ?? ""] } : {}),
            }}
            onClose={() => setGathering(false)}
          />
        )}
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

// What an area is for, one line under its title, written in place. The user's words
// stand against agents until they clear them.
function AreaLine(props: {
  project: string;
  area: string;
  text: string;
  onSaved: () => void;
  onFailed: (e: unknown) => void;
}) {
  const [writing, setWriting] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const save = async () => {
    const text = writing();
    if (text === null || busy()) return;
    if (text.trim() === props.text) return setWriting(null);
    setBusy(true);
    try {
      await api.describe(props.project, { area: props.area, description: text });
      setWriting(null);
      props.onSaved();
    } catch (e) {
      props.onFailed(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Show
      when={writing() !== null}
      fallback={
        <Show
          when={!readonly()}
          fallback={
            <Show when={props.text}>
              <p class="home-area-line">{props.text}</p>
            </Show>
          }
        >
          <button
            type="button"
            class="home-area-line home-area-edit"
            classList={{ empty: !props.text }}
            title="What this area is for. Agents read it before they draw here."
            onClick={() => setWriting(props.text)}
          >
            {props.text || `Say what ${props.area} is for`}
          </button>
        </Show>
      }
    >
      <form
        class="home-area-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input
          class="home-area-input"
          aria-label={`What ${props.area} is for`}
          maxLength={MAX_PROJECT_DESCRIPTION}
          value={writing() ?? ""}
          onInput={(e) => setWriting(e.currentTarget.value)}
          on:keydown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            setWriting(null);
          }}
          ref={(el) => queueMicrotask(() => el.focus())}
        />
        <button type="submit" class="btn" disabled={busy()}>
          Save
        </button>
        <button type="button" class="btn" onClick={() => setWriting(null)}>
          Cancel
        </button>
      </form>
    </Show>
  );
}

// Rows under their area headings, the unnamed under "No area"; with no area named,
// just the rows, as if areas didn't exist.
function Areas<T>(props: {
  groups: AreaGroup<T>[];
  level: 2 | 3;
  // The heading of the rows no area claims.
  rest?: string;
  // In place of `home-area`, for groups that aren't areas.
  class?: string;
  // What an area is for, one line under its heading.
  describe?: (area: string) => string | undefined;
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
            <section class={props.class ?? "home-area"}>
              <Dynamic
                component={`h${props.level}` as Heading}
                class={props.class ? `${props.class}-hd` : "home-area-hd"}
              >
                {area ?? props.rest ?? "No area"}
              </Dynamic>
              <Show when={area !== null && props.describe?.(area)}>
                {(line) => <p class="home-area-desc">{line()}</p>}
              </Show>
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
// working in the project until one writes to it. It is typed by where it was started.
function NewIdea(props: { project: string; typed: NewIdeaTyping; onClose: () => void }) {
  const sl = createShortlists(props.project, () => {});
  return (
    <AddCandidates sl={sl} project={props.project} typed={props.typed} onClose={props.onClose} />
  );
}

// What an idea started on a shelf would become.
const BECOMES_ON: Record<string, IdeaBecomes | undefined> = {
  screens: "screen",
  components: "component",
  flows: "flow",
};

type IdeasBy = "area" | "for" | "use";
const IDEAS_BY: { id: IdeasBy; label: string }[] = [
  { id: "area", label: "Area" },
  { id: "for", label: "For" },
  { id: "use", label: "In use" },
];
const IDEAS_BY_KEY = "mockpit:ideas-by:";
function readIdeasBy(project: string): IdeasBy {
  try {
    const v = host().storage?.getItem(IDEAS_BY_KEY + project);
    return v === "for" || v === "use" ? v : "area";
  } catch {
    return "area";
  }
}
function saveIdeasBy(project: string, by: IdeasBy) {
  try {
    host().storage?.setItem(IDEAS_BY_KEY + project, by);
  } catch {
    // Private mode: nothing to keep it in.
  }
}
