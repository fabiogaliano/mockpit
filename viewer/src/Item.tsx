// The item screen: variant tabs, the stage, the history rail, and the thread
// where a decision (Accept / Revise / Drop) goes back to the agent.
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { appPath, isReadonly, relTime } from "./api.ts";
import { SLOTS } from "./host.ts";
import {
  anchorsFor,
  appendToken,
  markerLabel,
  refsInText,
  removeToken,
  type Marker,
} from "./markers.ts";
import {
  archivedVariants,
  browseVersion,
  currentProject,
  currentSlug,
  decide,
  historyEntries,
  item,
  itemComments,
  itemLoading,
  items,
  postComment,
  restoreVariant,
  selectedVariant,
  selectVariant,
  stageVersion,
  versionAt,
  visibleVariants,
  type ItemComment,
  type VariantDetail,
  type VersionMeta,
} from "./projects.ts";
import { Stage, ViewportTabs } from "./Stage.tsx";
import { ListSkeletonRows, QueuedNote, StageSkeleton } from "./States.tsx";
import { toast } from "./state.ts";

// A comment counts as stale when the agent hasn't picked it up for a while —
// state 6 in the mockups ("sent · agent hasn't checked in for 14m").
const STALE_MS = 10 * 60 * 1000;

function phoneWidth(): boolean {
  return typeof window !== "undefined" && window.innerWidth <= 720;
}

export function ItemScreen() {
  const [marking, setMarking] = createSignal(false);
  const [viewport, setViewport] = createSignal(phoneWidth() ? 390 : 1280);
  const [markers, setMarkers] = createSignal<Marker[]>([]);
  const [sentMarkers, setSentMarkers] = createSignal<Marker[]>([]);
  const [highlight, setHighlight] = createSignal<number | null>(null);
  const [text, setText] = createSignal("");
  const [sheetOpen, setSheetOpen] = createSignal(false);
  const [showArchived, setShowArchived] = createSignal(false);
  const [showSlots, setShowSlots] = createSignal(false);
  let textarea: HTMLTextAreaElement | undefined;

  const detail = item;
  // While the item read is in flight the list row already knows the title, kind
  // and version, so the loading screen is labelled instead of blank.
  const listRow = () => items.find((i) => i.slug === currentSlug());
  const title = () => detail()?.title ?? listRow()?.title ?? "";
  const variant = () => selectedVariant();
  const version = () => stageVersion();
  const latest = () =>
    variant()?.version ??
    (listRow()?.variants ?? []).reduce((max, v) => Math.max(max, v.version), 1);
  const browsing = () => version() !== latest();
  const kind = () => detail()?.kind ?? listRow()?.kind ?? "component";
  const multi = () => visibleVariants(detail()).length > 1;
  const accepted = () => visibleVariants(detail()).find((v) => v.status === "accepted");

  // Markers belong to the version they were drawn on; a newer render clears the
  // dimmed "already sent" ones.
  const versionKey = createMemo(() => `${variant()?.postId ?? ""}:${version()}`);
  createEffect(
    on(versionKey, () => {
      setMarkers([]);
      setSentMarkers([]);
      setMarking(false);
    }),
  );

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMarking(false);
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const comments = () => {
    const postId = variant()?.postId;
    return itemComments().filter(
      // A decision may carry no text (Accept, or Revise that only released
      // drafts); its own row would be blank, and the rail already records it.
      (c) => (!postId || c.postId === postId) && (c.text.trim() !== "" || decisionLabel(c) !== ""),
    );
  };

  // Queued but unsent: what Revise will release to the agent in one request.
  const drafts = () => comments().filter((c) => c.draft);

  const addMarker = (m: Marker) => {
    setMarkers((prev) => [...prev, m]);
    setText((t) => appendToken(t, m.ref));
    textarea?.focus();
  };

  const changeMarker = (ref: number, patch: Partial<Marker>) =>
    setMarkers((prev) => prev.map((m) => (m.ref === ref ? { ...m, ...patch } : m)));

  const removeMarker = (ref: number) => {
    setMarkers((prev) => prev.filter((m) => m.ref !== ref));
    setText((t) => removeToken(t, ref));
  };

  // Typing over an `@n` removes its marker, so the text and the drawing can
  // never disagree.
  const onText = (value: string) => {
    setText(value);
    const present = refsInText(value);
    setMarkers((prev) =>
      prev.every((m) => present.has(m.ref)) ? prev : prev.filter((m) => present.has(m.ref)),
    );
  };

  const send = async (asDraft = true) => {
    const body = text().trim();
    const v = variant();
    if (!body || !v) return;
    const drawn = markers();
    setText("");
    const error = await postComment({
      postId: v.postId,
      text: body,
      anchors: anchorsFor(drawn, version(), viewport()),
      postVersion: version(),
      viewport: viewport(),
      draft: asDraft,
    });
    if (error) {
      setText(body);
      toast(`Couldn't post that comment — ${error}. It's back in the box.`);
      return;
    }
    setSentMarkers((prev) => [...prev, ...drawn]);
    setMarkers([]);
    setMarking(false);
  };

  const runDecision = async (decision: "accept" | "revise" | "drop") => {
    const v = variant();
    if (!v) return;
    let note = text().trim();
    if (decision === "revise" && !note && drafts().length === 0) {
      // Nothing typed and nothing queued — Revise would send an empty request,
      // so ask for the one sentence it needs.
      note = window.prompt("What should change?")?.trim() ?? "";
      if (!note) return;
    }
    const error = await decide(v.postId, decision, decision === "revise" ? note : undefined);
    if (error) {
      toast(`Couldn't send that — ${error}`);
      return;
    }
    if (decision === "revise") setText("");
    toast(
      `${decision === "accept" ? "Accepted" : decision === "drop" ? "Dropped" : "Revise sent"} · agent notified`,
    );
  };

  const restore = async (v: VariantDetail) => {
    const error = await restoreVariant(v.postId);
    if (error) toast(`Couldn't restore that variant — ${error}`);
  };

  const slotLine = () => {
    const slots = variant()?.slots ?? [];
    if (slots.length === 0) return "";
    return slots.map((s) => `${s.slug} ${s.variant} v${s.version}`).join(" · ");
  };

  return (
    <div class="ss-item" classList={{ "sheet-open": sheetOpen() }}>
      <div class="ss-mtop">
        <a
          class="back"
          href={appPath(`/project/${encodeURIComponent(currentProject() ?? "")}`)}
          onClick={(e) => {
            e.preventDefault();
            history.back();
          }}
        >
          ‹ {currentProject()}
        </a>
        <h1>{title()}</h1>
      </div>
      <div class="ss-head">
        <h1>{title()}</h1>
        <span class="m">
          {kind()}
          <Show when={variant()}> · {variant()!.variant}</Show> · v{latest()}
        </span>
        <span class="m right">{currentProject()}</span>
        {/* Host-overridable item actions (a cloud "Share", say). Empty
            self-hosted; the retired `ss:session-actions` name is still
            projected here so an older embedder keeps working. */}
        <span class="ss-head-acts">
          <slot name={SLOTS.itemActions} />
          <slot name={SLOTS.sessionActions} />
        </span>
      </div>
      <div class="ss-page">
        <div class="ss-view">
          <div class="ss-bar">
            <Show when={multi()}>
              <div class="ss-tabs">
                <For each={visibleVariants(detail())}>
                  {(v) => (
                    <button
                      type="button"
                      classList={{ on: v.variant === variant()?.variant }}
                      onClick={() => selectVariant(v.variant)}
                    >
                      {v.variant}
                      <Show when={v.status === "accepted"}>
                        <span class="ok"> ✓</span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <Show when={!multi()}>
              <span class="ss-pill">{kind()}</span>
            </Show>
            <AskLine
              ask={variant()?.ask?.text ?? null}
              accepted={accepted()?.variant ?? null}
              multi={multi()}
            />
            <div class="r">
              <button
                type="button"
                class="ss-markbtn"
                classList={{ on: marking() }}
                aria-pressed={marking()}
                onClick={() => setMarking((v) => !v)}
              >
                {marking() ? "✎ Marking" : "✎ Mark"}
              </button>
              <ViewportTabs value={viewport()} onPick={setViewport} />
              <Show when={kind() === "page"}>
                <button class="ss-btn" type="button" onClick={() => setShowSlots((v) => !v)}>
                  Change components…
                </button>
              </Show>
              <Show when={variant()}>
                <a
                  class="ss-btn"
                  href={appPath(`/p/${variant()!.postId}`)}
                  target="_blank"
                  rel="noopener"
                >
                  Open full
                </a>
              </Show>
            </div>
          </div>
          <Show when={kind() === "page" && slotLine()}>
            <div class="ss-slots-line">components: {slotLine()}</div>
          </Show>
          <Show when={showSlots()}>
            <div class="ss-slots">
              <For each={variant()?.slots ?? []}>
                {(s) => (
                  <div class="ss-slot-row">
                    <a
                      class="n"
                      href={appPath(
                        `/project/${encodeURIComponent(currentProject() ?? "")}/${encodeURIComponent(s.slug)}?variant=${encodeURIComponent(s.variant)}`,
                      )}
                    >
                      {s.slug}
                    </a>
                    {/* Which version this page snapshotted. Changing it is the
                        agent's job (a new page version), so the switch shows the
                        pinned version rather than pretending to edit it. */}
                    <select disabled title="Snapshotted version — republish the page to change it">
                      <option>
                        {s.variant} v{s.version}
                      </option>
                    </select>
                  </div>
                )}
              </For>
              <div class="ss-slots-note">
                Publishing a new version of this page changes its components.
              </div>
            </div>
          </Show>
          <Show when={!itemLoading() && variant()} fallback={<StageSkeleton version={latest()} />}>
            <Stage
              postId={variant()!.postId}
              version={version()}
              surfaces={variant()!.surfaces ?? [{ kind: "html", index: 0 }]}
              viewport={viewport()}
              marking={marking()}
              markers={markers()}
              sentMarkers={sentMarkers()}
              highlight={highlight()}
              onAdd={addMarker}
              onChange={changeMarker}
              onRemove={removeMarker}
              badge={() => (
                <Show when={browsing()}>
                  <span class="ss-badge">
                    viewing v{version()} ·{" "}
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        browseVersion(null);
                      }}
                    >
                      back to v{latest()}
                    </a>
                  </span>
                </Show>
              )}
            />
          </Show>
          <Show when={archivedVariants(detail()).length > 0}>
            <div class="ss-archived">
              <button type="button" class="link" onClick={() => setShowArchived((v) => !v)}>
                archived ({archivedVariants(detail()).length})
              </button>
              <Show when={showArchived()}>
                <For each={archivedVariants(detail())}>
                  {(v) => (
                    <span class="ss-archived-row">
                      <span class="dropped">{v.variant}</span>
                      <button type="button" class="link" onClick={() => void restore(v)}>
                        Restore
                      </button>
                    </span>
                  )}
                </For>
              </Show>
            </div>
          </Show>
        </div>
        <div class="ss-hist">
          <div class="ss-grab" onClick={() => setSheetOpen((v) => !v)}></div>
          <div class="ss-mhist">
            <span>
              <b>v{version()}</b>
              <Show when={currentEntry(variant(), version())?.from}>
                {" "}
                · based on v{currentEntry(variant(), version())!.from}
              </Show>
            </span>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setSheetOpen((v) => !v);
              }}
            >
              history ({historyEntries(variant()).length}) ⌃
            </a>
          </div>
          <h3>History · {variant()?.variant ?? title()}</h3>
          <Show when={itemLoading() && historyEntries(variant()).length === 0}>
            <ListSkeletonRows rows={3} />
          </Show>
          <For each={historyEntries(variant())}>
            {(entry) => (
              <div
                class="ss-h"
                classList={{ on: entry.version === version() }}
                role="button"
                tabIndex={0}
                onClick={() => browseVersion(entry.version === latest() ? null : entry.version)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    browseVersion(entry.version === latest() ? null : entry.version);
                  }
                }}
              >
                <div class="th">v{entry.version}</div>
                <div>
                  <b>
                    v{entry.version}
                    <Show when={entry.version === latest()}> · current</Show>
                  </b>
                  <div class="why">
                    <Show when={entry.prompt} fallback="initial exploration">
                      <span class="who">{promptWho(entry)}:</span> <q>{promptText(entry)}</q>
                    </Show>
                  </div>
                  <div class="meta">
                    <Show when={versionAt(entry)}>{relTime(versionAt(entry)!)}</Show>
                    <Show when={entry.from}> · based on v{entry.from}</Show>
                  </div>
                </div>
              </div>
            )}
          </For>
          <div class="ss-thread">
            <Show when={comments().length > 0} fallback={<div class="ss-nocmt">no comments</div>}>
              <For each={comments()}>
                {(c) => (
                  <CommentRow
                    comment={c}
                    onHover={(ref) => setHighlight(ref)}
                    updatedAt={variant()?.updatedAt}
                  />
                )}
              </For>
            </Show>
            <Show when={!isReadonly()}>
              <div class="ss-compose">
                <div class="ss-chips">
                  <For each={markers()}>
                    {(m) => (
                      <span
                        class="ss-chip"
                        onMouseEnter={() => setHighlight(m.ref)}
                        onMouseLeave={() => setHighlight(null)}
                      >
                        <span class="n">{m.ref}</span>
                        {m.shape} · {markerLabel(m)}
                        <span class="x" onClick={() => removeMarker(m.ref)}>
                          ✕
                        </span>
                      </span>
                    )}
                  </For>
                </div>
                <textarea
                  ref={(el) => (textarea = el)}
                  placeholder={`Comment on v${version()}…`}
                  value={text()}
                  onInput={(e) => onText(e.currentTarget.value)}
                ></textarea>
                <div class="ss-acts">
                  <button class="ss-btn" type="button" onClick={() => void send(true)}>
                    Add
                  </button>
                  <button class="ss-btn p" type="button" onClick={() => void runDecision("revise")}>
                    Revise
                    <Show when={drafts().length > 0}> ({drafts().length})</Show>
                  </button>
                  <span class="cnt">
                    <Show when={markers().length > 0}>
                      {markers().length} ref{markers().length > 1 ? "s" : ""}
                    </Show>
                  </span>
                </div>
              </div>
              <AgentPayload
                text={text()}
                markers={markers()}
                version={version()}
                viewport={viewport()}
                slug={detail()?.slug ?? ""}
              />
            </Show>
          </div>
          <Show when={!isReadonly() && variant()}>
            <div class="ss-decide">
              <Show
                when={variant()!.status !== "archived"}
                fallback={
                  <button class="ss-btn p" type="button" onClick={() => void restore(variant()!)}>
                    Restore
                  </button>
                }
              >
                <button class="ss-btn p" type="button" onClick={() => void runDecision("accept")}>
                  Accept
                </button>
                <button class="ss-btn" type="button" onClick={() => void runDecision("revise")}>
                  Revise…
                </button>
                <Show when={multi()}>
                  <button class="ss-btn" type="button" onClick={() => void runDecision("drop")}>
                    Drop
                  </button>
                </Show>
              </Show>
            </div>
          </Show>
        </div>
      </div>
      <Show when={staleComment(comments(), variant()?.updatedAt)}>
        <QueuedNote />
      </Show>
      <Show when={!isReadonly()}>
        <button
          class="ss-fab"
          classList={{ on: marking() }}
          type="button"
          aria-label="Mark the stage"
          onClick={() => setMarking((v) => !v)}
        >
          ✎
        </button>
      </Show>
    </div>
  );
}

// What the agent will actually receive for the comment being composed. The
// hit-test reply (path/text) came from the sandbox, so it is stringified and
// rendered as one text node — never markup.
function AgentPayload(props: {
  text: string;
  markers: Marker[];
  version: number;
  viewport: number;
  slug: string;
}) {
  const json = () =>
    JSON.stringify(
      {
        comment: {
          text: props.text || "…",
          version: props.version,
          viewport: props.viewport,
          anchors: anchorsFor(props.markers, props.version, props.viewport).map((a) => ({
            ...a,
            crop: `/p/${props.slug}.png?v=${props.version}&crop=${a.ref}`,
          })),
        },
      },
      null,
      1,
    );
  return (
    <Show when={props.markers.length > 0}>
      <div class="ss-payload">
        <b>what the agent gets (mockpit wait)</b>
        {json()}
      </div>
    </Show>
  );
}

function currentEntry(variant: VariantDetail | null, version: number) {
  return historyEntries(variant).find((e) => e.version === version);
}

// A delivered user comment the agent has not seen for longer than STALE_MS.
function staleComment(list: ItemComment[], updatedAt?: string): boolean {
  const last = [...list].reverse().find((c) => c.author === "user" && !c.draft);
  if (!last || last.seen) return false;
  const at = Date.parse(last.createdAt);
  return Number.isFinite(at) && Date.now() - at > STALE_MS && !!updatedAt;
}

function AskLine(props: { ask: string | null; accepted: string | null; multi: boolean }) {
  return (
    <Show when={props.ask || props.accepted || props.multi}>
      <Show
        when={props.accepted}
        fallback={<span class="ss-ask">agent asks: {props.ask ?? "pick one"}</span>}
      >
        <span class="ss-picked">picked {props.accepted}</span>
      </Show>
    </Show>
  );
}

function CommentRow(props: {
  comment: ItemComment;
  onHover: (ref: number | null) => void;
  updatedAt?: string;
}) {
  const state = () => {
    if (props.comment.draft) return { label: "draft · sends with Revise", cls: "" };
    if (props.comment.seen) return { label: "seen by agent", cls: "seen" };
    if (props.comment.pending) return { label: "sending", cls: "" };
    const at = Date.parse(props.comment.createdAt);
    if (Number.isFinite(at) && Date.now() - at > STALE_MS) {
      const mins = Math.floor((Date.now() - at) / 60000);
      return { label: `sent · agent hasn't checked in for ${mins}m`, cls: "stale" };
    }
    return { label: "sent", cls: "" };
  };
  // The text is agent- or user-authored, so it renders as Solid text nodes; the
  // `@n` tokens become chips around those text nodes, never markup.
  const pieces = () => splitRefs(props.comment.text.trim() || decisionLabel(props.comment));
  return (
    <div class="ss-cmt" classList={{ user: props.comment.author === "user" }}>
      <b classList={{ you: props.comment.author === "user" }}>
        {props.comment.author === "user" ? "you" : props.comment.author}
      </b>
      <For each={pieces()}>
        {(piece) =>
          piece.ref === null ? (
            <span>{piece.text}</span>
          ) : (
            <span
              class="ss-ref"
              onMouseEnter={() => props.onHover(piece.ref)}
              onMouseLeave={() => props.onHover(null)}
            >
              {piece.text}
            </span>
          )
        }
      </For>
      <Show when={props.comment.author === "user"}>
        <span class={`ss-state ${state().cls}`}> {state().label}</span>
      </Show>
    </div>
  );
}

// A version's `prompt` is what asked for it, and it usually quotes the operator
// ("you: make it wider"). Attribute it to whoever the prompt names; fall back to
// the version's author, who is the publishing agent.
const PROMPT_WHO = /^(you|user|agent|designer)\s*:\s*/i;

function promptWho(entry: VersionMeta): string {
  const named = PROMPT_WHO.exec(entry.prompt ?? "")?.[1];
  if (named) return named.toLowerCase() === "user" ? "you" : named.toLowerCase();
  return entry.author === "user" ? "you" : (entry.author ?? "agent");
}

function promptText(entry: VersionMeta): string {
  return (entry.prompt ?? "").replace(PROMPT_WHO, "");
}

const DECISION_LABELS: Record<string, string> = {
  accept: "accepted this version",
  drop: "dropped this variant",
  revise: "sent the drafts above",
};

function decisionLabel(c: ItemComment): string {
  return DECISION_LABELS[c.kind ?? ""] ?? "";
}

function splitRefs(text: string): { text: string; ref: number | null }[] {
  const out: { text: string; ref: number | null }[] = [];
  let last = 0;
  for (const match of text.matchAll(/@(\d+)/g)) {
    const at = match.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), ref: null });
    out.push({ text: match[0], ref: Number(match[1]) });
    last = at + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), ref: null });
  return out;
}
