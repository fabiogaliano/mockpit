// Pure rules behind the mock screen — no DOM, no signals — so each one is
// unit-tested on its own (viewer/test/logic.test.ts).

import {
  type Ask,
  type AskAnswer,
  askAnswered,
  BUILTIN_ASK_ID,
  type FlowStep,
  isLive,
  type KnobConfig,
  type KnobValue,
  type Knobs,
  type MockEdit,
  type MockKind,
  type PartComment,
  type Reply,
  sameScreen,
} from "../../server/types.ts";
import type {
  CommentRow,
  DraftInput,
  HistoryRow,
  MockDetail,
  TreeNode,
  VariantView,
} from "./api.ts";
import { commentText, reactionWhere } from "./reactionRules.ts";

type MockLike = Pick<MockDetail, "asks" | "states" | "title" | "knobs">;

export const emptyDraft = (version: number): DraftInput => ({
  version,
  answers: {},
  borrowed: {},
  tuned: {},
  comments: [],
  others: {},
  notes: {},
  otherImages: {},
  noteImages: {},
});

// The asks a draft says something about: a pick, a write-in or a note.
const draftAsks = (d: DraftInput): Set<string> =>
  new Set([...Object.keys(d.answers), ...Object.keys(d.others), ...Object.keys(d.notes)]);

export const draftIsEmpty = (d: DraftInput | null): boolean => !d || sendCount(d) === 0;

// Everything one Send carries, as the count on the button. A question counts
// once however it was answered (pick, write-in, note, or a pick with a note).
export const sendCount = (d: DraftInput): number =>
  draftAsks(d).size +
  Object.keys(d.borrowed).length +
  Object.keys(d.tuned).length +
  d.comments.length;

export const answerIds = (a: AskAnswer | undefined): string[] =>
  a === undefined ? [] : Array.isArray(a) ? a : [a];

// A write-in or a note set to this text and these images. They stand
// together: the field is present while either has something (an image alone
// keeps its text as ""), and gone once both are empty.
export function setAskField(
  d: DraftInput,
  askId: string,
  field: "other" | "note",
  text: string,
  images: string[],
): DraftInput {
  const texts = { ...(field === "other" ? d.others : d.notes) };
  const imgs = { ...(field === "other" ? d.otherImages : d.noteImages) };
  if (text.trim() || images.length) texts[askId] = text;
  else delete texts[askId];
  if (images.length) imgs[askId] = images;
  else delete imgs[askId];
  return field === "other"
    ? { ...d, others: texts, otherImages: imgs }
    : { ...d, notes: texts, noteImages: imgs };
}

// Picking an option or "Other…" (option null) in a draft: single asks keep one
// of them, multi asks toggle. A write-in starts empty and only counts once it
// has text, so `otherOpen` is the viewer's "Other is ticked" before that.
export function pickInDraft(
  d: DraftInput,
  ask: Pick<Ask, "id" | "multi">,
  option: string | null,
  otherOpen: boolean,
): { draft: DraftInput; otherOpen: boolean } {
  const answers = { ...d.answers };
  const others = { ...d.others };
  const otherImages = { ...d.otherImages };
  const ids = answerIds(answers[ask.id]);
  let open = otherOpen || others[ask.id] !== undefined;
  if (option === null) {
    if (open && ask.multi) {
      delete others[ask.id];
      delete otherImages[ask.id];
      open = false;
    } else if (!open) {
      if (!ask.multi) delete answers[ask.id];
      open = true;
    }
  } else if (ask.multi) {
    const next = ids.includes(option) ? ids.filter((x) => x !== option) : [...ids, option];
    if (next.length) answers[ask.id] = next;
    else delete answers[ask.id];
  } else {
    answers[ask.id] = option;
    delete others[ask.id];
    delete otherImages[ask.id];
    open = false;
  }
  return { draft: { ...d, answers, others, otherImages }, otherOpen: open };
}

// The variant question (Q9): mock-wide, its options bound to variants.
export const isLookAsk = (ask: Ask): boolean =>
  ask.scope === "mock" && ask.options.some((o) => o.variant);

export const lookAsk = (mock: Pick<MockDetail, "asks">): Ask | undefined =>
  mock.asks.find(isLookAsk);

// --- the built-in "Which variant?" ---

type VariantRow = Pick<VariantView, "state" | "variant" | "status">;

// What the user can still choose between in a state: its live variants.
export const liveVariants = (variants: VariantRow[], state: string | null): string[] => [
  ...new Set(variants.filter((v) => v.state === state && isLive(v.status)).map((v) => v.variant)),
];

// A state needs the built-in ask when it has a real choice (2+ live variants)
// and no agent ask that applies there binds every one of them; otherwise the
// user would have to Accept variants one by one.
export function needsBuiltinAsk(
  asks: Ask[],
  variants: VariantRow[],
  state: string | null,
): boolean {
  const live = liveVariants(variants, state);
  if (live.length < 2) return false;
  return !asks.some(
    (a) =>
      (a.scope === "mock" || (a.scope === "state" && a.state === state)) &&
      live.every((name) => a.options.some((o) => o.variant === name)),
  );
}

// The built-in asks a mock shows, under the ids the server reserves for them.
// One mock-wide ask when every state needs one and the live variant names line
// up, so the user answers once; one per needing state otherwise. Option ids
// are variant names, as the server's reply handling expects.
export function builtinAsks(
  mock: Pick<MockDetail, "asks" | "states"> & { closedAt?: string | null },
  variants: VariantRow[],
): Ask[] {
  // Resolving the mock closed its choices too (server/types.ts builtinAskIds).
  if (mock.closedAt) return [];
  const states = mock.states.length ? mock.states : [null];
  const needing = states.filter((st) => needsBuiltinAsk(mock.asks, variants, st));
  if (!needing.length) return [];
  const ask = (names: string[], state: string | null): Ask => ({
    id: state === null ? BUILTIN_ASK_ID : `${BUILTIN_ASK_ID}:${state}`,
    text: "Which variant?",
    scope: state === null ? "mock" : "state",
    ...(state === null ? {} : { state }),
    options: names.map((v) => ({ id: v, label: v, variant: v })),
    at: "",
  });
  const first = liveVariants(variants, needing[0]);
  const sameNames = (st: string | null) => {
    const names = liveVariants(variants, st);
    return names.length === first.length && names.every((n) => first.includes(n));
  };
  if (needing.length === states.length && states.every(sameNames)) return [ask(first, null)];
  return needing.map((st) => ask(liveVariants(variants, st), st));
}

// The latest version any variant of the mock reached.
export const mockVersion = (variants: Pick<VariantView, "version">[]): number =>
  Math.max(1, ...variants.map((v) => v.version));

// A variant as it stood at mock version `n`: its newest version not after n.
export function frameVersion(variant: Pick<VariantView, "version" | "history">, n: number): number {
  const versions = variant.history?.map((h) => h.version) ?? [variant.version];
  const fit = versions.filter((v) => v <= n);
  return fit.length ? Math.max(...fit) : Math.min(...versions);
}

export const historyRow = (variant: VariantView, version: number): HistoryRow | undefined =>
  variant.history?.find((h) => h.version === version);

// Every state an ask is shown on, in the mock's order: its own state; each
// state holding its part; for a mock-wide ask that picks between variants,
// each state with one of those variants; any other mock-wide ask, every state.
export function askStates(
  ask: Ask,
  mock: Pick<MockDetail, "states" | "parts">,
  variants: Pick<VariantView, "state" | "variant">[],
): (string | null)[] {
  const all: (string | null)[] = mock.states.length ? mock.states : [null];
  if (ask.scope === "state" && ask.state !== undefined) {
    return all.includes(ask.state) ? [ask.state] : all.slice(0, 1);
  }
  if (ask.scope === "part" && ask.part) {
    const holding = all.filter(
      (s) => mock.parts.find((p) => p.state === s)?.parts.some((p) => p.name === ask.part) ?? false,
    );
    if (holding.length) return holding;
    return ask.state !== undefined && all.includes(ask.state) ? [ask.state] : all.slice(0, 1);
  }
  const named = new Set(ask.options.flatMap((o) => (o.variant ? [o.variant] : [])));
  if (named.size) {
    const having = all.filter((s) => variants.some((v) => v.state === s && named.has(v.variant)));
    if (having.length) return having;
  }
  return all;
}

// The state an ask shows on: its own, else the first state holding its part.
export function askState(
  ask: Ask,
  mock: Pick<MockDetail, "states" | "parts">,
  active: string | null,
): string | null {
  if (ask.scope === "state" && ask.state !== undefined) return ask.state;
  if (ask.scope === "part" && ask.part) {
    const has = (s: string | null) =>
      mock.parts.find((p) => p.state === s)?.parts.some((p) => p.name === ask.part) ?? false;
    if (has(active)) return active;
    const first = mock.parts.find((p) => p.parts.some((x) => x.name === ask.part));
    if (first) return first.state;
  }
  return active ?? mock.states[0] ?? null;
}

export function partLabel(mock: Pick<MockDetail, "parts">, name: string): string {
  for (const s of mock.parts) {
    const p = s.parts.find((x) => x.name === name);
    if (p) return p.label ?? p.name;
  }
  return name;
}

// The question's heading in the panel ("Variant", "Trim", "Versions open").
export function askName(ask: Ask, mock: Pick<MockDetail, "parts">): string {
  if (isLookAsk(ask)) return "Variant";
  if (ask.scope === "part" && ask.part) return partLabel(mock, ask.part);
  if (ask.scope === "state" && ask.state) return ask.state;
  return "Question";
}

// The same topic, lowercased, as the reply summary names it.
function askTopic(ask: Ask): string {
  if (isLookAsk(ask)) return "variant";
  if (ask.scope === "part" && ask.part) return ask.part;
  if (ask.scope === "state" && ask.state) return ask.state.toLowerCase();
  return "answer";
}

// An answer to no stored ask is a built-in one, named like the ask it stood for.
function builtinTopic(id: string): string {
  if (id === BUILTIN_ASK_ID) return "variant";
  if (id.startsWith(`${BUILTIN_ASK_ID}:`)) return id.slice(BUILTIN_ASK_ID.length + 1).toLowerCase();
  return id;
}

export interface MixOption {
  part: string;
  variant: string;
}

// What the user already chose, so Mix can never contradict it. A borrow brings
// a part over whole, with every dimension its look varies on, so:
// - an answered part ask decides its part;
// - an answered mock- or state-wide ask whose pick sets a part knob
//   ("notes.tone") decides that part, and a tuned part knob does too;
// - picks or tuning on global knobs are no conflict: knobs apply to every look
//   alike;
// - an answer in words (a pick with no `set`, or an Other… write-in) may touch
//   any part and the viewer cannot see which, so it closes Mix in its scope
//   (every state for a mock-wide ask).
// A decided part is never offered, and a borrow made before the choice is
// dropped (`pruneMix`). The variant question is borrowing's own input and counts for nothing.
export interface MixSettled {
  decided: { part: string; state: string | null }[];
  // States Mix is closed in; null closes every state.
  closed: (string | null)[];
}
export function mixSettled(
  asks: Ask[],
  answers: Record<string, AskAnswer>,
  others: Record<string, string> = {},
  tuned: Record<string, KnobValue> = {},
): MixSettled {
  const out: MixSettled = { decided: [], closed: [] };
  for (const path of Object.keys(tuned)) {
    const part = knobPart(path);
    if (part !== null) out.decided.push({ part, state: null });
  }
  for (const ask of asks) {
    if (ask.options.some((o) => o.variant)) continue;
    const state = ask.scope === "mock" ? null : (ask.state ?? null);
    const said = answers[ask.id] !== undefined || others[ask.id] !== undefined;
    if (ask.scope === "part") {
      if (said && ask.part) out.decided.push({ part: ask.part, state });
      continue;
    }
    let worded = others[ask.id] !== undefined;
    for (const id of answerIds(answers[ask.id])) {
      const paths = Object.keys(ask.options.find((o) => o.id === id)?.set ?? {});
      if (!paths.length) worded = true;
      for (const path of paths) {
        const part = knobPart(path);
        if (part !== null) out.decided.push({ part, state });
      }
    }
    if (worded) out.closed.push(state);
  }
  return out;
}

const inScope = (scope: string | null, state: string | null) => scope === null || scope === state;

// Whether Mix may offer `part` in `state`.
export const mixAllowed = (settled: MixSettled, part: string, state: string | null): boolean =>
  !settled.closed.some((c) => inScope(c, state)) &&
  !settled.decided.some((d) => d.part === part && inScope(d.state, state));

// The borrows still allowed. A borrow names no state, so it goes once any state
// showing the part forbids it; `statesOf` lists the states that show a part.
export function pruneMix(
  mix: Record<string, string>,
  settled: MixSettled,
  statesOf: (part: string) => (string | null)[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [part, variant] of Object.entries(mix)) {
    const states = statesOf(part);
    if ((states.length ? states : [null]).every((st) => mixAllowed(settled, part, st)))
      out[part] = variant;
  }
  return out;
}

// Which answer took a borrow of `part` away, so the viewer can say so: the
// first ask whose answer alone forbids it, or null when a tuned value did.
export function mixDropCause(
  asks: Ask[],
  answers: Record<string, AskAnswer>,
  others: Record<string, string>,
  part: string,
  statesOf: (part: string) => (string | null)[],
): Ask | null {
  for (const ask of asks) {
    const alone = mixSettled([ask], answers, others);
    if (!(part in pruneMix({ [part]: "" }, alone, statesOf))) return ask;
  }
  return null;
}

// A part this close to the frame's own size is the whole composition, not a
// piece of it: borrowing it would swap the look.
const WHOLE_FRAME = 0.9;
function wrapsFrame(report: PartsReport, name: string): boolean {
  return report.parts.some(
    (p) =>
      p.name === name &&
      p.box.w >= report.width * WHOLE_FRAME &&
      p.box.h >= report.height * WHOLE_FRAME,
  );
}

// Mix (D6): borrow a part from another look. A part qualifies when another
// look renders it differently from the picked one in the same state; each such
// look is one option. Nothing to mix until a look is picked, and never what the
// user already chose (`mixSettled`) or a part that wraps either whole frame.
//
// "Differently" is judged from what the frames report (the viewer never holds
// the html of a sandboxed surface): the part's instances, labels and sizes. A
// restyle that keeps every box the same size is not seen as a difference, and
// a frame that has not reported yet offers nothing until it does.
export function mixOptions(
  mock: Pick<MockDetail, "asks" | "states">,
  variants: Pick<VariantView, "state" | "variant" | "status" | "parts">[],
  look: string | null,
  reportOf: (state: string | null, variant: string) => PartsReport | undefined,
  settled: MixSettled = { decided: [], closed: [] },
): MixOption[] {
  const ask = lookAsk(mock);
  if (!ask || !look) return [];
  const looks = ask.options.flatMap((o) => (o.variant ? [o.variant] : []));
  const out: MixOption[] = [];
  const seen = new Set<string>();
  for (const state of mock.states.length ? mock.states : [null]) {
    const inState = variants.filter(
      (v) => v.state === state && isLive(v.status) && looks.includes(v.variant),
    );
    const picked = inState.find((v) => v.variant === look);
    const mine = reportOf(state, look);
    if (!picked || !mine) continue;
    for (const part of picked.parts) {
      const base = partShape(mine, part);
      if (base === undefined || !mixAllowed(settled, part, state) || wrapsFrame(mine, part))
        continue;
      for (const v of inState) {
        const key = `${part}\u0000${v.variant}`;
        if (v === picked || seen.has(key) || !v.parts.includes(part)) continue;
        const donor = reportOf(state, v.variant);
        if (!donor || wrapsFrame(donor, part)) continue;
        const other = partShape(donor, part);
        if (other === undefined || other === base) continue;
        seen.add(key);
        out.push({ part, variant: v.variant });
      }
    }
  }
  return out;
}

// A part as a frame draws it, reduced to what can be compared across looks:
// how many instances, their labels, and their sizes to the pixel.
function partShape(report: PartsReport | undefined, name: string): string | undefined {
  if (!report) return undefined;
  return report.parts
    .filter((p) => p.name === name)
    .map((p) => `${p.label}:${Math.round(p.box.w)}x${Math.round(p.box.h)}:${p.visible ? 1 : 0}`)
    .sort()
    .join("|");
}

const optionLabels = (ask: Ask, answer: AskAnswer): string =>
  answerIds(answer)
    .map((id) => ask.options.find((o) => o.id === id)?.label ?? id)
    .map((l) => l.toLowerCase())
    .join(" + ");

function fmtValue(v: KnobValue): string {
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// One Send as a line in the thread: "Sent · Which variant? quiet · trim below · body from dark".
export function summarizeReply(
  reply: Pick<
    Reply,
    "answers" | "borrowed" | "tuned" | "comments" | "text" | "verdict" | "others" | "notes"
  >,
  mock: Pick<MockDetail, "asks">,
): string {
  const parts: string[] = [];
  for (const ask of mock.asks) {
    const answer = reply.answers[ask.id];
    const other = reply.others?.[ask.id];
    const said = [
      answer !== undefined ? optionLabels(ask, answer) : "",
      other !== undefined ? (other ? `“${other}”` : "an image") : "",
    ].filter(Boolean);
    if (said.length) parts.push(`${askTopic(ask)} ${said.join(" + ")}`);
    else if (reply.notes?.[ask.id] !== undefined) parts.push(`${askTopic(ask)} noted`);
  }
  for (const [id, answer] of Object.entries(reply.answers)) {
    if (!mock.asks.some((a) => a.id === id))
      parts.push(`${builtinTopic(id)} ${answerIds(answer).join(" + ")}`);
  }
  const borrowed = Object.entries(reply.borrowed).map(([part, v]) => `${part} from ${v}`);
  if (borrowed.length) parts.push(borrowed.join(", "));
  const tuned = Object.entries(reply.tuned).map(([k, v]) => `${k} ${fmtValue(v)}`);
  if (tuned.length) parts.push(`tuned ${tuned.join(", ")}`);
  const reacted = reply.comments.filter((c) => c.reaction).length;
  const n = reply.comments.length - reacted;
  if (n) parts.push(`${n} comment${n === 1 ? "" : "s"}`);
  if (reacted) parts.push(`${reacted} reaction${reacted === 1 ? "" : "s"}`);
  if (reply.verdict) parts.push(`${reply.verdict.kind} ${reply.verdict.variant}`);
  if (reply.text) parts.push(`“${reply.text}”`);
  return parts.length ? `Sent · ${parts.join(" · ")}` : "Sent";
}

// Q6: a draft made on an older version moves to the new one. Picks whose ask
// and options still exist carry over; the rest are dropped and flagged.
export function carryOver(
  draft: DraftInput,
  mock: Pick<MockDetail, "asks" | "knobs">,
  variants: Pick<VariantView, "variant" | "parts" | "knobs">[],
  toVersion: number,
): { draft: DraftInput; flagged: string[] } {
  const names = new Set(variants.map((v) => v.variant));
  const answers: Record<string, AskAnswer> = {};
  const flagged: string[] = [];
  const known = <T>(byAsk: Record<string, T>) =>
    Object.fromEntries(Object.entries(byAsk).filter(([id]) => mock.asks.some((a) => a.id === id)));
  for (const [id, answer] of Object.entries(draft.answers)) {
    const ask = mock.asks.find((a) => a.id === id);
    const ok =
      ask !== undefined &&
      answerIds(answer).every((oid) => {
        const opt = ask.options.find((o) => o.id === oid);
        return opt !== undefined && (!opt.variant || names.has(opt.variant));
      });
    if (ok) answers[id] = answer;
    else flagged.push(id);
  }
  const mix: Record<string, string> = {};
  for (const [part, variant] of Object.entries(draft.borrowed)) {
    if (variants.some((v) => v.variant === variant && v.parts.includes(part))) mix[part] = variant;
  }
  const paths = new Set([
    ...Object.keys(mock.knobs),
    ...variants.flatMap((v) => Object.keys(v.knobs ?? {})),
  ]);
  const tuned: Record<string, KnobValue> = {};
  for (const [k, v] of Object.entries(draft.tuned)) if (paths.has(k)) tuned[k] = v;
  const allParts = new Set(variants.flatMap((v) => v.parts));
  const comments = draft.comments.filter(
    (c) => (c.part === null || allParts.has(c.part)) && (!c.variant || names.has(c.variant)),
  );
  return {
    draft: {
      version: toVersion,
      answers,
      borrowed: mix,
      tuned,
      comments,
      others: known(draft.others),
      notes: known(draft.notes),
      otherImages: known(draft.otherImages),
      noteImages: known(draft.noteImages),
    },
    flagged,
  };
}

// Hover and click both ask the frame "what part is here?" and the replies come
// back by ref. Only the latest hover counts (an older one is stale motion); every
// click and every mark is answered once.
export function createHitRefs() {
  let n = 0;
  let hover = 0;
  const clicks = new Set<number>();
  const marks = new Set<number>();
  return {
    hover(): number {
      hover = ++n;
      return hover;
    },
    click(): number {
      const ref = ++n;
      clicks.add(ref);
      return ref;
    },
    mark(): number {
      const ref = ++n;
      marks.add(ref);
      return ref;
    },
    resolve(ref: unknown): "hover" | "click" | "mark" | null {
      if (typeof ref !== "number") return null;
      if (clicks.delete(ref)) return "click";
      if (marks.delete(ref)) return "mark";
      return ref === hover ? "hover" : null;
    },
    leave() {
      hover = 0;
    },
  };
}

// What a frame reports about its parts, already copied out as plain data.
export interface PartBox {
  name: string;
  label: string;
  box: { x: number; y: number; w: number; h: number };
  visible: boolean;
  depth: number;
  order: number;
}
export interface PartsReport {
  version: number;
  parts: PartBox[];
  // The document box (frame width × body height) that mark offsets are
  // normalized against, the same box the bridge's hit-test uses.
  width: number;
  height: number;
  scroll: { x: number; y: number };
  // The document's scroll width: past `width`, the design overflows its frame.
  scrollW: number;
}

// The part an answer changed, from the parts report before and after it took
// effect: first, in document order, a part that appeared, vanished or swapped
// (its visible count changed); else the deepest part whose size changed, so a
// card that grew wins over the column that grew around it. Moves alone don't
// count: everything below a grown part moves with it.
export function changedPart(prev: PartsReport, next: PartsReport): string | null {
  const shown = (r: PartsReport) => {
    const by = new Map<string, PartBox[]>();
    for (const p of r.parts) {
      if (!p.visible) continue;
      const list = by.get(p.name) ?? [];
      list.push(p);
      by.set(p.name, list);
    }
    for (const list of by.values()) list.sort((a, b) => a.order - b.order);
    return by;
  };
  const before = shown(prev);
  const after = shown(next);
  const names = [
    ...new Set([...next.parts, ...prev.parts].sort((a, b) => a.order - b.order).map((p) => p.name)),
  ];
  for (const name of names) {
    if ((before.get(name)?.length ?? 0) !== (after.get(name)?.length ?? 0)) return name;
  }
  let best: { name: string; depth: number } | null = null;
  for (const [name, list] of after) {
    const old = before.get(name) ?? [];
    const grew = list.some(
      (p, i) =>
        Math.abs(p.box.w - (old[i]?.box.w ?? 0)) > 2 ||
        Math.abs(p.box.h - (old[i]?.box.h ?? 0)) > 2,
    );
    const depth = Math.max(...list.map((p) => p.depth));
    if (grew && (!best || depth > best.depth)) best = { name, depth };
  }
  return best?.name ?? null;
}

export const frameKey = (state: string | null, variant: string) => `${state ?? ""}\u0000${variant}`;

// A reloading frame keeps its window, so its old document can still report.
export const reportIsCurrent = (loaded: number, reported: unknown): boolean => reported === loaded;

// The value a knob starts at before anyone tunes it.
export function knobDefault(cfg: KnobConfig): KnobValue | undefined {
  if (typeof cfg === "number" || typeof cfg === "boolean" || typeof cfg === "string") return cfg;
  if (Array.isArray(cfg)) return cfg[0];
  switch (cfg.type) {
    case "slider":
    case "toggle":
      return cfg.value;
    case "select": {
      if (cfg.value !== undefined) return cfg.value;
      const first = cfg.options[0];
      return typeof first === "string" ? first : first?.value;
    }
    case "color":
    case "text":
    case "image":
      return cfg.value;
    case "pad":
      return { x: cfg.x?.[0] ?? 0, y: cfg.y?.[0] ?? 0 };
    case "spring":
    case "easing":
      return cfg;
  }
  return undefined;
}

// The knob values a frame should show for the draft: declared defaults (a part
// knob inheriting the global it refines), then what was already sent, then
// answered knob-set options, then tuned values.
export function draftKnobValues(
  mock: Pick<MockDetail, "asks" | "knobs" | "settled">,
  variantKnobs: Knobs | undefined,
  draft: DraftInput | null,
): Record<string, KnobValue> {
  return resolveKnobs({
    knobs: { ...mock.knobs, ...variantKnobs },
    asks: mock.asks,
    answers: draft?.answers ?? {},
    tuned: draft?.tuned ?? {},
    settled: mock.settled,
  });
}

export interface ThreadRow {
  who: "agent" | "you";
  at: string;
  text: string;
  quote?: string;
  delivered?: boolean;
  ownerGone?: boolean;
  id: string;
  // A reply's comments, each with where it was left ("title · At rest").
  comments?: { where: string; text: string }[];
  // A reply's notes, each under the question it qualifies.
  notes?: { ask: string; text: string }[];
  // The images a reply attached, each under its question.
  images?: { ask: string; ids: string[] }[];
}

export const commentWhere = (c: Pick<PartComment, "part" | "state">): string =>
  c.state ? `${c.part ?? "page"} · ${c.state}` : (c.part ?? "page");

// The thread (D8): agent publishes (from version history) and the comment log,
// oldest first. An agent's ask or reply right after a publish reads as one row:
// "published #1 · asked 4", or "published Dark #3" over the agent's message. A
// version is named as the version bar names it, with its state when there are several.
export function threadRows(
  comments: CommentRow[],
  variants: StepSource[],
  mock: Pick<MockDetail, "asks">,
): ThreadRow[] {
  const states = [...new Set(variants.map((v) => v.state))];
  type Event =
    | { kind: "publish"; at: string; label: string; id: string }
    | { kind: "comment"; at: string; c: CommentRow };
  const events: Event[] = [
    ...states.flatMap((state) => {
      const named = variants.filter((v) => v.state === state).length > 1;
      return versionSteps(variants, state).map(
        (st): Event => ({
          kind: "publish",
          at: st.at,
          label:
            states.length > 1 && state !== null
              ? `${state}, ${versionName(st, named)}`
              : versionName(st, named),
          id: `${state ?? ""}:${st.variant}@${st.version}`,
        }),
      );
    }),
    ...comments.map((c): Event => ({ kind: "comment", at: c.createdAt, c })),
  ].sort((a, b) => a.at.localeCompare(b.at) || (a.kind === "publish" ? -1 : 1));
  const rows: ThreadRow[] = [];
  let lastPublish: ThreadRow | null = null;
  for (const e of events) {
    if (e.kind === "publish") {
      const row: ThreadRow = {
        who: "agent",
        at: e.at,
        text: `published ${e.label}`,
        id: e.id,
      };
      rows.push(row);
      lastPublish = row;
      continue;
    }
    const c = e.c;
    if (c.author === "user" || c.author === "surface") {
      const reply = c.kind === "reply" ? c.payload : undefined;
      const text = reply?.closed
        ? closedLine(reply.closed.dismissed.length)
        : reply?.edited
          ? editedLine(reply.edited)
          : reply
            ? summarizeReply(reply, mock)
            : c.text || "Sent";
      const row: ThreadRow = {
        who: "you",
        at: c.createdAt,
        text,
        delivered: c.delivered,
        ...(c.ownerGone ? { ownerGone: true } : {}),
        id: c.id,
      };
      if (reply?.comments.length) {
        row.comments = reply.comments.map((x) => ({
          where: x.reaction ? reactionWhere(x) : commentWhere(x),
          text: commentText(x),
        }));
      }
      const notes = Object.entries(reply?.notes ?? {}).filter(([, text]) => text);
      if (notes.length) {
        row.notes = notes.map(([id, text]) => ({
          ask: mock.asks.find((a) => a.id === id)?.text ?? id,
          text,
        }));
      }
      const attached = [
        ...Object.entries(reply?.otherImages ?? {}),
        ...Object.entries(reply?.noteImages ?? {}),
      ];
      if (attached.length) {
        row.images = attached.map(([id, ids]) => ({
          ask: mock.asks.find((a) => a.id === id)?.text ?? id,
          ids,
        }));
      }
      rows.push(row);
      lastPublish = null;
      continue;
    }
    // An agent's message needs no word of its own: the row already says "agent".
    const suffix = c.kind === "ask" ? `asked ${c.text.split("\n").filter(Boolean).length}` : "";
    const quote = c.kind === "ask" ? undefined : c.text;
    if (lastPublish && lastPublish === rows[rows.length - 1]) {
      if (suffix) lastPublish.text += ` · ${suffix}`;
      if (quote) lastPublish.quote = quote;
      lastPublish.at = c.createdAt;
    } else {
      rows.push({ who: "agent", at: c.createdAt, text: suffix, quote, id: c.id });
    }
    lastPublish = null;
  }
  return rows;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  return `${d} days ago`;
}

export const openAsks = (mock: Pick<MockDetail, "asks">): Ask[] =>
  mock.asks.filter((a) => !askAnswered(a) && !a.dismissed);

// A resolution in the thread: what it closed.
const KIND_NAMES: Record<MockKind, string> = {
  page: "Pages",
  component: "Components",
  sketch: "Sketches",
};

// A move made from Home, as the thread lists it.
export const editedLine = (e: MockEdit): string =>
  [
    e.kind ? `Moved to ${KIND_NAMES[e.kind]}` : "",
    e.area !== undefined ? (e.area ? `Area ${e.area}` : "No area") : "",
  ]
    .filter(Boolean)
    .join(" · ");

export const closedLine = (dismissed: number): string =>
  dismissed
    ? `Closed · ${dismissed} ${dismissed === 1 ? "question" : "questions"} left unanswered`
    : "Closed";

// A question the user still owes: open on the server and not answered in the
// draft. A write-in with text or a note alone answers it.
export const unanswered = (mock: MockLike, draft: DraftInput | null): Ask[] =>
  openAsks(mock).filter(
    (a) =>
      !answerIds(draft?.answers[a.id]).length &&
      draft?.others[a.id] === undefined &&
      draft?.notes[a.id] === undefined,
  );

// The box a part occupies in a frame's document: its deepest visible instance.
export function partBox(
  report: Pick<PartsReport, "parts"> | undefined,
  name: string | null | undefined,
) {
  if (!report || !name) return undefined;
  return report.parts
    .filter((p) => p.name === name && p.visible)
    .sort((a, b) => b.depth - a.depth || a.order - b.order)[0]?.box;
}

// --- Tune (D4): which knob value is in force, and where a change lands ---

// What a knob's value depends on: the knobs declared for the variant on stage,
// the asks (an answered knob-set option sets values), the drafted answers, the
// user's tuned values, and what earlier replies settled.
export interface KnobContext {
  knobs: Knobs;
  asks: Ask[];
  answers: Record<string, AskAnswer>;
  tuned: Record<string, KnobValue>;
  settled: Record<string, KnobValue>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// "body.size" → "body"; a global knob ("size") belongs to no part.
export const knobPart = (path: string): string | null => {
  const dot = path.indexOf(".");
  return dot < 0 ? null : path.slice(0, dot);
};

// A part knob that refines a global one ("body.size" ↔ "size") follows it until
// tuned itself, so tuning the look's size moves every part that did not opt out.
export function inheritsFrom(path: string, knobs: Knobs): string | undefined {
  const part = knobPart(path);
  if (part === null) return undefined;
  const name = path.slice(part.length + 1);
  return !name.includes(".") && name in knobs ? name : undefined;
}

const discrete = (cfg: KnobConfig): boolean =>
  typeof cfg === "boolean" ||
  (typeof cfg === "object" &&
    !Array.isArray(cfg) &&
    (cfg.type === "select" || cfg.type === "toggle"));

// A discrete knob an ask already decides (every option sets exactly this knob):
// moving it answers the ask instead of adding a second, competing value.
export function knobAsk(path: string, knobs: Knobs, asks: Ask[]): Ask | undefined {
  const cfg = knobs[path];
  if (cfg === undefined || !discrete(cfg)) return undefined;
  return asks.find(
    (a) =>
      !a.multi &&
      a.options.length > 0 &&
      a.options.every((o) => o.set && Object.keys(o.set).length === 1 && path in o.set),
  );
}

// Values set by the answered knob-set options, later asks winning.
function answerSets(asks: Ask[], answers: Record<string, AskAnswer>): Record<string, KnobValue> {
  const out: Record<string, KnobValue> = {};
  for (const ask of asks) {
    for (const id of answerIds(answers[ask.id])) {
      Object.assign(out, ask.options.find((o) => o.id === id)?.set ?? {});
    }
  }
  return out;
}

// Every knob's value in force: tuned, else set by a drafted answer, else
// settled by an earlier reply, else inherited from the global it refines, else
// its declared default. Paths a tuned value or an answer names without a
// declaration still pass through.
export function resolveKnobs(ctx: KnobContext): Record<string, KnobValue> {
  const sets = answerSets(ctx.asks, ctx.answers);
  const out: Record<string, KnobValue> = { ...ctx.settled, ...sets, ...ctx.tuned };
  const visit = (path: string): KnobValue | undefined => {
    if (path in ctx.tuned) return ctx.tuned[path];
    if (path in sets) return sets[path];
    if (path in ctx.settled) return ctx.settled[path];
    const from = inheritsFrom(path, ctx.knobs);
    if (from !== undefined) return visit(from);
    const cfg = ctx.knobs[path];
    return cfg === undefined ? undefined : knobDefault(cfg);
  };
  for (const path of Object.keys(ctx.knobs)) {
    const v = visit(path);
    if (v !== undefined) out[path] = v;
  }
  return out;
}

// The value a knob shows when the user has not tuned it: what an answer set,
// or the global it inherits, or its declared default.
export function untunedValue(path: string, ctx: KnobContext): KnobValue | undefined {
  const tuned = { ...ctx.tuned };
  delete tuned[path];
  return resolveKnobs({ ...ctx, tuned })[path];
}

export type TuneWrite =
  | { kind: "answer"; ask: Ask; option: string }
  | { kind: "tuned"; path: string; value: KnobValue | undefined };

// Where moving a knob lands. A value back at its untuned value removes it, so
// the "N tuned" count and the Tune dot only ever count real changes.
export function tuneWrite(path: string, value: KnobValue, ctx: KnobContext): TuneWrite {
  const ask = knobAsk(path, ctx.knobs, ctx.asks);
  const option = ask?.options.find((o) => same(o.set?.[path], value));
  if (ask && option) return { kind: "answer", ask, option: option.id };
  return {
    kind: "tuned",
    path,
    value: same(value, untunedValue(path, ctx)) ? undefined : value,
  };
}

// The components Tune can select: "Look" (the page and its global knobs), then
// each part that has knobs or an ask, in the order the states first show them.
// A part with neither has nothing to tune or answer.
export interface TuneComponent {
  part: string | null;
  label: string;
  paths: string[];
}
export function tuneComponents(
  mock: Pick<MockDetail, "asks" | "parts">,
  knobs: Knobs,
  // Slot paths (a slot's knob is its part's name): tuned under that part.
  slots: string[] = [],
  // Parts another look draws differently: selectable to borrow them.
  borrowable: string[] = [],
): TuneComponent[] {
  const paths = Object.keys(knobs);
  const partOf = (p: string) => (slots.includes(p) ? p : knobPart(p));
  const out: TuneComponent[] = [
    { part: null, label: "Whole design", paths: paths.filter((p) => partOf(p) === null) },
  ];
  const names: string[] = [];
  for (const s of mock.parts)
    for (const p of s.parts) if (!names.includes(p.name)) names.push(p.name);
  for (const p of paths) {
    const part = partOf(p);
    if (part !== null && !names.includes(part)) names.push(part);
  }
  for (const name of names) {
    // The slot's fill first, then the part's own knobs.
    const own = paths
      .filter((p) => partOf(p) === name)
      .sort((a, b) => Number(b === name) - Number(a === name));
    const asked = mock.asks.some((a) => a.scope === "part" && a.part === name);
    if (own.length || asked || borrowable.includes(name))
      out.push({ part: name, label: name, paths: own });
  }
  return out;
}

// Tiers, no modes: the Tune tab exists only when the agent gave it something.
// Knobs count where the stage would show them (the mock's, or any variant's in
// the state on stage, so hovering an option never blinks the tab); a marked
// part (or a part ask) counts in any state, as Tune's selector walks parts
// across states and each takes comments.
export function tuneVisible(
  mock: Pick<MockDetail, "knobs" | "parts" | "asks">,
  stateVariants: Pick<VariantView, "knobs">[],
): boolean {
  if (Object.keys(mock.knobs).length) return true;
  if (stateVariants.some((v) => Object.keys(v.knobs ?? {}).length)) return true;
  if (mock.asks.some((a) => a.scope === "part")) return true;
  return mock.parts.some((p) => p.parts.length > 0);
}

// Copy hands the agent what was tuned, one `path: value` per line.
export const tunedLines = (tuned: Record<string, KnobValue>): string =>
  Object.entries(tuned)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("\n");

// Color knobs are drawn by tunekit in this (trusted) document as swatch
// backgrounds; a "color" that is really an image reference would make the
// viewer fetch an agent-chosen URL, so such a value is shown as text instead.
export const safeColor = (v: unknown): boolean =>
  typeof v === "string" && !/(url|image|image-set|element|cross-fade|paint)\s*\(/i.test(v);

// --- pins ---

// A part's question pin sits just past the part box's top-right corner, its
// middle on the box's top edge, so it never covers what the part draws there
// (a right-aligned label runs to that corner). Without room on the right it
// sits above the corner instead.
// `edge` keeps the pin (and, under a finger, its wider hit area) inside the
// overlay, which clips.
export function partPinSpot(
  box: { x: number; y: number; w: number; h: number },
  width: number,
  size = 22,
  edge = 2,
): { x: number; y: number } {
  const right = box.x + box.w;
  if (right + 2 + size <= width - edge) {
    return { x: right + 2, y: Math.max(edge, box.y - size / 2) };
  }
  return {
    x: Math.max(edge, Math.min(width - edge - size, right - size / 2)),
    y: Math.max(edge, box.y - size - 2),
  };
}

// A picture of a page shrunk into an option card: the page fills the card's
// width (never a band at the side), the picture is as tall as the page at that
// scale up to `cap` (never a band underneath), and a focused part is centred.
export interface ThumbFit {
  s: number;
  x: number;
  y: number;
  // The picture box, in viewer px.
  h: number;
  // The frame element, in document px.
  frameH: number;
}
export function fitThumb(
  w: number,
  cap: number,
  docH: number | null,
  focus: { x: number; y: number; w: number; h: number } | null,
  frameW: number,
): ThumbFit {
  if (!w || !cap) return { s: w / frameW || 0.1, x: 0, y: 0, h: cap, frameH: 640 };
  const doc = docH && docH > 0 ? docH : null;
  const fill = w / frameW;
  if (!focus) {
    const h = doc ? Math.min(cap, Math.floor(doc * fill)) : cap;
    return { s: fill, x: 0, y: 0, h, frameH: doc ?? h / fill };
  }
  const pad = 36;
  const fx = Math.max(0, focus.x - pad);
  const fy = Math.max(0, focus.y - pad);
  const fw = Math.min(frameW - fx, focus.w + pad * 2);
  const fh = focus.h + pad * 2;
  const s = Math.max(fill, Math.min(w / fw, cap / fh, 1));
  const tall = doc ? doc * s : Number.POSITIVE_INFINITY;
  const h = Math.min(cap, Math.floor(tall));
  const x = Math.min(0, Math.max(-fx * s + (w - fw * s) / 2, w - frameW * s));
  const y = Math.min(0, Math.max(-fy * s + (h - fh * s) / 2, h - tall));
  return { s, x, y, h, frameH: doc ?? fy + h / s };
}

export interface PinSpot {
  index: number;
  x: number;
  y: number;
}

// Pins that want the same spot (every mock- and state-wide question wants the
// frame's top-left corner; two asks can share a part) step right along the
// row until they no longer touch.
export function layoutPins(pins: PinSpot[], size = 22, gap = 6): PinSpot[] {
  const placed: PinSpot[] = [];
  const step = size + gap;
  for (const pin of pins) {
    let x = pin.x;
    const clash = () =>
      placed.some((p) => Math.abs(p.x - x) < step && Math.abs(p.y - pin.y) < size);
    while (clash()) x += step;
    placed.push({ index: pin.index, x, y: pin.y });
  }
  return placed;
}

// --- marks (D11): comments placed anywhere on the render ---

export interface MarkPin {
  // 1-based among the draft's marks, so a pin keeps its number across states.
  n: number;
  // Index in draft.comments.
  index: number;
  part: string | null;
  text: string;
  // Document px.
  x: number;
  y: number;
  // Past the first step of the chain: the part it was left on is gone.
  moved: boolean;
  // The stage width it was placed at, when the stage is at another width now:
  // the page may have reflowed under it.
  placedAt: number | null;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const isBox = (b: unknown): b is [number, number, number, number] =>
  Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === "number" && Number.isFinite(v));

// Where a mark sits in the document now (Q11). The host cannot run selectors or
// match text inside the frame, so of the chain part → key → selector → quote →
// last box only the two ends apply: on the part's live box (at the same
// relative spot) while the part is there, else on the box it was left on,
// flagged as possibly moved. Offsets are read against the current document box,
// so a page that only grew taller keeps the pin inside its part.
export function anchorPoint(
  c: Pick<PartComment, "part" | "anchor">,
  report: Pick<PartsReport, "parts" | "width" | "height">,
): { x: number; y: number; moved: boolean } | null {
  const a = c.anchor;
  if (!a) return null;
  const box = isBox(a.box) ? a.box : null;
  const at =
    a.offset && a.offset.every(Number.isFinite)
      ? { x: a.offset[0] * report.width, y: a.offset[1] * report.height }
      : box
        ? { x: box[0] + box[2] / 2, y: box[1] + box[3] / 2 }
        : null;
  if (!at) return null;
  if (c.part === null) return { ...at, moved: false };
  const live = partBox(report, c.part);
  if (!live) return { ...at, moved: true };
  const rx = box && box[2] > 0 ? clamp01((at.x - box[0]) / box[2]) : 0.5;
  const ry = box && box[3] > 0 ? clamp01((at.y - box[1]) / box[3]) : 0.5;
  return { x: live.x + rx * live.w, y: live.y + ry * live.h, moved: false };
}

// The mark pins on stage for one state, numbered across the whole draft.
export function markPins(
  comments: PartComment[],
  state: string | null,
  report: Pick<PartsReport, "parts" | "width" | "height"> | undefined,
): MarkPin[] {
  const out: MarkPin[] = [];
  let n = 0;
  comments.forEach((c, index) => {
    if (!c.anchor) return;
    n++;
    if (c.state !== state || !report) return;
    const p = anchorPoint(c, report);
    const w = c.anchor.width;
    const placedAt = w && Math.round(w) !== Math.round(report.width) ? w : null;
    if (p) out.push({ n, index, part: c.part, text: c.text, ...p, placedAt });
  });
  return out;
}

// The number the next mark gets.
export const nextMark = (comments: PartComment[]): number =>
  comments.filter((c) => c.anchor).length + 1;

// --- the decision flow: across mocks, review, keys and swipes ---

export interface AreaGroup<T> {
  // null: the rows no area claims, shown last under no heading.
  area: string | null;
  rows: T[];
}

// Areas in the project's order (`edit --area-order`), then the ones it leaves
// out, alphabetical.
export function orderAreas(names: Iterable<string>, order: string[]): string[] {
  const rank = new Map(order.map((a, i) => [a, i]));
  return [...new Set(names)].sort(
    (a, b) =>
      (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) ||
      (rank.has(a) ? 0 : a.localeCompare(b)),
  );
}

// Home's rows under the areas the project named, in its area order, in their
// own order within each. With no area anywhere there is one unheaded group, so
// a project that never names one looks as it did before areas.
export function groupByArea<T>(
  rows: T[],
  areaOf: (row: T) => string | null | undefined,
  order: string[] = [],
): AreaGroup<T>[] {
  const named = new Map<string, T[]>();
  const rest: T[] = [];
  for (const row of rows) {
    const area = areaOf(row);
    if (!area) rest.push(row);
    else if (named.has(area)) named.get(area)!.push(row);
    else named.set(area, [row]);
  }
  if (named.size === 0) return [{ area: null, rows }];
  const groups: AreaGroup<T>[] = orderAreas(named.keys(), order).map((area) => ({
    area,
    rows: named.get(area)!,
  }));
  return rest.length ? [...groups, { area: null, rows: rest }] : groups;
}

// Where a mock stands, read off what mockpit already holds, for its card on
// Home; null says nothing worth a word (one variant, nothing asked or chosen).
// A resolved mock gets none: Home fades it instead.
export type MockStatus =
  | { kind: "open"; n: number }
  | { kind: "changed" }
  | { kind: "decided" }
  | { kind: "exploring" };

export function mockStatus(
  node: Pick<TreeNode, "open" | "states" | "variants" | "inUse" | "closedAt">,
): MockStatus | null {
  if (node.closedAt) return null;
  if (node.open > 0) return { kind: "open", n: node.open };
  // A variant in use at an older version than its latest: the agent moved on
  // from what the user chose, and the choice wants a look again.
  const changed = node.variants.some(
    (v) => v.status === "inUse" && v.inUseVersion !== undefined && v.version > v.inUseVersion,
  );
  if (changed) return { kind: "changed" };
  if (node.states.every((st) => node.inUse.some((u) => u.state === st))) {
    return { kind: "decided" };
  }
  // Several designs of one screen still in play.
  const live = node.variants.filter((v) => isLive(v.status));
  if (node.states.some((st) => live.filter((v) => v.state === st).length > 1)) {
    return { kind: "exploring" };
  }
  return null;
}

// How far a mock has come, as one number: every variant's version summed, so
// any publish (a new version or a new variant) raises it. Home's "new" dot
// compares it against the last one this browser opened.
export const versionStamp = (variants: { version: number }[]): number =>
  variants.reduce((n, v) => n + v.version, 0);

// A code path cut from the left to its last two segments, the end that says
// which piece it is: "apps/onni/src/spaces/food" → "…/spaces/food".
export function shortSource(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : path;
}

// A flow's area is obvious only when every screen it walks is in the same one.
export function flowArea(
  steps: FlowStep[],
  areaOf: (slug: string) => string | null | undefined,
): string | null {
  const areas = new Set(steps.map((x) => areaOf(x.mock) ?? null));
  const [only] = areas;
  return areas.size === 1 ? (only ?? null) : null;
}

type QueueMock = { slug: string; open: number; createdAt: string };

// An agent publishes mocks in the order it wants them answered, so the queue
// runs oldest first. Most recently updated would put the last mock asked on
// first: the reverse of the agent's plan.
export const queueOrder = <T extends QueueMock>(mocks: T[]): T[] =>
  [...mocks].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.slug.localeCompare(b.slug));

// The next mock that still owes answers after `current` in queue order (or
// before it, for `dir` -1), wrapping around; never `current` itself. With no
// current mock (Home), the first one owed.
export function nextOwedMock<T extends QueueMock>(
  mocks: T[],
  current: string | null,
  dir: 1 | -1 = 1,
): T | null {
  const order = queueOrder(mocks);
  const at = current === null ? -1 : order.findIndex((m) => m.slug === current);
  const n = order.length;
  for (let k = 1; k <= n; k++) {
    const i = at < 0 ? (dir === 1 ? k - 1 : n - k) : (((at + dir * k) % n) + n) % n;
    const m = order[i];
    if (m.slug !== current && m.open > 0) return m;
  }
  return null;
}

export type FlowKey =
  | { kind: "pick"; n: number }
  | { kind: "step"; by: 1 | -1 }
  | { kind: "primary" }
  | { kind: "mock"; by: 1 | -1 }
  | { kind: "situation"; by: 1 | -1 }
  | { kind: "clear" };

// What a key does on the mock screen, or null when it isn't ours. Keys typed
// into a field stay the field's; Enter on a focused button stays the button's
// (its own click); a chord with ⌘/Ctrl/Alt belongs to the browser.
export function flowKey(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  typing: boolean;
  onControl: boolean;
}): FlowKey | null {
  if (e.metaKey || e.ctrlKey || e.altKey || e.typing) return null;
  if (/^[1-9]$/.test(e.key)) return { kind: "pick", n: Number(e.key) - 1 };
  switch (e.key) {
    case "ArrowRight":
      return { kind: "step", by: 1 };
    case "ArrowLeft":
      return { kind: "step", by: -1 };
    case "ArrowDown":
      return e.onControl ? null : { kind: "situation", by: 1 };
    case "ArrowUp":
      return e.onControl ? null : { kind: "situation", by: -1 };
    case "]":
      return { kind: "mock", by: 1 };
    case "[":
      return { kind: "mock", by: -1 };
    case "Escape":
      return { kind: "clear" };
    case "Enter":
      return e.onControl ? null : { kind: "primary" };
  }
  return null;
}

// --- the stage on any screen: device width, layout, zoom ---

// The widths a design is judged at. Desktop is the stage's historical width and
// what every thumbnail renders at; the others are the devices the viewer itself
// is checked on, so a mock can be read at the width it will ship to.
export const DEVICE_WIDTHS = [
  { label: "Phone", w: 390 },
  { label: "Tablet", w: 744 },
  { label: "Desktop", w: 820 },
  { label: "Wide", w: 1280 },
] as const;
export const DESKTOP_W = 820;
const PHONE_MAX = 600;
const TABLET_MAX = 900;

// A touch screen opens a mock at the device width it can show at true size
// (a phone at Phone, an iPad mini portrait at Tablet); a mouse at desktop width.
export const defaultDeviceWidth = (winW: number, coarse: boolean): number => {
  if (!coarse || winW > TABLET_MAX) return DESKTOP_W;
  return winW <= PHONE_MAX ? DEVICE_WIDTHS[0].w : DEVICE_WIDTHS[1].w;
};

// A design wider than its frame (a board laid out for a desktop, opened at
// phone width) is cut off on both sides when it centers itself. Unless the user
// picked the width, the stage steps up to the next offered one, shrunk to fit,
// until the design fits or the widest is reached. Only a report measured at
// this width counts: one from before the last step would step twice.
export function overflowWidth(frameW: number, r: PartsReport | undefined): number | null {
  if (!r || r.width !== frameW || r.scrollW <= frameW + 1) return null;
  return DEVICE_WIDTHS.find((d) => d.w > frameW)?.w ?? null;
}

// A width remembered in storage counts only if it is still one we offer, or
// one the mock itself asks to be judged at.
export function readDeviceWidth(raw: string | null, declared: number[] = []): number | null {
  const n = Number(raw);
  return DEVICE_WIDTHS.some((d) => d.w === n) || declared.includes(n) ? n : null;
}

// The kind of screen a width is drawn for, by the same breakpoints the
// default width is picked by.
export type WidthKind = "phone" | "tablet" | "desktop";
export const widthKind = (w: number): WidthKind =>
  w <= PHONE_MAX ? "phone" : w < DESKTOP_W ? "tablet" : "desktop";

// The widest of two or more desktop widths: Wide, not a second Desktop.
export function wideWidth(widths: readonly number[]): number | null {
  const desktop = widths.filter((w) => widthKind(w) === "desktop");
  return desktop.length > 1 ? Math.max(...desktop) : null;
}

// A device width by name where it is one we know ("Phone 390"), else its px.
export const widthLabel = (w: number): string => {
  const d = DEVICE_WIDTHS.find((x) => x.w === w);
  return d ? d.label : `${w}`;
};

// Every width on the canvas in the mock's order, the live one in its place
// (or first, when the user picked one the mock does not name). "All widths"
// on a mock that names none lays out the viewer's own; a phone shows one page.
export function boardWidths(
  named: readonly number[],
  frameW: number,
  zoom: Zoom,
  phone: boolean,
): number[] {
  const declared = phone
    ? []
    : named.length || zoom !== "all"
      ? [...named]
      : DEVICE_WIDTHS.map((d) => d.w);
  return declared.includes(frameW) ? declared : [frameW, ...declared];
}

// Inspect zooms between fitting the screen and twice the design's size; the
// canvas also zooms out to "all", every width side by side.
export type Zoom = "fit" | "all" | number;
export const MAX_ZOOM = 2;
export const clampZoom = (z: number, fit: number): number =>
  Math.max(Math.min(fit, 1), Math.min(MAX_ZOOM, Number.isFinite(z) ? z : fit));

// Keeps the point under the pinch's midpoint still while the scale changes:
// `scroll` and `mid` are in the scroller's px at scale z0, the result at z1.
export const zoomScroll = (scroll: number, mid: number, z0: number, z1: number): number =>
  Math.max(0, ((scroll + mid) * z1) / z0 - mid);

// --- versions as the user counts them ---

// One exact version of one variant: what the stage shows, what Use this puts
// in use.
export interface VersionRef {
  variant: string;
  version: number;
}
export const sameVersion = (a: VersionRef | null | undefined, b: VersionRef | null | undefined) =>
  !!a && !!b && a.variant === b.variant && a.version === b.version;

// Every version of every variant in a state, in the order they were published:
// `n` is its place in that timeline, which the version arrows walk. The user
// never reads `n`, only the agent's own number (versionName).
export interface VersionStep extends VersionRef {
  n: number;
  postId: string;
  at: string;
  prompt?: string;
  hidden: boolean;
  kinds: string[];
  forkedFrom?: VersionRef;
}

type StepSource = Pick<
  VariantView,
  "postId" | "state" | "variant" | "version" | "updatedAt" | "history" | "surfaces" | "forkedFrom"
>;

export function versionSteps(variants: StepSource[], state: string | null): VersionStep[] {
  const rows = variants
    .filter((v) => v.state === state)
    .flatMap((v, order) => {
      const history = v.history?.length
        ? v.history
        : [{ version: v.version, at: v.updatedAt, surfaceKinds: v.surfaces.map((x) => x.kind) }];
      return history.map((h) => ({
        order,
        step: {
          n: 0,
          variant: v.variant,
          version: h.version,
          postId: v.postId,
          at: h.at,
          ...("prompt" in h && h.prompt ? { prompt: h.prompt } : {}),
          hidden: "hidden" in h && h.hidden === true,
          kinds: h.surfaceKinds as string[],
          ...(v.forkedFrom ? { forkedFrom: v.forkedFrom } : {}),
        },
      }));
    });
  rows.sort(
    (a, b) =>
      a.step.at.localeCompare(b.step.at) || a.order - b.order || a.step.version - b.step.version,
  );
  return rows.map((r, i) => ({ ...r.step, n: i + 1 }));
}

// A version as the user reads it: the agent's own number, so "Dark #2" is the
// agent's dark@2, with the variant's name in front when its state has others.
export const versionName = (ref: VersionRef, named: boolean): string =>
  named
    ? `${ref.variant.charAt(0).toUpperCase()}${ref.variant.slice(1)} #${ref.version}`
    : `#${ref.version}`;

export const stepFor = (steps: VersionStep[], ref: VersionRef | null | undefined) =>
  ref ? steps.find((x) => sameVersion(x, ref)) : undefined;

// The next or previous version to show from `ref`, passing over hidden ones.
export function neighbourStep(
  steps: VersionStep[],
  ref: VersionRef | null,
  by: 1 | -1,
): VersionStep | null {
  const at = steps.findIndex((x) => sameVersion(x, ref));
  for (let i = at + by; i >= 0 && i < steps.length; i += by) {
    if (!steps[i].hidden) return steps[i];
  }
  return null;
}

// The versions a state's history draws: one line per variant, starting one
// column right of the version it was forked from (or at the left), its
// versions in order along it. Columns and rows are grid cells; edges join a
// version to the next one shown on its line, and a line's first to its fork.
export interface HistoryCell {
  step: VersionStep;
  col: number;
  row: number;
}
export interface HistoryLayout {
  cells: HistoryCell[];
  edges: { from: HistoryCell; to: HistoryCell }[];
  cols: number;
  rows: number;
}

export function historyLayout(steps: VersionStep[]): HistoryLayout {
  const lines = new Map<string, VersionStep[]>();
  for (const st of [...steps].sort((a, b) => a.version - b.version)) {
    const line = lines.get(st.variant) ?? [];
    line.push(st);
    lines.set(st.variant, line);
  }
  // Lines in the order their first version appears, so a fork comes after
  // the line it branched from.
  const order = [...lines.keys()].sort(
    (a, b) => lines.get(a)![0].n - lines.get(b)![0].n || a.localeCompare(b),
  );
  const cells: HistoryCell[] = [];
  const edges: HistoryLayout["edges"] = [];
  const at = (ref: VersionRef) => cells.find((c) => sameVersion(c.step, ref));
  order.forEach((variant, row) => {
    const line = lines.get(variant)!;
    const fork = line[0].forkedFrom;
    // A fork from a version no longer shown starts beside the nearest one before it.
    const parent = fork
      ? (at(fork) ??
        cells
          .filter((c) => c.step.variant === fork.variant && c.step.version <= fork.version)
          .at(-1))
      : undefined;
    let col = parent ? parent.col + 1 : 0;
    let prev = parent;
    for (const st of line) {
      const cell = { step: st, col, row };
      cells.push(cell);
      if (prev) edges.push({ from: prev, to: cell });
      prev = cell;
      col++;
    }
  });
  return {
    cells,
    edges,
    cols: Math.max(0, ...cells.map((c) => c.col + 1)),
    rows: order.length,
  };
}

// --- flows ---

// The flow the bar walks on a screen: the one the user came through when the
// screen is a step of it, else the first that has it.
export function flowFor<F extends { name: string; steps: FlowStep[] }>(
  flows: F[],
  screen: FlowStep,
  cameThrough: string | null,
): F | null {
  const has = (f: F) => f.steps.some((x) => sameScreen(x, screen));
  return flows.find((f) => f.name === cameThrough && has(f)) ?? flows.find(has) ?? null;
}

// Where a design's data-goto points: "next" / "prev" along the steps, else
// "<mock>:<state>" (or a bare "<mock>", its first state) of this project.
// Anything else, a URL included, points nowhere.
export function gotoTarget(
  to: string,
  steps: FlowStep[],
  at: number,
  statesOf: (slug: string) => (string | null)[] | undefined,
): FlowStep | null {
  const word = to.trim();
  if (word === "next" || word === "prev") return steps[at + (word === "next" ? 1 : -1)] ?? null;
  const colon = word.indexOf(":");
  const mock = (colon < 0 ? word : word.slice(0, colon)).trim();
  const states = mock ? statesOf(mock) : undefined;
  if (!states?.length) return null;
  if (colon < 0) return { mock, state: states[0] };
  const state = word.slice(colon + 1).trim();
  return states.includes(state) ? { mock, state } : null;
}

// The width a mock is designed at: its first declared one, else a desktop's.
export const designWidth = (node: Pick<TreeNode, "widths">): number => node.widths[0] ?? 1280;

export interface ScreenPicture {
  postId: string;
  surface: number;
  version: number;
  embedsKey?: string;
  inUse: boolean;
}

// What a screen (one state of a mock) looks like now: the version in use, else
// its newest live version, else its newest of any; null when it has nothing
// that renders as a picture.
export function screenPicture(
  node: Pick<TreeNode, "inUse" | "variants">,
  state: string | null,
): ScreenPicture | null {
  const inState = node.variants.filter((v) => v.state === state);
  const use = node.inUse.find((u) => u.state === state);
  const used = use && inState.find((v) => v.variant === use.variant);
  const newest = (vs: typeof inState) =>
    vs.reduce<(typeof inState)[number] | undefined>(
      (a, b) => (!a || b.updatedAt > a.updatedAt ? b : a),
      undefined,
    );
  const v = used ?? newest(inState.filter((x) => isLive(x.status))) ?? newest(inState);
  if (!v || v.surface < 0) return null;
  return {
    postId: v.postId,
    surface: v.surface,
    version: used && use ? use.version : v.version,
    ...(v.embedsKey ? { embedsKey: v.embedsKey } : {}),
    inUse: !!used,
  };
}
