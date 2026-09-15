// The empty / loading / error / idle states, with the copy from
// docs/tmp/mockups/states.html. One headline, one reason, one action, and a
// copyable command — no prose paragraphs.
import { For, Index, Show } from "solid-js";
import { appPath } from "./api.ts";
import { toast } from "./state.ts";

export function CommandBlock(props: { cmd: string; copyable?: boolean }) {
  return (
    <div class="ss-cmd">
      <span>{props.cmd}</span>
      <Show when={props.copyable !== false}>
        <button
          class="cp"
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(props.cmd).then(
              () => toast("Copied: " + props.cmd),
              () => toast("Couldn't copy to clipboard"),
            );
          }}
        >
          copy
        </button>
      </Show>
    </div>
  );
}

// State 1 — fresh workspace: no projects at all.
export function FreshWorkspace() {
  return (
    <div class="ss-empty">
      <h2>Nothing here yet</h2>
      <p>
        Projects appear when an agent publishes from a repo. Run this in the agent&rsquo;s terminal,
        inside the repo you want to design for:
      </p>
      <CommandBlock cmd="npx sideshow init" />
      <p class="alt">
        Detects the repo&rsquo;s design system, writes a starter, and points the agent at this
        workspace. <a href={appPath("/connect")}>Using MCP or curl instead?</a> ·{" "}
        <a href="/setup" target="_blank">
          Try the demo
        </a>
      </p>
    </div>
  );
}

// State 2 — a project exists, but nothing has been published into it yet.
export function NoItems(props: { agent?: string | null }) {
  return (
    <div class="ss-empty">
      <h2>Waiting for the first publish</h2>
      <p>
        The {props.agent || "agent"} is connected and has the design guide. Items show up here the
        moment it publishes. If it seems stuck, this is the shape it runs:
      </p>
      <CommandBlock
        cmd="sideshow publish --item pricing-card --variant highlighted --html pricing.html"
        copyable={false}
      />
      <p class="alt">
        Or tell it what to build: <a href={appPath("/connect")}>send a prompt to the agent</a>
      </p>
    </div>
  );
}

// State 3 — the item is loading / the new version is still rendering.
export function StageSkeleton(props: { version?: number }) {
  return (
    <div class="ss-stagewrap sk-stage" role="status" aria-label="Rendering">
      <span class="ss-rend">rendering v{props.version ?? 1}…</span>
      <div class="ss-sk" style={{ height: "18px", width: "140px", "margin-bottom": "14px" }}></div>
      <div class="ss-skg">
        <Index each={[0, 1, 2]}>{() => <div class="ss-sk"></div>}</Index>
      </div>
    </div>
  );
}

// State 4 — the server is unreachable. The last loaded data stays on screen,
// dimmed, behind this banner.
export function OfflineBanner(props: { host: string; onRetry: () => void }) {
  return (
    <div class="ss-ban err" role="alert">
      <span class="spin"></span>
      Can&rsquo;t reach sideshow at <b>{props.host}</b>. Showing what loaded last. Retrying in 4s
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          props.onRetry();
        }}
      >
        retry now
      </a>
    </div>
  );
}

// State 5 — the live stream dropped, but writes still work.
export function LiveDroppedBanner() {
  return (
    <div class="ss-ban warn" role="status">
      Live updates paused, reconnecting. Comments still send; new versions appear after{" "}
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          location.reload();
        }}
      >
        refresh
      </a>
    </div>
  );
}

// State 6 — the agent has been idle; explain where the comment went.
export function QueuedNote() {
  return (
    <div class="ss-queued">
      <b>Your comment is queued.</b>
      <div>
        It reaches the agent on its next write or <code>sideshow wait</code>. If the session ended,
        start a new one; the comment stays in this item&rsquo;s thread.
      </div>
    </div>
  );
}

export function SmallEmpty(props: { children: string }) {
  return <div class="ss-small-empty">{props.children}</div>;
}

export function ListSkeletonRows(props: { rows?: number }) {
  return (
    <div class="ss-sk-rows" role="status" aria-label="Loading">
      <For each={Array.from({ length: props.rows ?? 4 })}>
        {() => <div class="ss-sk" style={{ height: "34px" }}></div>}
      </For>
    </div>
  );
}
