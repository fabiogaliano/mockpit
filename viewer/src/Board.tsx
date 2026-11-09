// The Board: a project laid out as a designer's file is, one page per area, a section per
// flow (steps across, the screen's other states stacked under a step), then each screen's
// states in no flow, the components the page uses and what is planned. Every frame is its
// poster under its name, never a running page: live pages run only on the design's own
// screen, which Enter, a double-click or Open ↵ opens. Pan by dragging empty space, with
// Space held, or by scrolling; zoom with ⌘-scroll, a pinch or +/-; Shift 1 fits the page,
// Shift 2 the selection, Esc lets go of it, ⌘/ hides the rail and the cards.
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
import {
  api,
  assetUrl,
  type BoardFrame,
  type BoardPage,
  type BoardSection,
  subscribe,
} from "./api.ts";
import { sidebarOf } from "./albums.ts";
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
import { Home } from "./Home.tsx";
import { readHomeProjects, saveHomeProjects } from "./homeCache.ts";
import { host, root } from "./host.ts";
import { Icon } from "./icons.tsx";
import { keepSame, owedStates, rankedAreas } from "./logic.ts";
import { NotFound } from "./NotFound.tsx";
import { ProjectSwitcher } from "./ProjectSwitcher.tsx";
import {
  type BoardSel,
  boardPath,
  designPath,
  focusPath,
  type HomePlace,
  navigate,
  projectPath,
  type RecentShow,
  replaceUrl,
  rootPath,
} from "./route.ts";
import { setCarried } from "./carry.ts";
import { openJump } from "./Jump.tsx";

// A frame as the Board draws it: the server's, or a state the screen is still owed.
interface Frame extends BoardFrame {
  key: string;
  missing?: true;
}
type Section =
  | (Omit<Extract<BoardSection, { kind: "flow" }>, "steps"> & {
      steps: { frame: Frame; below: Frame[] }[];
    })
  | (Omit<Extract<BoardSection, { kind: "screen" }>, "frames"> & { frames: Frame[] })
  | { kind: "components" | "planned"; id: string; frames: Frame[] };

const frameKey = (slug: string, state: string | null, missing = false) =>
  JSON.stringify([slug, state, missing]);

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
  // A Send carried from a design ends here, as it did on Home.
  setCarried(null);
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
  const load = async (w: Want) => {
    const n = ++seq;
    try {
      const d = await api.board(w.p, { area: w.area, unsorted: !!w.unsorted, design: w.design });
      if (n !== seq) return;
      setFailed(null);
      setData(d);
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
    if (e.type.startsWith("post-")) refetchSoon();
    else if ("project" in e && e.type.startsWith("design-") && e.project === data()?.project)
      refetchSoon();
  });
  onCleanup(stop);

  // A link to a design lands here: on its page, or, for a design no page draws (an idea, a
  // document, a shared component), on the design itself. The address then names the page.
  createEffect(
    on(data, (d) => {
      if (!d || props.sec) return;
      const sel = untrack(() => props.sel);
      if (sel && d.onBoard === false) {
        navigate(
          focusPath(
            d.project,
            sel.slug,
            sel.state === undefined ? null : { state: sel.state, alternative: null },
          ),
          { replace: true },
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
    boardPath(d.project, { page: d.area, unsorted: d.area === null, sel });

  // The page's sections, with the states each screen is owed drawn as missing frames.
  const drawn = createMemo<Section[]>(() => {
    const d = data();
    if (!d) return [];
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
      const m = d.designs[s.slug];
      const owed = m?.outlinable ? owedStates(m) : [];
      const frames = [
        ...s.frames.map(withKey),
        ...owed.map((o): Frame => ({
          slug: s.slug,
          state: o.name,
          name: o.name,
          width: s.frames[0]?.width ?? null,
          key: frameKey(s.slug, o.name, true),
          missing: true,
        })),
      ];
      return frames.length ? [{ ...s, frames }] : [];
    });
  });
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
  const pageWidth = createMemo(() => allFrames().find((f) => f.width)?.width ?? DEFAULT_WIDTH);
  const widthOf = (f: Frame) => f.width ?? pageWidth();

  const selected = createMemo<Frame | null>(() => {
    const sel = props.sel;
    if (!sel) return null;
    return (
      allFrames().find(
        (f) =>
          f.slug === sel.slug && !f.missing && (sel.state === undefined || f.state === sel.state),
      ) ??
      allFrames().find((f) => f.slug === sel.slug && f.state === sel.state) ??
      null
    );
  });
  const select = (f: Frame | null) => {
    const d = data();
    if (!d) return;
    replaceUrl(here(d, f ? { slug: f.slug, state: f.state } : null));
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
    const next = fitView(
      box,
      { w: stage.clientWidth, h: stage.clientHeight },
      { pad: opts.pad ?? 60, frame: opts.frame },
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
        return d ? `${d.project}|${d.area}` : null;
      },
      (page) => {
        if (!page) return;
        touched = false;
        opened = true;
        host().window.requestAnimationFrame(settle);
      },
    ),
  );
  const settle = () => {
    if (touched || !opened) return;
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
      focusPath(
        d.project,
        f.slug,
        f.state === null || f.missing ? null : { state: f.state, alternative: null },
      ),
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
    navigate(
      `${designPath(d.project, first.slug, first.state === null ? null : { state: first.state, alternative: null }, f.name, null, true)}&present=1`,
    );
  };

  // Keys, while the canvas is what's shown.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || props.sec) return;
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
    if (target.closest(".bcard, .bselbar, .bhint, button, a")) return;
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
    if (target.closest(".bcard, .bselbar, .bhint, button, a")) return;
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
    if (!el || props.sec) return;
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
    const d = data();
    if (!d) return props.page ?? "";
    if (d.area !== null) return d.area;
    return d.pages.length ? "No area" : (d.project.split("/").pop() ?? d.project);
  };
  // Only this page's own designs count: a component from elsewhere is counted on its page.
  const ownDesigns = createMemo(() => {
    const d = data();
    if (!d) return [];
    return Object.values(d.designs).filter((m) =>
      d.area === null ? m.area === null && m.kind === "screen" : m.area === d.area,
    );
  });
  const coverage = createMemo(() => {
    const own = ownDesigns();
    const frames = allFrames();
    return {
      ready: own.filter((m) => m.status === "Ready").length,
      of: own.length,
      missing: frames.filter((f) => f.missing).length,
      planned: frames.filter((f) => f.planned).length,
      questions: own.reduce((n, m) => n + m.open, 0),
    };
  });

  const sectionTitle = (s: Section) => {
    if (s.kind === "flow") return s.name;
    if (s.kind === "screen") {
      const t = designOf(s.slug)?.title ?? s.slug;
      return s.inFlow ? `${t}, not in a flow` : t;
    }
    return s.kind === "components" ? "Components used here" : "Planned";
  };
  const sectionAsks = (s: Section) => {
    const slugs = new Set(
      s.kind === "screen" ? [s.slug] : s.kind === "flow" ? framesOf(s).map((f) => f.slug) : [],
    );
    return [...slugs].reduce((n, slug) => n + (designOf(slug)?.open ?? 0), 0);
  };
  const flowReady = (s: Extract<Section, { kind: "flow" }>) =>
    s.steps.filter((x) => designOf(x.frame.slug)?.status === "Ready" && !x.frame.planned).length;

  const layers = createMemo<RailLayer[]>(() =>
    sections().map((s) => ({
      id: s.id,
      kind: s.kind,
      name: sectionTitle(s),
      frames: (s.kind === "flow"
        ? s.steps.map((x, i) => ({ f: x.frame, label: `${i + 1}. ${x.frame.name}` }))
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
        <div class="bf-nm" title={f.name}>
          {f.name}
        </div>
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
              {chip(`flow · ${f().steps.length} steps`, "flow")}
              {chip(`${flowReady(f())} of ${f().steps.length} ready`)}
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
            <Show when={designOf(sc().slug)?.status}>{(w) => chip(w(), statusClass(w()))}</Show>
          )}
        </Match>
        <Match when={s.kind === "components" && s}>{(c) => chip(String(c().frames.length))}</Match>
        <Match when={s.kind === "planned"}>{chip("not drawn yet")}</Match>
      </Switch>
      <Show when={sectionAsks(s)}>
        {(n) => chip(n() === 1 ? "1 question" : `${n()} questions`, "q")}
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
    return (
      <section
        class="bsec"
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
            <div class="bframes">
              <For each={frames()}>{frameView}</For>
            </div>
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
    const m = designOf(f.slug);
    return m && f.name !== m.title ? `${m.title} · ${f.name}` : f.name;
  };
  const [copied, setCopied] = createSignal<string | null>(null);
  let copyTimer = 0;
  onCleanup(() => host().window.clearTimeout(copyTimer));
  const copyLink = () => {
    const d = data();
    const f = selected();
    if (!d || !f) return;
    const href = `${host().location.origin}${here(d, { slug: f.slug, state: f.state })}`;
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
        <Show when={data() && !sections().length}>
          <p class="bempty">Nothing is drawn on this page yet.</p>
        </Show>
      </div>
      <Show when={!hideUi()}>
        <div class="bcard">
          <h2>{pageName()}</h2>
          <Show when={data()?.description}>{(t) => <p>{t()}</p>}</Show>
          <Show when={data()}>
            <div class="bcov">
              <span>
                <b>{coverage().ready}</b>
                {` of ${coverage().of} ready`}
              </span>
              <Show when={coverage().missing}>
                <span class="m">
                  <b>{coverage().missing}</b>
                  {" missing"}
                </span>
              </Show>
              <Show when={coverage().planned}>
                <span>
                  <b>{coverage().planned}</b>
                  {" planned"}
                </span>
              </Show>
              <span>
                <b>{coverage().questions}</b>
                {coverage().questions === 1 ? " question" : " questions"}
              </span>
            </div>
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
            unsortedPage={data()?.project === p() && !!data()?.unsorted}
            onPage={props.sec ? null : data()?.project === p() ? (data()?.area ?? null) : null}
            onUnsorted={!props.sec && data()?.project === p() && data()?.area === null}
            sec={props.sec}
            questions={data()?.project === p() ? (data()?.questions ?? []) : []}
            library={libraryOf(tree())}
            layers={props.sec ? [] : layers()}
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
          <b class="board-crumb">{props.sec ? secName(props.sec) : pageName()}</b>
          <span class="grow" />
          <Show when={!props.sec}>
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
            when={props.sec}
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
                <Home project={project()} sec={sec()} show={props.show} for={props.for} />
              </div>
            )}
          </Show>
        </Show>
      </div>
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
