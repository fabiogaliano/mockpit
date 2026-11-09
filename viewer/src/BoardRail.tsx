// The Board's left rail, Figma's pages and layers: Needs you (the one inbox, folding out
// the questions that wait), the project's pages (its areas), the Library and Exploring
// pages, and under the open page (the Ideas page too) its layers, the sections and their
// frames. A section fits the canvas to it; a frame is selected and fit.

import { createSignal, For, type JSX, Show } from "solid-js";
import type { BoardPage, ProjectSummary } from "./api.ts";
import { type Section, sidebarOf } from "./albums.ts";
import type { HomeTree } from "./homeCache.ts";
import { rankedAreas } from "./logic.ts";
import { Icon, type IconName } from "./icons.tsx";
import { openJump } from "./Jump.tsx";
import { ProjectSwitcher } from "./ProjectSwitcher.tsx";
import { boardPath, type HomePlace, linkClick, projectPath, questionPath } from "./route.ts";
import { ChromeButtons } from "./TopBar.tsx";

export interface RailLayer {
  id: string;
  kind: "flow" | "screen" | "components" | "planned" | "idea" | "variants";
  name: string;
  frames: { key: string; label: string }[];
}

export interface RailLibrary {
  components: boolean;
  system: boolean;
  documents: boolean;
  ideas: boolean;
  archive: boolean;
  recent: boolean;
}

// The Library and Exploring rows a project has, lit by what it holds (Home's sections).
export function libraryOf(t: HomeTree | null | undefined): RailLibrary {
  const side = t ? sidebarOf(t.tree, t.flows.length, rankedAreas(t.areas)) : null;
  const lit = (x: Section) => !!side && (side.lit.rows.includes(x) || side.lit.foot === x);
  return {
    components: lit("components"),
    system: !!t?.hasSystem,
    documents: lit("documents"),
    ideas: lit("ideas"),
    archive: (side?.archived.length ?? 0) > 0,
    recent: (t?.tree.length ?? 0) > 0,
  };
}

const LAYER_DOT: Record<RailLayer["kind"], string> = {
  flow: "flow",
  screen: "",
  components: "cmp",
  planned: "plan",
  idea: "idea",
  variants: "cmp",
};

export function BoardRail(props: {
  project: string;
  projects: ProjectSummary[];
  pages: BoardPage["pages"];
  unsortedPage: boolean;
  // The page on the canvas; null with none (a Library page, or the screens with no area).
  onPage: string | null;
  onUnsorted: boolean;
  sec: HomePlace | null;
  questions: BoardPage["questions"];
  library: RailLibrary;
  layers: RailLayer[];
  selected: string | null;
  onFitSection: (id: string) => void;
  onPickFrame: (key: string) => void;
  // Over a design, where the rail opens as a drawer: a pick closes it.
  onNav?: () => void;
  drawer?: boolean;
  inert?: boolean;
}) {
  const [inbox, setInbox] = createSignal(false);
  const link = (
    href: () => string,
    current: () => boolean,
    body: JSX.Element,
    cls = "side-row",
    focus = false,
  ) => (
    <a
      class={cls}
      href={href()}
      aria-current={current() ? "page" : undefined}
      onClick={(e) => {
        linkClick(e, href(), focus);
        props.onNav?.();
      }}
    >
      {body}
    </a>
  );
  const named = (icon: IconName | null, text: string) => (
    <span class="side-nm">
      <Show when={icon}>{(i) => <Icon name={i()} />}</Show>
      {text}
    </span>
  );
  const layerRows = () => (
    <div class="rail-layers">
      <For each={props.layers}>
        {(l) => (
          <>
            <button type="button" class="rail-lay" onClick={() => props.onFitSection(l.id)}>
              <span class={`rail-dot ${LAYER_DOT[l.kind]}`} aria-hidden="true" />
              <span class="side-nm">{l.name}</span>
            </button>
            <For each={l.frames}>
              {(f) => (
                <button
                  type="button"
                  class="rail-lay2"
                  classList={{ sel: props.selected === f.key }}
                  onClick={() => props.onPickFrame(f.key)}
                >
                  <span class="side-nm">{f.label}</span>
                </button>
              )}
            </For>
          </>
        )}
      </For>
    </div>
  );
  const sec = (place: HomePlace, icon: IconName, text: string) =>
    link(
      () => projectPath(props.project, place),
      () => props.sec === place || (place === "components" && props.sec === "shared"),
      named(icon, text),
    );
  return (
    <aside
      class="side rail"
      classList={{ "side-drawer": !!props.drawer }}
      aria-label="Pages"
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
            props.onNav?.();
            openJump();
          }}
        >
          <Icon name="search" />
          <span>Search</span>
          <kbd>/</kbd>
        </button>
      </div>
      <div class="side-scroll">
        <Show when={props.questions.length}>
          <button
            type="button"
            class="side-row side-needs"
            aria-expanded={inbox()}
            onClick={() => setInbox(!inbox())}
          >
            <span class="side-nm">Needs you</span>
            <span class="side-n">{props.questions.length}</span>
          </button>
          <Show when={inbox()}>
            <div class="rail-inbox">
              <For each={props.questions}>
                {(q) =>
                  link(
                    () => questionPath(props.project, q.slug, q.id),
                    () => false,
                    <>
                      <span class="rail-q">{q.text}</span>
                      <small>{q.kind === "idea" ? `${q.title} · idea` : q.title}</small>
                    </>,
                    "rail-qi",
                    true,
                  )
                }
              </For>
            </div>
          </Show>
        </Show>
        <Show when={props.pages.length || props.unsortedPage}>
          <nav class="side-group" aria-label="Pages">
            <h6 class="side-hd">Pages</h6>
            <For each={props.pages}>
              {(p) => (
                <>
                  {link(
                    () => boardPath(props.project, { page: p.name }),
                    () => props.onPage === p.name,
                    named(null, p.name),
                  )}
                  <Show when={props.onPage === p.name}>{layerRows()}</Show>
                </>
              )}
            </For>
            <Show when={props.unsortedPage}>
              {link(
                () => boardPath(props.project, { unsorted: true }),
                () => props.onUnsorted,
                named(null, props.pages.length ? "No area" : "Screens"),
              )}
              <Show when={props.onUnsorted}>{layerRows()}</Show>
            </Show>
          </nav>
        </Show>
        <Show when={props.library.components || props.library.system || props.library.documents}>
          <nav class="side-group" aria-label="Library">
            <h6 class="side-hd">Library</h6>
            <Show when={props.library.components}>{sec("components", "shapes", "Components")}</Show>
            <Show when={props.library.system}>{sec("system", "palette", "System")}</Show>
            <Show when={props.library.documents}>{sec("documents", "page", "Documents")}</Show>
          </nav>
        </Show>
        <Show when={props.library.ideas || props.library.archive || props.library.recent}>
          <nav class="side-group" aria-label="Exploring">
            <h6 class="side-hd">Exploring</h6>
            <Show when={props.library.ideas}>
              {sec("ideas", "idea", "Ideas")}
              <Show when={props.sec === "ideas"}>{layerRows()}</Show>
            </Show>
            <Show when={props.library.archive}>{sec("archive", "archive", "Archive")}</Show>
            <Show when={props.library.recent}>{sec("recent", "recent", "Recent")}</Show>
          </nav>
        </Show>
      </div>
      <div class="side-foot">
        <div class="side-chrome">
          <span class="side-brand">mockpit</span>
          <span class="grow" />
          <ChromeButtons />
        </div>
      </div>
    </aside>
  );
}
