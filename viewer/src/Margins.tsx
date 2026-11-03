// The open screen's sides. States and versions stand on the left of the design and
// what's said about it on the right, each only with something in it, so a plain
// render is the design alone. When a margin would shrink the design past what
// marginLayout allows it stops standing there: its tab opens it floating over the
// canvas instead, which stays the size it was. The centre only reads the bands they
// take (--canvas-l, --canvas-r, canvasBox), so it needn't be the stage.

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  type JSX,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import { assetUrl, surfaceUrl } from "./api.ts";
import { BuiltFrom } from "./BuiltFrom.tsx";
import type { FlowNav } from "./flowNav.ts";
import { host, readonly } from "./host.ts";
import { Icon, type IconName } from "./icons.tsx";
import {
  BOARD_GAP,
  BOARD_PAD,
  boardWidths,
  commentPlace,
  GHOST_W,
  isBuiltinAsk,
  LEFT_MARGIN_W,
  marginLayout,
  RIGHT_MARGIN_W,
  sameVersion,
  TOOL_BAND_W,
  variantName,
  type VersionStep,
} from "./logic.ts";
import { Notes, notesShown } from "./Notes.tsx";
import { OutlineRows } from "./Outlines.tsx";
import { QuestionCard } from "./QuestionCard.tsx";
import { Answered } from "./Questions.tsx";
import { REACTION_LABEL } from "./reactionRules.ts";
import type { MockScreenState } from "./state.ts";
import { theme } from "./theme.ts";
import { Thread } from "./Thread.tsx";
import { Thumb } from "./Thumb.tsx";
import type { TuneState } from "./tune.ts";
import { CanvasTools } from "./VersionBar.tsx";
import { NO_BOX, safeX, setCanvasBox, win } from "./viewport.ts";

export type Side = "talk" | "notes" | "built" | "thread";
export type Margins = ReturnType<typeof createMargins>;

// Past this many a list is names alone: every picture is a whole page loading, and
// a lab has over a hundred. Comparing that many is Studio's work anyway.
const PICTURED_UP_TO = 24;

export function createMargins(
  s: MockScreenState,
  nav: FlowNav,
  active: () => boolean,
  // A reading column is what the margins have to leave room for, instead of artboards.
  columnW: () => number | null,
  // A screen whose states can still grow lists them even with only the one so far.
  outlining: () => boolean,
) {
  const [folded, setFolded] = createSignal(false);
  const [over, setOver] = createSignal(false);
  // Opened by hand with only sent answers in it, which never open it themselves.
  const [pinned, setPinned] = createSignal(false);

  const walkable = () => (nav.steps().length > 1 || nav.emptied().length > 0) && nav.at() >= 0;
  const statesShown = () => walkable() || (outlining() && nav.at() >= 0);
  const leftHas = () => statesShown() || s.steps().length > 1;
  const page = () => {
    const kinds: readonly string[] =
      s.stageStep()?.kinds ?? s.activeVariant()?.surfaces.map((x) => String(x.kind)) ?? [];
    return kinds.includes("html");
  };

  const closed = () => !!s.mock()?.closedAt;
  const talkWants = () => !closed() && (!!s.curAsk() || s.sendable());
  const talkHas = () => talkWants() || s.flow().length > 0 || s.closedAsks("state").length > 0;
  const builtHas = () => s.tunable().length > 0 || !!s.activeVariant()?.embedsKey;
  const side = createMemo<Side | null>(() => {
    if (s.drawer()) return "built";
    if (s.panel() === "thread") return "thread";
    if (s.panel() === "notes") return "notes";
    if (s.cardMin()) return null;
    return talkWants() || (pinned() && talkHas()) ? "talk" : null;
  });

  const boards = () => boardWidths(s.mock()?.widths ?? [], s.frameW(), s.allWidths(), false);
  const fitWith = (left: boolean) => {
    const row = boards();
    return marginLayout({
      winW: win().w - safeX(),
      designW: columnW() ?? row.reduce((sum, w) => sum + w, 0) + BOARD_GAP * (row.length - 1),
      tools: page() || leftHas(),
      left,
      right: side() !== null,
    });
  };
  const fit = createMemo(() =>
    active() ? fitWith(leftHas() && !folded()) : { left: false, right: false },
  );
  const leftDocked = () => fit().left;
  const rightDocked = () => fit().right;
  const leftTab = () => active() && leftHas() && !leftDocked();
  const leftFloats = () => leftTab() && over();
  const stripW = () =>
    active() && (page() || s.tunable().length > 0 || leftTab()) ? TOOL_BAND_W : 0;
  const band = () => ({
    left: leftDocked() ? LEFT_MARGIN_W : 0,
    right: rightDocked() ? RIGHT_MARGIN_W : 0,
  });
  // The neighbouring steps never cost the design its size; a row of artboards
  // would run under them.
  const ghosts = () =>
    active() &&
    walkable() &&
    boards().length === 1 &&
    win().w - safeX() - band().left - band().right - stripW() - 2 * BOARD_PAD - 2 * GHOST_W >=
      s.frameW();

  createEffect(() => {
    if (!active()) return setCanvasBox(NO_BOX);
    const floats = side() !== null && !rightDocked();
    setCanvasBox({ ...band(), over: floats ? RIGHT_MARGIN_W + 16 : 0 });
  });
  onCleanup(() => setCanvasBox(NO_BOX));
  // Standing again, it isn't floating, nor will it when it next stops standing.
  createEffect(() => {
    if (leftDocked()) setOver(false);
  });
  // Only a phone's version label opens the history.
  createEffect(() => {
    if (active() && s.panel() === "history") s.setPanel(null);
  });
  // A comment just left shows where it can be read back and sent.
  createEffect(
    on(
      () => s.draft()?.comments.length ?? 0,
      (n, was) => {
        if (was !== undefined && n > was) s.setCardMin(false);
      },
    ),
  );

  function toggleLeft() {
    if (leftDocked()) return void setFolded(true);
    if (over()) return void setOver(false);
    setFolded(false);
    if (!fitWith(true).left) setOver(true);
  }
  function closeLeft() {
    if (over()) setOver(false);
    else setFolded(true);
  }
  function closeSide() {
    const at = side();
    if (at === "built") {
      if (s.tool() === "tune") s.toggleTool("tune");
      else s.setDrawer(false);
    } else if (at === "thread" || at === "notes") s.setPanel(null);
    else {
      setPinned(false);
      s.setCardMin(true);
    }
  }
  function toggleSide(to: Side) {
    if (side() === to) return closeSide();
    if (to === "built") {
      s.setPanel(null);
      s.setDrawer(true);
    } else if (to === "thread" || to === "notes") {
      if (s.tool() === "tune") s.toggleTool("tune");
      s.setDrawer(false);
      s.setPanel(to);
    } else {
      s.showTalk();
      if (!s.curAsk() && s.flow().length) s.goOwed();
      else setPinned(true);
    }
  }

  return {
    active,
    walkable,
    outlining,
    statesShown,
    page,
    talkHas,
    builtHas,
    side,
    closed,
    leftDocked,
    rightDocked,
    leftTab,
    leftFloats,
    stripW,
    band,
    ghosts,
    toggleLeft,
    closeLeft,
    closeSide,
    toggleSide,
  };
}

// Try, Comment and Tune, left of the design. They change what a tap on it does, so
// they stay by it, and the left margin's tab rides with them while it is folded.
export function ToolStrip(props: { s: MockScreenState; m: Margins }) {
  const s = props.s;
  const m = props.m;
  const tools = () => m.page() || s.tunable().length > 0;
  return (
    <Show when={m.stripW() > 0}>
      <div class="toolstrip" role="toolbar" aria-label="Tools">
        <Show when={m.leftTab()}>
          <button
            type="button"
            class="ib"
            classList={{ on: m.leftFloats() }}
            aria-expanded={m.leftFloats()}
            aria-label="States and versions"
            title="States and versions"
            onClick={() => m.toggleLeft()}
          >
            <Icon name="versions" />
          </button>
          <Show when={tools()}>
            <span class="toolstrip-sep" />
          </Show>
        </Show>
        <CanvasTools s={s} page={m.page()} />
      </div>
    </Show>
  );
}

const PANELS: { id: Side; icon: IconName; label: string }[] = [
  { id: "talk", icon: "question", label: "On this design" },
  { id: "notes", icon: "notes", label: "Notes" },
  { id: "built", icon: "layers", label: "Built from" },
  { id: "thread", icon: "thread", label: "Thread" },
];

// The right margin's tabs live in the top bar, where they cost the design nothing
// and stay put whether the margin stands, floats or is shut.
export function PanelTabs(props: { s: MockScreenState; m: Margins }) {
  const s = props.s;
  const m = props.m;
  const shown = () =>
    PANELS.filter((p) =>
      p.id === "talk"
        ? m.talkHas()
        : p.id === "built"
          ? m.builtHas()
          : p.id === "notes"
            ? notesShown(s)
            : true,
    );
  const asked = () =>
    new Set(s.flow().flatMap((e) => (isBuiltinAsk(e.ask) ? [] : [e.ask.id]))).size;
  const label = (p: (typeof PANELS)[number]) =>
    p.id === "talk" && asked() ? `${p.label}, ${asked()} open` : p.label;
  // Something there the user hasn't got in front of them.
  const waiting = (p: (typeof PANELS)[number]) =>
    p.id === "talk" && m.side() !== "talk" && !m.closed() && (asked() > 0 || s.sendable());
  return (
    <div class="mtabs" role="group" aria-label="Panels">
      <For each={shown()}>
        {(p) => (
          <button
            type="button"
            class="ib"
            classList={{ on: m.side() === p.id }}
            aria-pressed={m.side() === p.id}
            aria-label={label(p)}
            title={label(p)}
            onClick={() => m.toggleSide(p.id)}
          >
            <Icon name={p.icon} />
            <Show when={waiting(p)}>
              <span class="mtab-dot" aria-hidden="true" />
            </Show>
          </button>
        )}
      </For>
    </div>
  );
}

export function LeftMargin(props: { s: MockScreenState; nav: FlowNav; m: Margins }) {
  const s = props.s;
  const m = props.m;
  return (
    <Show when={m.leftDocked() || m.leftFloats()}>
      <aside class="lmargin" classList={{ float: m.leftFloats() }} aria-label="States and versions">
        <button
          type="button"
          class="ib lm-close"
          aria-label="Fold states and versions"
          title="Fold"
          onClick={() => m.closeLeft()}
        >
          <Icon name="close" />
        </button>
        <Show when={m.statesShown()}>
          <StateList s={s} nav={props.nav} outlining={m.outlining()} />
        </Show>
        <Show when={s.steps().length > 1}>
          <VersionList s={s} />
        </Show>
      </aside>
    </Show>
  );
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

// The steps, as the flow bar has them. By key, not object: the steps are rebuilt on
// every read, and remounting a row would start its picture's page over.
function StateList(props: { s: MockScreenState; nav: FlowNav; outlining: boolean }) {
  const s = props.s;
  const nav = props.nav;
  const keyOf = (x: { mock: string; state: string | null }) => JSON.stringify([x.mock, x.state]);
  const keys = createMemo(() => nav.steps().map(keyOf), [], { equals: sameList });
  const pictured = () => nav.steps().length <= PICTURED_UP_TO;
  const flat = () => s.frameW() > 600;
  let list!: HTMLElement;
  createEffect(() => {
    nav.at();
    host().window.requestAnimationFrame(() =>
      list?.querySelector("[aria-current]")?.scrollIntoView({ block: "nearest" }),
    );
  });
  return (
    <section class="lm-sec" ref={(el) => (list = el)}>
      <h3>{nav.flow() ? nav.name() : "States"}</h3>
      <For each={keys()}>
        {(key) => {
          const [mock, state] = JSON.parse(key) as [string, string | null];
          const x = { mock, state };
          const here = () => keyOf(nav.steps()[nav.at()] ?? { mock: "", state: null }) === key;
          return (
            <button
              type="button"
              class="lm-row"
              classList={{ on: here() }}
              aria-current={here() ? "step" : undefined}
              aria-label={
                nav.owes(x)
                  ? `${nav.label(x)}, a question is waiting`
                  : nav.planned(x)
                    ? `${nav.label(x)}, planned`
                    : nav.label(x)
              }
              onClick={() => nav.go(x)}
            >
              <Show when={pictured()}>
                <span class="lm-pic" classList={{ flat: flat(), "lm-dash": nav.planned(x) }}>
                  <Show when={nav.picture(x)}>
                    {(u) => <Thumb src={u()} width={s.frameW()} fit whole />}
                  </Show>
                </span>
              </Show>
              <span class="lm-text">
                <b>{nav.label(x)}</b>
                <Show when={nav.planned(x)}>
                  <small>Planned</small>
                </Show>
              </span>
              <Show when={nav.owes(x)}>
                <i class="ftab-q" aria-hidden="true" />
              </Show>
            </button>
          );
        }}
      </For>
      {/* The way back to what they hold: each state's archive sits in its own Studio. */}
      <Show when={nav.emptied().length}>
        <select
          class="ftab-emptied lm-emptied"
          aria-label="States with everything archived"
          title="States with everything archived"
          value=""
          onChange={(e) => {
            const to = e.currentTarget.value;
            e.currentTarget.value = "";
            if (to) nav.go({ mock: nav.here().mock, state: to });
          }}
        >
          <option value="">{`${nav.emptied().length} empty`}</option>
          <For each={nav.emptied()}>{(m) => <option value={m ?? ""}>{m}</option>}</For>
        </select>
      </Show>
      <Show when={props.outlining}>
        <OutlineRows s={s} />
      </Show>
    </section>
  );
}

// One line per variant, newest first; each version names what prompted it.
function VersionList(props: { s: MockScreenState }) {
  const s = props.s;
  const lines = createMemo(() => [...new Set([...s.steps()].reverse().map((x) => x.variant))], [], {
    equals: sameList,
  });
  const inLine = (variant: string) =>
    s
      .steps()
      .filter((x) => x.variant === variant)
      .reverse();
  return (
    <section class="lm-sec">
      <h3>Versions</h3>
      <For each={lines()}>
        {(variant) => (
          <>
            <Show when={lines().length > 1}>
              <span class="lm-line" title={variant}>
                {variantName(variant)}
              </span>
            </Show>
            <For each={inLine(variant)}>{(step) => <VersionRow s={s} step={step} />}</For>
          </>
        )}
      </For>
    </section>
  );
}

function VersionRow(props: { s: MockScreenState; step: VersionStep }) {
  const s = props.s;
  const on = () => sameVersion(props.step, s.onStage());
  const current = () => sameVersion(props.step, s.inUse());
  const was = () => !current() && s.usedBefore().some((r) => sameVersion(r, props.step));
  const note = () => {
    const v = s
      .variants()
      .find((o) => o.state === s.activeState() && o.variant === props.step.variant);
    return props.step.prompt ?? (v?.version === props.step.version ? v?.note : undefined);
  };
  const src = () => {
    const i = props.step.kinds.indexOf("html");
    return i < 0
      ? null
      : surfaceUrl(props.step.postId, i, {
          version: props.step.version,
          mode: theme(),
          w: props.step.rewrites,
        });
  };
  return (
    <div class="lm-item" data-version={props.step.n}>
      <button
        type="button"
        class="lm-row"
        classList={{ on: on(), hid: props.step.hidden }}
        aria-pressed={on()}
        aria-label={`${s.nameOf(props.step)}${current() ? ", in use" : ""}${props.step.hidden ? ", hidden" : ""}`}
        title={note()}
        onClick={() => s.showVersion(props.step)}
      >
        <Show when={s.steps().length <= PICTURED_UP_TO}>
          <span class="lm-pic" classList={{ flat: s.frameW() > 600 }}>
            <Show
              when={props.step.poster}
              fallback={
                <Show
                  when={src()}
                  fallback={<span class="hkind">{props.step.kinds[0] ?? ""}</span>}
                >
                  {(u) => <Thumb src={u()} width={s.frameW()} fit whole />}
                </Show>
              }
            >
              {(id) => <img src={assetUrl(id())} alt="" loading="lazy" decoding="async" />}
            </Show>
            <Show when={current()}>
              <span class="mk cur" aria-hidden="true">
                <Icon name="check" />
              </span>
            </Show>
            <Show when={was()}>
              <span class="mk was" aria-hidden="true" />
            </Show>
          </span>
        </Show>
        <span class="lm-text">
          <b class="num">{`#${props.step.version}`}</b>
          <Show when={note()}>
            <small>{note()}</small>
          </Show>
        </span>
      </button>
      <Show when={on() && !readonly()}>
        <Show
          when={props.step.hidden}
          fallback={
            <button
              type="button"
              class="ib lm-hide x-remove"
              classList={{ off: current() }}
              aria-disabled={current()}
              aria-label={
                current()
                  ? `${s.nameOf(props.step)} is in use and can't be hidden`
                  : `Hide ${s.nameOf(props.step)}`
              }
              title={
                current() ? "In use. Use another version first." : `Hide ${s.nameOf(props.step)}`
              }
              onClick={() => !current() && void s.hideVersion(props.step, true)}
            >
              <Icon name="close" />
            </button>
          }
        >
          <button
            type="button"
            class="vrestore lm-restore"
            onClick={() => void s.hideVersion(props.step, false)}
          >
            Restore
          </button>
        </Show>
      </Show>
    </div>
  );
}

export function RightMargin(props: { s: MockScreenState; t: TuneState; m: Margins }) {
  const s = props.s;
  const m = props.m;
  const [body, setBody] = createSignal<HTMLElement>();
  const title = () => {
    const at = m.side();
    if (at === "built" && s.tool() === "tune") return "Tune";
    return PANELS.find((p) => p.id === at)?.label ?? "";
  };
  return (
    <Show when={m.side()}>
      {(side) => (
        <aside class="rmargin" classList={{ float: !m.rightDocked() }} aria-label={title()}>
          <div class="rm-head">
            <h2>{title()}</h2>
            <button
              type="button"
              class="ib"
              aria-label={`Close ${title()}`}
              title="Close"
              onClick={() => m.closeSide()}
            >
              <Icon name="close" />
            </button>
          </div>
          <div class="rm-body">
            <Switch>
              <Match when={side() === "talk"}>
                <Talk s={s} m={m} />
              </Match>
              <Match when={side() === "notes"}>
                <div class="rm-scroll">
                  <Notes s={s} />
                </div>
              </Match>
              <Match when={side() === "built"}>
                <div class="rm-scroll">
                  <BuiltFrom s={s} t={props.t} inline />
                </div>
              </Match>
              <Match when={side() === "thread"}>
                <div class="rm-scroll" ref={setBody}>
                  <Answered s={s} scope="all" />
                  <Thread s={s} scroller={body} />
                </div>
              </Match>
            </Switch>
          </div>
        </aside>
      )}
    </Show>
  );
}

// On this design: the question, then everything else this Send will carry, so what
// goes is on screen before it goes.
function Talk(props: { s: MockScreenState; m: Margins }) {
  const s = props.s;
  const below = (): JSX.Element => <WithThisSend s={s} m={props.m} />;
  return (
    <Show
      when={s.curAsk() && !props.m.closed()}
      fallback={
        <>
          <div class="qscroll rm-scroll">{below()}</div>
          <Show when={s.sendable()}>
            <div class="qfoot">
              <span class="grow" />
              <button
                type="button"
                class="btn go qsend"
                disabled={s.sending()}
                onClick={() => s.sendDraft()}
              >
                Send
              </button>
            </div>
          </Show>
        </>
      }
    >
      <QuestionCard s={s} beside below={below()} />
    </Show>
  );
}

export function WithThisSend(props: { s: MockScreenState; m: Margins }) {
  const s = props.s;
  const comments = () => s.draft()?.comments ?? [];
  const pinOf = (i: number) =>
    comments()
      .slice(0, i + 1)
      .filter((c) => c.anchor).length;
  const tuned = () => Object.keys(s.draft()?.tuned ?? {}).length;
  const borrowed = () => Object.keys(s.draft()?.borrowed ?? {}).length;
  const elsewhere = () => s.flow()[0];
  return (
    <>
      <Show when={!s.curAsk() && elsewhere()}>
        {(e) => (
          <button type="button" class="lnk rm-go" onClick={() => s.goOwed()}>
            {`Go to the question${e().state ? ` on ${e().state}` : ""}`}
          </button>
        )}
      </Show>
      <Show when={comments().length}>
        <div class="cmts">
          {/* By place, not object: every keystroke rewrites the comment it's in, and
              a remount would take the caret out of it. */}
          <Index each={comments()}>
            {(c, i) => {
              const where = () =>
                [
                  commentPlace(c()),
                  c().state !== s.activeState() ? c().state : null,
                  c().anchor?.width && Math.round(c().anchor!.width!) !== s.frameW()
                    ? `placed at ${c().anchor!.width}px wide`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
              return (
                <div
                  class="cmt"
                  onPointerEnter={() => s.setHoverPart(c().part ?? null)}
                  onPointerLeave={() => s.setHoverPart(null)}
                >
                  <Show when={c().anchor}>
                    <span class="cmt-n">{pinOf(i)}</span>
                  </Show>
                  <div class="cmt-main">
                    <span class="cmt-where">{where()}</span>
                    <Show
                      when={c().reaction}
                      fallback={
                        <textarea
                          class="cmt-input"
                          rows={1}
                          maxLength={8000}
                          aria-label={`Comment on ${where()}`}
                          value={c().text}
                          onInput={(e) => s.setCommentText(i, e.currentTarget.value)}
                          onBlur={(e) => !e.currentTarget.value.trim() && s.removeComment(i)}
                        />
                      }
                    >
                      {(r) => <span class="cmt-react">{REACTION_LABEL[r()]}</span>}
                    </Show>
                  </div>
                  <button
                    type="button"
                    class="ib cmt-x x-remove"
                    aria-label={`Remove from this Send: ${c().text || where()}`}
                    title="Remove"
                    onClick={() => s.removeComment(i)}
                  >
                    <Icon name="close" />
                  </button>
                </div>
              );
            }}
          </Index>
        </div>
      </Show>
      <Show when={tuned() + borrowed() > 0 && props.m.builtHas()}>
        <div class="tunedbar" role="status">
          <span>
            {[tuned() ? `${tuned()} tuned` : "", borrowed() ? `${borrowed()} borrowed` : ""]
              .filter(Boolean)
              .join(", ")}
          </span>
          <button type="button" onClick={() => props.m.toggleSide("built")}>
            Show
          </button>
        </div>
      </Show>
      <Answered s={s} scope="state" />
    </>
  );
}
