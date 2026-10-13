// D3/D5/D6: questions answered in place. Options are pictures when the viewer
// can render them (a variant that exists for the ask's state, or a knob set it
// can apply), pills otherwise. Hover previews on the stage, click picks; on a
// hover device a pick moves on to the next open question, on touch the first
// tap previews and the second confirms (see `tapPicks`). Mix is the optional
// last question; the review after it lists every answer above Send.

import {
  createMemo,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import type { Ask, AskOption } from "../../server/types.ts";
import { assetUrl, surfaceUrl, type VariantView } from "./api.ts";
import { ACCEPT, filesOf, hasFiles } from "./attach.ts";
import { host, readonly } from "./host.ts";
import {
  answerIds,
  askName,
  askState,
  frameKey,
  isLookAsk,
  type MixOption,
  partBox,
  tapPicks,
} from "./logic.ts";
import type { AskField, MockScreenState, Primary } from "./state.ts";
import { theme } from "./theme.ts";
import { Thumb } from "./Thumb.tsx";

const MIX_KEY = "mix";
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
  // A file dropped beside a drop zone would make the browser open it and
  // leave the page; files land only where a zone takes them.
  onMount(() => {
    const win = host().window;
    const guard = (e: DragEvent) => {
      if (hasFiles(e.dataTransfer)) e.preventDefault();
    };
    win.addEventListener("dragover", guard);
    win.addEventListener("drop", guard);
    onCleanup(() => {
      win.removeEventListener("dragover", guard);
      win.removeEventListener("drop", guard);
    });
  });
  const total = () => s.questions().length;
  const i = () => Math.min(s.cur(), total() - 1);
  const q = () => s.questions()[i()];
  const questionKey = createMemo(() => {
    const x = q();
    return x ? (x.kind === "mix" ? MIX_KEY : `ask:${x.ask.id}`) : null;
  });

  return (
    <div class="qview">
      <div class="sr-only" aria-live="polite">
        {s.attachStatus()}
      </div>
      <div class="qhd">
        <Show
          when={!s.reviewing()}
          fallback={
            <span>{`Review · ${total()} ${total() === 1 ? "question" : "questions"}`}</span>
          }
        >
          <Header s={s} index={i()} total={total()} />
        </Show>
        <span class="grow" />
        {/* The shortcuts are keyboard ones; a finger has the arrows beside it. */}
        <Show when={hoverDevice()}>
          <KeysHint s={s} />
        </Show>
        <button
          type="button"
          class="nav"
          aria-label="Previous question"
          disabled={!s.reviewing() && i() === 0}
          onClick={() => s.step(-1)}
        >
          ‹
        </button>
        <button
          type="button"
          class="nav"
          aria-label="Next question"
          disabled={s.reviewing()}
          onClick={() => s.step(1)}
        >
          ›
        </button>
      </div>
      <Show when={s.keysOpen()}>
        <KeysList />
      </Show>
      <Show when={!s.reviewing()} fallback={<Review s={s} />}>
        {/* Keyed by the question's id, not its object: the list is rebuilt
            whenever a frame reports its parts, and remounting on that would
            close an open note and drop the focus out of its field mid-typing. */}
        <Show when={questionKey()} keyed>
          {(key) => {
            const ask = () => {
              const x = q();
              return x?.kind === "ask" ? x.ask : null;
            };
            return key === MIX_KEY ? (
              <MixBlock s={s} index={i()} />
            ) : (
              <Show when={ask()}>{(a) => <AskBlock s={s} ask={a()} index={i()} />}</Show>
            );
          }}
        </Show>
      </Show>
      <Show when={s.error()}>
        <div class="qerr" role="alert">
          {s.error()}
        </div>
      </Show>
      <Show when={s.primary()} keyed>
        {(p) => (
          <div class="qactions">
            <button
              type="button"
              class="primary"
              classList={{ send: p.kind === "send" }}
              disabled={p.kind === "send" && s.sending()}
              onClick={() => s.runPrimary()}
            >
              {primaryLabel(p, s.owed().length)}
            </button>
          </div>
        )}
      </Show>
    </div>
  );
}

function primaryLabel(p: NonNullable<Primary>, owed: number): string {
  switch (p.kind) {
    case "next":
      return "Next ›";
    case "review":
      return "Review ›";
    case "back":
      return "Back to review ›";
    case "owed":
      return owed === 1 ? "Answer the open question ›" : `Answer ${owed} open questions ›`;
    case "send":
      return `Send ${p.count}`;
  }
}

// After the last question: every answer as a row, a tap reopens that question
// and its pick comes back here.
function Review(props: { s: MockScreenState }) {
  const s = props.s;
  const askAt = (index: number) => {
    const q = s.questions()[index];
    return q?.kind === "ask" ? q.ask : null;
  };
  const picture = (index: number, option: string | null) => {
    const ask = askAt(index);
    const o = ask && option ? ask.options.find((x) => x.id === option) : undefined;
    return ask && o ? optionPicture(s, ask, o) : null;
  };
  return (
    <div class="qblock">
      <div class="nm">Your answers</div>
      <div class="ask">Check them, then send them in one reply.</div>
      <ol class="review">
        <For each={s.review()}>
          {(r) => (
            <li>
              <button
                type="button"
                class="review-row"
                classList={{ owed: r.owed }}
                data-review={r.index}
                aria-label={`${r.name}: ${r.said.length ? r.said.join(", ") : r.owed ? "not answered" : "skipped"}. Change`}
                onClick={() => s.goQuestion(r.index, { fromReview: true })}
              >
                <Show when={picture(r.index, r.option)}>
                  {(p) => <Thumb width={s.frameW()} class="crop review-thumb" fit src={p().src} />}
                </Show>
                <span class="review-text">
                  <span class="review-name">
                    {r.name}
                    <Show when={r.optional}>
                      <span class="qtag">Optional</span>
                    </Show>
                  </span>
                  <span class="review-said">
                    {r.said.length ? r.said.join(", ") : r.owed ? "Not answered" : "Skipped"}
                  </span>
                </span>
                <span class="review-go" aria-hidden="true">
                  {r.owed ? <i class="dot" /> : "›"}
                </span>
              </button>
            </li>
          )}
        </For>
      </ol>
      <MixNotes s={s} />
    </div>
  );
}

// Borrows a later answer removed from Mix, each with the answer that did it.
function MixNotes(props: { s: MockScreenState }) {
  return (
    <div class="mix-notes" role="status">
      <For each={props.s.mixDropped()}>{(n) => <p class="mix-note">{n.note}</p>}</For>
    </div>
  );
}

// The shortcuts, behind a small "?" (and the ? key).
function KeysHint(props: { s: MockScreenState }) {
  const s = props.s;
  return (
    <button
      type="button"
      class="keys-btn"
      aria-label="Shortcuts"
      aria-expanded={s.keysOpen()}
      title="Shortcuts (?)"
      onClick={() => s.setKeysOpen(!s.keysOpen())}
    >
      ?
    </button>
  );
}

function KeysList() {
  const rows: [string, string][] = [
    ["1–9", "pick an option"],
    ["← →", "previous / next question"],
    ["Enter", "next, review, send"],
    ["[ ]", "previous / next mock to answer"],
    ["Esc", "clear the preview"],
  ];
  return (
    <dl class="keys">
      <For each={rows}>
        {([k, what]) => (
          <div class="keys-row">
            <dt>
              <kbd>{k}</kbd>
            </dt>
            <dd>{what}</dd>
          </div>
        )}
      </For>
    </dl>
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
    const said = answerIds(s.answerOf(a)).map(
      (id) => a.options.find((o) => o.id === id)?.label ?? id,
    );
    const other = s.otherOf(a);
    if (other !== undefined) said.push(`“${other}”`);
    if (said.length) return said.join(", ");
    return s.noteOf(a) !== undefined ? "a note" : null;
  });
  const flagged = () => {
    const a = ask();
    return a ? s.flagged().includes(a.id) : false;
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
      <span class="picked">{`picked: ${labels()}`}</span>
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
  const picked = (o: AskOption) => answerIds(s.answerOf(props.ask)).includes(o.id);
  const keyOf = (o: AskOption) => s.optionKey(props.ask, o.id);

  return (
    <div class="qblock">
      <div class="nm">{askName(props.ask, m())}</div>
      <div class="ask">{props.ask.text}</div>
      <div class="opts">
        <For each={props.ask.options}>
          {(o, i) => {
            const pic = () => optionPicture(s, props.ask, o);
            const focus = () => {
              const p = pic();
              if (!p || props.ask.scope !== "part") return null;
              return (
                partBox(s.reports[frameKey(p.state, p.variant.variant)], props.ask.part) ?? null
              );
            };
            const card = () => (
              <OptionCard
                picture={
                  pic() ? (
                    <Thumb width={s.frameW()} class="crop" fit src={pic()!.src} focus={focus()} />
                  ) : null
                }
                label={o.label}
                note={o.variant ? pic()?.variant.note : undefined}
                on={picked(o)}
                previewing={s.preview()?.key === keyOf(o)}
                data={o.id}
                shortcut={i() < 9 ? String(i() + 1) : undefined}
                onEnter={() => s.setPreview(s.previewOf(props.ask, o.id))}
                onLeave={() => s.preview()?.key === keyOf(o) && s.setPreview(null)}
                onChoose={() => s.choose(props.ask, o.id, hoverDevice())}
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
            return (
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
      <AskNote s={s} ask={props.ask} />
    </div>
  );
}

// A quiet "Add a note" under each question: opt-in, and open on its own once
// a note exists, so an unused one costs nothing.
function AskNote(props: { s: MockScreenState; ask: Ask }) {
  const s = props.s;
  const [open, setOpen] = createSignal(false);
  const shown = () => open() || s.noteOf(props.ask) !== undefined;
  return (
    <Show
      when={shown()}
      fallback={
        <Show when={!readonly()}>
          <button type="button" class="lnk addnote" onClick={() => setOpen(true)}>
            Add a note
          </button>
        </Show>
      }
    >
      <AskText
        s={s}
        ask={props.ask}
        field="note"
        class="ask-note"
        label="Note"
        value={s.noteOf(props.ask) ?? ""}
        placeholder="e.g. Table on desktop, Cards on mobile"
        focus={open() && s.noteOf(props.ask) === undefined}
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
      <label class="up-text-label" for={id}>
        {props.label}
      </label>
      <textarea
        id={id}
        rows={2}
        maxLength={8000}
        placeholder={props.placeholder}
        value={props.value}
        readOnly={readonly()}
        ref={(el) => {
          textarea = el;
          if (props.focus) queueMicrotask(() => el.focus());
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
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
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
  function choose(key: string, on: boolean, apply: () => void, preview: () => void) {
    if (readonly()) return;
    const tap = {
      hover: hoverDevice(),
      previewing: s.preview()?.key === key,
      canPreview: true,
      unpicks: on,
    };
    if (!tapPicks(tap)) return preview();
    apply();
    s.setPreview(null);
  }
  const none = () => s.mixAnswered() && !Object.keys(s.draft()?.mix ?? {}).length;
  return (
    <div class="qblock">
      <div class="nm">
        Mix <span class="qtag">Optional · from mockpit</span>
      </div>
      <div class="ask">Borrow a part from another look?</div>
      <div class="qhint">
        {hoverDevice()
          ? "Hover one to see it on the stage."
          : "Tap one to see it on the stage, tap again to keep it."}
      </div>
      <MixNotes s={s} />
      <div class="opts">
        <OptionCard
          picture={
            pictureOf(look(), s.activeState()) ? (
              <Thumb
                width={s.frameW()}
                class="crop"
                fit
                src={pictureOf(look(), s.activeState())!}
              />
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
              none(),
              () => s.toggleMix(null),
              () => s.setPreview({ key: "mix:none" }),
            )
          }
        />
        <For each={s.mixOpts()}>
          {(o) => {
            const key = `mix:${o.part}:${o.variant}`;
            const state = () => stateFor(o);
            const preview = () =>
              s.setPreview({ key, variant: o.variant, state: state(), part: o.part });
            const src = () => pictureOf(o.variant, state());
            const focus = () => partBox(s.reports[frameKey(state(), o.variant)], o.part) ?? null;
            return (
              <OptionCard
                picture={
                  src() ? (
                    <Thumb width={s.frameW()} class="crop" fit src={src()!} focus={focus()} />
                  ) : null
                }
                label={`${o.part} · ${o.variant}'s`}
                on={s.draft()?.mix[o.part] === o.variant}
                previewing={s.preview()?.key === key}
                data={`${o.part}:${o.variant}`}
                onEnter={preview}
                onLeave={() => s.preview()?.key === key && s.setPreview(null)}
                onChoose={() =>
                  choose(key, s.draft()?.mix[o.part] === o.variant, () => s.toggleMix(o), preview)
                }
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
  other?: boolean;
  label: string;
  // What the look is, in the agent's words, under its name.
  note?: string;
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
    </button>
  );
}

// Nothing to ask, not even "Which one?" (no state has a choice left between
// live variants): the plain verdict on the variant on stage, sent as one reply (Q13).
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
