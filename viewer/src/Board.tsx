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
// fit to the same frame.

import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Index,
  type JSX,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
} from "solid-js";
import { type Cell, CELLS, coverageSummary, flowLine } from "../../server/coverage.ts";
import {
  api,
  assetUrl,
  type BoardFrame,
  type BoardPage,
  type BoardSection,
  subscribe,
  type TreeNode,
} from "./api.ts";
import { sectionOf, sidebarOf } from "./albums.ts";
import { cellShown, FILTER_FROM, type Grid, gridOf } from "./boardGrid.ts";
import {
  type Box,
  DEFAULT_WIDTH,
  FIT_MS,
  fitView,
  frameHeight,
  unionBox,
  type View,
  zoomAbout,
} from "./boardLayout.ts";
import { BoardRail, libraryOf, type RailLayer } from "./BoardRail.tsx";
import { FIELD } from "./flowKeys.ts";
import { Home, NewIdea } from "./Home.tsx";
import { readHomeProjects, saveHomeProjects } from "./homeCache.ts";
import { changedSince, markSeen, seenIn } from "./seen.ts";
import { host, readonly, root } from "./host.ts";
import { Icon } from "./icons.tsx";
import { keepSame, rankedAreas } from "./logic.ts";
import { NotFound } from "./NotFound.tsx";
import { ProjectSwitcher } from "./ProjectSwitcher.tsx";
import {
  type BoardSel,
  boardPath,
  designPath,
  type HomePlace,
  navigate,
  projectPath,
  type RecentShow,
  linkClick,
  replaceUrl,
  rootPath,
} from "./route.ts";
import { openJump } from "./Jump.tsx";

// A frame as the Board draws it: the server's, a state the screen is still owed, or one
// alternative's cell in a grid.
interface Frame extends BoardFrame {
  key: string;
  missing?: true;
  alternative?: string;
  archived?: true;
}
type Section =
  | (Omit<Extract<BoardSection, { kind: "flow" }>, "steps"> & {
      steps: { frame: Frame; below: Frame[] }[];
    })
  | (Omit<Extract<BoardSection, { kind: "screen" }>, "frames"> & { frames: Frame[] })
  | { kind: "components" | "planned"; id: string; frames: Frame[] }
  // An idea or a variants design; `under` is the product design it was unfolded from.
  | { kind: "grid"; id: string; grid: Grid; frames: Frame[]; under: string | null };

const frameKey = (slug: string, state: string | null, missing = false, alternative?: string) =>
  JSON.stringify([slug, state, missing, alternative ?? null]);

const framesOf = (s: Section): Frame[] =>
  s.kind === "flow" ? s.steps.flatMap((x) => [x.frame, ...x.below]) : s.frames;

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

  // The rail's Library and Exploring rows light up by what the project holds, Home's rule.
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
  const load = async (w: Want) => {
    const n = ++seq;
    try {
      const d = await api.board(w.p, { area: w.area, unsorted: !!w.unsorted, design: w.design });
      if (n !== seq) return;
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
  // What an agent publishes, and each poster the worker attaches, redraws the page.
  let refetchTimer = 0;
  const refetchSoon = () => {
    if (refetchTimer) return;
    refetchTimer = host().window.setTimeout(() => {
      refetchTimer = 0;
      const d = data();
      if (d)
        void load({ p: d.project, ...(d.area === null ? { unsorted: true } : { area: d.area }) });
      void refetchTree();
    }, 300);
  };
  onCleanup(() => host().window.clearTimeout(refetchTimer));
  // A design's own events say whose project they are; an alternative's don't, and are few.
  const stop = subscribe((e) => {
    if (e.type === "post-created" || e.type === "post-updated") {
      if (e.by === "agent") startWriting(e.id);
      refetchSoon();
    } else if (e.type === "post-deleted") refetchSoon();
    else if ("project" in e && e.type.startsWith("design-") && e.project === data()?.project)
      refetchSoon();
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
      if (!untrack(() => props.page) && !untrack(() => props.unsorted)) replaceUrl(here(d, sel));
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
            steps: s.steps.map((x) => ({ frame: withKey(x.frame), below: x.below.map(withKey) })),
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
  const flip = (set: ReadonlySet<string>, id: string) => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    return next;
  };
  const gridSection = (node: TreeNode, under: string | null): Section => {
    const grid = gridOf(node, titleOf);
    const id = under ? `idea:${under}:${node.slug}` : `grid:${node.slug}`;
    const query = filters()[id] ?? "";
    const archived = archivedOn().has(id);
    const shown = grid.cells.filter((c) => (archived || !c.archived) && cellShown(c, query));
    // A row stays whole: one of its cells matching keeps the name's other states too.
    const names = new Set(shown.map((c) => c.alternative));
    const frames = grid.cells
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
    return { kind: "grid", id, grid, frames, under };
  };
  // The ideas page's sections; or the page's, each variants design taken out of the
  // components into a grid of its own after them, and each unfolded design's ideas right
  // under it.
  const drawn = createMemo<Section[]>(() => {
    if (ideasPage())
      return ideaNodes()
        .filter((n) => !props.for || n.for === props.for)
        .map((n) => gridSection(n, null));
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
  // The questions open on each frame: one asked on a state sits on that state's frame,
  // one asked of the whole design on its first frame on the page. Answering is Focus's.
  const asksOn = createMemo(() => {
    const out = new Map<string, number>();
    const drawn = allFrames().filter((f) => !f.missing && !f.planned);
    for (const q of data()?.questions ?? []) {
      const f =
        (q.state === null ? null : drawn.find((x) => x.slug === q.slug && x.state === q.state)) ??
        drawn.find((x) => x.slug === q.slug);
      if (f) out.set(f.key, (out.get(f.key) ?? 0) + 1);
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
      t.tree.flatMap((n) => n.alternatives.map((v) => ({ post: v.postId, version: v.version }))),
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
      null
    );
  });
  // A frame picked is a frame seen, at the version it shows then: one the agent redraws
  // while it stays picked is dotted again.
  createEffect(
    on(
      () => selected()?.key,
      () => {
        const f = untrack(selected);
        const p = untrack(project);
        if (f?.post && f.version !== undefined && p) markSeen(p, f.post, f.version);
      },
    ),
  );
  const selOf = (f: Frame): BoardSel => ({
    slug: f.slug,
    state: f.state,
    ...(f.alternative ? { alternative: f.alternative } : {}),
  });
  const select = (f: Frame | null) => {
    const d = data();
    if (!d) return;
    replaceUrl(here(d, f ? selOf(f) : null));
  };

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
    // The page card grows with its map, and what is fit sits below it.
    const top = card?.isConnected ? card.offsetTop + card.offsetHeight + 18 : undefined;
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
  const fitPage = (animate: boolean) => fit(pageBox(), { animate, frame: false, pad: 40 });
  const fitSel = (animate: boolean) => fit(selBox(), { animate, frame: true, pad: 120 });

  // A new page opens fit to the frame the address names, else to the whole page.
  createEffect(
    on(
      () => {
        const d = data();
        if (!d) return null;
        return ideasPage()
          ? `${d.project}|ideas|${props.for ?? ""}|${nodes().size > 0}`
          : props.sec
            ? null
            : `${d.project}|${d.area}`;
      },
      (page) => {
        if (!page) return;
        touched = false;
        opened = true;
        host().window.requestAnimationFrame(settle);
      },
    ),
  );
  // A still that loads, or a frame queued, after Focus took over must not read the
  // Board's address, which is Focus's by then.
  let gone = false;
  onCleanup(() => (gone = true));
  const settle = () => {
    if (touched || !opened || gone) return;
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

  const open = (f: Frame | null) => {
    const d = data();
    if (!f || !d) return;
    navigate(
      designPath(
        d.project,
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
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    const target = e.target as Element;
    if (target.closest(".bcard, .bselbar, .bhint, button, a, input")) return;
    const onFrame = !!target.closest(".bf");
    if (!(space() || e.button === 1 || (e.button === 0 && !onFrame))) return;
    e.preventDefault();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, from: view(), moved: false };
    stage?.setPointerCapture(e.pointerId);
    setPanning(true);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) <= 3) return;
    drag.moved = true;
    moved({ ...drag.from, x: drag.from.x + dx, y: drag.from.y + dy });
  };
  const onPointerUp = (e: PointerEvent) => {
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
    if (target.closest(".bcard, .bselbar, .bhint, button, a, input")) return;
    const el = target.closest<HTMLElement>(".bf");
    if (space()) return;
    if (!el) {
      if (props.sel) select(null);
      return;
    }
    const f = allFrames().find((x) => x.key === el.dataset.key);
    if (f) select(f);
  };
  const onDblClick = (e: MouseEvent) => {
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
  createEffect(() => {
    const el = stage;
    if (!el || !onCanvas()) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    onCleanup(() => el.removeEventListener("wheel", onWheel));
  });
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
    return d.pages.length ? "No area" : (d.project.split("/").pop() ?? d.project);
  };
  // The page's coverage map, open under the summary until the user folds it, which holds
  // for every page.
  const [mapOpen, setMapOpen] = createSignal(host().storage?.getItem(MAP_KEY) !== "closed");
  const foldMap = () => {
    const next = !mapOpen();
    setMapOpen(next);
    host().storage?.setItem(MAP_KEY, next ? "open" : "closed");
    host().window.requestAnimationFrame(settle);
  };

  const sinceLine = () => {
    const t = tour();
    return t
      ? `Since you were here: ${t.at + 1} of ${t.keys.length} ›`
      : `Since you were here: ${changedFrames().length} changed ›`;
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
    if (s.kind === "grid") return s.grid.open;
    const slugs = new Set(
      s.kind === "screen" ? [s.slug] : s.kind === "flow" ? framesOf(s).map((f) => f.slug) : [],
    );
    return [...slugs].reduce((n, slug) => n + (designOf(slug)?.open ?? 0), 0);
  };
  const flowCoverage = (s: Extract<Section, { kind: "flow" }>) =>
    data()?.coverage.flows.find((f) => f.name === s.name) ?? { ready: 0, steps: s.steps.length };

  // A grid's frames are too many to list; its section is the layer.
  const layers = createMemo<RailLayer[]>(() =>
    sections().map((s) => ({
      id: s.id,
      kind: s.kind === "grid" ? (s.grid.idea ? "idea" : "variants") : s.kind,
      name: sectionTitle(s),
      frames: (s.kind === "flow"
        ? s.steps.map((x, i) => ({ f: x.frame, label: `${i + 1}. ${x.frame.name}` }))
        : s.kind === "grid"
          ? []
          : framesOf(s).map((f) => ({ f, label: f.name }))
      ).map(({ f, label }) => ({ key: f.key, label })),
    })),
  );
  const fitSection = (id: string) => {
    const el = sectionEls.get(id);
    if (!el) return;
    touch();
    fit(boxOf(el), { animate: true, frame: false, pad: 60 });
  };
  const pickFrame = (key: string) => {
    const f = allFrames().find((x) => x.key === key);
    if (!f) return;
    select(f);
    touch();
    host().window.requestAnimationFrame(() => {
      const el = frameEls.get(f.key);
      if (el) fit(boxOf(el), { animate: true, frame: true, pad: 120 });
    });
  };
  // A cell of the map is its frame on the page: a Missing cell its dashed frame. A state
  // the page draws no frame of (a component shows its first) falls back to the design's.
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
  const frameView = (f: Frame) => {
    const w = () => widthOf(f);
    const component = () => designOf(f.slug)?.kind === "component";
    return (
      <div
        class="bf"
        classList={{
          sel: selected()?.key === f.key,
          planned: !!f.planned,
          missing: !!f.missing,
          cmp: component(),
          archived: !!f.archived,
          writing: writingOn(f),
        }}
        data-key={f.key}
        ref={(el) => {
          frameEls.set(f.key, el);
          onCleanup(() => {
            if (frameEls.get(f.key) === el) frameEls.delete(f.key);
          });
        }}
        style={{ width: `${w()}px` }}
      >
        <div class="bf-nm" title={isChanged(f) ? `${f.name}, changed since you were here` : f.name}>
          <Show when={isChanged(f)}>
            <i class="bf-dot" aria-label="Changed since you were here" />
          </Show>
          {f.name}
        </div>
        <Show when={writingOn(f)}>
          <span class="bf-agent" role="status">
            agent…
          </span>
        </Show>
        <Show when={asksOn().get(f.key)}>
          {(n) => (
            <span
              class="bf-q"
              title={n() === 1 ? "A question waits here" : `${n()} questions wait here`}
            >
              ?
            </span>
          )}
        </Show>
        <div
          class="bf-pic"
          style={
            component()
              ? { "max-height": `${w() * 2}px`, ...(f.poster ? {} : { height: `${w() / 2}px` }) }
              : { height: `${frameHeight(w())}px` }
          }
        >
          <Switch
            fallback={
              <span class="bf-ph">
                <span>{f.name}</span>
                <small>No still yet</small>
              </span>
            }
          >
            <Match when={f.missing || f.planned}>
              <span class="bf-ph">
                <span>{f.name}</span>
                <small>{f.missing ? "missing, not drawn" : "planned, not drawn"}</small>
              </span>
            </Match>
            <Match when={f.poster}>
              {(id) => (
                <img
                  src={assetUrl(id())}
                  alt=""
                  draggable={false}
                  decoding="async"
                  onLoad={settle}
                />
              )}
            </Match>
          </Switch>
        </div>
      </div>
    );
  };
  const chip = (text: string, cls = "") => <span class={`bchip ${cls}`}>{text}</span>;
  const sectionHead = (s: Section) => (
    <div class="bsec-hd">
      <span class="bsec-nm">{sectionTitle(s)}</span>
      <Switch>
        <Match when={s.kind === "flow" && s}>
          {(f) => (
            <>
              {chip("flow", "flow")}
              {chip(flowLine(flowCoverage(f())))}
              <button
                type="button"
                class="bchip bplay"
                title="Present this flow (P): → and ← walk it, R starts over, Esc ends"
                onClick={() => present(f())}
              >
                ▶ Present
              </button>
            </>
          )}
        </Match>
        <Match when={s.kind === "screen" && s}>
          {(sc) => (
            <Show when={designOf(sc().slug)?.status} keyed>
              {(w) => chip(w, statusClass(w))}
            </Show>
          )}
        </Match>
        <Match when={s.kind === "grid" && s}>
          {(g) => (
            <>
              {chip(g().grid.label, g().grid.idea ? "idea" : "")}
              <Show when={g().grid.live}>
                {(n) =>
                  chip(`${n()} ${g().grid.idea ? "alternative" : "variant"}${n() === 1 ? "" : "s"}`)
                }
              </Show>
              <Show when={g().grid.archived}>
                {(n) => (
                  <button
                    type="button"
                    class="bchip"
                    aria-expanded={archivedOn().has(g().id)}
                    onClick={() => {
                      touch();
                      setArchivedOn(flip(archivedOn(), g().id));
                    }}
                  >
                    {`${n()} archived ${archivedOn().has(g().id) ? "▾" : "▸"}`}
                  </button>
                )}
              </Show>
              <Show when={g().grid.live > FILTER_FROM}>
                <input
                  class="bfilter"
                  type="search"
                  placeholder="Filter by name or description"
                  aria-label={`Filter ${g().grid.title}`}
                  value={filters()[g().id] ?? ""}
                  onInput={(e) => setFilters({ ...filters(), [g().id]: e.currentTarget.value })}
                />
              </Show>
            </>
          )}
        </Match>
        <Match when={s.kind === "components" && s}>{(c) => chip(String(c().frames.length))}</Match>
        <Match when={s.kind === "planned"}>{chip("not drawn yet")}</Match>
      </Switch>
      <Show when={sectionAsks(s)}>
        {(n) => chip(n() === 1 ? "1 question" : `${n()} questions`, "q")}
      </Show>
      <Show when={unfoldable(s)}>
        {(slug) => (
          <Show when={ideasFor(slug()).length}>
            {(n) => (
              <button
                type="button"
                class="bchip idea"
                aria-expanded={unfolded().has(slug())}
                title={unfolded().has(slug()) ? "Fold the ideas away" : "Unfold its ideas under it"}
                onClick={() => {
                  touch();
                  setUnfolded(flip(unfolded(), slug()));
                }}
              >
                {`Ideas · ${n()} ${unfolded().has(slug()) ? "▴" : "▾"}`}
              </button>
            )}
          </Show>
        )}
      </Show>
    </div>
  );
  // By id, so a section a refetch changed keeps its element and only what changed in it
  // is drawn again.
  const sectionIds = createMemo(() => sections().map((x) => x.id), [], {
    equals: (a, b) => a.join("\n") === b.join("\n"),
  });
  const sectionById = createMemo(() => new Map(sections().map((x) => [x.id, x])));
  const sectionView = (id: string) => {
    const s = () => sectionById().get(id);
    const flow = () => {
      const x = s();
      return x?.kind === "flow" ? x : null;
    };
    const frames = () => {
      const x = s();
      return x && x.kind !== "flow" ? x.frames : [];
    };
    const grid = () => {
      const x = s();
      return x?.kind === "grid" ? x : null;
    };
    const cell = (alternative: string, state: string | null) =>
      frames().find((f) => f.alternative === alternative && f.state === state);
    const shownRows = () => {
      const names = new Set(frames().map((f) => f.alternative));
      return (grid()?.grid.rows ?? []).filter((n) => names.has(n));
    };
    const colName = (c: string | null) => c ?? grid()?.grid.title ?? "";
    const gridView = (g: () => Extract<Section, { kind: "grid" }>) => (
      <Show
        when={g().grid.aligned}
        fallback={
          <div class="bcols">
            <For each={g().grid.cols}>
              {(c) => (
                <Show when={frames().some((f) => f.state === c)}>
                  <div class="bcol">
                    <span class="bgrid-col">{colName(c)}</span>
                    <For each={frames().filter((f) => f.state === c)}>{frameView}</For>
                  </div>
                </Show>
              )}
            </For>
          </div>
        }
      >
        <div
          class="bgrid"
          style={{ "grid-template-columns": `auto repeat(${g().grid.cols.length}, auto)` }}
        >
          <span />
          <For each={g().grid.cols}>{(c) => <span class="bgrid-col">{colName(c)}</span>}</For>
          <For each={shownRows()}>
            {(name) => (
              <>
                <span class="bgrid-row">{name}</span>
                <For each={g().grid.cols}>
                  {(c) => (
                    <Show when={cell(name, c)} keyed fallback={<span />}>
                      {frameView}
                    </Show>
                  )}
                </For>
              </>
            )}
          </For>
        </div>
      </Show>
    );
    return (
      <section
        class="bsec"
        classList={{
          idea: !!grid()?.grid.idea,
          under: !!grid()?.under,
          writing: outlined().has(id),
        }}
        ref={(el) => {
          sectionEls.set(id, el);
          onCleanup(() => {
            if (sectionEls.get(id) === el) sectionEls.delete(id);
          });
        }}
      >
        <Show when={s()}>{(x) => sectionHead(x())}</Show>
        <Show
          when={flow()}
          fallback={
            <Show
              when={grid()}
              fallback={
                <div class="bframes">
                  <For each={frames()}>{frameView}</For>
                </div>
              }
            >
              {(g) => gridView(g)}
            </Show>
          }
        >
          {(f) => (
            <div class="bsteps">
              <Index each={f().steps}>
                {(x, i) => (
                  <>
                    <Show when={i > 0}>
                      <div
                        class="barrow"
                        aria-hidden="true"
                        style={{ height: `${frameHeight(widthOf(x().frame))}px` }}
                      >
                        →
                      </div>
                    </Show>
                    <div class="bstep">
                      <Show when={x().frame} keyed>
                        {frameView}
                      </Show>
                      <For each={x().below}>{frameView}</For>
                    </div>
                  </>
                )}
              </Index>
            </div>
          )}
        </Show>
      </section>
    );
  };

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

  const canvas = (): JSX.Element => (
    <div
      class="bstage"
      classList={{ space: space(), panning: panning() }}
      ref={(el) => (stage = el)}
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
        }}
      >
        <For each={sectionIds()}>{sectionView}</For>
        <Show when={data() && !sections().length && (!ideasPage() || nodes().size)}>
          <p class="bempty">
            {ideasPage() ? "No ideas to explore here." : "Nothing is drawn on this page yet."}
          </p>
        </Show>
      </div>
      <Show when={!hideUi()}>
        <div class="bcard" ref={(el) => (card = el)}>
          <h2>{pageName()}</h2>
          <Show
            when={ideasPage()}
            fallback={<Show when={data()?.description}>{(t) => <p>{t()}</p>}</Show>}
          >
            <p>Explorations, each for a product design or what it would become.</p>
            <div class="bcov">
              <span>
                <b>{sections().length}</b>
                {sections().length === 1 ? " idea" : " ideas"}
              </span>
              <span>
                <b>{ideaAsks()}</b>
                {ideaAsks() === 1 ? " question" : " questions"}
              </span>
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
                  <For each={coverageSummary(c())}>
                    {(p) => (
                      <span classList={{ m: !!p.missing }}>
                        <b>{p.n}</b>
                        {p.text}
                      </span>
                    )}
                  </For>
                  <Show when={tour() || changedFrames().length}>
                    <button
                      type="button"
                      class="bsince"
                      title="Fit to each frame changed since you last had it on screen"
                      onClick={step}
                    >
                      {sinceLine()}
                    </button>
                  </Show>
                  <Show when={c().states.length}>
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
                <Show when={mapOpen() && c().states.length}>
                  <CoverageMap coverage={c()} onCell={pickCell} onFlow={fitSection} />
                </Show>
              </>
            )}
          </Show>
        </div>
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
        <div class="bhint">
          <span>
            <kbd>dbl-click</kbd>/<kbd>↵</kbd> open
          </span>
          <span>
            <kbd>⇧1</kbd> fit page
          </span>
          <span>
            <kbd>⇧2</kbd> fit selection
          </span>
          <span>
            <kbd>Space</kbd>+drag or scroll to pan
          </span>
          <span>
            <kbd>⌘</kbd>+scroll or pinch to zoom
          </span>
          <span>
            <kbd>⌘/</kbd> hide UI
          </span>
        </div>
      </Show>
    </div>
  );

  return (
    <div class="screen boardscreen" classList={{ "board-bare": hideUi() }}>
      <Show when={!hideUi() && project()}>
        {(p) => (
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
            onFitSection={fitSection}
            onPickFrame={pickFrame}
          />
        )}
      </Show>
      <div class="board-main">
        <header class="board-top">
          <Show when={hideUi()}>
            <ProjectSwitcher current={project()} known={!noSuchProject()} projects={projects()} />
            <span class="sep">/</span>
          </Show>
          <b class="board-crumb">{props.sec && !ideasPage() ? secName(props.sec) : pageName()}</b>
          <span class="grow" />
          <Show when={onCanvas()}>
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
                {canvas()}
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

const MAP_KEY = "mockpit:board-map";
// "agent…" stays this long after the still lands, so a write that brings its own still is
// seen too, and gives up after the longest the poster worker could take.
const WRITING_MIN_MS = 1500;
const WRITING_MAX_MS = 60_000;
const OUTLINE_MS = 1800;

const CELL_CLASS: Record<Cell, string> = {
  Ready: "r",
  "In design": "d",
  Planned: "p",
  Missing: "m",
};
const stateName = (s: string | null) => s ?? "Single state";

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
                            const what = () => `${r.title} · ${stateName(state())}: ${x()}`;
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
              {x}
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

const statusClass = (w: string) => (w === "Ready" ? "ok" : w === "Changed" ? "changed" : "");

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
