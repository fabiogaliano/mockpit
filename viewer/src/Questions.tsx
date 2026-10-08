// D3/D5/D6: questions answered in place. Options are pictures when the viewer
// can render them (a variant that exists for the ask's state, or a knob set it
// can apply), pills otherwise. Hover previews on the stage, click picks; on a
// hover device a pick moves on to the next open question, on touch the first
// tap previews and the second confirms. Mix is the optional last question.

import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import type { Ask, AskOption } from "../../server/types.ts";
import { surfaceUrl, type VariantView } from "./api.ts";
import { host, readonly } from "./host.ts";
import {
  answerIds,
  askName,
  askState,
  frameKey,
  type MixOption,
  partBox,
  sendCount,
} from "./logic.ts";
import type { MockScreenState } from "./state.ts";
import { theme } from "./theme.ts";
import { Thumb } from "./Thumb.tsx";

const ADVANCE_MS = 450;
const hoverDevice = () => host().window.matchMedia?.("(hover: hover)").matches ?? true;

export function Questions(props: { s: MockScreenState }) {
  const s = props.s;
  return (
    <Show when={s.mock()}>
      <Show when={s.questions().length} fallback={<Decide s={s} />}>
        <QuestionView s={s} />
      </Show>
    </Show>
  );
}

function QuestionView(props: { s: MockScreenState }) {
  const s = props.s;
  const total = () => s.questions().length;
  const i = () => Math.min(s.cur(), total() - 1);
  const q = () => s.questions()[i()];
  const isLast = () => i() === total() - 1;
  const n = () =>
    sendCount(s.draft() ?? { version: 0, answers: {}, mix: {}, tuned: {}, comments: [] });
  const answered = () => {
    const x = q();
    return x.kind === "mix" ? s.mixAnswered() : s.answerOf(x.ask) !== undefined;
  };

  return (
    <>
      <div class="qhd">
        <Header s={s} index={i()} total={total()} />
        <span class="grow" />
        <button
          type="button"
          class="nav"
          aria-label="Previous question"
          disabled={i() === 0}
          onClick={() => s.goQuestion(i() - 1)}
        >
          ‹
        </button>
        <button
          type="button"
          class="nav"
          aria-label="Next question"
          disabled={isLast()}
          onClick={() => s.goQuestion(i() + 1)}
        >
          ›
        </button>
      </div>
      <Show when={q()} keyed>
        {(x) =>
          x.kind === "mix" ? (
            <MixBlock s={s} index={i()} />
          ) : (
            <AskBlock s={s} ask={x.ask} index={i()} />
          )
        }
      </Show>
      <Show when={s.error()}>
        <div class="qerr" role="alert">
          {s.error()}
        </div>
      </Show>
      <Show
        when={isLast() && s.owed().length === 0 && n() > 0 && !readonly()}
        fallback={
          <Show when={(answered() && !isLast()) || (isLast() && s.owed().length > 0)}>
            <button
              type="button"
              class="primary"
              onClick={() => s.goQuestion(s.nextStop(i()) ?? total() - 1)}
            >
              Next ›
            </button>
          </Show>
        }
      >
        <button
          type="button"
          class="primary send"
          disabled={s.sending()}
          onClick={() => void s.send()}
        >
          {`Send ${n()}`}
        </button>
      </Show>
    </>
  );
}

function Header(props: { s: MockScreenState; index: number; total: number }) {
  const s = props.s;
  const q = () => s.questions()[props.index];
  const ask = () => {
    const x = q();
    return x?.kind === "ask" ? x.ask : null;
  };
  const labels = createMemo(() => {
    const a = ask();
    if (!a) {
      const mix = Object.entries(s.draft()?.mix ?? {}).map(([p, v]) => `${p} · ${v}'s`);
      return s.mixAnswered() ? mix.join(", ") || "none" : null;
    }
    const ids = answerIds(s.answerOf(a));
    if (!ids.length) return null;
    return ids.map((id) => a.options.find((o) => o.id === id)?.label ?? id).join(", ");
  });
  const flagged = () => {
    const a = ask();
    return a ? s.flagged().includes(a.id) : false;
  };
  const over = () => {
    const a = ask();
    return a ? !!s.overridden()[a.id] : false;
  };
  return (
    <Show
      when={labels()}
      fallback={
        <span>
          {`Question ${props.index + 1} of ${props.total}`}
          <Show when={flagged()}>
            <span class="flag">{` · your pick is gone in v${s.latest()}`}</span>
          </Show>
        </span>
      }
    >
      <span>{`${props.index + 1} of ${props.total} · `}</span>
      <span class="picked" classList={{ ovr: over() }}>{`picked: ${labels()}`}</span>
    </Show>
  );
}

// The option's picture source, or null when it can only be a pill.
function optionPicture(
  s: MockScreenState,
  ask: Ask,
  o: AskOption,
): { src: string; variant: VariantView; state: string | null } | null {
  const m = s.mock();
  if (!m) return null;
  const state = askState(ask, m, s.activeState());
  const html = (v: VariantView | undefined) => {
    if (!v) return -1;
    return v.surfaces.findIndex((x) => x.kind === "html");
  };
  if (o.variant) {
    const v = s.variants().find((x) => x.state === state && x.variant === o.variant);
    const idx = html(v);
    if (!v || idx < 0) return null;
    return {
      src: surfaceUrl(v.postId, idx, { version: s.frameVersionOf(v), mode: theme() }),
      variant: v,
      state,
    };
  }
  if (o.set && Object.keys(o.set).length) {
    const v = s.variantFor(state, false);
    const idx = html(v);
    if (!v || idx < 0) return null;
    return {
      src: surfaceUrl(v.postId, idx, {
        version: s.frameVersionOf(v),
        mode: theme(),
        knobs: o.set,
      }),
      variant: v,
      state,
    };
  }
  return null;
}

function AskBlock(props: { s: MockScreenState; ask: Ask; index: number }) {
  const s = props.s;
  const m = () => s.mock()!;
  const over = () => s.overridden()[props.ask.id];
  const picked = (o: AskOption) => answerIds(s.answerOf(props.ask)).includes(o.id);
  const keyOf = (o: AskOption) => `${props.ask.id}:${o.id}`;
  const [timer, setTimer] = createSignal(0);

  const previewOf = (o: AskOption, state: string | null) =>
    o.variant
      ? { key: keyOf(o), variant: o.variant, state }
      : o.set
        ? { key: keyOf(o), knobs: o.set }
        : null;

  function choose(o: AskOption, state: string | null) {
    if (readonly()) return;
    const hover = hoverDevice();
    if (!hover && s.preview()?.key !== keyOf(o)) {
      s.setPreview(previewOf(o, state));
      return;
    }
    s.pick(props.ask, o.id);
    s.setPreview(null);
    if (!hover || props.ask.multi) return;
    host().window.clearTimeout(timer());
    setTimer(
      host().window.setTimeout(() => {
        if (s.mode() !== "questions" || s.cur() !== props.index) return;
        if (!answerIds(s.answerOf(props.ask)).includes(o.id)) return;
        const next = s.nextStop(props.index);
        if (next !== null) s.goQuestion(next);
      }, ADVANCE_MS),
    );
  }

  return (
    <div class="qblock">
      <div class="nm">{askName(props.ask, m())}</div>
      <Show when={over()}>
        <div class="ovrline">
          {`Mix uses ${over()}'s ${props.ask.part} instead · `}
          <button type="button" class="lnk" onClick={() => s.undoMix(props.ask.part!)}>
            undo
          </button>
        </div>
      </Show>
      <div class="ask">{props.ask.text}</div>
      <div class="opts">
        <For each={props.ask.options}>
          {(o) => {
            const pic = () => optionPicture(s, props.ask, o);
            const state = () => askState(props.ask, m(), s.activeState());
            const focus = () => {
              const p = pic();
              if (!p || props.ask.scope !== "part") return null;
              return (
                partBox(s.reports[frameKey(p.state, p.variant.variant)], props.ask.part) ?? null
              );
            };
            return (
              <OptionCard
                picture={pic() ? <Thumb class="crop" src={pic()!.src} focus={focus()} /> : null}
                label={o.label}
                on={picked(o)}
                previewing={s.preview()?.key === keyOf(o)}
                data={o.id}
                onEnter={() => s.setPreview(previewOf(o, state()))}
                onLeave={() => s.preview()?.key === keyOf(o) && s.setPreview(null)}
                onChoose={() => choose(o, state())}
              />
            );
          }}
        </For>
      </div>
    </div>
  );
}

function MixBlock(props: { s: MockScreenState; index: number }) {
  const s = props.s;
  const look = () => s.lookPick() ?? "";
  // A borrowed part previews in the state that shows it, preferring this one.
  const stateFor = (o: MixOption) => {
    const has = (st: string | null) =>
      s
        .variants()
        .some((v) => v.state === st && v.variant === o.variant && v.parts.includes(o.part));
    return has(s.activeState()) ? s.activeState() : (s.states().find(has) ?? s.activeState());
  };
  const pictureOf = (variant: string, state: string | null) => {
    const v = s.variants().find((x) => x.state === state && x.variant === variant);
    const idx = v ? v.surfaces.findIndex((x) => x.kind === "html") : -1;
    if (!v || idx < 0) return null;
    return surfaceUrl(v.postId, idx, { version: s.frameVersionOf(v), mode: theme() });
  };
  function choose(key: string, apply: () => void, preview: () => void) {
    if (readonly()) return;
    if (!hoverDevice() && s.preview()?.key !== key) return preview();
    apply();
    s.setPreview(null);
  }
  const none = () => s.mixAnswered() && !Object.keys(s.draft()?.mix ?? {}).length;
  return (
    <div class="qblock">
      <div class="nm">Mix</div>
      <div class="ask">Keep anything from the other looks?</div>
      <div class="opts">
        <OptionCard
          picture={
            pictureOf(look(), s.activeState()) ? (
              <Thumb class="crop" src={pictureOf(look(), s.activeState())!} />
            ) : null
          }
          label={`No, all ${look()}`}
          on={none()}
          previewing={s.preview()?.key === "mix:none"}
          data="none"
          onEnter={() => s.setPreview(null)}
          onLeave={() => {}}
          onChoose={() =>
            choose(
              "mix:none",
              () => s.toggleMix(null),
              () => s.setPreview({ key: "mix:none" }),
            )
          }
        />
        <For each={s.mixOpts()}>
          {(o) => {
            const key = `mix:${o.part}:${o.variant}`;
            const state = () => stateFor(o);
            const preview = () => s.setPreview({ key, variant: o.variant, state: state() });
            const src = () => pictureOf(o.variant, state());
            const focus = () => partBox(s.reports[frameKey(state(), o.variant)], o.part) ?? null;
            return (
              <OptionCard
                picture={src() ? <Thumb class="crop" src={src()!} focus={focus()} /> : null}
                label={`${o.part} · ${o.variant}'s`}
                on={s.draft()?.mix[o.part] === o.variant}
                previewing={s.preview()?.key === key}
                data={`${o.part}:${o.variant}`}
                onEnter={preview}
                onLeave={() => s.preview()?.key === key && s.setPreview(null)}
                onChoose={() => choose(key, () => s.toggleMix(o), preview)}
              />
            );
          }}
        </For>
      </div>
    </div>
  );
}

function OptionCard(props: {
  picture: JSX.Element | null;
  label: string;
  on: boolean;
  previewing: boolean;
  data: string;
  onEnter: () => void;
  onLeave: () => void;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      class="opt"
      classList={{ on: props.on, pill: !props.picture, previewing: props.previewing }}
      aria-pressed={props.on}
      data-option={props.data}
      onPointerEnter={(e) => e.pointerType === "mouse" && props.onEnter()}
      onPointerLeave={(e) => e.pointerType === "mouse" && props.onLeave()}
      onClick={() => props.onChoose()}
    >
      {props.picture}
      <span class="lbl">{props.label}</span>
      <Show when={props.on}>
        <span class="tick">✓</span>
      </Show>
    </button>
  );
}

// A mock without asks: the plain verdict, sent as one reply (Q13).
function Decide(props: { s: MockScreenState }) {
  const s = props.s;
  const [note, setNote] = createSignal("");
  const decide = (kind: "accept" | "revise" | "drop") => {
    const v = s.activeVariant();
    if (!v) return;
    const text = note().trim();
    void s.send({
      decision: { kind, state: v.state, variant: v.variant },
      ...(text ? { text } : {}),
    });
    setNote("");
  };
  return (
    <div class="qblock">
      <div class="nm">{s.mock()?.title}</div>
      <div class="ask">
        {`No questions on this one. Decide on ${s.activeVariant()?.variant ?? "it"}:`}
      </div>
      <Show when={!readonly()}>
        <label class="up-text-row note">
          <span class="up-text-label">Note</span>
          <input
            class="up-text-input"
            placeholder="optional, for the agent"
            value={note()}
            onInput={(e) => setNote(e.currentTarget.value)}
          />
        </label>
        <div class="decide">
          <button
            type="button"
            class="primary"
            disabled={s.sending()}
            onClick={() => decide("accept")}
          >
            Accept
          </button>
          <button
            type="button"
            class="secondary"
            disabled={s.sending()}
            onClick={() => decide("revise")}
          >
            Revise
          </button>
          <button
            type="button"
            class="secondary"
            disabled={s.sending()}
            onClick={() => decide("drop")}
          >
            Drop
          </button>
        </div>
      </Show>
      <Show when={s.error()}>
        <div class="qerr" role="alert">
          {s.error()}
        </div>
      </Show>
    </div>
  );
}
