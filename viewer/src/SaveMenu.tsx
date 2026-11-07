// Where a version lives: tick the ideas, designs and states it should be in,
// and flip one switch to take it out of here. Nothing happens until the button,
// which says what will: a move is two changes, and either alone would leave the
// version in the wrong place. Fixed to the window, since Studio's scroller would
// clip it; a sheet on a phone.

import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { isLive } from "../../server/types.ts";
import { api, type SaveCandidate, type TreeNode } from "./api.ts";
import { host, root } from "./host.ts";
import { Icon } from "./icons.tsx";
import type { Add, Drop, Shortlists } from "./shortlist.ts";
import { phoneLayout } from "./viewport.ts";

const WIDTH = 320;
// Below this there is no room for the list under the anchor, so it opens above.
const ROOM = 320;

export type SaveFor = {
  items: { ref: SaveCandidate; name: string }[];
  // Where they are now, in the user's words.
  here: string;
  // What leaving does: a last version takes its alternative along. Null when none
  // can leave, since only a new choice moves what is in use.
  leaves: "archived" | "hidden" | null;
  // How many can leave, and the alternatives that would go entirely.
  out: number;
  archives: string[];
  // Resolves to its undo, or to nothing if they stayed.
  leave: () => Promise<(() => void) | undefined>;
};

type Place = { id: string; title: string; state: string | null };
const keyOf = (id: string, state: string | null) => JSON.stringify([id, state]);
const liveStates = (n: TreeNode) =>
  n.states.filter((st) => n.alternatives.some((v) => v.state === st && isLive(v.status)));

export function SaveMenu(props: {
  sl: Shortlists;
  project: string;
  anchor: HTMLElement;
  item: SaveFor;
  // Opened to Move: the switch that takes them from here starts on.
  move?: boolean;
  onClose: () => void;
  // Once a change is on its way.
  onDone?: () => void;
}) {
  const sl = props.sl;
  const it = props.item;
  let menu: HTMLDivElement | undefined;
  const place = () => {
    const r = props.anchor.getBoundingClientRect();
    const w = host().window;
    const left = Math.max(8, Math.min(r.right - WIDTH, w.innerWidth - WIDTH - 8));
    const below = w.innerHeight - r.bottom - 12;
    return below >= ROOM
      ? { left: `${left}px`, top: `${r.bottom + 4}px`, "max-height": `${below}px` }
      : {
          left: `${left}px`,
          bottom: `${w.innerHeight - r.top + 4}px`,
          // Short enough to stay clear of the top bar, which sits above it.
          "max-height": `${Math.max(Math.min(r.top - 12, 460), ROOM)}px`,
        };
  };
  const shut = (focus = false) => {
    props.onClose();
    if (focus) props.anchor.focus();
  };
  createEffect(() => {
    const doc = root();
    const win = host().window;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      shut(true);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu?.contains(t) && !props.anchor.contains(t)) shut();
    };
    // It is placed once, so it would float off its card as Studio scrolls; its
    // own list scrolling is the menu in use.
    const onScroll = (e: Event) => {
      if (!menu?.contains(e.target as Node)) shut();
    };
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("pointerdown", onDown, true);
    win.addEventListener("scroll", onScroll, true);
    onCleanup(() => {
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("pointerdown", onDown, true);
      win.removeEventListener("scroll", onScroll, true);
    });
  });
  // A phone's keyboard would cover the list it is meant to search.
  onMount(() => {
    if (!phoneLayout()) menu?.querySelector<HTMLElement>("input")?.focus({ preventScroll: true });
  });

  // Not before it opens: most visits save nothing.
  const [tree] = createResource(() => api.tree(props.project).catch(() => null));
  const nodes = () => tree()?.tree ?? [];
  const items = it.items;
  const many = items.length > 1;
  const first = items[0].ref;
  const had = items.flatMap((item) => sl.copiesOf(item.ref).map((c) => ({ ...c, item })));
  const holding = (k: string) => had.filter((c) => keyOf(c.design, c.state) === k);
  // Where every one of them is, none of them, or (as they stand) some of them.
  const [ticks, setTicks] = createSignal(
    new Map<string, "all" | "some">(
      [...new Set(had.map((c) => keyOf(c.design, c.state)))].map((k) => [
        k,
        holding(k).length === items.length ? "all" : "some",
      ]),
    ),
  );
  const flip = (k: string) => {
    const next = new Map(ticks());
    if (next.get(k) === "all") next.delete(k);
    else next.set(k, "all");
    setTicks(next);
  };
  const [opened, setOpened] = createSignal(new Set<string>());
  const [query, setQuery] = createSignal("");
  const [fresh, setFresh] = createSignal("");
  // Opened to Move, the switch starts on; to Keep, off. Left on alone it only applies
  // once a place is added: unticking a copy, or pressing on with nowhere picked, must
  // not take the design away from here.
  const [leaving, setLeaving] = createSignal(!!props.move && !!it.leaves);
  const [switched, setSwitched] = createSignal(false);
  const removes = () => leaving() && (switched() || adds().length > 0);
  const q = () => query().trim().toLowerCase();
  const hit = (text: string | null) => !!text && text.toLowerCase().includes(q());

  const shortlists = createMemo(() =>
    sl.lists().filter((l) => l.id !== first.design && hit(l.title)),
  );
  const hereNode = () => nodes().find((n) => n.id === first.design);
  // Nearest first: the rest of the design they are in, then the designs of its area.
  const designs = createMemo(() => {
    const area = hereNode()?.area;
    const rank = (n: TreeNode) => (n.id === first.design ? 0 : area && n.area === area ? 1 : 2);
    return nodes()
      .filter((n) => !n.shortlist && !n.archivedAt)
      .map((n) => {
        const all = liveStates(n).filter((st) => n.id !== first.design || st !== first.state);
        return { n, all, shown: hit(n.title) ? all : all.filter(hit) };
      })
      .filter((m) => m.shown.length)
      .sort((a, b) => rank(a.n) - rank(b.n) || b.n.updatedAt.localeCompare(a.n.updatedAt));
  });
  const titleOf = (id: string) =>
    sl.lists().find((l) => l.id === id)?.title ?? nodes().find((n) => n.id === id)?.title ?? "";
  const places = createMemo<Place[]>(() =>
    [...ticks()].flatMap(([k, how]) => {
      if (how !== "all") return [];
      const [id, state] = JSON.parse(k) as [string, string | null];
      return [{ id, state, title: state ?? titleOf(id) }];
    }),
  );
  const newTitle = () => fresh().trim();
  const allRefs = items.map((x) => x.ref);
  const adds = (): Add[] => [
    ...places().flatMap((p) => {
      const inThere = holding(keyOf(p.id, p.state));
      const refs = items.filter((x) => !inThere.some((c) => c.item === x)).map((x) => x.ref);
      return refs.length ? [{ to: p.id, state: p.state, label: p.title, refs }] : [];
    }),
    ...(newTitle() ? [{ title: newTitle(), label: newTitle(), refs: allRefs }] : []),
  ];
  const drops = (): Drop[] =>
    had
      .filter((c) => !ticks().has(keyOf(c.design, c.state)))
      .map((c) => ({
        id: c.design,
        state: c.state,
        alternative: c.alternative,
        ref: c.item.ref,
        // A gathered idea left empty goes, so taking the removal back finds it by name.
        title: sl.lists().some((l) => l.id === c.design) ? titleOf(c.design) : undefined,
        label: c.state ?? titleOf(c.design),
      }));
  const stays = items.length - it.out;
  const leaveVerb = () => (it.leaves === "hidden" ? "Hide" : "Archive");
  const counted = many ? `${items.length} ` : "";
  const action = () => {
    const a = adds();
    const where = a.length === 1 ? a[0].label : `${a.length} places`;
    if (a.length) return leaving() ? `Move ${counted}to ${where}` : `Keep ${counted}in ${where}`;
    if (removes()) return `${leaveVerb()}${many ? ` ${it.out}` : ""}`;
    return drops().length ? "Remove" : "Done";
  };
  const idle = () => !adds().length && !drops().length && !removes();
  // What a screen including this design shows, which leaving would change: the rule
  // is the server's instanceTarget.
  const showsIn = () => {
    const n = hereNode();
    if (!n?.instanceIn.length || first.state !== n.states[0]) return [];
    const inState = n.alternatives.filter((v) => v.state === first.state);
    const shown =
      inState.find((v) => v.status === "inUse") ??
      inState.find((v) => v.alternative === "default" && isLive(v.status)) ??
      inState.find((v) => isLive(v.status));
    if (!shown || !it.archives.includes(shown.alternative)) return [];
    return n.instanceIn.map((slug) => nodes().find((x) => x.slug === slug)?.title ?? slug);
  };
  const leaveNote = () => {
    const they = many ? "they" : "it";
    if (!it.leaves) return `In use here, so ${they} ${many ? "stay" : "stays"}`;
    if (!leaving()) return many ? "They stay here too" : "Stays here too";
    if (!removes()) return "Pick where to move " + (many ? "them" : "it");
    const left = stays ? `, ${stays} in use stays` : "";
    const word = it.leaves === "hidden" ? "hidden" : "archived";
    if (adds().length) {
      return many ? `Moves ${it.out}${left}` : `Moves it: ${word} here`;
    }
    return many ? `Nowhere else, so ${it.out} go${left}` : `Nowhere else, so it is ${word}`;
  };
  const apply = () => {
    if (idle()) return;
    const leave = removes()
      ? { verb: it.leaves === "hidden" ? "Hid" : "Archived", stays, run: it.leave }
      : null;
    const [a, d] = [adds(), drops()];
    shut(true);
    props.onDone?.();
    void sl.settle(many ? `${items.length} alternatives` : items[0].name, a, d, leave);
  };

  const tick = (id: string, state: string | null, title: string, small?: string) => (
    <label class="save-row" classList={{ sub: state !== null }}>
      <input
        type="checkbox"
        checked={ticks().get(keyOf(id, state)) === "all"}
        ref={(el) =>
          createEffect(() => {
            el.indeterminate = ticks().get(keyOf(id, state)) === "some";
          })
        }
        onChange={() => flip(keyOf(id, state))}
      />
      <span class="save-nm">{title}</span>
      <Show when={small}>
        <span class="n">{small}</span>
      </Show>
    </label>
  );
  const liveOf = (n: TreeNode) => n.alternatives.filter((v) => isLive(v.status)).length;
  return (
    <div
      class="savemenu"
      classList={{ phone: phoneLayout() }}
      role="dialog"
      aria-label={`${leaving() ? "Move" : "Keep"} ${many ? `${items.length} alternatives` : items[0].name}`}
      ref={(el) => (menu = el)}
      style={phoneLayout() ? undefined : place()}
    >
      <div class="save-h">
        {`${leaving() ? "Move" : "Keep"} ${many ? `${items.length} alternatives` : items[0].name} ${leaving() ? "to" : "in"}`}
      </div>
      <input
        class="save-find"
        type="search"
        placeholder="Find a design"
        aria-label="Find a design"
        value={query()}
        onInput={(e) => setQuery(e.currentTarget.value)}
      />
      <div class="save-list">
        <Show when={shortlists().length}>
          <div class="save-sec">Ideas you gathered</div>
          <For each={shortlists()}>
            {(l) => tick(l.id, null, l.title, String(l.candidates.length))}
          </For>
        </Show>
        <Show when={designs().length}>
          <div class="save-sec">Designs</div>
          <For each={designs()}>
            {(m) => {
              const flat = () => m.all.length === 1 && m.all[0] === null;
              const chosen = () => m.all.filter((st) => ticks().has(keyOf(m.n.id, st))).length;
              // A search that found a state shows it; one that found the design's
              // name says nothing about which state is wanted.
              const open = () => (!!q() && !hit(m.n.title)) || chosen() > 0 || opened().has(m.n.id);
              return (
                <Show when={!flat()} fallback={tick(m.n.id, null, m.n.title, String(liveOf(m.n)))}>
                  <button
                    type="button"
                    class="save-row"
                    aria-expanded={open()}
                    onClick={() => {
                      const next = new Set(opened());
                      if (!next.delete(m.n.id)) next.add(m.n.id);
                      setOpened(next);
                    }}
                  >
                    <Icon name={open() ? "down" : "next"} />
                    <span class="save-nm">{m.n.title}</span>
                    <span class="n">
                      {chosen()
                        ? `${chosen()} ticked`
                        : `${m.all.length} ${m.all.length === 1 ? "state" : "states"}`}
                    </span>
                  </button>
                  <Show when={open()}>
                    <For each={m.shown}>{(st) => tick(m.n.id, st, st ?? m.n.title)}</For>
                  </Show>
                </Show>
              );
            }}
          </For>
        </Show>
        <Show when={tree.loading}>
          <p class="save-none">Loading designs…</p>
        </Show>
        <Show when={tree() === null}>
          <p class="save-none">Couldn't load the other designs. Close this and try again.</p>
        </Show>
        <Show when={tree() && q() && !designs().length && !shortlists().length}>
          <p class="save-none">{`Nothing called "${query().trim()}"`}</p>
        </Show>
      </div>
      <form
        class="save-new"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <Icon name="plus" />
        <input
          type="text"
          placeholder="New idea"
          aria-label="New idea name"
          maxLength={120}
          value={fresh()}
          onInput={(e) => setFresh(e.currentTarget.value)}
        />
      </form>
      <div class="save-foot">
        <label class="save-leave" classList={{ off: !it.leaves }}>
          <input
            type="checkbox"
            role="switch"
            disabled={!it.leaves}
            checked={leaving()}
            onChange={(e) => {
              setSwitched(true);
              setLeaving(e.currentTarget.checked);
            }}
          />
          <span>
            {`Remove from ${it.here}`}
            <small>{leaveNote()}</small>
            <Show when={removes() && showsIn().length}>
              <small class="warn">{`${showsIn().join(", ")} will show another alternative`}</small>
            </Show>
          </span>
        </label>
        <div class="save-btns">
          <button type="button" class="btn" onClick={() => shut(true)}>
            Cancel
          </button>
          <button type="button" class="btn go" disabled={idle()} onClick={apply}>
            {action()}
          </button>
        </div>
      </div>
    </div>
  );
}
