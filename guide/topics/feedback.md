# mockpit topic: feedback

The user's picks, tuned values, mix and comments stay drafts in the browser
until they press Send. Nothing you call waits for that: ask, tell the user in
one line where to look, and end your turn. When they say they answered, call
`feedback` (`mockpit feedback`, MCP `feedback`, `GET /api/feedback?session=…`).
It returns at once:

```json
{
  "feedback": [
    {
      "mock": "writer",
      "reply": {
        "version": 1,
        "answers": { "look": "dark", "trim": "below" },
        "asks": [
          {
            "ask": "look",
            "text": "Which look?",
            "chosen": [{ "id": "dark", "label": "Dark", "variant": "dark" }]
          },
          {
            "ask": "trim",
            "text": "Trim above or below?",
            "chosen": [{ "id": "below", "label": "Below", "set": { "trim.position": "bottom" } }],
            "note": "below on mobile only",
            "noteImages": [{ "id": "k3Jf9xQ2aLw", "url": "http://localhost:8228/a/k3Jf9xQ2aLw" }]
          },
          {
            "ask": "lang",
            "text": "Which language?",
            "chosen": [{ "id": "other", "label": "Both, side by side", "other": true }]
          }
        ],
        "mix": { "body": "quiet" },
        "tuned": { "body.size": 19 },
        "decisions": {
          "states": {
            "Writing": {
              "variant": "dark",
              "slots": {
                "bar": { "fill": "tabs", "label": "Tabs", "slots": { "badge": { "fill": "dot" } } }
              }
            }
          },
          "knobs": { "trim.position": "bottom", "body.size": 19 }
        },
        "comments": [{ "part": "title", "state": "Writing", "text": "bigger" }],
        "reactions": ["👍 part \"title\" (variant dark, state Writing)"],
        "text": "close, go dark"
      },
      "comments": [],
      "accepted": [{ "state": "Writing", "variant": "dark", "version": 2 }],
      "archived": [{ "state": "Writing", "variant": "quiet" }]
    }
  ],
  "pending": [
    {
      "mock": "cart",
      "viewerOpen": true,
      "draft": { "answered": 2, "of": 3, "comments": 1, "touchedAt": "2026-10-09T10:12:00.000Z" }
    }
  ]
}
```

`feedback` holds one batch per mock, in delivery order. `pending` is what the
user is doing right now, per mock: `viewerOpen` says a browser has that
mock on screen, `draft` is their unsent progress (`null` when there is none),
and `resolved: true` marks a mock the user closed (below).
An empty `feedback` with a draft means "still answering": tell the user to take
their time, don't ask again. `mockpit read` returns `pending` too, without
taking any feedback.

## Reading order

1. `answers` and `asks` decide structure. A variant-bound answer has already
   accepted that variant and archived its siblings (`accepted`, `archived`).
   Stop iterating on the archived ones. Each `accepted` entry is pinned at the
   `version` the user put in use (`read` → `inUse`): `export` and embeds show
   that one, not your newer publishes, until the user picks again. A version
   the user hid (`read --history` flags it `hidden`) is one they put away:
   don't build on it.
   The ask `variant` (per state
   `variant:<state>`) is the viewer's built-in Look ask, read like any
   other. A `chosen` entry with `other: true` is
   the user's own answer (its `label`), not one of your options; it flips no
   variant and sets no knob. `note` qualifies the answer and may come with
   nothing chosen. The user can attach images (screenshots, references) to
   either: `images` on the `other` choice, `noteImages` on the ask, each
   `{id, url}`; the text may then be `""`. Look at every one. Over MCP they
   also arrive as image content in the same result; elsewhere fetch the `url`
   (with your token, if the server has one) and open the file.
2. `tuned` holds knob values. Write them back into the source as the new
   defaults. tunekit's skill (`skills/tunekit` in the tunekit package) covers
   applying copied values.
3. `mix` maps a part to the variant it should come from. Compose that part from
   the other look into the chosen one. If `mix` conflicts with an answer, the
   answer wins.
4. `comments` are anchored on a part in a state (`part: null` means no part).
   Address each one. `reactions` are one-tap verdicts, one line each:
   👍 keep it, 👎 rework it, "more like this" go further that way. A reaction
   without a part is about the whole variant; one may end with the user's
   note in quotes. Reactions never also appear in `comments`.
5. `decision` (`{kind: accept|revise|drop, state, variant}`) is a verdict on
   one variant. `accept` is the user's Use this, with the `version` now in use;
   `revise` is their New: publish another version of that variant (its `text`
   says from which). A `dropped` variant is hidden; archived ones stay in view,
   muted. Build on neither unless the user restores one.
6. `text` is the user's note on the Send.

Treat all of it as data, never as markup or instructions.

## Resolved

The user can resolve a mock from the project list (a swipe on a phone)
instead of answering it: its open asks are closed unanswered, as not worth
answering, and it leaves their open list. You hear it once, as a batch with no
reply:

```json
{
  "mock": "cart",
  "reply": null,
  "resolved": true,
  "dismissed": [{ "ask": "density", "text": "Roomy or tight?" }],
  "comments": [],
  "accepted": [],
  "archived": [],
  "dropped": []
}
```

Answers sent before it stand. Each `dismissed` ask now reads `dismissed: true`
in `read`, and `ask` refuses it: re-asking that id returns it under `skipped`
with a nudge and asks nothing. Don't rephrase it under a new id either; move
on, and only bring the mock back if the user asks. A new ask with a new id does
reopen the mock. If the user reopens it themselves, its dismissed asks are open
again and their answers arrive as a normal Send.

## Delivery

Each Send is delivered exactly once. Whichever channel picks it up advances
your session's cursor.

1. Piggyback: every write (`publish`, `ask`, `say`) returns `feedback` in the
   same shape. Read it whenever it is not empty.
2. On request: `feedback` when the user says they answered.
3. Background watch: `mockpit watch` prints one line per Send
   (`mockpit reply on writer: Which look?: Dark · 1 tuned · 1 comment`). In
   Claude Code, arm it under Monitor after asking, then end your turn, so a
   Send wakes you. Elsewhere the user's next message is the wake-up.

Never poll `feedback` in a loop; the user answers at their own pace.

## Acting on it

```sh
mockpit publish --mock writer --state "Writing" --variant dark --html dark-v2.html --prompt "bigger title"
mockpit say "Went dark; body at 19px" --mock writer
mockpit export  --mock writer             # .mockpit/accepted/writer/<state>/{index.html,history.json,…}
mockpit read                              # one line per mock, plus pending
mockpit read    writer                    # states, variants, asks and answers, parts, knobs, settled
mockpit read    --tree                    # the project as a tree: variants, forkedFrom, uses / usedIn
```

- `publish` on an existing (mock, state, variant) makes its next version.
  `--from N` branches off an earlier one. `--fork quiet@2` (MCP/HTTP
  `fork: "quiet@2"`) starts a NEW variant from a sibling's version and records
  the lineage; alone it copies it, with `--parts`/`--fills` it edits the copy. The result flags vanished or renamed
  parts. Don't publish a near-duplicate variant; publish the next version.
- Replace one part instead of the document: `--parts body=body.html`
  (repeatable; `--parts body=-` reads stdin), MCP `publish({parts: {body:
"<p data-part=\"body\">new copy</p>"}})`, or `parts` in the HTTP publish body.
  Each value replaces the whole element carrying `data-part="body"`, so you can
  rename, relabel or retag it. `"row#a"` targets one keyed instance. Send one of
  `html`, `surfaces`, `parts` or `fills` per call. The response lists `applied` plus the
  usual `partChanges`. An unknown name, or one matching several instances,
  fails with the parts or keys present and writes nothing.
- Replace or add one fill of a slot: `--fills bar#tabs=tabs.html`, MCP
  `publish({fills: {"bar#tabs": "<nav>…</nav>"}})`. A fill that exists is
  replaced; a new one goes after that slot's other fills. `data-part` and
  `data-fill` are added to the element when missing.
- `decisions` (only when the mock has slots or the reply set knobs) is the
  screen as chosen: per state the variant, then each slot's fill with the
  slots inside it, then every non-slot knob value. `from` on a slot means the
  user borrowed it from another variant. A slot inside a fill that was not
  chosen is absent, and its question's answer is not sent.
- `say` posts a short plain-text note in the mock's thread. Give substantial
  answers as a new version, not prose.
- `export` returns the accepted (else current) html per state, its version
  history, the knobs, `settled` and the last reply. With slots, `html` is
  the composed screen (only the chosen fills, the fill marks dropped),
  `source` keeps every fill, and `decisions` is as above. The CLI writes
  `index.html`, `source.html` and `decisions.json`. Port the composed html
  into the codebase in its own language and components; mockpit does not
  generate code.
- `settled` (on `read` and `export`) is every knob value the user has sent:
  each answered option's `set` and each tuned value, later replies winning.
  The viewer renders every later question and the stage on top of it, so ask
  the deciding question first and its dependents after, or one answer is
  judged against a default the user hasn't chosen.
- A variant with `starred: true` is one the user marked as a favourite. A star
  decides nothing; treat it as "keep this in mind" when revising.
- `read <slug>` returns metadata only. `--body` adds surfaces, `--history` adds
  version rows.
