// Focus's sides. The states (and alternatives, and ideas) stand on the left of the design
// while there is more than one frame to go to; on the right a panel that opens for a
// question and is not there without one. It shows one thing at a time: the question,
// Spec (with its Instances) or Activity, the last two opened from the ⋯ menu. When a
// margin would shrink the design past what marginLayout allows it stops standing there:
// it opens floating over the canvas instead, which stays the size it was. The centre only
// reads the bands they take (--canvas-l, --canvas-r, canvasBox), so it needn't be the
// stage. The canvas tools stand in a strip against the design's left edge (ToolStrip); the
// versions are the top bar's (DesignScreen.tsx).

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
import { isLive, tunedCount } from "../../server/types.ts";
import { assetUrl } from "./api.ts";
import { BuiltFrom } from "./BuiltFrom.tsx";
import { AnsweredLines, keptGroups } from "./Kept.tsx";
import type { FlowNav } from "./flowNav.ts";
import { host, readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import {
  BOARD_GAP,
  BOARD_PAD,
  boardWidths,
  commentPlace,
  GHOST_W,
  LEFT_MARGIN_W,
  LEFT_THUMBS_W,
  marginLayout,
  RIGHT_MARGIN_W,
  TOOL_BAND_W,
  widthChoices,
} from "./logic.ts";
import { PaletteTool, paletteChoices } from "./PaletteTool.tsx";
import { PreviewTool } from "./PreviewTool.tsx";
import { Spec, specShown } from "./Spec.tsx";
import { IdeasForList } from "./IdeasFor.tsx";
import { OutlineRows } from "./Outlines.tsx";
import { QuestionCard } from "./QuestionCard.tsx";
import { Answered, listed } from "./Questions.tsx";
import { AlternativeList } from "./Alternatives.tsx";
import { AnswersAs, answeredRows, pictured } from "./SideBySide.tsx";
import { REACTION_LABEL } from "./reactionRules.ts";
import { SendTo } from "./SendTo.tsx";
import type { Shortlists } from "./shortlist.ts";
import type { DesignScreenState } from "./state.ts";
import { Thread } from "./Thread.tsx";
import { Thumb } from "./Thumb.tsx";
import type { TuneState } from "./tune.ts";
import { CanvasTools } from "./VersionBar.tsx";
import { NO_BOX, safeX, setCanvasBox, tabletLayout, win } from "./viewport.ts";

// "built" is Tune's: the panel while Tune is on, with no tabs.
export type Side = "talk" | "spec" | "built" | "thread";
export type Margins = ReturnType<typeof createMargins>;

// Past this many a list is names alone: every picture is a whole page loading, and
// a lab has over a hundred.
const PICTURED_UP_TO = 24;
// A tablet's margin is narrower: its states are their pictures, the names in their labels.
const leftW = () => (tabletLayout() ? LEFT_THUMBS_W : LEFT_MARGIN_W);

export function createMargins(
  s: DesignScreenState,
  nav: FlowNav,
  active: () => boolean,
  // A reading column is what the margins have to leave room for, instead of artboards.
  columnW: () => number | null,
  // A screen whose states can still grow: its list of states ends in New state, and with
  // only the one so far New state is in the ⋯ menu instead.
  outlining: () => boolean,
  // Answers side by side take the canvas: the design's frame, its states and its tools
  // step aside, and the question beside it stays.
  sideBySide: () => boolean,
) {
  const [folded, setFolded] = createSignal(false);
  const [over, setOver] = createSignal(false);
  // Opened by hand with only sent answers in it, which never open it themselves.
  const [pinned, setPinned] = createSignal(false);
  // Shut by hand: it stays shut until opened, or until a new question comes.
  const [shut, setShut] = createSignal(false);

  const onList = () => nav.at() >= 0 || nav.outside().some((x) => x.state === s.activeState());
  const walkable = () =>
    (nav.steps().length + nav.outside().length > 1 || nav.emptied().length > 0) && onList();
  const statesShown = () => walkable();
  const ideasFor = () => s.design()?.ideasFor ?? [];
  const alternativesHere = () => s.alternatives().filter((v) => v.state === s.activeState());
  const leftHas = () =>
    !sideBySide() && (statesShown() || ideasFor().length > 0 || alternativesHere().length > 1);
  const page = () => {
    const kinds: readonly string[] =
      s.stageStep()?.kinds ?? s.activeAlternative()?.surfaces.map((x) => String(x.kind)) ?? [];
    return kinds.includes("html");
  };

  // A document has no widths to choose between, and nothing to scan onto a phone.
  const previewHas = () =>
    columnW() === null && (page() || widthChoices(s.design()?.widths ?? []).length > 1);
  // The strip is the canvas's: not over a document, the sheet, answers side by side or a
  // state with nothing drawn, and only while it holds something.
  const onCanvas = () =>
    active() &&
    !sideBySide() &&
    columnW() === null &&
    !s.sheet.view() &&
    s.alternatives().some((v) => v.state === s.activeState());
  const stripHas = () =>
    onCanvas() &&
    (page() || s.tunable().length > 0 || previewHas() || paletteChoices(s).length > 0);

  const closed = () => !!s.design()?.archivedAt;
  // Only an open question opens the panel by itself. What else it holds (what this Send
  // carries, answered questions) is there when opened.
  const talkWants = () => !closed() && !!s.curAsk();
  const talkHas = () =>
    !closed() &&
    (talkWants() ||
      s.flow().length > 0 ||
      s.sendable() ||
      keptGroups(s).length > 0 ||
      answeredRows(s).length > 0 ||
      s.closedAsks("state").length > 0);
  const boards = () => boardWidths(s.design()?.widths ?? [], s.frameW(), s.allWidths(), false);
  const fitWith = (left: boolean, right = side() !== null) => {
    const row = boards();
    return marginLayout({
      winW: win().w - safeX(),
      designW: columnW() ?? row.reduce((sum, w) => sum + w, 0) + BOARD_GAP * (row.length - 1),
      tools: stripHas(),
      left,
      right,
      leftW: leftW(),
    });
  };
  const builtHas = () => s.tunable().length > 0 || !!s.activeAlternative()?.instancesKey;
  const specHas = () => specShown(s) || builtHas();
  const side = createMemo<Side | null>(() => {
    if (s.drawer()) return "built";
    if (shut()) return null;
    if (s.panel() === "thread") return "thread";
    if (s.panel() === "spec") return "spec";
    if (s.cardMin()) return null;
    if (talkWants() || pinned()) return "talk";
    return null;
  });
  createEffect(
    on(
      () => s.curAsk()?.id,
      (id, was) => {
        if (id && id !== was) setShut(false);
      },
    ),
  );

  const fit = createMemo(() =>
    !active()
      ? { left: false, right: false }
      : sideBySide()
        ? { left: false, right: side() !== null }
        : fitWith(leftHas() && !folded()),
  );
  const leftDocked = () => fit().left;
  const rightDocked = () => fit().right;
  const leftTab = () => active() && leftHas() && !leftDocked();
  const leftFloats = () => leftTab() && over();
  const stripW = () => (stripHas() ? TOOL_BAND_W : 0);
  const band = () => ({
    left: leftDocked() ? leftW() : 0,
    right: rightDocked() ? RIGHT_MARGIN_W : 0,
  });
  // The neighbouring steps never cost the design its size; a row of artboards
  // would run under them.
  const ghosts = () =>
    active() &&
    !sideBySide() &&
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
    if (side() === "built") {
      if (s.tool() === "tune") s.toggleTool("tune");
      else s.setDrawer(false);
      return;
    }
    setPinned(false);
    setShut(true);
  }
  // The toggle in the top bar: shut, or open on the question and what goes with it.
  function togglePanel() {
    if (side()) return closeSide();
    setShut(false);
    toggleSide("talk");
  }
  // A tab: what it shows, in the panel whether or not it stood open.
  function toggleSide(to: Side) {
    setShut(false);
    if (side() === to && to === "built") return closeSide();
    if (to === "built") {
      s.setPanel(null);
      s.setDrawer(true);
    } else if (to === "thread" || to === "spec") {
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
    builtHas,
    specHas,
    side,
    talkHas,
    closed,
    leftDocked,
    rightDocked,
    leftTab,
    leftFloats,
    stripW,
    previewHas,
    band,
    ghosts,
    toggleLeft,
    closeLeft,
    closeSide,
    toggleSide,
    togglePanel,
  };
}

// Try, Comment, Tune, the preview and the palette, against the design's left edge. They
// change what a tap on it does or how it's shown, so they stay by it however narrow it is
// or wherever it's panned.
export function ToolStrip(props: { s: DesignScreenState; m: Margins }) {
  const s = props.s;
  const m = props.m;
  const tools = () => m.page() || s.tunable().length > 0;
  return (
    <Show when={m.stripW() > 0}>
      <div class="toolstrip" role="toolbar" aria-label="Tools">
        <CanvasTools s={s} page={m.page()} />
        <Show when={m.previewHas()}>
          <Show when={tools()}>
            <span class="toolstrip-sep" />
          </Show>
          <PreviewTool s={s} qr={m.page()} />
        </Show>
        <Show when={paletteChoices(s).length}>
          <Show when={tools() || m.previewHas()}>
            <span class="toolstrip-sep" />
          </Show>
          <PaletteTool s={s} />
        </Show>
      </div>
    </Show>
  );
}

const TITLES: Record<Side, string> = {
  talk: "Question",
  spec: "Spec",
  thread: "Activity",
  built: "Instances",
};

// The panel's toggle, in the top bar where it costs the design nothing. Only there while
// the panel has something to open on.
export function PanelToggle(props: { m: Margins }) {
  const m = props.m;
  const label = () => (m.side() ? "Hide panel" : "Show panel");
  return (
    <div class="mtabs">
      <button
        type="button"
        class="ib ptoggle"
        classList={{ on: !!m.side() }}
        aria-pressed={!!m.side()}
        aria-label={label()}
        title={label()}
        onClick={() => m.togglePanel()}
      >
        <Icon name="panel" />
      </button>
    </div>
  );
}

export function LeftMargin(props: { s: DesignScreenState; nav: FlowNav; m: Margins }) {
  const s = props.s;
  const m = props.m;
  return (
    <Show when={m.leftDocked() || m.leftFloats()}>
      <aside
        class="lmargin"
        classList={{ float: m.leftFloats(), thumbs: tabletLayout() && !m.leftFloats() }}
        aria-label="States and versions"
      >
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
        <AlternativeList s={s} />
        <AlternativesLine s={s} />
        <Show when={s.design()?.ideasFor}>
          {(ideas) => <IdeasForList project={s.project} ideas={ideas()} />}
        </Show>
      </aside>
    </Show>
  );
}

// A screen or a component holds one entry a state; what it holds beyond that are
// alternatives, which belong in an idea for it. Said quietly, with the one action that
// moves them there.
function AlternativesLine(props: { s: DesignScreenState }) {
  const s = props.s;
  const most = () => {
    const live = s.alternatives().filter((v) => isLive(v.status));
    const states = s.design()?.states.length ? s.design()!.states : [null];
    return Math.max(0, ...states.map((st) => live.filter((v) => v.state === st).length));
  };
  return (
    <Show when={s.design()?.holdsAlternatives && most() > 1}>
      <p class="alts-line">
        {`${most()} alternatives · `}
        <Show when={!readonly()}>
          <button type="button" class="alts-move" onClick={() => void s.moveIntoIdea()}>
            Move to an idea
          </button>
        </Show>
      </p>
    </Show>
  );
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

// The steps, as the flow bar has them. By key, not object: the steps are rebuilt on
// every read, and remounting a row would start its picture's page over.
function StateList(props: { s: DesignScreenState; nav: FlowNav; outlining: boolean }) {
  const s = props.s;
  const nav = props.nav;
  const keyOf = (x: { design: string; state: string | null }) =>
    JSON.stringify([x.design, x.state]);
  const keys = createMemo(() => nav.steps().map(keyOf), [], { equals: sameList });
  const outsideKeys = createMemo(() => nav.outside().map(keyOf), [], { equals: sameList });
  const pictured = () => nav.steps().length <= PICTURED_UP_TO;
  const flat = () => s.frameW() > 600;
  let list!: HTMLElement;
  createEffect(() => {
    s.activeState();
    nav.at();
    host().window.requestAnimationFrame(() =>
      list?.querySelector("[aria-current]")?.scrollIntoView({ block: "nearest" }),
    );
  });
  const row = (key: string) => {
    const [design, state] = JSON.parse(key) as [string, string | null];
    const x = { design, state };
    const here = () => keyOf(nav.here()) === key;
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
              ? `${nav.label(x)}, not drawn`
              : nav.label(x)
        }
        title={nav.label(x)}
        onClick={() => nav.go(x)}
      >
        <Show when={pictured()}>
          <span class="lm-pic" classList={{ flat: flat(), "lm-dash": nav.planned(x) }}>
            <Show
              when={nav.poster(x)}
              fallback={
                <Show when={nav.picture(x)}>
                  {(u) => <Thumb src={u()} width={s.frameW()} fit whole />}
                </Show>
              }
            >
              {(id) => <img src={assetUrl(id())} alt="" loading="lazy" decoding="async" />}
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
  };
  return (
    <section
      class="lm-sec lm-states"
      classList={{ pictured: pictured() }}
      ref={(el) => (list = el)}
    >
      <h3>{nav.flow() ? nav.name() : "States"}</h3>
      <For each={keys()}>{row}</For>
      <Show when={outsideKeys().length}>
        <h3 class="lm-others">Other states</h3>
        <For each={outsideKeys()}>{row}</For>
      </Show>
      {/* The way back to what they hold: each state's archived alternatives fold under it. */}
      <Show when={nav.emptied().length}>
        <select
          class="ftab-emptied lm-emptied"
          aria-label="States with everything archived"
          title="States with everything archived"
          value=""
          onChange={(e) => {
            const to = e.currentTarget.value;
            e.currentTarget.value = "";
            if (to) nav.go({ design: nav.here().design, state: to });
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

export function RightMargin(props: {
  s: DesignScreenState;
  t: TuneState;
  m: Margins;
  sl: Shortlists;
}) {
  const s = props.s;
  const m = props.m;
  const [body, setBody] = createSignal<HTMLElement>();
  const title = (side: Side) =>
    side === "built" ? (s.tool() === "tune" ? "Tune" : "Instances") : TITLES[side];
  return (
    <Show when={m.side()}>
      {(side) => (
        <aside
          class="rmargin"
          classList={{ float: !m.rightDocked() }}
          aria-label={side() === "built" ? "Tune" : "Panel"}
        >
          <div class="rm-head">
            <h2>{title(side())}</h2>
            <Show when={side() === "talk" && !m.closed() ? s.curAsk() : null}>
              {(ask) => (
                <Show when={pictured(s, ask())}>
                  <AnswersAs s={s} ask={ask()} listable={listed(s, ask())} />
                </Show>
              )}
            </Show>
            <button
              type="button"
              class="ib"
              aria-label={side() === "built" ? "Close Tune" : "Hide panel"}
              title={side() === "built" ? "Close" : "Hide"}
              onClick={() => m.closeSide()}
            >
              <Icon name="close" />
            </button>
          </div>
          <div class="rm-body">
            <Switch>
              <Match when={side() === "talk"}>
                <Talk s={s} m={m} sl={props.sl} />
              </Match>
              <Match when={side() === "spec"}>
                <div class="rm-scroll">
                  <Show when={specShown(s)}>
                    <Spec s={s} />
                  </Show>
                  <Show when={m.builtHas()}>
                    <h3 class="rm-sub">Instances</h3>
                    <BuiltFrom s={s} t={props.t} inline />
                  </Show>
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

// The Question tab: the question, then everything else this Send will carry, so what
// goes is on screen before it goes.
function Talk(props: { s: DesignScreenState; m: Margins; sl: Shortlists }) {
  const s = props.s;
  const below = (): JSX.Element => <WithThisSend s={s} m={props.m} />;
  return (
    <Show
      when={s.curAsk() && !props.m.closed()}
      fallback={
        <>
          <div class="qscroll rm-scroll">
            <Show when={!s.flow().length && !s.sendable()}>
              <p class="rm-none">Nothing to answer</p>
            </Show>
            {below()}
          </div>
          <Show when={s.sendable()}>
            <SendTo s={s} />
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
      <QuestionCard s={s} beside below={below()} sl={props.sl} />
    </Show>
  );
}

export function WithThisSend(props: { s: DesignScreenState; m: Margins }) {
  const s = props.s;
  const comments = () => s.draft()?.comments ?? [];
  const pinOf = (i: number) =>
    comments()
      .slice(0, i + 1)
      .filter((c) => c.anchor).length;
  const tuned = () => tunedCount(s.draft()?.tunedOn);
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
                  <Show when={!readonly()}>
                    <button
                      type="button"
                      class="ib cmt-x x-remove"
                      aria-label={`Remove from this Send: ${c().text || where()}`}
                      title="Remove"
                      onClick={() => s.removeComment(i)}
                    >
                      <Icon name="close" />
                    </button>
                  </Show>
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
      <AnsweredLines s={s} />
    </>
  );
}
