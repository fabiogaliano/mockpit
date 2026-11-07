// D8: the thread lives in the panel. Agent rows come from publishes and the
// agent's messages; your Sends read "Not seen yet" once stored and "Delivered"
// once the agent's feedback cursor has passed them (D5).

import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { assetUrl } from "./api.ts";
import { readonly } from "./host.ts";
import { threadRows, timeAgo } from "./logic.ts";
import { WakeLine } from "./NextCard.tsx";
import type { DesignScreenState } from "./state.ts";

export function useThreadRows(s: DesignScreenState) {
  return createMemo(() => {
    const m = s.design();
    return m ? threadRows(s.comments(), s.alternatives(), m) : [];
  });
}

export function Thread(props: { s: DesignScreenState; scroller: () => HTMLElement | undefined }) {
  const rows = useThreadRows(props.s);
  // Only under the newest thing said, or a thread of old Sends would repeat it. Here
  // because the status under the design is gone after a reload, and this isn't.
  const wakeRow = createMemo(() => {
    const newest = [...rows()].reverse().find((r) => r.who === "you" && !r.inPassing);
    return !readonly() && newest && !newest.delivered && !newest.listening ? newest.id : null;
  });
  createEffect(() => {
    rows();
    const el = props.scroller();
    if (el) requestAnimationFrame(() => (el.scrollTop = el.scrollHeight));
  });
  return (
    <div class="thread">
      <Show when={rows().length} fallback={<div class="tempty">Nothing here yet.</div>}>
        <For each={rows()}>
          {(r) => (
            <div class={`trow ${r.who}`} data-row={r.id}>
              <div class="tmeta">{`${r.who} · ${timeAgo(r.at)}`}</div>
              <Show when={r.text}>
                <div class="ttext">{r.text}</div>
              </Show>
              <Show when={r.comments?.length}>
                <div class="clines">
                  <For each={r.comments}>
                    {(c) => (
                      <div class="cline">
                        <span class="cwhere">{c.where}</span>
                        {` “${c.text}”`}
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={r.notes?.length}>
                <div class="tnotes">
                  <For each={r.notes}>
                    {(n) => (
                      <div class="tnote" data-note>
                        <span class="cwhere">{n.ask}</span>
                        {`note: ${n.text}`}
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={r.images?.length}>
                <For each={r.images}>
                  {(g) => (
                    <div class="timgs" data-images>
                      <For each={g.ids}>
                        {(id) => (
                          <a href={assetUrl(id)} target="_blank" rel="noopener">
                            <img src={assetUrl(id)} alt={`Image attached to “${g.ask}”`} />
                          </a>
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </Show>
              <Show when={r.quote}>
                <div class="tquote">{r.quote}</div>
              </Show>
              <Show when={r.who === "you"}>
                <div class="tdelivered" classList={{ ok: r.delivered }}>
                  <span class="tick">{r.delivered ? "✓✓" : "✓"}</span>
                  {r.delivered
                    ? "Delivered"
                    : r.ownerGone
                      ? "Waiting — the agent that asked restarted; the next agent in this project will get it"
                      : "Not seen yet"}
                </div>
              </Show>
              <Show when={wakeRow() === r.id && props.s.design()}>
                {(m) => <WakeLine slug={m().slug} />}
              </Show>
            </div>
          )}
        </For>
      </Show>
      <Show when={props.s.design()?.repliesGoTo}>
        {(agent) => (
          <p class="treach">{`Replies go to ${agent()}, the agent last working in this project.`}</p>
        )}
      </Show>
      <Show when={!readonly()}>
        <MessageField s={props.s} />
      </Show>
    </div>
  );
}

// A message to the agent, outside any reply; a frame's sendPrompt fills it.
function MessageField(props: { s: DesignScreenState }) {
  const s = props.s;
  const [busy, setBusy] = createSignal(false);
  const submit = async () => {
    const t = s.threadText().trim();
    if (!t || busy()) return;
    setBusy(true);
    await s.postComment(t);
    setBusy(false);
  };
  return (
    <label class="up-text-row tcomment">
      <span class="up-text-label">Message</span>
      <input
        class="up-text-input"
        placeholder="to the agent…"
        value={s.threadText()}
        disabled={busy()}
        onInput={(e) => s.setThreadText(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && !e.isComposing && void submit()}
      />
    </label>
  );
}
