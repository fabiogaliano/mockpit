// Gathering versions into an idea from the project's other designs: a design at a
// time, a state at a time, or by name across all of them. With no idea to add to, it
// starts one and goes there, typed by where it was started: the design it is for, what
// it would become, the area it is in. The dialog is the browser's own, so the page behind it is
// inert and Esc closes it.

import { createMemo, createResource, createSignal, For, onMount, Show } from "solid-js";
import { type IdeaBecomes, isLive } from "../../server/types.ts";
import { api, assetUrl, surfaceUrl, type SaveCandidate, type TreeNode } from "./api.ts";
import { frameMode, posterShown } from "./systemRev.ts";
import { Icon } from "./icons.tsx";
import { designPath, navigate } from "./route.ts";
import { phoneLayout } from "./viewport.ts";
import type { Shortlists } from "./shortlist.ts";
import { FRAME_W, Thumb } from "./Thumb.tsx";

// A name can match hundreds of alternatives; each without a poster is a live page.
const MATCHES_SHOWN = 24;

type Row = TreeNode["alternatives"][number];

export interface NewIdeaTyping {
  for?: { id: string; title: string };
  becomes?: IdeaBecomes;
  area?: string;
}
type Card = { node: TreeNode; v: Row };
const keyOf = (c: Card) => JSON.stringify([c.node.id, c.v.state, c.v.alternative]);

export function AddCandidates(props: {
  sl: Shortlists;
  project: string;
  // The idea to add to; none starts a new one, named here.
  list?: { id: string; title: string };
  typed?: NewIdeaTyping;
  onDone?: (added: number) => void;
  onClose: () => void;
}) {
  const [name, setName] = createSignal("");
  const title = () =>
    props.list?.title ??
    (props.typed?.for
      ? `New idea for ${props.typed.for.title}`
      : props.typed?.becomes
        ? `New idea for a ${props.typed.becomes}`
        : "New idea");
  let dialog!: HTMLDialogElement;
  let filterEl!: HTMLInputElement;
  let nameEl: HTMLInputElement | undefined;
  onMount(() => {
    dialog.showModal();
    (nameEl ?? filterEl).focus();
  });
  const [tree] = createResource(() => api.tree(props.project));
  const sources = createMemo(() =>
    (tree()?.tree ?? [])
      .filter((n) => !n.shortlist && !n.archivedAt && n.alternatives.some((v) => isLive(v.status)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );
  // An idea for a design starts from that design's own versions.
  const [picked, setPicked] = createSignal<string | null>(props.typed?.for?.id ?? null);
  const node = () => sources().find((n) => n.id === picked()) ?? sources()[0];
  const liveOf = (n: TreeNode) => n.alternatives.filter((v) => isLive(v.status));
  const statesOf = (n: TreeNode) => [...new Set(liveOf(n).map((v) => v.state))];
  const [stateIn, setStateIn] = createSignal<string | null | undefined>(undefined);
  const state = () => {
    const n = node();
    if (!n) return null;
    const all = statesOf(n);
    const s = stateIn();
    return s !== undefined && all.includes(s) ? s : all[0];
  };
  const [filter, setFilter] = createSignal("");
  const query = () => filter().trim().toLowerCase();
  const matches = createMemo(() =>
    sources().flatMap((n) =>
      liveOf(n)
        .filter((v) => v.alternative.toLowerCase().includes(query()))
        .map((v): Card => ({ node: n, v })),
    ),
  );
  const cards = (): Card[] => {
    if (query()) return matches().slice(0, MATCHES_SHOWN);
    const n = node();
    return n
      ? liveOf(n)
          .filter((v) => v.state === state())
          .map((v) => ({ node: n, v }))
      : [];
  };
  const inList = (c: Card) => {
    const list = props.sl.lists().find((l) => l.id === props.list?.id);
    return !!list?.candidates.some(
      (x) =>
        x.copiedFrom?.design === c.node.id &&
        x.copiedFrom.state === c.v.state &&
        x.copiedFrom.alternative === c.v.alternative,
    );
  };
  const [chosen, setChosen] = createSignal<Map<string, SaveCandidate>>(new Map());
  const toggle = (c: Card) => {
    const next = new Map(chosen());
    const k = keyOf(c);
    if (next.has(k)) next.delete(k);
    else {
      next.set(k, {
        design: c.node.id,
        state: c.v.state,
        alternative: c.v.alternative,
        version: c.v.version,
      });
    }
    setChosen(next);
  };
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const add = async () => {
    if (busy() || !chosen().size) return;
    setBusy(true);
    setError(null);
    try {
      const candidates = [...chosen().values()];
      const typed = props.typed ?? {};
      const { to } = await api.saveCopies(
        props.list
          ? { to: props.list.id, candidates }
          : {
              title: name().trim(),
              ...(typed.for ? { for: typed.for.id } : {}),
              ...(typed.becomes ? { becomes: typed.becomes } : {}),
              ...(typed.area ? { area: typed.area } : {}),
              candidates,
            },
      );
      await props.sl.load();
      props.onDone?.(chosen().size);
      dialog.close();
      if (!props.list) navigate(designPath(props.project, to.slug));
    } catch (e) {
      setError(`Couldn't add them. ${e instanceof Error ? e.message : e}`);
      setBusy(false);
    }
  };
  return (
    <dialog
      class="slpick"
      classList={{ phone: phoneLayout() }}
      ref={(el) => (dialog = el)}
      aria-label={title()}
      onClose={props.onClose}
    >
      <header class="slpick-h">
        <Show when={props.list} fallback={<h2>{title()}</h2>}>
          <h2>{`Add to ${title()}`}</h2>
        </Show>
        <Show when={!props.list}>
          <input
            class="slpick-name"
            ref={(el) => (nameEl = el)}
            type="text"
            maxLength={120}
            placeholder="What is it?"
            aria-label="Name of the idea"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </Show>
        <button
          type="button"
          class="ib"
          aria-label="Close"
          title="Close (Esc)"
          onClick={() => dialog.close()}
        >
          <Icon name="close" />
        </button>
      </header>
      <div class="slpick-body">
        <nav class="slpick-side" aria-label="Where to pick from">
          <input
            class="slpick-filter"
            ref={(el) => (filterEl = el)}
            type="search"
            placeholder="Filter by name"
            aria-label="Filter by name"
            value={filter()}
            onInput={(e) => setFilter(e.currentTarget.value)}
          />
          <div class="slpick-designs">
            <For each={sources()}>
              {(n) => (
                <button
                  type="button"
                  aria-current={!query() && node()?.id === n.id ? "true" : undefined}
                  onClick={() => {
                    setFilter("");
                    setPicked(n.id);
                    setStateIn(undefined);
                  }}
                >
                  <span class="slmenu-nm">{n.title}</span>
                  <span class="n">{liveOf(n).length}</span>
                </button>
              )}
            </For>
          </div>
        </nav>
        <div class="slpick-main">
          <Show when={!query() && node() && statesOf(node()!).length > 1}>
            <div class="slpick-tabs" role="group" aria-label="State">
              <For each={statesOf(node()!)}>
                {(st) => (
                  <button
                    type="button"
                    aria-pressed={state() === st}
                    onClick={() => setStateIn(st)}
                  >
                    {st ?? node()!.title}
                  </button>
                )}
              </For>
            </div>
          </Show>
          <Show when={query() && !matches().length}>
            <p class="slpick-none">
              {`Nothing named “${filter().trim()}”. `}
              <button type="button" class="toast-undo" onClick={() => setFilter("")}>
                Clear the filter
              </button>
            </p>
          </Show>
          <Show when={tree.error}>
            <p class="slpick-none">
              Couldn't load this project's designs. Close this and try again.
            </p>
          </Show>
          <div class="slpick-grid">
            <For each={cards()}>
              {(c) => (
                <CandidateCard
                  card={c}
                  showDesign={!!query()}
                  already={inList(c)}
                  on={chosen().has(keyOf(c))}
                  onToggle={() => toggle(c)}
                />
              )}
            </For>
          </div>
          <Show when={query() && matches().length > MATCHES_SHOWN}>
            <p class="slpick-none">
              {`Showing ${MATCHES_SHOWN} of ${matches().length}. Type more of the name to narrow it.`}
            </p>
          </Show>
        </div>
      </div>
      <footer class="slpick-f">
        <Show when={error()}>
          {(msg) => (
            <p class="cmenu-err" role="alert">
              {msg()}
            </p>
          )}
        </Show>
        <span class="grow" />
        <button type="button" class="btn" onClick={() => dialog.close()}>
          Cancel
        </button>
        <button
          type="button"
          class="btn go"
          disabled={!chosen().size || busy() || (!props.list && !name().trim())}
          onClick={() => void add()}
        >
          {chosen().size ? `Add ${chosen().size}` : "Add"}
        </button>
      </footer>
    </dialog>
  );
}

function CandidateCard(props: {
  card: Card;
  showDesign: boolean;
  already: boolean;
  on: boolean;
  onToggle: () => void;
}) {
  const v = () => props.card.v;
  const src = () =>
    v().surface < 0
      ? null
      : surfaceUrl(v().postId, v().surface, {
          version: v().version,
          mode: frameMode(),
          w: v().rewrites,
        });
  return (
    <button
      type="button"
      class="slcard"
      role="checkbox"
      aria-checked={props.on}
      aria-disabled={props.already}
      aria-label={props.already ? `${v().alternative}, already in this idea` : v().alternative}
      onClick={() => !props.already && props.onToggle()}
    >
      <span class="slcard-art">
        <Show
          when={posterShown(v().poster)}
          fallback={
            <Show when={src()}>
              {(u) => <Thumb src={u()} width={props.card.node.widths[0] ?? FRAME_W} fit whole />}
            </Show>
          }
        >
          {(p) => <img src={assetUrl(p())} alt="" loading="lazy" decoding="async" />}
        </Show>
        <Show
          when={props.already}
          fallback={
            <span class="slcard-box">
              <Show when={props.on}>
                <Icon name="check" />
              </Show>
            </span>
          }
        >
          <span class="slcard-in">Already in</span>
        </Show>
      </span>
      <span class="slcard-nm">{v().alternative}</span>
      <Show when={props.showDesign}>
        <span class="slcard-from">{props.card.node.title}</span>
      </Show>
    </button>
  );
}
