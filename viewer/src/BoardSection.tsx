// One section of a Board page: its header (status, counts, the way to its questions, its
// ideas folded under it) and its frames, a flow's steps across, a grid's alternatives down,
// or a phone's row a finger swipes. The page's state stays in Board.tsx and reaches a
// section through SectionCtx.

import { For, Index, type JSX, Match, Show, Switch } from "solid-js";
import { flowLine } from "../../server/coverage.ts";
import type { TreeNode } from "./api.ts";
import { FILTER_FROM } from "./boardGrid.ts";
import { frameHeight } from "./boardLayout.ts";
import {
  cellIn,
  type Frame,
  type FrameCtx,
  FrameView,
  questionsWord,
  rowsIn,
  type Section,
  stepNumber,
  TileView,
} from "./BoardFrame.tsx";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { linkClick } from "./route.ts";
import { phoneLayout } from "./viewport.ts";

export const statusClass = (w: string) => (w === "Ready" ? "ok" : w === "Changed" ? "changed" : "");

// What a section reads from the page it is on, and the switches it flips there.
export interface SectionCtx extends FrameCtx {
  sectionById: () => ReadonlyMap<string, Section>;
  outlined: () => ReadonlySet<string>;
  keepSection: (id: string) => (el: HTMLElement) => void;
  sectionTitle: (s: Section) => string;
  flowCoverage: (s: Extract<Section, { kind: "flow" }>) => { ready: number; steps: number };
  present: (flow?: Extract<Section, { kind: "flow" }>) => void;
  suggestedOf: (slug: string) => string[];
  askState: (slug: string, name: string) => Promise<void>;
  dropSuggested: (slug: string) => Promise<void>;
  sectionAsks: (s: Section) => number;
  firstQuestion: (s: Section) => string | null;
  unfoldable: (s: Section) => string | null;
  ideasFor: (slug: string) => TreeNode[];
  unfolded: () => ReadonlySet<string>;
  setUnfolded: (v: ReadonlySet<string>) => void;
  archivedOn: () => ReadonlySet<string>;
  setArchivedOn: (v: ReadonlySet<string>) => void;
  whole: () => ReadonlySet<string>;
  setWhole: (v: ReadonlySet<string>) => void;
  filters: () => Record<string, string>;
  setFilters: (v: Record<string, string>) => void;
  touch: () => void;
}

export const flip = (set: ReadonlySet<string>, id: string) => {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
};

// Read when drawn and again as they change, so a refetch's words reach a header in place.
const chip = (text: () => string, cls: () => string = () => "") => (
  <span class={`bchip ${cls()}`}>{text()}</span>
);
// The section as one kind, for a header's Match.
const asKind = <K extends Section["kind"]>(x: Section, kind: K) =>
  x.kind === kind ? (x as Section & { kind: K }) : false;

// An accessor, so a refetch's counts, statuses and titles reach the header it already drew.
function SectionHead(props: { c: SectionCtx; s: () => Section }) {
  const c = props.c;
  const s = props.s;
  return (
    <div class="bsec-hd">
      <span class="bsec-nm">{c.sectionTitle(s())}</span>
      <Switch>
        <Match when={asKind(s(), "flow")}>
          {(f) => (
            <>
              {chip(
                () => "flow",
                () => "flow",
              )}
              <Show when={f().status}>{(w) => chip(w, () => statusClass(w()))}</Show>
              {chip(() => flowLine(c.flowCoverage(f())))}
              <button
                type="button"
                class="bchip bplay"
                title="Present (P)"
                onClick={() => c.present(f())}
              >
                ▶ Present
              </button>
            </>
          )}
        </Match>
        <Match when={asKind(s(), "screen")}>
          {(sc) => (
            <>
              <Show when={c.designOf(sc().slug)?.status}>
                {(w) => chip(w, () => statusClass(w()))}
              </Show>
              <Show when={!readonly() && c.suggestedOf(sc().slug).length}>
                <span class="bsugg" role="group" aria-label="States it may need">
                  <span class="bsugg-l">Add</span>
                  <For each={c.suggestedOf(sc().slug)}>
                    {(name) => (
                      <button
                        type="button"
                        title="Ask to draw"
                        onClick={() => void c.askState(sc().slug, name)}
                      >
                        {name}
                      </button>
                    )}
                  </For>
                  <button
                    type="button"
                    class="bsugg-x"
                    aria-label="Archive these"
                    title="Archive"
                    onClick={() => void c.dropSuggested(sc().slug)}
                  >
                    <Icon name="close" />
                  </button>
                </span>
              </Show>
            </>
          )}
        </Match>
        <Match when={asKind(s(), "grid")}>
          {(g) => (
            <>
              {chip(
                // Unfolded under its design, an idea's target is the section above it.
                () => (g().under && g().grid.idea ? "Idea" : g().grid.label),
                () => (g().grid.idea ? "idea" : ""),
              )}
              <Show when={!g().grid.idea && c.designOf(g().grid.slug)?.status}>
                {(w) => chip(w, () => statusClass(w()))}
              </Show>
              <Show when={!phoneLayout() && g().grid.live}>
                {(n) =>
                  chip(
                    () =>
                      `${n()} ${g().grid.idea ? "alternative" : "variant"}${n() === 1 ? "" : "s"}`,
                  )
                }
              </Show>
              <Show when={g().more || c.whole().has(g().id)}>
                <button
                  type="button"
                  class="bchip"
                  aria-expanded={c.whole().has(g().id)}
                  title={c.whole().has(g().id) ? "Show only the first rows" : "Show every row"}
                  onClick={() => {
                    c.touch();
                    c.setWhole(flip(c.whole(), g().id));
                  }}
                >
                  {c.whole().has(g().id) ? "Show fewer" : `Show ${g().more} more`}
                </button>
              </Show>
              <Show when={g().grid.archived}>
                {(n) => (
                  <button
                    type="button"
                    class="bchip"
                    aria-expanded={c.archivedOn().has(g().id)}
                    onClick={() => {
                      c.touch();
                      c.setArchivedOn(flip(c.archivedOn(), g().id));
                    }}
                  >
                    {c.archivedOn().has(g().id) ? "Hide archived" : `Show ${n()} archived`}
                  </button>
                )}
              </Show>
              <Show when={g().grid.live > FILTER_FROM}>
                <input
                  class="bfilter"
                  type="search"
                  placeholder="Filter"
                  aria-label={`Filter ${g().grid.title}`}
                  value={c.filters()[g().id] ?? ""}
                  onInput={(e) => c.setFilters({ ...c.filters(), [g().id]: e.currentTarget.value })}
                />
              </Show>
            </>
          )}
        </Match>
        <Match when={asKind(s(), "components")}>
          {(x) => chip(() => String(x().frames.length))}
        </Match>
      </Switch>
      <Show when={c.sectionAsks(s())}>
        {(n) => (
          <Show
            when={c.firstQuestion(s())}
            fallback={chip(
              () => questionsWord(n()),
              () => "q",
            )}
          >
            {(path) => (
              <a
                class="bchip q"
                href={path()}
                title="Answer in Focus"
                onClick={(e) => linkClick(e, path(), true)}
              >
                {questionsWord(n())}
              </a>
            )}
          </Show>
        )}
      </Show>
      <Show when={c.unfoldable(s())}>
        {(slug) => (
          <Show when={c.ideasFor(slug()).length}>
            {(n) => (
              <button
                type="button"
                class="bchip idea"
                aria-expanded={c.unfolded().has(slug())}
                title={
                  c.unfolded().has(slug()) ? "Fold the ideas away" : "Unfold its ideas under it"
                }
                onClick={() => {
                  c.touch();
                  c.setUnfolded(flip(c.unfolded(), slug()));
                }}
              >
                {`${n()} ${n() === 1 ? "idea" : "ideas"} ${c.unfolded().has(slug()) ? "▴" : "▾"}`}
              </button>
            )}
          </Show>
        )}
      </Show>
    </div>
  );
}

export function SectionView(props: { c: SectionCtx; id: string }) {
  const c = props.c;
  const id = props.id;
  const s = () => c.sectionById().get(id);
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
  const cell = (alternative: string, state: string | null) => cellIn(frames(), alternative, state);
  const shownRows = () => {
    const g = grid();
    return g ? rowsIn(g.grid, frames()) : [];
  };
  const colName = (col: string | null) => col ?? grid()?.grid.title ?? "";
  const frameView = (f: Frame) => <FrameView c={c} f={f} />;
  const gridView = (g: () => Extract<Section, { kind: "grid" }>) => (
    <Show
      when={g().grid.aligned}
      fallback={
        <div class="bcols">
          <For each={g().grid.cols}>
            {(col) => (
              <Show when={frames().some((f) => f.state === col)}>
                <div class="bcol">
                  <span class="bgrid-col">{colName(col)}</span>
                  <For each={frames().filter((f) => f.state === col)}>{frameView}</For>
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
        <For each={g().grid.cols}>{(col) => <span class="bgrid-col">{colName(col)}</span>}</For>
        <For each={shownRows()}>
          {(name) => (
            <>
              <span class="bgrid-row">{name}</span>
              <For each={g().grid.cols}>
                {(col) => (
                  <Show when={cell(name, col)} keyed fallback={<span />}>
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
        writing: c.outlined().has(id),
      }}
      ref={c.keepSection(id)}
    >
      <Show when={s()}>{(x) => <SectionHead c={c} s={x} />}</Show>
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
                      style={{ height: `${frameHeight(c.widthOf(x().frame))}px` }}
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
}

// A section as the canvas has it, its frames in one row that snaps frame by frame; a
// grid a row per alternative (or per state, where its alternatives don't line up).
export function RowSection(props: { c: SectionCtx; id: string }) {
  const c = props.c;
  const id = props.id;
  const s = () => c.sectionById().get(id);
  const flow = () => {
    const x = s();
    return x?.kind === "flow" ? x : null;
  };
  const grid = () => {
    const x = s();
    return x?.kind === "grid" ? x : null;
  };
  const frames = () => {
    const x = s();
    return x && x.kind !== "flow" ? x.frames : [];
  };
  const colName = (col: string | null) => col ?? grid()?.grid.title ?? "";
  const numbered = (n: string, f: Frame): JSX.Element => (
    <>
      <i>{n}</i>
      {f.name}
    </>
  );
  return (
    <section
      class="psec"
      classList={{ idea: !!grid()?.grid.idea, writing: c.outlined().has(id) }}
      ref={c.keepSection(id)}
    >
      <Show when={s()}>{(x) => <SectionHead c={c} s={x} />}</Show>
      <Switch
        fallback={
          <div class="prow">
            <For each={frames()}>{(f) => <TileView c={c} f={f} />}</For>
          </div>
        }
      >
        <Match when={flow()}>
          {(fl) => (
            <div class="prow">
              <Index each={fl().steps}>
                {(x, i) => (
                  <>
                    <Show when={x().frame} keyed>
                      {(fr) => <TileView c={c} f={fr} label={numbered(stepNumber(i), fr)} />}
                    </Show>
                    <For each={x().below}>
                      {(b, j) => <TileView c={c} f={b} label={numbered(stepNumber(i, j()), b)} />}
                    </For>
                  </>
                )}
              </Index>
            </div>
          )}
        </Match>
        <Match when={grid()}>
          {(g) => (
            <Show
              when={g().grid.aligned}
              fallback={
                <For each={g().grid.cols}>
                  {(col) => (
                    <Show when={frames().some((f) => f.state === col)}>
                      <div class="palt">{colName(col)}</div>
                      <div class="prow">
                        <For each={frames().filter((f) => f.state === col)}>
                          {(f) => <TileView c={c} f={f} label={f.alternative} />}
                        </For>
                      </div>
                    </Show>
                  )}
                </For>
              }
            >
              <For each={rowsIn(g().grid, frames())}>
                {(name) => (
                  <>
                    <div class="palt">{name}</div>
                    <div class="prow">
                      <For each={g().grid.cols}>
                        {(col) => (
                          <Show when={cellIn(frames(), name, col)} keyed>
                            {(f) => <TileView c={c} f={f} label={colName(col)} />}
                          </Show>
                        )}
                      </For>
                    </div>
                  </>
                )}
              </For>
            </Show>
          )}
        </Match>
      </Switch>
    </section>
  );
}
