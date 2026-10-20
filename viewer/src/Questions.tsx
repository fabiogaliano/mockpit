// D3/D5/D6: questions answered in place. Options are pictures when the viewer
// can render them (a variant that exists for the ask's state, or a knob set it
// can apply), pills otherwise. Hover previews on the stage, click picks; on a
// hover device a pick moves on to the next open question, on touch the first
// tap previews and the second confirms (see `tapPicks`). Each state shows the
// questions about it, and only open ones: sent answers fold into a read-only
// Answered group, changed only through its "Change answer". The review after
// the last question lists every answer above Send.

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
import type { Ask, AskOption, KnobValue } from "../../server/types.ts";
import { assetUrl, surfaceUrl, type VariantView } from "./api.ts";
import { ACCEPT, filesOf, hasFiles } from "./attach.ts";
import { host, readonly } from "./host.ts";
import {
  answerIds,
  askName,
  askState,
  draftKnobValues,
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
      <Show when={s.mock()?.resolvedAt}>
        <ResolvedNote s={s} />
      </Show>
      <Show when={s.asks().length} fallback={<Decide s={s} />}>
        <QuestionView s={s} />
      </Show>
    </Show>
  );
}

// A mock the user resolved from the project list: what that did, and the way back.
function ResolvedNote(props: { s: MockScreenState }) {
  return (
    <div class="resolved-note" role="status">
      <span>Resolved. Questions still open were closed unanswered, and your agent was told.</span>
      <Show when={!readonly()}>
        <button type="button" class="secondary" onClick={() => void props.s.reopen()}>
          Reopen
        </button>
      </Show>
    </div>
  );
}

// "Mobile · " before the count, when the mock has states to tell apart.
const stateLead = (s: MockScreenState) =>
  s.states().length > 1 && s.activeState() !== null ? `${s.activeState()} · ` : "";
// The count is per state, so "1 of 1" alone would read as the last question
// when other states still ask something.
const openElsewhere = (s: MockScreenState) => {
  const here = new Set(s.questions().flatMap((q) => (q.kind === "ask" ? [q.ask.id] : [])));
  const n = s.owed().filter((a) => !here.has(a.id)).length;
  return n ? ` · ${n} open on other ${n === 1 ? "state" : "states"}` : "";
};

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
            <span>{`Review · ${s.reviewAsks().length} ${s.reviewAsks().length === 1 ? "question" : "questions"}`}</span>
          }
        >
          <Show when={total()} fallback={<span>{`${stateLead(s)}Nothing open`}</span>}>
            <Header s={s} index={i()} total={total()} />
          </Show>
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
          disabled={s.stepTarget(-1) === null}
          onClick={() => s.step(-1)}
        >
          ‹
        </button>
        <button
          type="button"
          class="nav"
          aria-label="Next question"
          disabled={s.stepTarget(1) === null}
          onClick={() => s.step(1)}
        >
          ›
        </button>
      </div>
      <Show when={s.keysOpen()}>
        <KeysList />
      </Show>
      <Show when={!s.reviewing()} fallback={<Review s={s} />}>
        <Show when={!total()}>
          <NoneOpen s={s} />
        </Show>
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
              {primaryLabel(p, s.owed().length, s.activeState())}
            </button>
          </div>
        )}
      </Show>
      <Answered s={s} scope={s.reviewing() ? "all" : "state"} />
    </div>
  );
}

// The state on stage has nothing open: why, in a line.
function NoneOpen(props: { s: MockScreenState }) {
  const s = props.s;
  const text = () => {
    if (s.mock()?.resolvedAt) return "Nothing open: resolving closed the rest.";
    if (s.flow().length)
      return s.states().length > 1
        ? "Nothing open on this state. Other states still have questions."
        : "Nothing open.";
    return s.closedAsks("all").length ? "All answered. Your answers were sent." : "Nothing open.";
  };
  return (
    <div class="qblock">
      <div class="ask none-open">{text()}</div>
    </div>
  );
}

// Sent answers, folded: read-only, each with the answer it got. Changing one
// is its own button, so a stray tap can't reopen it.
function Answered(props: { s: MockScreenState; scope: "state" | "all" }) {
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

function primaryLabel(p: NonNullable<Primary>, owed: number, here: string | null): string {
  switch (p.kind) {
    case "next":
      return p.state !== here && p.state !== null ? `Next: ${p.state} ›` : "Next ›";
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
  const askAt = (index: number) => s.reviewAsks()[index] ?? null;
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
          {(r, k) => (
            <li style={{ "margin-inline-start": `${r.depth * 14}px` }}>
              <Show when={r.group !== null && r.group !== s.review()[k() - 1]?.group}>
                <div class="review-group">{r.group}</div>
              </Show>
              <button
                type="button"
                class="review-row"
                classList={{ owed: r.owed, dormant: r.dormant }}
                data-review={r.index}
                aria-label={`${r.name}: ${r.said.length ? r.said.join(", ") : r.owed ? "not answered" : "skipped"}. Change`}
                onClick={() => {
                  const a = askAt(r.index);
                  if (a) s.goAsk(a.id, { fromReview: true });
                }}
              >
                <Show when={picture(r.index, r.option)}>
                  {(p) => (
                    <Thumb
                      width={s.frameW()}
                      class="crop review-thumb"
                      fit
                      whole
                      src={p().src}
                      knobs={p().knobs}
                    />
                  )}
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
                    <Show when={r.dormant && r.said.length}>
                      <span class="qtag">not sent</span>
                    </Show>
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
          {`${stateLead(s)}Question ${props.index + 1} of ${props.total}`}
          <Show when={ask() && s.dormantOf(ask()!)}>
            <span class="flag">{" · skipped"}</span>
          </Show>
          <Show when={flagged()}>
            <span class="flag">{` · your pick is gone in v${s.latest()}`}</span>
          </Show>
          {openElsewhere(s)}
        </span>
      }
    >
      <span>{`${stateLead(s)}${props.index + 1} of ${props.total} · `}</span>
      <span class="picked">{`picked: ${labels()}`}</span>
      <Show when={ask() && s.dormantOf(ask()!)}>
        <span class="flag">{" · skipped"}</span>
      </Show>
      <span>{openElsewhere(s)}</span>
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
function optionPicture(
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
      src: surfaceUrl(v.postId, idx, {
        version: s.frameVersionOf(v),
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

function AskBlock(props: { s: MockScreenState; ask: Ask; index: number }) {
  const s = props.s;
  const m = () => s.mock()!;
  const picked = (o: AskOption) => answerIds(s.answerOf(props.ask)).includes(o.id);
  const keyOf = (o: AskOption) => s.optionKey(props.ask, o.id);

  const slot = () => s.askSlot(props.ask);
  const dormant = () => s.dormantOf(props.ask);
  // The region the pictures crop to: the slot the ask chooses, else its part.
  const region = () => slot()?.part ?? (props.ask.scope === "part" ? props.ask.part : undefined);
  const parentAsk = () => {
    const d = dormant();
    return d
      ? s.questions().findIndex((q) => q.kind === "ask" && s.askSlot(q.ask)?.part === d.part)
      : -1;
  };
  return (
    <div class="qblock">
      {/* Plain: named only "Question", or for the state the header above
          already names. */}
      <div
        class="nm"
        classList={{
          plain:
            (askName(props.ask, m()) === "Question" ||
              (stateLead(s) !== "" && askName(props.ask, m()) === s.activeState())) &&
            !slot(),
        }}
      >
        {askName(props.ask, m())}
        <Show when={slot()}>
          {(sl) => <span class="slotchip">{`Slot · ${sl().label ?? sl().part}`}</span>}
        </Show>
      </div>
      <div class="ask">{props.ask.text}</div>
      <Show when={s.revisingOf(props.ask)}>
        <div class="revising" role="status">
          <span>{"Changing a sent answer. A new pick goes out with your next Send."}</span>
          <button type="button" class="lnk" onClick={() => s.keepAnswer(props.ask)}>
            Keep sent answer
          </button>
        </div>
      </Show>
      <Show when={s.waitingOn(props.ask)}>
        {(before) => {
          const at = () =>
            s.questions().findIndex((q) => q.kind === "ask" && q.ask.id === before().id);
          return (
            <div class="dormant" role="status">
              {"Opens after "}
              <b>{before().text}</b>
              {" is answered: its pictures need that answer."}
              <Show when={at() >= 0}>
                <button type="button" class="lnk" onClick={() => s.goQuestion(at())}>
                  {`Go to question ${at() + 1}`}
                </button>
              </Show>
            </div>
          );
        }}
      </Show>
      <Show when={s.shownWith(props.ask) || s.changesOf(props.ask).length}>
        <div class="qwith">
          <Show when={s.shownWith(props.ask)}>
            {(w) => {
              const at = () =>
                s.questions().findIndex((q) => q.kind === "ask" && q.ask.id === w().ask.id);
              return (
                <span class="qwith-chip">
                  {`With ${w().labels}`}
                  <Show when={at() >= 0}>
                    <button type="button" class="lnk" onClick={() => s.goQuestion(at())}>
                      change
                    </button>
                  </Show>
                </span>
              );
            }}
          </Show>
          <Show when={s.changesOf(props.ask).length}>
            <span class="qwith-changes">{`Changes: ${s.changesOf(props.ask).join(" · ")}`}</span>
          </Show>
        </div>
      </Show>
      <Show when={dormant()}>
        {(d) => (
          <div class="dormant" role="status">
            {"Only for "}
            <b>{d().label}</b>
            {". It doesn't apply to the fill you picked, so it is skipped and not sent."}
            <Show when={parentAsk() >= 0}>
              <button type="button" class="lnk" onClick={() => s.goQuestion(parentAsk())}>
                {`Go to question ${parentAsk() + 1}`}
              </button>
            </Show>
          </div>
        )}
      </Show>
      <div class="opts" classList={{ asleep: !!dormant(), waiting: !!s.waitingOn(props.ask) }}>
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
            // A dropped look is gone from the choice; the stage's Dropped fold restores it.
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
  const variantOf = (variant: string, state: string | null) =>
    s.variants().find((x) => x.state === state && x.variant === variant);
  const pictureOf = (variant: string, state: string | null) => {
    const v = variantOf(variant, state);
    const idx = v ? v.surfaces.findIndex((x) => x.kind === "html") : -1;
    if (!v || idx < 0) return null;
    return surfaceUrl(v.postId, idx, {
      version: s.frameVersionOf(v),
      mode: theme(),
      e: v.embedsKey,
    });
  };
  const knobsOf = (variant: string, state: string | null) => {
    const v = variantOf(variant, state);
    return v ? draftValues(s, v) : undefined;
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
                knobs={knobsOf(look(), s.activeState())}
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
                    <Thumb
                      width={s.frameW()}
                      class="crop"
                      fit
                      src={src()!}
                      knobs={knobsOf(o.variant, state())}
                      focus={focus()}
                    />
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
