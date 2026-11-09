// The ideas that are for a screen or a component, folded until asked for: the product
// design stays what is on show, and exploring happens in each idea. A list in Focus's left
// margin under the states.

import { createSignal, For, Show } from "solid-js";
import type { IdeaLink } from "../../server/apiViews.ts";
import { Icon } from "./icons.tsx";
import { designPath, linkClick } from "./route.ts";

const label = (ideas: IdeaLink[]) => `Ideas · ${ideas.length}`;

function IdeaRow(props: { project: string; idea: IdeaLink }) {
  const href = () => designPath(props.project, props.idea.slug);
  return (
    <a class="lm-row ideas-row" href={href()} onClick={(e) => linkClick(e, href())}>
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
