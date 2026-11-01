// Studio: the state zoomed out, every variant side by side with its newest
// version on top, for exploring before anything is in use. A click looks
// closer without leaving: one version large, flipped through in reading order;
// Stage, where answers are, is a deliberate step from there. A fork with a
// single version hangs under the version it came from (a riff) until it has a
// second, then it is a column of its own.
// Each steer (more like this, a comment, a borrow) is its own reply. A moment
// with situations shows one at a time; a variant not drawn in that one keeps
// its column, empty, so the columns never move under the switch.

import { isLive } from "../../server/types.ts";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { assetUrl, surfaceUrl, type VariantView } from "./api.ts";
import { host, readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { sameVersion, type VersionStep } from "./logic.ts";
import type { MockScreenState } from "./state.ts";
import { theme } from "./theme.ts";
import { Thumb } from "./Thumb.tsx";

// More live frames than this and a browser starts dropping WebGL contexts; a
// version past the budget waits as a placeholder until it is pointed at.
const LIVE_MAX = 16;

// The agent's still of the page: an image costs no live frame, so it is
// always shown and never counts against the budget.
const Poster = (props: { id: string }) => (
  <img class="sk-poster" src={assetUrl(props.id)} alt="" loading="lazy" decoding="async" />
);

// Without a poster, an image surface is still cheaper than the page.
function pictureOf(st: VersionStep): string | null {
  const i = st.kinds.includes("image") ? st.kinds.indexOf("image") : st.kinds.indexOf("html");
  return i < 0
    ? null
    : surfaceUrl(st.postId, i, { version: st.version, mode: theme(), w: st.rewrites });
}

type Draft = { kind: "comment" | "borrow"; to: VersionStep; from?: VersionStep };
type Acts = Record<
  "look" | "open" | "more" | "comment" | "borrow" | "pick" | "remove",
  (st: VersionStep) => void
>;

export function Studio(props: { s: MockScreenState; top: number; onOpen: () => void }) {
  const s = props.s;
  const inState = createMemo(() => s.variants().filter((v) => v.state === s.activeState()));
  const shown = createMemo(() => s.steps().filter((st) => !st.hidden));
  const versionsOf = (variant: string) =>
    shown()
      .filter((st) => st.variant === variant)
      .reverse();
  const live = (v: VariantView) => isLive(v.status);
  const here = (v: VariantView) => v.state === s.activeState();
  // One view per variant across the moment, in the order the situations name
  // them, so a switch keeps every column in place.
  const pool = createMemo(() => {
    const sits = s.situations();
    if (!sits.length) return inState();
    const inMoment = (v: VariantView) => sits.some((x) => x.state === v.state);
    const names = [
      ...new Set(
        s
          .variants()
          .filter(inMoment)
          .map((v) => v.variant),
      ),
    ];
    return names.flatMap((n) => {
      const v =
        inState().find((p) => p.variant === n) ??
        s.variants().find((p) => p.variant === n && live(p) && inMoment(p));
      return v ? [v] : [];
    });
  });
  const countIn = (state: string) =>
    s.variants().filter((v) => v.state === state && live(v)).length;
  const situationName = () => s.situations().find((x) => x.state === s.activeState())?.name ?? "";
  const isRiff = (v: VariantView) =>
    !!v.forkedFrom &&
    live(v) &&
    versionsOf(v.variant).length === 1 &&
    inState().some((p) => p.variant === v.forkedFrom?.variant && live(p));
  // Roots in the order they were made, each followed by the forks that grew
  // into columns of their own.
  const columns = createMemo(() => {
    const vs = pool().filter(
      (v) => live(v) && !isRiff(v) && (!here(v) || versionsOf(v.variant).length),
    );
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
  // What Look closer flips through: the columns left to right, each down its
  // versions, a version's forks right after it, as the eye reads the grid.
  const runs = createMemo(() =>
    columns()
      .filter(here)
      .map((v) => ({
        variant: v.variant,
        steps: versionsOf(v.variant).flatMap((st) => [st, ...riffsOf(st)]),
      })),
  );
  const order = createMemo(() => runs().flatMap((r) => r.steps));

  // Archived variants are out of the exploration: a quiet count in the window's
  // corner, opened on purpose.
  const [archivedOpen, setArchivedOpen] = createSignal(false);
  // Live frames: the versions in view, oldest sighting first, up to the budget.
  const [inView, setInView] = createSignal<string[]>([]);
  const key = (st: VersionStep) => `${st.variant}@${st.version}`;
  // Look closer: in the URL (?look=), so Back on a phone closes it and Back
  // from Stage reopens it where you were.
  const readLook = () => new URLSearchParams(host().window.location.search).get("look");
  const lookUrl = (k: string | null) => {
    const w = host().window;
    const q = new URLSearchParams(w.location.search);
    if (k) q.set("look", k);
    else q.delete("look");
    return `${w.location.pathname}?${q}`;
  };
  const [lookKey, setLookKey] = createSignal<string | null>(readLook());
  // Whether the entry under this one is Studio without a closer look, so
  // closing can step back to it instead of stacking another.
  let pushed = false;
  const looking = () => {
    const k = lookKey();
    return k ? (order().find((st) => key(st) === k) ?? null) : null;
  };
  const look = (st: VersionStep) => {
    const h = host().window.history;
    if (lookKey()) h.replaceState(h.state, "", lookUrl(key(st)));
    else {
      h.pushState(h.state, "", lookUrl(key(st)));
      pushed = true;
    }
    setLookKey(key(st));
  };
  const closeLook = () => {
    if (!lookKey()) return;
    if (pushed) {
      pushed = false;
      host().window.history.back();
      return;
    }
    host().window.history.replaceState(host().window.history.state, "", lookUrl(null));
    setLookKey(null);
  };
  const onPop = () => {
    const k = readLook();
    pushed = !!k;
    setLookKey(k);
  };
  onMount(() => host().window.addEventListener("popstate", onPop));
  onCleanup(() => host().window.removeEventListener("popstate", onPop));
  // A version hidden or archived from under the closer look takes it away.
  createEffect(() => {
    if (lookKey() && order().length && !looking()) closeLook();
  });
  // Closing puts you back on the card you were looking at.
  createEffect(
    on(lookKey, (now, before) => {
      if (now || !before) return;
      queueMicrotask(() =>
        scroller
          ?.querySelector<HTMLElement>(`[data-key="${CSS.escape(before)}"] .sk-art`)
          ?.focus({ preventScroll: false }),
      );
    }),
  );
  const step = (d: number) => {
    const list = order();
    const i = list.findIndex((st) => key(st) === lookKey());
    const next = list[i + d];
    if (i >= 0 && next) look(next);
  };

  const inBudget = (st: VersionStep) => {
    // The closer look covers the grid: its one live frame stands in for all of them.
    if (lookKey()) return false;
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
    if (lookKey() && !writing()) {
      const at = e.target as Element | null;
      const typing = !!at?.closest?.("input, textarea, select, [contenteditable]");
      // Space presses a focused button; anywhere else it closes, as Quick Look does.
      const pressing = typing || !!at?.closest?.("button");
      if (e.key === "ArrowRight" && !typing) step(1);
      else if (e.key === "ArrowLeft" && !typing) step(-1);
      else if (e.key === "Escape" || (e.key === " " && !pressing)) closeLook();
      else return;
      e.preventDefault();
      return;
    }
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
    look,
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
      closeLook();
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
      <Show when={s.situations().length > 1}>
        <div class="studio-sits" role="radiogroup" aria-label="Situation">
          <For each={s.situations()}>
            {(x) => (
              <button
                type="button"
                role="radio"
                aria-checked={x.state === s.activeState()}
                onClick={() => {
                  setBorrowFrom(null);
                  setWriting(null);
                  if (x.state !== s.activeState()) s.showState(x.state);
                }}
              >
                {x.name}
                <span class="n">{countIn(x.state)}</span>
              </button>
            )}
          </For>
        </div>
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
              <Show
                when={here(v)}
                fallback={<div class="studio-hole">{`No ${situationName()} yet`}</div>}
              >
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
              </Show>
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
                      <Show
                        when={st()?.poster}
                        fallback={
                          <Show when={archivedOpen() && st() && pictureOf(st())}>
                            {(u) => <Thumb src={u()} width={s.frameW()} fit whole />}
                          </Show>
                        }
                      >
                        {(p) => <Poster id={p()} />}
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
      <Show when={looking()}>
        {(st) => (
          <Look
            s={s}
            st={st()}
            top={props.top}
            order={order()}
            runs={runs()}
            last={versionsOf(st().variant).length === 1}
            onStep={step}
            onClose={closeLook}
            act={act}
          />
        )}
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
  act: Acts;
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
        aria-label={
          props.borrowing && !props.source ? `Borrow into ${label()}` : `Look closer at ${label()}`
        }
        title={st().prompt ?? ""}
        onClick={() => (props.borrowing ? props.act.pick(st()) : props.act.look(st()))}
        onFocus={() => !props.live && props.onWake()}
      >
        <Show
          when={st().poster}
          fallback={
            <Show when={props.live && src()}>
              {(u) => <Thumb src={u()} width={s.frameW()} fit whole />}
            </Show>
          }
        >
          {(p) => <Poster id={p()} />}
        </Show>
      </button>
      <Show when={props.small}>
        <span class="sk-name" title={st().variant}>
          {st().variant}
        </span>
      </Show>
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

// One version large over the grid. Arrows, the strip or a swipe flip through
// Studio's reading order; Esc, Space or a swipe down go back to the card. The
// steers are the card's, and Stage is one deliberate step away.
function Look(props: {
  s: MockScreenState;
  st: VersionStep;
  top: number;
  order: VersionStep[];
  runs: { variant: string; steps: VersionStep[] }[];
  last: boolean;
  onStep: (d: number) => void;
  onClose: () => void;
  act: Acts;
}) {
  const s = props.s;
  const st = () => props.st;
  const at = () => props.order.findIndex((x) => sameVersion(x, st()));
  const name = () => s.nameOf(st());
  const inUse = () => sameVersion(s.inUse(), st());
  const note = () =>
    s.variants().find((v) => v.state === s.activeState() && v.variant === st().variant)?.note;
  const can = () => !readonly();
  let box: HTMLDivElement | undefined;
  onMount(() => box?.focus({ preventScroll: true }));
  // A swipe across flips, a swipe down closes; a tap is left alone.
  let start: { x: number; y: number; id: number } | null = null;
  const down = (e: PointerEvent) => {
    if (e.pointerType === "mouse") return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const up = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) props.onStep(dx < 0 ? 1 : -1);
    else if (dy > 90 && dy > Math.abs(dx) * 1.5) props.onClose();
  };
  const hide = () => {
    const list = props.order;
    const next = list[at() + 1] ?? list[at() - 1];
    const gone = st();
    if (next) props.act.look(next);
    else props.onClose();
    props.act.remove(gone);
  };
  return (
    <div
      class="look"
      ref={(el) => (box = el)}
      tabIndex={-1}
      role="dialog"
      aria-label={`Look closer: ${name()}`}
      style={{ top: `${props.top}px` }}
    >
      <header class="look-h">
        <h2>{name()}</h2>
        <Show when={inUse()}>
          <span class="sk-tag">in use</span>
        </Show>
        <span class="look-at">{`${at() + 1} of ${props.order.length}`}</span>
        <span class="look-sp" />
        <button type="button" class="btn look-stage" onClick={() => props.act.open(st())}>
          Open on Stage
        </button>
        <button
          type="button"
          class="ib"
          aria-label="Back to Studio"
          title="Back to Studio (Esc)"
          onClick={props.onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      <div
        class="look-art"
        onPointerDown={down}
        onPointerUp={up}
        onPointerCancel={() => (start = null)}
      >
        <button
          type="button"
          class="ib look-nav"
          aria-label="Previous"
          disabled={at() <= 0}
          onClick={() => props.onStep(-1)}
        >
          <Icon name="prev" />
        </button>
        <div class="look-frame">
          <Show
            when={pictureOf(st())}
            keyed
            fallback={<Show when={st().poster}>{(p) => <Poster id={p()} />}</Show>}
          >
            {(u) => <Thumb src={u} width={s.frameW()} fit whole title={name()} />}
          </Show>
        </div>
        <button
          type="button"
          class="ib look-nav"
          aria-label="Next"
          disabled={at() >= props.order.length - 1}
          onClick={() => props.onStep(1)}
        >
          <Icon name="next" />
        </button>
      </div>
      <Show when={note()}>
        <p class="look-note">{note()}</p>
      </Show>
      <Show when={can()}>
        <div class="look-acts" role="group" aria-label={`Steer ${name()}`}>
          <button type="button" class="btn" onClick={() => props.act.more(st())}>
            <Icon name="spark" />
            More like this
          </button>
          <button type="button" class="btn" onClick={() => props.act.comment(st())}>
            <Icon name="mark" />
            Comment
          </button>
          <button type="button" class="btn" onClick={() => props.act.borrow(st())}>
            <Icon name="borrow" />
            Borrow
          </button>
          <Show when={!inUse()}>
            <button type="button" class="btn quiet" onClick={hide}>
              {props.last ? "Archive" : "Hide"}
            </button>
          </Show>
        </div>
      </Show>
      <nav class="look-strip" aria-label="Versions">
        <For each={props.runs}>
          {(run) => (
            <div class="look-group">
              <span class="look-gname">{run.variant}</span>
              <div class="look-dots">
                <For each={run.steps}>
                  {(x) => (
                    <button
                      type="button"
                      class="look-dot"
                      classList={{ on: sameVersion(x, st()) }}
                      aria-label={s.nameOf(x)}
                      aria-current={sameVersion(x, st()) || undefined}
                      title={s.nameOf(x)}
                      onClick={() => props.act.look(x)}
                    />
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </nav>
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
    const sent = f ? `Borrow into ${s.nameOf(to())}, sent` : `Comment on ${s.nameOf(to())}, sent`;
    void s
      .steer({
        variant: to().variant,
        version: to().version,
        part: f ? null : part(),
        text: what,
        ...(f ? { borrow: { from: f, ...(part() ? { part: part()! } : {}) } } : {}),
      })
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
