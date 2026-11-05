// In the top bar, by the width: this design as a code to scan, to feel it on the device it's for. A
// code nobody can follow is worse than none, so an address a phone can't reach gets
// the address to use instead. The code never holds the workspace's key: the viewer
// takes `?key=` out of the URL on load, so there's none in what it encodes, and
// putting it there would hand sign-in to anyone who photographs the screen.

import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { api } from "./api.ts";
import { CopyButton } from "./CopyButton.tsx";
import { host, readonly, root } from "./host.ts";
import { Icon } from "./icons.tsx";
import { QR_QUIET, qrEncode, qrPath } from "./qr.ts";
import { designPath } from "./route.ts";
import type { DesignScreenState } from "./state.ts";

// Names that only ever mean the machine the browser runs on.
const isLoopback = (hostname: string) =>
  hostname === "localhost" ||
  hostname.endsWith(".localhost") ||
  hostname === "[::1]" ||
  hostname === "0.0.0.0" ||
  hostname.startsWith("127.");

// Addresses only reachable from the same network or tailnet.
const isPrivate = (hostname: string) =>
  /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(
    hostname,
  ) ||
  hostname.endsWith(".local") ||
  hostname.endsWith(".ts.net");

export function QrTool(props: { s: DesignScreenState }) {
  const s = props.s;
  const [open, setOpen] = createSignal(false);
  let btn: HTMLButtonElement | undefined;
  let pop: HTMLDivElement | undefined;
  createEffect(() => {
    if (!open()) return;
    const doc = root();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      btn?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop?.contains(t) && !btn?.contains(t)) setOpen(false);
    };
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("pointerdown", onDown, true);
    onCleanup(() => {
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("pointerdown", onDown, true);
    });
  });
  return (
    <div class="qrtool">
      <button
        type="button"
        class="ib"
        classList={{ on: open() }}
        aria-expanded={open()}
        aria-haspopup="dialog"
        aria-label="Open on a phone or iPad"
        title="Open on a phone or iPad"
        ref={(el) => (btn = el)}
        onClick={() => setOpen(!open())}
      >
        <Icon name="qr" />
      </button>
      <Show when={open()}>
        <div
          class="qrpop"
          role="dialog"
          aria-label="Open on a phone or iPad"
          ref={(el) => (pop = el)}
        >
          <QrBody s={s} />
        </div>
      </Show>
    </div>
  );
}

function QrBody(props: { s: DesignScreenState }) {
  const s = props.s;
  const place = createMemo(() => {
    const m = s.design();
    if (!m) return null;
    const v = s.onStage();
    return designPath(
      m.project,
      m.slug,
      { state: s.activeState(), variant: v?.variant ?? null, version: v?.version ?? null },
      null,
      "stage",
    );
  });
  const where = () => host().location;
  const link = () => `${where().origin}${place() ?? ""}`;
  const modules = createMemo(() => qrEncode(link()));
  // A failed read leaves out what it would have said; the code still works.
  const [reach] = createResource(() => api.reach().catch(() => null));
  const size = () => (modules()?.length ?? 0) + QR_QUIET * 2;
  return (
    <Show
      when={!isLoopback(where().hostname)}
      fallback={
        <>
          <p class="qr-head">{`A phone can't open ${where().hostname}`}</p>
          <p>That address only means this computer, so a code for it would lead nowhere.</p>
          <Show
            when={reach()?.hosts.length}
            fallback={
              <p>
                {reach()?.localOnly
                  ? "This server is also set to listen only on this computer. Restart it without MOCKPIT_HOST, or with this computer's network address, then open that address here."
                  : "Open mockpit here at an address your phone can reach, such as this computer's network address or a tailnet name, and the code will appear."}
              </p>
            }
          >
            <p>Open this page at this computer's network address, and the code will appear:</p>
            <ul class="qr-hosts">
              <For each={reach()?.hosts}>
                {(h) => (
                  <li>
                    <a class="lnk" href={`${where().protocol}//${h}${place() ?? ""}`}>
                      {h}
                    </a>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <Show when={reach()?.access === "key"}>
            <p>A new address needs signing in with your key once.</p>
          </Show>
        </>
      }
    >
      <Show
        when={modules()}
        fallback={<p class="qr-head">This link is too long for a code. Copy it instead.</p>}
      >
        {(m) => (
          <svg
            class="qr-code"
            viewBox={`0 0 ${size()} ${size()}`}
            role="img"
            aria-label="QR code for this design"
            shape-rendering="crispEdges"
          >
            {/* White and black whatever the theme: dark codes on dark don't scan. */}
            <rect width={size()} height={size()} fill="#fff" />
            <path d={qrPath(m())} fill="#000" />
          </svg>
        )}
      </Show>
      <div class="wake-line">
        <code>{link()}</code>
        <CopyButton text={link()} label="Copy the link to this design" />
      </div>
      <Show when={isPrivate(where().hostname)}>
        <p>The phone has to be on the same network or tailnet as this computer.</p>
      </Show>
      <Show when={!readonly()} fallback={<p>It opens read-only there too, like this page.</p>}>
        <Show when={reach()?.access === "key"}>
          <p>
            The code doesn't carry your key. A phone that hasn't signed in here gets "unauthorized"
            until you open mockpit on it once with ?key= and your token.
          </p>
        </Show>
        <Show when={reach()?.access === "read"}>
          <p>
            The code doesn't carry your key, so a phone that hasn't signed in sees it read-only.
          </p>
        </Show>
        <Show when={reach()?.access === "unknown"}>
          <p>This deployment handles its own sign-in, so the phone may be asked to sign in.</p>
        </Show>
      </Show>
    </Show>
  );
}
