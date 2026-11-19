# Migrating a mockpit project to picks and looks

For an agent told "migrate this project to the new conventions" in a repo whose mockpit
designs were made before picks, looks, the Sheet and Use. You need nothing else: this file
says what changed, how to find each old pattern, the commands that adapt it, and what to hand
the user at the end.

The model now: the user compares frames, marks **Main** (`M`), **Bookmark / Keep** (`K`),
or **Delete** (`X`, silent tombstone in `ruledOut`), saves knob values as **looks**, and
presses **Use** to put their choices in the product. None of that needs a question. When all
items of an idea ship together (such as morphing hero drawings that each need their own glyph
and colour style), mark the idea a **Set** (`--set`, `Keep all`): each item keeps its own
per-knob `★ Main` and all live items ship on Use. You publish what varies as alternatives or
a choice knob, and ask only when a choice blocks your next step.

## Ground rules

- What the user made stays as they made it: marks (Main, Bookmark/Keep, Delete), looks,
  answers, kept and archived answers, and spec sections they wrote by hand (`spec.held`).
  Read them and build on them.
- Use only the reversible moves below: an `edit`, a new version, a look added beside the
  user's, a re-asked open question with the same ids. Archive, move, hide or delete nothing.
- A design the user is answering right now (`pending` names its draft in `mockpit read`)
  waits: adapt the others, and list it.
- A design whose intent you can't tell goes on the list for the user, untouched.

## 1. What changed

| Before                                                                  | Now                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reply.tuned`: values for the whole design                              | `reply.tunedOn`: `{alternative: {path: value}}`, a tune per frame. `tuned` holds the Main frame's (else the one in use or on screen) for one release                                                                                                                                            |
| `reply.more`, `reply.update`: one of each per Send                      | `reply.requests`, every request in order: `{kind: "more" \| "update" \| "revise" \| "state" \| "draw", …}`. `more` and `update` are the first of their kind, resolved; `moreAlso` and `updateAlso` the rest                                                                                     |
| `verdict: {kind: "revise"}`: the one New version                        | every `revise` in `requests`; `verdict` repeats the first                                                                                                                                                                                                                                       |
| nothing                                                                 | `reply.lines`: the Send in the user's words, one line each, as their Send list showed it                                                                                                                                                                                                        |
| `verdict: {kind: "use"}` from Use this: one alternative                 | Use: `verdict.picks`, Main first, each `{state, alternative, version, main?, look?, values?, tuned?, as?}`. On a **Set** (`set: true`), every live frame ships wearing its accumulated `★ Main` knob combo (e.g. glyphs + colour). `lines[0]` reads "Use in <target>: …"                        |
| `combos` on `read`, `reply.combo`                                       | gone. `looks` hold knob values by name; `marks` hold per-frame/per-knob Main, Keep and Delete                                                                                                                                                                                                   |
| kept answers (`standings.kept`)                                         | still there, and each also reads as `keep` in `marks`, with its `answer`                                                                                                                                                                                                                        |
| nothing                                                                 | `read <slug>`: `set` (`boolean`), `marks` (`{kind: main \| keep \| deleted \| archived, state, alternative, look?, values?, at, by}`; legacy `pick` normalizes to `keep`; `deleted` emits a silent tombstone into `ruledOut`), `looks`, `settledOn`; a screen's or component's read: `usedFrom` |
| `publish` / `edit`                                                      | adds `--set` / `--no-set` (MCP/HTTP `set`), `looks` (`--looks <json\|file>`: alone, no new version), and `sheet` (`--sheet <knob>`: an idea's link opens on that knob's Sheet)                                                                                                                  |
| auto-popping `"Which alternative?"` panel                               | retired: plain Focus stays quiet with no agent question; opening a Sheet cell (`?alternative=&sheet=&value=`) opens the Knob Choice Panel + Side-by-side finalist grid                                                                                                                          |
| nudge "N alternatives and no question binds them" with a `suggestedAsk` | gone: the user marks without a question. The nudge for answers mockpit added to your own question stays                                                                                                                                                                                         |
| nudge "a 2–3 option knob is a choice: ask"                              | gone: a choice knob is what the user Spreads                                                                                                                                                                                                                                                    |
| nothing                                                                 | word caps, nudges only: `edit` purpose over one sentence, a behaviour line over 14 words; `ask` answer labels over 6 words                                                                                                                                                                      |
| `pending.draft {answered, of, comments}`                                | adds `requests`                                                                                                                                                                                                                                                                                 |
| `mockpit watch`: `Quiet or dark?: Dark · 1 tuned`                       | the Send's `lines`, joined with `·`                                                                                                                                                                                                                                                             |
| words: Use this, Pick, combo, Drop                                      | Use, Main (`M`), Bookmark / Keep (`K`), Delete (`X`), Look, Set (`Pick one` \| `Keep all`). Also: Frame, Spread, Sheet                                                                                                                                                                          |

A Send or a Use archives nothing; an answer releases the other alternatives from use.

## 2. Find what to adapt

```sh
mockpit read                    # every design; "· N variants" marks a variants design; pending
mockpit read --tree --json      # instanceIn: the screens that include each design
```

Then save this script outside the repo (say `/tmp/mockpit-inventory.mjs`) and run
`node /tmp/mockpit-inventory.mjs` in the repo. It prints each design with an old pattern:

```js
// Lists the designs of this project that follow patterns from before picks and looks.
import { execFileSync } from "node:child_process";
const read = (...args) =>
  JSON.parse(execFileSync("mockpit", ["read", ...args, "--json"], { encoding: "utf8" }));
const words = (t) => t.split(/\s+/).filter(Boolean).length;
const tree = new Map(read("--tree").tree.map((d) => [d.slug, d]));
for (const row of read().designs) {
  const d = read(row.slug);
  const out = [];
  if (row.variants && !(tree.get(row.slug)?.instanceIn ?? []).length)
    out.push(
      `variants design no screen includes (${row.variants} variants): a gallery to choose from, or a Set?`,
    );
  for (const [path, k] of Object.entries(d.knobs ?? {})) {
    const choice = (k?.type === "select" || k?.type === "image") && k.options?.length > 1;
    if (choice) out.push(`choice knob "${path}" (${k.options.length} values): Spread-able`);
  }
  for (const a of d.asks ?? []) {
    if (a.answer !== undefined || a.dismissed) continue;
    if (a.options.length && a.options.every((o) => o.alternative))
      out.push(`open question "${a.id}" only picks between alternatives`);
    const long = a.options.filter((o) => words(o.label) > 6);
    if (long.length)
      out.push(`open question "${a.id}": ${long.length} answer label(s) over 6 words`);
  }
  const s = d.spec;
  if (s) {
    const held = s.held ?? [];
    const sentences = (s.purpose ?? "")
      .split(/(?<=[.!?])\s+(?=\S)|\n+(?=\S)/)
      .filter(Boolean).length;
    if (sentences > 1)
      out.push(
        `purpose has ${sentences} sentences${held.includes("purpose") ? " (the user's words: leave)" : ""}`,
      );
    const over = (s.behaviour ?? []).filter((l) => words(l.text) > 14).length;
    if (over)
      out.push(
        `${over} behaviour line(s) over 14 words${held.includes("behaviour") ? " (the user's words: leave)" : ""}`,
      );
  }
  if (d.usedFrom?.length)
    out.push(
      `entries used from ${d.usedFrom.map((u) => u.slug).join(", ")}: is the code built from them?`,
    );
  const activeMarks = (d.marks ?? []).filter((m) => m.kind === "main" || m.kind === "keep").length;
  if (activeMarks) out.push(`${activeMarks} mark(s) by the user: build on them`);
  if (out.length) console.log(`${row.slug} (${row.kind})\n  ${out.join("\n  ")}`);
}
```

Code of your own that reads replies (a harness, a hook, saved notes) is the other place old
patterns live: search it for `tuned`, `.more`, `.update`, `verdict`, `combo` and `Use this`.

## 3. Adapt each pattern

### A variants design used for exploration (Pick one vs. Keep all Set)

Signs: a screen or component with variants (`· N variants`) that no screen includes, where the
user is still styling or choosing between entries.

First check whether **one** entry ships (a `Pick one` idea) or **all** entries ship together
(a `Keep all` **Set** idea, `--set`). For example, `hero-drawings` is a **Set** — all eight
drawings belong in the hero and morph from one to the next on click, while each drawing needs
its own glyph style (`figure.glyphs`) and colour (`figure.colour`). Treating a Set as a
pick-one gallery breaks the user's mental model because they are choosing knob styles _per
item_, not picking one drawing to discard the rest.

Leave it when a screen already includes it (`instanceIn` in `read --tree`; `edit` refuses
anyway). When you can't tell whether the entries compete or all ship, list it.

```sh
# Collection where every item ships together, styled per item via choice knobs (a Set):
mockpit read home-hero-two-blocks-of-colour --json   # its states: here ["Home"]
mockpit edit hero-drawings --no-variants --kind idea --set \
  --for home-hero-two-blocks-of-colour --first-state Home
mockpit read hero-drawings                           # now a Set idea for the hero, state Home

# Competing options where only one winner ships (omit --set):
mockpit edit card-layouts --no-variants --kind idea --no-set \
  --for catalog --first-state Default
```

`--first-state` names the gallery's one unnamed state after the target's state the frames
belong in, so a Use copies into it; drop it when the gallery's states already carry the
target's names. Its variants become alternatives under the same names, and its knobs stay.
When a Set with `--becomes screen|component` is used, Mockpit creates the target with
`variants: true` automatically so every named item is preserved with its baked `★ Main` knob
defaults.

A gallery whose named states differ from the target's has no rename: `move --to-state` copies
the frames and archives the originals, leaving any marks on the archived ones. List it.

### A dropdown the user needs to compare across frames

Signs: a knob that varies the look of every frame (`marks`, `style`, `layout`), which the user
had to flip one value at a time.

A `select` or `image` knob with options is a choice knob already: Tune shows Spread beside it,
and each frame keeps its own tune (old design-wide tunes were copied to every frame). When
comparing is the point, give the user the Sheet. On an idea, add `?sheet=<knob>` to its link:

```text
http://localhost:8228/project/<project>/hero-drawings?sheet=marks
```

On a screen or component the user's Spread opens an idea for it, holding copies of its
frames, so give them the design's own link. From now on, a publish to an idea that should open
on the grid takes `--sheet marks` and returns that link.

A slider or text knob standing for a few named styles is no choice knob. Make it one in the
next version, with html that reads `data-k-<path>` (topic `knobs`):

```sh
mockpit publish --design hero-drawings --state Home --alternative flowers --html flowers.html \
  --knobs '{"marks": {"type": "select", "options": ["dots", "petals", "peaks"]}}'
```

Knobs are design-wide, so one publish declares it for every frame.

### Questions asked only to let the user compare

Signs: an open question whose every answer is an alternative (the inventory says "only picks
between alternatives").

Leave it open: answering it still works, and records the same pick the frame's tick does.
Nothing removes a question but the user. What changes is the next round: publish the frames,
say where to look, and read `marks` and the Send; ask only when a choice blocks your next step.

### Saved combos

Gone, with nothing to read: `read` no longer lists `combos`. If your notes give a combo's knob
values, add them as a look under its name, which makes no new version:

```sh
mockpit publish --design hero-drawings --looks '{"Warm": {"marks": "petals"}}'
```

A look the user already named that way stands, and the result's nudge says so. The answers a
combo held are the user's picks now. A combo you can't reconstruct goes on the list.

### Code that reads `tuned` as design-wide

```js
// Each frame's tune; a reply from before tunedOn tuned every frame alike.
const tunes = reply.tunedOn ?? { "*": reply.tuned ?? {} };
for (const [alternative, values] of Object.entries(tunes)) applyDefaults(alternative, values);
```

`read` has the settled values the same way: `settled` for the design, `settledOn` per frame.

### Code that waits for `more`, `update` or a revise verdict, one of each

```js
for (const r of reply.requests ?? []) {
  // more | update | revise | state | draw, in the order the user asked
}
const mores = [reply.more, ...(reply.moreAlso ?? [])].filter(Boolean); // resolved more requests
const updates = [reply.update, ...(reply.updateAlso ?? [])].filter(Boolean);
```

Show the user `reply.lines` when you repeat back what they sent: it is what they read.

### Treating "In use" as the end

A `verdict` `{kind: "use"}` is an instruction to change the code: build each of `picks` into
the product, Main first, in its look or values, and read `usedIn` for where mockpit copied
them. A screen's or component's read names the ideas it was used from in `usedFrom`, and
Focus shows the user "From idea: …" there.

For each design the inventory says has `usedFrom`, check the code against
`mockpit export --design <slug>`. Building what's missing is feature work, not migration: list
each one whose code you can't confirm.

### Spec text and answer labels over the caps

A purpose is one sentence, a behaviour line at most 14 words. Skip a section named in
`spec.held`: the user wrote it. `--behaviour` replaces every line, so send them all:

```sh
mockpit edit home-hero-two-blocks-of-colour --purpose "Sets the site's tone at first sight."
mockpit edit home-hero-two-blocks-of-colour \
  --behaviour '[{"text": "Scrolling past fades the drawing and slides the blocks apart", "state": "Home"}]'
```

An answer label is at most 6 words. Shorten one only on an open question of a design with no
pending draft, and keep every option `id`, so the user's kept, archived and drafted answers stay
on the same answers. Read the question, shorten the labels in place, ask it again:

```sh
mockpit read hero-tone --json | node -e '
  const a = JSON.parse(require("fs").readFileSync(0)).asks.find((q) => q.id === "tone2");
  console.log(JSON.stringify([a]))' > /tmp/tone2.json
# edit the labels in /tmp/tone2.json, nothing else
mockpit ask --design hero-tone --asks /tmp/tone2.json
```

An answered question stays as it was sent.

## 4. Hand over

Done when the inventory, run again, prints only informational lines (choice knobs, picks,
`usedFrom` you checked) and designs on your list. Then tell the user, in a few lines:

- what you changed, one line per design;
- the Sheet links worth opening;
- the list: each design you left, and why (intent unclear, a draft open, states that don't
  match, code you couldn't confirm, a combo you couldn't rebuild).
