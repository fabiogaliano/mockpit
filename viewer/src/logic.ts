// Pure rules behind the mock screen — no DOM, no signals — so each one is
// unit-tested on its own (viewer/test/logic.test.ts).

import type {
  Ask,
  AskAnswer,
  KnobConfig,
  KnobValue,
  Knobs,
  PartComment,
  Reply,
} from "../../server/types.ts";
import type { CommentRow, DraftInput, HistoryRow, MockDetail, VariantView } from "./api.ts";

type MockLike = Pick<MockDetail, "asks" | "states" | "title" | "knobs">;

export const emptyDraft = (version: number): DraftInput => ({
  version,
  answers: {},
  mix: {},
  tuned: {},
  comments: [],
});

export const draftIsEmpty = (d: DraftInput | null): boolean =>
  !d ||
  (!Object.keys(d.answers).length &&
    !Object.keys(d.mix).length &&
    !Object.keys(d.tuned).length &&
    !d.comments.length);

// Everything one Send carries, as the count on the button.
export const sendCount = (d: DraftInput): number =>
  Object.keys(d.answers).length +
  Object.keys(d.mix).length +
  Object.keys(d.tuned).length +
  d.comments.length;

export const answerIds = (a: AskAnswer | undefined): string[] =>
  a === undefined ? [] : Array.isArray(a) ? a : [a];

// The Look ask (Q9): mock-wide, its options bound to variants.
export const isLookAsk = (ask: Ask): boolean =>
  ask.scope === "mock" && ask.options.some((o) => o.variant);

export const lookAsk = (mock: Pick<MockDetail, "asks">): Ask | undefined =>
  mock.asks.find(isLookAsk);

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

// The question's heading in the panel ("Look", "Trim", "Versions open").
export function askName(ask: Ask, mock: Pick<MockDetail, "parts">): string {
  if (isLookAsk(ask)) return "Look";
  if (ask.scope === "part" && ask.part) return partLabel(mock, ask.part);
  if (ask.scope === "state" && ask.state) return ask.state;
  return "Question";
}

// The same topic, lowercased, as the reply summary names it.
function askTopic(ask: Ask): string {
  if (isLookAsk(ask)) return "look";
  if (ask.scope === "part" && ask.part) return ask.part;
  if (ask.scope === "state" && ask.state) return ask.state.toLowerCase();
  return "answer";
}

export interface MixOption {
  part: string;
  variant: string;
}

// Mix (D6): borrow a part from another look. A part qualifies when another
// look renders it differently from the picked one in the same state; each such
// look is one option. Nothing to mix until a look is picked.
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
): MixOption[] {
  const ask = lookAsk(mock);
  if (!ask || !look) return [];
  const looks = ask.options.flatMap((o) => (o.variant ? [o.variant] : []));
  const out: MixOption[] = [];
  const seen = new Set<string>();
  for (const state of mock.states.length ? mock.states : [null]) {
    const inState = variants.filter(
      (v) => v.state === state && v.status !== "archived" && looks.includes(v.variant),
    );
    const picked = inState.find((v) => v.variant === look);
    if (!picked) continue;
    const mine = reportOf(state, look);
    for (const part of picked.parts) {
      const base = partShape(mine, part);
      if (base === undefined) continue;
      for (const v of inState) {
        const key = `${part}\u0000${v.variant}`;
        if (v === picked || seen.has(key) || !v.parts.includes(part)) continue;
        const other = partShape(reportOf(state, v.variant), part);
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

// A Mix borrow that replaces what an answered part ask decided: askId → the
// look whose part wins instead.
export function overriddenAsks(
  asks: Ask[],
  answers: Record<string, AskAnswer>,
  mix: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ask of asks) {
    if (ask.scope !== "part" || !ask.part || answers[ask.id] === undefined) continue;
    if (mix[ask.part]) out[ask.id] = mix[ask.part];
  }
  return out;
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

// One Send as a line in the thread: "Sent · look quiet · trim below · mix body · dark's".
export function summarizeReply(
  reply: Pick<Reply, "answers" | "mix" | "tuned" | "comments" | "text" | "decision">,
  mock: Pick<MockDetail, "asks">,
): string {
  const parts: string[] = [];
  for (const ask of mock.asks) {
    const answer = reply.answers[ask.id];
    if (answer !== undefined) parts.push(`${askTopic(ask)} ${optionLabels(ask, answer)}`);
  }
  for (const [id, answer] of Object.entries(reply.answers)) {
    if (!mock.asks.some((a) => a.id === id)) parts.push(`${id} ${answerIds(answer).join(" + ")}`);
  }
  const mix = Object.entries(reply.mix).map(([part, variant]) => `${part} · ${variant}'s`);
  if (mix.length) parts.push(`mix ${mix.join(", ")}`);
  const tuned = Object.entries(reply.tuned).map(([k, v]) => `${k} ${fmtValue(v)}`);
  if (tuned.length) parts.push(`tuned ${tuned.join(", ")}`);
  const n = reply.comments.length;
  if (n) parts.push(`${n} comment${n === 1 ? "" : "s"}`);
  if (reply.decision) parts.push(`${reply.decision.kind} ${reply.decision.variant}`);
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
  for (const [part, variant] of Object.entries(draft.mix)) {
    if (variants.some((v) => v.variant === variant && v.parts.includes(part))) mix[part] = variant;
  }
  const paths = new Set([
    ...Object.keys(mock.knobs),
    ...variants.flatMap((v) => Object.keys(v.knobs ?? {})),
  ]);
  const tuned: Record<string, KnobValue> = {};
  for (const [k, v] of Object.entries(draft.tuned)) if (paths.has(k)) tuned[k] = v;
  const allParts = new Set(variants.flatMap((v) => v.parts));
  const comments = draft.comments.filter((c) => c.part === null || allParts.has(c.part));
  return { draft: { version: toVersion, answers, mix, tuned, comments }, flagged };
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
// knob inheriting the global it refines), then answered knob-set options, then
// tuned values.
export function draftKnobValues(
  mock: Pick<MockDetail, "asks" | "knobs">,
  variantKnobs: Knobs | undefined,
  draft: DraftInput | null,
): Record<string, KnobValue> {
  return resolveKnobs({
    knobs: { ...mock.knobs, ...variantKnobs },
    asks: mock.asks,
    answers: draft?.answers ?? {},
    tuned: draft?.tuned ?? {},
  });
}

export interface ThreadRow {
  who: "agent" | "you";
  at: string;
  text: string;
  quote?: string;
  seen?: boolean;
  id: string;
  // A reply's comments, each with where it was left ("title · At rest").
  comments?: { where: string; text: string }[];
}

export const commentWhere = (c: Pick<PartComment, "part" | "state">): string =>
  c.state ? `${c.part ?? "page"} · ${c.state}` : (c.part ?? "page");

// The thread (D8): agent publishes (from version history) and the comment log,
// oldest first. An agent's ask or reply right after a publish reads as one row:
// "published v1 · asked 4", "published v3 · replied:".
export function threadRows(
  comments: CommentRow[],
  variants: Pick<VariantView, "history" | "version" | "updatedAt">[],
  mock: Pick<MockDetail, "asks">,
): ThreadRow[] {
  const published = new Map<number, string>();
  for (const v of variants) {
    for (const h of v.history ?? [{ version: v.version, at: v.updatedAt }]) {
      const at = published.get(h.version);
      if (!at || h.at < at) published.set(h.version, h.at);
    }
  }
  type Event =
    | { kind: "publish"; at: string; version: number }
    | { kind: "comment"; at: string; c: CommentRow };
  const events: Event[] = [
    ...[...published].map(([version, at]): Event => ({ kind: "publish", at, version })),
    ...comments.map((c): Event => ({ kind: "comment", at: c.createdAt, c })),
  ].sort((a, b) => a.at.localeCompare(b.at) || (a.kind === "publish" ? -1 : 1));
  const rows: ThreadRow[] = [];
  let lastPublish: ThreadRow | null = null;
  for (const e of events) {
    if (e.kind === "publish") {
      const row: ThreadRow = {
        who: "agent",
        at: e.at,
        text: `published v${e.version}`,
        id: `v${e.version}`,
      };
      rows.push(row);
      lastPublish = row;
      continue;
    }
    const c = e.c;
    if (c.author === "user" || c.author === "surface") {
      const reply = c.kind === "reply" ? c.payload : undefined;
      const text = reply ? summarizeReply(reply, mock) : c.text || "Sent";
      const row: ThreadRow = { who: "you", at: c.createdAt, text, seen: c.seen, id: c.id };
      if (reply?.comments.length) {
        row.comments = reply.comments.map((x) => ({ where: commentWhere(x), text: x.text }));
      }
      rows.push(row);
      lastPublish = null;
      continue;
    }
    const suffix =
      c.kind === "ask" ? `asked ${c.text.split("\n").filter(Boolean).length}` : "replied:";
    const quote = c.kind === "ask" ? undefined : c.text;
    if (lastPublish && lastPublish === rows[rows.length - 1] && !lastPublish.text.includes(" · ")) {
      lastPublish.text += ` · ${suffix}`;
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
  mock.asks.filter((a) => a.answer === undefined);

// A question the user still owes: open on the server and not picked in the draft.
export const unanswered = (mock: MockLike, draft: DraftInput | null): Ask[] =>
  openAsks(mock).filter((a) => !answerIds(draft?.answers[a.id]).length);

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
// the asks (an answered knob-set option sets values), the answers so far, and
// the user's tuned values.
export interface KnobContext {
  knobs: Knobs;
  asks: Ask[];
  answers: Record<string, AskAnswer>;
  tuned: Record<string, KnobValue>;
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

// Every knob's value in force: tuned, else set by an answer, else inherited
// from the global it refines, else its declared default. Paths a tuned value or
// an answer names without a declaration still pass through.
export function resolveKnobs(ctx: KnobContext): Record<string, KnobValue> {
  const sets = answerSets(ctx.asks, ctx.answers);
  const out: Record<string, KnobValue> = { ...sets, ...ctx.tuned };
  const visit = (path: string): KnobValue | undefined => {
    if (path in ctx.tuned) return ctx.tuned[path];
    if (path in sets) return sets[path];
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
): TuneComponent[] {
  const paths = Object.keys(knobs);
  const out: TuneComponent[] = [
    { part: null, label: "Look", paths: paths.filter((p) => knobPart(p) === null) },
  ];
  const names: string[] = [];
  for (const s of mock.parts)
    for (const p of s.parts) if (!names.includes(p.name)) names.push(p.name);
  for (const p of paths) {
    const part = knobPart(p);
    if (part !== null && !names.includes(part)) names.push(part);
  }
  for (const name of names) {
    const own = paths.filter((p) => knobPart(p) === name);
    const asked = mock.asks.some((a) => a.scope === "part" && a.part === name);
    if (own.length || asked) out.push({ part: name, label: name, paths: own });
  }
  return out;
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
    if (p) out.push({ n, index, part: c.part, text: c.text, ...p });
  });
  return out;
}

// The number the next mark gets.
export const nextMark = (comments: PartComment[]): number =>
  comments.filter((c) => c.anchor).length + 1;
