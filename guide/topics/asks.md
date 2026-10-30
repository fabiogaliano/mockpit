# mockpit topic: asks

A question (`ask`) is your structured question on a mock. A choice is several
variants plus one question that binds them. Ask only when the decision is
really the user's, and ask in the mock, never in chat: after asking, tell the
user in one line where to look and end your turn. To the user they are
questions; `ask` is only the tool's name.

```sh
mockpit ask --mock writer "Quiet or dark?" --option Quiet=quiet --option Dark=dark --id tone
mockpit ask --mock writer "Trim?" --option Above=knob:trim.position=top --option Below=knob:trim.position=bottom
mockpit ask --mock writer --asks asks.json
```

`=knob:` sets one knob; for an option that sets several, use `--asks` JSON.
`--recommend Quiet` (`"recommended": true` on one option) marks the one you
would pick with a quiet dot; the user sees why on hover, in the variant's note.

## Shape

The same JSON goes to `--asks`, MCP `ask` and `POST /api/mocks/:id/asks`:

```json
[
  {
    "id": "tone",
    "text": "Quiet or dark?",
    "scope": "mock",
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

`scope` says what a question decides: `mock` (the default), `state` (add
`state`) or `part` (add `part`, the `data-part` name). Scope also says where
the user sees it: the viewer shows each state with its own questions. A
`state` question shows on that state, a `part` question on every state that
declares the part, and a `mock` question whose options name variants on every
state that has them (any other `mock` question on every state); answered
once, it counts once.

Only open questions are shown and counted ("1 of 3"). Once a Send answers
one, it folds into a read-only Answered list and stays out of the next round,
so ask new questions for what is still open rather than re-sending answered
ones; the user changes a sent answer only on purpose, and the change arrives
as a normal Send.

## Options

An option binds to one of:

- a `variant`: picking it puts that variant in use and archives its siblings
  in that state. Add `version` to offer one version of it (`"version": 2`, CLI
  `--option Before=quiet@2`): two options can be two versions of one variant,
  and the picked one is put in use. It needs the question's `state` when the
  mock has several.
- a knob `set`: picking it applies those values live.
- nothing: a plain pill.

Options that change how something looks carry a `variant` or a knob `set`,
so the user sees them live. Plain pills only for what can't be seen.

When one question only makes sense once another is answered (an accent's
placement depends on the palette), give it `after: "<that question's id>"`
(CLI `--after palette`). It stays closed until that one is answered, then its
pictures render with that answer and say so. Ask the deciding question first.

The viewer shows a picture of each option it can render. `multi: true` allows
several answers. Option ids default to the slugged label. Reusing a question
`id` replaces that question. The viewer adds an "Other…" write-in and a note to
every question (both take attached images), so don't add your own; the option
id `other` is reserved.

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

The first fill is the default unless one carries `data-fill-default`. The
server derives a select knob at the part's name and shows only the chosen
fill, so you write no switching CSS; give each fill whatever display it
needs. Draw anything inside a fill, including further parts with fills: one
inside a fill is asked only while that fill is chosen, right after its
parent's question.

Publish returns the parts with fills it found (`fills`) and, for each one no
question sets, a ready `suggestedFillAsks` entry: `scope: "part"`, one option
per fill with `set: {"entry": "<fill>"}`. Send them with `ask`, relabelled if
you like. On a pick the viewer outlines the fill on stage. `fills` in publish
replaces or adds one fill without resending the page (topic `feedback`).

Use fills when the alternatives differ in one region; use variants when the
whole design differs. Both combine: each variant may have parts with fills.

## The variant question

When you publish variants, ask `scope: "mock"` with one option per variant,
and ask it first. Questions appear in the order you ask them. Tune then
offers, per part, to borrow that part from another variant. Variants without
a variant question get a plain switcher in the frame header.

A variant decides everything it differs on; don't re-ask it. Ask other axes as
knob `set`s.

## When you forget to ask

A publish that leaves a state with two or more open variants and no question
binding them returns a nudge and a ready `suggestedAsk` (mock-wide when the
variant names line up across states, else for that state), or your existing
question plus the new variants. Send it as is with `ask`, or write your own
question with options bound to the variants. The CLI prints the `mockpit ask`
command for you. Sending it stops the nudge and keeps your answered question
on the mock; the built-in one is gone once answered.

Until a question binds them, the viewer shows a built-in "Which variant?"
with a picture of each variant, so the user can still choose in one Send. Its
answer reads like any other under the reserved id `variant` (per state:
`variant:<state>`), and puts in use and archives per state. Your own question
over those variants replaces it.
