// A project's Home, one step away from everything in it. mockpit's own words are
// rows and the project's areas are chips, so the two never read as one list and
// neither nests under the other. Each is here only when there's something behind it:
// a project that names no area has no chips. With a single section there are no
// section rows, just the mocks; a project of one or two mocks gets no sidebar at all
// (Home). On a phone the same column is a drawer.

import { For, type JSX, Show } from "solid-js";
import type { ProjectSummary, TreeNode } from "./api.ts";
import { type Section, SECTION_LABEL } from "./albums.ts";
import { ChromeButtons } from "./TopBar.tsx";
import { Icon, type IconName } from "./icons.tsx";
import { openJump } from "./Jump.tsx";
import { linkClick, mockPath, type HomePlace, projectPath } from "./route.ts";
import { ProjectSwitcher } from "./ProjectSwitcher.tsx";

const SECTION_ICON: Record<Section, IconName> = {
  ideas: "idea",
  screens: "phone",
  flows: "flow",
  components: "shapes",
  documents: "page",
};

export function Sidebar(props: {
  project: string;
  projects: ProjectSummary[];
  place: HomePlace | "area" | "tiny" | null;
  area: string | null;
  open: number;
  rows: Section[];
  foot: Section | null;
  areas: string[];
  // The mocks themselves, in place of section rows, when there's one small section.
  tree: { area: string | null; nodes: TreeNode[] }[] | null;
  archived: number;
  recent: boolean;
  // A plain click swaps what Home shows, keeping one history entry.
  go: (e: MouseEvent, path: string) => void;
  onNav: () => void;
  drawer?: boolean;
  inert?: boolean;
}) {
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
              <span class="side-nm">Needs you</span>
              <span class="side-n">{props.open}</span>
            </>,
            "side-row side-needs",
          )}
        </Show>
        <Show when={props.rows.length + (props.foot ? 1 : 0) > 1}>
          <nav class="side-group" aria-label="Sections">
            <For each={props.rows}>
              {(sec) =>
                link(
                  () => projectPath(props.project, sec),
                  () => props.place === sec,
                  <span class="side-nm">
                    <Icon name={SECTION_ICON[sec]} />
                    {SECTION_LABEL[sec]}
                  </span>,
                  "side-row side-kind",
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
          <nav class="side-chips" aria-label="Areas">
            <For each={props.areas}>
              {(a) =>
                link(
                  // Pressing the area you're in takes the filter off again.
                  () =>
                    props.area === a
                      ? projectPath(props.project)
                      : projectPath(props.project, null, a),
                  () => props.area === a,
                  <>{a}</>,
                  "side-chip",
                )
              }
            </For>
          </nav>
        </Show>
      </div>
      <div class="side-foot">
        <Show when={props.foot}>
          {(sec) =>
            link(
              () => projectPath(props.project, sec()),
              () => props.place === sec(),
              <span class="side-nm">
                <Icon name={SECTION_ICON[sec()]} />
                {SECTION_LABEL[sec()]}
              </span>,
            )
          }
        </Show>
        <Show when={props.archived > 0}>
          {link(
            () => projectPath(props.project, "archive"),
            () => props.place === "archive",
            <span class="side-nm">
              <Icon name="archive" />
              Archive
            </span>,
          )}
        </Show>
        <Show when={props.recent}>
          {link(
            () => projectPath(props.project, "recent"),
            () => props.place === "recent",
            <span class="side-nm">
              <Icon name="recent" />
              Recent
            </span>,
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
