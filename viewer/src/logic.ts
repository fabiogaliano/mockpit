// Pure rules behind the mock screen — no DOM, no signals — so each one is
// unit-tested on its own (viewer/test/logic.test.ts).

import type { Ask, AskAnswer, KnobConfig, KnobValue, Knobs, Reply } from "../../server/types.ts";
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

// Mix (D6): borrow a part from another look. A part qualifies when more than one
// look's variant renders it in some state; each other look rendering it is one
// option. Nothing to mix until a look is picked.
export function mixOptions(
  mock: Pick<MockDetail, "asks" | "states">,
  variants: Pick<VariantView, "state" | "variant" | "status" | "parts">[],
  look: string | null,
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
    const names: string[] = [];
    for (const v of inState) for (const p of v.parts) if (!names.includes(p)) names.push(p);
    for (const part of names) {
      const having = inState.filter((v) => v.parts.includes(part));
      if (having.length < 2) continue;
      for (const v of having) {
        const key = `${part}\u0000${v.variant}`;
        if (v.variant === look || seen.has(key)) continue;
        seen.add(key);
        out.push({ part, variant: v.variant });
      }
    }
  }
  return out;
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
  for (const c of reply.comments) parts.push(`${c.part ?? "page"}: “${c.text}”`);
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
// click is answered once.
export function createHitRefs() {
  let n = 0;
  let hover = 0;
  const clicks = new Set<number>();
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
    resolve(ref: unknown): "hover" | "click" | null {
      if (typeof ref !== "number") return null;
      if (clicks.delete(ref)) return "click";
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

// The knob values a frame should show for the draft: declared defaults, then
// answered knob-set options, then tuned values.
export function draftKnobValues(
  mock: Pick<MockDetail, "asks" | "knobs">,
  variantKnobs: Knobs | undefined,
  draft: DraftInput | null,
): Record<string, KnobValue> {
  const out: Record<string, KnobValue> = {};
  for (const [k, cfg] of Object.entries({ ...mock.knobs, ...variantKnobs })) {
    const v = knobDefault(cfg);
    if (v !== undefined) out[k] = v;
  }
  if (!draft) return out;
  for (const ask of mock.asks) {
    for (const id of answerIds(draft.answers[ask.id])) {
      Object.assign(out, ask.options.find((o) => o.id === id)?.set ?? {});
    }
  }
  return Object.assign(out, draft.tuned);
}

export interface ThreadRow {
  who: "agent" | "you";
  at: string;
  text: string;
  quote?: string;
  seen?: boolean;
  id: string;
}

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
      const text =
        c.kind === "reply" && c.payload ? summarizeReply(c.payload, mock) : c.text || "Sent";
      rows.push({ who: "you", at: c.createdAt, text, seen: c.seen, id: c.id });
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
export function partBox(report: PartsReport | undefined, name: string | null | undefined) {
  if (!report || !name) return undefined;
  return report.parts
    .filter((p) => p.name === name && p.visible)
    .sort((a, b) => b.depth - a.depth || a.order - b.order)[0]?.box;
}
