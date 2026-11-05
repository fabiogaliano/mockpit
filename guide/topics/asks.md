# mockpit topic: asks

A question (`ask`) is your structured question on a design. A choice is several
variants plus one question that binds them. Ask only when the decision is the
user's, and ask in the design, never in chat. To the user they are questions;
`ask` is only the tool's name.

```sh
mockpit ask --design writer "Quiet or dark?" --option Quiet=quiet --option Dark=dark --id tone
mockpit ask --design writer "Trim?" --option Above=knob:trim.position=top --option Below=knob:trim.position=bottom
mockpit ask --design writer --asks asks.json
```

`=knob:` sets one knob; for an option that sets several, use `--asks` JSON.
`--recommend Quiet` (`"recommended": true` on one option) marks the one you
would pick with a quiet dot; hovering shows the variant's description as why.

## Shape

The same JSON goes to `--asks`, MCP `ask` and `POST /api/designs/:id/asks`:

```json
[
  {
    "id": "tone",
    "text": "Quiet or dark?",
    "scope": "design",
    "options": [
      { "label": "Quiet", "variant": "quiet" },
      { "label": "Dark", "variant": "dark" }
    ]
  },
  {
    "id": "trim",
    "text": "Trim above or below?",
    "scope": "part",
    "part": "trim",
    "options": [
      { "label": "Above", "set": { "trim.position": "top" } },
      { "label": "Below", "set": { "trim.position": "bottom" } }
    ]
  },
  {
    "id": "versions",
    "text": "Where should versions live?",
    "scope": "state",
    "state": "Lab open",
    "multi": true,
    "options": [{ "label": "Drawer" }, { "label": "Margin" }]
  }
]
```

## Scope

`scope` says what a question decides and where it shows; the viewer shows each
state with its own questions. Answered once, it counts once.

- `design` (default): every state; if its options name variants, only states that have them.
- `state` (add `state`): that state.
- `part` (add `part`, the `data-part` name): every state that declares the part.

When a design-wide question's answers only show on some states, name them, best
first: `"states": ["Food · try it", "Food, around lunch"]`. It still shows on
every state, going to it brings the stage to the first, and elsewhere its card
offers the way there.

Only open questions are shown and counted ("1 of 3"). A Send folds an answered
one into a read-only Answered list, out of the next round: ask new questions for
what is still open, don't re-send answered ones. If the user changes a sent
answer on purpose, it arrives as a normal Send.

## Options

An option binds to one of:

- a `variant`: picking it puts that variant in use and archives its siblings
  in that state. Add `version` to offer one version of it (`"version": 2`, CLI
  `--option Before=quiet@2`): two options can be two versions of one variant,
  and the picked one is put in use. It needs the question's `state` when the
  design has several.
- a knob `set`: picking it applies those values live.

An answer brings what it needs to draw itself, so adding answers never makes a new
version and the page in use stays as it is. Send it in the one `ask` call, and pick the smallest
that draws it:

| The answer needs               | Send                                         | After Send               |
| ------------------------------ | -------------------------------------------- | ------------------------ |
| A value the page already knows | `set` alone                                  | Same version             |
| A colour or other styling      | `set` of one new value, plus `style`         | Same version             |
| Different content in one part  | `set: {"<part>": "<new fill>"}`, plus `fill` | Same version             |
| A different page or behaviour  | `html`, the whole page                       | Becomes the next version |

```json
[
  {
    "label": "On time, in teal",
    "set": { "role": "time-teal" },
    "style": ".dv { --now: #00656e } &[data-k-dark=\"true\"] .dv { --now: #48beca }"
  },
  {
    "label": "Shorter",
    "set": { "proposal": "shorter" },
    "fill": "<div data-part=\"proposal\"><p>Lunch at 13:00?</p></div>"
  },
  { "label": "Before and after", "html": "<main>…</main>" }
]
```

- `style` holds only while its value is chosen, on every state, so write rules as if
  already inside that value. `&` is `<html>`, for combining with another value. Only
  `@media`, `@supports` and `@container` are allowed.
- `fill` is the part's alternative outer html, added after the part. The part's own markup
  becomes the fill `as-is`, the default. A part must be one element in some state. A fill
  can't hold `<script>`, `<style>` or `<link>`, since it acts while unchosen: pair it with
  `style`, or send `html`.
- A new value's knob is added or extended for you. A value already there can't take
  `style` or `fill`: changing what it means is a new version. Asked again with the same
  `style` or `fill` it is unchanged, so a question can keep growing under its id.
- `html` needs a state when the design has several, and takes the state's variant in use
  unless `variant` names one. The user only meets it as this answer; asked again with the
  same page it keeps its version.
- A chosen answer's `brought` in the reply and `answerAdditions` in `read` say what isn't
  in any version yet. Fold them into your next version if you make one.
- A component embedded in a screen draws its own html only: answers on it show on its own
  page, not in the screens that embed it.
- nothing: a plain pill.

Options that change how something looks carry a `variant` or a knob `set`, so
the user sees them live. Plain pills only for what can't be seen.

A question that only makes sense once another is answered takes
`after: "<that question's id>"` (CLI `--after palette`). It stays closed until
then, and its pictures render with that answer and say so. Ask the deciding
question first.

The viewer shows a picture of each option it can render. `multi: true` allows
several answers. Option ids default to the slugged label. Reusing a question `id`
replaces it. The viewer adds an "Other…" write-in and a comment to every question
(both take attached images), so don't add your own; the option id `other` is
reserved.

## Parts with fills

A part with fills is one region with alternatives, in one html. Give each
alternative the same `data-part` and its own `data-fill`:

```html
<section data-part="entry" data-part-label="Entry" data-fill="dots" data-fill-label="Typing dots">
  …
</section>
<section data-part="entry" data-fill="skeleton">…</section>
<section data-part="entry" data-fill="filling" data-fill-default>…</section>
```

The first fill is the default unless one carries `data-fill-default`. The server
derives a select knob at the part's name and shows only the chosen fill, so write
no switching CSS; give each fill the display it needs. A fill can hold anything,
including further parts with fills: one inside a fill is asked only while that
fill is chosen, right after its parent's question.

Publish returns the parts with fills it found (`fills`) and, for each one no
question sets, a ready `suggestedFillAsks` entry: `scope: "part"`, one option per
fill with `set: {"entry": "<fill>"}`. Send them with `ask`, relabelled if you
like. On a pick the viewer outlines the fill on stage. `fills` in publish replaces
or adds one fill without resending the page (topic `feedback`).

Use fills when alternatives differ in one region, variants when the whole design
differs. Each variant may have parts with fills.

## The variant question

When you publish variants, ask `scope: "design"` with one option per variant, and
ask it first: questions appear in the order you ask them. Tune then offers, per
part, to borrow that part from another variant. Variants without a variant
question get a plain switcher in the frame header.

A variant decides everything it differs on; don't re-ask it. Ask other axes as
knob `set`s.

## When you forget to ask

A publish that leaves a state with two or more open variants and no question
binding them returns a nudge and a ready `suggestedAsk` (design-wide when variant
names line up across states, else for that state), or your existing question plus
the new variants. Send it with `ask`, or write your own with options bound to the
variants; the CLI prints the `mockpit ask` command. Sending it stops the nudge and
keeps your answered question on the design.

Until then the viewer shows a built-in "Which variant?" with a picture of each
variant, gone once answered. It doesn't count as open. Its answer reads like any
other under the reserved id `variant` (per state: `variant:<state>`), and puts in
use and archives per state. Your own question over those variants replaces it.
