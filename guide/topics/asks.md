# mockpit topic: asks

An ask is your structured question on a mock. A choice is several variants
plus one ask that binds them. Ask only when the decision is really the user's,
and ask in the mock, never in chat: after asking, tell the user in one line
where to look and end your turn.

```sh
mockpit ask --mock writer "Which look?" --option Quiet=quiet --option Dark=dark --id look
mockpit ask --mock writer "Trim?" --option Above=knob:trim.position=top --option Below=knob:trim.position=bottom
mockpit ask --mock writer --asks asks.json
```

`=knob:` sets one knob; for an option that sets several, use `--asks` JSON.

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

Options that change how something looks carry a `variant` or a knob `set`,
so the user sees them live. Plain pills only for what can't be seen.

The viewer shows a picture of each option it can render. `multi: true` allows
several answers. Option ids default to the slugged label. Reusing an ask `id`
replaces that ask. The viewer adds an "Other…" write-in and a note to every
ask (both take attached images), so don't add your own; the option id `other`
is reserved.

## Slots

A slot is one region with alternative fills, in one html. Give each
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
needs. Draw anything inside a fill, including further slots: a slot inside a
fill is asked only while that fill is chosen, right after its parent's
question.

Publish returns the slots it found and, for each one no ask binds, a ready
`suggestedSlotAsks` entry: `scope: "part"`, one option per fill with
`set: {"entry": "<fill>"}`. Send them with `ask`, relabelled if you like. On a
pick the viewer outlines the fill on stage. `fills` in publish replaces or
adds one fill without resending the page (topic `feedback`).

Use a slot when the alternatives differ in one region; use variants when the
whole screen differs. Both mix: variants are looks, each look may have slots.

## The Look ask

When you publish variants, ask `scope: "mock"` with one option per variant, and
ask it first. Questions appear in the order you ask them. This one is titled
"Look". Tune then offers, per part, to borrow it from another look.
Variants without a Look ask get a plain switcher in the frame header.

A variant decides everything it differs on; don't re-ask it. Ask other axes as
knob `set`s.

## When you forget to ask

A publish that leaves a state with two or more open variants and no ask
binding them returns a nudge and a ready `suggestedAsk` (mock-wide when the
variant names line up across states, else for that state), or your existing
ask plus the new variants. Send it as is with `ask`, or write your own question
with options bound to the variants. The CLI prints the `mockpit ask` command
for you. Sending it stops the nudge and keeps the answered Look ask on the
mock; the built-in one is gone once answered.

Until an ask binds them, the viewer shows a built-in Look ask with a picture
of each variant, so the user can still choose in one Send. Its answer
reads like any other ask under the reserved id `variant` (per state:
`variant:<state>`), and accepts and archives per state. Your own ask over
those variants replaces it.
