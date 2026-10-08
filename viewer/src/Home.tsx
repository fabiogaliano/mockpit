// D10: the project's mocks, newest activity first — thumbnail · name · states ·
// open count · age — under one line that says what is waiting.

import { createMemo, createResource, For, onCleanup, Show } from "solid-js";
import { api, type MockSummary, subscribe, surfaceUrl } from "./api.ts";
import { timeAgo } from "./logic.ts";
import { linkClick, mockPath, navigate, projectPath } from "./route.ts";
import { setTheme, theme } from "./theme.ts";
import { Thumb } from "./Thumb.tsx";
import { TopBar } from "./TopBar.tsx";

export function Home(props: { project: string | null }) {
  const [projects, { refetch: refetchProjects }] = createResource(() => api.projects());
  const project = createMemo(() => props.project ?? projects()?.[0]?.name ?? null);
  const [list, { refetch }] = createResource(project, (p) => api.mocks(p));
  const mocks = createMemo(() =>
    [...(list()?.mocks ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );
  const open = () => list()?.open ?? 0;
  const next = createMemo(() => mocks().find((m) => m.open > 0));

  const stop = subscribe(
    (e) => {
      if (e.type === "theme-changed") setTheme(e.mode === "light" ? "light" : "dark");
      else if (
        e.type.startsWith("mock-") ||
        e.type.startsWith("post-") ||
        e.type === "comment-created"
      ) {
        void refetch();
        if (e.type === "mock-created" || e.type === "mock-deleted") void refetchProjects();
      }
    },
    () => void refetch(),
  );
  onCleanup(stop);

  return (
    <div class="screen home">
      <TopBar
        left={
          <>
            <span>mockpit</span>
            <span class="sep">·</span>
            <Show when={(projects()?.length ?? 0) > 1} fallback={<b>{project() ?? ""}</b>}>
              <label class="home-project">
                <select
                  aria-label="Project"
                  value={project() ?? ""}
                  onChange={(e) => navigate(projectPath(e.currentTarget.value))}
                >
                  <For each={projects()}>{(p) => <option value={p.name}>{p.name}</option>}</For>
                </select>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <path d="M6 9.5L12 15.5L18 9.5" />
                </svg>
              </label>
            </Show>
          </>
        }
      />
      <main class="home-main">
        <div class="home-col">
          <Show
            when={project()}
            fallback={
              <Show when={!projects.loading}>
                <p class="home-empty">
                  Nothing published yet. Agents publish with `mockpit publish`.
                </p>
              </Show>
            }
          >
            <p class="home-lead">
              <Show
                when={open() > 0}
                fallback={
                  <>
                    <i class="dot ok" />0 open · all answered
                  </>
                }
              >
                <i class="dot" />
                {`${open()} open across ${list()?.openMocks ?? 0} ${list()?.openMocks === 1 ? "mock" : "mocks"} ·`}
                <a
                  class="home-next"
                  href={mockPath(project()!, next()?.slug ?? "")}
                  title={next()?.title}
                  onClick={(e) => linkClick(e, mockPath(project()!, next()?.slug ?? ""))}
                >
                  Answer next ›
                </a>
              </Show>
            </p>
            <ol class="home-list">
              <For each={mocks()}>{(m) => <MockRow mock={m} project={project()!} />}</For>
            </ol>
          </Show>
        </div>
      </main>
    </div>
  );
}

function MockRow(props: { mock: MockSummary; project: string }) {
  const href = () => mockPath(props.project, props.mock.slug);
  const thumb = () => props.mock.thumbnail;
  return (
    <li>
      <a
        class="home-row"
        href={href()}
        onClick={(e) => linkClick(e, href())}
        data-mock={props.mock.slug}
      >
        <div class="home-thumb">
          <Show when={thumb()}>
            {(t) => (
              <Thumb
                src={surfaceUrl(t().postId, t().surface, { version: t().version, mode: theme() })}
              />
            )}
          </Show>
        </div>
        <div class="home-text">
          <div class="home-name">{props.mock.title}</div>
          <div class="home-sub">
            {props.mock.stateCount === 1 ? "1 state" : `${props.mock.stateCount} states`}
          </div>
        </div>
        <Show
          when={props.mock.open > 0}
          fallback={
            <span class="home-done" title="decided">
              ✓
            </span>
          }
        >
          <span class="home-chip">
            <i class="dot" />
            {`${props.mock.open} open`}
          </span>
        </Show>
        <span class="home-ago">{timeAgo(props.mock.updatedAt)}</span>
      </a>
    </li>
  );
}
