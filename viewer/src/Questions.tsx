// The pieces of a question answered in place, for the question card. Options
// are pictures when the viewer can render them (an alternative that exists for the
// ask's state, or a knob set it can apply), pills otherwise. A mouse hovering
// one previews it on the stage, unless its question is about another state; a tap
// puts it on the stage as your pick, and
// the same one again sends it on. Sent answers fold into a read-only Answered
// list, changed only through its "Change answer".

import {
  createEffect,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  onCleanup,
  Show,
} from "solid-js";
import { type Ask, type AskOption, type KnobValue, optionState } from "../../server/types.ts";
import { assetUrl, surfaceUrl, type AlternativeView } from "./api.ts";
import { ACCEPT, filesOf, hasFiles } from "./attach.ts";
import { answersView } from "./answersView.ts";
import { host, readonly, root } from "./host.ts";
import {
  answerIds,
  askState,
  draftKnobValues,
  frameKey,
  isLookAsk,
  moreAllowed,
  partBox,
  splitLabel,
} from "./logic.ts";
import type { AskField, DesignScreenState } from "./state.ts";
import { Reason } from "./Reason.tsx";
import { route } from "./route.ts";
import { frameMode } from "./systemRev.ts";
import { Thumb } from "./Thumb.tsx";
import { ArchivedGhost } from "./ArchivedGhost.tsx";
import { Icon } from "./icons.tsx";
import { AnswerAlternativeTools, answerAlternative, answerFrame } from "./Alternatives.tsx";
import { answerActions, FACE } from "./frameActions.ts";
import type { Shortlists } from "./shortlist.ts";

// Long enough that a pointer crossing the list on its way somewhere previews nothing.
const HOLD_MS = 750;
const LIST_ABOVE = 4;

// A design the user archived: what that did, the way back, and why, if they want to say.
export function ArchivedNote(props: { s: DesignScreenState }) {
  return (
    <div class="status-note" role="status">
      <span title="Open questions come back with it">Archived</span>
      <Reason value={props.s.design()?.archiveReason} onSave={props.s.saveEndReason} />
      <Show when={!readonly()}>
        <button type="button" class="secondary" onClick={() => void props.s.reopen()}>
          Restore
        </button>
      </Show>
    </div>
  );
}

// What a sent question got, in words.
export const saidOf = (a: Ask) => {
  if (a.dismissed) return "Dismissed, not answered";
  const out = answerIds(a.answer).map((x) => a.options.find((o) => o.id === x)?.label ?? x);
  if (a.other !== undefined) out.push(a.other ? `“${a.other}”` : "an image");
  if (!out.length && a.comment !== undefined) out.push("a comment");
  return out.join(", ");
};

// Sent answers, folded: read-only, each with the answer it got. Changing one
// is its own button, so a stray tap can't reopen it.
export function Answered(props: {
  s: DesignScreenState;
  scope: "state" | "all";
  // Shown whole above, with their pictures: not listed again here.
  except?: string[];
}) {
  const s = props.s;
  const [open, setOpen] = createSignal(false);
  const id = createUniqueId();
  const rows = () => s.closedAsks(props.scope).filter((a) => !props.except?.includes(a.id));
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
                      {saidOf(a)}
                    </span>
                    <Show when={a.comment && !a.dismissed}>
                      <span class="answered-note">
                        <span class="sr-only">Comment: </span>
                        {a.comment}
                      </span>
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

// What a picture of this alternative shows besides the option itself: the draft's
// knob values (defaults, other answers, tuning), the same ones the stage shows.
// A picture that ignored them would show a screen the user never chose.
function draftValues(s: DesignScreenState, v: AlternativeView): Record<string, KnobValue> {
  const m = s.design();
  return m ? draftKnobValues(m, v, s.draft()) : {};
}

// Picking one answer replaces the others, so a picture of it doesn't show theirs.
function withoutSiblings(
  values: Record<string, KnobValue>,
  ask: Ask,
  o: AskOption,
): Record<string, KnobValue> {
  if (ask.multi) return values;
  const out = { ...values };
  for (const other of ask.options) {
    if (other.id === o.id) continue;
    for (const path of Object.keys(other.set ?? {})) delete out[path];
  }
  return out;
}

// The option's picture source and the knob values it shows, or null when it can
// only be a pill.
export function optionPicture(
  s: DesignScreenState,
  ask: Ask,
  o: AskOption,
  // Another state to picture it on than the one it would show on now.
  at?: string | null,
): {
  src: string;
  knobs: Record<string, KnobValue>;
  alternative: AlternativeView;
  state: string | null;
} | null {
  const m = s.design();
  if (!m) return null;
  const state = o.version
    ? optionState(ask, m)
    : at !== undefined
      ? at
      : askState(ask, m, s.activeState());
  const html = (v: AlternativeView | undefined) => {
    if (!v) return -1;
    return v.surfaces.findIndex((x) => x.kind === "html");
  };
  if (o.alternative) {
    const v = s.alternatives().find((x) => x.state === state && x.alternative === o.alternative);
    const idx = html(v);
    if (!v || idx < 0) return null;
    return {
      src: surfaceUrl(v.postId, idx, {
        version: o.version ?? s.frameVersionOf(v),
        mode: frameMode(),
        e: v.instancesKey,
        w: v.rewrites,
      }),
      knobs: withoutSiblings(draftValues(s, v), ask, o),
      alternative: v,
      state,
    };
  }
  if (o.palette) {
    const v = s.alternativeFor(state, false);
    const idx = html(v);
    if (!v || idx < 0) return null;
    return {
      src: surfaceUrl(v.postId, idx, {
        version: s.frameVersionOf(v),
        mode: frameMode(),
        e: v.instancesKey,
        w: v.rewrites,
        p: o.palette,
      }),
      knobs: withoutSiblings(draftValues(s, v), ask, o),
      alternative: v,
      state,
    };
  }
  if (o.set && Object.keys(o.set).length) {
    const v = s.alternativeFor(state, false);
    const idx = html(v);
    if (!v || idx < 0) return null;
    return {
      // The URL bakes only the option's own values so it stays stable while the
      // rest of the draft changes; those arrive through `knobs`.
      src: surfaceUrl(v.postId, idx, {
        version: s.answersBaseOf(v),
        mode: frameMode(),
        knobs: o.set,
        e: v.instancesKey,
        w: v.rewrites,
      }),
      knobs: { ...withoutSiblings(draftValues(s, v), ask, o), ...o.set },
      alternative: v,
      state,
    };
  }
  return null;
}

// One question's body on the card: why it waits or is skipped, its options, each with
// what can be done with it, and the write-in. The question's words are the card's head.
export function AskBody(props: {
  s: DesignScreenState;
  ask: Ask;
  // For Move on an alternative answer; without it, the answer offers no Move.
  sl?: Shortlists;
  // Beside the design a picture has the room to be read: filled and cropped from
  // the top, rather than a whole page shrunk into a chip.
  beside?: boolean;
  // Every answer is already on the canvas side by side: hovering one shows nothing new.
  still?: boolean;
}) {
  const s = props.s;
  const picked = (o: AskOption) => answerIds(s.answerOf(props.ask)).includes(o.id);
  let optsEl: HTMLDivElement | undefined;
  const moveCards = (change: () => void, gone?: Element | null) => flipCards(optsEl, change, gone);
  const keyOf = (o: AskOption) => s.optionKey(props.ask, o.id);
  const sheetOpen = () => {
    if (s.sheet.view()) return true;
    const r = route();
    return r.screen === "design" && !!r.sheet && !("value" in r.sheet && r.sheet.value);
  };
  const [preview, setPreview] = createSignal<string | null>(null);
  createEffect(() => {
    if (!sheetOpen()) setPreview(null);
  });
  // Which answer's alternative Borrow or Move is open for.
  const [tool, setTool] = createSignal<{
    option: string;
    borrowing: boolean;
    moving: HTMLElement | null;
  } | null>(null);
  // What the answer's row offers is its frame's action set, routed through the question
  // (frameActions.ts). An answer picked before it lost its design still shows the mark.
  const actionsOf = (o: AskOption) => {
    const can = answerActions(s, props.ask, o, {
      dormant: !!dormant(),
      frame: answerFrame(s, o.alternative),
    });
    if (!can || !("curate" in can)) return can;
    return {
      picked: can.picked,
      comment: {
        value: s.answerCommentOf(props.ask, o.id),
        onInput: (v: string) => s.setAnswerComment(props.ask, o.id, v),
      },
      ...(can.curate && {
        onPick: () => moveCards(() => s.togglePicked(props.ask, o)),
        onHide: (card: Element | null, key: boolean) =>
          moveCards(() => s.hideAnswer(props.ask, o), key ? null : card),
      }),
      ...(can.like && { onLike: () => void s.askMore(props.ask, "", o) }),
      ...(can.borrow && {
        onBorrow: () => setTool({ option: o.id, borrowing: true, moving: null }),
      }),
      ...(can.move &&
        props.sl && {
          onMove: (anchor: HTMLElement) =>
            setTool({ option: o.id, borrowing: false, moving: anchor }),
        }),
    };
  };
  const toolsFor = (o: AskOption) => {
    const t = tool();
    const step = t?.option === o.id && answerAlternative(s, o.alternative);
    return step ? (
      <AnswerAlternativeTools
        s={s}
        sl={props.sl}
        step={step}
        borrowing={t.borrowing}
        moving={t.moving}
        onDone={() => setTool(null)}
      />
    ) : undefined;
  };
  // The answer just archived, here or as the frame it names, keeps its place a moment as
  // its ghost: in its card while that still shows, else before the answer that followed it
  // (null: after the last).
  const ghostOption = () => {
    const g = s.ghost();
    if (!g) return undefined;
    return props.ask.options.find(
      (o) =>
        (g.answer?.ask === props.ask.id && g.answer.option === o.id) ||
        (!!o.alternative && g.frames.some((f) => f.alternative === o.alternative)),
    );
  };
  const ghostBefore = (): string | null | undefined => {
    const gone = ghostOption();
    const shown = s.shownOptions(props.ask);
    if (!gone || shown.some((o) => o.id === gone.id)) return undefined;
    const all = props.ask.options;
    const at = all.indexOf(gone);
    return shown.find((o) => all.indexOf(o) > at)?.id ?? null;
  };
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
          <span>Changing a sent answer</span>
          <button
            type="button"
            class="lnk"
            title="Keep the sent answer"
            onClick={() => s.keepAnswer(props.ask)}
          >
            Undo
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
      <Show when={dormant()}>
        {(d) => (
          <div class="dormant" role="status">
            {"Only when "}
            <b>{d().label}</b>
            {" is chosen"}
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
        ref={(el) => (optsEl = el)}
        role="group"
        aria-label={props.ask.text}
        classList={{
          asleep: !!dormant(),
          waiting: !!s.waitingOn(props.ask),
          aslist: !!props.beside && listed(s, props.ask) && answersView() === "list",
        }}
      >
        <For each={s.shownOptions(props.ask)}>
          {(o, i) => {
            const pic = () => optionPicture(s, props.ask, o);
            const showing = () => preview() === keyOf(o);
            const focus = () => {
              const p = pic();
              if (!p) return null;
              const report = s.reports[frameKey(p.state, p.alternative.alternative)];
              // An answer that sets a part's swap changes only that part: a whole-page
              // picture could crop it off, leaving a card that looks like its neighbours.
              const r = region() ?? Object.keys(o.set ?? {}).find((path) => partBox(report, path));
              return r ? (partBox(report, r) ?? null) : null;
            };
            const card = () => (
              <OptionCard
                picture={
                  (!sheetOpen() || showing()) && pic() ? (
                    <Thumb
                      first
                      width={s.frameW()}
                      class={s.frameW() > 600 ? "crop flat" : "crop"}
                      fit
                      src={pic()!.src}
                      knobs={pic()!.knobs}
                      focus={focus()}
                      whole={!focus() && !props.beside}
                    />
                  ) : null
                }
                label={o.label}
                note={o.added ? "Not in the agent's question" : undefined}
                pick={!!o.recommended}
                why={pic()?.alternative.description}
                on={picked(o)}
                held={s.heldPreview()?.key === keyOf(o)}
                isNew={s.isNewOption(props.ask, o.id)}
                data={o.id}
                shortcut={i() < 9 ? String(i() + 1) : undefined}
                onEnter={() =>
                  !sheetOpen() && !props.still && s.setHoveredPreview(s.previewOf(props.ask, o.id))
                }
                onLeave={() => s.hoveredPreview()?.key === keyOf(o) && s.setHoveredPreview(null)}
                onHold={
                  !sheetOpen() && !props.still && s.previewOf(props.ask, o.id)
                    ? () => s.setHeldPreview(s.previewOf(props.ask, o.id))
                    : undefined
                }
                onChoose={() => s.choose(props.ask, o.id)}
                compact={!props.beside}
                actions={actionsOf(o)}
                preview={
                  sheetOpen() && pic() ? (
                    <button
                      type="button"
                      class="lnk opt-preview"
                      aria-label={`${showing() ? "Hide preview of" : "Preview"} ${o.label}`}
                      aria-expanded={showing()}
                      onClick={() => setPreview(showing() ? null : keyOf(o))}
                    >
                      {showing() ? "Hide preview" : "Preview"}
                    </button>
                  ) : undefined
                }
                below={toolsFor(o)}
              />
            );
            // D13: once the Look is sent its losers are archived; each stays restorable.
            const archivedIn = () => {
              if (!isLookAsk(props.ask) || props.ask.answer === undefined || !o.alternative)
                return [];
              const mine = s.alternatives().filter((v) => v.alternative === o.alternative);
              return mine.length && mine.every((v) => v.status === "archived")
                ? mine.map((v) => v.state)
                : [];
            };
            return (
              <>
                <Show when={ghostBefore() === o.id}>
                  <ArchivedGhost s={s} line={s.ghost()!} card />
                </Show>
                <Show
                  when={ghostOption()?.id !== o.id}
                  fallback={<ArchivedGhost s={s} line={s.ghost()!} card />}
                >
                  <Show when={archivedIn().length} fallback={card()}>
                    <div class="opt-arch" data-archived={o.alternative}>
                      {card()}
                      <Show when={!readonly()}>
                        <button
                          type="button"
                          class="vrestore"
                          aria-label={`Restore ${o.label}`}
                          onClick={() => void s.restoreAlternative(o.alternative!, archivedIn())}
                        >
                          Restore
                        </button>
                      </Show>
                    </div>
                  </Show>
                </Show>
              </>
            );
          }}
        </For>
        <Show when={ghostBefore() === null}>
          <ArchivedGhost s={s} line={s.ghost()!} card />
        </Show>
        {/* A row of their own, so neither stretches to a picture's height. */}
        <div class="opts-tail">
          <Show when={!readonly()}>
            <OptionCard
              picture={null}
              label="Other…"
              other
              on={s.otherTicked(props.ask)}
              data="other"
              shortcut={
                s.shownOptions(props.ask).length < 9
                  ? String(s.shownOptions(props.ask).length + 1)
                  : undefined
              }
              onEnter={() => s.setHoveredPreview(null)}
              onLeave={() => {}}
              onChoose={() => s.pick(props.ask, null)}
            />
          </Show>
          <MoreAnswersCard s={s} ask={props.ask} />
        </div>
        <HiddenAnswers s={s} ask={props.ask} move={moveCards} />
      </div>
      <Show when={!readonly() && moreAllowed(props.ask) && !dormant()}>
        <MoreAnswers s={s} ask={props.ask} />
      </Show>
      <Show when={s.otherTicked(props.ask)}>
        <AskText
          s={s}
          ask={props.ask}
          field="other"
          class="other-text"
          label="Your answer"
          value={s.otherOf(props.ask) ?? ""}
          placeholder="Say what would fit"
          focus={s.otherOf(props.ask) === undefined}
          onInput={(v) => s.setOther(props.ask, v)}
        />
      </Show>
      <AskNote s={s} ask={props.ask} />
    </div>
  );
}

// A comment on the whole question. Comments now go on single answers, so this shows only
// one written before, or one an agent's tier set, until it is cleared.
function AskNote(props: { s: DesignScreenState; ask: Ask }) {
  const s = props.s;
  return (
    <Show when={s.commentOf(props.ask) !== undefined}>
      <AskText
        s={s}
        ask={props.ask}
        field="comment"
        class="ask-note"
        label="Comment"
        value={s.commentOf(props.ask) ?? ""}
        placeholder="Comment…"
        focus={false}
        onInput={(v) => s.setComment(props.ask, v)}
      />
    </Show>
  );
}

// A write-in or a comment, with images like a chat composer: attach with the
// button, paste, or drop onto the box. Each image uploads as soon as it's
// added; its × removes it.
function AskText(props: {
  s: DesignScreenState;
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

// A folded write-in or comment: one line of what was written, the whole row
// opens it again.
function FoldedText(props: {
  s: DesignScreenState;
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

// Whether a question offers enough pictures for a list to be worth having.
export const listed = (s: DesignScreenState, ask: Ask) =>
  ask.options.length > LIST_ABOVE && ask.options.some((o) => optionPicture(s, ask, o));

// The question whose More answers box is open: its card is the last of the answers, the
// box under them.
const [moreFor, setMoreFor] = createSignal<string | null>(null);

// Asks for more answers to a question, a card after its answers; shown only where the
// agent can.
function MoreAnswersCard(props: { s: DesignScreenState; ask: Ask }) {
  const s = props.s;
  const can = () =>
    !readonly() && moreAllowed(props.ask) && !s.dormantOf(props.ask) && !s.moreWaiting(props.ask);
  return (
    <Show when={can()}>
      <button
        type="button"
        class="opt pill other more"
        classList={{ on: s.moreDrafted(props.ask) }}
        aria-pressed={s.moreDrafted(props.ask)}
        aria-expanded={moreFor() === props.ask.id}
        title={s.moreDrafted(props.ask) ? "In Send. Click to take it back" : undefined}
        onClick={() => {
          if (s.moreDrafted(props.ask)) return s.dropMore(props.ask);
          setMoreFor(moreFor() === props.ask.id ? null : props.ask.id);
        }}
      >
        <Icon name="plus" />
        <span class="lbl">More answers</span>
      </button>
    </Show>
  );
}

// None of the answers fit: ask for more without answering. The request waits in Send
// with whatever else is drafted.
function MoreAnswers(props: { s: DesignScreenState; ask: Ask }) {
  const s = props.s;
  const open = () => moreFor() === props.ask.id;
  const setOpen = (on: boolean) => setMoreFor(on ? props.ask.id : null);
  const [note, setNote] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const around = () => s.answeredAround(props.ask);
  const kept = () =>
    props.ask.options.filter((o) => s.isPicked(props.ask, o.id)).map((o) => o.label);
  async function ask() {
    setSending(true);
    const sent = await s.askMore(props.ask, note().trim());
    setSending(false);
    if (!sent) return;
    setOpen(false);
    setNote("");
  }
  return (
    <Show
      when={!s.moreWaiting(props.ask)}
      fallback={
        <p class="morewait" role="status">
          More answers on the way
        </p>
      }
    >
      <Show when={open() && !s.moreDrafted(props.ask)}>
        <div
          class="morebox"
          role="group"
          aria-label="Ask for more answers"
          ref={(el) => host().window.setTimeout(() => el.scrollIntoView({ block: "nearest" }))}
        >
          <dl>
            <Show when={around().length}>
              <dt>Given</dt>
              <dd>{around().join(" · ")}</dd>
            </Show>
            <Show when={kept().length}>
              <dt>Like</dt>
              <dd>{kept().join(" · ")}</dd>
            </Show>
            <Show when={s.hiddenOptions(props.ask).length}>
              <dt>Not like</dt>
              <dd>
                {s
                  .hiddenOptions(props.ask)
                  .map((o) => o.label)
                  .join(" · ")}
              </dd>
            </Show>
            <dt>Excluding</dt>
            <dd>{`These ${props.ask.options.length}`}</dd>
          </dl>
          <textarea
            aria-label="What to aim for"
            placeholder="What to aim for (optional)"
            value={note()}
            ref={(el) => host().window.setTimeout(() => el.focus({ preventScroll: true }))}
            onInput={(e) => setNote(e.currentTarget.value)}
          />
          <div class="morebox-acts">
            <button type="button" class="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" class="btn go" disabled={sending()} onClick={() => void ask()}>
              Ask
            </button>
          </div>
        </div>
      </Show>
    </Show>
  );
}

function OptionCard(props: {
  picture: JSX.Element | null;
  other?: boolean;
  label: string;
  // What the look is, in the agent's words, under its name.
  note?: string;
  // The agent's suggestion: a mark on the picture (after the name when there is none),
  // the why on hover.
  pick?: boolean;
  why?: string;
  on: boolean;
  held?: boolean;
  isNew?: boolean;
  data: string;
  shortcut?: string;
  // A phone's row has room for two icons: the rest go in its menu.
  compact?: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onChoose: () => void;
  // Called once the pointer has rested on it; absent when the stage can't show it.
  onHold?: () => void;
  // Comment, more like this, archive and a menu (pick, borrow, move) on its right. `picked`
  // alone, read only: the mark without the buttons.
  actions?: {
    picked: boolean;
    comment?: { value: string | undefined; onInput: (v: string) => void };
    onPick?: () => void;
    onHide?: (card: Element | null, byKey: boolean) => void;
    onLike?: () => void;
    onBorrow?: () => void;
    onMove?: (anchor: HTMLElement) => void;
  };
  preview?: JSX.Element;
  // Under the card, inside its outline: what Borrow opened.
  below?: JSX.Element;
}) {
  const [resting, setResting] = createSignal(false);
  const [menu, setMenu] = createSignal(false);
  const [writing, setWriting] = createSignal(false);
  let timer = 0;
  let menuBtn: HTMLButtonElement | undefined;
  let menuEl: HTMLDivElement | undefined;
  let commentEl: HTMLTextAreaElement | undefined;
  const stopRest = () => {
    host().window.clearTimeout(timer);
    setResting(false);
  };
  onCleanup(stopRest);
  // A card can land under a mouse that hasn't moved, when new answers arrive or the
  // list reflows. Only a mouse that moved means the user is looking at this one.
  let hovering = false;
  const hover = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || hovering || (!e.movementX && !e.movementY)) return;
    hovering = true;
    props.onEnter();
    startRest();
  };
  const startRest = () => {
    const hold = props.onHold;
    if (!hold || props.held) return;
    setResting(true);
    timer = host().window.setTimeout(() => {
      setResting(false);
      hold();
    }, HOLD_MS);
  };
  const suggested = () =>
    props.pick
      ? props.why
        ? `Suggested by the agent: ${props.why}`
        : "Suggested by the agent"
      : null;
  const card = (
    <button
      type="button"
      class="opt"
      classList={{
        on: props.on,
        pill: !props.picture,
        other: !!props.other,
        held: !!props.held,
        resting: resting(),
        "opt-static": readonly(),
      }}
      aria-disabled={readonly() || undefined}
      title={[props.note, suggested()].filter(Boolean).join("\n")}
      aria-pressed={props.on}
      aria-keyshortcuts={props.shortcut}
      data-option={props.data}
      onPointerEnter={hover}
      onPointerMove={hover}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        hovering = false;
        stopRest();
        props.onLeave();
      }}
      onClick={() => {
        stopRest();
        props.onChoose();
      }}
    >
      {props.picture}
      <Show when={props.pick && props.picture}>
        <span class="pickmark" aria-hidden="true" />
      </Show>
      {/* One column, so a row layout keeps the description under the name, not beside it. */}
      <span class="otext">
        <span class="lbl">
          {splitLabel(props.label).name}
          <Show when={props.isNew}>
            <span class="optnew">New</span>
          </Show>
          <Show when={props.pick && !props.picture}>
            <span class="pickdot" aria-hidden="true" />
          </Show>
          <Show when={props.actions?.picked}>
            <span class="keptmark" aria-hidden="true">
              <Icon name="check" />
            </span>
          </Show>
        </span>
        <Show when={props.note ?? splitLabel(props.label).sub}>
          {(note) => <span class="onote">{note()}</span>}
        </Show>
      </span>
      <Show when={props.pick}>
        <span class="sr-only">, suggested by the agent</span>
      </Show>
      <Show when={props.actions?.picked}>
        <span class="sr-only">, picked</span>
      </Show>
    </button>
  );
  const a = props.actions;
  if (!a)
    return (
      <Show when={props.preview} fallback={card}>
        <div class="optw">
          {card}
          {props.preview}
        </div>
      </Show>
    );
  // A key press is a quick cull: it skips the fade, so the next press lands at once.
  const byKey = (e: MouseEvent) => e.detail === 0;
  const c = a.comment;
  const commentShown = () => !!c && (writing() || !!c.value);
  const inMenu = () => props.compact;
  const hasMenu = () =>
    !!(a.onPick || a.onBorrow || a.onMove || (inMenu() && (a.onLike || a.onHide)));
  const closeMenu = (refocus = false) => {
    setMenu(false);
    if (refocus) menuBtn?.focus();
  };
  // Outside the menu, a press closes it; inside, an item does.
  const away = (e: PointerEvent) => {
    const t = e.target as Node;
    if (!menuEl?.contains(t) && !menuBtn?.contains(t)) closeMenu();
  };
  const doc = root();
  const watch = (on: boolean) =>
    on
      ? doc.addEventListener("pointerdown", away, true)
      : doc.removeEventListener("pointerdown", away, true);
  onCleanup(() => watch(false));
  const openMenu = () => {
    const next = !menu();
    setMenu(next);
    watch(next);
    if (next)
      host().window.setTimeout(() =>
        menuEl?.querySelector<HTMLElement>("[role=menuitem]")?.focus(),
      );
  };
  const item = (fn: () => void) => () => {
    closeMenu();
    watch(false);
    fn();
  };
  const menuKeys = (e: KeyboardEvent) => {
    const items = [...(menuEl?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = items.indexOf(doc.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      watch(false);
      closeMenu(true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    }
  };
  return (
    <div
      class="optw"
      classList={{ kept: a.picked, on: props.on, pillw: !props.picture, menuopen: menu() }}
      data-option-card={props.data}
    >
      {card}
      <span class="optacts">
        <Show when={c}>
          <button
            type="button"
            class="optic optcomment"
            classList={{ has: !!c?.value }}
            aria-label={`Comment on ${props.label}`}
            aria-expanded={commentShown()}
            title={FACE.comment.label}
            onClick={() => (c?.value ? commentEl?.focus() : setWriting(!writing()))}
          >
            <Icon name={FACE.comment.icon} />
          </button>
        </Show>
        <Show when={!inMenu() && a.onLike}>
          <button
            type="button"
            class="optic"
            aria-label={`More like ${props.label}`}
            title={FACE.more.label}
            onClick={() => a.onLike?.()}
          >
            <Icon name={FACE.more.icon} />
          </button>
        </Show>
        <Show when={!inMenu() && a.onHide}>
          <button
            type="button"
            class="optic"
            aria-label={`Archive ${props.label}`}
            title={FACE.archive.label}
            onClick={(e) => a.onHide?.(e.currentTarget.closest(".optw"), byKey(e))}
          >
            <Icon name={FACE.archive.icon} />
          </button>
        </Show>
        <Show when={hasMenu()}>
          <button
            type="button"
            class="optic"
            ref={(el) => (menuBtn = el)}
            aria-label={`More for ${props.label}`}
            aria-haspopup="menu"
            aria-expanded={menu()}
            title="More"
            onClick={openMenu}
          >
            <Icon name="more" />
          </button>
        </Show>
      </span>
      <Show when={menu()}>
        <div
          class="optmenu"
          role="menu"
          aria-label={props.label}
          ref={(el) => (menuEl = el)}
          onKeyDown={menuKeys}
        >
          <Show when={inMenu() && a.onLike}>
            <button type="button" role="menuitem" onClick={item(() => a.onLike?.())}>
              <Icon name={FACE.more.icon} />
              {FACE.more.label}
            </button>
          </Show>
          <Show when={a.onPick}>
            <button
              type="button"
              role="menuitem"
              aria-pressed={a.picked}
              onClick={item(() => a.onPick?.())}
            >
              <Icon name={FACE.pick.icon} />
              {a.picked ? "Picked" : FACE.pick.label}
            </button>
          </Show>
          <Show when={a.onBorrow}>
            <button type="button" role="menuitem" onClick={item(() => a.onBorrow?.())}>
              <Icon name={FACE.borrow.icon} />
              {FACE.borrow.label}
            </button>
          </Show>
          <Show when={a.onMove}>
            <button
              type="button"
              role="menuitem"
              onClick={item(() => menuBtn && a.onMove?.(menuBtn))}
            >
              <Icon name={FACE.move.icon} />
              {FACE.move.label}
            </button>
          </Show>
          <Show when={inMenu() && a.onHide}>
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                const at = e.currentTarget.closest(".optw");
                item(() => a.onHide?.(at, byKey(e)))();
              }}
            >
              <Icon name={FACE.archive.icon} />
              {FACE.archive.label}
            </button>
          </Show>
        </div>
      </Show>
      <Show when={commentShown() && c}>
        {(cm) => (
          <div class="optcomment-box">
            <textarea
              rows="2"
              aria-label={`Comment on ${props.label}`}
              placeholder="Comment…"
              value={cm().value ?? ""}
              ref={(el) => {
                commentEl = el;
                if (writing() && !cm().value) host().window.setTimeout(() => el.focus());
              }}
              onInput={(e) => cm().onInput(e.currentTarget.value)}
              onBlur={(e) => {
                if (!e.currentTarget.value.trim()) setWriting(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && !e.currentTarget.value.trim()) {
                  e.stopPropagation();
                  setWriting(false);
                }
              }}
            />
          </div>
        )}
      </Show>
      {props.preview}
      {props.below}
    </div>
  );
}

// Archived answers, folded after the rest: each with its why, and the way back. Taking
// an answer out is archiving it; hiding is only ever a version's.
function HiddenAnswers(props: {
  s: DesignScreenState;
  ask: Ask;
  move: (change: () => void) => void;
}) {
  const s = props.s;
  const [open, setOpen] = createSignal(false);
  const id = createUniqueId();
  const list = () => s.hiddenOptions(props.ask);
  return (
    <Show when={list().length}>
      <div class="hiddenans">
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
          {`Archived · ${list().length}`}
        </button>
        <Show when={open()}>
          <ul class="hiddenans-list" id={id}>
            <For each={list()}>
              {(o) => (
                <li>
                  <span class="hiddenans-name">{o.label}</span>
                  <Show when={s.hiddenOf(props.ask, o.id)?.why}>
                    {(why) => <span class="hiddenans-why">{why()}</span>}
                  </Show>
                  <Show when={!readonly()}>
                    <button
                      type="button"
                      class="optic hiddenans-back"
                      aria-label={`Restore ${o.label}`}
                      title="Restore"
                      onClick={() => props.move(() => s.unhideAnswer(props.ask, o))}
                    >
                      <Icon name="undo" />
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

const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const EASE_MOVE = "cubic-bezier(0.645, 0.045, 0.355, 1)";

// An answer leaving fades out, then the others slide from where they were into the gap
// (FLIP); one arriving grows in. Only transform and opacity move, and reduced motion
// skips all of it.
function flipCards(box: HTMLElement | undefined, change: () => void, gone?: Element | null) {
  const w = host().window;
  if (!box || w.matchMedia("(prefers-reduced-motion: reduce)").matches) return change();
  const cards = () => [...box.children] as HTMLElement[];
  const run = () => {
    const before = new Map(cards().map((el) => [el, el.getBoundingClientRect()]));
    change();
    for (const el of cards()) {
      const b = before.get(el);
      if (!b) {
        el.animate(
          [
            { opacity: 0, transform: "scale(0.96)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 200, easing: EASE_OUT },
        );
        continue;
      }
      const a = el.getBoundingClientRect();
      const dx = b.left - a.left;
      const dy = b.top - a.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
        duration: 240,
        easing: EASE_MOVE,
      });
    }
  };
  if (!gone) return run();
  (gone as HTMLElement).style.pointerEvents = "none";
  gone
    .animate(
      [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "scale(0.96)" },
      ],
      { duration: 150, easing: EASE_OUT, fill: "forwards" },
    )
    .finished.then(run, run);
}
