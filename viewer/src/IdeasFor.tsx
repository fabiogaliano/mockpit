// The ideas that are for a screen or a component, folded until asked for: the product
// design stays what is on show, and exploring happens in each idea. One list in the left
// margin under the states, and the same list from a button in Studio's bar.

import { createSignal, For, Show } from "solid-js";
import type { IdeaLink } from "../../server/apiViews.ts";
import { Icon } from "./icons.tsx";
import { usePopover } from "./popover.ts";
import { designPath, linkClick } from "./route.ts";

const label = (ideas: IdeaLink[]) => `Ideas · ${ideas.length}`;

function IdeaRow(props: { project: string; idea: IdeaLink; role?: "menuitem" }) {
  const href = () => designPath(props.project, props.idea.slug);
  return (
    <a
      class="lm-row ideas-row"
      role={props.role}
      href={href()}
      onClick={(e) => linkClick(e, href())}
    >
      <span class="lm-text">
        <b>{props.idea.title}</b>
        <small>{props.idea.status}</small>
      </span>
    </a>
  );
}

export function IdeasForList(props: { project: string; ideas: IdeaLink[] }) {
  const [open, setOpen] = createSignal(false);
  return (
    <section class="lm-sec ideas-for">
      <button
        type="button"
        class="ideas-fold"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <span>{label(props.ideas)}</span>
        <Icon name="down" />
      </button>
      <Show when={open()}>
        <For each={props.ideas}>{(idea) => <IdeaRow project={props.project} idea={idea} />}</For>
      </Show>
    </section>
  );
}

export function IdeasForMenu(props: { project: string; ideas: IdeaLink[] }) {
  const [open, setOpen] = createSignal(false);
  let button: HTMLButtonElement | undefined;
  let pop: HTMLDivElement | undefined;
  usePopover(
    open,
    () => setOpen(false),
    () => button,
    () => pop,
  );
  return (
    <div class="sbar-show">
      <button
        type="button"
        class="sbar-showb"
        ref={(el) => (button = el)}
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={() => setOpen((on) => !on)}
      >
        {label(props.ideas)}
        <Icon name="down" />
      </button>
      <Show when={open()}>
        <div class="wmenu ideas-menu" role="menu" ref={(el) => (pop = el)}>
          <For each={props.ideas}>
            {(idea) => <IdeaRow project={props.project} idea={idea} role="menuitem" />}
          </For>
        </div>
      </Show>
    </div>
  );
}
