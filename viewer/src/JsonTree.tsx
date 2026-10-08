// A json surface is data: rendered as text nodes in a collapsible tree, never
// parsed into markup.

import { For, type JSX, Show } from "solid-js";

export function JsonTree(props: { data: unknown; name?: string; depth?: number }): JSX.Element {
  const depth = () => props.depth ?? 0;
  const label = () => (props.name === undefined ? "" : `${props.name}: `);
  const v = () => props.data;
  const isObj = () => v() !== null && typeof v() === "object";
  const entries = () =>
    Array.isArray(v())
      ? (v() as unknown[]).map((x, i) => [String(i), x] as const)
      : Object.entries(v() as Record<string, unknown>);
  return (
    <Show
      when={isObj()}
      fallback={
        <div class="json-leaf">
          <span class="json-key">{label()}</span>
          <span class={`json-${v() === null ? "null" : typeof v()}`}>{JSON.stringify(v())}</span>
        </div>
      }
    >
      <details class="json-node" open={depth() < 2}>
        <summary>
          <span class="json-key">{label()}</span>
          {Array.isArray(v()) ? `[${entries().length}]` : `{${entries().length}}`}
        </summary>
        <For each={entries()}>{([k, x]) => <JsonTree data={x} name={k} depth={depth() + 1} />}</For>
      </details>
    </Show>
  );
}
