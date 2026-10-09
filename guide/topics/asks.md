# mockpit topic: asks

An ask is your structured question on a mock. Ask when two renders are needed
to show a choice, and only when the decision is really the user's.

```sh
mockpit ask --mock writer "Which look?" --option Quiet=quiet --option Dark=dark --id look
mockpit ask --mock writer --asks asks.json
```

## Shape

The same JSON goes to `--asks`, MCP `ask_user` and `POST /api/mocks/:id/asks`:

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

The viewer shows a picture of each option it can render. `multi: true` allows
several answers. Option ids default to the slugged label. Reusing an ask `id`
replaces that ask. The viewer adds an "Other…" write-in and a note to every
ask, so don't add your own; the option id `other` is reserved.

## The Look ask

When you publish variants, ask `scope: "mock"` with one option per variant, and
ask it first. Questions appear in the order you ask them. This one is titled
"Look" and unlocks Mix, which lets the user borrow a part from another look.
Variants without a Look ask get a plain switcher in the frame header.
