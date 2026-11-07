// What an answer brings so it can draw itself: a little style, or a new swap of one
// part. It lives on the design, so a version the user approved is never rewritten,
// and it only takes effect while its value is chosen. Values are new and never
// redefined, so everything the user has already seen keeps looking the same.
//
// String-only and runtime-agnostic, like swaps.ts.

import { addSwap, cssString } from "./swaps.ts";
import type { AnswerAddition } from "./types.ts";

export const MAX_ANSWER_STYLE = 20_000;
export const MAX_ANSWER_SWAP = 200_000;
export const MAX_ANSWER_ADDITIONS = 200;

// Allowed inside a rule. The rest either escape the value's scope or do nothing there.
const NESTED_AT_RULES = new Set(["media", "supports", "container"]);

// The scope is only as good as the braces: a stray `}` would end it and put the rest
// of the style on every render, breaking the promise above.
export function checkAnswerStyle(css: string): string | null {
  if (css.length > MAX_ANSWER_STYLE) return `style is over ${MAX_ANSWER_STYLE} characters`;
  if (/<\/style/i.test(css)) return "style can't contain </style";
  let depth = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end < 0) return "style has an unclosed comment";
      i = end + 1;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c) j += css[j] === "\\" ? 2 : 1;
      if (j >= css.length) return "style has an unclosed string";
      i = j;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      if (--depth < 0) return "style has a } with no {";
    } else if (c === "@") {
      const name = /^[a-z-]+/i.exec(css.slice(i + 1, i + 40))?.[0].toLowerCase();
      if (!name || !NESTED_AT_RULES.has(name)) {
        return `style can't use @${name ?? ""}: only @media, @supports and @container`;
      }
    }
  }
  return depth === 0 ? null : "style has a { with no }";
}

// A swap sits in the document even while it isn't chosen, so anything that acts from
// there (a script, a stylesheet) would change the page for every other answer too.
export function checkAnswerSwap(html: string): string | null {
  if (html.length > MAX_ANSWER_SWAP) return `swap is over ${MAX_ANSWER_SWAP} characters`;
  const acting = /<(script|style|link)\b/i.exec(html)?.[1].toLowerCase();
  if (acting) {
    return `a swap can't hold <${acting}>: it would act while unchosen. Use style, or html for a whole page`;
  }
  return null;
}

const valueSelector = (a: Pick<AnswerAddition, "knob" | "value">): string =>
  `html[data-k-${a.knob.replace(/\./g, "-")}=${cssString(a.value)}]`;

// A render of any version: its html, with what answers brought laid over it.
export function withAnswerAdditions(html: string, additions: AnswerAddition[]): string {
  if (additions.length === 0) return html;
  let out = html;
  for (const a of additions) {
    if (a.swap !== undefined) out = addSwap(out, a.knob, a.value, a.swap);
  }
  const css = additions.flatMap((a) =>
    a.style === undefined ? [] : [`${valueSelector(a)}{${a.style}}`],
  );
  return css.length ? `${out}\n<style>${css.join("\n")}</style>` : out;
}
