// The project name, and from it every project, each saying whether it waits on
// the user. Where there's no sidebar, the name carries a number, the one mark that
// reaches past the project on screen. In the sidebar it would sit above that project's
// own count and read as this project's, so there the menu says it. Recent first; a project with no work in 30 days folds under Older,
// unless it waits on the user, which never folds away.

import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { ProjectSummary } from "./api.ts";
import { questions } from "./albums.ts";
import { host, readonly, root } from "./host.ts";
import { Icon } from "./icons.tsx";
import { timeAgo } from "./logic.ts";
import { homePath, linkClick } from "./route.ts";

const OLDER_MS = 30 * 24 * 60 * 60 * 1000;
// Few enough to scan; past this a box to narrow them earns its place.
const FILTER_FROM = 9;

export function ProjectSwitcher(props: {
  current: string | null;
  known: boolean;
  projects: ProjectSummary[];
  // Stacks the owner over the name, where a narrow column would cut the name off.
  stacked?: boolean;
  onPicked?: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [filter, setFilter] = createSignal("");
  const [olderOpen, setOlderOpen] = createSignal(false);
  let btn!: HTMLButtonElement;
  let menu: HTMLDivElement | undefined;

  const shut = (focus = false) => {
    setOpen(false);
    setFilter("");
    if (focus) btn?.focus();
  };
  createEffect(() => {
    if (!open()) return;
    const doc = root();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      shut(true);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu?.contains(t) && !btn.contains(t)) shut();
    };
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("pointerdown", onDown, true);
    onCleanup(() => {
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("pointerdown", onDown, true);
    });
  });

  // A public read-only viewer owes nothing to anyone.
  const waitingOn = (p: ProjectSummary) => (readonly() ? 0 : p.open);
  const total = createMemo(() => props.projects.reduce((n, p) => n + waitingOn(p), 0));
  const waitingProjects = createMemo(() => props.projects.filter((p) => waitingOn(p) > 0).length);
  const isOlder = (p: ProjectSummary) =>
    !waitingOn(p) &&
    p.name !== props.current &&
    Date.now() - Date.parse(p.lastActiveAt || "1970-01-01") > OLDER_MS;
  const narrowed = createMemo(() => {
    const f = filter().trim().toLowerCase();
    return f ? props.projects.filter((p) => p.name.toLowerCase().includes(f)) : null;
  });
  const recent = () => narrowed() ?? props.projects.filter((p) => !isOlder(p));
  const older = () => (narrowed() ? [] : props.projects.filter(isOlder));

  const owner = () => {
    const name = props.current ?? "";
    const cut = name.lastIndexOf("/");
    return cut > 0 ? name.slice(0, cut) : null;
  };
  const shortName = () => (props.current ?? "").split("/").pop() ?? "";
  const summary = () =>
    `${questions(total())} across ${waitingProjects()} ${waitingProjects() === 1 ? "project" : "projects"}`;

  const row = (p: ProjectSummary) => {
    const href = homePath(p.name);
    return (
      <a
        class="proj-row"
        href={href}
        aria-current={p.name === props.current ? "page" : undefined}
        onClick={(e) => {
          linkClick(e, href);
          shut();
          props.onPicked?.();
        }}
      >
        <span class="proj-row-name">{p.name}</span>
        <Show
          when={waitingOn(p) > 0}
          fallback={
            <Show when={p.lastActiveAt}>
              {(at) => <span class="proj-row-ago">{timeAgo(at())}</span>}
            </Show>
          }
        >
          <span class="proj-row-waits">{questions(waitingOn(p))}</span>
        </Show>
      </a>
    );
  };

  return (
    <div class="proj" classList={{ stacked: !!props.stacked }}>
      <Show
        when={props.projects.length > 1 || !props.known}
        fallback={<b class="proj-name">{props.current ?? ""}</b>}
      >
        <button
          type="button"
          class="proj-btn"
          ref={(el) => (btn = el)}
          aria-haspopup="true"
          aria-expanded={open()}
          aria-label={
            total() > 0
              ? `Project: ${props.current ?? "none"}. ${summary()}`
              : `Project: ${props.current ?? "none"}`
          }
          title={total() > 0 ? summary() : undefined}
          onClick={() => setOpen(!open())}
        >
          <span class="proj-label">
            <Show when={props.known} fallback={<span class="proj-title">Choose a project</span>}>
              <Show when={props.stacked && owner()}>
                {(o) => <span class="proj-owner">{o()}</span>}
              </Show>
              <span class="proj-title">{props.stacked ? shortName() : (props.current ?? "")}</span>
            </Show>
          </span>
          <Show when={total() > 0 && !props.stacked}>
            <span class="proj-total">{total()}</span>
          </Show>
          <Icon name="down" />
        </button>
      </Show>
      <Show when={open()}>
        <div class="proj-menu" ref={(el) => (menu = el)}>
          <Show when={props.projects.length >= FILTER_FROM}>
            <input
              class="proj-filter"
              type="text"
              placeholder="Find a project"
              aria-label="Find a project"
              autocomplete="off"
              spellcheck={false}
              value={filter()}
              ref={(el) => {
                // Not on a phone: the keyboard would cover the list it narrows.
                if (host().window.matchMedia?.("(pointer: fine)").matches) {
                  queueMicrotask(() => el.focus());
                }
              }}
              onInput={(e) => setFilter(e.currentTarget.value)}
            />
          </Show>
          <nav class="proj-list" aria-label="Projects">
            <For each={recent()}>{row}</For>
            <Show when={older().length}>
              <button
                type="button"
                class="proj-older"
                aria-expanded={olderOpen()}
                onClick={() => setOlderOpen(!olderOpen())}
              >
                <span class="answered-chev" aria-hidden="true">
                  ›
                </span>
                {`Older · ${older().length}`}
              </button>
              <Show when={olderOpen()}>
                <For each={older()}>{row}</For>
              </Show>
            </Show>
            <Show when={narrowed()?.length === 0}>
              <p class="proj-none">No project by that name.</p>
            </Show>
          </nav>
        </div>
      </Show>
    </div>
  );
}
