import { checkKnobValue, explicitKnob, knobFor } from "./knobs.ts";
import type { Ask, AskOption, Knobs, Look } from "./types.ts";

/** Reuse a one-value look as a comparison without creating a second stored copy. */
export function colorLooks(looks: readonly Look[], path: string) {
  return looks.flatMap((look) => {
    const value = look.values[path];
    return typeof value === "string" && Object.keys(look.values).length === 1
      ? [{ value, label: look.name }]
      : [];
  });
}

/** An ask can accept another color when every answer varies exactly that color. */
export function colorQuestionPath(
  ask: Pick<Ask, "multi" | "options">,
  knobs: Knobs,
  frames: { knobs?: Knobs }[],
): string | undefined {
  if (ask.multi) return;
  const [path] = Object.keys(ask.options[0]?.set ?? {});
  if (!path) return;
  const cfg = knobFor(path, { knobs }, frames);
  if (cfg === undefined || explicitKnob(cfg).type !== "color") return;
  if (
    !ask.options.every(
      (o) =>
        !o.alternative &&
        !o.palette &&
        Object.keys(o.set ?? {}).length === 1 &&
        typeof o.set?.[path] === "string",
    )
  )
    return;
  return path;
}

/** Saved colors are answers only once the user picks one and sends it. */
export function colorAnswers(
  ask: Ask,
  knobs: Knobs,
  frames: { knobs?: Knobs }[],
  looks: readonly Look[],
): AskOption[] {
  const path = colorQuestionPath(ask, knobs, frames);
  if (!path) return [];
  const cfg = knobFor(path, { knobs }, frames);
  if (cfg === undefined) return [];
  const seen = new Set(ask.options.map((option) => option.set?.[path]));
  return colorLooks(looks, path).flatMap(({ value, label }) => {
    if (seen.has(value) || !checkKnobValue(path, cfg, value).ok) return [];
    seen.add(value);
    return [{ id: `color:${value}`, label, set: { [path]: value } }];
  });
}
