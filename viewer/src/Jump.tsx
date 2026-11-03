// Search to jump: a box from anywhere (/ or ⌘K, or a button where there are no
// keys) that goes to a mock by anything it's remembered by, this project first
// and then the others. An empty box lists what this browser opened last. Every
// word in a result is the agent's or the user's, so it's all text nodes here. No
// live frames in the results: they change per keystroke, and each would be a page
// loading.

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
import { api, type JumpHit } from "./api.ts";
import { questions } from "./albums.ts";
import { FIELD } from "./flowKeys.ts";
import { host, root } from "./host.ts";
import { Icon, type IconName } from "./icons.tsx";
import { linkClick, mockPath, navigate, projectPath, questionPath, route } from "./route.ts";

const [isOpen, setOpen] = createSignal(false);
export const openJump = () => setOpen(true);

const RECENT_KEY = "mockpit:recent";
const MAX_RECENT = 12;
const SETTLE_MS = 120;

function recentIds(): string[] {
  try {
    const v: unknown = JSON.parse(host().storage?.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function rememberRecent(id: string) {
  const ids = [id, ...recentIds().filter((x) => x !== id)].slice(0, MAX_RECENT);
  try {
    host().storage?.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {
    // Full or locked storage: the empty box just has less to offer.
  }
}

const hitPath = (hit: JumpHit): string => {
  if (hit.slug === null) return projectPath(hit.project, null, hit.area);
  if (hit.match === "question" && hit.open > 0) return questionPath(hit.project, hit.slug);
  return mockPath(
    hit.project,
    hit.slug,
    hit.state !== null || hit.variant !== null ? { state: hit.state, variant: hit.variant } : null,
  );
};

const hitIcon = (hit: JumpHit): IconName => {
  if (hit.slug === null) return "grid";
  if (hit.kind === "component") return "layers";
  if (hit.width !== null && hit.width < 700) return "phone";
  return "desktop";
};

const MATCH_WORD: Record<JumpHit["match"], string> = {
  title: "",
  state: "State",
  variant: "Variant",
  area: "Area",
  question: "Question",
  note: "Note",
};

const shortProject = (name: string) => name.split("/").pop() ?? name;

function hitWhere(hit: JumpHit, here: string | null): string {
  const place = [
    hit.project === here ? null : shortProject(hit.project),
    hit.slug !== null ? hit.area : null,
  ].filter(Boolean);
  const what = hit.text
    ? `${MATCH_WORD[hit.match]}: ${hit.text}${hit.archived ? " (archived)" : ""}`
    : hit.match === "area"
      ? "Area"
      : null;
  return [...place, what].filter(Boolean).join(" · ");
}

const hitTurn = (hit: JumpHit): string =>
  hit.closed ? "Archived" : hit.open > 0 ? questions(hit.open) : hit.inUse ? "In use" : "";

export function Jump() {
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const chord =
        (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";
      // tunekit's controls live in a shadow root: the first node of the path is
      // the real target, and typing a slash into one is just typing.
      const at = e.composedPath()[0];
      const typing = at instanceof Element && !!at.closest(FIELD);
      const slash = e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !typing;
      if (!chord && !slash) return;
      e.preventDefault();
      setOpen(chord ? !isOpen() : true);
    };
    root().addEventListener("keydown", onKey);
    onCleanup(() => root().removeEventListener("keydown", onKey));
  });
  return (
    <Show when={isOpen()}>
      <JumpBox onClose={() => setOpen(false)} />
    </Show>
  );
}

function JumpBox(props: { onClose: () => void }) {
  const [q, setQ] = createSignal("");
  const [hits, setHits] = createSignal<JumpHit[] | null>(null);
  const [failed, setFailed] = createSignal(false);
  const [active, setActive] = createSignal(0);
  const [copied, setCopied] = createSignal<"yes" | "no" | null>(null);
  const routed = () => {
    const r = route();
    return r.screen === "missing" ? null : r.project;
  };
  // The bare address is the most recent project's home, as on Home.
  const [first] = createResource(
    () => routed() === null,
    (bare) => (bare ? api.projects().then((p) => p[0]?.name ?? null) : null),
  );
  const here = createMemo(() => routed() ?? first() ?? null);
  let input!: HTMLInputElement;
  let list: HTMLDivElement | undefined;
  const opener = root().activeElement;

  // First, in the capture phase: Esc here closes this box and nothing behind it,
  // such as a canvas tool that also listens for it.
  const onEscape = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    props.onClose();
  };
  onMount(() => {
    input.focus();
    root().addEventListener("keydown", onEscape, true);
  });
  onCleanup(() => {
    root().removeEventListener("keydown", onEscape, true);
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  });

  // An answer arriving after a newer keystroke's is dropped: only the last counts.
  let latest = 0;
  createEffect(() => {
    const text = q().trim();
    const scope = here();
    const ask = ++latest;
    const timer = host().window.setTimeout(
      async () => {
        try {
          const res = text
            ? await api.search(text, scope)
            : recentIds().length
              ? await api.searchRecent(recentIds())
              : { hits: [] };
          if (ask !== latest) return;
          setHits(res.hits);
          setFailed(false);
          setActive(0);
          setCopied(null);
        } catch {
          if (ask === latest) setFailed(true);
        }
      },
      text ? SETTLE_MS : 0,
    );
    onCleanup(() => host().window.clearTimeout(timer));
  });

  const go = (hit: JumpHit | undefined) => {
    if (!hit) return;
    props.onClose();
    navigate(hitPath(hit));
  };
  const move = (by: number) => {
    const n = hits()?.length ?? 0;
    if (!n) return;
    const next = (active() + by + n) % n;
    setActive(next);
    list?.querySelector(`[data-i="${next}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      go(hits()?.[active()]);
    } else if (e.key === "Tab") {
      // The results are reached by arrow keys, from the box, as a combobox's are.
      e.preventDefault();
    }
  };
  const heading = (i: number) => {
    const found = hits() ?? [];
    const scope = here();
    if (!q().trim()) return i === 0 ? "Opened last" : null;
    if (!scope) return null;
    const inHere = found[i].project === scope;
    if (i > 0 && inHere === (found[i - 1].project === scope)) return null;
    return inHere ? "This project" : "Other projects";
  };
  const nothing = () => hits()?.length === 0 && !!q().trim();
  const copyPhrase = () => {
    const copying = host().window.navigator.clipboard?.writeText(q().trim());
    if (!copying) return setCopied("no");
    copying.then(
      () => setCopied("yes"),
      () => setCopied("no"),
    );
  };

  return (
    <div
      class="jump-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div class="jump" role="dialog" aria-modal="true" aria-label="Search" onKeyDown={onKey}>
        <div class="jump-box">
          <Icon name="search" />
          <input
            ref={(el) => (input = el)}
            type="text"
            role="combobox"
            aria-expanded={!!hits()?.length}
            aria-controls="jump-results"
            aria-activedescendant={hits()?.length ? `jump-${active()}` : undefined}
            aria-autocomplete="list"
            aria-label="Search titles, states, variants, notes, questions and areas"
            placeholder="Titles, states, variants, notes, questions"
            autocomplete="off"
            spellcheck={false}
            value={q()}
            onInput={(e) => setQ(e.currentTarget.value)}
          />
          <button type="button" class="ib jump-x" aria-label="Close search" onClick={props.onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div
          class="jump-list"
          id="jump-results"
          role="listbox"
          aria-label="Results"
          ref={(el) => (list = el)}
        >
          <For each={hits() ?? []}>
            {(hit, i) => (
              <>
                <Show when={heading(i())}>
                  {(text) => (
                    <div class="jump-hd" role="presentation">
                      {text()}
                    </div>
                  )}
                </Show>
                <a
                  class="jump-row"
                  id={`jump-${i()}`}
                  data-i={i()}
                  role="option"
                  aria-selected={active() === i()}
                  tabIndex={-1}
                  href={hitPath(hit)}
                  onPointerMove={() => setActive(i())}
                  onClick={(e) => {
                    linkClick(e, hitPath(hit));
                    if (e.defaultPrevented) props.onClose();
                  }}
                >
                  <Icon name={hitIcon(hit)} />
                  <span class="jump-text">
                    <span class="jump-title">{hit.title}</span>
                    <Show when={hitWhere(hit, here())}>
                      {(where) => <span class="jump-where">{where()}</span>}
                    </Show>
                  </span>
                  <Show when={hitTurn(hit)}>
                    {(turn) => (
                      <span class="jump-turn" classList={{ waits: hit.open > 0 && !hit.closed }}>
                        {turn()}
                      </span>
                    )}
                  </Show>
                </a>
              </>
            )}
          </For>
          <Show when={nothing()}>
            <div class="jump-none">
              <p>{`Nothing called “${q().trim()}”, in any project.`}</p>
              <button type="button" class="btn" onClick={copyPhrase}>
                {copied() === "yes"
                  ? "Copied"
                  : copied() === "no"
                    ? "Couldn't copy"
                    : "Copy it for your agent"}
              </button>
            </div>
          </Show>
          <Show when={failed()}>
            <p class="jump-none">Search isn't available here.</p>
          </Show>
          <Show when={hits()?.length === 0 && !q().trim() && !failed()}>
            <p class="jump-none">Nothing opened yet. Type to search.</p>
          </Show>
        </div>
      </div>
    </div>
  );
}
