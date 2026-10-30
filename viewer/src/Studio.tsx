// Studio: the state zoomed out, every variant side by side with its newest
// version on top, for exploring before anything is in use. Opening a version
// zooms back in to Stage. A fork with a single version hangs under the version
// it came from (a riff) until it has a second, then it is a column of its own.
// Each steer (more like this, a comment, a borrow) is its own reply.

import { isLive } from "../../server/types.ts";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { surfaceUrl, type VariantView } from "./api.ts";
import { host, readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { sameVersion, type VersionStep } from "./logic.ts";
import type { MockScreenState } from "./state.ts";
import { theme } from "./theme.ts";
import { Thumb } from "./Thumb.tsx";

// More live frames than this and a browser starts dropping WebGL contexts; a
// version past the budget waits as a placeholder until it is pointed at.
const LIVE_MAX = 16;

// A poster image, when the version carries one, is cheaper than its page.
function pictureOf(st: VersionStep): string | null {
  const i = st.kinds.includes("image") ? st.kinds.indexOf("image") : st.kinds.indexOf("html");
  return i < 0 ? null : surfaceUrl(st.postId, i, { version: st.version, mode: theme() });
}

type Draft = { kind: "comment" | "borrow"; to: VersionStep; from?: VersionStep };

export function Studio(props: { s: MockScreenState; top: number; onOpen: () => void }) {
  const s = props.s;
  const inState = createMemo(() => s.variants().filter((v) => v.state === s.activeState()));
  const shown = createMemo(() => s.steps().filter((st) => !st.hidden));
  const versionsOf = (variant: string) =>
    shown()
      .filter((st) => st.variant === variant)
      .reverse();
  const live = (v: VariantView) => isLive(v.status);
  const isRiff = (v: VariantView) =>
    !!v.forkedFrom &&
    live(v) &&
    versionsOf(v.variant).length === 1 &&
    inState().some((p) => p.variant === v.forkedFrom?.variant && live(p));
  // Roots in the order they were made, each followed by the forks that grew
  // into columns of their own.
  const columns = createMemo(() => {
    const vs = inState().filter((v) => live(v) && !isRiff(v) && versionsOf(v.variant).length);
    const out: VariantView[] = [];
    const visit = (v: VariantView) => {
      if (out.includes(v)) return;
      out.push(v);
      for (const c of vs) if (c.forkedFrom?.variant === v.variant) visit(c);
    };
    for (const v of vs)
      if (!v.forkedFrom || !vs.some((p) => p.variant === v.forkedFrom?.variant)) visit(v);
    for (const v of vs) visit(v);
    return out;
  });
  const aside = createMemo(() => inState().filter((v) => !live(v) && versionsOf(v.variant).length));
  const riffsOf = (st: VersionStep) =>
    inState()
      .filter(
        (v) =>
          isRiff(v) && v.forkedFrom?.variant === st.variant && v.forkedFrom.version === st.version,
      )
      .map((v) => versionsOf(v.variant)[0]);

  // Archived variants are out of the exploration: a quiet count in the window's
  // corner, opened on purpose.
  const [archivedOpen, setArchivedOpen] = createSignal(false);
  // Live frames: the versions in view, oldest sighting first, up to the budget.
  const [inView, setInView] = createSignal<string[]>([]);
  const key = (st: VersionStep) => `${st.variant}@${st.version}`;
  const inBudget = (st: VersionStep) => {
    const i = inView().indexOf(key(st));
    return i >= 0 && i < LIVE_MAX - (archivedOpen() ? aside().length : 0);
  };
  const bump = (st: VersionStep) => setInView((l) => [key(st), ...l.filter((k) => k !== key(st))]);
  let scroller: HTMLDivElement | undefined;
  let io: IntersectionObserver | undefined;
  onMount(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        setInView((l) => {
          let next = l;
          for (const e of entries) {
            const k = (e.target as HTMLElement).dataset.key!;
            next = e.isIntersecting
              ? next.includes(k)
                ? next
                : [...next, k]
              : next.filter((x) => x !== k);
          }
          return next;
        });
      },
      { root: scroller ?? null, rootMargin: "200px" },
    );
    io = obs;
    for (const el of scroller?.querySelectorAll<HTMLElement>("[data-key]") ?? []) obs.observe(el);
  });
  onCleanup(() => io?.disconnect());
  const watch = (el: HTMLElement) => {
    queueMicrotask(() => io?.observe(el));
    onCleanup(() => io?.unobserve(el));
  };

  const [borrowFrom, setBorrowFrom] = createSignal<VersionStep | null>(null);
  const [writing, setWriting] = createSignal<Draft | null>(null);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (writing()) setWriting(null);
    else if (borrowFrom()) setBorrowFrom(null);
    else if (archivedOpen()) setArchivedOpen(false);
  };
  let corner: HTMLElement | undefined;
  const onDown = (e: PointerEvent) => {
    if (archivedOpen() && !corner?.contains(e.target as Node)) setArchivedOpen(false);
  };
  onMount(() => host().window.addEventListener("pointerdown", onDown, true));
  onCleanup(() => host().window.removeEventListener("pointerdown", onDown, true));
  onMount(() => host().window.addEventListener("keydown", onKey));
  onCleanup(() => host().window.removeEventListener("keydown", onKey));

  const act = {
    open(st: VersionStep) {
      s.showVersion(st);
      props.onOpen();
    },
    more(st: VersionStep) {
      void s
        .steer({ variant: st.variant, version: st.version, reaction: "more" })
        .then((ok) => ok && s.setToast({ text: `More like ${s.nameOf(st)}, sent` }));
    },
    comment(st: VersionStep) {
      setBorrowFrom(null);
      setWriting({ kind: "comment", to: st });
    },
    borrow(st: VersionStep) {
      setWriting(null);
      setBorrowFrom(st);
    },
    pick(st: VersionStep) {
      const from = borrowFrom();
      if (!from || sameVersion(from, st)) return;
      setBorrowFrom(null);
      setWriting({ kind: "borrow", to: st, from });
    },
    // The last version of a variant can't be hidden; it archives the variant.
    remove(st: VersionStep) {
      if (versionsOf(st.variant).length > 1) void s.hideVersion(st, true);
      else void s.archiveVariant(st.variant);
    },
  };

  const card = (st: VersionStep, small = false) => (
    <Sketch
      s={s}
      st={st}
      small={small}
      live={inBudget(st)}
      borrowing={!!borrowFrom()}
      source={sameVersion(borrowFrom(), st)}
      last={versionsOf(st.variant).length === 1}
      ref={watch}
      onWake={() => bump(st)}
      act={act}
    />
  );

  return (
    <div class="studio" ref={(el) => (scroller = el)} style={{ top: `${props.top}px` }}>
      <Show when={borrowFrom()}>
        {(from) => (
          <div class="studio-banner" role="status">
            <span>{`Borrow from ${s.nameOf(from())}: pick where it goes`}</span>
            <button type="button" class="btn" onClick={() => setBorrowFrom(null)}>
              Cancel
            </button>
          </div>
        )}
      </Show>
      <div class="studio-cols">
        <For each={columns()}>
          {(v) => (
            <section class="studio-col" aria-label={v.variant}>
              <header class="studio-colh">
                <h2>{v.variant}</h2>
                <Show when={v.forkedFrom}>
                  {(f) => <span class="studio-from">{`from ${f().variant}`}</span>}
                </Show>
              </header>
              <For each={versionsOf(v.variant)}>
                {(st) => (
                  <>
                    {card(st)}
                    <Show when={riffsOf(st).length}>
                      <div class="studio-riffs">
                        <For each={riffsOf(st)}>{(r) => card(r, true)}</For>
                      </div>
                    </Show>
                  </>
                )}
              </For>
            </section>
          )}
        </For>
      </div>
      <Show when={aside().length}>
        <div class="studio-archived" ref={(el) => (corner = el)}>
          <section
            class="arch-pop"
            classList={{ open: archivedOpen() }}
            aria-label="Archived"
            aria-hidden={!archivedOpen()}
            inert={!archivedOpen() || undefined}
          >
            <h3>Archived</h3>
            <For each={aside()}>
              {(v) => {
                const st = () => versionsOf(v.variant)[0];
                return (
                  <div class="arch-row">
                    <span class="arch-th">
                      <Show when={archivedOpen() && st() && pictureOf(st())}>
                        {(u) => <Thumb src={u()} width={s.frameW()} fit whole />}
                      </Show>
                    </span>
                    <span class="arch-nm">{v.variant}</span>
                    <Show when={!readonly()}>
                      <button
                        type="button"
                        class="ib"
                        aria-label={`Restore ${v.variant}`}
                        title="Restore"
                        onClick={() => void s.restoreVariant(v.variant, [s.activeState()])}
                      >
                        <Icon name="undo" />
                      </button>
                    </Show>
                  </div>
                );
              }}
            </For>
          </section>
          <button
            type="button"
            class="arch-count"
            aria-expanded={archivedOpen()}
            onClick={() => setArchivedOpen(!archivedOpen())}
          >
            {`${aside().length} archived`}
            <Icon name="down" />
          </button>
        </div>
      </Show>
      <Show when={writing()}>
        {(w) => <NoteBox s={s} draft={w()} onDone={() => setWriting(null)} />}
      </Show>
    </div>
  );
}

function Sketch(props: {
  s: MockScreenState;
  st: VersionStep;
  small: boolean;
  live: boolean;
  borrowing: boolean;
  source: boolean;
  last: boolean;
  ref: (el: HTMLElement) => void;
  onWake: () => void;
  act: Record<
    "open" | "more" | "comment" | "borrow" | "pick" | "remove",
    (st: VersionStep) => void
  >;
}) {
  const s = props.s;
  const st = () => props.st;
  const src = () => pictureOf(st());
  const inUse = () => sameVersion(s.inUse(), st());
  const name = () => s.nameOf(st());
  const label = () => `${name()}${inUse() ? ", in use" : ""}`;
  const can = () => !readonly() && !props.borrowing;
  return (
    <div
      class="sk"
      classList={{
        small: props.small,
        source: props.source,
        target: props.borrowing && !props.source,
      }}
      data-key={`${st().variant}@${st().version}`}
      ref={props.ref}
      onPointerEnter={() => !props.live && props.onWake()}
    >
      <button
        type="button"
        class="sk-art"
        aria-label={props.borrowing && !props.source ? `Borrow into ${label()}` : `Open ${label()}`}
        title={st().prompt ?? ""}
        onClick={() => (props.borrowing ? props.act.pick(st()) : props.act.open(st()))}
        onFocus={() => !props.live && props.onWake()}
      >
        <Show when={props.live && src()}>
          {(u) => <Thumb src={u()} width={s.frameW()} fit whole />}
        </Show>
      </button>
      <Show when={!props.small}>
        <div class="sk-foot">
          <span class="sk-n">{`#${st().version}`}</span>
          <Show when={inUse()}>
            <span class="sk-tag">in use</span>
          </Show>
          <Show when={can()}>
            <div class="sk-acts" role="group" aria-label={`Steer ${name()}`}>
              <button
                type="button"
                class="ib"
                aria-label={`More like ${name()}`}
                title="More like this"
                onClick={() => props.act.more(st())}
              >
                <Icon name="spark" />
              </button>
              <button
                type="button"
                class="ib"
                aria-label={`Comment on ${name()}`}
                title="Comment"
                onClick={() => props.act.comment(st())}
              >
                <Icon name="mark" />
              </button>
              <button
                type="button"
                class="ib"
                aria-label={`Borrow from ${name()}`}
                title="Borrow"
                onClick={() => props.act.borrow(st())}
              >
                <Icon name="borrow" />
              </button>
            </div>
          </Show>
        </div>
      </Show>
      <Show when={can() && !inUse()}>
        <button
          type="button"
          class="ib x-remove sk-x"
          aria-label={props.last ? `Archive ${st().variant}` : `Hide ${name()}`}
          title={props.last ? "Archive" : "Hide"}
          onClick={() => props.act.remove(st())}
        >
          <Icon name="close" />
        </button>
      </Show>
    </div>
  );
}

// A comment on one version, or what to borrow from where: one line, aimed at a
// part when the version declares any, sent as its own reply.
function NoteBox(props: { s: MockScreenState; draft: Draft; onDone: () => void }) {
  const s = props.s;
  const [text, setText] = createSignal("");
  const [part, setPart] = createSignal<string | null>(null);
  const to = () => props.draft.to;
  const from = () => props.draft.from;
  const parts = () =>
    s.variants().find((v) => v.state === s.activeState() && v.variant === (from() ?? to()).variant)
      ?.parts ?? [];
  let input: HTMLInputElement | undefined;
  onMount(() => input?.focus());
  const send = () => {
    const f = from();
    const what = text().trim();
    if (!f && !what) return;
    const body = f
      ? `Borrow ${part() ? `the ${part()}` : what || "what works"} from ${s.nameOf(f)} into this.${part() && what ? ` ${what}` : ""}`
      : what;
    const sent = f ? `Borrow into ${s.nameOf(to())}, sent` : `Comment on ${s.nameOf(to())}, sent`;
    void s
      .steer({ variant: to().variant, version: to().version, part: f ? null : part(), text: body })
      .then((ok) => ok && s.setToast({ text: sent }));
    props.onDone();
  };
  return (
    <form
      class="studio-note"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <label for="studio-note-in">
        {from()
          ? `From ${s.nameOf(from()!)} into ${s.nameOf(to())}: what should it take?`
          : `Comment on ${s.nameOf(to())}`}
      </label>
      <Show when={parts().length}>
        <div class="studio-parts" role="group" aria-label="Part">
          <For each={parts()}>
            {(p) => (
              <button
                type="button"
                class="chip"
                aria-pressed={part() === p}
                onClick={() => setPart(part() === p ? null : p)}
              >
                {p}
              </button>
            )}
          </For>
        </div>
      </Show>
      <input
        id="studio-note-in"
        ref={(el) => (input = el)}
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
        placeholder={from() ? "e.g. the face" : "e.g. sleepier eyes"}
        autocomplete="off"
      />
      <div class="studio-note-foot">
        <button type="button" class="btn" onClick={props.onDone}>
          Cancel
        </button>
        <button type="submit" class="btn go">
          Send
        </button>
      </div>
    </form>
  );
}
