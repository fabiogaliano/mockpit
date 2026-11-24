// Knob choice panel & dynamic side-by-side finalist view: opens beside the live full-size
// stage whenever a Sheet cell is opened (`?sheet=<knob>&value=<val>`). Active finalists
// stay in the main list (and shrink-to-grow grid in Side by side); Bookmarked options fold
// into a collapsed drawer; Deleted options vanish immediately with Undo and store a silent
// tombstone for the agent.

import { createEffect, createSignal, For, on, Show } from "solid-js";
import { explicitKnob } from "../../server/knobs.ts";
import { runFrameAction, subjectOf } from "./frameActions.ts";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { alternativeName, safeColor } from "./logic.ts";
import { PanelColorEditor } from "./PanelColorEditor.tsx";
import type { SheetColumn } from "./sheet.ts";
import type { DesignScreenState } from "./state.ts";
import { Thumb } from "./Thumb.tsx";

type Held = NonNullable<ReturnType<DesignScreenState["sheet"]["held"]>>;

// Header toggle in RightMargin: List (live stage) vs Side by side (dynamic finalist grid).
export function KnobViewToggle(props: { s: DesignScreenState }) {
  const sh = props.s.sheet;
  return (
    <div class="seg kview-sw" role="group" aria-label="View">
      <button
        type="button"
        classList={{ on: !sh.knobSide() }}
        aria-pressed={!sh.knobSide()}
        aria-label="List"
        title="List"
        onClick={() => sh.setKnobSide(false)}
      >
        <Icon name="rows" />
      </button>
      <button
        type="button"
        classList={{ on: sh.knobSide() }}
        aria-pressed={sh.knobSide()}
        aria-label="Side by side"
        title="Side by side"
        onClick={() => sh.setKnobSide(true)}
      >
        <Icon name="columns" />
      </button>
    </div>
  );
}

function partitionCols(s: DesignScreenState, h: Held) {
  const active: SheetColumn[] = [];
  const bookmarked: SheetColumn[] = [];
  for (const col of h.cols) {
    const m = s.markOf(subjectOf({ v: h.v, col }));
    if (m === "deleted") continue;
    if (m === "keep") bookmarked.push(col);
    else active.push(col);
  }
  return { active, bookmarked };
}

function bookmarkCol(s: DesignScreenState, h: Held, col: SheetColumn) {
  const subj = subjectOf({ v: h.v, col });
  const wasKeep = s.markOf(subj) === "keep";
  s.toggleKeep(subj);
  // If we just bookmarked the focused option, step focus to the next active finalist.
  if (!wasKeep && h.col.key === col.key) {
    const next = h.cols.find((c) => {
      if (c.key === col.key) return false;
      const m = s.markOf(subjectOf({ v: h.v, col: c }));
      return m !== "deleted" && m !== "keep";
    });
    if (next) s.sheet.focusCell(h.v, next);
  }
}

export function KnobChoicePanel(props: { s: DesignScreenState }) {
  const s = props.s;
  const sh = s.sheet;
  const [savedOpen, setSavedOpen] = createSignal(false);
  const [editing, setEditing] = createSignal<string | null>(null);
  const colorPath = (h: Held) => {
    if (readonly() || !h.at.knob) return;
    const path = h.at.knob;
    const cfg = h.v.knobs?.[path] ?? s.design()?.knobs[path];
    return cfg !== undefined && explicitKnob(cfg).type === "color" ? path : undefined;
  };
  function edit(h: Held, col: SheetColumn | null) {
    s.setHoveredPreview(null);
    sh.setKnobSide(false);
    if (col) sh.focusCell(h.v, col);
    setEditing(col?.key ?? "");
  }
  createEffect(
    on(
      s.colorEditRequest,
      () => {
        const h = sh.held();
        if (h && colorPath(h)) {
          s.setHoveredPreview(null);
          sh.setKnobSide(false);
          setEditing(h.col.key);
        }
      },
      { defer: true },
    ),
  );
  createEffect(
    on(
      () => sh.held()?.v.postId,
      () => setEditing(null),
      { defer: true },
    ),
  );
  function colorEditor(h: Held, col: SheetColumn | null) {
    const path = colorPath(h);
    const start = col ?? h.col;
    const value = path ? start.values[path] : undefined;
    if (!path || typeof value !== "string" || !safeColor(value)) return null;
    return (
      <PanelColorEditor
        s={s}
        path={path}
        initial={value}
        preview={{
          alternative: h.v.alternative,
          state: h.v.state,
          knobs: sh.cell(h.v, start)?.knobs,
          key: "",
        }}
        submit="Add to Sheet"
        onSave={(next) => {
          const current = sh.held();
          const saved = current?.cols.find((c) => c.values[path] === next);
          if (current && saved) sh.focusCell(current.v, saved);
        }}
        onClose={() => setEditing(null)}
      />
    );
  }

  function colourActions(h: () => Held, col: SheetColumn) {
    const comment = () => {
      setEditing(null);
      runFrameAction(s, "comment", { v: h().v, col });
    };
    const close = (target: HTMLElement) => target.closest("details")?.removeAttribute("open");
    return (
      <Show when={colorPath(h())}>
        <button
          type="button"
          class="ib kact colour-direct"
          aria-label={`Edit a copy of ${col.label}`}
          title="Edit a copy"
          aria-expanded={editing() === col.key}
          onClick={() => edit(h(), col)}
        >
          <Icon name="palette" />
        </button>
        <button
          type="button"
          class="ib kact colour-direct"
          aria-label={`Comment on ${col.label}`}
          title="Comment"
          onClick={comment}
        >
          <Icon name="mark" />
        </button>
        <details class="colour-overflow">
          <summary aria-label={`More actions for ${col.label}`}>⋯</summary>
          <div class="colour-menu">
            <button
              type="button"
              class="btn"
              onClick={(e) => {
                close(e.currentTarget);
                edit(h(), col);
              }}
            >
              Edit a copy
            </button>
            <button
              type="button"
              class="btn"
              onClick={(e) => {
                close(e.currentTarget);
                comment();
              }}
            >
              Comment
            </button>
          </div>
        </details>
      </Show>
    );
  }

  // A mouse only: a finger's pointerenter fires on the tap itself, so its preview flashes
  // and iOS can take the tap as a hover, leaving the cell where it was.
  const previewCol = (h: Held, col: SheetColumn) => {
    if (sh.knobSide() || editing() !== null) return;
    const c = sh.cell(h.v, col);
    if (!c) return;
    s.setHoveredPreview({
      key: `knob-hover:${h.v.alternative}:${col.key}`,
      label: `${h.v.alternative} · ${col.label}`,
      alternative: h.v.alternative,
      state: h.v.state,
      knobs: c.knobs,
    });
  };
  const clearPreview = () => s.setHoveredPreview(null);

  const stepFrame = (h: Held, by: -1 | 1) => {
    const nextV = h.rows[h.r + by];
    if (!nextV) return;
    // Land on that frame's Main choice for this knob if set, else its first active finalist.
    const mainCol = h.cols.find((c) => s.markOf(subjectOf({ v: nextV, col: c })) === "main");
    const firstActive = h.cols.find((c) => {
      const m = s.markOf(subjectOf({ v: nextV, col: c }));
      return m !== "deleted" && m !== "keep";
    });
    const keepSame =
      s.markOf(subjectOf({ v: nextV, col: h.col })) !== "deleted" ? h.col : undefined;
    const target = mainCol ?? firstActive ?? keepSame ?? h.cols[0];
    if (target) sh.focusCell(nextV, target);
  };

  return (
    <Show when={sh.held()}>
      {(h) => {
        const parts = () => partitionCols(s, h());
        return (
          <div class="kpanel">
            <div class="kpanel-scroll">
              <div class="kpanel-list" role="listbox" aria-label={h().at.knob ?? "Looks"}>
                <For each={parts().active}>
                  {(col) => {
                    const subj = () => subjectOf({ v: h().v, col });
                    const mark = () => s.markOf(subj());
                    const focused = () => h().col.key === col.key;
                    return (
                      <>
                        <div
                          class="krow"
                          classList={{ on: focused(), main: mark() === "main" }}
                          onPointerEnter={(e) => e.pointerType === "mouse" && previewCol(h(), col)}
                          onPointerLeave={(e) => {
                            if (e.pointerType === "mouse" && editing() === null) clearPreview();
                          }}
                        >
                          <button
                            type="button"
                            class="krow-pick"
                            role="option"
                            aria-selected={focused()}
                            onClick={() => {
                              setEditing(null);
                              sh.focusCell(h().v, col);
                            }}
                          >
                            <span class="krow-lbl" title={col.label}>
                              <Show
                                when={colorPath(h()) && safeColor(col.values[colorPath(h()) ?? ""])}
                              >
                                <i
                                  class="colour-dot"
                                  aria-hidden="true"
                                  style={{
                                    "background-color": String(col.values[colorPath(h()) ?? ""]),
                                  }}
                                />
                              </Show>
                              {col.label}
                            </span>
                          </button>
                          <Show when={!readonly()}>
                            <div class="krow-acts">
                              <button
                                type="button"
                                class="ib kact star"
                                classList={{ on: mark() === "main" }}
                                aria-pressed={mark() === "main"}
                                aria-label={
                                  mark() === "main"
                                    ? `Unset Main: ${col.label}`
                                    : `Main: ${col.label}`
                                }
                                title="Main (M)"
                                onClick={() => s.toggleMain(subj())}
                              >
                                <Icon name="star" />
                              </button>
                              <button
                                type="button"
                                class="ib kact keep"
                                aria-pressed={false}
                                aria-label={`Bookmark ${col.label}`}
                                title="Bookmark (K)"
                                onClick={() => {
                                  clearPreview();
                                  bookmarkCol(s, h(), col);
                                }}
                              >
                                <Icon name="bookmark" />
                              </button>
                              <button
                                type="button"
                                class="ib kact del"
                                aria-label={`Delete ${col.label}`}
                                title="Delete (X)"
                                onClick={() => {
                                  clearPreview();
                                  runFrameAction(s, "delete", { v: h().v, col });
                                }}
                              >
                                <Icon name="trash" />
                              </button>
                              {colourActions(h, col)}
                            </div>
                          </Show>
                        </div>
                        <Show when={editing() === col.key}>{colorEditor(h(), col)}</Show>
                      </>
                    );
                  }}
                </For>
              </div>
              <Show when={parts().bookmarked.length}>
                <div class="ksaved">
                  <button
                    type="button"
                    class="ksaved-head"
                    aria-expanded={savedOpen()}
                    onClick={() => {
                      if (savedOpen()) setEditing(null);
                      setSavedOpen(!savedOpen());
                    }}
                  >
                    <Icon name="bookmark" />
                    <span>{`${parts().bookmarked.length} bookmarked`}</span>
                    <Icon name={savedOpen() ? "down" : "next"} />
                  </button>
                  <Show when={savedOpen()}>
                    <div class="kpanel-list ksaved-list">
                      <For each={parts().bookmarked}>
                        {(col) => {
                          const subj = () => subjectOf({ v: h().v, col });
                          const focused = () => h().col.key === col.key;
                          return (
                            <>
                              <div
                                class="krow keep"
                                classList={{ on: focused() }}
                                onPointerEnter={(e) =>
                                  e.pointerType === "mouse" && previewCol(h(), col)
                                }
                                onPointerLeave={(e) => {
                                  if (e.pointerType === "mouse" && editing() === null)
                                    clearPreview();
                                }}
                              >
                                <button
                                  type="button"
                                  class="krow-pick"
                                  onClick={() => {
                                    setEditing(null);
                                    sh.focusCell(h().v, col);
                                  }}
                                >
                                  <span class="krow-lbl" title={col.label}>
                                    {col.label}
                                  </span>
                                </button>
                                <Show when={!readonly()}>
                                  <div class="krow-acts">
                                    <button
                                      type="button"
                                      class="ib kact star"
                                      aria-label={`Main: ${col.label}`}
                                      title="Main (M)"
                                      onClick={() => s.toggleMain(subj())}
                                    >
                                      <Icon name="star" />
                                    </button>
                                    <button
                                      type="button"
                                      class="ib kact keep on"
                                      aria-pressed={true}
                                      aria-label={`Remove bookmark: ${col.label}`}
                                      title="Remove bookmark (K)"
                                      onClick={() => s.toggleKeep(subj())}
                                    >
                                      <Icon name="bookmark" />
                                    </button>
                                    <button
                                      type="button"
                                      class="ib kact del"
                                      aria-label={`Delete ${col.label}`}
                                      title="Delete (X)"
                                      onClick={() => {
                                        clearPreview();
                                        runFrameAction(s, "delete", { v: h().v, col });
                                      }}
                                    >
                                      <Icon name="trash" />
                                    </button>
                                    {colourActions(h, col)}
                                  </div>
                                </Show>
                              </div>
                              <Show when={editing() === col.key}>{colorEditor(h(), col)}</Show>
                            </>
                          );
                        }}
                      </For>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
            <Show when={colorPath(h())}>
              <div class="kpanel-colour-add">
                <button
                  type="button"
                  class="btn"
                  aria-expanded={editing() === ""}
                  onClick={() => edit(h(), null)}
                >
                  + Add colour
                </button>
                <Show when={editing() === ""}>{colorEditor(h(), null)}</Show>
              </div>
            </Show>
            <div class="kpanel-foot">
              <Show when={h().rows.length > 1}>
                <div class="kpanel-nav" role="group" aria-label="Items">
                  <button
                    type="button"
                    class="ib"
                    aria-label="Previous item"
                    title="Previous item (⇧↑)"
                    disabled={h().r <= 0}
                    onClick={() => stepFrame(h(), -1)}
                  >
                    <Icon name="prev" />
                  </button>
                  <span class="num kpanel-idx">{`${h().r + 1}/${h().rows.length}`}</span>
                  <button
                    type="button"
                    class="ib"
                    aria-label="Next item"
                    title="Next item (⇧↓)"
                    disabled={h().r >= h().rows.length - 1}
                    onClick={() => stepFrame(h(), 1)}
                  >
                    <Icon name="next" />
                  </button>
                </div>
              </Show>
              <span class="grow" />
              <button
                type="button"
                class="btn kpanel-sheet"
                title="Back to Sheet (Esc)"
                onClick={() => sh.back()}
              >
                <Icon name="grid" />
                <span>Sheet</span>
              </button>
            </div>
          </div>
        );
      }}
    </Show>
  );
}

// Responsive grid columns that expand surviving finalists as options are deleted/bookmarked.
function gridCols(n: number): number {
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  if (n === 4) return 2;
  if (n <= 6) return 3;
  return 4;
}

export function KnobSideBySide(props: { s: DesignScreenState }) {
  const s = props.s;
  const sh = s.sheet;
  return (
    <Show when={sh.held()}>
      {(h) => {
        const active = () => partitionCols(s, h()).active;
        return (
          <div
            class="ksbs"
            role="region"
            aria-label={`${alternativeName(h().v.alternative)} finalists`}
          >
            <Show
              when={active().length}
              fallback={
                <div class="ksbs-empty">
                  <p>No active finalists</p>
                  <button type="button" class="btn" onClick={() => sh.setKnobSide(false)}>
                    Back to list
                  </button>
                </div>
              }
            >
              <div
                class="ksbs-grid"
                style={{
                  "grid-template-columns": `repeat(${gridCols(active().length)}, minmax(0, 1fr))`,
                }}
              >
                <For each={active()}>
                  {(col) => {
                    const subj = () => subjectOf({ v: h().v, col });
                    const mark = () => s.markOf(subj());
                    const focused = () => h().col.key === col.key;
                    const cell = () => sh.cell(h().v, col);
                    return (
                      <div class="ksbs-card" classList={{ on: focused(), main: mark() === "main" }}>
                        <button
                          type="button"
                          class="ksbs-picbtn"
                          aria-label={`${alternativeName(h().v.alternative)} · ${col.label}`}
                          onClick={() => sh.focusCell(h().v, col)}
                        >
                          <Show when={cell()}>
                            {(c) => (
                              <Thumb
                                src={c().src}
                                width={c().width}
                                part={c().part}
                                class="ksbs-pic"
                                fit
                              />
                            )}
                          </Show>
                        </button>
                        <div class="ksbs-bar">
                          <span class="ksbs-lbl" title={col.label}>
                            {col.label}
                          </span>
                          <Show when={!readonly()}>
                            <div class="ksbs-acts">
                              <button
                                type="button"
                                class="ib kact star"
                                classList={{ on: mark() === "main" }}
                                aria-pressed={mark() === "main"}
                                aria-label={`Main: ${col.label}`}
                                title="Main (M)"
                                onClick={() => s.toggleMain(subj())}
                              >
                                <Icon name="star" />
                              </button>
                              <button
                                type="button"
                                class="ib kact keep"
                                aria-label={`Bookmark ${col.label}`}
                                title="Bookmark (K)"
                                onClick={() => bookmarkCol(s, h(), col)}
                              >
                                <Icon name="bookmark" />
                              </button>
                              <button
                                type="button"
                                class="ib kact del"
                                aria-label={`Delete ${col.label}`}
                                title="Delete (X)"
                                onClick={() => runFrameAction(s, "delete", { v: h().v, col })}
                              >
                                <Icon name="trash" />
                              </button>
                            </div>
                          </Show>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>
          </div>
        );
      }}
    </Show>
  );
}
