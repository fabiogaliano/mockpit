# mockpit topic: knobs

A knob is a value the user tunes live on one render. Use one when one render
plus a control shows the choice. A choice is several variants plus one ask
that binds them; for that, publish variants and ask instead (topic `asks`). A knob with three or fewer discrete options (a
toggle, a short select) gets a nudge in the publish response; keep it only if
one render plus that control really shows the choice.

## Declaring

Knobs use tunekit's `usePane` shape, keyed by path. `"size"` is global,
`"body.size"` belongs to the `body` part. Mock-wide knobs go in `--knobs` (MCP
and HTTP `knobs`). Over MCP and HTTP, knobs only one variant has go in
`variantKnobs`.

```sh
mockpit publish --mock writer --state "Writing" --html w.html --knobs '{"body.size":[17,14,22,1]}'
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

An ask option can set knob values too (`"set": {"trim.position": "bottom"}`),
which turns a knob into a question. See topic `asks`.
