// A Send in words, one line per thing in it: what the viewer's Send list shows before it
// goes, and what a feedback batch's `lines` says once it has. One renderer for both, so
// what the user reads is what the agent gets. Each line names what it came from, which
// is how the list takes one back. Runtime-agnostic, shared with the viewer.

import {
  DEFAULT_ALTERNATIVE,
  type DraftRequest,
  type KnobValue,
  type PartComment,
  type Reaction,
  type TunedOn,
  type UsedPick,
} from "./types.ts";

// A question the Send says something about, already in words: its text, the answers
// chosen (a write-in as typed), and what the user said on it or on single answers.
export interface SendAsk {
  id: string;
  text: string;
  chosen: string[];
  comment?: string;
  onAnswers?: { label: string; comment: string }[];
}

export interface SendInput {
  asks: SendAsk[];
  borrowed: Record<string, string>;
  tunedOn: TunedOn;
  comments: PartComment[];
  requests: DraftRequest[];
  text?: string;
}

// How a request names a question and one of its answers.
export interface SendNames {
  askText: (ask: string) => string | undefined;
  optionLabel: (ask: string, option: string) => string | undefined;
}

export type LineOf =
  | { kind: "ask"; ask: string }
  | { kind: "borrowed"; part: string }
  | { kind: "tune"; alternative: string }
  | { kind: "comment"; index: number }
  | { kind: "request"; index: number }
  | { kind: "message" };

export interface SendLine {
  of: LineOf;
  text: string;
}

// One request whatever its words: asked again, it replaces the first.
export function requestKey(r: DraftRequest): string {
  switch (r.kind) {
    case "more":
      return JSON.stringify([r.kind, r.ask, r.like ?? null]);
    case "update":
      return JSON.stringify([r.kind, r.ask, r.option]);
    case "revise":
      return JSON.stringify([r.kind, r.state, r.alternative]);
    case "state":
      return JSON.stringify([r.kind, r.name]);
    case "draw":
      return JSON.stringify([r.kind, r.state]);
  }
}

const quoted = (s: string) => `“${s}”`;

// "football@2" as agents write it; a design with one unnamed alternative needs no name.
const frameName = (alternative: string | undefined, version?: number) => {
  const at = version ? `@${version}` : "";
  if (!alternative || alternative === DEFAULT_ALTERNATIVE) return at ? `v${version}` : "it";
  return `${alternative}${at}`;
};

const valueWords = (v: KnobValue): string =>
  typeof v === "boolean"
    ? v
      ? "on"
      : "off"
    : typeof v === "object"
      ? JSON.stringify(v)
      : String(v);

// "size 1.4, colour deep blue".
export const valuesWords = (values: Record<string, KnobValue>): string =>
  Object.entries(values)
    .map(([k, v]) => `${k} ${valueWords(v)}`)
    .join(", ");

const REACTION_LEAD: Record<Reaction, string> = {
  up: "👍",
  down: "👎",
  more: "more like this:",
};

// `👍 part "hero" (alternative B, state Mobile)`, `👎 alternative B`, `more like this: the page`.
export function reactionLine(c: PartComment & { reaction: Reaction }): string {
  // A design published without alternative names has only "default": naming it is noise.
  const named = c.alternative && c.alternative !== DEFAULT_ALTERNATIVE ? c.alternative : null;
  // A version is written as agents write it, dark@2.
  const at = c.version ? `@${c.version}` : "";
  const alternative = named ? `${named}${at}` : at ? `${DEFAULT_ALTERNATIVE}${at}` : null;
  const where = [
    c.part !== null && alternative ? `alternative ${alternative}` : "",
    c.state ? `state ${c.state}` : "",
    c.values ? valuesWords(c.values) : "",
  ].filter(Boolean);
  const target =
    c.part !== null
      ? `part ${JSON.stringify(c.part)}`
      : alternative
        ? `alternative ${alternative}`
        : "the page";
  const tail = where.length ? ` (${where.join(", ")})` : "";
  const note = c.text ? ` “${c.text}”` : "";
  return `${REACTION_LEAD[c.reaction]} ${target}${tail}${note}`;
}

function commentLine(c: PartComment): string {
  if (c.reaction) return reactionLine(c as PartComment & { reaction: Reaction });
  const frame = frameName(c.alternative, c.version);
  const said = c.text ? `: ${quoted(c.text)}` : "";
  if (c.borrow) {
    const part = c.borrow.part ? ` ${c.borrow.part}` : "";
    return `New version of ${frame} taking${part} from ${c.borrow.from}${said}`;
  }
  const on = c.part !== null ? `${c.part} on ${frame}` : frame;
  const where = c.state ? `, ${c.state}` : "";
  const wearing = c.values ? ` (${valuesWords(c.values)})` : "";
  return `Comment on ${on}${where}${wearing}${said}`;
}

function askLine(a: SendAsk): string | null {
  const parts: string[] = [];
  if (a.chosen.length) parts.push(`→ ${a.chosen.join(", ")}`);
  if (a.comment) parts.push(quoted(a.comment));
  for (const o of a.onAnswers ?? []) parts.push(`on ${o.label}: ${quoted(o.comment)}`);
  return parts.length ? `${a.text || a.id} ${parts.join(" · ")}` : null;
}

function requestLine(r: DraftRequest, names: SendNames): string {
  switch (r.kind) {
    case "more": {
      const ask = quoted(names.askText(r.ask) ?? r.ask);
      const like = r.like ? (names.optionLabel(r.ask, r.like) ?? r.like) : null;
      const head = like ? `More like ${like}, for ${ask}` : `More answers to ${ask}`;
      return r.note ? `${head}: ${quoted(r.note)}` : head;
    }
    case "update":
      return `Bring ${names.optionLabel(r.ask, r.option) ?? r.option} up to date`;
    case "revise":
      return `New version of ${frameName(r.alternative, r.version)}`;
    case "state":
      return `New state: ${r.name}${r.detail ? `. ${r.detail}` : ""}`;
    case "draw":
      return r.state ? `Draw ${r.state}` : "Draw it";
  }
}

export function sendLines(input: SendInput, names: SendNames): SendLine[] {
  const out: SendLine[] = [];
  for (const a of input.asks) {
    const text = askLine(a);
    if (text) out.push({ of: { kind: "ask", ask: a.id }, text });
  }
  for (const [part, from] of Object.entries(input.borrowed))
    out.push({ of: { kind: "borrowed", part }, text: `${part} from ${frameName(from)}` });
  for (const [alternative, values] of Object.entries(input.tunedOn)) {
    if (!Object.keys(values).length) continue;
    const who = alternative === DEFAULT_ALTERNATIVE ? "Tuned" : `${alternative} tuned`;
    out.push({ of: { kind: "tune", alternative }, text: `${who}: ${valuesWords(values)}` });
  }
  input.comments.forEach((c, index) =>
    out.push({ of: { kind: "comment", index }, text: commentLine(c) }),
  );
  input.requests.forEach((r, index) =>
    out.push({ of: { kind: "request", index }, text: requestLine(r, names) }),
  );
  if (input.text?.trim()) out.push({ of: { kind: "message" }, text: quoted(input.text.trim()) });
  return out;
}

// A Use as the agent reads it: what goes in, Main first, each in its look or values, and
// where. Each pick is named as the idea names it; the entry it became is `usedIn`'s, which
// on a design with one unnamed entry would read "it".
export function useLine(picks: UsedPick[], into: string | null): string {
  const list = picks
    .map((p) => {
      const name = frameName(p.alternative);
      const main = p.main ? " (Main)" : "";
      const wears = p.look ? ` in ${p.look}` : p.values ? ` with ${valuesWords(p.values)}` : "";
      const tuned = p.tuned ? `, tuned ${valuesWords(p.tuned)}` : "";
      return `${name}${main}${wears}${tuned}`;
    })
    .join("; ");
  return into ? `Use in ${into}: put ${list} in the code` : `Use ${list}`;
}
