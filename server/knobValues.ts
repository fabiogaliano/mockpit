import type { Ask, AskAnswer, KnobConfig, Knobs, KnobValue } from "./types.ts";

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

// What a knob's value depends on: the knobs declared for the alternative on stage,
// the asks (an answered knob-set option sets values), the drafted answers, the
// user's tuned values, and what earlier replies settled.
export interface KnobContext {
  knobs: Knobs;
  asks: Ask[];
  answers: Record<string, AskAnswer>;
  tuned: Record<string, KnobValue>;
  settled: Record<string, KnobValue>;
}

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

// Values set by the answered knob-set options, later asks winning.
function answerSets(asks: Ask[], answers: Record<string, AskAnswer>): Record<string, KnobValue> {
  const out: Record<string, KnobValue> = {};
  for (const ask of asks) {
    const answer = answers[ask.id];
    for (const id of answer === undefined ? [] : Array.isArray(answer) ? answer : [answer]) {
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
