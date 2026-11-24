# mockpit topic: knobs

A knob is a value the user tunes live on one render. Declare knobs for what is worth
fine-tuning (size, spacing, colour, density) even unasked; they wait in Tune. A tune belongs
to the frame it was made on: tuning one alternative leaves the others as they were. A knob
shows only on a frame whose page reads it (its html, components included, mentions
`k-<path, dots as dashes>`, `data-k-bind="<path>"` or its `dataset.k<Path>`, or the knob is a part's swaps); a page
listening for `mockpit:knobs` shows every knob.

## Choice knobs, the Sheet, Sets and looks

A choice knob is a `select`, `image` or `color` with options, or a part's swaps. Publish what
varies across renders as one, not as a question: it shows in the Choices panel beside the
design, under any open question and the alternatives, as a picture of the frame in each
value (a colour as swatches), marked new until the user acts on it. Picking a value there
applies it to every live alternative of the state that has the knob, so each frame's
`tunedOn` carries it; Tune keeps only the fine knobs. Its Sheet button lays it out as a Sheet: the
frame in every value, then every frame in every value (frames down, values across). Clicking a cell (`?alternative=<name>&sheet=<knob>&value=<val>`) opens it
full-size beside a Knob Choice Panel (and Side-by-side finalist grid) where the user marks
**Main** (`M`), **Bookmark / Keep** (`K`), or **Delete** (`X`, ruling out that cell only,
never the whole alternative). Each frame accumulates its own `★ Main` across multiple choice
knobs (e.g. glyphs + colour). On a **Set** idea (`--set`, `Keep all`), every live frame ships
on Use wearing its accumulated `★ Main` knob values (and defaults for knobs left unset). On a
screen or component the Sheet opens in an idea for it, holding copies of its frames, so the product
stays as it is. `publish --sheet <knob>` (MCP and HTTP `"sheet"`) on an idea lands its link
on that Sheet; a knob that can't be laid out leaves the link as it was, with a nudge.
On hosts that support capture, it also starts capturing the published row in the background.

A look is a named set of knob values, holding only the knobs it changes; the user sees it
as a preset, a chip above the knobs in Choices that previews on hover and applies on a
click. The user saves them there or in Tune; yours come with a publish, `--looks '{"Big dots": {"marks": "dots",
"size": 1.6}}'` (MCP and HTTP `"looks"`), checked against the knobs declared. Alone it adds
them with no new version. A look is offered on every design that declares each knob it
sets, and a look the user named stands against yours of that name (a nudge says so).
`read` lists `looks`; a mark or a Use names the look or knob values it was made in.

## Declaring

Knobs use tunekit's `usePane` shape, keyed by path. `"size"` is global,
`"body.size"` belongs to the `body` part. Design-wide knobs go in `--knobs` (MCP
and HTTP `knobs`). Over MCP and HTTP, knobs only one alternative has go in
`alternativeKnobs`. Knobs add up across publishes; a path set to `null` drops that design
knob, `--knobs '{"media": null}'`, as when it moves to one alternative's knobs.

```sh
mockpit publish --design writer --state "Writing" --html w.html --knobs '{"body.size":[17,14,22,1]}'
```

| shape                                                                       | control        |
| --------------------------------------------------------------------------- | -------------- |
| `[17, 14, 22, 1]` (default, min, max, step?) or a number                    | slider         |
| `true` / `false`                                                            | toggle         |
| `"#2a6"`, `"oklch(…)"`, `"linear-gradient(…)"`                              | colour         |
| any other string                                                            | text           |
| `{ "type": "select", "options": ["top", "bottom"], "value"?, "pictures"? }` | select         |
| `{ "type": "color", "value"?, "gradient"?, "contrast"?, "options"? }`       | colour         |
| `{ "type": "text", "value"?, "placeholder"? }`                              | text           |
| `{ "type": "slider", "value", "min", "max", "step"? }`                      | slider         |
| `{ "type": "toggle", "value" }`                                             | toggle         |
| `{ "type": "spring", "stiffness"?, "damping"?, "mass"?, … }`                | spring         |
| `{ "type": "easing", "duration", "ease": [x1, y1, x2, y2] }`                | easing         |
| `{ "type": "pad", "x"?: [d, min, max], "y"?: …, "labels"? }`                | 2-D pad        |
| `{ "type": "image", "options"?: [...], "value"? }`                          | image (select) |

For a colour the user can both edit and compare, publish a colour knob with
a CSS colour as its value and named CSS colours in `options` to seed the Sheet.
For example, `{"type":"color","value":"#24354d","options":[{"label":"Deep blue","value":"#24354d"}]}`.
Have the frame use the colour value directly so it can draw user-added colours.
In a question where every option sets this one colour knob, the user can add another
colour to compare and choose it explicitly before Send.

A select is a choice knob, pictured in Choices and on the Sheet. `"pictures": false` keeps
it a dropdown in Tune: for what a still can't show, such as which way a thing is tossed on
a click, whose every value would draw the same picture.

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
