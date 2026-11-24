// Which knobs a page reads, from the html its frame is served (instances expanded). A
// knob a page never reads changes nothing on it, so the viewer leaves it out there. The
// page reads one through the marks the knob runtime puts on it (surfacePage.ts): a
// `--k-<path>` var, a `data-k-<path>` attribute, `[data-k-bind="<path>"]`, all of which
// carry "k-<path, dots as dashes>". A page that listens for `mockpit:knobs`, or builds those
// names in script, could be reading anything: it reads them all. Wrong in the safe
// direction only: a name that merely contains another counts as reading it.

export type KnobReads = string[] | "all";

const dashed = (path: string) => path.replace(/\./g, "-");

// Script that reads a knob by a name it builds, or through `dataset`, whose names are
// camel-cased away from the "k-" form.
const DYNAMIC = /k-["'`]\s*\+|k-\$\{|dataset\.k[A-Z]|dataset\[\s*["'`]k/;

export function knobsRead(
  html: string,
  paths: Iterable<string>,
  // Read wherever the page is drawn: a part's swaps (composed by mockpit's own css) and
  // the knobs an answer's style or swap keys on.
  given: Iterable<string> = [],
): KnobReads {
  if (html.includes("mockpit:knobs") || DYNAMIC.test(html)) return "all";
  const always = new Set(given);
  const out: string[] = [];
  for (const path of new Set(paths)) {
    if (
      always.has(path) ||
      html.includes(`k-${dashed(path)}`) ||
      html.includes(`data-k-bind="${path}"`) ||
      html.includes(`data-k-bind='${path}'`)
    ) {
      out.push(path);
    }
  }
  return out;
}
