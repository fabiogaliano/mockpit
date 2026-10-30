// The pieces of a question answered in place, for the question card. Options
// are pictures when the viewer can render them (a variant that exists for the
// ask's state, or a knob set it can apply), pills otherwise. A mouse hovering
// one previews it on the stage; a tap puts it on the stage as your pick, and
// the same one again sends it on. Sent answers fold into a read-only Answered
// list, changed only through its "Change answer".

import { createSignal, createUniqueId, For, type JSX, Show } from "solid-js";
import { type Ask, type AskOption, type KnobValue, optionState } from "../../server/types.ts";
import { assetUrl, surfaceUrl, type VariantView } from "./api.ts";
import { ACCEPT, filesOf, hasFiles } from "./attach.ts";
import { readonly } from "./host.ts";
import { answerIds, askState, draftKnobValues, frameKey, isLookAsk, partBox } from "./logic.ts";
import type { AskField, MockScreenState } from "./state.ts";
import { theme } from "./theme.ts";
import { Thumb } from "./Thumb.tsx";

// A mock the user closed from the project list: what that did, and the way back.
export function ResolvedNote(props: { s: MockScreenState }) {
  return (
    <div class="resolved-note" role="status">
      <span>Closed. Questions still open were left unanswered, and your agent was told.</span>
      <Show when={!readonly()}>
        <button type="button" class="secondary" onClick={() => void props.s.reopen()}>
          Reopen
        </button>
      </Show>
    </div>
  );
}

// Sent answers, folded: read-only, each with the answer it got. Changing one
// is its own button, so a stray tap can't reopen it.
export function Answered(props: { s: MockScreenState; scope: "state" | "all" }) {
  const s = props.s;
  const [open, setOpen] = createSignal(false);
  const id = createUniqueId();
  const rows = () => s.closedAsks(props.scope);
  const said = (a: Ask) => {
    if (a.dismissed) return "Dismissed, not answered";
    const out = answerIds(a.answer).map((x) => a.options.find((o) => o.id === x)?.label ?? x);
    if (a.other !== undefined) out.push(a.other ? `“${a.other}”` : "an image");
    if (!out.length && a.note !== undefined) out.push("a note");
    return out.join(", ");
  };
  return (
    <Show when={rows().length}>
      <div class="answered">
        <button
          type="button"
          class="answered-hd"
          aria-expanded={open()}
          aria-controls={id}
          onClick={() => setOpen(!open())}
        >
          <span class="answered-chev" aria-hidden="true">
            ›
          </span>
          {`Answered · ${rows().length}`}
        </button>
        <Show when={open()}>
          <ul class="answered-list" id={id}>
            <For each={rows()}>
              {(a) => (
                <li class="answered-row" data-answered={a.id}>
                  <span class="review-text">
                    <span class="review-name">{a.text}</span>
                    <span class="review-said" classList={{ dismissed: !!a.dismissed }}>
                      {said(a)}
                    </span>
                    <Show when={a.note && !a.dismissed}>
                      <span class="answered-note">{`Note: ${a.note}`}</span>
                    </Show>
                  </span>
                  <Show when={!readonly() && !a.dismissed}>
                    <button
                      type="button"
                      class="secondary answered-change"
                      aria-label={`Change answer: ${a.text}`}
                      onClick={() => s.changeAnswer(a)}
                    >
                      Change answer
                    </button>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </Show>
  );
}

// What a picture of this variant shows besides the option itself: the draft's
// knob values (defaults, other answers, tuning), the same ones the stage shows.
// A picture that ignored them would show a screen the user never chose.
function draftValues(s: MockScreenState, v: VariantView): Record<string, KnobValue> {
  const m = s.mock();
  return m ? draftKnobValues(m, v.knobs, s.draft()) : {};
}

// The option's picture source and the knob values it shows, or null when it can
// only be a pill.
export function optionPicture(
  s: MockScreenState,
  ask: Ask,
  o: AskOption,
): {
  src: string;
  knobs: Record<string, KnobValue>;
  variant: VariantView;
  state: string | null;
} | null {
  const m = s.mock();
  if (!m) return null;
  const state = o.version ? optionState(ask, m) : askState(ask, m, s.activeState());
  const html = (v: VariantView | undefined) => {
    if (!v) return -1;
    return v.surfaces.findIndex((x) => x.kind === "html");
  };
  if (o.variant) {
    const v = s.variants().find((x) => x.state === state && x.variant === o.variant);
    const idx = html(v);
    if (!v || idx < 0) return null;
    return {
      src: surfaceUrl(v.postId, idx, {
        version: o.version ?? s.frameVersionOf(v),
        mode: theme(),
        e: v.embedsKey,
      }),
      knobs: draftValues(s, v),
      variant: v,
      state,
    };
  }
  if (o.set && Object.keys(o.set).length) {
    const v = s.variantFor(state, false);
    const idx = html(v);
    if (!v || idx < 0) return null;
    return {
      // The URL bakes only the option's own values so it stays stable while the
      // rest of the draft changes; those arrive through `knobs`.
      src: surfaceUrl(v.postId, idx, {
        version: s.frameVersionOf(v),
        mode: theme(),
        knobs: o.set,
        e: v.embedsKey,
      }),
      knobs: { ...draftValues(s, v), ...o.set },
      variant: v,
      state,
    };
  }
  return null;
}

// One question's body on the card: why it waits or is skipped, its options,
// and the write-in and note under them. The question's words are the card's head.
export function AskBody(props: { s: MockScreenState; ask: Ask; noteOpen?: boolean }) {
  const s = props.s;
  const picked = (o: AskOption) => answerIds(s.answerOf(props.ask)).includes(o.id);
  const keyOf = (o: AskOption) => s.optionKey(props.ask, o.id);
  const slot = () => s.askSlot(props.ask);
  const dormant = () => s.dormantOf(props.ask);
  // The region the pictures crop to: the slot the ask chooses, else its part.
  const region = () => slot()?.part ?? (props.ask.scope === "part" ? props.ask.part : undefined);
  const askAt = (id: string) => s.questions().findIndex((q) => q.kind === "ask" && q.ask.id === id);
  const parentAsk = () => {
    const d = dormant();
    return d
      ? s.questions().findIndex((q) => q.kind === "ask" && s.askSlot(q.ask)?.part === d.part)
      : -1;
  };
  return (
    <div class="qblock">
      <Show when={s.revisingOf(props.ask)}>
        <div class="revising" role="status">
          <span>{"Changing a sent answer. A new pick goes out with your next Send."}</span>
          <button type="button" class="lnk" onClick={() => s.keepAnswer(props.ask)}>
            Keep sent answer
          </button>
        </div>
      </Show>
      <Show when={s.waitingOn(props.ask)}>
        {(before) => (
          <div class="dormant" role="status">
            {"Opens after "}
            <b>{before().text}</b>
            <Show when={askAt(before().id) >= 0}>
              <button type="button" class="lnk" onClick={() => s.goQuestion(askAt(before().id))}>
                {`Go to question ${askAt(before().id) + 1}`}
              </button>
            </Show>
          </div>
        )}
      </Show>
      <Show when={s.shownWith(props.ask)}>
        {(w) => (
          <div class="qwith">
            <span class="qwith-chip">
              {`With ${w().labels}`}
              <Show when={askAt(w().ask.id) >= 0}>
                <button type="button" class="lnk" onClick={() => s.goQuestion(askAt(w().ask.id))}>
                  change
                </button>
              </Show>
            </span>
          </div>
        )}
      </Show>
      <Show when={dormant()}>
        {(d) => (
          <div class="dormant" role="status">
            {"Only for "}
            <b>{d().label}</b>
            {": inactive, and not sent while that part shows something else."}
            <Show when={parentAsk() >= 0}>
              <button type="button" class="lnk" onClick={() => s.goQuestion(parentAsk())}>
                {`Go to question ${parentAsk() + 1}`}
              </button>
            </Show>
          </div>
        )}
      </Show>
      <div
        class="opts"
        role="group"
        aria-label={props.ask.text}
        classList={{ asleep: !!dormant(), waiting: !!s.waitingOn(props.ask) }}
      >
        <For each={props.ask.options}>
          {(o, i) => {
            const pic = () => optionPicture(s, props.ask, o);
            const focus = () => {
              const p = pic();
              const r = region();
              if (!p || !r) return null;
              return partBox(s.reports[frameKey(p.state, p.variant.variant)], r) ?? null;
            };
            const card = () => (
              <OptionCard
                picture={
                  pic() ? (
                    <Thumb
                      width={s.frameW()}
                      class="crop"
                      fit
                      src={pic()!.src}
                      knobs={pic()!.knobs}
                      focus={focus()}
                      whole={!focus()}
                    />
                  ) : null
                }
                label={o.label}
                pick={!!o.recommended}
                why={pic()?.variant.note}
                on={picked(o)}
                previewing={s.preview()?.key === keyOf(o)}
                data={o.id}
                shortcut={i() < 9 ? String(i() + 1) : undefined}
                onEnter={() => s.setPreview(s.previewOf(props.ask, o.id))}
                onLeave={() => s.preview()?.key === keyOf(o) && s.setPreview(null)}
                onChoose={() => s.choose(props.ask, o.id)}
              />
            );
            // D13: once the Look is sent its losers are archived; each stays restorable.
            const archivedIn = () => {
              if (!isLookAsk(props.ask) || props.ask.answer === undefined || !o.variant) return [];
              const mine = s.variants().filter((v) => v.variant === o.variant);
              return mine.length && mine.every((v) => v.status === "archived")
                ? mine.map((v) => v.state)
                : [];
            };
            // A dropped look is gone from the choice.
            const dropped = () => {
              if (!o.variant) return false;
              const mine = s.variants().filter((v) => v.variant === o.variant);
              return mine.length > 0 && mine.every((v) => v.status === "dropped");
            };
            return (
              <Show when={!dropped()}>
                <Show when={archivedIn().length} fallback={card()}>
                  <div class="opt-arch" data-archived={o.variant}>
                    {card()}
                    <Show when={!readonly()}>
                      <button
                        type="button"
                        class="vrestore"
                        aria-label={`Restore ${o.label}`}
                        onClick={() => void s.restoreVariant(o.variant!, archivedIn())}
                      >
                        restore
                      </button>
                    </Show>
                  </div>
                </Show>
              </Show>
            );
          }}
        </For>
        <OptionCard
          picture={null}
          label="Other…"
          other
          on={s.otherTicked(props.ask)}
          previewing={false}
          data="other"
          shortcut={props.ask.options.length < 9 ? String(props.ask.options.length + 1) : undefined}
          onEnter={() => s.setPreview(null)}
          onLeave={() => {}}
          onChoose={() => !readonly() && s.pick(props.ask, null)}
        />
      </div>
      <Show when={s.otherTicked(props.ask)}>
        <AskText
          s={s}
          ask={props.ask}
          field="other"
          class="other-text"
          label="Your answer"
          value={s.otherOf(props.ask) ?? ""}
          placeholder="none of these fit? say what would"
          focus={s.otherOf(props.ask) === undefined}
          onInput={(v) => s.setOther(props.ask, v)}
        />
      </Show>
      <AskNote s={s} ask={props.ask} open={props.noteOpen} />
    </div>
  );
}

// A note on the question, opened from the card's note button; open on its own
// once a note exists, so an unused one costs nothing.
function AskNote(props: { s: MockScreenState; ask: Ask; open?: boolean }) {
  const s = props.s;
  return (
    <Show when={props.open || s.noteOf(props.ask) !== undefined}>
      <AskText
        s={s}
        ask={props.ask}
        field="note"
        class="ask-note"
        label="Note"
        value={s.noteOf(props.ask) ?? ""}
        placeholder="e.g. Table on desktop, Cards on mobile"
        focus={!!props.open && s.noteOf(props.ask) === undefined}
        onInput={(v) => s.setNote(props.ask, v)}
      />
    </Show>
  );
}

// A write-in or a note, with images like a chat composer: attach with the
// button, paste, or drop onto the box. Each image uploads as soon as it's
// added; its × removes it.
function AskText(props: {
  s: MockScreenState;
  ask: Ask;
  field: AskField;
  class: string;
  label: string;
  value: string;
  placeholder: string;
  focus: boolean;
  onInput: (v: string) => void;
}) {
  const s = props.s;
  const id = createUniqueId();
  let textarea: HTMLTextAreaElement | undefined;
  let picker: HTMLInputElement | undefined;
  let list: HTMLUListElement | undefined;
  // Counted, because dragenter/dragleave fire for every child crossed.
  const [over, setOver] = createSignal(0);
  const images = () => s.imagesOf(props.ask, props.field);
  const pending = () => s.pendingOf(props.ask, props.field);
  const attach = (files: File[]) => void s.attachImages(props.ask, props.field, files);
  const folded = () => s.foldedOf(props.ask, props.field);
  // Only something written is worth folding away; an empty box has nothing to keep.
  const foldable = () => !!props.value.trim() || images().length > 0;
  // Unfolding remounts the field, which should then take the caret.
  const [unfolded, setUnfolded] = createSignal(false);
  const fold = (on: boolean) => {
    setUnfolded(!on);
    s.setFolded(props.ask, props.field, on);
  };
  // Focus stays in the tray after a removal: the next chip, else the one
  // before, else the text.
  const refocus = (index: number) =>
    queueMicrotask(() => {
      const xs = list?.querySelectorAll<HTMLButtonElement>(".attach-x") ?? [];
      (xs[index] ?? xs[index - 1] ?? textarea)?.focus();
    });
  const drag = (e: DragEvent) => {
    if (readonly() || !hasFiles(e.dataTransfer)) return false;
    e.preventDefault();
    return true;
  };
  return (
    <Show
      when={!(folded() && foldable())}
      fallback={<FoldedText {...props} onOpen={() => fold(false)} />}
    >
      <div
        class={`asktext ${props.class}`}
        classList={{ dropping: over() > 0 }}
        onDragEnter={(e) => drag(e) && setOver(over() + 1)}
        onDragOver={(e) => {
          if (drag(e) && e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(e) => drag(e) && setOver(Math.max(0, over() - 1))}
        onDrop={(e) => {
          if (!drag(e)) return;
          setOver(0);
          attach(filesOf(e.dataTransfer, "drop"));
        }}
      >
        <div class="asktext-head">
          <label class="up-text-label" for={id}>
            {props.label}
          </label>
          <Show when={foldable()}>
            <button
              type="button"
              class="asktext-fold"
              aria-label={`Minimize ${props.label.toLowerCase()}`}
              title="Minimize"
              onClick={() => fold(true)}
            >
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="M3 7.5l3-3 3 3" />
              </svg>
            </button>
          </Show>
        </div>
        <textarea
          id={id}
          rows={2}
          maxLength={8000}
          placeholder={props.placeholder}
          value={props.value}
          readOnly={readonly()}
          ref={(el) => {
            textarea = el;
            if (props.focus || unfolded()) queueMicrotask(() => el.focus());
          }}
          onInput={(e) => props.onInput(e.currentTarget.value)}
          onPaste={(e) => {
            if (readonly()) return;
            const files = filesOf(e.clipboardData, "paste");
            // Text pastes as text; only a paste that carries images is ours.
            if (!files.length) return;
            e.preventDefault();
            attach(files);
          }}
        />
        <Show when={images().length || pending().length || !readonly()}>
          <div class="attach-row">
            <ul
              class="attach-list"
              ref={(el) => (list = el)}
              aria-label={`Attached images, ${images().length + pending().length}`}
            >
              <For each={images()}>
                {(asset, i) => (
                  <li class="attach-item">
                    <img src={assetUrl(asset)} alt="" />
                    <Show when={!readonly()}>
                      <button
                        type="button"
                        class="attach-x"
                        aria-label={`Remove image ${i() + 1}`}
                        onClick={() => {
                          s.detachImage(props.ask, props.field, asset);
                          refocus(i());
                        }}
                      >
                        <XIcon />
                      </button>
                    </Show>
                  </li>
                )}
              </For>
              <For each={pending()}>
                {(p, i) => (
                  <li class="attach-item" classList={{ pending: !p.error, failed: !!p.error }}>
                    <img src={p.url} alt="" />
                    <Show when={p.error}>
                      <span class="attach-err" title={p.error}>
                        !
                      </span>
                    </Show>
                    <button
                      type="button"
                      class="attach-x"
                      aria-label={p.error ? `Dismiss ${p.name}: ${p.error}` : `Cancel ${p.name}`}
                      onClick={() => {
                        s.dismissPending(props.ask, props.field, p.key);
                        refocus(images().length + i());
                      }}
                    >
                      <XIcon />
                    </button>
                  </li>
                )}
              </For>
            </ul>
            <Show when={!readonly()}>
              <button
                type="button"
                class="attach-btn"
                aria-label="Attach images"
                title="Attach images — or paste, or drop them here"
                onClick={() => picker?.click()}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M8 3v10M3 8h10" />
                </svg>
              </button>
              <input
                ref={(el) => (picker = el)}
                type="file"
                accept={ACCEPT}
                multiple
                hidden
                onChange={(e) => {
                  attach(Array.from(e.currentTarget.files ?? []));
                  // Picking the same file again must still fire change.
                  e.currentTarget.value = "";
                }}
              />
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}

// A folded write-in or note: one line of what was written, the whole row
// opens it again.
function FoldedText(props: {
  s: MockScreenState;
  ask: Ask;
  field: AskField;
  class: string;
  label: string;
  value: string;
  onOpen: () => void;
}) {
  const n = () => props.s.imagesOf(props.ask, props.field).length;
  return (
    <button
      type="button"
      class={`asktext asktext-folded ${props.class}`}
      aria-expanded="false"
      aria-label={`${props.label}: ${props.value.trim() || "no text"}. Expand`}
      onClick={props.onOpen}
    >
      <span class="up-text-label">{props.label}</span>
      <span class="asktext-gist">{props.value.trim()}</span>
      <Show when={n()}>
        <span class="asktext-count">{`${n()} ${n() === 1 ? "image" : "images"}`}</span>
      </Show>
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M3 4.5l3 3 3-3" />
      </svg>
    </button>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  );
}

function OptionCard(props: {
  picture: JSX.Element | null;
  other?: boolean;
  label: string;
  // What the look is, in the agent's words, under its name.
  note?: string;
  // The agent's own pick: a dot in the corner, the why on hover.
  pick?: boolean;
  why?: string;
  on: boolean;
  previewing: boolean;
  data: string;
  shortcut?: string;
  onEnter: () => void;
  onLeave: () => void;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      class="opt"
      classList={{
        on: props.on,
        pill: !props.picture,
        other: !!props.other,
        previewing: props.previewing,
      }}
      // The card truncates its label to one line; hover reads it whole.
      title={[
        props.label,
        props.note,
        props.pick ? (props.why ? `Agent's pick: ${props.why}` : "Agent's pick") : null,
      ]
        .filter(Boolean)
        .join("\n")}
      aria-pressed={props.on}
      aria-keyshortcuts={props.shortcut}
      data-option={props.data}
      onPointerEnter={(e) => e.pointerType === "mouse" && props.onEnter()}
      onPointerLeave={(e) => e.pointerType === "mouse" && props.onLeave()}
      onClick={() => props.onChoose()}
    >
      {props.picture}
      <span class="lbl">{props.label}</span>
      <Show when={props.note}>
        <span class="onote">{props.note}</span>
      </Show>
      <Show when={props.on}>
        <span class="tick">✓</span>
      </Show>
      <Show when={props.pick}>
        <span class="pickdot" aria-hidden="true" />
        <span class="sr-only">, agent's pick</span>
      </Show>
    </button>
  );
}
