# mockpit topic: knobs

A knob is a value the user tunes live on one render. Declare knobs for what is worth
fine-tuning (size, spacing, colour, density) even unasked; they wait in Tune. A tune belongs
to the frame it was made on: tuning one alternative leaves the others as they were.

## Choice knobs, the Sheet, Sets and looks

A choice knob is a `select` or an `image` with options, or a part's swaps. Publish what
varies across renders as one, not as a question: the user presses Spread beside it in Tune
and sees the frame in every value, then every frame in every value, on a Sheet (frames down,
values across). Clicking a cell (`?alternative=<name>&sheet=<knob>&value=<val>`) opens it
full-size beside a Knob Choice Panel (and Side-by-side finalist grid) where the user marks
**Main** (`M`), **Bookmark / Keep** (`K`), or **Delete** (`X`, ruling out that cell only,
never the whole alternative). Each frame accumulates its own `★ Main` across multiple choice
knobs (e.g. glyphs + colour). On a **Set** idea (`--set`, `Keep all`), every live frame ships
on Use wearing its accumulated `★ Main` knob values (and defaults for knobs left unset). On a
screen or component Spread opens an idea for it, holding copies of its frames, so the product
stays as it is. `publish --sheet <knob>` (MCP and HTTP `"sheet"`) on an idea lands its link
on that Sheet; a knob that can't be laid out leaves the link as it was, with a nudge.
On hosts that support capture, it also starts capturing the published row in the background.

A look is a named set of knob values, holding only the knobs it changes. The user saves
them from Tune; yours come with a publish, `--looks '{"Big dots": {"marks": "dots",
"size": 1.6}}'` (MCP and HTTP `"looks"`), checked against the knobs declared. Alone it adds
them with no new version. A look is offered on every design that declares each knob it
sets, and a look the user named stands against yours of that name (a nudge says so).
`read` lists `looks`; a mark or a Use names the look or knob values it was made in.

## Declaring

Knobs use tunekit's `usePane` shape, keyed by path. `"size"` is global,
`"body.size"` belongs to the `body` part. Design-wide knobs go in `--knobs` (MCP
and HTTP `knobs`). Over MCP and HTTP, knobs only one alternative has go in
`alternativeKnobs`.

```sh
mockpit publish --design writer --state "Writing" --html w.html --knobs '{"body.size":[17,14,22,1]}'
```

| shape                                                          | control        |
| -------------------------------------------------------------- | -------------- |
| `[17, 14, 22, 1]` (default, min, max, step?) or a number       | slider         |
| `true` / `false`                                               | toggle         |
| `"#2a6"`, `"oklch(…)"`, `"linear-gradient(…)"`                 | colour         |
| any other string                                               | text           |
| `{ "type": "select", "options": ["top", "bottom"], "value"? }` | select         |
| `{ "type": "color", "value"?, "gradient"?, "contrast"? }`      | colour         |
| `{ "type": "text", "value"?, "placeholder"? }`                 | text           |
| `{ "type": "slider", "value", "min", "max", "step"? }`         | slider         |
| `{ "type": "toggle", "value" }`                                | toggle         |
| `{ "type": "spring", "stiffness"?, "damping"?, "mass"?, … }`   | spring         |
| `{ "type": "easing", "duration", "ease": [x1, y1, x2, y2] }`   | easing         |
| `{ "type": "pad", "x"?: [d, min, max], "y"?: …, "labels"? }`   | 2-D pad        |
| `{ "type": "image", "options"?: [...], "value"? }`             | image (select) |

Select and image options are strings or `{value, label}`. Colour values may not
use `url(…)` or `image(…)`. Every value is checked against the declaration
before it reaches a render.

## How a value reaches your html

Dots in the path become `-`.

- `--k-<path>` on `<html>`: numbers as-is, booleans `1`/`0`, strings raw when
  they are plain CSS tokens. An `{x, y}` value spreads into `--k-<path>-x` and
  `--k-<path>-y`. The var is unitless, so write
  `font-size: calc(var(--k-body-size, 17) * 1px)` with the default as fallback.
- `data-k-<path>` on `<html>`: the value as text (`"true"`/`"false"` for
  booleans).
- `[data-k-bind="<path>"]`: the element's text becomes the value.
- `window` event `mockpit:knobs`: `detail.values` holds every current value.
  It fires on load and on each change. Use it for anything CSS can't do.

## Structural options

Render every option up front and switch with `data-k-*`. Don't rebuild markup
from script.

```html
<style>
  html[data-k-trim-position="bottom"] .trim-top,
  html:not([data-k-trim-position="bottom"]) .trim-bottom {
    display: none;
  }
</style>
<div class="trim-top" data-part="trim">Chapter 7</div>
…
<div class="trim-bottom" data-part="trim">Chapter 7</div>
```

Topic `asks`: an option's `"set": {"trim.position": "bottom"}` turns a knob into a question.
