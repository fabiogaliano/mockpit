// A design's spec: what it is for, how it works where the picture can't show it, and
// what was decided on it. An agent drafts the first two, the user corrects either by
// hand (each section its own edit, which then stands against agents), and later agents
// read all three. Decisions come from the project's decision list and are read-only
// here. Everything is text nodes. A How it works line pinned to a part is an
// annotation: numbered here, and a pin with that number on the stage while this is open.

import { createEffect, createMemo, createSignal, For, Index, on, Show } from "solid-js";
import type { DecisionLine } from "../../server/decisionList.ts";
import { type AskAnswer, MAX_SPEC, type SpecLine } from "../../server/types.ts";
import type { DesignDetail } from "./api.ts";
import { createDecisions } from "./Decisions.tsx";
import { readonly } from "./host.ts";
import type { DesignScreenState } from "./state.ts";

// A product design always offers one, empty or not: a build agent reads it. An idea
// only once something is written, or it would be one more thing nobody asked for.
export const specShown = (s: DesignScreenState) => {
  const m = s.design();
  return !!m && (!!m.spec || m.kind !== "idea");
};

export interface Annotation {
  n: number;
  part: string;
  state?: string;
  text: string;
}

// The lines pinned to a part, numbered in the order they're written.
export function annotationsOf(lines: SpecLine[] | undefined): Annotation[] {
  let n = 0;
  return (lines ?? []).flatMap((l) =>
    l.part ? [{ n: ++n, part: l.part, ...(l.state ? { state: l.state } : {}), text: l.text }] : [],
  );
}

// An annotation shows on the state it names, or on every state when it names none.
export const annotationsOn = (s: DesignScreenState): Annotation[] =>
  annotationsOf(s.design()?.spec?.behaviour).filter(
    (a) => a.state === undefined || a.state === s.activeState(),
  );

const byWho = (held: boolean) =>
  held ? "Written by you. Agents can't replace this." : "An agent's draft.";

export function Spec(props: { s: DesignScreenState }) {
  const s = props.s;
  const spec = () => s.design()?.spec;
  const held = (section: "purpose" | "behaviour") => !!spec()?.held?.includes(section);
  const writing = s.specWriting;
  const [busy, setBusy] = createSignal(false);
  const save = async (edit: { purpose: string } | { behaviour: SpecLine[] }) => {
    setBusy(true);
    const saved = await s.saveSpec(edit);
    setBusy(false);
    if (saved) s.setSpecWriting(null);
  };

  const project = () => s.design()?.project ?? null;
  const decisions = createDecisions(project);
  // A Send or an edit of the list changes the lines; the design's reload says one came.
  createEffect(
    on(
      () => s.design()?.updatedAt,
      () => void decisions.refetch(),
      { defer: true },
    ),
  );
  const lines = createMemo(() => {
    const m = s.design();
    const list = decisions.list();
    return m && list && list.project === m.project
      ? list.lines.filter((l) => !l.system && l.design === m.slug)
      : [];
  });
  const behaviour = () => spec()?.behaviour ?? [];
  const numbers = createMemo(() => {
    let n = 0;
    return behaviour().map((l) => (l.part ? ++n : null));
  });

  return (
    <div class="spec">
      <section class="spec-sec" aria-label="What it is for">
        <h4 class="spec-hd">What it is for</h4>
        <Show
          when={writing()?.section === "purpose"}
          fallback={
            <>
              <Show
                when={spec()?.purpose}
                fallback={<p class="spec-none">Not written yet. One line on what this is for.</p>}
              >
                {(text) => <p class="spec-text">{text()}</p>}
              </Show>
              <Show when={spec()?.purpose}>
                <p class="spec-by">{byWho(held("purpose"))}</p>
              </Show>
              <SectionActs
                writing={() =>
                  s.setSpecWriting({ section: "purpose", text: spec()?.purpose ?? "" })
                }
                written={!!spec()?.purpose}
                held={held("purpose")}
                busy={busy()}
                clear={() => void save({ purpose: "" })}
              />
            </>
          }
        >
          <textarea
            class="spec-input"
            aria-label="What it is for"
            rows={4}
            maxLength={MAX_SPEC}
            value={(writing() as { text: string }).text}
            onInput={(e) => s.setSpecWriting({ section: "purpose", text: e.currentTarget.value })}
            on:keydown={(e) => {
              // Esc shuts panels, and a spec half typed isn't what it's reaching for.
              if (e.key === "Escape") e.preventDefault();
            }}
            ref={(el) => queueMicrotask(() => el.focus())}
          />
          <EditActs
            busy={busy()}
            save={() => {
              const w = writing();
              if (w?.section === "purpose") void save({ purpose: w.text });
            }}
            cancel={() => s.setSpecWriting(null)}
          />
        </Show>
      </section>

      <section class="spec-sec" aria-label="How it works">
        <h4 class="spec-hd">How it works</h4>
        <Show
          when={writing()?.section === "behaviour"}
          fallback={
            <>
              <Show
                when={behaviour().length}
                fallback={
                  <p class="spec-none">
                    Not written yet. What the picture can't show: gestures, timing, what happens
                    next.
                  </p>
                }
              >
                <ul class="spec-lines">
                  <For each={behaviour()}>
                    {(l, i) => (
                      <li class="spec-line">
                        <Show when={numbers()[i()]}>
                          {(n) => (
                            <span class="spec-n" title={`Pinned to ${l.part}`}>
                              {String(n())}
                            </span>
                          )}
                        </Show>
                        <span class="spec-line-text">{l.text}</span>
                        <Show when={l.state || l.part}>
                          <span class="spec-where">
                            {[l.state, l.part].filter(Boolean).join(" · ")}
                          </span>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
                <p class="spec-by">{byWho(held("behaviour"))}</p>
              </Show>
              <SectionActs
                writing={() =>
                  s.setSpecWriting({
                    section: "behaviour",
                    lines: behaviour().length ? behaviour().map((l) => ({ ...l })) : [{ text: "" }],
                  })
                }
                written={behaviour().length > 0}
                held={held("behaviour")}
                busy={busy()}
                clear={() => void save({ behaviour: [] })}
              />
            </>
          }
        >
          <LinesEditor s={s} busy={busy()} save={(lines) => void save({ behaviour: lines })} />
        </Show>
      </section>

      <section class="spec-sec" aria-label="Decisions">
        <h4 class="spec-hd">
          Decisions
          <Show when={lines().length}>
            <span class="spec-hd-n">{String(lines().length)}</span>
          </Show>
        </h4>
        <Show
          when={lines().length}
          fallback={<p class="spec-none">Nothing decided here yet. Your answers land here.</p>}
        >
          <ul class="spec-decisions">
            <For each={lines()}>
              {(l) => <DecisionRow line={l} design={s.design() ?? undefined} />}
            </For>
          </ul>
        </Show>
      </section>
    </div>
  );
}

function SectionActs(props: {
  writing: () => void;
  written: boolean;
  held: boolean;
  busy: boolean;
  clear: () => void;
}) {
  return (
    <Show when={!readonly()}>
      <div class="spec-acts">
        <button type="button" class="btn" onClick={() => props.writing()}>
          {props.written ? "Edit" : "Write"}
        </button>
        <Show when={props.held}>
          <button
            type="button"
            class="btn"
            title="Agents can draft it again"
            disabled={props.busy}
            onClick={() => props.clear()}
          >
            Clear
          </button>
        </Show>
      </div>
    </Show>
  );
}

function EditActs(props: { busy: boolean; save: () => void; cancel: () => void }) {
  return (
    <div class="spec-acts">
      <button type="button" class="btn" disabled={props.busy} onClick={() => props.save()}>
        Save
      </button>
      <button type="button" class="btn" onClick={() => props.cancel()}>
        Cancel
      </button>
    </div>
  );
}

// How it works, line by line: each can name the state it is about and the part it is
// pinned to, chosen from what the design has.
function LinesEditor(props: {
  s: DesignScreenState;
  busy: boolean;
  save: (lines: SpecLine[]) => void;
}) {
  const s = props.s;
  const lines = () => {
    const w = s.specWriting();
    return w?.section === "behaviour" ? w.lines : [];
  };
  const set = (next: SpecLine[]) => s.setSpecWriting({ section: "behaviour", lines: next });
  const change = (i: number, patch: Partial<SpecLine>) =>
    set(
      lines().map((l, j) => {
        if (j !== i) return l;
        const next = { ...l, ...patch };
        if (!next.state) delete next.state;
        if (!next.part) delete next.part;
        return next;
      }),
    );
  const states = () => s.design()?.states ?? [];
  const partsFor = (state: string | undefined) => {
    const all = s.design()?.parts ?? [];
    const names = (state === undefined ? all : all.filter((p) => p.state === state)).flatMap((p) =>
      p.parts.map((x) => x.name),
    );
    return [...new Set(names)];
  };
  const listId = (i: number) => `spec-parts-${i}`;
  return (
    <div class="spec-edit">
      <Index each={lines()}>
        {(l, i) => (
          <div class="spec-edit-row">
            <textarea
              class="spec-input"
              aria-label={`Line ${i + 1}`}
              rows={2}
              value={l().text}
              onInput={(e) => change(i, { text: e.currentTarget.value })}
              on:keydown={(e) => {
                if (e.key === "Escape") e.preventDefault();
              }}
              ref={(el) => {
                if (i === lines().length - 1) queueMicrotask(() => el.focus());
              }}
            />
            <div class="spec-edit-where">
              <Show when={states().length}>
                <select
                  class="spec-select"
                  aria-label="State"
                  value={l().state ?? ""}
                  onChange={(e) => change(i, { state: e.currentTarget.value || undefined })}
                >
                  <option value="">Every state</option>
                  <For each={states()}>{(st) => <option value={st}>{st}</option>}</For>
                </select>
              </Show>
              <input
                class="spec-part"
                aria-label="Part"
                placeholder="Part"
                list={listId(i)}
                value={l().part ?? ""}
                onInput={(e) => change(i, { part: e.currentTarget.value.trim() || undefined })}
              />
              <datalist id={listId(i)}>
                <For each={partsFor(l().state)}>{(p) => <option value={p} />}</For>
              </datalist>
              <button
                type="button"
                class="btn spec-drop"
                aria-label={`Remove line ${i + 1}`}
                onClick={() => set(lines().filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          </div>
        )}
      </Index>
      <button type="button" class="btn spec-add" onClick={() => set([...lines(), { text: "" }])}>
        Add a line
      </button>
      <EditActs
        busy={props.busy}
        save={() =>
          props.save(
            lines()
              .map((l) => ({ ...l, text: l.text.trim() }))
              .filter((l) => l.text),
          )
        }
        cancel={() => s.setSpecWriting(null)}
      />
    </div>
  );
}

// What an opened decision shows, resolved to the question (or the alternative in use) it
// came from, so the user's own comment and write-in are there whole, and each chosen
// answer with what the agent said it is.
interface DecisionDetail {
  asked?: string;
  chose: { label: string; about?: string }[];
  kept?: string;
  not?: string;
  comment?: string;
  other?: string;
  state?: string;
}

const answerIdsOf = (a: AskAnswer | undefined): string[] =>
  a === undefined ? [] : Array.isArray(a) ? a : [a];

export function decisionDetail(
  line: DecisionLine,
  design: DesignDetail | undefined,
): DecisionDetail {
  const base = {
    kept: line.parts?.kept,
    not: line.parts?.not,
    state: line.state,
  };
  // Reworded by the user, the line is their words alone: the question it came from
  // still holds the old answer, which their rewrite replaced.
  if (line.edited) return { chose: [], ...(line.state ? { state: line.state } : {}) };
  const about = (state: string | null | undefined, alternative: string | undefined) =>
    alternative
      ? design?.alternatives.find(
          (v) => v.alternative === alternative && (state === undefined || v.state === state),
        )?.description
      : undefined;
  const [kind, designId, ...rest] = line.id.split(":");
  if (design && designId === design.id && kind === "ask") {
    const ask = design.asks.find((a) => a.id === rest.join(":"));
    if (ask) {
      const ids = answerIdsOf(ask.answer);
      return {
        ...base,
        asked: ask.text,
        chose: ask.options
          .filter((o) => ids.includes(o.id))
          .map((o) => {
            const said = about(
              ask.scope === "state" ? (ask.state ?? null) : undefined,
              o.alternative,
            );
            return { label: o.label, ...(said ? { about: said } : {}) };
          }),
        ...(ask.comment ? { comment: ask.comment } : {}),
        ...(ask.other ? { other: ask.other } : {}),
      };
    }
  }
  if (design && designId === design.id && kind === "use") {
    // State names can hold a colon ("Tapped: nudges"), so the id is matched, not split.
    const v = design.alternatives.find(
      (x) => line.id === `use:${design.id}:${x.state ?? ""}:${x.alternative}`,
    );
    const said = v?.description;
    return {
      ...base,
      asked: line.parts?.asked,
      chose: line.parts?.chose
        ? [{ label: line.parts.chose, ...(said ? { about: said } : {}) }]
        : [],
    };
  }
  // A line the user reworded keeps only their words.
  return {
    ...base,
    asked: line.parts?.asked,
    chose: line.parts?.chose ? [{ label: line.parts.chose }] : [],
    ...(line.parts?.words ? { comment: line.parts.words } : {}),
  };
}

// One line each; opened, the whole of it: the question, what was chosen and kept and
// turned down, the user's own words, and the state it was made on.
function DecisionRow(props: { line: DecisionLine; design: DesignDetail | undefined }) {
  const [open, setOpen] = createSignal(false);
  const d = createMemo(() => decisionDetail(props.line, props.design));
  const term = (label: string, text: string | undefined) => (
    <Show when={text}>
      {(t) => (
        <>
          <dt>{label}</dt>
          <dd>{t()}</dd>
        </>
      )}
    </Show>
  );
  return (
    <li class="spec-decision" classList={{ open: open() }}>
      <button
        type="button"
        class="spec-decision-hd"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        {props.line.text}
      </button>
      <Show when={open()}>
        <dl class="spec-decision-more">
          {term("Asked", d().asked)}
          <For each={d().chose}>
            {(c) => (
              <>
                <dt>Chose</dt>
                <dd>
                  {c.label}
                  <Show when={c.about}>
                    {(a) => <span class="spec-decision-about">{a()}</span>}
                  </Show>
                </dd>
              </>
            )}
          </For>
          {term("Kept", d().kept)}
          {term("Not", d().not)}
          {term("Your comment", d().comment)}
          {term("You wrote", d().other)}
          <Show when={!d().asked && !d().chose.length}>
            {term("As you wrote it", props.line.text)}
          </Show>
          {term("On", d().state)}
        </dl>
      </Show>
    </li>
  );
}
