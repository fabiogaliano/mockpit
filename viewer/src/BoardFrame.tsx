// One frame on the Board: its poster under its name, never a running page, with the
// marks the page puts on it (changed since you were here, the agent publishing to it, its
// questions). On the canvas it is a frame at its width; on a phone a tile a tap opens.
// The page's state stays in Board.tsx and reaches a frame through FrameCtx.

import { type JSX, Match, Show, Switch } from "solid-js";
import { assetUrl, type BoardFrame, type BoardPage, type BoardSection } from "./api.ts";
import type { Grid } from "./boardGrid.ts";
import { frameHeight } from "./boardLayout.ts";
import { linkClick } from "./route.ts";

// A frame as the Board draws it: the server's, a state the screen is still owed, or one
// alternative's cell in a grid.
export interface Frame extends BoardFrame {
  key: string;
  missing?: true;
  alternative?: string;
  archived?: true;
}
export type Section =
  | (Omit<Extract<BoardSection, { kind: "flow" }>, "steps"> & {
      steps: { frame: Frame; below: Frame[] }[];
    })
  | (Omit<Extract<BoardSection, { kind: "screen" }>, "frames"> & { frames: Frame[] })
  | { kind: "components" | "planned"; id: string; frames: Frame[] }
  // An idea or a variants design; `under` is the product design it was unfolded from.
  // `more` alternatives wait past its first rows, and `folded` is their frames while they do.
  | {
      kind: "grid";
      id: string;
      grid: Grid;
      frames: Frame[];
      under: string | null;
      more: number;
      folded: Frame[];
    };

export type BoardQuestion = BoardPage["questions"][number];
export const questionsWord = (n: number) => (n === 1 ? "1 question" : `${n} questions`);

// The count of questions on a frame, and the way to the first of them.
export function QuestionBadge(props: { qs: BoardQuestion[]; path: string | null; title: string }) {
  const label = () =>
    props.qs.length === 1
      ? `Question on ${props.title}: ${props.qs[0]!.text}`
      : `${props.qs.length} questions on ${props.title}`;
  return (
    <Show
      when={props.path}
      fallback={
        <span class="bf-q" title={label()}>
          {props.qs.length}
        </span>
      }
    >
      {(path) => (
        <a
          class="bf-q"
          href={path()}
          title={label()}
          aria-label={label()}
          onClick={(e) => {
            e.stopPropagation();
            linkClick(e, path(), true);
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {props.qs.length}
        </a>
      )}
    </Show>
  );
}

// `at` tells apart the frames of one state a flow shows at two of its steps, or two flows do.
export const frameKey = (
  slug: string,
  state: string | null,
  missing = false,
  alternative?: string,
  at?: string,
) => JSON.stringify([slug, state, missing, alternative ?? null, ...(at ? [at] : [])]);

export const framesOf = (s: Section): Frame[] =>
  s.kind === "flow" ? s.steps.flatMap((x) => [x.frame, ...x.below]) : s.frames;

// A grid's frame at one alternative and state, and the rows its filter leaves.
export const cellIn = (frames: Frame[], alternative: string, state: string | null) =>
  frames.find((f) => f.alternative === alternative && f.state === state);
export const rowsIn = (grid: Grid, frames: Frame[]) => {
  const names = new Set(frames.map((f) => f.alternative));
  return grid.rows.filter((n) => names.has(n));
};
// A flow's steps are numbered as the canvas's arrows read them: 1, 2, 3, and the states
// stacked under a step 3b, 3c.
export const stepNumber = (i: number, below?: number) =>
  below === undefined ? String(i + 1) : `${i + 1}${String.fromCharCode(98 + below)}`;

// What a frame reads from the page it is on.
export interface FrameCtx {
  widthOf: (f: Frame) => number;
  designOf: (slug: string) => BoardPage["designs"][string] | undefined;
  // The frames a flow shows: there a step named after its screen still says which screen.
  flowKeys: () => ReadonlySet<string>;
  selected: () => Frame | null;
  writingOn: (f: Frame) => boolean;
  keepFrame: (key: string) => (el: HTMLElement) => void;
  isChanged: (f: Frame) => boolean;
  asksOn: () => ReadonlyMap<string, BoardQuestion[]>;
  pathOf: (q: BoardQuestion | undefined) => string | null;
  near: () => ReadonlySet<string>;
  settleSoon: () => void;
  open: (f: Frame | null) => void;
}

export function FrameView(props: { c: FrameCtx; f: Frame }) {
  const c = props.c;
  const f = props.f;
  const w = () => c.widthOf(f);
  const component = () => c.designOf(f.slug)?.kind === "component";
  // A screen's one unnamed state is called by the screen's name, which its section's
  // header already says.
  const named = () =>
    !!f.alternative || c.flowKeys().has(f.key) || f.name !== (c.designOf(f.slug)?.title ?? "");
  return (
    <div
      class="bf"
      classList={{
        sel: c.selected()?.key === f.key,
        planned: !!f.planned,
        missing: !!f.missing,
        cmp: component(),
        archived: !!f.archived,
        writing: c.writingOn(f),
      }}
      data-key={f.key}
      ref={c.keepFrame(f.key)}
      style={{ width: `${w()}px` }}
    >
      <div
        class="bf-nm"
        classList={{ quiet: !named() }}
        title={c.isChanged(f) ? `${f.name}, changed since you were here` : f.name}
      >
        <Show when={c.isChanged(f)}>
          <i class="bf-dot" aria-label="Changed since you were here" />
        </Show>
        <Show when={named()} fallback={<span class="sr-only">{f.name}</span>}>
          {f.name}
        </Show>
      </div>
      <Show when={c.writingOn(f)}>
        <span class="bf-agent" role="status">
          agent…
        </span>
      </Show>
      <Show when={c.asksOn().get(f.key)}>
        {(qs) => (
          <QuestionBadge
            qs={qs()}
            path={c.pathOf(qs()[0])}
            title={c.designOf(f.slug)?.title ?? f.name}
          />
        )}
      </Show>
      <div
        class="bf-pic"
        style={
          component()
            ? {
                "max-height": `${w() * 2}px`,
                "contain-intrinsic-size": `auto ${w()}px ${w() / 2}px`,
                ...(f.poster && c.near().has(f.key) ? {} : { height: `${w() / 2}px` }),
              }
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
              <small>{f.missing ? "Asked for" : "Planned"}</small>
            </span>
          </Match>
          <Match when={f.poster}>
            {(id) => (
              <Show when={c.near().has(f.key)}>
                <img
                  src={assetUrl(id())}
                  alt=""
                  draggable={false}
                  decoding="async"
                  loading="lazy"
                  onLoad={c.settleSoon}
                />
              </Show>
            )}
          </Match>
        </Switch>
      </div>
    </div>
  );
}

// --- a phone's rows ---
// A frame as a still a finger can take in at once; a tap opens it.
export function TileView(props: { c: FrameCtx; f: Frame; label?: JSX.Element }) {
  const c = props.c;
  const f = props.f;
  const component = () => c.designOf(f.slug)?.kind === "component";
  return (
    <button
      type="button"
      class="ptile"
      classList={{
        cmp: component(),
        wide: !component() && c.widthOf(f) >= 700,
        missing: !!f.missing,
        planned: !!f.planned,
        archived: !!f.archived,
        sel: c.selected()?.key === f.key,
        writing: c.writingOn(f),
      }}
      data-key={f.key}
      ref={c.keepFrame(f.key)}
      title={c.isChanged(f) ? `${f.name}, changed since you were here` : f.name}
      onClick={() => c.open(f)}
    >
      <span class="ptile-pic">
        <Switch
          fallback={
            <span class="bf-ph">
              <small>No still yet</small>
            </span>
          }
        >
          <Match when={f.missing || f.planned}>
            <span class="bf-ph">
              <small>{f.missing ? "Asked for" : "Planned"}</small>
            </span>
          </Match>
          <Match when={f.poster}>
            {(id) => (
              <img src={assetUrl(id())} alt="" draggable={false} decoding="async" loading="lazy" />
            )}
          </Match>
        </Switch>
        <Show when={c.asksOn().get(f.key)}>
          {(qs) => (
            <QuestionBadge
              qs={qs()}
              path={c.pathOf(qs()[0])}
              title={c.designOf(f.slug)?.title ?? f.name}
            />
          )}
        </Show>
        <Show when={c.writingOn(f)}>
          <span class="bf-agent" role="status">
            agent…
          </span>
        </Show>
      </span>
      <span class="ptile-nm">
        <Show when={c.isChanged(f)}>
          <i class="bf-dot" aria-label="Changed since you were here" />
        </Show>
        {props.label ?? f.name}
      </span>
    </button>
  );
}
