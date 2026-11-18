// The Library's and Exploring's pages of the Board, drawn inside its frame: the component
// library (shared components by group, then each area's own), the system, documents,
// the Archive and Recent. Sections light up by use (albums.ts). Each place is one address,
// `?sec=` (route.ts), and keeps its own scroll.

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
import { type FlowStep, type IdeaBecomes } from "../../server/types.ts";
import { api, readAt, type RestoreUndo, subscribe, type TreeNode } from "./api.ts";
import { Album, DocRow } from "./Album.tsx";
import {
  DATED_FROM,
  dateGroups,
  lastWork,
  newestFirst,
  type Section,
  SECTION_LABEL,
  sectionOf,
  type ShelfSection,
  sidebarOf,
  usedIn,
} from "./albums.ts";
import { CardMenu } from "./CardMenu.tsx";
import { Archive } from "./Archive.tsx";
import { createDecisions } from "./Decisions.tsx";
import { Recent } from "./Recent.tsx";
import { AddCandidates, type NewIdeaTyping } from "./AddCandidates.tsx";
import { readHomeSnapshot, saveHomeSnapshot } from "./homeCache.ts";
import { host, readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { type AreaGroup, groupByArea, keepSame, rankedAreas } from "./logic.ts";
import { type HomePlace, navigate, projectPath, type RecentShow } from "./route.ts";
import { createShortlists } from "./shortlist.ts";
import { changedSince, seenIn, versionShown } from "./seen.ts";
import { setTheme } from "./theme.ts";
import { SystemPlace } from "./SystemPlace.tsx";
import { Toast, type ToastLine } from "./toast.tsx";
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
  status?: string;
}

export function Home(props: { project: string; sec: HomePlace; show: RecentShow | null }) {
  const project = () => props.project;
  const remembered = createMemo(() => readHomeSnapshot(project()));
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
  // Any change in the project may move what the shelves show.
  const refetch = () => Promise.all([refetchList(), refetchTree(), decisions.refetch()]);
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
        (tree()?.flows ?? []).map((f) => ({
          name: f.name,
          flow: f.name,
          steps: f.steps,
          status: f.status,
        })),
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
  const inSection = (sec: ShelfSection) => onShow().filter((n) => sectionOf(n) === sec);
  // The library: the shared components (no area) by group, then each area's own.
  const shared = createMemo(() => inSection("components").filter((n) => n.shared));
  const libraryAreas = createMemo(() =>
    areas().filter((a) => inSection("components").some((n) => n.area === a)),
  );
  const all = createMemo(() =>
    [...(list()?.designs ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );
  const shown = () => props.sec;
  const shelfOn = (): Section | null => {
    const s = shown();
    return s === "components" || s === "documents" ? s : null;
  };

  const fresh = createMemo(() => {
    const t = tree();
    if (!t) return new Set<string>();
    const seen = seenIn(
      t.project,
      t.tree.flatMap((n) =>
        n.alternatives.map((v) => ({ post: v.postId, version: versionShown(v) })),
      ),
    );
    return new Set(
      t.tree
        .filter((n) => n.alternatives.some((v) => changedSince(seen, v.postId, versionShown(v))))
        .map((n) => n.id),
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
    const reads = [rawList, rawTree, decisions.list];
    if (reads.some((r) => r.loading)) return;
    setFeedAt(null);
    const missedNothing =
      reads.every((r) => r.state === "ready") &&
      [rawList()?.data, rawTree(), decisions.list()].every((body) => readAt(body) >= at);
    if (!missedNothing) void refetch();
  });

  // Each place keeps its own scroll; the albums' boxes are sized before their
  // pictures load, so the place is right as soon as the tree is in.
  let main!: HTMLElement;
  const scrollKey = () => `${project()}|${props.sec}|${props.show ?? ""}`;
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
              href: projectPath(project(), "ideas", null, n.slug),
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
    const newest = sec === "documents";
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
      dated() && live().length >= DATED_FROM ? dateGroups(live()) : null,
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
    const noAreas = () => !areas().length;
    return (
      <Areas
        groups={
          noAreas()
            ? [{ area: null, rows: inSection(sec) }]
            : groupByArea(inSection(sec), (n) => n.area, areaRanks())
        }
        level={2}
        describe={(a) => described().get(a)}
      >
        {(rows, name) => shelf(sec, rows, noAreas, name ?? "")}
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
    <Show when={libraryAreas().length} fallback={sharedShelf(2)}>
      <Show when={shared().length}>
        <section class="home-area home-library-shared">
          <h2 class="home-area-hd">
            <a
              href={projectPath(project(), "shared")}
              onClick={(e) => swap(e, projectPath(project(), "shared"))}
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
  );

  const heading = () => {
    const s = shown();
    const label =
      s === "archive"
        ? "Archive"
        : s === "recent"
          ? "Recent"
          : s === "system"
            ? null
            : s === "shared"
              ? "Shared components"
              : SECTION_LABEL[s];
    if (label === null) return null;
    return label;
  };
  const headingCount = () => {
    const s = shown();
    const sec = shelfOn();
    if (sec) return counts()[sec];
    if (s === "archive") return archived().length;
    if (s === "shared") return shared().length;
    return null;
  };
  // How much of the library is still only a plan.
  const notDrawn = () =>
    shelfOn() === "components" ? inSection("components").filter((n) => n.planned).length : 0;
  const nothingPublished = () => !!tree() && nodes().length === 0;

  const archive = () => (
    <Archive
      project={project()}
      nodes={archived()}
      fresh={fresh()}
      onRestore={(list) => void restore(list)}
      onReason={saveReasons}
    />
  );
  const [gathering, setGathering] = createSignal(false);

  return (
    <div class="home" classList={{ "home-phone": phoneLayout() }}>
      <main
        class="home-main"
        ref={(el) => (main = el)}
        onScroll={() => scrolls.set(scrollKey(), main.scrollTop)}
      >
        <Show
          when={!nothingPublished()}
          fallback={
            <p class="home-empty">Nothing published yet. Agents publish with `mockpit publish`.</p>
          }
        >
          <Show when={heading()}>
            <header class="home-head">
              <h1>
                {heading()}
                <Show when={headingCount()}>{(n) => <span class="home-head-n">{n()}</span>}</Show>
                <Show when={notDrawn()}>
                  {(n) => <span class="home-head-n home-head-plan">{`${n()} not drawn yet`}</span>}
                </Show>
              </h1>
              <span class="grow" />
              <div class="home-lead">
                <Show when={shelfOn() && !readonly()}>
                  <button type="button" class="btn home-gather" onClick={() => setGathering(true)}>
                    <Icon name="plus" />
                    New idea
                  </button>
                </Show>
              </div>
            </header>
          </Show>
          <Show when={tree()}>
            <Show when={shown() === "components"}>{componentsShelf()}</Show>
            <Show when={shown() === "shared"}>{sharedShelf(2)}</Show>
            <Show when={shown() === "documents"}>{sectionShelf("documents")}</Show>
            <Show when={shown() === "archive"}>{archive()}</Show>
          </Show>
          <Show when={shown() === "system"}>
            <SystemPlace project={project()} toast={setToast} />
          </Show>
          <Show when={shown() === "recent"}>
            <Recent
              project={project()}
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
      </main>
      <Toast toast={toast()} onDismiss={() => setToast(null)} />
      <Show when={gathering()}>
        <NewIdea
          project={project()}
          typed={BECOMES_ON[shown()] ? { becomes: BECOMES_ON[shown()] } : {}}
          onClose={() => setGathering(false)}
        />
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

// Rows under their area headings, the unnamed under "Unsorted"; with no area named,
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
                {area ?? props.rest ?? "Unsorted"}
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

// New idea: pick versions from across the project into an idea of their own. They come
// as copies, so the originals stay as they are, and replies reach whichever agent is
// working in the project until one writes to it. It is typed by where it was started.
export function NewIdea(props: { project: string; typed: NewIdeaTyping; onClose: () => void }) {
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
