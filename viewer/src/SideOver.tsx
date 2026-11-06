// The project's sidebar over an open design, one press away. It opens on top so the
// design keeps its size, and so two lists never sit side by side with States and
// Versions. A phone has its own way up, the arrow in the top row.

import { createEffect, createMemo, createResource, createSignal, onCleanup, Show } from "solid-js";
import { api } from "./api.ts";
import { SIDEBAR_FROM, sidebarOf } from "./albums.ts";
import { root } from "./host.ts";
import { Icon } from "./icons.tsx";
import { linkClick } from "./route.ts";
import { Sidebar } from "./Sidebar.tsx";
import { phoneLayout } from "./viewport.ts";

export function SideOver(props: { project: string }) {
  const [open, setOpen] = createSignal(false);
  const [projects] = createResource(() => api.projects().catch(() => []));
  // Read on the way to the button, since an open design's frames can hold up a request for
  // seconds: an empty sidebar would slide in. It costs a design nobody reaches for nothing.
  const [wanted, setWanted] = createSignal(false);
  const [tree, { refetch }] = createResource(
    () => (wanted() ? props.project : null),
    (p) => api.tree(p).catch(() => null),
  );
  const side = createMemo(() => {
    const t = tree();
    return sidebarOf(
      t?.tree ?? [],
      t?.flows.length ?? 0,
      (t?.areas ?? []).map((a) => a.name),
    );
  });
  const waiting = () => (tree()?.tree ?? []).reduce((n, m) => n + (m.archivedAt ? 0 : m.open), 0);
  const held = () => projects()?.find((p) => p.name === props.project)?.designs ?? 0;

  let btn: HTMLButtonElement | undefined;
  let panel: HTMLDivElement | undefined;
  const close = () => {
    setOpen(false);
    btn?.focus();
  };
  createEffect(() => {
    if (!open()) return;
    panel?.querySelector<HTMLElement>("button, a")?.focus();
    const doc = root();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    doc.addEventListener("keydown", onKey, true);
    onCleanup(() => doc.removeEventListener("keydown", onKey, true));
  });

  return (
    <Show when={!phoneLayout() && held() >= SIDEBAR_FROM}>
      <button
        type="button"
        class="ib mside"
        ref={(el) => (btn = el)}
        aria-label="Open project sidebar"
        aria-expanded={open()}
        title="Project sidebar"
        onPointerEnter={() => setWanted(true)}
        onFocus={() => setWanted(true)}
        onClick={() => {
          setOpen(true);
          // Pressed long after the hover, or again later: show what's there now.
          if (wanted()) void refetch();
          else setWanted(true);
        }}
      >
        <Icon name="menu" />
      </button>
      <div class="side-over" ref={(el) => (panel = el)}>
        {/* Clear, not dimmed: the design stays readable, and a frame can't report a click. */}
        <div class="side-scrim" classList={{ on: open() }} aria-hidden="true" onClick={close} />
        <Sidebar
          project={props.project}
          projects={projects() ?? []}
          place={null}
          area={null}
          open={waiting()}
          rows={side().lit.rows}
          foot={side().lit.foot}
          areas={side().areas}
          tree={side().tree}
          archived={side().archived.length}
          recent={(tree()?.tree.length ?? 0) > 0}
          system={!!tree()?.hasSystem}
          go={linkClick}
          onNav={() => setOpen(false)}
          drawer
          inert={!open()}
        />
      </div>
    </Show>
  );
}
