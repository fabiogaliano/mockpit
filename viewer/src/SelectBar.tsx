// What a selection in Studio can do. Icons only, since it floats over the designs
// and has to fit a phone; each says its name on hover and to a screen reader.
// Everything but archive opens a panel above the bar that says what it will send,
// and all of it goes as one reply.

import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";
import { root } from "./host.ts";
import { Icon } from "./icons.tsx";
import type { VersionStep } from "./logic.ts";
import type { SteerNote } from "./state.ts";
import { phoneLayout } from "./viewport.ts";

type Panel = "more" | "comment" | "borrow" | "group";

const list = (names: string[]) =>
  names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
const keyOf = (st: VersionStep) => `${st.variant}@${st.version}`;

export function SelectBar(props: {
  steps: VersionStep[];
  total: number;
  name: (st: VersionStep) => string;
  inUse: (st: VersionStep) => boolean;
  pic: (st: VersionStep, large?: boolean) => JSX.Element;
  // The selected variants that hang under another, which Group can take out.
  grouped: string[];
  onAll: () => void;
  onClear: () => void;
  onSave: (from: HTMLElement) => void;
  onArchive: () => void;
  onSend: (notes: SteerNote[], text: string | undefined, sent: string) => void;
  onGroup: (lead: VersionStep, variants: string[]) => void;
  onUngroup: (variants: string[]) => void;
}) {
  const [panel, setPanel] = createSignal<Panel | null>(null);
  let box: HTMLDivElement | undefined;
  createEffect(() => {
    if (!panel()) return;
    const doc = root();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setPanel(null);
    };
    const onDown = (e: PointerEvent) => {
      if (!box?.contains(e.target as Node)) setPanel(null);
    };
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("pointerdown", onDown, true);
    onCleanup(() => {
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("pointerdown", onDown, true);
    });
  });
  const steps = () => props.steps;
  const names = () => list(steps().map(props.name));
  const out = () => steps().filter((st) => !props.inUse(st)).length;
  const stay = () => steps().length - out();
  // One version of each: a variant groups as a whole.
  const heads = () =>
    steps().filter((st, i) => steps().findIndex((x) => x.variant === st.variant) === i);
  const canGroup = () => heads().length > 1 || props.grouped.length > 0;
  const open = (p: Panel) => setPanel(panel() === p ? null : p);
  const more = () => {
    if (steps().length === 1) {
      const st = steps()[0];
      const note = { variant: st.variant, version: st.version, reaction: "more" as const };
      props.onSend([note], undefined, `More like ${props.name(st)}, sent`);
    } else open("more");
  };
  const tool = (
    icon: Parameters<typeof Icon>[0]["name"],
    label: string,
    onClick: (e: MouseEvent & { currentTarget: HTMLButtonElement }) => void,
    on?: () => boolean,
    disabled?: () => boolean,
    badge?: () => number | null,
  ) => (
    <button
      type="button"
      class="ib selbar-b"
      aria-label={label}
      data-tip={label}
      aria-expanded={on ? on() : undefined}
      disabled={disabled?.()}
      onClick={onClick}
    >
      <Icon name={icon} />
      <Show when={badge?.()}>{(n) => <span class="selbar-n">{n()}</span>}</Show>
    </button>
  );
  return (
    <div class="selbar" classList={{ phone: phoneLayout() }} ref={(el) => (box = el)}>
      <Show when={panel() === "more"}>
        <MorePanel
          names={names()}
          onPick={(blend) => {
            const notes = steps().map((st) => ({
              variant: st.variant,
              version: st.version,
              reaction: "more" as const,
            }));
            props.onSend(
              notes,
              blend ? `New designs that blend ${names()}.` : `More of each of ${names()}.`,
              blend
                ? `Asked for a blend of ${steps().length}, sent`
                : `More of each of ${steps().length}, sent`,
            );
          }}
        />
      </Show>
      <Show when={panel() === "comment"}>
        <CommentPanel {...props} names={names()} onCancel={() => setPanel(null)} />
      </Show>
      <Show when={panel() === "borrow"}>
        <BorrowPanel {...props} onCancel={() => setPanel(null)} />
      </Show>
      <Show when={panel() === "group"}>
        <GroupPanel
          heads={heads()}
          grouped={props.grouped}
          pic={props.pic}
          onGroup={props.onGroup}
          onUngroup={props.onUngroup}
          onCancel={() => setPanel(null)}
        />
      </Show>
      <div class="selbar-row" role="toolbar" aria-label="Selection">
        <span class="selbar-count" role="status" aria-label={`${steps().length} selected`}>
          {phoneLayout() ? steps().length : `${steps().length} selected`}
        </span>
        {tool(
          "spark",
          steps().length > 1 ? "More like these" : "More like this",
          more,
          () => panel() === "more",
        )}
        {tool(
          "mark",
          "Comment",
          () => open("comment"),
          () => panel() === "comment",
        )}
        {tool(
          "borrow",
          steps().length > 1 ? "Borrow" : "Borrow: select two or more",
          () => open("borrow"),
          () => panel() === "borrow",
          () => steps().length < 2,
        )}
        {tool(
          "layers",
          canGroup() ? "Group" : "Group: select two or more variants",
          () => open("group"),
          () => panel() === "group",
          () => !canGroup(),
        )}
        <span class="selbar-sep" />
        {tool("move", "Move or save", (e) => {
          setPanel(null);
          props.onSave(e.currentTarget);
        })}
        {tool(
          "archive",
          !out()
            ? "Archive: in use, so they stay"
            : `Archive ${out()}${stay() ? `. ${stay()} in use stays` : ""}`,
          () => {
            setPanel(null);
            props.onArchive();
          },
          undefined,
          () => !out(),
          () => (stay() && out() ? out() : null),
        )}
        <span class="selbar-sep" />
        <Show when={steps().length < props.total}>
          {tool("selectAll", `Select all ${props.total}`, () => props.onAll())}
        </Show>
        {tool("close", "Clear selection (Esc)", () => props.onClear())}
      </div>
    </div>
  );
}

function MorePanel(props: { names: string; onPick: (blend: boolean) => void }) {
  return (
    <section class="selp" aria-label="More like these">
      <button type="button" class="selp-choice" onClick={() => props.onPick(true)}>
        Blend them
        <small>New designs that mix these</small>
      </button>
      <button type="button" class="selp-choice" onClick={() => props.onPick(false)}>
        More of each
        <small>2 or 3 new ones from every design</small>
      </button>
    </section>
  );
}

// The same notes two ways: on one sheet, or a picture at a time. Switching keeps
// what is written.
function CommentPanel(props: {
  steps: VersionStep[];
  names: string;
  name: (st: VersionStep) => string;
  pic: (st: VersionStep, large?: boolean) => JSX.Element;
  onSend: (notes: SteerNote[], text: string | undefined, sent: string) => void;
  onCancel: () => void;
}) {
  const [oneByOne, setOneByOne] = createSignal(false);
  const [at, setAt] = createSignal(0);
  const [all, setAll] = createSignal("");
  const [each, setEach] = createSignal<Record<string, string>>({});
  const many = () => props.steps.length > 1;
  const noteOf = (st: VersionStep) => each()[keyOf(st)] ?? "";
  const write = (st: VersionStep, text: string) => setEach({ ...each(), [keyOf(st)]: text });
  const here = () => props.steps[Math.min(at(), props.steps.length - 1)];
  const notes = (): SteerNote[] =>
    props.steps.flatMap((st) => {
      const text = noteOf(st).trim();
      return text ? [{ variant: st.variant, version: st.version, text }] : [];
    });
  const together = () => all().trim();
  const ready = () => !!together() || notes().length > 0;
  const send = () => {
    if (!ready()) return;
    props.onSend(
      notes(),
      together() ? `On ${props.names}: ${together()}` : undefined,
      "Comment sent",
    );
  };
  let form: HTMLFormElement | undefined;
  const fields = () => [...(form?.querySelectorAll<HTMLInputElement>(".selp-in") ?? [])];
  onMount(() => fields()[0]?.focus());
  // Enter walks to the next note and only the last one sends: a half-written set
  // of notes shouldn't leave because of a habit.
  const onEnter = () => {
    if (oneByOne() && at() < props.steps.length - 1) {
      setAt(at() + 1);
      fields()[0]?.focus();
      return;
    }
    const all = fields();
    const next = all[all.indexOf(root().activeElement as HTMLInputElement) + 1];
    if (next && !oneByOne()) next.focus();
    else send();
  };
  return (
    <form
      class="selp"
      aria-label="Comment"
      ref={(el) => (form = el)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || e.isComposing) return;
        e.preventDefault();
        onEnter();
      }}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <div class="selp-h">
        <span>{many() ? `Comment on ${props.steps.length}` : `Comment on ${props.names}`}</span>
        <Show when={many()}>
          <div class="selp-seg" role="group" aria-label="How to write">
            <button type="button" aria-pressed={!oneByOne()} onClick={() => setOneByOne(false)}>
              All together
            </button>
            <button type="button" aria-pressed={oneByOne()} onClick={() => setOneByOne(true)}>
              One at a time
            </button>
          </div>
        </Show>
      </div>
      <div class="selp-b">
        <Show
          when={!oneByOne()}
          fallback={
            <>
              <span class="selp-lab">{`${at() + 1} of ${props.steps.length}: ${props.name(here())}`}</span>
              <div class="selp-big">{props.pic(here(), true)}</div>
              <input
                class="selp-in"
                aria-label={`A note on ${props.name(here())}`}
                placeholder={`A note on ${props.name(here())}`}
                autocomplete="off"
                value={noteOf(here())}
                onInput={(e) => write(here(), e.currentTarget.value)}
              />
            </>
          }
        >
          <Show when={many()}>
            <label class="selp-lab" for="selp-all">
              About all of them
            </label>
            <input
              id="selp-all"
              class="selp-in"
              placeholder="e.g. softer eyes on these"
              autocomplete="off"
              value={all()}
              onInput={(e) => setAll(e.currentTarget.value)}
            />
            <span class="selp-lab">Just this one (optional)</span>
          </Show>
          <For each={props.steps}>
            {(st) => (
              <div class="selp-line">
                <span class="selp-th">{props.pic(st)}</span>
                <input
                  class="selp-in"
                  aria-label={`A note on ${props.name(st)}`}
                  placeholder={props.name(st)}
                  autocomplete="off"
                  value={noteOf(st)}
                  onInput={(e) => write(st, e.currentTarget.value)}
                />
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="selp-f">
        <button type="button" class="btn" onClick={props.onCancel}>
          Cancel
        </button>
        <Show when={oneByOne() && at() > 0}>
          <button type="button" class="btn" onClick={() => setAt(at() - 1)}>
            Back
          </button>
        </Show>
        <Show when={oneByOne() && at() < props.steps.length - 1}>
          <button type="button" class="btn" onClick={() => setAt(at() + 1)}>
            Next
          </button>
        </Show>
        <button type="submit" class="btn go" disabled={!ready()}>
          Send
        </button>
      </div>
    </form>
  );
}

function BorrowPanel(props: {
  steps: VersionStep[];
  name: (st: VersionStep) => string;
  pic: (st: VersionStep, large?: boolean) => JSX.Element;
  onSend: (notes: SteerNote[], text: string | undefined, sent: string) => void;
  onCancel: () => void;
}) {
  const [leadKey, setLeadKey] = createSignal(keyOf(props.steps[0]));
  const [text, setText] = createSignal("");
  const lead = () => props.steps.find((st) => keyOf(st) === leadKey()) ?? props.steps[0];
  const donors = () => props.steps.filter((st) => st !== lead());
  const send = () => {
    const what = text().trim();
    if (!what) return;
    props.onSend(
      donors().map((d) => ({
        variant: lead().variant,
        version: lead().version,
        text: what,
        borrow: { from: { variant: d.variant, version: d.version } },
      })),
      undefined,
      `Borrow into ${props.name(lead())}, sent`,
    );
  };
  return (
    <form
      class="selp"
      aria-label="Borrow"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <div class="selp-h">Which one keeps its body?</div>
      <div class="selp-b">
        <Picks
          steps={props.steps}
          name={props.name}
          pic={props.pic}
          on={lead()}
          onPick={(st) => setLeadKey(keyOf(st))}
        />
        <span class="selp-say">
          {`Takes from ${list(donors().map(props.name))} into ${props.name(lead())}`}
        </span>
        <input
          class="selp-in"
          aria-label="What to take"
          placeholder="e.g. the face"
          autocomplete="off"
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
        />
      </div>
      <div class="selp-f">
        <button type="button" class="btn" onClick={props.onCancel}>
          Cancel
        </button>
        <button type="submit" class="btn go" disabled={!text().trim()}>
          Send
        </button>
      </div>
    </form>
  );
}

function GroupPanel(props: {
  heads: VersionStep[];
  grouped: string[];
  pic: (st: VersionStep, large?: boolean) => JSX.Element;
  onGroup: (lead: VersionStep, variants: string[]) => void;
  onUngroup: (variants: string[]) => void;
  onCancel: () => void;
}) {
  const [leadKey, setLeadKey] = createSignal(keyOf(props.heads[0]));
  const lead = () => props.heads.find((st) => keyOf(st) === leadKey()) ?? props.heads[0];
  const others = () => props.heads.filter((st) => st !== lead()).map((st) => st.variant);
  return (
    <section class="selp" aria-label="Group">
      <Show when={props.heads.length > 1}>
        <div class="selp-h">Which one leads?</div>
        <div class="selp-b">
          <Picks
            steps={props.heads}
            name={(st) => st.variant}
            pic={props.pic}
            on={lead()}
            onPick={(st) => setLeadKey(keyOf(st))}
          />
        </div>
      </Show>
      <div class="selp-f">
        <Show when={props.grouped.length}>
          <button type="button" class="btn" onClick={() => props.onUngroup(props.grouped)}>
            {`Take ${list(props.grouped)} out`}
          </button>
        </Show>
        <button type="button" class="btn" onClick={props.onCancel}>
          Cancel
        </button>
        <Show when={props.heads.length > 1}>
          <button type="button" class="btn go" onClick={() => props.onGroup(lead(), others())}>
            {`Group under ${lead().variant}`}
          </button>
        </Show>
      </div>
    </section>
  );
}

function Picks(props: {
  steps: VersionStep[];
  name: (st: VersionStep) => string;
  pic: (st: VersionStep, large?: boolean) => JSX.Element;
  on: VersionStep;
  onPick: (st: VersionStep) => void;
}) {
  return (
    <div class="selp-picks" role="radiogroup">
      <For each={props.steps}>
        {(st) => (
          <button
            type="button"
            role="radio"
            aria-checked={st === props.on}
            class="selp-pick"
            onClick={() => props.onPick(st)}
          >
            <span class="selp-th">{props.pic(st)}</span>
            <span class="selp-nm">{props.name(st)}</span>
          </button>
        )}
      </For>
    </div>
  );
}
