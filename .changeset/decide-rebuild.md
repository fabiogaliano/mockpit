---
"mockpit": major
---

The decide rebuild: mockpit is now a design-decision loop. The model is
**project › mock › state › variant › version**. A mock is a page or component
by slug, with ordered **states** named in the user's words, **variants** as
parallel designs of a state, and **versions** as a variant's history. The agent
marks **parts** with `data-part`, asks structured questions, declares **knobs**,
and the user answers everything with one batched **reply**.

- **Mock screen.** One stage per mock with a state strip under it, and a panel
  with Questions · Tune · Thread. Questions are answered in place: options
  bound to a variant or to knob values render as pictures, hover previews them
  on the stage, click picks. The Look question (a mock-wide ask over the
  variants) unlocks **Mix**, borrowing a part from another look. Variants
  without a Look ask get a switcher in the frame header.
- **Tune.** Knobs in tunekit's `usePane` shape (sliders, toggles, selects,
  colours, text, springs, easings, pads, images), global or per part, run live
  on the stage through tunekit's controls. Presets save tuned values per mock in
  the browser. Clicking a part on the stage selects it in Tune, with its
  comments.
- **One Send.** Picks, tuned values, mix and part comments are a server-side
  draft (they survive a reload) until Send; the reply lands in the Thread with
  ✓ sent / ✓✓ seen. A variant-bound answer accepts that variant and archives
  its siblings. A mock without asks keeps Accept / Revise / Drop.
- **Versions** in the frame header (`v3 ▾`); an older version opens under a
  banner with "restore as vN". A new version arriving mid-answer keeps the
  draft bound to the version it was made on.
- **Home** lists the project's mocks: thumbnail, states, open questions, age,
  and "Answer next ›".
- **Theme.** One dialkit palette, dark and light, toggled from the top bar and
  persisted per workspace.
- **Parts bridge.** Html frames report each part's box, measured in the frame
  and tagged with the document version; the host sends
  `hit`/`highlight`/`clear`/`scroll`/`knobs`. Knob values reach the html as
  unitless `--k-<path>` vars, `data-k-<path>` attributes, `[data-k-bind]` text
  and a `mockpit:knobs` event, baked into `/s/:id?k=…` for first paint and
  validated against the declared knobs.

New agent surface, the same on all three tiers:

- **MCP:** `publish_mock`, `revise_mock`, `ask_user`, `wait_for_feedback`,
  `reply_to_user`, `list_mocks`, `get_mock`, `export_mock`, `upload_asset`,
  `get_design_guide`, and `add_surface` / `edit_surface` / `remove_surface` /
  `reorder_surfaces`.
- **CLI:** `mockpit publish --mock <slug> [--state s] [--variant v] [--knobs …]`,
  `revise`, `ask` (`--option Label=variant`, or `--asks` with scope
  mock/state/part, options bound to a `variant` or a knob `set`, `multi`),
  `wait`, `watch`, `comment`, `status`, `show`, `export`, `surface`.
- **HTTP:** `/api/mocks` (publish), `/api/mocks/:id/revise`, `/asks`,
  `/export`, `/surfaces`, and `GET /api/comments?session=…&author=user&wait=N`.
- Publish and revise responses list the parts found per state, flag parts that
  vanished or were renamed, and nudge when a knob has three or fewer discrete
  options (a decision dressed as a control: ask instead).
- `wait_for_feedback` returns one batch per mock: the reply's answers (with the
  chosen options), mix, tuned values, part comments, note and decision, plus
  the variants accepted and archived. Delivery stays exactly-once across
  waits, `watch` and the `userFeedback` piggyback.

Removed: the item/post/snippet model and its routes (`/api/projects/:name/items`,
`/api/posts`, `/api/surfaces`, `/api/snippets`, `/session/:id`, `/p/:id`),
`?part=`, the item/post MCP tools and every deprecated alias
(`publish_item`, `publish_post`, `publish_surface`, …), the CLI's `page`,
`list`, `sessions`, `update`, per-kind shortcuts, `test-post` and `trace*`
commands, the trace path, the github/gruvbox/one themes, the embeddable viewer
engine (`mockpit/viewer-embed`), and the JSON file store (`MOCKPIT_STORE=json`)
with its JSON→SQLite import.

Migration: SQLite workspaces (local and Durable Object) migrate in place on
first boot — each item becomes a single-state mock with its variants and
history; comments keep their ids and sequence numbers; unsent draft comments
become the mock's draft. If you run `MOCKPIT_STORE=json`, start your current
version once without it before upgrading (`env -u MOCKPIT_STORE mockpit serve`)
so it copies `~/.mockpit/mockpit.json` into the still-empty
`~/.mockpit/mockpit.db`.

The viewer now bundles [tunekit](https://github.com/fabiogaliano/tunekit) for
Tune's controls.
