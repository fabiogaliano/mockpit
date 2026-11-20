// The Board: a project laid out as a designer's file is, one page per area, a section per
// flow (steps across, the screen's other states stacked under a step), then each screen's
// states in no flow, the components the page uses, each variants design as a grid of its
// own and what is planned. A screen with ideas for it unfolds them under it ("Ideas · N"),
// and the Ideas page lays out every idea, each a dashed section (boardGrid.ts). Every
// frame is its poster under its name, never a running page: live pages run only in
// Focus, which Enter, a double-click or Open ↵ opens. Pan by dragging empty space, with
// Space held, or by scrolling; zoom with ⌘-scroll, a pinch or +/-; Shift 1 fits the page,
// Shift 2 the selection, Esc lets go of it, ⌘/ hides the rail and the cards. The page's
// card holds its coverage map (server/coverage.ts), what's left to design there; a cell
// is a way to its frame. What the agent does shows on the frames: "agent…" on one it is
// publishing to until its still lands, and a dot on each changed since this browser last
// had it on screen (seen.ts), which the card's "Since you were here" steps through.
// The address is the place: `?page=` and `?sel=` (route.ts), so a link or a reload opens
// fit to the same frame. On a tablet the canvas takes touch (a finger pans, two pinch, a
// double tap opens) and the rail slides in from ☰. A phone has no free canvas: the page
// is its sections as rows a finger swipes, and a tap on a frame opens it.

import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";
import { type Cell, CELLS, coverageSummary, flowLine } from "../../server/coverage.ts";
import { requestKey } from "../../server/sendLines.ts";
import { api, type BoardFrame, type BoardPage, subscribe, type TreeNode } from "./api.ts";
import { sectionOf, sidebarOf } from "./albums.ts";
import { cellShown, gridOf } from "./boardGrid.ts";
import {
  type Box,
  DEFAULT_WIDTH,
  FIT_MS,
  fitView,
  RESERVE_BOTTOM,
  RESERVE_TOP,
  unionBox,
  type View,
  WORLD_PAD,
  wrapWidth,
  zoomAbout,
} from "./boardLayout.ts";
import { BoardRail, libraryOf, railLayers } from "./BoardRail.tsx";
import { FIELD } from "./flowKeys.ts";
import { Home, NewIdea } from "./Home.tsx";
import { readHomeProjects, saveHomeProjects } from "./homeCache.ts";
import { changedSince, markSeen, seenIn, versionShown } from "./seen.ts";
import { host, readonly, root } from "./host.ts";
import { Icon } from "./icons.tsx";
import { emptyDraft, keepSame, rankedAreas } from "./logic.ts";
import { NotFound } from "./NotFound.tsx";
import { ProjectSwitcher } from "./ProjectSwitcher.tsx";
import {
  type BoardSel,
  boardPath,
  designPath,
  type HomePlace,
  navigate,
  projectPath,
  questionPath,
  type RecentShow,
  linkClick,
  dropSelection,
  pushSelection,
  replaceUrl,
  rootPath,
} from "./route.ts";
import { openJump } from "./Jump.tsx";
import { createShortcuts, ShortcutsButton } from "./Shortcuts.tsx";
import { coarse, phoneLayout, railSlides } from "./viewport.ts";
import {
  type BoardQuestion,
  type Frame,
  frameKey,
  framesOf,
  questionsWord,
  rowsIn,
  type Section,
} from "./BoardFrame.tsx";
import { RowSection, type SectionCtx, SectionView } from "./BoardSection.tsx";

const reducedMotion = () =>
  host().window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function Board(props: {
  project: string | null;
  page: string | null;
  unsorted: boolean;
  sel: BoardSel | null;
  sec: HomePlace | null;
  show: RecentShow | null;
  for: string | null;
}) {
  const [rawProjects] = createResource(() => api.projects().catch(() => null));
  const rememberedProjects = readHomeProjects();
  const projects = () => rawProjects() ?? rememberedProjects ?? [];
  createEffect(() => {
    const known = rawProjects();
    if (known) saveHomeProjects(known);
  });
  const project = createMemo(() => props.project ?? projects()[0]?.name ?? null);
  const noSuchProject = () => {
    const known = rawProjects();
    return !!known && !!props.project && !known.some((p) => p.name === props.project);
  };

  // The rail's Library and Exploring rows light up by what the project holds (albums.ts).
  const [tree, { refetch: refetchTree }] = createResource(project, (p) =>
    api.tree(p).catch(() => null),
  );
  const side = createMemo(() => {
    const t = tree();
    return t && t.project === project()
      ? sidebarOf(t.tree, t.flows.length, rankedAreas(t.areas))
      : null;
  });

  // The Ideas page is a canvas too, drawn from the tree: every idea on show, or one
  // design's.
  const ideasPage = () => props.sec === "ideas";
  const onCanvas = () => !props.sec || ideasPage();
  const nodes = createMemo(() => {
    const t = tree();
    return new Map((t && t.project === project() ? t.tree : []).map((n) => [n.slug, n]));
  });
  const titleOf = (slug: string) => nodes().get(slug)?.title;
  const ideaNodes = createMemo(() =>
    (side()?.onShow ?? []).filter((n) => sectionOf(n) === "ideas"),
  );
  const ideasFor = (slug: string) => ideaNodes().filter((n) => n.for === slug);
  const pageIdeas = createMemo(() => ideaNodes().filter((n) => !props.for || n.for === props.for));
  const landed = createMemo(() => pageIdeas().filter((n) => n.ideaWork === "inProduct" && !n.open));
  const working = createMemo(() => pageIdeas().filter((n) => n.ideaWork !== "inProduct" || n.open));
  const [showLanded, setShowLanded] = createSignal(false);
  createEffect(on([project, () => props.for], () => setShowLanded(false), { defer: true }));

  // The page on the canvas. A page asked for by name or by a design it holds is read once;
  // once here, a selection on it moves nothing.
  const [data, setData] = createSignal<BoardPage | null>(null);
  const [failed, setFailed] = createSignal<string | null>(null);
  type Want = { p: string; area?: string; unsorted?: true; design?: string };
  const want = createMemo<Want | null>(
    () => {
      const p = project();
      if (!p) return null;
      if (props.unsorted) return { p, unsorted: true };
      if (props.page) return { p, area: props.page };
      if (props.sel) return { p, design: props.sel.slug };
      return { p };
    },
    null,
    { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );
  const holds = (d: BoardPage, w: Want) =>
    d.project === w.p && (w.unsorted ? d.area === null : w.area ? d.area === w.area : false);
  let seq = 0;
  // The newest read on the canvas, by the number it started with: a write the agent made
  // before a read started is in it.
  const [loaded, setLoaded] = createSignal(0);
  // The address the page on the canvas was read for.
  let readFor = "";
  const load = async (w: Want) => {
    const n = ++seq;
    try {
      const d = await api.board(w.p, { area: w.area, unsorted: !!w.unsorted, design: w.design });
      if (n !== seq) return;
      readFor = JSON.stringify(w);
      setFailed(null);
      setData(d);
      setLoaded(n);
    } catch (e) {
      if (n === seq) setFailed(e instanceof Error ? e.message : String(e));
    }
  };
  createEffect(
    on(want, (w) => {
      if (!w) return;
      const d = untrack(data);
      if (d && holds(d, w)) return;
      void load(w);
    }),
  );
  // What an agent publishes, and each poster the worker attaches, redraws the page. The
  // page's own read is small; the tree (a few hundred KB on a big project) is read again
  // only when a design comes or goes, or one the canvas draws from the tree (an idea, a
  // variants design) changes.
  let refetchTimer = 0;
  let treeToo = false;
  const refetchSoon = (tree: boolean) => {
    treeToo ||= tree;
    if (refetchTimer) return;
    refetchTimer = host().window.setTimeout(() => {
      refetchTimer = 0;
      // The page the address names now, so a redraw racing a move to another page doesn't
      // bring the old one back.
      const w = want();
      if (w && data()) void load(w);
      if (treeToo) void refetchTree();
      treeToo = false;
    }, 300);
  };
  onCleanup(() => host().window.clearTimeout(refetchTimer));
  const nodeById = createMemo(() => {
    const t = tree();
    return new Map((t && t.project === project() ? t.tree : []).map((n) => [n.id, n]));
  });
  const fromTree = (n: TreeNode) => n.kind === "idea" || !!n.variants;
  // An alternative's events don't say whose project they are: one of a design this
  // project's tree doesn't hold is another's (a design new here comes with design-created).
  const stop = subscribe((e) => {
    if (e.type === "post-created" || e.type === "post-updated" || e.type === "post-deleted") {
      const n = nodeById().get(e.designId);
      if (!n) return;
      if (e.type !== "post-deleted" && e.by === "agent") startWriting(e.id);
      refetchSoon(fromTree(n));
    } else if (
      (e.type === "design-created" || e.type === "design-deleted" || e.type === "design-updated") &&
      e.project === project()
    ) {
      const n = nodeById().get(e.id);
      refetchSoon(e.type !== "design-updated" || !n || fromTree(n));
    }
  });
  onCleanup(stop);

  // A link to a design lands here: on its page, an idea on the Ideas page, and a design
  // no page draws (a document, a shared component) in Focus. The address then names the
  // page.
  createEffect(
    on([data, nodes], ([d]) => {
      if (!d || props.sec) return;
      const sel = untrack(() => props.sel);
      if (sel && d.onBoard === false) {
        if (!nodes().size) return;
        if (ideaNodes().some((n) => n.slug === sel.slug)) {
          navigate(boardPath(d.project, { ideas: true, sel }), { replace: true });
          return;
        }
        navigate(
          designPath(
            d.project,
            sel.slug,
            sel.state === undefined ? null : { state: sel.state, alternative: null },
          ),
          { replace: true, focus: true },
        );
        return;
      }
      // A project with nothing on any page opens where its work is.
      if (!d.pages.length && !d.unsorted && !sel) {
        const lit = side()?.lit;
        const first = (["ideas", "documents", "components"] as const).find(
          (x) => lit?.rows.includes(x) || lit?.foot === x,
        );
        if (first) navigate(projectPath(d.project, first), { replace: true });
        return;
      }
      // The address names the page served: one that named no page, and one that named a
      // page there isn't (renamed, or mistyped), which shows the first, so the rail, a
      // reload and a copied link all say the same page. Only for the read of this address.
      const page = untrack(() => props.page);
      const unsorted = untrack(() => props.unsorted);
      const served = page ? d.area === page : unsorted ? d.area === null : false;
      if (!served && readFor === JSON.stringify(untrack(want))) replaceUrl(here(d, sel));
    }),
  );
  const here = (d: BoardPage, sel: BoardSel | null) =>
    ideasPage()
      ? boardPath(d.project, { ideas: true, for: props.for, sel })
      : boardPath(d.project, { page: d.area, unsorted: d.area === null, sel });

  // The page's sections, with the states each screen is owed (the map's Missing cells)
  // drawn as missing frames.
  const pageDrawn = createMemo<Section[]>(() => {
    const d = data();
    if (!d) return [];
    const owedOf = (slug: string) => {
      const row = d.coverage.designs.find((r) => r.slug === slug);
      return row
        ? d.coverage.states.filter((_, i) => row.cells[i] === "Missing").map((x) => x ?? "")
        : [];
    };
    const withKey = (f: BoardFrame): Frame => ({ ...f, key: frameKey(f.slug, f.state) });
    return d.sections.flatMap((s): Section[] => {
      if (s.kind === "flow")
        return [
          {
            ...s,
            steps: s.steps.map((x, i) => ({
              frame: {
                ...x.frame,
                key: frameKey(x.frame.slug, x.frame.state, false, undefined, `${s.id}#${i}`),
              },
              below: x.below.map(withKey),
            })),
          },
        ];
      if (s.kind !== "screen") return [{ ...s, frames: s.frames.map(withKey) }];
      const frames = [
        ...s.frames.map(withKey),
        ...owedOf(s.slug).map((name): Frame => ({
          slug: s.slug,
          state: name,
          name,
          width: s.frames[0]?.width ?? null,
          key: frameKey(s.slug, name, true),
          missing: true,
        })),
      ];
      return frames.length ? [{ ...s, frames }] : [];
    });
  });
  // A section's own switches: the product designs whose ideas are unfolded under them,
  // the sections showing their archived alternatives, and each long one's filter.
  const [unfolded, setUnfolded] = createSignal<ReadonlySet<string>>(new Set());
  const [archivedOn, setArchivedOn] = createSignal<ReadonlySet<string>>(new Set());
  const [filters, setFilters] = createSignal<Record<string, string>>({});
  // The grids showing every row, past their first.
  const [whole, setWhole] = createSignal<ReadonlySet<string>>(new Set());
  // A grid shows its first rows, so one idea or one long variants design doesn't stretch
  // the page into a column: a screen's first alternative across its states (a lab's first
  // of each state), or the first GRID_COMPONENT_ROWS of a component's, which are short.
  // "N more ▾" shows the rest, and a filter every match.
  const gridSection = (node: TreeNode, under: string | null): Section => {
    const grid = gridOf(node, titleOf);
    const id = under ? `idea:${under}:${node.slug}` : `grid:${node.slug}`;
    const query = filters()[id] ?? "";
    const archived = archivedOn().has(id);
    const shown = grid.cells.filter((c) => (archived || !c.archived) && cellShown(c, query));
    // A row stays whole: one of its cells matching keeps the name's other states too.
    const names = new Set(shown.map((c) => c.alternative));
    const all = grid.cells
      .filter((c) => names.has(c.alternative) && (archived || !c.archived))
      .map((c): Frame => ({
        slug: node.slug,
        state: c.state,
        name: grid.aligned && c.state !== null ? `${c.alternative} · ${c.state}` : c.alternative,
        width: grid.width,
        ...(c.poster ? { poster: c.poster } : {}),
        alternative: c.alternative,
        ...(c.archived ? { archived: true as const } : {}),
        key: frameKey(node.slug, c.state, false, c.alternative),
      }));
    // A phone's rows scroll down anyway, so folding alternatives there only hides them.
    const cap =
      query || phoneLayout() ? Infinity : node.kind === "component" ? GRID_COMPONENT_ROWS : 1;
    const firstRows = new Set(rowsIn(grid, all).slice(0, cap));
    const inColumn = new Map<string | null, number>();
    const kept = all.filter((f) => {
      if (grid.aligned) return firstRows.has(f.alternative!);
      const n = inColumn.get(f.state) ?? 0;
      inColumn.set(f.state, n + 1);
      return n < cap;
    });
    const past = all.filter((f) => !kept.includes(f));
    return {
      kind: "grid",
      id,
      grid,
      frames: whole().has(id) ? all : kept,
      under,
      more: new Set(past.map((f) => f.alternative)).size,
      folded: whole().has(id) ? [] : past,
    };
  };
  // The ideas page's sections; or the page's, each variants design taken out of the
  // components into a grid of its own after them, and each unfolded design's ideas right
  // under it.
  const drawn = createMemo<Section[]>(() => {
    if (ideasPage())
      return [
        ...working(),
        ...landed().filter((n) => showLanded() || n.slug === props.sel?.slug),
      ].map((n) => gridSection(n, null));
    const isVariants = (slug: string) => !!nodes().get(slug)?.variants;
    const laid = pageDrawn().flatMap((s): Section[] => {
      if (s.kind !== "components") return [s];
      const frames = s.frames.filter((f) => !isVariants(f.slug));
      const grids = s.frames
        .filter((f) => isVariants(f.slug))
        .map((f) => gridSection(nodes().get(f.slug)!, null));
      return [...(frames.length ? [{ ...s, frames }] : []), ...grids];
    });
    return laid.flatMap((s) => {
      const slug = unfoldable(s);
      return slug && unfolded().has(slug)
        ? [s, ...ideasFor(slug).map((n) => gridSection(n, slug))]
        : [s];
    });
  });
  // The product design a section is, whose ideas can unfold under it.
  const unfoldable = (s: Section): string | null =>
    s.kind === "screen" ? s.slug : s.kind === "grid" && !s.grid.idea ? s.grid.slug : null;

  // A refetch hands back the same page with one still more: what didn't change keeps its
  // object, so <For> keeps its frame and its picture doesn't load again.
  let priorFrames = new Map<string, Frame>();
  const sections = createMemo<Section[]>((was) => {
    const kept = (f: Frame) => {
      const prior = priorFrames.get(f.key);
      return prior && JSON.stringify(prior) === JSON.stringify(f) ? prior : f;
    };
    const steady = drawn().map((s): Section =>
      s.kind === "flow"
        ? {
            ...s,
            steps: s.steps.map((x) => ({ frame: kept(x.frame), below: x.below.map(kept) })),
          }
        : { ...s, frames: s.frames.map(kept) },
    );
    priorFrames = new Map(steady.flatMap(framesOf).map((f) => [f.key, f]));
    return keepSame(was, steady, (s) => s.id);
  }, []);
  const allFrames = createMemo(() => sections().flatMap(framesOf));
  // By id, so a section a refetch changed keeps its element and only what changed in it
  // is drawn again.
  const sectionIds = createMemo(() => sections().map((x) => x.id), [], {
    equals: (a, b) => a.join("\n") === b.join("\n"),
  });
  const sectionById = createMemo(() => new Map(sections().map((x) => [x.id, x])));
  // A link to an alternative past a grid's first rows shows the whole grid, once: folded
  // again by hand, it stays folded.
  let wholeFor = "";
  createEffect(() => {
    const sel = props.sel;
    const at = sel ? JSON.stringify(sel) : "";
    if (!sel?.alternative || at === wholeFor) return;
    const s = sections().find(
      (x) =>
        x.kind === "grid" &&
        x.folded.some((f) => f.slug === sel.slug && f.alternative === sel.alternative),
    );
    if (!s) return;
    wholeFor = at;
    setWhole(new Set(untrack(whole)).add(s.id));
  });
  // A design and the ideas for it: a question on an idea is one on its design's page too.
  const withIdeas = (slugs: Iterable<string>) => {
    const out = new Set(slugs);
    // A copy: the ideas added on the way have no ideas of their own to look up.
    for (const slug of Array.from(out)) for (const n of ideasFor(slug)) out.add(n.slug);
    return out;
  };
  // Every question that leads from this page, its ideas' included, in Needs you's order.
  const pageQuestions = createMemo(() => {
    const d = data();
    if (!d) return [];
    const here = withIdeas(
      sections().flatMap((x) =>
        x.kind === "grid"
          ? [x.grid.slug]
          : x.kind === "screen"
            ? [x.slug]
            : framesOf(x).map((f) => f.slug),
      ),
    );
    // One answered in the draft waits for Send, in the rail: nothing here asks for it.
    return d.questions.filter((q) => here.has(q.slug) && !q.drafted);
  });
  // The questions open on each frame: one asked on a state sits on that state's frame,
  // one asked of the whole design on its first frame on the page, and one on a folded idea
  // on its design's first frame. Answering is Focus's.
  const asksOn = createMemo(() => {
    const out = new Map<string, BoardQuestion[]>();
    const drawn = allFrames().filter((f) => !f.missing && !f.planned);
    for (const q of pageQuestions()) {
      const target = nodes().get(q.slug)?.for;
      const f =
        (q.state === null ? null : drawn.find((x) => x.slug === q.slug && x.state === q.state)) ??
        drawn.find((x) => x.slug === q.slug) ??
        (target ? drawn.find((x) => x.slug === target && !x.alternative) : undefined);
      if (f) out.set(f.key, [...(out.get(f.key) ?? []), q]);
    }
    return out;
  });
  // The alternatives the agent is publishing to, by post id: "agent…" sits on their frames
  // from the publish until a read made after it shows the frame with a still. A new page
  // has none until the poster worker brings it a few seconds later; a write that brings
  // its own, or redraws nothing (hiding older versions), shows one at once. It gives up on
  // a still that never comes.
  type Writing = { seq: number };
  const [writing, setWriting] = createSignal<ReadonlyMap<string, Writing>>(new Map());
  // The sections outlined for a moment as a write lands in them.
  const [outlined, setOutlined] = createSignal<ReadonlySet<string>>(new Set());
  const writeTimers = new Set<number>();
  onCleanup(() => writeTimers.forEach((t) => host().window.clearTimeout(t)));
  const later = (ms: number, fn: () => void) => {
    const t = host().window.setTimeout(() => {
      writeTimers.delete(t);
      fn();
    }, ms);
    writeTimers.add(t);
  };
  const stopWriting = (post: string, entry: Writing) => {
    if (writing().get(post) !== entry) return;
    const next = new Map(writing());
    next.delete(post);
    setWriting(next);
  };
  const startWriting = (post: string) => {
    const entry: Writing = { seq };
    setWriting(new Map(writing()).set(post, entry));
    later(WRITING_MAX_MS, () => stopWriting(post, entry));
  };
  // Each write outlines its section once, when its frame is first on the page, and ends
  // once.
  const outlinedFor = new WeakSet<Writing>();
  const landing = new WeakSet<Writing>();
  const outline = (id: string) => {
    setOutlined(new Set(outlined()).add(id));
    later(OUTLINE_MS, () => {
      const next = new Set(outlined());
      next.delete(id);
      setOutlined(next);
    });
  };
  createEffect(() => {
    const n = loaded();
    const shown = sections();
    for (const [post, entry] of writing()) {
      const at = shown.find((x) => framesOf(x).some((f) => f.post === post));
      const f = at && framesOf(at).find((x) => x.post === post);
      if (!at || !f) continue;
      if (!outlinedFor.has(entry)) {
        outlinedFor.add(entry);
        untrack(() => outline(at.id));
      }
      if (n <= entry.seq || !f.poster || landing.has(entry)) continue;
      landing.add(entry);
      later(WRITING_MIN_MS, () => stopWriting(post, entry));
    }
  });
  const writingOn = (f: Frame) => !!f.post && writing().has(f.post);

  // Changed since this browser last had the frame on screen: its dot, and the card's count.
  const seen = createMemo(() => {
    const t = tree();
    const p = project();
    if (!t || t.project !== p) return null;
    return seenIn(
      p,
      t.tree.flatMap((n) =>
        n.alternatives.map((v) => ({ post: v.postId, version: versionShown(v) })),
      ),
    );
  });
  const isChanged = (f: Frame) =>
    !f.missing &&
    !f.planned &&
    !!f.post &&
    f.version !== undefined &&
    changedSince(seen(), f.post, f.version);
  const changedFrames = createMemo(() => allFrames().filter(isChanged));
  // Stepping through them: the list as it stood at the first step, so seeing one doesn't
  // move the rest.
  const [tour, setTour] = createSignal<{ keys: string[]; at: number } | null>(null);
  // A memo, since every refetch is a new page object and only another page ends the tour.
  const pageKey = createMemo(() => `${data()?.project}|${data()?.area}|${props.sec}`);
  createEffect(on(pageKey, () => setTour(null)));
  const step = () => {
    const t = tour();
    const keys = t ? t.keys : changedFrames().map((f) => f.key);
    const at = t ? t.at + 1 : 0;
    if (at >= keys.length) {
      setTour(null);
      return;
    }
    setTour({ keys, at });
    pickFrame(keys[at]!);
  };
  const pageWidth = createMemo(() => allFrames().find((f) => f.width)?.width ?? DEFAULT_WIDTH);
  const widthOf = (f: Frame) => f.width ?? pageWidth();

  const selected = createMemo<Frame | null>(() => {
    const sel = props.sel;
    if (!sel) return null;
    const of = (f: Frame) =>
      f.slug === sel.slug && (sel.alternative === undefined || f.alternative === sel.alternative);
    return (
      allFrames().find(
        (f) => of(f) && !f.missing && (sel.state === undefined || f.state === sel.state),
      ) ??
      allFrames().find((f) => of(f) && f.state === sel.state) ??
      // An alternative the page doesn't show (archived, filtered out): its state's frame.
      allFrames().find(
        (f) => f.slug === sel.slug && (sel.state === undefined || f.state === sel.state),
      ) ??
      // A state the page draws no frame of (a component shows its first): the design's.
      allFrames().find((f) => f.slug === sel.slug && !f.missing && !f.archived) ??
      allFrames().find((f) => f.slug === sel.slug) ??
      null
    );
  });
  // A frame picked is a frame seen, at the version it shows then. By its key, so one the
  // agent redraws while it stays picked keeps its dot until it is picked again.
  const selectedKey = createMemo(() => selected()?.key);
  createEffect(
    on(selectedKey, () => {
      const f = untrack(selected);
      const p = untrack(project);
      if (f?.post && f.version !== undefined && p) markSeen(p, f.post, f.version);
    }),
  );
  const selOf = (f: Frame): BoardSel => ({
    slug: f.slug,
    state: f.state,
    ...(f.alternative ? { alternative: f.alternative } : {}),
  });
  // The selection made here by a click, as against one a link brought: only a link's moves
  // the view.
  let picked: string | undefined;
  const select = (f: Frame | null) => {
    const d = data();
    if (!d) return;
    const sel = f ? selOf(f) : null;
    picked = sel ? JSON.stringify(sel) : "";
    if (!sel) dropSelection(here(d, null));
    else if (props.sel) replaceUrl(here(d, sel));
    else pushSelection(here(d, sel));
  };
  const linkSel = createMemo<string>((was) => {
    const at = props.sel ? JSON.stringify(props.sel) : "";
    return at === picked ? was : at;
  }, "");

  // The rail, where it slides in from ☰ rather than standing beside the page: a pick in it
  // closes it, and so do Esc and a tap beside it.
  const [railOpen, setRailOpen] = createSignal(false);
  let railEl: HTMLElement | undefined;
  let menuBtn: HTMLButtonElement | undefined;
  const closeRail = () => setRailOpen(false);
  createEffect(() => {
    if (!railOpen()) return;
    railEl?.querySelector<HTMLElement>("button, a")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      closeRail();
      menuBtn?.focus();
    };
    root().addEventListener("keydown", onKey, true);
    onCleanup(() => root().removeEventListener("keydown", onKey, true));
  });
  createEffect(() => {
    if (!railSlides()) closeRail();
  });

  // --- the canvas ---
  const [view, setView] = createSignal<View>({ x: 0, y: 0, k: 0.5 });
  const [animating, setAnimating] = createSignal(false);
  const [moving, setMoving] = createSignal(false);
  const [hideUi, setHideUi] = createSignal(false);
  const [space, setSpace] = createSignal(false);
  const [panning, setPanning] = createSignal(false);
  let stage: HTMLDivElement | undefined;
  let world: HTMLDivElement | undefined;
  let card: HTMLDivElement | undefined;
  const frameEls = new Map<string, HTMLElement>();
  const sectionEls = new Map<string, HTMLElement>();
  // Until the user moves the view, it keeps fitting what it opened on as stills arrive and
  // the layout settles under them.
  let touched = false;
  let opened = false;

  // Layout boxes, which a transform in flight doesn't move.
  const boxOf = (el: HTMLElement): Box => {
    let x = 0;
    let y = 0;
    let at: HTMLElement | null = el;
    while (at && at !== world) {
      x += at.offsetLeft;
      y += at.offsetTop;
      at = at.offsetParent as HTMLElement | null;
    }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  };
  // The page's width, at which its sections wrap into rows (wrapWidth): measured, since a
  // section is as wide and tall as its frames and their names make it. The rows are shaped
  // to the room a fit has, under the card as tall as it is now (its map open or folded).
  const [wrapAt, setWrapAt] = createSignal<number | null>(null);
  const relayout = () => {
    if (!stage || !world) return;
    const sizes = sectionIds().flatMap((id) => {
      const el = sectionEls.get(id);
      return el ? [{ w: el.offsetWidth, h: el.offsetHeight }] : [];
    });
    const room = {
      w: stage.clientWidth - PAGE_FIT_PAD * 2,
      h: stage.clientHeight - (cardBottom() ?? RESERVE_TOP) - RESERVE_BOTTOM,
    };
    setWrapAt(wrapWidth(sizes, room.w > 0 && room.h > 0 ? room.w / room.h : 1.6));
  };
  // The page card grows with its map, and what is fit sits below it.
  const cardBottom = () =>
    card?.isConnected ? card.offsetTop + card.offsetHeight + 18 : undefined;
  const pageBox = (): Box | null =>
    world ? { x: 0, y: 0, w: world.offsetWidth, h: world.offsetHeight } : null;
  const selBox = (): Box | null => {
    const sel = props.sel;
    const f = selected();
    if (!sel || !f) return null;
    // A whole design: all of its frames on the page.
    if (sel.state === undefined) {
      const boxes = allFrames()
        .filter((x) => x.slug === sel.slug)
        .flatMap((x) => {
          const el = frameEls.get(x.key);
          return el ? [boxOf(el)] : [];
        });
      return unionBox(boxes);
    }
    const el = frameEls.get(f.key);
    return el ? boxOf(el) : null;
  };
  let animTimer = 0;
  onCleanup(() => host().window.clearTimeout(animTimer));
  const fit = (box: Box | null, opts: { animate: boolean; frame: boolean; pad?: number }) => {
    if (!box || !stage) return;
    const top = cardBottom();
    const next = fitView(
      box,
      { w: stage.clientWidth, h: stage.clientHeight },
      { pad: opts.pad ?? 60, frame: opts.frame, top },
    );
    if (opts.animate && !reducedMotion()) {
      setAnimating(true);
      host().window.clearTimeout(animTimer);
      animTimer = host().window.setTimeout(() => setAnimating(false), FIT_MS + 30);
    }
    setView(next);
  };
  const fitPage = (animate: boolean) =>
    fit(pageBox(), { animate, frame: false, pad: PAGE_FIT_PAD });
  const fitSel = (animate: boolean) => fit(selBox(), { animate, frame: true, pad: 120 });

  // A new page, or a link to another frame, opens fit to the frame the address names, else
  // to the whole page. By a string, so a redraw of the same page (every publish, every
  // still the worker attaches) keeps the view the user has.
  const openedAt = createMemo(() => {
    const d = data();
    if (!d) return null;
    if (ideasPage())
      return nodes().size ? `${d.project}|ideas|${props.for ?? ""}|${linkSel()}` : null;
    return props.sec ? null : `${d.project}|${d.area}|${linkSel()}`;
  });
  createEffect(
    on(openedAt, (at) => {
      if (!at) return;
      touched = false;
      opened = true;
      settleSoon();
    }),
  );
  // Until the view is moved, sections that come or go (the tree's grids arriving, a grid a
  // link unfolds) lay the page out again.
  createEffect(on(sectionIds, () => settleSoon(), { defer: true }));
  // A still that loads, or a frame queued, after Focus took over must not read the
  // Board's address, which is Focus's by then.
  let gone = false;
  onCleanup(() => (gone = true));
  // Many stills land in one frame's time: one settle for them all.
  let settleFrame = 0;
  onCleanup(() => host().window.cancelAnimationFrame(settleFrame));
  const settleSoon = () => {
    if (touched || settleFrame) return;
    settleFrame = host().window.requestAnimationFrame(() => {
      settleFrame = 0;
      settle();
    });
  };
  const settle = () => {
    if (touched || !opened || gone) return;
    if (phoneLayout()) {
      // Rows have no view to keep fitting: the page opens at its top, or at the frame the
      // address names, once.
      touched = true;
      const f = untrack(() => props.sel) && selected();
      const el = f && frameEls.get(f.key);
      if (el) el.scrollIntoView({ block: "center", inline: "center" });
      else rowsEl?.scrollTo(0, 0);
      return;
    }
    relayout();
    if (untrack(() => props.sel) && selected()) fitSel(false);
    else fitPage(false);
  };
  const touch = () => {
    touched = true;
  };

  let movingTimer = 0;
  onCleanup(() => host().window.clearTimeout(movingTimer));
  // The world is its own layer only while it moves: kept one, zooming in would draw the
  // stills at the scale they were rasterised at, blurred.
  const moved = (next: View) => {
    touch();
    setAnimating(false);
    setMoving(true);
    host().window.clearTimeout(movingTimer);
    movingTimer = host().window.setTimeout(() => setMoving(false), 180);
    setView(next);
  };
  const zoomBy = (by: number, cx?: number, cy?: number) => {
    if (!stage) return;
    moved(zoomAbout(view(), by, cx ?? stage.clientWidth / 2, cy ?? stage.clientHeight / 2));
  };

  // From the project alone: the Ideas page is drawn from the tree, so a page read that
  // failed must not leave its frames dead.
  const open = (f: Frame | null) => {
    const p = project();
    if (!f || !p) return;
    navigate(
      designPath(
        p,
        f.slug,
        f.missing || (f.state === null && !f.alternative)
          ? null
          : { state: f.state, alternative: f.alternative ?? null },
      ),
      { focus: true },
    );
  };

  // A flow played full screen: the one the selection is in, else the page's first.
  const present = (flow?: Extract<Section, { kind: "flow" }>) => {
    const d = data();
    const flows = sections().filter(
      (x): x is Extract<Section, { kind: "flow" }> => x.kind === "flow",
    );
    const f =
      flow ?? flows.find((x) => framesOf(x).some((y) => y.key === selected()?.key)) ?? flows[0];
    const first = f?.steps[0]?.frame;
    if (!d || !f || !first) return;
    const path = designPath(
      d.project,
      first.slug,
      first.state === null ? null : { state: first.state, alternative: null },
      f.name,
    );
    navigate(`${path}${path.includes("?") ? "&" : "?"}present=1`, { focus: true });
  };

  // Keys, while the canvas is what's shown.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || !onCanvas()) return;
      const at = e.composedPath()[0];
      if (at instanceof Element && at.closest(FIELD)) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        setHideUi(!hideUi());
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const onControl = at instanceof Element && !!at.closest("button, a[href], input, select");
      if (e.code === "Space" && !onControl) {
        e.preventDefault();
        setSpace(true);
      } else if (e.shiftKey && e.code === "Digit1") {
        e.preventDefault();
        touch();
        fitPage(true);
      } else if (e.shiftKey && e.code === "Digit2") {
        e.preventDefault();
        touch();
        fitSel(true);
      } else if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        zoomBy(1.2);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomBy(1 / 1.2);
      } else if (e.key === "Enter" && selected() && !onControl) {
        e.preventDefault();
        open(selected());
      } else if (e.key === "?" && !onControl) {
        e.preventDefault();
        keys.toggle();
      } else if (e.key === "Escape" && (keys.open() || mapOpen())) {
        e.preventDefault();
        keys.setOpen(false);
        setMapOpen(false);
      } else if ((e.key === "p" || e.key === "P") && !e.shiftKey) {
        e.preventDefault();
        present();
      } else if (e.key === "Escape" && props.sel) {
        e.preventDefault();
        select(null);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpace(false);
    };
    const onBlur = () => setSpace(false);
    root().addEventListener("keydown", onKey);
    root().addEventListener("keyup", onUp);
    host().window.addEventListener("blur", onBlur);
    onCleanup(() => {
      root().removeEventListener("keydown", onKey);
      root().removeEventListener("keyup", onUp);
      host().window.removeEventListener("blur", onBlur);
    });
  });

  // Dragging empty space, any drag with Space held, or the middle button pans; a drag
  // swallows the click it ends in, so it never selects or lets go.
  let drag: { id: number; x: number; y: number; from: View; moved: boolean } | null = null;
  let swallow = false;
  // Fingers on the canvas: one pans once it has moved past TAP_SLOP, two pinch about their
  // midpoint, and either swallows the click it ends in. A tap that moved less is a click,
  // and a second tap on the same frame soon after opens it, as a double-click does.
  const touches = new Map<number, { x: number; y: number }>();
  let gesture:
    | { kind: "pan"; x: number; y: number; from: View; moved: boolean }
    | { kind: "pinch"; dist: number; mid: { x: number; y: number }; from: View }
    | null = null;
  let byFinger = false;
  let lastTap: { key: string; at: number } | null = null;
  const pairOf = () => {
    const [a, b] = [...touches.values()] as [{ x: number; y: number }, { x: number; y: number }];
    const r = stage!.getBoundingClientRect();
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mid: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top },
    };
  };
  const fingerDown = (e: PointerEvent) => {
    if (
      !stage ||
      (e.target as Element).closest(".bcard, .bselbar, .bmappop, .bkeys, button, a, input")
    )
      return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 1) {
      // A new gesture: a click the last one swallowed in advance, and which never came
      // because the browser saw a pan, mustn't take this tap's.
      swallow = false;
      gesture = { kind: "pan", x: e.clientX, y: e.clientY, from: view(), moved: false };
    } else if (touches.size === 2) {
      swallow = true;
      gesture = { kind: "pinch", ...pairOf(), from: view() };
    }
  };
  const fingerMove = (e: PointerEvent) => {
    if (!touches.has(e.pointerId) || !gesture) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.kind === "pan" && touches.size === 1) {
      const dx = e.clientX - gesture.x;
      const dy = e.clientY - gesture.y;
      if (!gesture.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
      gesture.moved = true;
      swallow = true;
      moved({ ...gesture.from, x: gesture.from.x + dx, y: gesture.from.y + dy });
    } else if (gesture.kind === "pinch" && touches.size === 2) {
      // The midpoint's own travel pans; the spread zooms about where it is now.
      const p = pairOf();
      const from = gesture.from;
      const panned = {
        ...from,
        x: from.x + p.mid.x - gesture.mid.x,
        y: from.y + p.mid.y - gesture.mid.y,
      };
      moved(zoomAbout(panned, p.dist / gesture.dist, p.mid.x, p.mid.y));
    }
  };
  const fingerUp = (e: PointerEvent) => {
    if (!touches.delete(e.pointerId)) return;
    // Lifting one finger of a pinch carries on as a pan from where the other is.
    const [rest] = [...touches.values()];
    gesture = rest ? { kind: "pan", x: rest.x, y: rest.y, from: view(), moved: true } : null;
  };
  const onPointerDown = (e: PointerEvent) => {
    byFinger = e.pointerType === "touch";
    if (byFinger) return fingerDown(e);
    const target = e.target as Element;
    if (target.closest(".bcard, .bselbar, .bmappop, .bkeys, button, a, input")) return;
    const onFrame = !!target.closest(".bf");
    if (!(space() || e.button === 1 || (e.button === 0 && !onFrame))) return;
    e.preventDefault();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, from: view(), moved: false };
    stage?.setPointerCapture(e.pointerId);
    setPanning(true);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return fingerMove(e);
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) <= 3) return;
    drag.moved = true;
    moved({ ...drag.from, x: drag.from.x + dx, y: drag.from.y + dy });
  };
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === "touch") return fingerUp(e);
    if (!drag || e.pointerId !== drag.id) return;
    swallow = drag.moved;
    drag = null;
    setPanning(false);
  };
  const onClick = (e: MouseEvent) => {
    if (swallow) {
      swallow = false;
      return;
    }
    const target = e.target as Element;
    if (target.closest(".bcard, .bselbar, .bmappop, .bkeys, button, a, input")) return;
    const el = target.closest<HTMLElement>(".bf");
    if (space()) return;
    if (!el) {
      if (props.sel) select(null);
      return;
    }
    const f = allFrames().find((x) => x.key === el.dataset.key);
    if (!f) return;
    if (byFinger) {
      if (lastTap?.key === f.key && e.timeStamp - lastTap.at < DOUBLE_TAP_MS) {
        lastTap = null;
        open(f);
        return;
      }
      lastTap = { key: f.key, at: e.timeStamp };
    }
    select(f);
  };
  const onDblClick = (e: MouseEvent) => {
    // A finger's double tap is the click's to open, or it would open twice.
    if (byFinger) return;
    const el = (e.target as Element).closest<HTMLElement>(".bf");
    const f = el && allFrames().find((x) => x.key === el.dataset.key);
    if (f) open(f);
  };
  // A trackpad pinch arrives as a wheel with ctrlKey; ⌘-scroll zooms the same way.
  const onWheel = (e: WheelEvent) => {
    if (!stage) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const r = stage.getBoundingClientRect();
      // A mouse wheel's notch is about 100, a trackpad's steps a few: one notch zooms by
      // about 1.6, as a design tool's does, and a pinch stays smooth.
      const dy = Math.max(-50, Math.min(50, e.deltaY));
      zoomBy(Math.exp(-dy * 0.01), e.clientX - r.left, e.clientY - r.top);
    } else {
      const v = view();
      moved({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
    }
  };
  // The window changing size keeps what was fit, fit.
  onMount(() => {
    const onResize = () => {
      if (!touched) settle();
    };
    host().window.addEventListener("resize", onResize);
    onCleanup(() => host().window.removeEventListener("resize", onResize));
  });

  // --- what the page says about itself ---
  const designOf = (slug: string) => data()?.designs[slug];
  const pageName = () => {
    if (ideasPage()) {
      const t = props.for ? titleOf(props.for) : undefined;
      return t ? `Ideas for ${t}` : "Ideas";
    }
    const d = data();
    if (!d) return props.page ?? "";
    if (d.area !== null) return d.area;
    return d.pages.length ? "Unsorted" : (d.project.split("/").pop() ?? d.project);
  };
  // The page's coverage map, open under the summary until the user folds it, which holds
  // for every page.
  // The map is a popover from the page's line: closed until asked for.
  const [mapOpen, setMapOpen] = createSignal(false);
  const keys = createShortcuts(KEYS_KEY);
  const foldMap = () => setMapOpen(!mapOpen());

  const sinceLine = () => {
    const t = tour();
    return t ? `${t.at + 1} of ${t.keys.length} ›` : `${changedFrames().length} changed ›`;
  };

  const ideaAsks = () => sections().reduce((n, s) => n + (s.kind === "grid" ? s.grid.open : 0), 0);
  // New idea, from the Ideas page: one design's ideas start one for it.
  const [gathering, setGathering] = createSignal(false);
  const newIdeaFor = () => {
    const n = props.for ? nodes().get(props.for) : undefined;
    return n ? { for: { id: n.id, title: n.title } } : {};
  };

  const sectionTitle = (s: Section) => {
    if (s.kind === "flow") return s.name;
    if (s.kind === "grid") return s.grid.title;
    if (s.kind === "screen") {
      const t = designOf(s.slug)?.title ?? s.slug;
      return s.inFlow ? `${t}, not in a flow` : t;
    }
    return s.kind === "components" ? "Components used here" : "Planned";
  };
  const sectionAsks = (s: Section) => {
    if (s.kind === "screen") return questionsOf([s.slug]).length;
    if (s.kind === "grid") return s.grid.open;
    const slugs = new Set(s.kind === "flow" ? framesOf(s).map((f) => f.slug) : []);
    return [...slugs].reduce((n, slug) => n + (designOf(slug)?.open ?? 0), 0);
  };
  // A screen's questions are its own and its ideas', folded or not.
  const questionsOf = (slugs: string[]) => {
    const here = withIdeas(slugs);
    return pageQuestions().filter((q) => here.has(q.slug));
  };
  const pathOf = (q: BoardQuestion | undefined) => {
    const p = project();
    return p && q ? questionPath(p, q.slug, q.id) : null;
  };
  // The count is the way in: the first of the section's questions, as Needs you lists them.
  const firstQuestion = (s: Section) => {
    const d = data();
    if (!d) return null;
    const slugs = new Set(
      s.kind === "grid"
        ? [s.grid.slug]
        : s.kind === "screen"
          ? [...withIdeas([s.slug])]
          : s.kind === "flow"
            ? framesOf(s).map((f) => f.slug)
            : [],
    );
    return pathOf(d.questions.find((x) => slugs.has(x.slug)));
  };
  const flowCoverage = (s: Extract<Section, { kind: "flow" }>) =>
    data()?.coverage.flows.find((f) => f.name === s.name) ?? { ready: 0, steps: s.steps.length };

  const layers = createMemo(() => railLayers(sections(), sectionTitle));
  // On a phone a section or a frame is scrolled to, its row too.
  const scrollTo = (el: HTMLElement, block: ScrollLogicalPosition) =>
    el.scrollIntoView({ block, inline: "center", behavior: reducedMotion() ? "auto" : "smooth" });
  const fitSection = (id: string) => {
    const el = sectionEls.get(id);
    if (!el) return;
    touch();
    if (phoneLayout()) scrollTo(el, "start");
    else fit(boxOf(el), { animate: true, frame: false, pad: 60 });
  };
  const pickFrame = (key: string) => {
    const f = allFrames().find((x) => x.key === key);
    if (!f) return;
    select(f);
    touch();
    host().window.requestAnimationFrame(() => {
      const el = frameEls.get(f.key);
      if (!el) return;
      if (phoneLayout()) scrollTo(el, "center");
      else fit(boxOf(el), { animate: true, frame: true, pad: 120 });
    });
  };
  // A cell of the map is its frame on the page: a Missing cell its dashed frame. A state
  // the page draws no frame of (a component shows its first) falls back to the design's.
  // The standard states a screen lacks, offered in its header rather than drawn.
  const suggestedOf = (slug: string) =>
    data()?.coverage.designs.find((r) => r.slug === slug)?.suggested ?? [];
  // Asking for a state joins that design's Send, as it does in Focus: it waits there with
  // whatever else is drafted, and goes when the user sends it.
  const askState = async (slug: string, name: string) => {
    const id = nodes().get(slug)?.id;
    if (!id) return;
    try {
      const { draft: d } = await api.draft(id);
      const ask = { kind: "state" as const, name };
      const requests = (d?.requests ?? []).filter((r) => requestKey(r) !== requestKey(ask));
      await api.putDraft(id, {
        // Version 0: the server binds it to the newest.
        ...emptyDraft(d?.version ?? 0),
        ...d,
        others: d?.others ?? {},
        askComments: d?.askComments ?? {},
        otherImages: d?.otherImages ?? {},
        askCommentImages: d?.askCommentImages ?? {},
        answerComments: d?.answerComments ?? {},
        requests: [...requests, ask],
      });
      setAsked({ slug, name });
      refetchSoon(false);
    } catch (e) {
      setAskError(e instanceof Error ? e.message : String(e));
    }
  };
  // The state last asked for here, until it is sent or put away.
  const [asked, setAsked] = createSignal<{ slug: string; name: string } | null>(null);
  const dropSuggested = async (slug: string) => {
    const id = nodes().get(slug)?.id;
    if (!id) return;
    try {
      for (const name of suggestedOf(slug))
        await api.stateOutline(id, { state: name, to: "dismissed" });
      refetchSoon(false);
    } catch (e) {
      setAskError(e instanceof Error ? e.message : String(e));
    }
  };
  const [askError, setAskError] = createSignal<string | null>(null);
  const pickCell = (slug: string, state: string | null, cell: Cell) => {
    const of = allFrames().filter((f) => f.slug === slug);
    const f =
      of.find((x) => x.state === state && !!x.missing === (cell === "Missing") && !x.archived) ??
      of.find((x) => x.state === state) ??
      of.find((x) => !x.missing && !x.archived) ??
      of[0];
    if (f) pickFrame(f.key);
  };

  // --- drawing ---
  // A still is fetched once its frame first comes within a stage's size of the view: a page
  // of a few hundred frames would otherwise fetch and decode every one as it opens. Far
  // ones are then left unpainted by the browser (`content-visibility` on `.bf-pic`).
  const [near, setNear] = createSignal<ReadonlySet<string>>(new Set());
  let watcher: IntersectionObserver | undefined;
  const watch = (root: HTMLElement) => {
    watcher = new IntersectionObserver(
      (entries) => {
        const came = entries.filter((e) => e.isIntersecting);
        if (!came.length) return;
        const next = new Set(near());
        for (const e of came) {
          const key = (e.target as HTMLElement).dataset.key;
          if (key) next.add(key);
          watcher?.unobserve(e.target);
        }
        setNear(next);
      },
      { root, rootMargin: "100%" },
    );
    for (const [key, el] of frameEls) if (!near().has(key)) watcher.observe(el);
  };
  const keepFrame = (key: string) => (el: HTMLElement) => {
    frameEls.set(key, el);
    if (!untrack(near).has(key)) watcher?.observe(el);
    onCleanup(() => {
      watcher?.unobserve(el);
      if (frameEls.get(key) === el) frameEls.delete(key);
    });
  };
  const keepSection = (id: string) => (el: HTMLElement) => {
    sectionEls.set(id, el);
    onCleanup(() => {
      if (sectionEls.get(id) === el) sectionEls.delete(id);
    });
  };
  // The frames a flow shows: there a step named after its screen still says which screen.
  const flowKeys = createMemo(
    () =>
      new Set(sections().flatMap((x) => (x.kind === "flow" ? framesOf(x).map((f) => f.key) : []))),
  );
  const sectionCtx: SectionCtx = {
    widthOf,
    designOf,
    flowKeys,
    selected,
    writingOn,
    keepFrame,
    isChanged,
    asksOn,
    pathOf,
    near,
    settleSoon,
    open,
    sectionById,
    outlined,
    keepSection,
    sectionTitle,
    flowCoverage,
    present,
    suggestedOf,
    askState,
    dropSuggested,
    sectionAsks,
    firstQuestion,
    unfoldable,
    ideasFor,
    productPath: (slug) => {
      const target = nodes().get(slug)?.for;
      const name = project();
      return target && name ? designPath(name, target) : undefined;
    },
    unfolded,
    setUnfolded,
    archivedOn,
    setArchivedOn,
    whole,
    setWhole,
    filters,
    setFilters,
    touch,
  };
  let rowsEl: HTMLDivElement | undefined;
  const rows = (): JSX.Element => (
    <div class="prows" ref={(el) => (rowsEl = el)}>
      <div class="pbhead">{pageHead(true)}</div>
      <For each={sectionIds()}>{(id) => <RowSection c={sectionCtx} id={id} />}</For>
      <Show when={data() && !sections().length && (!ideasPage() || nodes().size)}>
        <p class="bempty">
          {ideasPage() ? "No open ideas." : "Nothing is drawn on this page yet."}
        </p>
      </Show>
    </div>
  );

  // --- the selection bar ---
  const selName = () => {
    const f = selected();
    if (!f) return "";
    const title = designOf(f.slug)?.title ?? titleOf(f.slug);
    return title && f.name !== title ? `${title} · ${f.name}` : f.name;
  };
  const [copied, setCopied] = createSignal<string | null>(null);
  let copyTimer = 0;
  onCleanup(() => host().window.clearTimeout(copyTimer));
  const copyLink = () => {
    const d = data();
    const f = selected();
    if (!d || !f) return;
    const href = `${host().location.origin}${here(d, selOf(f))}`;
    const say = (w: string) => {
      setCopied(w);
      host().window.clearTimeout(copyTimer);
      copyTimer = host().window.setTimeout(() => setCopied(null), 2000);
    };
    const copying = host().window.navigator.clipboard?.writeText(href);
    if (!copying) return say("Select the address");
    copying.then(
      () => say("Copied"),
      () => say("Select the address"),
    );
  };

  // Over the canvas, one line: the page and what's new on it. How far along it is is the
  // rail's count; the page's name opens its map. What waits on you is the pill above the
  // canvas, not a count here.
  const pageLine = () => (
    <Show when={!ideasPage() && data()?.coverage} fallback={pageHead(false)}>
      {(c) => (
        <div class="bline">
          <Show when={c().states.length} fallback={<h2>{pageName()}</h2>}>
            <h2>
              <button
                type="button"
                class="bline-map"
                title={data()?.description ?? "Map"}
                aria-expanded={mapOpen()}
                aria-controls="board-map"
                onClick={() => setMapOpen(!mapOpen())}
              >
                {pageName()}
              </button>
            </h2>
          </Show>
          <Show when={tour() || changedFrames().length}>
            <button type="button" class="bsince" title="Show changes" onClick={step}>
              {sinceLine()}
            </button>
          </Show>
        </div>
      )}
    </Show>
  );

  // What the page says about itself: over the canvas a card, its map under it; above a
  // phone's rows the same words, the map's summary line alone.
  const pageHead = (rows: boolean) => (
    <>
      <h2>{pageName()}</h2>
      <Show
        when={ideasPage()}
        fallback={<Show when={data()?.description}>{(t) => <p>{t()}</p>}</Show>}
      >
        <div class="bcov">
          <span>
            <b>{working().length}</b>
            {working().length === 1 ? " open idea" : " open ideas"}
          </span>
          <Show when={ideaAsks()}>
            <span>
              <b>{ideaAsks()}</b>
              {ideaAsks() === 1 ? " question" : " questions"}
            </span>
          </Show>
          <Show when={landed().length}>
            <button
              type="button"
              class="bchip bidea-fold"
              aria-expanded={showLanded()}
              onClick={() => {
                if (showLanded() && landed().some((n) => n.slug === props.sel?.slug)) select(null);
                setShowLanded(!showLanded());
              }}
            >
              In product · {landed().length}
              <Icon name={showLanded() ? "up" : "down"} />
            </button>
          </Show>
          <Show when={props.for}>
            <a
              class="bcov-link"
              href={boardPath(project() ?? "", { ideas: true })}
              onClick={(e) => linkClick(e, boardPath(project() ?? "", { ideas: true }))}
            >
              All ideas
            </a>
          </Show>
          <Show when={!readonly()}>
            <button type="button" class="bcov-link" onClick={() => setGathering(true)}>
              New idea
            </button>
          </Show>
        </div>
      </Show>
      <Show when={!ideasPage() && data()?.coverage}>
        {(c) => (
          <>
            <div class="bcov">
              <For
                each={[
                  ...coverageSummary(c()).filter((p) => !p.text.includes("question")),
                  {
                    n: pageQuestions().length,
                    text: pageQuestions().length === 1 ? " question" : " questions",
                  },
                ]}
              >
                {(p) => (
                  <span classList={{ q: p.text.includes("question") && p.n > 0 }}>
                    <b>{p.n}</b>
                    {p.text}
                  </span>
                )}
              </For>
              <Show when={tour() || changedFrames().length}>
                <button type="button" class="bsince" title="Show changes" onClick={step}>
                  {sinceLine()}
                </button>
              </Show>
              <Show when={!rows && c().states.length}>
                <button
                  type="button"
                  class="bcov-link"
                  aria-expanded={mapOpen()}
                  title={mapOpen() ? "Fold the map to this line" : "Each design's states"}
                  onClick={foldMap}
                >
                  {mapOpen() ? "Hide map" : "Map"}
                </button>
              </Show>
            </div>
            <Show when={!rows && mapOpen() && c().states.length}>
              <CoverageMap coverage={c()} onCell={pickCell} onFlow={fitSection} />
            </Show>
          </>
        )}
      </Show>
    </>
  );

  const canvas = (): JSX.Element => {
    // The window narrowed to a phone's: the rows take over, and nothing fits a stage gone.
    onCleanup(() => {
      stage = undefined;
      world = undefined;
      watcher?.disconnect();
      watcher = undefined;
      touches.clear();
      gesture = null;
    });
    return (
      <div
        class="bstage"
        classList={{ space: space(), panning: panning() }}
        ref={(el) => {
          stage = el;
          el.addEventListener("wheel", onWheel, { passive: false });
          watch(el);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
        onDblClick={onDblClick}
      >
        <div
          class="bworld"
          classList={{ anim: animating(), moving: moving() }}
          ref={(el) => (world = el)}
          style={{
            transform: `translate(${view().x}px, ${view().y}px) scale(${view().k})`,
            "--k": String(view().k),
            ...(wrapAt() ? { width: `${wrapAt()! + WORLD_PAD * 2}px` } : {}),
          }}
        >
          <For each={sectionIds()}>{(id) => <SectionView c={sectionCtx} id={id} />}</For>
          <Show when={data() && !sections().length && (!ideasPage() || nodes().size)}>
            <p class="bempty">
              {ideasPage() ? "No open ideas." : "Nothing is drawn on this page yet."}
            </p>
          </Show>
        </div>
        <Show when={!hideUi()}>
          <div class="bcard" classList={{ one: !ideasPage() }} ref={(el) => (card = el)}>
            {pageLine()}
          </div>
          <Show when={!ideasPage() && mapOpen() && data()?.coverage}>
            {(c) => (
              <div class="bmappop" id="board-map" role="dialog" aria-label="Map of the page">
                <Show when={data()?.description}>{(t) => <p>{t()}</p>}</Show>
                <CoverageMap coverage={c()} onCell={pickCell} onFlow={fitSection} />
              </div>
            )}
          </Show>
          <Show when={asked()}>
            {(a) => (
              <p class="bask-err" role="status">
                {`${a().name}, in Send`}
                <button
                  type="button"
                  class="btn"
                  onClick={() => {
                    setAsked(null);
                    navigate(designPath(project()!, a().slug), { focus: true });
                  }}
                >
                  Open
                </button>
                <button
                  type="button"
                  class="ib bhint-got"
                  aria-label="Dismiss"
                  onClick={() => setAsked(null)}
                >
                  <Icon name="close" />
                </button>
              </p>
            )}
          </Show>
          <Show when={askError()}>
            {(e) => (
              <p class="bask-err" role="alert">
                {`Couldn't add that: ${e()}`}
                <button
                  type="button"
                  class="ib bhint-got"
                  aria-label="Dismiss"
                  onClick={() => setAskError(null)}
                >
                  <Icon name="close" />
                </button>
              </p>
            )}
          </Show>
          <Show when={pageQuestions().length}>
            {(n) => (
              <Show when={pathOf(pageQuestions()[0])}>
                {(path) => (
                  <a
                    class="bqpill"
                    href={path()}
                    onClick={(e) => linkClick(e, path(), true)}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <span>{`${questionsWord(n())} waiting`}</span>
                    <b>Answer ›</b>
                  </a>
                )}
              </Show>
            )}
          </Show>
          <Show when={selected()}>
            <div class="bselbar">
              <span>{selName()}</span>
              <button type="button" class="btn" onClick={copyLink}>
                {copied() ?? "Copy link"}
              </button>
              <button type="button" class="btn go" onClick={() => open(selected())}>
                Open ↵
              </button>
            </div>
          </Show>
          <ShortcutsButton k={keys} id="board-keys">
            <Show
              when={!coarse()}
              fallback={
                <dl>
                  <dt>Pinch</dt>
                  <dd>Zoom</dd>
                  <dt>Drag</dt>
                  <dd>Pan</dd>
                  <dt>Double-tap</dt>
                  <dd>Open</dd>
                </dl>
              }
            >
              <dl>
                <dt>
                  <kbd>↵</kbd>
                </dt>
                <dd>Open, or double-click</dd>
                <dt>
                  <kbd>⇧1</kbd>
                </dt>
                <dd>Fit the page</dd>
                <dt>
                  <kbd>⇧2</kbd>
                </dt>
                <dd>Fit the selection</dd>
                <dt>
                  <kbd>Space</kbd>
                </dt>
                <dd>Drag to pan, or scroll</dd>
                <dt>
                  <kbd>⌘</kbd> scroll
                </dt>
                <dd>Zoom, or pinch</dd>
                <dt>
                  <kbd>⌘/</kbd>
                </dt>
                <dd>Hide the interface</dd>
                <dt>
                  <kbd>P</kbd>
                </dt>
                <dd>Present a flow: → ← walk it, R starts over, Esc ends</dd>
              </dl>
            </Show>
          </ShortcutsButton>
        </Show>
      </div>
    );
  };

  return (
    <div
      class="screen boardscreen"
      classList={{ "board-bare": hideUi(), "rail-slides": railSlides() }}
    >
      <Show when={!hideUi() && project()}>
        {(p) => (
          <>
            <Show when={railSlides()}>
              <div
                class="side-scrim"
                classList={{ on: railOpen() }}
                aria-hidden="true"
                onClick={closeRail}
              />
            </Show>
            <BoardRail
              project={p()}
              projects={projects()}
              pages={data()?.project === p() ? (data()?.pages ?? []) : []}
              unsortedPage={data()?.project === p() ? (data()?.unsorted ?? null) : null}
              onPage={props.sec ? null : data()?.project === p() ? (data()?.area ?? null) : null}
              onUnsorted={!props.sec && data()?.project === p() && data()?.area === null}
              sec={props.sec}
              questions={data()?.project === p() ? (data()?.questions ?? []) : []}
              library={libraryOf(tree())}
              layers={onCanvas() ? layers() : []}
              selected={selected()?.key ?? null}
              onFitSection={(id) => {
                closeRail();
                fitSection(id);
              }}
              onPickFrame={(key) => {
                closeRail();
                pickFrame(key);
              }}
              onNav={closeRail}
              drawer={railSlides()}
              inert={railSlides() && !railOpen()}
              ref={(el) => (railEl = el)}
            />
          </>
        )}
      </Show>
      <div class="board-main">
        <header class="board-top">
          <Show when={railSlides() && !hideUi()}>
            <button
              type="button"
              class="ib board-menu"
              aria-label="Open the pages"
              aria-expanded={railOpen()}
              title="Pages"
              ref={(el) => (menuBtn = el)}
              onClick={() => setRailOpen(true)}
            >
              <Icon name="menu" />
              <Show
                when={
                  data()?.project === project() &&
                  data()?.questions.filter((q) => !q.drafted).length
                }
              >
                {(n) => (
                  <span class="board-menu-n" aria-label={`${n()} waiting for you`}>
                    {n()}
                  </span>
                )}
              </Show>
            </button>
          </Show>
          <Show when={hideUi()}>
            <ProjectSwitcher current={project()} known={!noSuchProject()} projects={projects()} />
            <span class="sep">/</span>
          </Show>
          <b class="board-crumb">{props.sec && !ideasPage() ? secName(props.sec) : pageName()}</b>
          <span class="grow" />
          <Show when={onCanvas() && !phoneLayout()}>
            <button
              type="button"
              class="board-zoom"
              title="Fit the page (⇧1)"
              onClick={() => {
                touch();
                fitPage(true);
              }}
            >
              {`${Math.round(view().k * 100)}%`}
            </button>
          </Show>
          <button
            type="button"
            class="themebtn"
            aria-label="Search"
            title="Search ( / or ⌘K )"
            onClick={openJump}
          >
            <Icon name="search" />
          </button>
        </header>
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
            when={props.sec && !ideasPage() ? props.sec : null}
            fallback={
              <Show
                when={!failed()}
                fallback={<p class="bempty">{`Couldn't read this page: ${failed()}`}</p>}
              >
                <Show when={phoneLayout()} fallback={canvas()}>
                  {rows()}
                </Show>
              </Show>
            }
          >
            {(sec) => (
              <div class="board-place">
                <Home project={project()} sec={sec()} show={props.show} />
              </div>
            )}
          </Show>
        </Show>
      </div>
      <Show when={gathering() && project()}>
        {(p) => <NewIdea project={p()} typed={newIdeaFor()} onClose={() => setGathering(false)} />}
      </Show>
    </div>
  );
}

const KEYS_KEY = "mockpit:board-keys";
// The margin a fit of the whole page leaves at the stage's sides.
const PAGE_FIT_PAD = 40;
// A finger that moved less than this tapped; more, it pans.
const TAP_SLOP = 6;
const DOUBLE_TAP_MS = 350;
// "agent…" stays this long after the still lands, so a write that brings its own still is
// seen too, and gives up after the longest the poster worker could take.
const WRITING_MIN_MS = 1500;
const WRITING_MAX_MS = 60_000;
const OUTLINE_MS = 1800;
// A component's stills are short: this many of its rows stand about as tall as a screen.
const GRID_COMPONENT_ROWS = 4;

const CELL_CLASS: Record<Cell, string> = {
  Ready: "r",
  "In design": "d",
  Planned: "p",
  Missing: "m",
};
const stateName = (s: string | null) => s ?? "Single state";
// A Missing cell is a state the user asked for: the viewer says so.
const cellWord = (c: Cell) => (c === "Missing" ? "Asked for" : c);

// Designs down, states across, the cells as the legend says; a cell is a way to its frame.
function CoverageMap(props: {
  coverage: BoardPage["coverage"];
  onCell: (slug: string, state: string | null, cell: Cell) => void;
  onFlow: (id: string) => void;
}) {
  return (
    <div class="bmap">
      <div class="bmap-scroll">
        <table>
          <thead>
            <tr>
              <th />
              <For each={props.coverage.states}>
                {(s) => (
                  <th scope="col" title={stateName(s)}>
                    <span>{stateName(s)}</span>
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={props.coverage.designs}>
              {(r) => (
                <tr>
                  <th scope="row" title={`${r.title} · ${r.status}`}>
                    {r.title}
                  </th>
                  <For each={r.cells}>
                    {(cell, i) => (
                      <td>
                        <Show when={cell} fallback={<span class="bmc" />}>
                          {(x) => {
                            const state = () => props.coverage.states[i()] ?? null;
                            const what = () =>
                              `${r.title} · ${stateName(state())}: ${cellWord(x())}`;
                            return (
                              <button
                                type="button"
                                class={`bmc ${CELL_CLASS[x()]}`}
                                title={what()}
                                aria-label={what()}
                                onClick={() => props.onCell(r.slug, state(), x())}
                              />
                            );
                          }}
                        </Show>
                      </td>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <div class="bmap-legend">
        <For each={CELLS}>
          {(x) => (
            <span>
              <i class={`bmc ${CELL_CLASS[x]}`} aria-hidden="true" />
              {cellWord(x)}
            </span>
          )}
        </For>
      </div>
      <Show when={props.coverage.flows.length}>
        <div class="bmap-flows">
          <For each={props.coverage.flows}>
            {(f) => (
              <button
                type="button"
                class="bcov-link"
                onClick={() => props.onFlow(`flow:${f.name}`)}
              >
                {`${f.name}: ${flowLine(f)}`}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

const SEC_NAME: Partial<Record<HomePlace, string>> = {
  components: "Components",
  shared: "Components",
  system: "System",
  documents: "Documents",
  ideas: "Ideas",
  archive: "Archive",
  recent: "Recent",
};
const secName = (sec: HomePlace) => SEC_NAME[sec] ?? "";
