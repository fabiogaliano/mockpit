// Which knobs a page reads, from the html its frame is served (instances expanded). A
// knob a page never reads changes nothing on it, so the viewer leaves it out there. The
// page reads one through the marks the knob runtime puts on it (surfacePage.ts): a
// `--k-<path>` var, a `data-k-<path>` attribute, `[data-k-bind="<path>"]`, all of which
// carry "k-<path, dots as dashes>", and script reads the attribute as `dataset.k<Path>`. A
// page that listens for `mockpit:knobs`, or builds those names in script, could be reading
// anything: it reads them all. Wrong in the safe direction only: a name that merely
// contains another counts as reading it. What a page names but draws no differently, the
// viewer tells from its stills (stillCrop.ts).

export type KnobReads = string[] | "all";

const dashed = (path: string) => path.replace(/\./g, "-");

// `data-k-hero-size` as script reads it, `dataset.kHeroSize`. An html document lower-cases
// attribute names, so none of the path's own capitals survive into it.
const datasetName = (path: string) =>
  `k-${dashed(path)}`.toLowerCase().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

// Script that reads a knob by a name it builds: `"k-" + name`, `` `k-${name}` ``, or
// `dataset["k" + name]`. A whole literal, `dataset["kMedia"]`, names its knob.
const DYNAMIC = /k-["'`]\s*\+|k-\$\{|dataset\[\s*(["'`])k(?![\w-]*\1\s*\])/;

export function knobsRead(
  html: string,
  paths: Iterable<string>,
  // Read wherever the page is drawn: a part's swaps (composed by mockpit's own css) and
  // the knobs an answer's style or swap keys on.
  given: Iterable<string> = [],
): KnobReads {
  if (html.includes("mockpit:knobs") || DYNAMIC.test(html)) return "all";
  // Attribute selectors match `data-k-*` in any case; a path's capitals mean nothing there.
  const lower = html.toLowerCase();
  const always = new Set(given);
  const out: string[] = [];
  for (const path of new Set(paths)) {
    if (
      always.has(path) ||
      lower.includes(`k-${dashed(path)}`.toLowerCase()) ||
      html.includes(`data-k-bind="${path}"`) ||
      html.includes(`data-k-bind='${path}'`) ||
      html.includes(datasetName(path))
    ) {
      out.push(path);
    }
  }
  return out;
}
