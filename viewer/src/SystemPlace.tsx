// The System place in Home: what every render of the project wears, a tab per
// family. Palettes are swatch rows with Default, Keep and Hide; the scales are one
// sandboxed specimen (it needs the project's fonts); revisions have Restore. Every
// change here is one revision and one reply to the project's agent, so the toast
// says so and Undo sends the reverse. Values are data: swatches are element styles,
// names and notes text nodes.

import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { api, type SystemPage, specimenUrl, subscribe } from "./api.ts";
import type { Palette, PaletteStatus } from "../../server/system.ts";
import type { PairResult } from "../../server/systemChecks.ts";
import { Icon } from "./icons.tsx";
import { timeAgo } from "./logic.ts";
import { designPath, linkClick } from "./route.ts";
import { theme } from "./theme.ts";
import { host, readonly } from "./host.ts";
import type { ToastLine } from "./toast.tsx";

type Tab = "palettes" | "scales" | "tokens" | "classes" | "components" | "revisions";

const STATUS_WORD: Record<PaletteStatus, string> = {
  default: "Default",
  kept: "Kept",
  open: "Open",
  hidden: "Hidden",
};
const ACTION_WORD: Record<"default" | "kept" | "hidden", string> = {
  default: "Default",
  kept: "Keep",
  hidden: "Hide",
};

// The tab last open per project: going back from a component lands on Components.
const [lastTab, setLastTab] = createSignal(new Map<string, Tab>(), { equals: false });

const failText = (r: PairResult) =>
  `${r.fg} on ${r.bg}, ${r.mode}: ${r.ratio?.toFixed(2)}:1, needs ${r.min}`;

export function SystemPlace(props: { project: string; toast: (t: ToastLine) => void }) {
  const [page, { refetch }] = createResource(() => props.project, api.system);
  const tab = () => lastTab().get(props.project) ?? "palettes";
  const setTab = (t: Tab) => setLastTab((m) => m.set(props.project, t));
  const [busy, setBusy] = createSignal(false);
  const [at, setAt] = createSignal<360 | 1280>(360);

  const stop = subscribe(
    (e) => {
      if (e.type === "system-changed" && e.project === props.project) void refetch();
      // A decision's Delivered / Not seen yet moves with the agent's cursor.
      else if (e.type === "comment-delivered" && page()?.told?.length) void refetch();
    },
    () => void refetch(),
  );
  onCleanup(stop);

  const fails = createMemo(() =>
    (page()?.contrast ?? []).filter((r) => r.ratio !== null && r.ratio < r.min),
  );
  const failsOf = (id: string) => fails().filter((r) => r.palette === id);
  const sheetChecks = () => (page()?.checks ?? []).filter((c) => !c.startsWith("contrast:"));
  const roles = () => page()?.color.roles ?? [];
  const palettes = () => (page()?.color.palettes ?? []).filter((p) => p.status !== "hidden");
  const hidden = () => (page()?.color.palettes ?? []).filter((p) => p.status === "hidden");
  const tokens = () => (page()?.tokens ?? []).filter((t) => !t.scale);
  const families = createMemo(() => {
    const out = new Map<string, NonNullable<SystemPage["tokens"]>>();
    for (const t of tokens()) {
      const list = out.get(t.type);
      if (list) list.push(t);
      else out.set(t.type, [t]);
    }
    return [...out];
  });

  // One decision at a time, in order: a toast's Undo pressed while another is in
  // flight waits for it instead of being dropped.
  let queue: Promise<void> = Promise.resolve();
  function decide(
    body: { palette: string; status: PaletteStatus } | { restore: number },
    undo: (() => void) | undefined,
    words: string,
  ): Promise<void> {
    queue = queue.then(() => decideNow(body, undo, words));
    return queue;
  }
  async function decideNow(
    body: { palette: string; status: PaletteStatus } | { restore: number },
    undo: (() => void) | undefined,
    words: string,
  ) {
    setBusy(true);
    try {
      const r = await api.systemDecide(props.project, body);
      await refetch();
      if (r.changes.length) {
        props.toast({
          text: r.told ? `${words}. The agent will hear it.` : words,
          ...(undo ? { undo } : {}),
        });
      }
    } catch (err) {
      props.toast({ text: err instanceof Error ? err.message : "Couldn't change it" });
    } finally {
      setBusy(false);
    }
  }

  function setStatus(p: Palette, status: "default" | "kept" | "hidden") {
    if (p.status === status || p.status === "default") return;
    const was = page()?.color.palettes.find((x) => x.status === "default");
    const undo =
      status === "default"
        ? was && (() => void decide({ palette: was.id, status: "default" }, undefined, "Put back"))
        : () => void decide({ palette: p.id, status: p.status }, undefined, "Put back");
    const name = p.label || p.id;
    void decide(
      { palette: p.id, status },
      undo,
      status === "default"
        ? `${name} is the default`
        : `${name} ${STATUS_WORD[status].toLowerCase()}`,
    );
  }

  function restore(rev: number) {
    const now = page()?.rev;
    void decide(
      { restore: rev },
      now ? () => void decide({ restore: now }, undefined, `Back to r${now}`) : undefined,
      `Restored r${rev}`,
    );
  }
  const toldOf = (rev: number) => page()?.told?.find((t) => t.rev === rev);

  const strip = (values: Record<string, string>, dark: boolean) => (
    <span class="sys-strip" classList={{ dk: dark }} title={dark ? "Dark" : "Light"}>
      <For each={roles()}>
        {(r) => (
          <i
            style={{ "background-color": values[r.name] ?? "transparent" }}
            title={`${r.name} ${values[r.name] ?? "missing"}`}
          />
        )}
      </For>
    </span>
  );

  const row = (p: Palette) => {
    const f = () => failsOf(p.id);
    return (
      <div class="sys-prow">
        <span class="sys-nm">
          <span title={p.note}>{p.label || p.id}</span>
          <Show when={readonly() && (p.status === "default" || p.status === "kept")}>
            <span class={`sys-st ${p.status}`}>{STATUS_WORD[p.status]}</span>
          </Show>
          <Show when={p.owner === "repo"}>
            <span class="sys-repo" title="From the repo: rerun mockpit init to change it">
              repo
            </span>
          </Show>
        </span>
        <span class="sys-modes">
          <span class="sys-mlab">Light</span>
          {strip(p.light, false)}
          <span class="sys-mlab">Dark</span>
          {strip(p.dark, true)}
        </span>
        <Show
          when={f().length}
          fallback={
            <span class="sys-ok">{page()?.color.pairs.length ? "Contrast passes" : ""}</span>
          }
        >
          <span class="sys-fail" title={f().map(failText).join("\n")}>
            <Icon name="warn" />
            {f().length} contrast {f().length === 1 ? "fail" : "fails"}
          </span>
        </Show>
        <Show when={!readonly()}>
          <span class="vswitch sys-stswitch" role="group" aria-label={p.label || p.id}>
            <For each={["default", "kept", "hidden"] as const}>
              {(s) => (
                <button
                  type="button"
                  aria-pressed={p.status === s}
                  disabled={busy() || (p.status === "default" && s !== "default")}
                  title={
                    p.status === "default" && s !== "default"
                      ? "Make another palette the default first"
                      : undefined
                  }
                  onClick={() => setStatus(p, s)}
                >
                  {ACTION_WORD[s]}
                </button>
              )}
            </For>
          </span>
        </Show>
      </div>
    );
  };

  const tabs = (): { id: Tab; label: string; n: number | null; q: number }[] => {
    const s = page();
    if (!s) return [];
    const scales = s.scales.length + s.fonts.length;
    return [
      { id: "palettes", label: "Palettes", n: s.color.palettes.length, q: fails().length },
      { id: "scales", label: "Type and space", n: scales || null, q: 0 },
      { id: "tokens", label: "Tokens", n: tokens().length, q: 0 },
      { id: "classes", label: "Classes", n: s.sheet?.classes.length ?? 0, q: sheetChecks().length },
      { id: "components", label: "Components", n: s.components.length, q: 0 },
      { id: "revisions", label: "Revisions", n: s.revisions.length, q: 0 },
    ];
  };

  return (
    <Show when={page()}>
      {(s) => (
        <div class="sys">
          <div class="home-head">
            <h1>System</h1>
          </div>
          <div class="home-lead">
            <span>Every render in this project wears it</span>
            <Show when={s().revisions[0]}>
              {(r) => (
                <>
                  <span class="sep">·</span>
                  <span>Changed {timeAgo(r().at).toLowerCase()}</span>
                </>
              )}
            </Show>
          </div>
          <div class="sys-tabs" role="tablist" aria-label="System">
            <For each={tabs()}>
              {(t) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab() === t.id}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                  <Show when={t.n !== null}>
                    <span class="n">{t.n}</span>
                  </Show>
                  <Show when={t.q}>
                    <span class="q" aria-label={`${t.q} failing`}>
                      <Icon name="warn" />
                      {t.q}
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </div>
          <div role="tabpanel" class="sys-panel">
            <Show when={tab() === "palettes"}>
              <Show
                when={s().color.palettes.length}
                fallback={
                  <p class="sys-empty">No palettes yet: the agent adds them with system.</p>
                }
              >
                <For each={palettes()}>{(p) => row(p)}</For>
                <Show when={hidden().length}>
                  <details class="sys-hiddenfold">
                    <summary>{hidden().length} hidden</summary>
                    <For each={hidden()}>{(p) => row(p)}</For>
                  </details>
                </Show>
                <Show when={fails().length}>
                  <h2 class="sys-h2">
                    Checks <span class="n">{fails().length}</span>
                  </h2>
                  <For each={fails()}>
                    {(r) => (
                      <div class="sys-chk">
                        <Icon name="warn" />
                        <div>
                          {s().color.palettes.find((p) => p.id === r.palette)?.label ?? r.palette}:{" "}
                          {failText(r)}
                        </div>
                      </div>
                    )}
                  </For>
                </Show>
              </Show>
            </Show>
            <Show when={tab() === "scales"}>
              <div class="sys-spec">
                <div class="sys-spec-hd">
                  <span class="sys-mono">
                    {s()
                      .scales.map(
                        (x) =>
                          `${x.id} · ${x.base}px × ${x.ratio}${x.fluid ? `, fluid ${x.fluid.minWidth}→${x.fluid.maxWidth}` : ""}`,
                      )
                      .join("   ")}
                  </span>
                  <span class="vswitch" role="group" aria-label="Specimen width">
                    <For each={[360, 1280] as const}>
                      {(w) => (
                        <button type="button" aria-pressed={at() === w} onClick={() => setAt(w)}>
                          {w}
                        </button>
                      )}
                    </For>
                  </span>
                </div>
                <Specimen project={props.project} width={at()} />
              </div>
            </Show>
            <Show when={tab() === "tokens"}>
              <Show
                when={families().length}
                fallback={<p class="sys-empty">No tokens besides the scales.</p>}
              >
                <div class="sys-fam">
                  <For each={families()}>
                    {([type, list]) => (
                      <div>
                        <h3>{type}</h3>
                        <For each={list}>
                          {(t) => {
                            const value =
                              typeof t.value === "string"
                                ? t.value
                                : Object.entries(t.value)
                                    .map(([k, v]) => `${k} ${v}`)
                                    .join(", ");
                            return (
                              <div class="sys-tok" title={t.note}>
                                <Show when={t.type === "color" && typeof t.value === "string"}>
                                  <i
                                    class="sys-sw"
                                    style={{ "background-color": t.value as string }}
                                  />
                                </Show>
                                <span class="sys-mono">--{t.name}</span>
                                <Show when={t.owner === "repo"}>
                                  <span
                                    class="sys-repo"
                                    title="From the repo: rerun mockpit init to change it"
                                  >
                                    repo
                                  </span>
                                </Show>
                                <span class="v" title={value}>
                                  {value}
                                </span>
                              </div>
                            );
                          }}
                        </For>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
            <Show when={tab() === "classes"}>
              <Show
                when={s().sheet?.classes.length}
                fallback={
                  <p class="sys-empty">
                    {s().sheet ? "The sheet names no classes." : "No sheet yet."}
                  </p>
                }
              >
                <p class="sys-sub">From the sheet. Every render loads it.</p>
                <div class="sys-cls">
                  <For each={s().sheet?.classes ?? []}>
                    {(c) => (
                      <div>
                        <span class="sys-mono">.{c.name}</span>
                        <span>{c.note}</span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <For each={sheetChecks()}>
                {(c) => (
                  <div class="sys-chk">
                    <Icon name="warn" />
                    <div>{c}</div>
                  </div>
                )}
              </For>
            </Show>
            <Show when={tab() === "components"}>
              <Show
                when={s().components.length}
                fallback={<p class="sys-empty">No components yet.</p>}
              >
                <div class="sys-comps">
                  <For each={s().components}>
                    {(c) => {
                      const href = () => designPath(props.project, c.slug);
                      return (
                        <a class="sys-comp" href={href()} onClick={(e) => linkClick(e, href())}>
                          <span class="sys-mono">{c.slug}</span>
                          {/* The library's order: shared first, by group, then each area's own. */}
                          <span class="w">
                            {c.area ?? (c.group ? `Shared · ${c.group}` : "Shared")}
                          </span>
                          <span class="n">
                            in {c.screens} {c.screens === 1 ? "screen" : "screens"}
                          </span>
                          <Show when={c.purpose}>
                            <span class="p">{c.purpose}</span>
                          </Show>
                        </a>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </Show>
            <Show when={tab() === "revisions"}>
              <For each={s().revisions}>
                {(r, i) => (
                  <div class="sys-rev">
                    <span class="r">r{r.rev}</span>
                    <span class="s">{r.summary.replace(/^by the user: /, "")}</span>
                    <Show
                      when={i() > 0 && !readonly()}
                      fallback={<span class="now">{i() > 0 ? "" : "Now"}</span>}
                    >
                      <button
                        type="button"
                        class="btn"
                        disabled={busy()}
                        onClick={() => restore(r.rev)}
                      >
                        Restore
                      </button>
                    </Show>
                    <span class="w">
                      {r.summary.startsWith("by the user: ")
                        ? "You"
                        : r.sessionId
                          ? "Agent"
                          : "mockpit"}{" "}
                      · {timeAgo(r.at)}
                      <Show when={toldOf(r.rev)}>
                        {(t) => (t().delivered ? " · Delivered" : " · Not seen yet")}
                      </Show>
                    </span>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}

// The specimen at one width, scaled into the column: a fluid step only reads true
// at the width it is drawn at.
function Specimen(props: { project: string; width: number }) {
  const [boxW, setBoxW] = createSignal(0);
  const fit = () => (boxW() ? Math.min(1, boxW() / props.width) : 1);
  const [height, setHeight] = createSignal(320);
  let frame: HTMLIFrameElement | undefined;
  const onMessage = (e: MessageEvent) => {
    if (!frame || e.source !== frame.contentWindow) return;
    const d = e.data as Record<string, unknown> | null;
    if (!d || d.__mockpit !== true || d.type !== "resize") return;
    if (typeof d.height === "number" && Number.isFinite(d.height) && d.height > 0) {
      setHeight(Math.min(d.height, 6000));
    }
  };
  host().window.addEventListener("message", onMessage);
  const ro = new ResizeObserver((entries) => setBoxW(entries[0]?.contentRect.width ?? 0));
  onCleanup(() => {
    host().window.removeEventListener("message", onMessage);
    ro.disconnect();
  });
  return (
    <div
      class="sys-spec-box"
      ref={(el) => ro.observe(el)}
      style={{ height: `${Math.ceil(height() * fit())}px` }}
    >
      <iframe
        ref={(el) => (frame = el)}
        title="Type and space specimen"
        sandbox="allow-scripts"
        src={specimenUrl(props.project, theme(), null)}
        width={props.width}
        height={height()}
        style={{ transform: `scale(${fit()})`, "transform-origin": "0 0" }}
      />
    </div>
  );
}
