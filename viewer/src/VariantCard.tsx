// One variant as a card: its design pictured whole (opens the mock on that
// state and variant), its star, name, version, status and lineage. The
// Library's rows and the tree's strips are made of these.

import { Show } from "solid-js";
import { api, surfaceUrl, type TreeNode, type TreeVariant } from "./api.ts";
import { designWidth } from "./canvasLayout.ts";
import { readonly } from "./host.ts";
import { linkClick, mockPath } from "./route.ts";
import { StatusChip } from "./StatusChip.tsx";
import { theme } from "./theme.ts";
import { Thumb } from "./Thumb.tsx";

export function VariantCard(props: {
  project: string;
  node: TreeNode;
  v: TreeVariant;
  onChanged: () => void;
}) {
  const href = () =>
    mockPath(props.project, props.node.slug, { state: props.v.state, variant: props.v.variant });
  const star = async () => {
    await api.star(props.node.id, props.v.state, props.v.variant, !props.v.starred);
    props.onChanged();
  };
  return (
    <div
      class="lib-variant"
      classList={{
        muted: props.v.status === "archived" || props.v.status === "dropped",
        phone: designWidth(props.node) < 700,
      }}
      data-variant={props.v.variant}
    >
      <a
        class="lib-thumb"
        href={href()}
        onClick={(e) => linkClick(e, href())}
        aria-label={`Open ${props.node.title} · ${props.v.variant}`}
      >
        <Show when={props.v.surface >= 0}>
          <Thumb
            src={surfaceUrl(props.v.postId, props.v.surface, {
              version: props.v.version,
              mode: theme(),
              e: props.v.embedsKey,
            })}
            width={designWidth(props.node)}
            knobs={props.node.settled}
            whole
          />
        </Show>
      </a>
      <div class="lib-meta">
        <Show when={!readonly()} fallback={<span>{props.v.starred ? "★" : ""}</span>}>
          <button
            type="button"
            class="starbtn"
            classList={{ on: !!props.v.starred }}
            aria-pressed={!!props.v.starred}
            aria-label={props.v.starred ? `Unstar ${props.v.variant}` : `Star ${props.v.variant}`}
            onClick={() => void star()}
          >
            {props.v.starred ? "★" : "☆"}
          </button>
        </Show>
        <span class="lib-name">{props.v.variant}</span>
        <span class="lib-faint">{`v${props.v.version}`}</span>
      </div>
      <div class="lib-meta">
        <StatusChip status={props.v.status} />
        <Show when={props.v.forkedFrom}>
          {(f) => <span class="lib-faint">{`from ${f().variant}`}</span>}
        </Show>
      </div>
    </div>
  );
}
