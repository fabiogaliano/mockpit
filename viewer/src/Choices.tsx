// The Choices panel's list, under the open question if there is one: the state's
// alternatives, then each choice knob the frame on stage reads (choices.ts). Every group is
// the same thing: a heading that folds it, showing the current pick while folded, and a
// tile per value, which a mouse on it previews on the stage, a click picks, and its corner
// keeps or rules out. A colour with options is one row of swatches.

import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Index,
  type JSX,
  Show,
} from "solid-js";
import { isLive, recommendedAlternative } from "../../server/types.ts";
import { assetUrl } from "./api.ts";
import { ArchivedGhost } from "./ArchivedGhost.tsx";
import type { ChoiceGroup, Choices } from "./choices.ts";
import { knobGroup } from "./choices.ts";
import { canFrame, runFrameAction } from "./frameActions.ts";
import { createHold } from "./holdPreview.ts";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { ALTERNATIVES_GROUP, alternativeName, safeColor, type VersionStep } from "./logic.ts";
import type { DesignScreenState } from "./state.ts";
import { type CropBox, groupCrop } from "./stillCrop.ts";
import { posterShown } from "./systemRev.ts";

type Value = { value: string; label: string };

export function ChoicesList(props: { s: DesignScreenState; c: Choices }) {
  const c = props.c;
  return (
    <Show when={c.hasAlternatives() || c.paths().length}>
      <div class="chs">
        <Show when={c.hasAlternatives()}>
          <AlternativesGroup s={props.s} c={c} />
        </Show>
        <For each={c.paths()}>
          {(path) => (
            <Show when={c.group(path)}>
              {(g) => (
                <Show when={g().colour} fallback={<KnobGroup c={c} g={g()} />}>
                  <ColourRow c={c} g={g()} />
                </Show>
              )}
            </Show>
          )}
        </For>
      </div>
    </Show>
  );
}

// The dot that says a group is new to this browser.
const NewDot = () => (
  <i class="newdot" role="img" aria-label="New" title="New">
    {""}
  </i>
);

function GroupHead(props: {
  c: Choices;
  id: string;
  title: string;
  isNew: boolean;
  current: string;
  compare?: { on: () => void };
}) {
  const open = () => props.c.isOpen(props.id);
  return (
    <div class="chg-h">
      <button
        type="button"
        class="chg-fold"
        aria-expanded={open()}
        onClick={() => props.c.toggle(props.id)}
      >
        <b>{props.title}</b>
        <Show when={props.isNew}>
          <NewDot />
        </Show>
        <span class="chg-cur">{open() ? "" : props.current}</span>
      </button>
      <Show when={open() && props.compare}>
        {(cmp) => (
          <button type="button" class="chg-cmp" onClick={() => cmp().on()}>
            <Icon name="grid" />
            Compare
          </button>
        )}
      </Show>
      <button
        type="button"
        class="chg-chev"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => props.c.toggle(props.id)}
      >
        <Icon name={open() ? "up" : "down"} />
      </button>
    </div>
  );
}

// Keep and Rule out, in a tile's corner while the pointer is on it (always while kept).
function TileMarks(props: {
  label: string;
  kept: boolean;
  keep?: () => void;
  ruleOut?: () => void;
}) {
  return (
    <span class="cht-m">
      <Show when={props.keep}>
        {(keep) => (
          <button
            type="button"
            class="ib"
            classList={{ on: props.kept }}
            aria-pressed={props.kept}
            aria-label={`Keep ${props.label}`}
            title="Keep"
            onClick={(e) => {
              e.stopPropagation();
              keep()();
            }}
          >
            <Icon name="bookmark" />
          </button>
        )}
      </Show>
      <Show when={props.ruleOut}>
        {(out) => (
          <button
            type="button"
            class="ib"
            aria-label={`Rule out ${props.label}`}
            title="Rule out"
            onClick={(e) => {
              e.stopPropagation();
              out()();
            }}
          >
            <Icon name="close" />
          </button>
        )}
      </Show>
    </span>
  );
}

// A tile's picture is this wide per unit high, whatever it frames, so the tiles keep their
// size as their stills come in.
const TILE_RATIO = 5 / 2;

function KnobGroup(props: { c: Choices; g: ChoiceGroup }) {
  const c = props.c;
  const id = () => knobGroup(props.g.path);
  const open = () => c.isOpen(id());
  // Folded, a group asks for nothing; open, its stills go before any other.
  const cells = createMemo(() =>
    open() ? c.shown(props.g).map((v) => c.cellOf(props.g.path, v)?.still ?? null) : [],
  );
  createEffect(() => {
    for (const cell of cells()) if (cell && !c.stills.of(cell)) c.stills.want(cell, false, true);
  });
  const urls = () => cells().map((cell) => (cell ? c.stills.of(cell) : null));
  // Framed once every still is in (or won't be), so no tile re-frames as the others arrive.
  const settled = () =>
    cells().length > 0 && cells().every((cell, i) => !cell || !!urls()[i] || c.stills.failed(cell));
  const [crop] = createResource(
    () => (settled() ? urls().filter((u): u is string => !!u) : null),
    (list) => groupCrop(list, TILE_RATIO).then((box) => ({ box })),
  );
  const pictured = () => c.stills.capability() === "capture";
  return (
    <section class="chg" classList={{ shut: !open() }}>
      <GroupHead
        c={c}
        id={id()}
        title={props.g.label}
        isNew={c.isNew(props.g.path)}
        current={c.valueLabel(props.g)}
        compare={c.canCompare(props.g.path) ? { on: () => c.compare(props.g.path) } : undefined}
      />
      <Show when={open()}>
        <div class="chg-tiles">
          <Index each={c.shown(props.g)}>
            {(v, i) => (
              <KnobTile
                c={c}
                g={props.g}
                v={v()}
                pictured={pictured() && !!cells()[i]}
                url={crop() ? (urls()[i] ?? null) : null}
                crop={crop()?.box ?? null}
              />
            )}
          </Index>
        </div>
      </Show>
    </section>
  );
}

function KnobTile(props: {
  c: Choices;
  g: ChoiceGroup;
  v: Value;
  // A picture is coming: its place is kept until it does.
  pictured: boolean;
  url: string | null;
  crop: CropBox | null;
}) {
  const c = props.c;
  const path = () => props.g.path;
  return (
    <TileShell
      label={props.v.label}
      on={c.isPicked(path(), props.v.value)}
      kept={c.markOf(path(), props.v) === "keep"}
      onEnter={() => c.preview(props.g, props.v)}
      onLeave={() => c.unpreview(path(), props.v.value)}
      onPick={() => c.pick(path(), props.v.value)}
      marks={
        c.canMark(path(), props.v)
          ? { keep: () => c.keep(props.g, props.v), ruleOut: () => c.ruleOut(props.g, props.v) }
          : undefined
      }
    >
      <Show when={props.pictured || props.url}>
        <span class="cht-pic">
          <Show when={props.url}>
            {(u) => (
              <img
                src={u()}
                alt=""
                decoding="async"
                draggable={false}
                classList={{ framed: !!props.crop }}
                style={
                  props.crop
                    ? {
                        width: `${100 / props.crop.w}%`,
                        height: `${100 / props.crop.h}%`,
                        left: `${(-props.crop.x / props.crop.w) * 100}%`,
                        top: `${(-props.crop.y / props.crop.h) * 100}%`,
                      }
                    : undefined
                }
              />
            )}
          </Show>
        </span>
      </Show>
    </TileShell>
  );
}

type StillCell = NonNullable<NonNullable<ReturnType<Choices["cellOf"]>>["still"]>;

// An alternative in the values it wears, once a still of it is made: asked for as the
// Sheet's cells are, and nothing in its place until then.
function Still(props: { c: Choices; cell: StillCell }) {
  const src = () => props.c.stills.of(props.cell);
  createEffect(() => {
    if (!src()) props.c.stills.want(props.cell);
  });
  return <PosterPic url={src()} />;
}

function TileShell(props: {
  label: string;
  on: boolean;
  kept: boolean;
  title?: string;
  class?: string;
  onEnter: () => void;
  onLeave: () => void;
  onPick: () => void;
  marks?: { keep?: () => void; ruleOut?: () => void };
  hold?: JSX.HTMLAttributes<HTMLDivElement>;
  children?: JSX.Element;
  extra?: JSX.Element;
}) {
  return (
    <div
      class="cht-w"
      classList={{ kept: props.kept }}
      onPointerEnter={(e) => e.pointerType === "mouse" && props.onEnter()}
      onPointerLeave={(e) => e.pointerType === "mouse" && props.onLeave()}
      {...props.hold}
    >
      <button
        type="button"
        class={`cht ${props.class ?? ""}`}
        classList={{ on: props.on }}
        aria-pressed={props.on}
        title={props.title ?? props.label}
        disabled={readonly()}
        onClick={() => props.onPick()}
      >
        {props.children}
        <span class="cht-l">
          <span class="cht-name">{props.label}</span>
          {props.extra}
        </span>
      </button>
      <Show when={props.marks && (props.marks.keep || props.marks.ruleOut)}>
        <TileMarks
          label={props.label}
          kept={props.kept}
          keep={props.marks!.keep}
          ruleOut={props.marks!.ruleOut}
        />
      </Show>
    </div>
  );
}

function ColourRow(props: { c: Choices; g: ChoiceGroup }) {
  const c = props.c;
  return (
    <section class="chg row">
      <div class="chg-h">
        <span class="chg-title">
          <b>{props.g.label}</b>
          <Show when={c.isNew(props.g.path)}>
            <NewDot />
          </Show>
        </span>
        <span class="chg-sws" role="group" aria-label={props.g.label}>
          <For each={c.shown(props.g).filter((v) => safeColor(v.value))}>
            {(v) => (
              <button
                type="button"
                classList={{ on: c.isPicked(props.g.path, v.value) }}
                aria-pressed={c.isPicked(props.g.path, v.value)}
                aria-label={v.label}
                title={v.label}
                disabled={readonly()}
                style={{ "background-color": v.value }}
                onPointerEnter={(e) => e.pointerType === "mouse" && c.preview(props.g, v)}
                onPointerLeave={(e) =>
                  e.pointerType === "mouse" && c.unpreview(props.g.path, v.value)
                }
                onClick={() => c.pick(props.g.path, v.value)}
              />
            )}
          </For>
        </span>
      </div>
    </section>
  );
}

// Each alternative's newest version still shown, in the order the state lists them.
function newestOf(s: DesignScreenState, alternative: string): VersionStep | undefined {
  return s
    .steps()
    .filter((x) => x.alternative === alternative && !x.hidden)
    .at(-1);
}

// The state's alternatives, read as a question's answers are: a mouse on one previews it, a
// rest holds it on stage, a click makes it Main (where there is a Main to make; else it only
// goes on stage), and the agent's suggestion wears an answer's mark. Archived ones fold
// under "Archived · N" to bring back.
function AlternativesGroup(props: { s: DesignScreenState; c: Choices }) {
  const s = props.s;
  const c = props.c;
  const here = createMemo(() => s.alternatives().filter((v) => v.state === s.activeState()));
  const archived = () => here().filter((v) => !isLive(v.status));
  const [unfold, setUnfold] = createSignal(false);
  const used = () => s.inUse()?.alternative;
  const suggested = () => recommendedAlternative(s.design()?.asks ?? [], s.activeState());
  const title = () =>
    s.design()?.variants ? "Variants" : s.design()?.set ? "Set" : "Alternatives";
  return (
    <section class="chg" classList={{ shut: !c.isOpen(ALTERNATIVES_GROUP) }}>
      <GroupHead
        c={c}
        id={ALTERNATIVES_GROUP}
        title={title()}
        isNew={false}
        current={alternativeName(c.frame()?.alternative ?? "")}
        compare={c.alternativesCompare() ? { on: () => c.compareAlternatives() } : undefined}
      />
      <Show when={c.isOpen(ALTERNATIVES_GROUP)}>
        <div class="chg-tiles">
          {/* One just archived keeps its place a moment, as its ghost. */}
          <For each={here().filter((v) => isLive(v.status) || s.ghostOn(v.state, v.alternative))}>
            {(v) => {
              const step = () => newestOf(s, v.alternative);
              const key = () => `alternative:${v.alternative}`;
              // Without the preview: the tile under the pointer is not yet the one on stage.
              const onStage = () => s.alternativeFor(v.state, false)?.alternative === v.alternative;
              // Kept is the frame's own mark, not a value of it kept in a choice group.
              const mark = () =>
                s.frameMark(v.state, v.alternative) === "main"
                  ? "main"
                  : s.markOf({ state: v.state, alternative: v.alternative });
              const show = () => {
                const st = step();
                if (st) s.showVersion(st);
              };
              const hold = createHold({
                onEnter: () =>
                  s.setHoveredPreview({ key: key(), alternative: v.alternative, state: v.state }),
                onLeave: () => s.hoveredPreview()?.key === key() && s.setHoveredPreview(null),
                onHold: () => show,
                held: onStage,
              });
              // Its picture in the values it wears now: its poster while nothing of the
              // draft changes it, else (or with no poster) a still of it as it stands.
              const tuned = () => Object.keys(s.draft()?.tunedOn[v.alternative] ?? {}).length > 0;
              const poster = () => {
                const id = posterShown(step()?.poster);
                return id ? assetUrl(id) : null;
              };
              const cell = () =>
                tuned() || !poster()
                  ? s.sheet.cell(v, { key: "now", label: "", values: {} })?.still
                  : null;
              const canKeep = () => canFrame(s, "keep", { v });
              const canOut = () => canFrame(s, "delete", { v });
              return (
                <Show
                  when={!s.ghostOn(v.state, v.alternative)}
                  fallback={<ArchivedGhost s={s} line={s.ghost()!} />}
                >
                  <TileShell
                    label={alternativeName(v.alternative)}
                    class="alt"
                    on={mark() === "main"}
                    kept={mark() === "keep"}
                    title={
                      suggested() === v.alternative
                        ? ["Suggested by the agent", v.description].filter(Boolean).join(": ")
                        : v.description || alternativeName(v.alternative)
                    }
                    onEnter={() => undefined}
                    onLeave={() => undefined}
                    hold={hold.on}
                    onPick={() => {
                      hold.stop();
                      show();
                      runFrameAction(s, "main", { v });
                    }}
                    marks={{
                      keep: canKeep() ? () => runFrameAction(s, "keep", { v }) : undefined,
                      ruleOut: canOut() ? () => runFrameAction(s, "delete", { v }) : undefined,
                    }}
                    extra={
                      <Show when={used() === v.alternative}>
                        <small>In use</small>
                      </Show>
                    }
                  >
                    <span
                      class="cht-at"
                      classList={{ held: onStage(), resting: hold.resting() }}
                      aria-hidden="true"
                    />
                    <Show when={cell()} fallback={<PosterPic url={poster()} />}>
                      {(st) => <Still c={c} cell={st()} />}
                    </Show>
                    {/* One corner, one mark: once it is the Main, the suggestion has been
                        answered. */}
                    <Show
                      when={mark() === "main"}
                      fallback={
                        <Show when={suggested() === v.alternative}>
                          <i class="altp-pick" aria-hidden="true" />
                        </Show>
                      }
                    >
                      <i class="altp-main" aria-hidden="true">
                        <Icon name="star" />
                      </i>
                    </Show>
                    <span class="sr-only">
                      {[
                        onStage() ? "on stage" : "",
                        suggested() === v.alternative ? "suggested by the agent" : "",
                        mark() === "main" ? "Main" : mark() ? "kept" : "",
                      ]
                        .filter(Boolean)
                        .map((x) => `, ${x}`)
                        .join("")}
                    </span>
                  </TileShell>
                </Show>
              );
            }}
          </For>
        </div>
        <Show when={archived().length}>
          <button
            type="button"
            class="lm-fold"
            aria-expanded={unfold()}
            onClick={() => setUnfold(!unfold())}
          >
            {`Archived · ${archived().length}`}
          </button>
          <Show when={unfold()}>
            <For each={archived()}>
              {(v) => (
                <div class="lm-archived" title={v.archiveReason ?? v.description}>
                  <span>{alternativeName(v.alternative)}</span>
                  <Show when={!readonly()}>
                    <button
                      type="button"
                      class="vrestore"
                      onClick={() =>
                        void s
                          .restoreAlternative(v.alternative, [s.activeState()])
                          .then(() => s.setToast({ text: `Restored ${v.alternative}` }))
                      }
                    >
                      Restore
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </Show>
    </section>
  );
}

function PosterPic(props: { url: string | null }) {
  return (
    <Show when={props.url}>
      {(u) => (
        <span class="cht-pic">
          <img src={u()} alt="" loading="lazy" decoding="async" draggable={false} />
        </span>
      )}
    </Show>
  );
}
