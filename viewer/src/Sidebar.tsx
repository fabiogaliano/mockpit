// A project's Home, one step away from everything in it. Each row is here only
// when there's something behind it: a project that names no area, asks nothing and
// declares nothing shows none of that. With a single section there are no section
// rows, just the mocks; a project of one or two mocks gets no sidebar at all (Home).
// On a phone the same column is a drawer.

import { createSignal, For, type JSX, Show } from "solid-js";
import type { DecisionListView, ProjectSummary, TreeNode } from "./api.ts";
import { type Section, SECTION_LABEL } from "./albums.ts";
import { ChromeButtons } from "./TopBar.tsx";
import { Decisions } from "./Decisions.tsx";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { openJump } from "./Jump.tsx";
import { linkClick, mockPath, type HomePlace, projectPath } from "./route.ts";
import { ProjectSwitcher } from "./ProjectSwitcher.tsx";

export interface SidebarArea {
  name: string;
  count: number;
  waits: boolean;
}

export function Sidebar(props: {
  project: string;
  projects: ProjectSummary[];
  place: HomePlace | "area" | "tiny" | null;
  area: string | null;
  open: number;
  rows: { sec: Section; count: number }[];
  foot: { sec: Section; count: number } | null;
  areas: SidebarArea[];
  // The mocks themselves, in place of section rows, when there's one small section.
  tree: { area: string | null; nodes: TreeNode[] }[] | null;
  decisions: DecisionListView | null;
  onDecisions: (next: DecisionListView) => void;
  archived: number;
  activity: boolean;
  // A plain click swaps what Home shows, keeping one history entry.
  go: (e: MouseEvent, path: string) => void;
  onNav: () => void;
  drawer?: boolean;
  inert?: boolean;
}) {
  const [decisionsOpen, setDecisionsOpen] = createSignal(false);
  const lines = () => props.decisions?.lines.length ?? 0;
  const link = (
    path: () => string,
    current: () => boolean,
    body: JSX.Element,
    cls: string = "side-row",
  ) => (
    <a
      class={cls}
      href={path()}
      aria-current={current() ? "page" : undefined}
      onClick={(e) => {
        props.go(e, path());
        props.onNav();
      }}
    >
      {body}
    </a>
  );
  return (
    <aside
      class="side"
      classList={{ "side-drawer": !!props.drawer }}
      aria-label="Project"
      inert={props.inert || undefined}
    >
      <div class="side-top">
        <ProjectSwitcher
          current={props.project}
          known
          projects={props.projects}
          stacked
          onPicked={props.onNav}
        />
        <button
          type="button"
          class="side-search"
          title="Search ( / or ⌘K )"
          onClick={() => {
            props.onNav();
            openJump();
          }}
        >
          <Icon name="search" />
          <span>Search</span>
          <kbd>/</kbd>
        </button>
      </div>
      <div class="side-scroll">
        <Show when={props.open > 0}>
          {link(
            () => projectPath(props.project, "needs"),
            () => props.place === "needs",
            <>
              <span class="side-nm">
                <Show when={!readonly()}>
                  <i class="glow-dot" aria-hidden="true" />
                </Show>
                Needs you
              </span>
              <span class="side-n">{props.open}</span>
            </>,
            "side-row side-needs",
          )}
        </Show>
        <Show when={props.rows.length + (props.foot ? 1 : 0) > 1}>
          <nav class="side-group" aria-label="Sections">
            <For each={props.rows}>
              {(row) =>
                link(
                  () => projectPath(props.project, row.sec),
                  () => props.place === row.sec,
                  <>
                    <span class="side-nm">{SECTION_LABEL[row.sec]}</span>
                    <span class="side-n">{row.count}</span>
                  </>,
                )
              }
            </For>
          </nav>
        </Show>
        <Show when={props.tree}>
          {(groups) => (
            <nav class="side-group" aria-label="Designs">
              <For each={groups()}>
                {(g) => (
                  <>
                    <Show when={g.area}>{(a) => <h6 class="side-hd">{a()}</h6>}</Show>
                    <For each={g.nodes}>
                      {(n) => {
                        const href = () => mockPath(props.project, n.slug);
                        return (
                          <a
                            class="side-row"
                            href={href()}
                            onClick={(e) => {
                              linkClick(e, href());
                              props.onNav();
                            }}
                          >
                            <span class="side-nm">{n.title}</span>
                            <Show when={n.open > 0}>
                              <span class="side-n side-waits" aria-label={`${n.open} waiting`}>
                                {n.open}
                              </span>
                            </Show>
                          </a>
                        );
                      }}
                    </For>
                  </>
                )}
              </For>
            </nav>
          )}
        </Show>
        <Show when={!props.tree && props.areas.length}>
          <nav class="side-group" aria-label="Areas">
            <h6 class="side-hd">Areas</h6>
            <For each={props.areas}>
              {(a) =>
                link(
                  () => projectPath(props.project, null, a.name),
                  () => props.area === a.name,
                  <>
                    <span class="side-nm">
                      <Show when={a.waits}>
                        <i class="dot" aria-label="questions waiting" />
                      </Show>
                      {a.name}
                    </span>
                    <span class="side-n">{a.count}</span>
                  </>,
                )
              }
            </For>
          </nav>
        </Show>
        <Show when={lines() > 0}>
          <div class="side-group side-decisions">
            <Show
              when={props.place !== "decisions"}
              fallback={link(
                () => projectPath(props.project, "decisions"),
                () => true,
                <>
                  <span class="side-nm">Decisions</span>
                  <span class="side-n">{lines()}</span>
                </>,
              )}
            >
              <button
                type="button"
                class="side-row"
                aria-expanded={decisionsOpen()}
                onClick={() => setDecisionsOpen(!decisionsOpen())}
              >
                <span class="side-nm">
                  <span class="answered-chev" aria-hidden="true">
                    ›
                  </span>
                  Decisions
                </span>
                <span class="side-n">{lines()}</span>
              </button>
              <Show when={decisionsOpen() && props.decisions}>
                {(list) => (
                  <div class="side-decisions-body">
                    {link(
                      () => projectPath(props.project, "decisions"),
                      () => false,
                      <>Open as a page ›</>,
                      "side-more",
                    )}
                    <Decisions
                      project={props.project}
                      lines={list().lines}
                      onChange={props.onDecisions}
                    />
                  </div>
                )}
              </Show>
            </Show>
          </div>
        </Show>
      </div>
      <div class="side-foot">
        <Show when={props.foot}>
          {(row) =>
            link(
              () => projectPath(props.project, row().sec),
              () => props.place === row().sec,
              <>
                <span class="side-nm">{SECTION_LABEL[row().sec]}</span>
                <span class="side-n">{row().count}</span>
              </>,
            )
          }
        </Show>
        <Show when={props.archived > 0}>
          {link(
            () => projectPath(props.project, "archive"),
            () => props.place === "archive",
            <>
              <span class="side-nm">Archive</span>
              <span class="side-n">{props.archived}</span>
            </>,
          )}
        </Show>
        <Show when={props.activity}>
          {link(
            () => projectPath(props.project, "activity"),
            () => props.place === "activity",
            <span class="side-nm">Activity</span>,
          )}
        </Show>
        <div class="side-chrome">
          <span class="side-brand">mockpit</span>
          <span class="grow" />
          <ChromeButtons />
        </div>
      </div>
    </aside>
  );
}
