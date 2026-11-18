// Side by side: every answer of one question at full height in a row on the canvas,
// the design as it stands first, so a choice is made by looking across rather than by
// hovering one card at a time. Clicking an answer picks it, again takes it back; the
// pick is outlined and named, the rest dim but stay readable. After a Send the row
// stays as the answer it got: the pick, the kept answers beside it, the archived ones
// folded. The panel's cards for a sent question are here too, since they read the same
// order and the same marks.

import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { Ask, AskOption, KnobValue } from "../../server/types.ts";
import { surfaceUrl } from "./api.ts";
import { answersLayout, rowAskFor, setAnswersLayout, setRowAskFor } from "./answersLayout.ts";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { answerIds, askState, draftKnobValues, frameKey, splitLabel } from "./logic.ts";
import { optionPicture } from "./Questions.tsx";
import type { DesignScreenState } from "./state.ts";
import { framePalette, frameMode } from "./systemRev.ts";
import { Thumb } from "./Thumb.tsx";
import { canvasBox, canvasTop, phoneLayout, safeX, win } from "./viewport.ts";

// The row's padding and the space between frames, in screen px.
const PAD = 24;
const GAP = 24;
// The name over each frame, as a design tool names its frames: always in sight, however
// tall the page under it runs.
const LABEL_H = 34;
// Narrower than this a phone frame stops reading as a screen: the row scrolls instead.
const MIN_FRAME_W = 110;
const MIN_SCALE = 0.2;
// A page pictured whole down to this many times its width; past that it is cut.
const TALLEST = 30;

export const pictured = (s: DesignScreenState, ask: Ask) =>
  ask.options.some((o) => !!optionPicture(s, ask, o));

// Sent questions on the state on stage whose answers have pictures: each keeps its row.
export const answeredRows = (s: DesignScreenState): Ask[] =>
  s.closedAsks("state").filter((a) => !a.dismissed && pictured(s, a));

const isSent = (s: DesignScreenState, ask: Ask) => s.closedAsks("all").some((a) => a.id === ask.id);

// The question laid out side by side now, if the design is in that layout: the one last
// in the row, so a Send leaves its row in place, else the open question on the card,
// else the last one answered here.
export function sideAsk(s: DesignScreenState): Ask | null {
  const m = s.design();
  if (!m || answersLayout(m.id) !== "side") return null;
  const cur = s.curAsk();
  const open = cur && pictured(s, cur) ? cur : null;
  const done = answeredRows(s);
  const want = rowAskFor(m.id);
  if (want) {
    if (open?.id === want) return open;
    const sent = done.find((a) => a.id === want);
    if (sent) return sent;
  }
  return open ?? done.at(-1) ?? null;
}

// What a sent question shows, in its order: the pick, the kept ones beside it, the rest.
function sentOrder(s: DesignScreenState, ask: Ask): AskOption[] {
  const chosen = answerIds(s.answerOf(ask));
  const shown = s.shownOptions(ask);
  const kept = (o: AskOption) => s.isPicked(ask, o.id);
  return [
    ...shown.filter((o) => chosen.includes(o.id)),
    ...shown.filter((o) => !chosen.includes(o.id) && kept(o)),
    ...shown.filter((o) => !chosen.includes(o.id) && !kept(o)),
  ];
}

interface Cell {
  key: string;
  label: string;
  current: boolean;
  chosen: boolean;
  kept: boolean;
  archived: boolean;
  option: AskOption | null;
  picture: { src: string; knobs: Record<string, KnobValue> } | null;
}

// The design as it stands, before this question's answer: what the frame shows without
// the pick drafted here. A question between alternatives has a current one only once
// one is in use; until then every answer is as current as the next.
function currentCell(s: DesignScreenState, ask: Ask): Cell | null {
  const m = s.design();
  if (!m) return null;
  const state = askState(ask, m, s.activeState());
  const alternatives = ask.options.some((o) => o.alternative);
  const use = alternatives ? m.inUse.find((x) => x.state === state) : undefined;
  if (alternatives && !use) return null;
  const v = use
    ? s.alternatives().find((x) => x.state === state && x.alternative === use.alternative)
    : s.alternativeFor(state, false);
  const idx = v?.surfaces.findIndex((x) => x.kind === "html") ?? -1;
  if (!v || idx < 0) return null;
  const d = s.draft();
  const without = d
    ? { ...d, answers: Object.fromEntries(Object.entries(d.answers).filter(([k]) => k !== ask.id)) }
    : null;
  const knobs = draftKnobValues(m, v, without);
  const palette = framePalette() ?? m.palettes?.find((p) => p.status === "default")?.id;
  // Named after the answer it already matches, so "Current" says which one it is.
  const same = ask.options.find((o) =>
    o.alternative
      ? o.alternative === v.alternative
      : o.palette
        ? o.palette === palette
        : !!o.set &&
          Object.keys(o.set).length > 0 &&
          Object.entries(o.set).every(([k, x]) => knobs[k] === x),
  );
  return {
    key: "current",
    label: same ? splitLabel(same.label).name : "",
    current: true,
    chosen: false,
    kept: false,
    archived: false,
    option: null,
    picture: {
      src: surfaceUrl(v.postId, idx, {
        version: use ? use.version : s.frameVersionOf(v),
        mode: frameMode(),
        e: v.instancesKey,
        w: v.rewrites,
      }),
      knobs,
    },
  };
}

function optionCell(s: DesignScreenState, ask: Ask, o: AskOption, archived: boolean): Cell {
  const p = optionPicture(s, ask, o);
  return {
    key: `${archived ? "archived" : "option"}:${o.id}`,
    label: splitLabel(o.label).name,
    current: false,
    chosen: answerIds(s.answerOf(ask)).includes(o.id),
    kept: s.isPicked(ask, o.id),
    archived,
    option: o,
    picture: p ? { src: p.src, knobs: p.knobs } : null,
  };
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

// Side by side as one icon in the question's head, there only when the answers have
// pictures to set side by side.
export function SideBySideToggle(props: { s: DesignScreenState; ask: Ask }) {
  const s = props.s;
  const on = () => sideAsk(s)?.id === props.ask.id;
  return (
    <Show when={pictured(s, props.ask)}>
      <button
        type="button"
        class="ib qside"
        aria-label="Side by side"
        aria-pressed={on()}
        title={on() ? "Back to one" : "Side by side"}
        onClick={() => {
          const d = s.design()?.id;
          if (!d) return;
          if (on()) return setAnswersLayout(d, "one");
          s.setPreview(null);
          setRowAskFor(d, props.ask.id);
          setAnswersLayout(d, "side");
        }}
      >
        <Icon name="columns" />
      </button>
    </Show>
  );
}

// The row on the canvas, in place of the design's frame.
export function SideBySide(props: { s: DesignScreenState; ask: Ask }) {
  const s = props.s;
  const [archivedOpen, setArchivedOpen] = createSignal(false);
  const sent = () => isSent(s, props.ask);
  const open = () => !sent() && !readonly();
  const cells = createMemo((): Cell[] => {
    const ask = props.ask;
    const first = sent() ? [] : [currentCell(s, ask)].filter((c): c is Cell => c !== null);
    const answers = (sent() ? sentOrder(s, ask) : s.shownOptions(ask)).map((o) =>
      optionCell(s, ask, o, false),
    );
    const archived = archivedOpen()
      ? s.hiddenOptions(ask).map((o) => optionCell(s, ask, o, true))
      : [];
    return [...first, ...answers, ...archived];
  });
  const keys = createMemo(() => cells().map((c) => c.key), [], { equals: sameList });
  const cellOf = (key: string) => cells().find((c) => c.key === key);
  const archivedN = () => s.hiddenOptions(props.ask).length;
  createEffect(() => {
    const d = s.design()?.id;
    if (d && rowAskFor(d) !== props.ask.id) setRowAskFor(d, props.ask.id);
  });
  const picked = () => cells().some((c) => c.chosen);

  // Fitted like the stage fits its design: the first screen of the page in the canvas's
  // height, and the row across its width, down to a frame that still reads; past that
  // the row scrolls sideways.
  const scale = createMemo(() => {
    const frameW = s.frameW();
    const n = Math.max(1, keys().length);
    const across =
      win().w - safeX() - canvasBox().left - canvasBox().right - canvasBox().over - 2 * PAD;
    const down = win().h - canvasTop() - 2 * PAD - LABEL_H;
    const v = s.activeAlternative();
    const doc = v ? s.reports[frameKey(v.state, v.alternative)]?.height : undefined;
    const tall = Math.min(doc && doc > 0 ? doc : win().h, win().h);
    const wide = (across - GAP * (n - 1)) / (n * frameW);
    const least = Math.min(1, Math.max(MIN_SCALE, MIN_FRAME_W / frameW));
    return Math.max(0.05, Math.min(1, down / tall, Math.max(wide, least)));
  });
  const frameW = () => Math.round(s.frameW() * scale());
  const firstScreen = () => {
    const v = s.activeAlternative();
    const doc = v ? s.reports[frameKey(v.state, v.alternative)]?.height : undefined;
    return Math.round(Math.min(doc && doc > 0 ? doc : win().h, win().h) * scale());
  };

  function choose(c: Cell) {
    const o = c.option;
    if (!o || !open() || c.archived) return;
    if (c.chosen) s.unpick(props.ask, o.id);
    else s.pick(props.ask, o.id);
  }

  return (
    <div class="sbs" role="region" aria-label={`Answers side by side: ${props.ask.text}`}>
      <div
        class="sbs-row"
        classList={{ picked: picked() }}
        style={{ "--sbs-w": `${frameW()}px`, "--sbs-h": `${firstScreen()}px` }}
      >
        <For each={keys()}>
          {(key) => (
            <Show when={cellOf(key)}>
              {(c) => {
                const pickable = () => open() && !!c().option && !c().archived;
                return (
                  <div
                    class="sbs-cell"
                    classList={{
                      current: c().current,
                      chosen: c().chosen,
                      archived: c().archived,
                      pickable: pickable(),
                    }}
                    data-sbs={c().option?.id ?? "current"}
                  >
                    <div class="sbs-lab">
                      <Show when={c().current}>
                        <span class="sbs-tag">Current</span>
                      </Show>
                      <Show when={c().chosen}>
                        <span class="sbs-tag on">Chosen</span>
                      </Show>
                      <Show when={c().kept}>
                        <span class="sbs-kept" title="Picked">
                          <Icon name="check" />
                        </span>
                      </Show>
                      <span class="sbs-name">{c().label}</span>
                    </div>
                    <button
                      type="button"
                      class="sbs-pic"
                      disabled={!pickable()}
                      aria-pressed={c().current ? undefined : c().chosen}
                      aria-label={
                        c().current
                          ? `Current${c().label ? `, ${c().label}` : ""}`
                          : `${c().label}${c().kept ? ", picked" : ""}${c().archived ? ", archived" : ""}`
                      }
                      onClick={() => choose(c())}
                    >
                      <Show when={c().picture} fallback={<span class="sbs-none">{c().label}</span>}>
                        {(p) => (
                          <Thumb
                            src={p().src}
                            knobs={p().knobs}
                            width={s.frameW()}
                            grow={TALLEST}
                            title={c().current ? "Current" : c().label}
                          />
                        )}
                      </Show>
                    </button>
                  </div>
                );
              }}
            </Show>
          )}
        </For>
        <Show when={archivedN() > 0}>
          <button
            type="button"
            class="sbs-fold"
            aria-expanded={archivedOpen()}
            onClick={() => setArchivedOpen(!archivedOpen())}
          >
            {`${archivedN()} archived ${archivedOpen() ? "◂" : "▸"}`}
          </button>
        </Show>
      </div>
    </div>
  );
}

// A sent question in the panel: its answers as they were left, the pick outlined and
// named, kept ones bookmarked beside it, archived ones folded. Hovering one shows it on
// the design and a click holds it there, changing nothing; Change answer reopens it.
// `bare`: inside the question's own line, which already names it.
export function AnsweredCard(props: { s: DesignScreenState; ask: Ask; bare?: boolean }) {
  const s = props.s;
  const [archivedOpen, setArchivedOpen] = createSignal(false);
  const chosen = () => answerIds(props.ask.answer);
  const side = () => sideAsk(s)?.id === props.ask.id;
  const archived = () => s.hiddenOptions(props.ask);
  const hold = (o: AskOption) => {
    const p = s.previewOf(props.ask, o.id);
    if (!p || side()) return;
    if (s.heldPreview()?.key === p.key) s.setPreview(null);
    else s.setHeldPreview(p);
  };
  return (
    <section class="ansd" aria-label={`Answered: ${props.ask.text}`} data-answered={props.ask.id}>
      <Show when={!props.bare}>
        <span class="ansd-st">Answered</span>
        <span class="ansd-q">{props.ask.text}</span>
      </Show>
      <Show when={!phoneLayout()}>
        <SideBySideToggle s={s} ask={props.ask} />
      </Show>
      <div class="ansd-opts" classList={{ picked: chosen().length > 0 }}>
        <For each={sentOrder(s, props.ask)}>
          {(o) => {
            const pic = () => optionPicture(s, props.ask, o);
            const on = () => chosen().includes(o.id);
            const key = () => s.previewOf(props.ask, o.id)?.key;
            return (
              <button
                type="button"
                class="ansd-opt"
                classList={{
                  chosen: on(),
                  previewing: !!key() && s.preview()?.key === key(),
                }}
                aria-pressed={!!key() && s.heldPreview()?.key === key()}
                aria-label={`${o.label}${on() ? ", chosen" : ""}${s.isPicked(props.ask, o.id) ? ", picked" : ""}`}
                onPointerEnter={(e) =>
                  e.pointerType === "mouse" &&
                  !side() &&
                  s.setHoveredPreview(s.previewOf(props.ask, o.id))
                }
                onPointerLeave={(e) => e.pointerType === "mouse" && s.setHoveredPreview(null)}
                onClick={() => hold(o)}
              >
                <Show when={pic()}>
                  {(p) => (
                    <Thumb
                      width={s.frameW()}
                      class={s.frameW() > 600 ? "crop flat" : "crop"}
                      fit
                      src={p().src}
                      knobs={p().knobs}
                    />
                  )}
                </Show>
                <span class="ansd-lbl">
                  <Show when={on()}>
                    <span class="sbs-tag on">Chosen</span>
                  </Show>
                  <Show when={s.isPicked(props.ask, o.id)}>
                    <span class="sbs-kept" title="Picked">
                      <Icon name="check" />
                    </span>
                  </Show>
                  <span class="sbs-name">{splitLabel(o.label).name}</span>
                </span>
              </button>
            );
          }}
        </For>
      </div>
      <Show when={archived().length}>
        <button
          type="button"
          class="answered-hd"
          aria-expanded={archivedOpen()}
          onClick={() => setArchivedOpen(!archivedOpen())}
        >
          <span class="answered-chev" aria-hidden="true">
            ›
          </span>
          {`${archived().length} archived`}
        </button>
        <Show when={archivedOpen()}>
          <ul class="hiddenans-list">
            <For each={archived()}>
              {(o) => (
                <li>
                  <span class="hiddenans-name">{o.label}</span>
                  <Show when={s.hiddenOf(props.ask, o.id)?.why}>
                    {(why) => <span class="hiddenans-why">{why()}</span>}
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
      <Show when={!readonly()}>
        <button
          type="button"
          class="secondary answered-change"
          aria-label={`Change answer: ${props.ask.text}`}
          onClick={() => s.changeAnswer(props.ask)}
        >
          Change answer
        </button>
      </Show>
    </section>
  );
}
