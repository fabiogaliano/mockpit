// What stays reachable after a question is answered: the answers kept for later beside
// the design, as pills on its top edge to look at without changing anything, and the
// user's saved combos of answers. Values follow every new version by themselves; a kept
// screen doesn't, so it says how far behind it is and how to bring it along.

import { createSignal, For, Show } from "solid-js";
import type { AnswerCombo, Ask, AskOption } from "../../server/types.ts";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { answerIds, splitLabel } from "./logic.ts";
import { optionPicture } from "./Questions.tsx";
import type { DesignScreenState } from "./state.ts";
import { Thumb } from "./Thumb.tsx";

export interface KeptGroup {
  ask: Ask;
  inUse: AskOption[];
  kept: AskOption[];
}

// The answered questions on the state on stage that kept answers for later.
export function keptGroups(s: DesignScreenState): KeptGroup[] {
  return s.closedAsks("state").flatMap((ask) => {
    const chosen = answerIds(ask.answer);
    const kept = ask.options.filter((o) => s.isKept(ask, o.id) && !chosen.includes(o.id));
    if (!kept.length) return [];
    return [{ ask, kept, inUse: ask.options.filter((o) => chosen.includes(o.id)) }];
  });
}

// How many versions the screen in use gained since the kept one last changed.
function behind(s: DesignScreenState, ask: Ask, kept: AskOption, inUse: AskOption[]): number {
  const pic = optionPicture(s, ask, kept);
  const used = inUse.find((o) => o.alternative);
  if (!pic || !used?.alternative) return 0;
  const mine = s
    .alternatives()
    .find((v) => v.state === pic.state && v.alternative === used.alternative);
  if (!mine) return 0;
  const waited = s.standingFor(ask).since?.[kept.id] ?? "";
  const since = waited > pic.alternative.updatedAt ? waited : pic.alternative.updatedAt;
  return (mine.history ?? []).filter((h) => !("hidden" in h && h.hidden) && h.at > since).length;
}

export function KeptAnswers(props: { s: DesignScreenState }) {
  const s = props.s;
  return (
    <For each={keptGroups(s)}>
      {(g) => (
        <section class="keptans" aria-label={`Kept for later: ${g.ask.text}`}>
          <h4 class="keptans-hd">
            <span>{`Kept · ${g.kept.length}`}</span>
            <small>{g.ask.text}</small>
          </h4>
          <ul>
            <For each={g.kept}>{(o) => <KeptRow s={s} group={g} option={o} />}</For>
          </ul>
        </section>
      )}
    </For>
  );
}

function KeptRow(props: { s: DesignScreenState; group: KeptGroup; option: AskOption }) {
  const s = props.s;
  const ask = () => props.group.ask;
  const o = () => props.option;
  const pic = () => optionPicture(s, ask(), o());
  const screen = () => !!o().alternative;
  const late = () => (screen() ? behind(s, ask(), o(), props.group.inUse) : 0);
  const carried = () => s.isCarried(ask(), o().id);
  const inUseName = () =>
    props.group.inUse.map((x) => splitLabel(x.label).name).join(", ") || "the one in use";
  const [busy, setBusy] = createSignal(false);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    await f();
    setBusy(false);
  };
  const preview = () => s.previewOf(ask(), o().id);
  return (
    <li
      class="keptrow"
      classList={{ previewing: s.preview()?.key === preview()?.key }}
      onPointerEnter={(e) => e.pointerType === "mouse" && s.setHoveredPreview(preview())}
      onPointerLeave={(e) => e.pointerType === "mouse" && s.setHoveredPreview(null)}
    >
      <Show when={pic()} fallback={<span class="keptrow-pic empty" />}>
        {(p) => (
          <span class="keptrow-pic">
            <Thumb width={s.frameW()} class="crop" fit whole src={p().src} knobs={p().knobs} />
          </span>
        )}
      </Show>
      <div class="keptrow-col">
        <span class="keptrow-name">{splitLabel(o().label).name}</span>
        <Show when={splitLabel(o().label).sub ?? pic()?.alternative.description}>
          {(d) => <span class="keptrow-desc">{d()}</span>}
        </Show>
        <Show when={screen()}>
          <span class="keptrow-late" classList={{ due: late() > 0 && !carried() }}>
            {carried()
              ? `Changed along with ${inUseName()}`
              : late()
                ? `Missing ${late()} update${late() > 1 ? "s" : ""}`
                : "Up to date"}
          </span>
        </Show>
        <Show when={!readonly()}>
          <span class="keptrow-acts">
            {/* A screen or a component has no entry to choose: its newest is current. */}
            <Show when={!(screen() && s.product())}>
              <button
                type="button"
                class="btn"
                disabled={busy()}
                onClick={() => void run(() => s.useInstead(ask(), o()))}
              >
                {ask().multi ? "Use this too" : "Use this instead"}
              </button>
            </Show>
            <Show when={screen() && late() > 0 && !carried()}>
              <button
                type="button"
                class="btn"
                disabled={busy()}
                onClick={() => void run(() => s.updateOnce(ask(), o()))}
              >
                Update it now, once
              </button>
            </Show>
            <button
              type="button"
              class="optic optkeep on"
              aria-label={`Remove ${o().label} from kept`}
              title="Remove from kept"
              onClick={() => s.toggleKept(ask(), o())}
            >
              <Icon name="bookmark" />
            </button>
          </span>
          <Show when={screen()}>
            <fieldset class="keptrow-mode">
              <legend>{`When ${inUseName()} changes`}</legend>
              <span class="seg">
                <label>
                  <input
                    type="radio"
                    name={`carry-${ask().id}-${o().id}`}
                    checked={!carried()}
                    disabled={busy()}
                    onChange={() => void run(() => s.carryKept(ask(), o(), false))}
                  />
                  Leave it alone
                </label>
                <label>
                  <input
                    type="radio"
                    name={`carry-${ask().id}-${o().id}`}
                    checked={carried()}
                    disabled={busy()}
                    onChange={() => void run(() => s.carryKept(ask(), o(), true))}
                  />
                  Update it too
                </label>
              </span>
              <span class="keptrow-desc">
                {carried()
                  ? "Always current, but the agent makes every change twice."
                  : "It falls behind, and you can update it when you want it."}
              </span>
            </fieldset>
          </Show>
        </Show>
      </div>
    </li>
  );
}

// On the design's top edge: the answer in use and the kept ones, and the saved combos.
// Hovering one shows it; a click holds it there. Neither changes anything.
export function AnswerPills(props: { s: DesignScreenState }) {
  const s = props.s;
  const combos = () => s.combos();
  const hold = (p: ReturnType<typeof s.previewOf>) => {
    if (!p) return;
    if (s.heldPreview()?.key === p.key) s.setPreview(null);
    else s.setHeldPreview(p);
  };
  const pill = (
    key: string | undefined,
    label: string,
    p: () => ReturnType<typeof s.previewOf>,
    use?: boolean,
  ) => (
    <button
      type="button"
      class="apill"
      classList={{ on: !!key && s.preview()?.key === key, use: !!use }}
      aria-pressed={!!key && s.heldPreview()?.key === key}
      onPointerEnter={(e) => e.pointerType === "mouse" && !use && s.setHoveredPreview(p())}
      onPointerLeave={(e) => e.pointerType === "mouse" && s.setHoveredPreview(null)}
      onClick={() => (use ? s.setPreview(null) : hold(p()))}
    >
      {label}
    </button>
  );
  return (
    <Show when={keptGroups(s).length || combos().length}>
      <div class="apills" role="group" aria-label="Kept answers and combos: look without changing">
        <For each={keptGroups(s)}>
          {(g) => (
            <span class="apills-row">
              {pill(
                undefined,
                g.inUse.map((o) => splitLabel(o.label).name).join(", ") || "In use",
                () => null,
                true,
              )}
              <For each={g.kept}>
                {(o) =>
                  pill(s.previewOf(g.ask, o.id)?.key, splitLabel(o.label).name, () =>
                    s.previewOf(g.ask, o.id),
                  )
                }
              </For>
            </span>
          )}
        </For>
        <Show when={combos().length}>
          <span class="apills-row">
            <For each={combos()}>
              {(combo) => pill(`combo:${combo.name}`, combo.name, () => s.previewCombo(combo))}
            </For>
          </span>
        </Show>
        <Show when={s.preview()}>
          <span class="apills-note">Just looking, nothing changes</span>
        </Show>
      </div>
    </Show>
  );
}

// Named combinations of answers across questions: a theme is more than one answer.
export function AnswerCombos(props: { s: DesignScreenState }) {
  const s = props.s;
  const [naming, setNaming] = createSignal(false);
  const [name, setName] = createSignal("");
  const answers = () => Object.keys(s.answersNow()).length;
  const show = () => s.combos().length > 0 || (answers() > 1 && !readonly());
  async function save() {
    const n = name().trim();
    if (!n) return;
    if (await s.saveCombo(n)) {
      setNaming(false);
      setName("");
    }
  }
  return (
    <Show when={show()}>
      <section class="combos" aria-label="Saved combos">
        <h4 class="keptans-hd">
          <span>{`Combos${s.combos().length ? ` · ${s.combos().length}` : ""}`}</span>
          <small>Answers across questions, under one name</small>
        </h4>
        <ul>
          <For each={s.combos()}>{(combo) => <ComboRow s={s} combo={combo} />}</For>
        </ul>
        <Show when={!readonly() && answers() > 0}>
          <Show
            when={naming()}
            fallback={
              <button type="button" class="moreans" onClick={() => setNaming(true)}>
                <Icon name="plus" />
                Save these answers as a combo
              </button>
            }
          >
            <form
              class="combos-new"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <input
                type="text"
                maxLength={60}
                placeholder="Name it, like Warm or Quiet"
                aria-label="Combo name"
                value={name()}
                ref={(el) => queueMicrotask(() => el.focus())}
                onInput={(e) => setName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Escape") setNaming(false);
                }}
              />
              <button type="button" class="btn" onClick={() => setNaming(false)}>
                Cancel
              </button>
              <button type="submit" class="btn go" disabled={!name().trim()}>
                Save
              </button>
            </form>
          </Show>
        </Show>
      </section>
    </Show>
  );
}

function ComboRow(props: { s: DesignScreenState; combo: AnswerCombo }) {
  const s = props.s;
  const summary = () => {
    const asks = s.design()?.asks ?? [];
    return Object.entries(props.combo.answers)
      .map(([id, x]) => {
        const a = asks.find((q) => q.id === id);
        return answerIds(x)
          .map((o) => splitLabel(a?.options.find((opt) => opt.id === o)?.label ?? o).name)
          .join(", ");
      })
      .join(" · ");
  };
  const p = () => s.previewCombo(props.combo);
  const [busy, setBusy] = createSignal(false);
  return (
    <li
      class="comborow"
      classList={{ previewing: s.preview()?.key === p()?.key }}
      onPointerEnter={(e) => e.pointerType === "mouse" && s.setHoveredPreview(p())}
      onPointerLeave={(e) => e.pointerType === "mouse" && s.setHoveredPreview(null)}
    >
      <div class="keptrow-col">
        <span class="keptrow-name">
          {props.combo.name}
          <Show when={s.comboInUse(props.combo)}>
            <span class="comborow-use">In use</span>
          </Show>
        </span>
        <span class="keptrow-desc">{summary()}</span>
      </div>
      <Show when={!readonly()}>
        <span class="keptrow-acts">
          <Show when={!s.comboInUse(props.combo)}>
            <button
              type="button"
              class="btn"
              disabled={busy()}
              onClick={async () => {
                setBusy(true);
                await s.useCombo(props.combo);
                setBusy(false);
              }}
            >
              Use this combo
            </button>
          </Show>
          <button
            type="button"
            class="optic"
            aria-label={`Remove the combo ${props.combo.name}`}
            title="Remove"
            onClick={() => s.removeCombo(props.combo)}
          >
            <Icon name="close" />
          </button>
        </span>
      </Show>
    </li>
  );
}
