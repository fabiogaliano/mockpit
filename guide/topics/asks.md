# mockpit topic: asks

An ask is your structured question on a mock. A choice is several variants
plus one ask that binds them. Ask only when the decision is really the user's,
and ask in the mock, never in chat: after asking, tell the user in one line
where to look and end your turn.

```sh
mockpit ask --mock writer "Which look?" --option Quiet=quiet --option Dark=dark --id look
mockpit ask --mock writer --asks asks.json
```

## Shape

The same JSON goes to `--asks`, MCP `ask` and `POST /api/mocks/:id/asks`:

```json
[
  {
    "id": "look",
    "text": "Which look?",
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

`scope` says what an ask decides: `mock` (the default), `state` (add `state`)
or `part` (add `part`, the `data-part` name).

## Options

An option binds to one of:

- a `variant`: picking it accepts that variant and archives its siblings in
  that state.
- a knob `set`: picking it applies those values live.
- nothing: a plain pill.

Make choices visual. An option that changes how something looks (color,
border, radius, spacing, size, font, shadow, layout) carries a `variant` or a
knob `set`, so the user sees it on the stage on hover or tap; declare the knob
it sets. Plain pills are for what can't be seen: copy intent, behavior, scope.
One variant ask plus knob-`set` asks beats several text questions.

The viewer shows a picture of each option it can render. `multi: true` allows
several answers. Option ids default to the slugged label. Reusing an ask `id`
replaces that ask. The viewer adds an "Other…" write-in and a note to every
ask (both take attached images), so don't add your own; the option id `other`
is reserved.

## The Look ask

When you publish variants, ask `scope: "mock"` with one option per variant, and
ask it first. Questions appear in the order you ask them. This one is titled
"Look" and unlocks Mix, the viewer's optional step to borrow a part from
another look. Variants without a Look ask get a plain switcher in the frame
header.

A variant decides everything it differs on. Don't ask again about those
dimensions (accent, voice, navigation): vary variants on one axis, and ask the
other axes as knob `set`s on the chosen variant. A new variant joins the
existing Look ask: resend it under the same `id` with one more option.

## When you forget to ask

A publish that leaves a state with two or more open variants and no ask
binding them returns a nudge and a ready `suggestedAsk` (mock-wide when the
variant names line up across states, else for that state). When an ask of
yours already binds some of those variants, the `suggestedAsk` is that ask with
the new variants added under its own `id`. Send it as is with `ask`, or write
your own question with options bound to the variants. The CLI prints the
`mockpit ask` command for you.

`ask` nudges too: an option whose label reads visual (color, border, spacing,
size, font…) with no `variant` or `set`, or a plain mock-wide ask next to a
Look ask, which likely covers what the variants already decide.

Until an ask binds them, the viewer shows a built-in "Which one?" with a
picture of each variant, so the user can still choose in one Send. Its answer
reads like any other ask under the reserved id `variant` (per state:
`variant:<state>`), and accepts and archives per state. Your own ask over
those variants replaces it.
