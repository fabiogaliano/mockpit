// The Board's rail over an open design, one press away. It opens on top so the design
// keeps its size, and so two lists never sit side by side with States and Versions.

import { createEffect, createResource, createSignal, onCleanup } from "solid-js";
import { api } from "./api.ts";
import { BoardRail, libraryOf } from "./BoardRail.tsx";
import { root } from "./host.ts";
import { Icon } from "./icons.tsx";

export function SideOver(props: {
  project: string;
  area: string | null;
  openQuestion: { slug: string; id: string } | null;
}) {
  const [open, setOpen] = createSignal(false);
  const [projects] = createResource(() => api.projects().catch(() => []));
  // Read on the way to the button, since an open design's frames can hold up a request for
  // seconds: an empty rail would slide in. It costs a design nobody reaches for nothing.
  const [wanted, setWanted] = createSignal(false);
  const [page, { refetch }] = createResource(
    () => (wanted() ? props.project : null),
    (p) => api.board(p, { area: props.area, unsorted: props.area === null }).catch(() => null),
  );
  const [tree, { refetch: refetchTree }] = createResource(
    () => (wanted() ? props.project : null),
    (p) => api.tree(p).catch(() => null),
  );

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
    <>
      <button
        type="button"
        class="ib mside"
        ref={(el) => (btn = el)}
        aria-label="Open the pages"
        aria-expanded={open()}
        title="Pages"
        onPointerEnter={() => setWanted(true)}
        onFocus={() => setWanted(true)}
        onClick={() => {
          setOpen(true);
          // Pressed long after the hover, or again later: show what's there now.
          if (wanted()) {
            void refetch();
            void refetchTree();
          } else setWanted(true);
        }}
      >
        <Icon name="menu" />
      </button>
      <div class="side-over" ref={(el) => (panel = el)}>
        {/* Clear, not dimmed: the design stays readable, and a frame can't report a click. */}
        <div class="side-scrim" classList={{ on: open() }} aria-hidden="true" onClick={close} />
        <BoardRail
          project={props.project}
          projects={projects() ?? []}
          pages={page()?.pages ?? []}
          unsortedPage={page()?.unsorted ?? null}
          onPage={null}
          onUnsorted={false}
          sec={null}
          questions={page()?.questions ?? []}
          openQuestion={props.openQuestion}
          library={libraryOf(tree())}
          layers={[]}
          selected={null}
          onFitSection={() => {}}
          onPickFrame={() => {}}
          onNav={() => setOpen(false)}
          drawer
          inert={!open()}
        />
      </div>
    </>
  );
}
