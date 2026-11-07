# mockpit topic: system

A project's **system** is what every one of its renders wears: a shared stylesheet, typed
tokens, type and space scales, colour palettes, project knobs and checks. You write it with
`system`; it applies at once to every design (the user sees a note and can restore), and
every version records the revision it was published under. Mockpit picks no look and does
no colour science: you generate, it expands scales, computes contrast and checks.

## Reading and writing

```sh
mockpit system                                   # the whole system, its checks, revisions
mockpit system --sheet kit.css --classes '[{"name":"kc","note":"card: padded, raised"}]'
mockpit system --tokens '[{"name":"radius-card","type":"dimension","value":"14px"}]'
mockpit system --restore 6                       # back to revision 6 (a new revision)
```

MCP `system({...})`, HTTP `GET`/`PUT /api/projects/<name>/system`. Each part you send
replaces that part and leaves the rest; `tokens`, `scales` and `palettes` are upserted by
name or id, and `remove: {tokens, palettes, scales}` takes them out. The result is
`{rev, changed, checks, nudges, url, feedback}`.

| argument   | shape                                                                          |
| ---------- | ------------------------------------------------------------------------------ |
| `sheet`    | CSS text (CLI and stdio: a path). No `@import`; at most 128 KB                 |
| `classes`  | `[{name, note}]`: the sheet's classes the brief lists, one line each           |
| `fonts`    | `[{family, href?}]`: `href` a stylesheet on the CDN allowlist (Google Fonts)   |
| `tokens`   | `[{name, type, value, note?}]`                                                 |
| `scales`   | `[{id, family, prefix, steps, zero, base, ratio, fluid?}]`                     |
| `roles`    | `[{name, note}]`: the colour names every palette values                        |
| `palettes` | `[{id, label, note, light: {role: colour}, dark: {…}, scheme?, status?}]`      |
| `pairs`    | `[[fg, bg, min]]`: contrast to clear, WCAG 2.2 (4.5 text, 3 large text and UI) |
| `as`       | `{"color-text-primary": "ink", …}`: points mockpit's own tokens at your roles  |
| `knobs`    | project knobs, the usual knob shapes; a path no design of the project uses     |
| `remove`   | `{tokens?, palettes?, scales?}`: names to take out                             |
| `restore`  | a revision number, alone; what the user decided stays (`kept` says what)       |

Names are lowercase (`^[a-z][a-z0-9-]{0,47}$`) and become custom properties: token `radius-card`
is `var(--radius-card)`. `k-` is reserved for knobs, and mockpit's own `--color-*` names are
taken. A name has one owner: a token (a `text` token owns each `--<name>-<field>`), a role, a
scale step, or the repo, for every name its own blocks declare. A write that gives a name a
second owner fails and names both. A palette values roles: it can't set a mockpit token, a
`k-` name, or a name a non-colour token or a scale step owns.

## Tokens

Types: `color`, `dimension`, `font`, `weight`, `number`, `shadow`, `duration`, `easing`, and
`text`, whose value is `{font, size, line, weight, tracking}` and becomes `--<name>-size` and so on.
Values are plain CSS values: no `url()`, no `;`.

## Scales

A scale expands into tokens on write. `base` is px at step `zero`, each step up multiplies by
`ratio`. `fluid: {minWidth, maxWidth, maxBase, maxRatio}` makes each step a `clamp()` from the
fixed size at `minWidth` to `maxBase × maxRatio^n` at `maxWidth`.

```json
{
  "id": "type",
  "family": "type",
  "prefix": "step",
  "steps": ["sm", "base", "lg", "xl", "2xl"],
  "zero": "base",
  "base": 16,
  "ratio": 1.2,
  "fluid": { "minWidth": 360, "maxWidth": 1280, "maxBase": 18, "maxRatio": 1.25 }
}
```

gives `--step-sm` … `--step-2xl`. Pick a prefix nothing else uses: in a Tailwind repo `text-`,
`spacing-` and the other theme namespaces are Tailwind's. A fluid type step whose largest size is past 2.5× its
smallest fails 200% zoom (WCAG 1.4.4), and the write says so.

## Palettes

Roles are the project's colour names (`bg`, `ink`, `acc`), declared once with a note; each
palette values every role in light and dark. One palette is `default`; a frame wears it unless
the viewer's palette switcher picks another. A palette dark in both modes says
`scheme: {light: "dark", dark: "dark"}`. Statuses: `default`, `kept`, `open`, `hidden`.

The user chooses through a question whose options carry `palette: "<id>"` (scope `design` or
`state`, no alternative): each answer is pictured as the same render in that palette, and the one
sent becomes the default, the old default kept. Keep and Hide on an answer keep or hide that
palette. Mappings between roles (`--c-go: var(--acc2)`) are a decision, not palette data: put
them in an answer's `style`.

```sh
mockpit ask --design today "Which palette?" --option Lilac=palette:lilac --option Grape=palette:grape
```

## Project knobs

`knobs` declares knobs every render of the project carries (`data-k-*` and `--k-*` on
`<html>`), with the value the user settled or the knob's own. A path is one owner's: a
design can't declare a project knob's path, and a project knob can't take a design's. An
option's `set` on a project knob settles it for the whole project when sent; `style` beside
a `set` of a new value is stored on the system, so every design wears it. Asking again with
the same value and a new `style` revises what the value draws (the write says so); the
value's name never changes. Design knobs' answer styles revise the same way.

## The user's own changes

On the System page the user can make a palette the default, keep or hide one, or restore a
revision. Each is a new revision and reaches you as a feedback batch with no design:
`{project, system: {rev, changes}}`. Build on it. A Send that decided something for the
project says so in its batch's `system`.

Your `restore` brings a revision back but leaves what the user decided standing: every
palette's status, the settled project knobs, and the knobs and answer styles those values need.
The result's `kept` lists it. Only the user's own Restore brings back everything.

## How a frame wears it

New versions render with cascade layers: `@layer mockpit, kit, system`. Mockpit's base and
the kits sit below the sheet, and the tokens and your page are unlayered, so a page rule beats
a sheet rule at plain specificity, and an embedded component needs no copy of the kit. With the
`tailwind` kit the order is `theme, base, mockpit, kit, system, components, utilities`: preflight
sits under the sheet, and a utility on an element still beats a sheet rule, as in the repo.
`!important` inside a layer inverts that: keep it out of the sheet. `<html>` carries
`data-palette`, `data-scheme`, and the project knobs' `data-k-*` and `--k-*`.

## The layout kit

`kits: ["layout"]` adds composition classes that only place boxes: `l-stack`, `l-box`,
`l-center`, `l-cluster`, `l-sidebar` (`.end` puts the side last), `l-switcher`, `l-cover`
(its `.main` child centred), `l-grid`, `l-frame`, `l-reel`, `l-imposter`, `l-icon`,
`l-with-icon`. Every gap is `--space`, defaulting to the base step of the space scale; set
another on the element: `style="--space: var(--space-l)"`. Each takes its measure the same
way (`--measure`, `--side`, `--threshold`, `--min`, `--ratio`, `--item`). `--space`,
`--measure`, `--side`, `--threshold`, `--min` and `--item` don't inherit: a layout nested in
another starts from the defaults, so set them on the element they're for. A cover is at most
50rem tall in a frame (`--min-height` to change it): the frame is sized from its content.

## Export

`export` without a design hands the system to code: `sheet`, `css` (constants, the default
palette on `:root`, each kept one under `[data-palette="<id>"]`, dark by media query),
`tokens` (the same as data), `knobs` (the project knobs' values), `additions` (the CSS an
answer brought for a settled value, keyed on `data-k-<path>`) and `components` with their
`source`. `mockpit export` writes them to `.mockpit/system/`. What the repo owns is left
out: it is in the code already. `read` without a design carries a one-line `system`.

## Checks

A `system` write checks contrast for every pair in every palette and mode (a value that isn't
hex, rgb, hsl, oklch or oklab is listed as unchecked, never passed), palettes missing a role,
pairs naming unknown tokens, `var(--…)` in the sheet that nothing declares, indexed classes
the sheet doesn't define, `!important` in the sheet, and fluid type past 2.5×. A `publish`
and an answer's `style` are checked against the system: colour literals, a system name
redeclared, a sheet rule copied into the page, and font sizes or spacing off the scales.
They come back as `nudges`; none blocks.

## The repo's own

What `mockpit init` reads is the repo's: its `:root` and `.dark` colours become roles and the
`repo` palette, constant colours and Tailwind theme values become typed tokens, marked
`owner: "repo"`. A `system` write can't change them: change the code and rerun `init`.
