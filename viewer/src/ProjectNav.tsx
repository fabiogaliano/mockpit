// The two navigation columns: projects (sidebar) and the project's items.
import { For, type JSX, Show } from "solid-js";
import { relTime } from "./api.ts";
import { SLOTS } from "./host.ts";
import {
  currentProject,
  currentSlug,
  items,
  itemsLoading,
  openProject,
  openItem,
  projects,
  projectsLoaded,
  type ItemSummary,
  type ProjectSummary,
} from "./projects.ts";
import { setNavOpen } from "./state.ts";
import { ListSkeletonRows, SmallEmpty } from "./States.tsx";

function projectSub(p: ProjectSummary): string {
  const parts: string[] = [];
  if (p.items > 0) parts.push(`${p.items} item${p.items === 1 ? "" : "s"}`);
  if (p.waiting > 0) parts.push(`${p.waiting} waiting`);
  if (parts.length === 0) return "idle";
  if (p.lastActiveAt) parts.push(relTime(p.lastActiveAt));
  return parts.join(" · ");
}

function itemSub(it: ItemSummary): string {
  const version = it.variants.reduce((max, v) => Math.max(max, v.version), 1);
  const open = it.variants.filter((v) => v.status !== "archived").length;
  if (it.kind === "page") return `composed · v${version}`;
  return open > 1 ? `${open} variants · v${version}` : `v${version}`;
}

export function ProjectSidebar(props: { brand: JSX.Element; foot: JSX.Element }) {
  return (
    <aside class="ss-side">
      {props.brand}
      <div class="ss-projects">
        <Show
          when={projects.length > 0}
          fallback={
            <Show when={projectsLoaded()} fallback={<ListSkeletonRows rows={3} />}>
              {/* Host-overridable empty-list nudge; the fallback is the
                  self-hosted copy. */}
              <slot name={SLOTS.asideEmpty}>
                <SmallEmpty>no projects yet</SmallEmpty>
              </slot>
            </Show>
          }
        >
          <For each={projects}>
            {(p) => (
              <div
                class="ss-proj"
                classList={{ on: p.name === currentProject() }}
                role="button"
                tabIndex={0}
                aria-current={p.name === currentProject() ? "true" : undefined}
                onClick={() => openProject(p.name)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openProject(p.name);
                  }
                }}
              >
                {p.name}
                <small>{projectSub(p)}</small>
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="ss-side-foot">{props.foot}</div>
    </aside>
  );
}

export function ItemsColumn() {
  const pages = () => items.filter((i) => i.kind === "page");
  const components = () => items.filter((i) => i.kind !== "page");
  return (
    <nav class="ss-items">
      <div class="ss-mtop">
        <div>
          <h1>{currentProject()}</h1>
        </div>
        <button class="m" type="button" onClick={() => setNavOpen(true)}>
          projects ▾
        </button>
      </div>
      <Show
        when={items.length > 0}
        fallback={
          <Show when={!itemsLoading()} fallback={<ListSkeletonRows />}>
            <SmallEmpty>nothing published in this project</SmallEmpty>
          </Show>
        }
      >
        <div class="sec">Pages</div>
        <Show when={pages().length > 0} fallback={<SmallEmpty>no pages</SmallEmpty>}>
          <For each={pages()}>{(it) => <ItemRow item={it} />}</For>
        </Show>
        <div class="sec">Components</div>
        <For each={components()}>{(it) => <ItemRow item={it} />}</For>
      </Show>
    </nav>
  );
}

function ItemRow(props: { item: ItemSummary }) {
  const open = () => openItem(props.item.project, props.item.slug);
  return (
    <div
      class="ss-item-row"
      classList={{ on: props.item.slug === currentSlug() }}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
    >
      <div class="ic">{props.item.kind === "page" ? "▤" : "▦"}</div>
      <div>
        <div class="n">{props.item.title || props.item.slug}</div>
        <small>{itemSub(props.item)}</small>
      </div>
      <Show when={props.item.waiting}>
        <span class="w" title="waiting on you"></span>
      </Show>
    </div>
  );
}
