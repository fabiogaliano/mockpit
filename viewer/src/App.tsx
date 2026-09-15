import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { api, appPath, initialPageTitle, isReadonly, type Post } from "./api.ts";
import { host, isShadow, navHostEl, root, SLOTS } from "./host.ts";
import { applyFrameHeight, Card, frameForSource } from "./Card.tsx";
import { ConnectInstructions } from "./Connect.tsx";
import { ItemScreen } from "./Item.tsx";
import { ItemsColumn, ProjectSidebar } from "./ProjectNav.tsx";
import { renderNotes } from "./notes.ts";
import { FreshWorkspace, LiveDroppedBanner, NoItems, OfflineBanner } from "./States.tsx";
import { MoonIcon, SunIcon, SystemIcon } from "./icons.tsx";
import {
  activeTheme,
  colorModePreference,
  type ColorModePreference,
  initTheme,
  setColorModePreference,
  setTheme,
  themeOptions,
} from "./theme.ts";
import {
  applyProjectRoute,
  bootstrapProjects,
  currentProject,
  currentSlug,
  items,
  resolveSessionRoute,
  streamMode,
  offline,
  openProjects,
  projects,
  projectsLoaded,
  retryNow,
  startOfflineRetry,
} from "./projects.ts";
import {
  checkVersion,
  connect,
  dismissUpdate,
  enterStandalone,
  initialLoaded,
  isConnectRoute,
  leaveStandalone,
  live,
  navOpen,
  refreshSessionsQuiet,
  sessions,
  setInitialLoaded,
  setNavOpen,
  standalonePost,
  toast,
  toastShow,
  toastText,
  updateNotice,
} from "./state.ts";

const [connectPath, setConnectPath] = createSignal(isConnectRoute());

function phoneWidth(): boolean {
  return typeof window !== "undefined" && window.innerWidth <= 720;
}

// The wordmark, doubling as a home link back to the projects list.
function Brand() {
  return (
    <button
      class="ss-brand"
      type="button"
      aria-label="sideshow — projects"
      onClick={() => {
        setConnectPath(false);
        openProjects();
      }}
    >
      <span class="livedot" classList={{ on: live() }}></span>sideshow
    </button>
  );
}

export default function App() {
  onMount(() => {
    let disconnect: (() => void) | undefined;
    const route = host().router.get();
    const boot = async () => {
      // A bare /p/:id permalink is the standalone full-page post (it is also
      // what the server screenshots); anything else resolves to a project route.
      if (route.surfaceId && !route.sessionId && !route.project) {
        if (await enterStandalone(route.surfaceId)) return;
      }
      await bootstrapProjects();
      void refreshSessionsQuiet();
    };
    void boot()
      .catch(() => {})
      .finally(() => {
        setInitialLoaded(true);
        host().onReady?.();
      });
    disconnect = connect();
    onCleanup(() => disconnect?.());
    onCleanup(startOfflineRetry());
    checkVersion();
    void initTheme();
    acquireBridgeListener();
    onCleanup(releaseBridgeListener);
    onCleanup(
      host().router.subscribe((next) => {
        setConnectPath(isConnectRoute());
        if (next.surfaceId && !next.sessionId && !next.project) {
          void enterStandalone(next.surfaceId);
          return;
        }
        leaveStandalone();
        if (next.sessionId) void resolveSessionRoute(next);
        else void applyProjectRoute(next);
      }),
    );
  });

  createEffect(() => {
    if (isShadow()) return;
    document.title = standalonePost()?.title || initialPageTitle() || "sideshow";
  });
  createEffect(() => navHostEl().classList.toggle("nav-open", navOpen()));

  // On a wide screen the item screen IS the third column, so a project route
  // opens its first item (phones keep the list as a screen of its own).
  createEffect(() => {
    const project = currentProject();
    if (!project || currentSlug() || phoneWidth()) return;
    // The list is refetched per project, so it can still hold the PREVIOUS
    // project's rows for a tick — opening one of those would jump projects.
    const rows = items.filter((i) => i.project === project);
    if (rows.length === 0) return;
    const waiting = rows.find((i) => i.waiting) ?? rows[0];
    host().router.navigate({ project, slug: waiting.slug }, { replace: true });
  });

  return (
    <Show when={standalonePost()} keyed fallback={<Workspace />}>
      {(post) => <StandaloneView post={post} />}
    </Show>
  );
}

function Workspace() {
  const noProjects = () => projectsLoaded() && projects.length === 0;
  // The items column and the three-column grid must agree, so both read this.
  const showItems = () => !streamMode() && !!currentProject() && !noProjects() && !connectPath();
  const serverHost = () => location.host;
  return (
    <>
      <div
        id="app"
        class="ss-app"
        classList={{
          "item-open": !!currentSlug(),
          "no-items": !showItems(),
          stream: streamMode(),
        }}
      >
        <Show when={!streamMode()}>
          <ProjectSidebar
            brand={
              <>
                <Show when={!host().hideBrand}>
                  <Brand />
                </Show>
                {/* Host-overridable region: the top of the sidebar (a cloud
                  workspace picker, say). Empty self-hosted. */}
                <slot name={SLOTS.asideHead} />
              </>
            }
            foot={
              <>
                <Show when={!isReadonly()}>
                  <ThemePicker />
                </Show>
                <slot name={SLOTS.asideFoot}>
                  <a href="/guide" target="_blank">
                    design guide
                  </a>
                  {" · "}
                  <a href="/setup" target="_blank">
                    setup
                  </a>
                  <Show when={!isReadonly()}>
                    {" · "}
                    <a href={appPath("/connect")}>connect agent</a>
                  </Show>
                </slot>
              </>
            }
          />
        </Show>
        <Show when={showItems()}>
          <ItemsColumn />
        </Show>
        <main class="ss-main">
          <slot name={SLOTS.main}>
            <Show when={offline()}>
              <OfflineBanner host={serverHost()} onRetry={retryNow} />
            </Show>
            <Show when={!offline() && initialLoaded() && !live()}>
              <LiveDroppedBanner />
            </Show>
            <UpdateBanner />
            <WhatsNewCard />
            <div class="ss-main-body" classList={{ dim: offline() }}>
              <Show when={!connectPath()} fallback={<ConnectPage />}>
                {/* The project list is enough to draw the screen; the item read
                    can still be in flight, and the item screen has its own
                    skeleton for that. Waiting for both left the pane blank. */}
                <Show when={initialLoaded() || projectsLoaded()}>
                  {/* The item screen is checked FIRST: stream mode resolves an
                      item without ever reading the projects list, so an empty
                      list there is not an empty workspace. */}
                  <Show
                    when={currentSlug()}
                    fallback={
                      <Show
                        when={!noProjects()}
                        fallback={
                          /* Host-overridable first-run onboarding; the fallback
                             is the self-hosted empty-workspace copy. */
                          <slot name={SLOTS.empty}>
                            <FreshWorkspace />
                          </slot>
                        }
                      >
                        <Show when={items.length === 0 && currentProject()}>
                          <NoItems agent={sessions[0]?.agent ?? null} />
                        </Show>
                      </Show>
                    }
                  >
                    <ItemScreen />
                  </Show>
                </Show>
              </Show>
            </div>
          </slot>
        </main>
      </div>
      <div id="scrim" onClick={() => setNavOpen(false)}></div>
      <div id="toast" role="status" aria-live="polite" classList={{ show: toastShow() }}>
        {toastText()}
      </div>
    </>
  );
}

// The full-page view a bare /p/:id direct link lands on: just the one post, no
// chrome, with a small sideshow watermark beneath it.
function StandaloneView(props: { post: Post }) {
  return (
    <div id="standalone">
      <main class="standalone-main">
        <Card post={props.post} standalone />
        <footer class="standalone-foot">
          <a href="https://sideshow.sh" target="_blank" rel="noopener noreferrer">
            made with <strong>sideshow</strong>
          </a>
        </footer>
      </main>
    </div>
  );
}

function UpdateBanner() {
  return (
    <Show when={updateNotice()} keyed>
      {(v) => (
        <div class="update-banner" role="status">
          <div class="update-head">
            New version <strong>{v.latest}</strong>
            <button
              class="x"
              aria-label={`Dismiss update notice for ${v.latest}`}
              onClick={() => dismissUpdate(v.latest!)}
            >
              ✕
            </button>
          </div>
          <Show when={v.upgradeCommand}>
            <button
              class="update-cmd"
              title="Copy upgrade command"
              onClick={() => {
                navigator.clipboard.writeText(v.upgradeCommand!);
                toast("Copied: " + v.upgradeCommand);
              }}
            >
              <code>{v.upgradeCommand}</code> ⧉
            </button>
          </Show>
        </div>
      )}
    </Show>
  );
}

// Release notes as a card — the update notice the workspace already shipped,
// kept through the reshape.
function WhatsNewCard() {
  return (
    <Show when={updateNotice()?.notes ? updateNotice() : null} keyed>
      {(v) => (
        <div class="card" id="whatsNew">
          <div class="card-head">
            <span class="card-title">What&rsquo;s new in {v.latest}</span>
            <span class="card-meta">update available</span>
            <span class="sp"></span>
            <button class="act del" onClick={() => dismissUpdate(v.latest!)}>
              dismiss
            </button>
          </div>
          <div class="update-notes" innerHTML={renderNotes(v.notes!)}></div>
        </div>
      )}
    </Show>
  );
}

// One shared bridge listener for every mounted engine (see the long note in the
// pre-reshape App: a host can mount two engines in one realm).
let bridgeListeners = 0;
function acquireBridgeListener(): void {
  if (bridgeListeners++ === 0) window.addEventListener("message", onBridgeMessage);
}
function releaseBridgeListener(): void {
  if (--bridgeListeners === 0) window.removeEventListener("message", onBridgeMessage);
}

// Messages from sandboxed surface iframes (see server/surfacePage.ts bridge).
// `hit-test-result` is handled by Stage.tsx, which owns the request it answers.
async function onBridgeMessage(ev: MessageEvent) {
  const d = ev.data as {
    __sideshow?: boolean;
    type?: string;
    height?: number;
    text?: unknown;
    url?: string;
  } | null;
  if (!d || !d.__sideshow) return;
  const src = frameForSource(ev.source);
  if (d.type === "resize") {
    if (src) applyFrameHeight(src.iframe, d.height);
  } else if (d.type === "send-prompt" && src) {
    if (isReadonly()) return;
    // A script inside the sandbox can fire this with no user involvement, so it
    // must never become an author:"user" comment — that label is reserved for
    // the composer in this trusted origin.
    await api("/api/comments", {
      method: "POST",
      body: JSON.stringify({ surface: src.id, text: String(d.text), author: "surface" }),
    });
    toast("Added to this post’s thread");
  } else if (d.type === "open-link" && isOwnFrame(ev.source)) {
    // Re-check the scheme host-side: a surface can call openLink() with any
    // scheme, and only this check can't be bypassed.
    let link: URL;
    try {
      link = new URL(String(d.url));
    } catch {
      return;
    }
    if (link.protocol !== "http:" && link.protocol !== "https:") return;
    if (confirm(`Open external link?\n\n${link.href}`))
      window.open(link.href, "_blank", "noopener,noreferrer");
  } else if (d.type === "copy" && isOwnFrame(ev.source)) {
    void navigator.clipboard?.writeText(String(d.text)).catch(() => {});
  }
}

function isOwnFrame(source: unknown): boolean {
  for (const f of root().querySelectorAll("iframe")) {
    if (f.contentWindow === source) return true;
  }
  return false;
}

function ConnectPage() {
  return (
    <section class="settings-page connect-page" aria-label="Connect an agent">
      <div class="settings-col">
        <header class="settings-top">
          <h1>Connect an agent</h1>
          <Show
            when={!isReadonly()}
            fallback={<p>This workspace is read-only, so new agents cannot connect from here.</p>}
          >
            <p>
              One command wires sideshow into Claude Code, Cursor, Codex, VS Code, opencode, and
              other MCP-capable agents. New posts show up here automatically.
            </p>
          </Show>
        </header>
        <Show when={!isReadonly()}>
          <section class="settings-sec">
            <h2>MCP setup</h2>
            <ConnectInstructions />
          </section>
        </Show>
      </div>
    </section>
  );
}

function ModeIcon(props: { mode: ColorModePreference }) {
  if (props.mode === "dark") return <MoonIcon />;
  if (props.mode === "light") return <SunIcon />;
  return <SystemIcon />;
}

const COLOR_MODE_LABELS: Record<ColorModePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};
const COLOR_MODE_OPTIONS: ColorModePreference[] = ["system", "light", "dark"];

function ColorModeSwitcher() {
  return (
    <div class="mode-switcher" role="group" aria-label="Color mode">
      <For each={COLOR_MODE_OPTIONS}>
        {(mode) => (
          <button
            type="button"
            classList={{ active: colorModePreference() === mode }}
            aria-label={`${COLOR_MODE_LABELS[mode]} mode`}
            aria-pressed={colorModePreference() === mode}
            title={`${COLOR_MODE_LABELS[mode]} mode`}
            onClick={() => setColorModePreference(mode)}
          >
            <ModeIcon mode={mode} />
          </button>
        )}
      </For>
    </div>
  );
}

// Workspace-level theme selector. Persists via PUT /api/theme; the choice
// re-themes the chrome and every surface frame together (see theme.ts).
function ThemePicker() {
  return (
    <div class="theme-picker">
      <span class="theme-select-wrap">
        <select
          id="themeSel"
          aria-label="Theme"
          value={activeTheme()}
          onChange={(e) => void setTheme(e.currentTarget.value)}
        >
          <For each={themeOptions()}>{(t) => <option value={t.id}>{t.label}</option>}</For>
        </select>
      </span>
      <ColorModeSwitcher />
    </div>
  );
}
