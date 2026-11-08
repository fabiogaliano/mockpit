# Changelog

## 4.0.0

### Major Changes

- dc9f67f: Mockpit speaks the industry's words, with no aliases: a 3.x client (stdio MCP server, CLI, `mockpit watch`, the pi extension, the plugin) must be upgraded with the server. What you choose between is an **alternative**: `publish --alternative <name>`, `alternatives` in reads and the tree, question options bound with `alternative`, and the built-in question reads "Which alternative?" (MCP and HTTP the same; `--variant` on an idea now fails, naming `--alternative`). A **variant** is a form that ships: `publish --variants` or `edit <slug> --variants` says a screen's or component's entries all ship (a component's sizes, tones or feelings), so they are named with `--variant`, `read` lists them as `variants`, and nothing on it is chosen or nudged into an idea; `--no-variants` turns it off. Stored replies, drafts, questions, kept answers, forks and copies are rewritten in place on the first boot. What can go in a part is a **swap**: `data-swap` (with `data-swap-label`, `data-swap-default`), `publish --swaps part#swap=file` (MCP and HTTP `swaps`), an answer's `swap` beside its `set`, `suggestedSwapAsks`, and export's `allSwaps` and `all-swaps.html`; stored pages say `data-swap` on every part that had the old attribute. An included component is an **instance**: `<mockpit-instance slug="card">` (its wrapper says `data-mockpit-instance`), `instances` and `instanceIn` in reads and the tree, and the design screen's panel for them is titled Instances; stored pages, current and past, are rewritten to the new tag. A named combination of answers is a **combo** (`combos` on `read`, a reply's `combo`, Combos beside the design), and what the project's replies settled is its **decision log** (`decisionLog` on every read). A design opens by what it is, and nothing is remembered per design: a question the agent is waiting on opens Answers, an idea opens in Studio, a screen or component on Stage with **All states** as its second view, and a variants design as its grid. Each level has one status ladder, capitalised wherever it shows: a screen or component reads In design, Ready or Changed; an idea Exploring or In use in <target>; an alternative Kept, In use or Archived; a version current or Hidden. Taking an answer out of a question reads Archive, and Studio's bookmark reads **Keep**, with **Move** beside it.

  Renamed with the words, each breaking for anything that used the old name:

  - Routes: `/api/designs/:id/variants/archive`, `/restore`, `/:postId/poster` and `/:postId/restore` are now `/api/designs/:id/alternatives/…`.
  - The renderer's `/s/:id?embed=` is now `?instance=`, and the viewer's `?variant=` link key is now `?alternative=`, so an old link loses the alternative it named.
  - The push and webhook payload's `variant` is now `alternative`, and so is the event log's field.
  - A design's notes are now its **spec**: `edit --notes` and `notes` are gone; write `edit --purpose` and `edit --behaviour` (MCP and HTTP `purpose`, `behaviour`). `edit --area-order` and `areaOrder` are gone too: `edit --areas` and `areas`, on every tier including the pi extension. Existing notes and area orders move over in place.
  - `export` of a screen or component writes each entry as `<state>/<alternative>.html` with `<alternative>.history.json` (the start of the post id added where two names would share a file), plus `design.json` with its Ready mark, its spec and the components those versions are built from. Scripts that read a product design's `<state>/index.html` must read the entry's file instead; an idea still writes `index.html`.

  A design carries its own record, so decisions stop living in side files: the spec reads What it is for, How it works and Decisions (the design's lines of the decision log). Agents write it with `edit --purpose` and `edit --behaviour "…" --state Now --part river`, and a line pinned to a part shows as a numbered pin on the stage while the Spec panel is open. A section you write by hand stands against agents until you clear it, and the agent hears your edit as `edited.spec`; a screen or component with no spec, or with decisions newer than it, is nudged on publish and in its feedback. Areas say what they are for (`edit --project <p> --area Food --description "…"`, or in place on the area page), and so does the project; `read --area Food` (MCP `read` with `area`, `GET /api/projects/:name/areas/:area`) gives an agent everything settled in one area, and Home's area page is the same view: description, screens, flows, components, decisions and the ideas waiting. Home's sidebar is now Product (Screens, Flows, Components, System), then the areas, then Ideas, and opens on the product.

### Minor Changes

- 75f6340: Components form a library. A component with no area is shared, and `--group` files it by what it does (Actions, Inputs, Navigation, Feedback, Containers, or your own word; `publish --group`, `edit <slug> --group`, and the same on MCP and HTTP). Home's Components page shows Shared first, under its groups, then each area's own, and the sidebar opens Components into Shared and each area with components, each its own page; About on a component says "Shared · Cards" or its area, and the System page lists the shared ones first. A component of one area that screens of several areas show is offered a move to shared (About's Make it shared, and a nudge on publish and in feedback), never moved by itself. When you mark a screen Ready, the agent hears `followUps.lift`: the pieces the screen draws itself, where else each name appears, and any copy of a library component drawn inline. It swaps the copies for instances, lifts the rest into components the screen includes, and asks "Still iterating on any of these?"; your answer marks the screen Ready again at that version and every lifted component you didn't choose Ready, which Instances then shows. `mockpit edit` also takes the design's slug first (`mockpit edit receipt --area ''`).
- 7d59868: A flow can start as an idea. An idea with `becomes: flow` is a story in rough steps: its states are the steps, in order, and it opens on Stage with the flow bar named after it, so you can walk it with Try. Use this on it copies nothing: the batch's `followUps` carry `placeFlow` (the steps, each with the alternative it shows, and the screens of the idea's area), and the guide tells the agent to put each step on a screen (an existing state, a new state, or a planned screen), place the flow, set the idea's `for` to `flow:<name>`, and ask you one question on the idea to confirm, step by step. A flow step may now name a state that is declared and not drawn yet: `flow` alone on a screen's new state declares it there, `read` marks the step `planned`, and Home draws it as Not drawn. The Flows shelf says how many of each area's screen states no flow walks; a screen's cover says nothing of it.
- c6a1467: A decision now says what it requires. Each feedback batch carries `followUps`, worked out by mockpit from the reply and what it changed, each by what and where: `apply` (an alternative used in a design whose states it couldn't drop into, to publish there), `gaps` (the states, or on a variants design the variants, the design has that the used alternative doesn't draw), `instanceIn` (the screens and components that show a component that just changed, by a use or by the agent's publish of a new version, each with whether it is Ready), `spec` (product designs whose decisions are newer than their spec, with the count) and `lift` (a screen just marked Ready, as before). The guide tells the agent to update a spec and apply on the target itself, and to bring the gaps and anything that touches another design back as an idea for it with one question, so you choose. `read` without a design lists each design's follow-ups still open under `pending`, so an agent that restarts finds them (up to 40 designs, each list up to 40, with how many more), and the CLI's `watch` and `read`, MCP and the pi extension print them. Nothing new to look at in the viewer: what the agent does shows in the Thread, and what needs you arrives as a question.
- 34d7d55: Ideas know what they are for. An idea names the screen or component it explores (`publish --for onni`, `edit onni-lab --for onni`, `"for"` on MCP and HTTP), or, for nothing yet, what it would become (`--becomes screen`, `component`, `flow` or `system`); a publish nudges an idea that says neither and looks like it is for a design. On such an idea the button reads "Use in Onni": the version you use is copied onto Onni as the next version of the state of the same name, current at once with the way back a newer version has, and you stay in the idea, which reads "In use in Onni". When the idea draws it in a state Onni lacks, nothing is copied and the agent hears `followUps.apply` with the states that matched and those missing. An idea that would become a screen or component makes it on first use and is then for it. The agent exploring for a design reads what that design already turned down (`target.ruledOut`: archived alternatives, archived answers and its decisions' "Not:") on every read of the idea and in each reply on it. A screen or component lists its ideas folded under the states and in Studio's bar ("Ideas · 2"), its cover on Home carries a quiet count that opens the Ideas shelf showing only those, and the Ideas shelf groups by Area, For or In use, remembered per project. New idea is typed by where you start it: a shelf gives what it would become, the area in view its area, and a design's ⋯ "New idea for this" what it is for. `read --tree` carries `for`, `becomes` and `ideasFor`, and `read --area` groups the ideas waiting by what they are for.
- 7f5c242: One choice, one question: an agent's alternative question now shows every live alternative it decides between, adding the ones the agent left out (by name, "Not in the agent's question"), so a second "Which alternative?" no longer follows it with the same choices again. Archiving an alternative answer archives that alternative, with your reason, and bringing it back (from the question, Studio or `move --restore`) restores the answer, so archived answers never reappear elsewhere.
- ec6148a: A screen or component now has one mark, **Ready**: a click beside its name says this is the version, and it turns blue, **Changed**, by itself when something newer shows, back to Ready when you go back to the marked version or mark it again. Marking a screen marks the components inside it too, and a dot on the mark says when one inside isn't Ready; Instances gives each its word, and Home's covers carry a small dot that opens into Ready or Changed (the word sits in the status line on a phone, where an unmarked one reads In design). Product designs have nothing to choose between any more: no Use this, no Which alternative?, nothing put in use by a Send (`use` answers 409 with the reason); the newest version is current, and one still holding alternatives says so, with a nudge to move them to an idea. Agents read it everywhere (`read`, `read --tree`, `read --area`: `ready`, `changed`, `status`, `builtFrom`), hear your mark as `edited.ready`, can't amend or withdraw a version you marked, and `export` hands over every entry at its Ready version with the spec and what those versions are built from (from the CLI, each entry as `<alternative>.html` and the rest in `design.json`), which is what a build plan points at.
- 4f7f2fe: View in holds Light | Dark for the designs alone, apart from mockpit's own theme: a light product can be worked on in a dark mockpit. The pick is kept per project and shows everywhere the project's designs do (Stage, Studio, Home, answers) until you pick again; the artboard names it, and the tool's swatch shows it. View in now shows once a project has one palette, and a palette with one mode says so.
- d5a524c: Keep and Archive appear only on answers with a design behind them (an alternative, knob values or a palette); an answer that is only words is just picked. A question can say its answers are all there are with `allowMore: false` (CLI `--no-more`), as in a Yes or No check: the viewer then offers no More like this and no More answers, and the server refuses a request for more on it.

### Patch Changes

- b8c9514: A words-only answer with a description grows to hold it: the card no longer stays one line tall with its name and description spilling past its edges, and the description lines up under the name.
- 7f5c242: Answer cards: a click picks the first time, even while posters or a new version arrive (the cards were rebuilt under the pointer); resting on a card, the picked one included, previews it after 0.75s with the dashed outline fading in over the wait, instead of 2s with a countdown ring; hovering adds no border; and "New" is a quiet tag after the answer's name, before the agent's-pick dot, instead of a white chip on the picture.
- eb6c155: `edit`'s `areas` takes the `{name, description}` objects `read` returns as well as plain names, on every tier (`mockpit edit --areas` also takes that JSON list), so a read sent back round-trips. Only the order is taken from it; a description is still written with `description` and `area`.
- 8a5a1b9: A screen or component has a way back after any new version or use, marked Ready or not: a Back pill to the version shown before (the Ready one when marked), with no countdown. Back is a stay, so the design shows that version until something newer comes, which takes the stage again; on an unmarked design × keeps the newest and puts the pill away. `stay` no longer answers 409 on a design with nothing marked Ready, only on an entry with no earlier version.
- 9145059: `mockpit edit --behaviour` now replaces every line, as MCP and HTTP do: text is the one line (with `--state` and `--part`), a JSON list keeps several, `""` clears. The CLI no longer reads the spec and appends, so an edit made in between is never lost; to add a line, send the lines you read with it.
- acdac77: `mockpit demo` seeds Writer as an idea again, so answering its question puts the chosen alternative in use. As a screen it had nothing to choose between: the answer settled nothing and the design was told to move its alternatives to an idea.
- 9fe26fd: A flow-only publish of a state an idea hasn't drawn yet now says to draw it, instead of suggesting `"kind": "screen"`, which would have turned the idea (a flow idea too) into a screen and lost what it was for.
- b47ef46: A flow reads a status derived from its steps, with nothing stored: Ready when every step's screen is Ready, Changed when any is Changed, else In design (a step with nothing drawn keeps it In design). It is in `read`, `read --area`, `read --tree` (and the CLI and pi lines), and Home's Flows rows show the word beside the step count.
- 7f5c242: After `/clear` in Claude Code, the stdio MCP server, the CLI and `mockpit watch` follow the new conversation instead of staying on the old one's session: a reply that wakes the agent is now one its `feedback` call takes, so the viewer says Delivered. A watcher whose conversation was cleared exits instead of holding its session "listening". The "is listening" note beside a sent reply is a chip of the same row.
- f19449b: The guide, both skills, the CLI and the pi extension now say a batch's `gaps` are the user's to choose: publish an idea for the target with the missing states or variants drawn and one question, never writing onto the product design.
- 6715d76: `group` on `publish` or `edit` of anything but a component now fails (400) with a message naming `"kind": "component"`, instead of being stored where no library lists it. The guide and both skills now say not to offer what a design turned down again unless the user asks, rather than never.
- 6009d5b: Over `/mcp`, `read`, `export` and `guide` take the `session` a write returned, as the other tools do: a bare read lists that session's project with its open follow-ups instead of every project, `tree` and `decisions` read it instead of failing, and a call that names neither project nor session says so.
- 9f10657: A screen with a state declared but not drawn no longer says "2 alternatives" on its cover. Keep's confirmations say "Kept … in …" (and "Couldn't keep …"), not "Saved". An opened decision you reworded no longer prints its text twice. The CLI help names `read --tree`, `--variant` on `say`, `move` and `export`, and the new `publish --alternative-knobs`; `move` no longer says a group goes along.
- d24402e: A screen or component still holding alternatives now offers **Move into an idea** in its margin: one click makes an idea for it, copies every alternative of those states there, archives all but one on the design (its default, else the oldest), tells the agent in the Thread, and opens the idea so you choose there. The agent's nudge to move them is said once per design instead of on every read and publish.
- 4243a10: A publish whose html still uses the old words, `data-fill` on a part or `<mockpit-embed>`, now gets a nudge naming `data-swap` and `<mockpit-instance>`, instead of publishing silently without its swaps or instances. Nothing is rewritten or aliased.
- 179c02b: On a phone, a flow with a step not drawn yet no longer makes Home scroll sideways and drop into the desktop layout, and a screen's Ready mark is an icon beside its name, so the name no longer shrinks to one letter.
- 41b568e: pi extension: the reply watcher now peeks, so a Send stays on the session until `mockpit_feedback` or the next write delivers it, and a wake names where to look; a batch it has no line for (a request for more answers, a change to the system) is no longer consumed unseen. Every write's piggybacked feedback carries the batches whole after its lines. `mockpit_publish` gains `flow`, `step`, `swaps`, `fork`, `amend`, `withdraw`, `description`, `widths` and the `idea` kind, and its `for` names `flow:<name>`; new `mockpit_move` and `mockpit_system` tools; `mockpit_read` gains `tree` and `decisions`, and a bare read lists flows and the decision log.
- 72c0c03: The design screen's top bar no longer repeats the design's status beside its name; the questions, notes and Thread already say it.
- 98b3160: The offer to move a component to shared now comes only on that component's own publish and feedback batch, once, and says the user decides: a screen's writes, and the user's Ready mark on it, no longer carry a line for every component it shows. The guide tells the agent to ask the user before `edit <slug> --area ''`.
- 85fd69d: A screen's or component's spec now holds the decisions made on the ideas that are for it, each labelled "From <idea>: …", on every tier, in the viewer's Spec and in `export`. They count toward the spec nudge and `followUps.spec`, so a use from an idea tells the agent the spec is behind.
- 4a1a694: Two publishes that add states to one design at once now both keep their state: a flow step declared on a screen while another state is drawn there, or two new states drawn together, no longer leave one undeclared or missing from its flow.
- b292ade: An idea's `status` is capitalised like every other status word: "Exploring" and "In use in <target>" (a count of waiting questions stays "2 questions"), in `ideasFor`, the tree and the area view. Studio's tags read "In use".
- 7f5c242: System place: palette rows stack light over dark with aligned columns at any width, contrast reads "Contrast passes" or "N contrast fails", the header drops the revision number and the long change summary, components list without placeholder text, and going back from a component returns to the tab you left.
- 9ce2ac1: Using another alternative of an idea onto its screen or component replaces the entry the idea's last use landed on, instead of adding one more. On a variants design, or a state holding several entries, a first use whose name no entry has adds an entry, and the reply says so: `usedIn.copies[].added` and a plain `usedIn.note`; the viewer's toast says it was added beside what the design had.
- e298f9f: A variants design's entries are `variant` everywhere an agent reads them: `move`'s result (`variants`, `skipped`, `versions`, `saved`) and a feedback batch's `verdict`, `inUse`, `archived` and messages now say `variant`, as `read` and `publish` already did; every other design still says `alternative`. `mockpit watch` (and so the Claude Code plugin's wake) now wakes on a batch from the System page alone, printing what changed, as the pi extension does.
- 5e21a76: Withdrawing an alternative's only version, and taking an undrawn state out of a flow with `step: 0`, now return `sessionId` like every other write. Over stdio MCP the withdraw failed output validation after it had delivered the feedback it carried, so a user's Send on another design was lost.

## 3.1.0

### Minor Changes

- fb5e26e: Each project has a **system**: what every one of its designs wears. It holds a shared stylesheet with its classes, fonts, typed tokens, type and space scales (fixed or fluid), colour roles and palettes, contrast pairs and project knobs. A new verb, `system` (MCP `system`, `mockpit system`, `GET`/`PUT /api/projects/<name>/system`), reads and changes it, and each change applies at once to every design. Every change is a revision you can restore. A name has one owner: a write that would give a token, scale step, role or a name the repo declares a second owner fails and names both. An agent's restore leaves what the user decided standing (palette statuses, settled project knobs) and says what it kept.

  - Upgrading moves what each project stored before into its system as revision 1 (palette, kit, project kits, icon sets and what `mockpit init` read). What the repo's code says becomes repo-owned tokens and a `repo` palette, which only rerunning `init` changes.
  - New versions render in cascade layers (`@layer mockpit, kit, system`), so a page rule beats a sheet rule at plain specificity. In a Tailwind project, Tailwind's preflight sits under the sheet and its utilities over it. Versions published before stay as they were approved.
  - A question can choose a palette: an option's `palette: "<id>"` (CLI `--option Grape=palette:grape`) is pictured in that palette. Sending it makes that palette the default and keeps the old default. Keep and Hide on its answers keep or hide palettes.
  - Project knobs reach every render. An answer's `set` on one settles it for the project, and a `style` beside a new value is stored on the system. Asking again with the same value and a new style revises what it draws, for design knobs too. A design can't declare a project knob's path.
  - The user's own palette changes and restores reach the agent as a feedback batch with no design, and the System page's revisions say whether the agent has them. A Send that decided something for the project says so in its batch's `system`. The decision list starts with the project's palette and settled project knobs.
  - Checks come back as nudges and never block:
    - on a `system` write: contrast per palette and mode (WCAG 2.2), palettes missing a role, undeclared `var()` in the sheet, `!important`, and fluid type past 200% zoom;
    - on publish and on answer styles: colour literals, redeclared system names, sheet rules copied into a page, and off-scale sizes;
    - on a component without a purpose: a nudge to give it one.
  - The brief lists the system and the project's components. A new guide topic, `system`, documents it.
  - A bundled `layout` kit places boxes on the space scale. A `foundations` guide pack teaches how to start a system from a few seeds and settle it through questions.
  - `export` without a design hands the system to code: its sheet, tokens as CSS and JSON for the default and kept palettes, project knob values, and components with their sources. `mockpit export` writes these to `.mockpit/system/`. Settled project knob values come with the styles their answers brought. `read` without a design carries a one-line `system`.
  - In the viewer, a project's System page (in Home's sidebar) shows its palettes, type and space scales, tokens, classes, components and revisions. There you can make a palette the default, keep it or hide it, or restore an older revision, and the agent hears each change. The tool strip's palette button changes only what you see. Studio has a Palettes arrangement that shows the state in the default and kept palettes, light over dark. When an agent changes the system while a design is open, a note at the bottom lets you see the design as it was before, or restore it. After a `system` change from the CLI or stdio MCP, the stills of the project's latest variants are taken again in the background.
  - **Removed:** `/api/projects/<name>/design-system` and `/api/projects/<name>/kits/<id>`. A CLI or stdio MCP server still running from before must be restarted.

### Patch Changes

- 6a2d914: A picked answer's hover actions sit flush right, taking over its tick while the pointer is on the card.
- e3dabd6: Answers open as a list until you switch to pictures, with List first in the toggle, and the agent's pick is a dot after the answer's name in both views, so it is never cut off.
- 411f328: Answers in the list view put their description under the name, give the text the row's full width with the actions fading in over its end, and show the agent's pick after the name. A sent answer reads top to bottom, its comment quoted, with Change answer beneath it.
- 8bb3a66: Updated seroval, which the viewer bundles, for two security advisories.
- 1855275: Updated dependencies.

## 3.0.0

### Major Changes

- dce3d23: Agents and the app now use the same words. Restart any running agent, CLI or MCP server after upgrading: the old names are gone, with no aliases, and your data is converted in place.
  - A mock is now a **design** everywhere: `--mock` is `--design`, `/api/mocks` is `/api/designs`, and every `mock` and `mockId` field follows.
  - Kinds are `idea`, `screen` and `component`: `--kind sketch` is `idea`, `--kind page` is `screen`.
  - Everything taken away is **archived**: `closedAt` is `archivedAt`, `closeReason` is `archiveReason`, `closed` is `archived`. The app says Archive instead of End. `POST /api/designs/:id/close` and `/reopen` are `/archive` and `/restore`, and the variant routes are now `/variants/archive` and `/variants/restore`.
  - A variant's `note` is its `description` (`--description`). What the user adds to an answer is a `comment`, with `commentImages`, and the app says Add a comment. `notes` still means a design's written spec.
  - `/api/projects/:name/design` is `/design-system`.
  - `--situation` is gone: another render of a state is a state, `--state "Home · Failed"`. `edited.grouped` is gone too.

### Minor Changes

- 444a63d: After Send. With another design owing answers the screen moves on as before. With none it stays and shows how far the Send has come: Not seen yet, Delivered, Agent working, then a new version with a way to see it. The Thread still renders every Send, with Delivered and Not seen yet read from the same cursor.

  Waking the agent. The setup block, the brief, the skills and `docs/connecting-agents.md` say how a Claude Code agent runs `mockpit watch` under Monitor, re-armed when the monitor expires, so a Send wakes it. Where no watcher is open for the agent's session, the viewer shows a line to copy and paste to it, under the status, on the next design and in the Thread.

  Whose turn is always visible, on the open screen at every width and on each album: N questions, Draft to send, Changed, Not seen yet, Agent working, In use, Sent, Exploring or Nothing waiting. "Agent working" appears only after a write or `feedback` call from that session since the Send, for five minutes; a watcher re-arming doesn't count.

  QR code. A tool beside Try draws a code for the design, state and version on stage, encoded in the viewer with no outside service, to open it on a phone or iPad. On `localhost` or `127.0.0.1` it says a phone can't reach that and offers this computer's network addresses instead. The code never carries the workspace key, and says what a phone that hasn't signed in will meet.

- 7da6ed7: An agent can fix its own version before you see it twice: `publish --amend` (MCP `amend`, HTTP `"amend": true`) replaces a variant's latest version in place, keeping its number, and `publish --withdraw` takes it back. Both work only from the session that published the version and only while you haven't acted on it (no Send, comment or draft answer about that state, and not in use; a word on another state doesn't count); otherwise they refuse with a fix. Publishing the same variant twice within minutes, untouched, now nudges the agent to amend instead.
- dec437d: More answers no longer means a new version. An answer can bring what it needs to draw itself (`style` or `fill` beside a `set` of a new value, or `html` for a whole page), so its picture is right at once and the version in use stays as it is. A whole page becomes a version only if it's chosen, and Send puts it in use with no further step. While you choose, neighbouring pictures stay on the page in use, a picture of one part shows that part, a card landing under a still mouse doesn't start a preview, and New version steps aside for Send.
- 03631d6: Home's Archive and Recent are easier to read. The Archive now groups what left by the day it went, with a picture on every item, what each holds, and one reason and one "Restore all" per day. Restore works on everything there, and with every design archived it brings them all back; Undo returns it to the same day. Activity is now Recent, a real history of designs updated and answers you gave, filtered to All, Decisions or Designs (`?sec=recent&show=decisions`). It's where you reword or remove a decision, replacing the Decisions row in the sidebar. When a design you put in use gets a newer version, the bar now just says so: See it, Use it, or Keep your version.
- 731042b: Pages of designs load far faster, and they cost less while they're on screen. A frame's document now carries what it needs: mockpit's own files, and the fonts, stylesheets and scripts a page links from the CDN allowlist, fetched once by the server. Eight frames used to make 40 requests on every load for mockpit's own files, plus each page's CDN links, and now make none once their documents are cached. If a CDN can't be reached the link stays and the next load tries again, while a link the CDN says doesn't exist stays for good; a page that can't be inlined, such as a module script, keeps its link.

  Studio's wall keeps a state's frames loaded when you switch away, so coming back is immediate. The small pictures on the wall, in Grid, on Home and on question options stop animating once the page has settled; Stage, the closer look and Studio's columns never do.

  The CLI and the stdio MCP server now take a poster of each published page with a local Chrome or Chromium, just after the publish and without slowing it. Studio and Home show it instead of running the page, in the theme it was taken in; in the other theme the page runs as before. An explicit `--poster` always wins, and with no browser (or `CHROME_PATH` pointing nowhere) a publish works as before.

- 4f77022: Counts mean what they say. "Open" now counts only questions an agent asked: the built-in Which variant? still appears, but isn't counted on Home, on the question card, in `read` or in `pending`, and a design waiting only on it no longer shows up in Answer next. The tab title counts the project on screen, and the app icon counts everything, both in questions. An area's number on Home follows the tab you're on, and an empty area says what's missing and links to everything in it.

  A link that leads nowhere says so: a project or design that doesn't exist, or a bad address, gets a page with a way back, instead of "all answered" or a bare 404. A browser's bad address still returns 404.

  The question card shows options in full, and Send stays in view on a phone however many options there are. A minimised question always comes back, including one with a drafted answer. History names each line of versions, so a version reads as "Calm #1", and "Only ones I used" keeps those names. The smallest text is now 12px and clears 4.5:1 in both themes.

- 1ffb5e6: Decision list: mockpit now writes down what you settled, so the next agent doesn't make you say it again. Each project gets a list built from your replies with no agent's help: what was asked, what you picked and left, your words, and what you put in use. A later reply replaces its line. Open it from Home (Recent's Decisions filter, `?sec=recent&show=decisions`); every line links to its design, and you can reword or remove any of them. Agents get it first: `read` of a project or a design now carries `decisionList` on all three tiers, with that design's lines marked `here`, and the brief tells them to treat it as settled unless you say otherwise. `read --decisions` (MCP `read({decisions: true})`, `GET /api/projects/:name/decisions`) returns all of it when a read was cut to stay small. A changed answer also drops the note written on the old one, everywhere `read` shows it.
- 8c53a75: Declared screens. An agent can declare a screen or component before drawing it: `publish` with a `kind` and no body plans it, on every tier, and a `flow` may name it as a step. It shows as an outline on Home and in flows, says how many aren't drawn yet, and the first publish fills it in. The user can ask for it to be drawn or say it isn't needed.

  Missing states. A declared screen with html shows outlines for Empty, Loading and Failed once each, every one dismissible as doesn't apply, plus + New state, which sends the agent a request as an ordinary reply. `read` carries the answers as `stateOutlines`.

  Grid. Where variant names repeat across states, the top bar offers a grid: states one way, variants the other, one tile per render, missing cells shown, and where a component is used. A component with several forms opens on it. Tiles obey the live-frame limit, and tapping one opens it.

  Notes, an experiment. A short plain-text spec per design that an agent drafts with `edit` (`mockpit edit --notes`), the user corrects by hand, and later agents read in `read`. A hand edit holds against later agent drafts until the user clears it, and the agent is told when its draft wasn't applied.

  Situations are gone. Existing ones become ordinary states, migrated in place, and the `situation` publish param is gone: another render of a state is a state. The situation switch, the side-by-side view and the ↑ and ↓ keys go with them.

- dce3d23: An agent can find a design by the title you see, on every tier: telling it "Onni concepts" now reaches that design even when its slug is `concept-lab`, and publishing to a title updates that design instead of creating a new one named after it. The design screen's top bar has a Copy name button that gives the full name to paste to an agent, such as `Food companion, Tile #5`.
- 8facf39: Documents and big labs. A design of written content with no declared width now opens as a reading column: one page scroll, no device frame, no width menu and no Use this, with stacked surfaces reading as one document and diagrams allowed to run wider than the text. Click or tap a paragraph to comment on it; the comment goes through the same draft and Send as a part comment, and the agent reads which paragraph it is on, with its text, as `anchor.paragraph` in the feedback batch. A design of 50 variants or more opens Studio as a wall: a dense grid of every attempt, filterable by state, by what is in use, archived or hidden, and by name or note, with a large preview beside it on a desktop and a swipeable large view on a phone or iPad. The columns stay one click away, and smaller labs keep Studio as it was. Look closer on a phone now fits the design to the screen and keeps its actions on it.
- d42ab9e: Archiving an idea and taking things away. An idea has a quiet × on its cover and its open screen: it leaves the shelf with Undo and asks nothing, and a reason can follow in one line, picked up from the comment on what you last sent if there was one. Everything taken away is now in one place, the Archive at the foot of the sidebar, with Restore and the reason; swipe still archives one on a phone, and a draft you hadn't sent is kept for the way back. A hidden version now dims where it stands instead of folding away, in the version list, the history and Studio, and an archived variant can carry a reason too.

  Archive tells the agent nothing. An archived design no longer reaches `feedback` or `mockpit watch` (`dismissed` is gone from the batch), the guide, skills and CLI help no longer tell agents what to do about archived or hidden work, and `ask` no longer refuses a question the user left open when they archived a design, or one naming a hidden version: asked again, it goes back on the open list and brings the design with it. `read` shows it as information: a design's `archivedAt` and `archiveReason`, a variant's `archived` status and `archiveReason`. The `skipped` field on `ask` is gone.

  What's current. After Use this, a newer version shows as Changed, with a way to see it, take it or stay on what you have; staying asks again only when a newer one comes, and `read` carries `changedTo` while it asks. A cover shows what's in use, else the agent's recommendation, else the first: parallel variants no longer race on which landed last. An embed that follows a variant passes over a version you hid.

  New idea replaces shortlists: gather versions from across a project from the Ideas shelf or the Save menu, as copies, with the originals untouched and replies reaching the live agent. Group and hanging variants are gone from Studio: a fork is a column of its own that says where it came from, and `move` still moves a variant with what was forked from it.

- 37560dc: Answers can be kept and hidden. Every answer card has a bookmark on its left to keep it for later, and on its right + for more like this one and × to hide it, which fades it away while the others slide into place; a hidden one can say why. Both save on the click and reach the agent with your next Send or More answers, and the agent never sees a hidden answer offered again: asking the same question again keeps them, and the reasons join the project's decisions. After a Send, kept answers wait beside the design and as pills on its top edge to look at without changing anything; Use this instead swaps one in without a new version, and a kept screen is no longer archived. A kept screen says how many updates it's missing, with Update it now, once, or Update it too to have the agent change it along with the one in use. Saved sets name a combination of answers across questions, to preview and put in use whole. Studio gains Answers: the open question laid out at once, culled with ←→, K, X, Enter and Z, and On every state to see each answer across the states. The variant star is gone; `read` marks a kept variant `kept: true` and shows `standings` and `sets`.
- 8132552: The viewer keeps your place. A design reopens in the view, state and variant you left it on (Stage or Studio, per design in this browser), and its first open goes to Studio when there is a choice between variants; an agent's unanswered question still opens on Stage, and Answer next always does. The URL now names the state, variant, version and view, so a reload stays put and a copied link lands there. Back leaves for the place you came from: moving between states, questions or versions no longer adds history steps. A design's states are named tabs instead of dots, marked only when the agent is waiting on them, and Stage | Studio is a switch in the top bar. The project crumb now means the whole project and the area crumb that area, on the tab you were on.
- ab9e9a3: A newer version of a design in use now takes over by itself. When the tab has focus the design moves to the new version, and ten seconds later it goes in use; the only button is Back to #1, with the count on it. Going back writes no decision and doesn't message the agent, and using an older version later no longer brings the newer one back. A draft, an open question, a tool in use or typing holds it to a small See pill, and touching the page stops the count and leaves Back and Use. Also tells agents with the mockpit plugin not to arm a Monitor, and others not to announce re-arming one.
- 37bc665: Opening a design is now the design with what's about it at its sides. States and versions stand on the left, the question and your comments on the right, with pins on the design; each side appears only with something in it, so a plain render is the design alone. Try, Comment and Tune sit in a small strip left of the design, and only those that apply show. On this design, Built from and Thread open from icons in the top bar, beside Revise and Use this. A question's options are pictures you can read, previewed on hover. Everything a Send will carry is listed beside it: comments can be reworded or removed before they go, and comments or tuning can go without an answer. A wide page keeps its size: when a margin would take the design below 80% it folds to its tab and opens floating over the canvas, so a 1280 page shows at 87% at 1280 wide and 80% with the question standing beside it at 1440. A width you pick is now the only one on the canvas, with All widths to spread them, and a design with one width has no menu. Studio and the phone are as they were, except "Only ones I used" is gone from the phone's History and Revise no longer competes with Send in white.
- 2602336: The project sidebar now opens over an open design from a button in the top row, so you can jump elsewhere without going up to Home, and the design keeps its size. "Nothing waiting" no longer repeats on every row of a list; the open screen still says it. The version arrows now walk the Versions list as you see it, instead of jumping between variants by date. In a flow, the left list also shows the design's states the flow doesn't include, under Other states.
- 2f2d8da: Add an OpenCode plugin, for 1.x and 2.x. Nothing runs until a session's first mockpit call; after that, each Send wakes the session, even when idle, and the agent reads the reply with `feedback`.
- 3e62534: A design-wide question can name the states its answers show on (`states`, `--states`). Going to it brings the stage there with a one-step Back, and its card offers Show from anywhere else. Hovering never moves the stage.
- 5fd676b: Questions get easier to weigh. More answers, the last thing under a question, asks the agent for more without answering: it goes on its own, leaves your draft alone, and the agent hears `reply.more` with the question, what it offers already, your note and what you've answered around it, then asks again under the same id. New answers wear a New label. Above four answers with pictures, a switch shows them as a list, remembered per browser. Resting the pointer on an answer for two seconds holds its preview, with a small timer in the corner while it counts and a dashed border after: leaving no longer takes the stage back, hovering others still previews them, and × or Esc lets go. Holding never answers.
- 859e823: The bookmark on a Studio card opens one menu for where a version lives: tick any ideas, designs or states, flip "Remove from here" to move it rather than copy it, and the button says what will happen, with Undo after. Saving works from a gathered idea too. A saved `default` takes its origin's name, so it can't become what a component shows wherever it is embedded.
- 0a43c48: Choose who gets a Send. A Send used to go to the conversation that owns the design, so when that one had gone quiet it waited unheard, even with another agent listening in the same project. While the owner has no watcher open and hasn't called in five minutes, and another session on the project is listening, a To row appears above Send: it starts on the session started in this project, and its menu lists who is listening and who isn't, by folder, last call and what else they own. What has no picker beside it (Use this, New version, a steer) goes to the same default. The session that gets the Send becomes the design's owner, hears the batch with a `handoff` note saying to read the design first, and the status names it: Delivered to onni-companion. With nobody listening nothing changes.
- 00b53ed: New idea: gather candidates from across a project into one named Studio. A bookmark on each Studio card saves that version; the first save asks for a name or an existing idea, and later saves take one click, with Undo. A gathered idea is its own design holding copies, each labelled with where it came from, so the originals stay as they were, and Add candidate picks more from the project's other designs. Its replies go to the agent last working in the project until one writes to it, and the Thread says which.
- b8deedf: Home is now a sidebar and albums. An album holds one thing and all its pictures: states, else variants, else one flat picture. Covers follow the design's shape (phone, wide, both widths side by side, a part fitted whole), and written pages get a dated list or a text cover in place of thumbnails nobody could read. Under the title, one word says whose turn it is and another what's inside; nothing sits on the art any more. Sections replace the kind tabs and light up only when used: screens and components as declared, ideas and documents worked out from what a design contains. A project of one or two designs has no sidebar, and a phone gets it as a drawer. Albums waiting on you glow, and so does the project's name, whose switcher now says which projects have questions. Search from anywhere with `/` or ⌘K: titles, states, variants, notes, questions and areas, this project first (`GET /api/search`, which never reads surfaces). Home's address changes from `?view=` to `?sec=`. Decisions sit in the sidebar and still open as a page.
- 03631d6: The Home sidebar no longer mixes mockpit's words with a project's. Ideas, Screens, Flows and Components are rows with icons, and a project's areas are chips below them: press one to filter, press it again to take the filter off. Only Needs you has a number, with no dots beside it. The question count at the top right is gone where the sidebar is showing, and "Answer next" now sits on the Needs you page. The count for all your projects moves into the project menu, except on a phone or where there's no sidebar.
- e8a89dd: Studio's Look closer: a click on a version shows it large without leaving Studio, with the agent's note and the steers. Arrows or a swipe step through every version in reading order; Esc, Space, a swipe down or Back return to the card. Open on Stage is a deliberate step from there, and Back from Stage returns to Studio. Forks in Studio now show their names.
- 85a9980: Studio can select several versions: tick a card's number, Shift-click for a range, and an icon bar moves, saves or archives them together. Comment, Borrow and More like these go as one reply, and Comment switches between one sheet and one at a time. Once a design's last design leaves, you land on its area, with Undo returning to the design. Home moves a design with everything archived and no question waiting out of the grid, into a folded Archived list. The Stage and Studio switch shows whenever a design has more than one design or version, and a design reopens in the view last used; from Look closer, Stage opens the version being looked at. The Save menu starts on moving: its Remove switch is on, and applies once a place is picked. Its button is now a folder with an arrow. Picking a look on an older draft now takes the look as it stands, and a component's repeated stylesheet loads once, so a later component can't undo an earlier one's styles.

  Agents can tidy up: `mockpit move` (and the `move` tool and `POST /api/designs/:id/move`) takes variants to another design or tab and out of the one they were in, archives them or restores them. It never deletes, leaves a variant in use where it is, moves a group together and says what it did in the Thread. Archiving a variant also clears a pick of it from the draft, so Send cannot put a design nobody can see in use.

  A small card under a lead drops the name it shares with that lead, so `moss ball · listening` reads as `listening`.

  A design with no states can take tabs: `mockpit edit --design <slug> --first-state <name>` names the state it has, and every variant goes there, archived ones too.

- c658d3f: Studio's controls are one row under the top bar: state tabs, a filter, one menu for Live, In use, Hidden and Archived, and icons for Wall, Columns and Grid. The top bar is just Stage and Studio, and the filter now works in Columns too. A closer look has no strip of names and dots: its name opens the list. Archived variants and hidden versions list as cards from the menu, in place of the corner list and the hidden button.
- cee6e19: Studio on a phone runs every state's variants as one strip, a card per swipe, with the flow bar following the state at the snap. Full screen shows one version's page alone, live, at the width it was designed for; a pinch zooms it, and Esc or Back closes it.
- 0eed511: Agents can clear out older versions when you ask: `mockpit move --hide-older` hides them, and `--delete-older` deletes them for good, skipping any that a reply, comment, question, embed, copy or fork still points at. In Studio, hidden versions now collapse behind a count that brings them back instead of staying dimmed on the grid.
- bcaa23d: The design screen's top bar now holds only where you are, the views and the panels. New version, Use this and the version stepper sit on the design's top edge, width and the QR code are one preview button in the tool strip, and About and Copy name fold into a ⋯ by the name. The count of open questions moves onto the panel's tab.
- 5096e4d: The Claude Code plugin no longer runs a monitor in every session. Nothing runs until a conversation's first mockpit call, over MCP or the CLI; that call starts a background hook that waits for the next Send and wakes the agent, even when idle, with the whole reply. The end of each turn starts the next wait. `mockpit watch --once` stops after the first Send and prints the whole reply as JSON, and `--exit-code` sets the code it stops with.
- 5d9f664: `mockpit watch` now only says a reply landed, and `feedback` or the next write delivers it. Before, the watch took the reply off the session's cursor, so the `feedback` call it pointed the agent to came back empty and the agent saw only the one-line summary. A harness cutting or dropping a watch line can no longer lose a reply.

  A Codex plugin: `codex plugin marketplace add fabiogaliano/mockpit`, then `codex plugin add mockpit@mockpit`. The conversation's first mockpit call starts a background hook, and each Send wakes the idle thread through `codex queue`. MCP and CLI sessions are keyed to the Codex thread, so two threads in one repo don't take each other's replies.

### Patch Changes

- 85a9980: New app icon: a dashed design with a pointer on it, in the favicon and the installed app.
- 470e373: Archiving is instant, however large the lab. A variant leaves Studio on the click, and on Node a large design's designs now stay in memory, so a repeat read or an archive no longer re-reads and re-parses all of them.
- 470e373: Big projects feel faster. A publish no longer reads every design in the project, opening a design no longer loads the whole project first, and Studio and Home keep their cards and pictures in place when something changes instead of rebuilding them.
- 859e823: Archiving the last variant of a state moves on to the next state. A state with every variant archived leaves the state tabs and is no longer landed on; a small "N empty" menu beside the tabs leads back to it. A declared flow keeps all its steps.
- 05a7130: Home's first load after a restart or a publish no longer reads any page's html it doesn't need: each variant now stores a small summary beside its surfaces (existing workspaces are filled in on startup), so the lists answer in milliseconds on a large workspace. Pictured pages start only near the screen and a few at a time, and Home shows empty tiles until its data arrives.
- cced3d5: Home loads in a fraction of the time on a large workspace: the server keeps parsed variants in memory until one changes instead of re-reading every surface and version per request, the projects list no longer reads surfaces at all, and a Node server now gzips its responses. Home no longer says "0 open · all answered" while it is still loading.
- fb3031d: Home opens on the project's real covers as this browser last saw them, instead of placeholder tiles, and no longer reads everything twice on load.
- 145e9c0: Home's reads no longer pass through design bodies, and the viewer's project tree leaves out variant descriptions it doesn't show, which halves it. The first start after upgrading builds two small indexes.
- be3ea52: Try keeps working across a flow's screens, a draft comment survives a new version that drops its part, removing a draft comment offers Undo, Tune's controls fit the panel, and phones get 40px tap targets.
- 859e823: A long variant note in Look closer shows one line until you open it, so the picture keeps its room.
- a3a988e: Revise is now New version, and it says what goes with it: any comments or other changes in your draft are counted on the button, because one click sends them to the agent.
- dce3d23: The design's path now ends at its name: the state tabs alone say which state. An info button beside the name opens About, which no longer repeats the states.
- c658d3f: A question's header is shorter: the answer it depends on sits beside the count as "With Lilac" with a Change link, and "About Food Show" is now a "Go to Food" button.
- 5a4cf5c: Question counts are just coloured words now: the dots beside them are gone from Needs you, Recent, the project menu and the open design.
- c658d3f: In Studio and Grid, waiting questions keep the same tab and corner they have on Stage, and pressing it opens them there. The top bar's "2 questions" and the dot on Stage are gone on desktop.
- 470e373: Studio cards no longer have a Full screen button, since clicking a card opens the closer look, which has it. Save moves from the card's row of buttons to the corner of its picture.
- fce2e25: On a read-only link, a question's options no longer look pressable, and Other… isn't offered.
- 4a56c20: `MOCKPIT_RENDER_SALT` on the Node server changes every surface document's URL on restart, so browsers re-fetch versions that were changed outside the API (a direct store edit) instead of keeping their year-long cached copy.
- 14da5b7: Design-wide questions asked before the rename are read as design-wide again, so an agent's own variant question shows and acts as one instead of a generic "Which variant?" appearing in its place.
- a40de6f: Studio: each column has its own × beside the variant's name, which archives the variant (never the one in use), under one Undo.
- 0eed511: Studio's cards leave a margin around the design, and the wall's All states filter is an icon.
- 0d2b860: Studio shows every version near the screen. Only pages that draw on a canvas count against the browser's limit of about 16 WebGL contexts, and those frames go to what is on screen first, newest rows first. Version rows read with `history` say `canvas: true` for such a page.
- 911a872: Hovering an icon shows a tooltip in the viewer's own style, right away, instead of the browser's slow one.
- a3a988e: Try, Comment and Tune now stand against the design's edge and follow it as it pans, instead of at the far side of the canvas. The QR code moved to the top bar, by the width menu.
- 911a872: The design screen's top bar no longer has a search button: / and ⌘K still open search, and Home and the sidebar keep theirs.
- f954c29: Tune: Reset and removing an attached image both offer Undo, Esc closes the colour picker before anything else, parts read as words (`hero-title` is Hero title), and a tuned value you saved shows on its control when you come back instead of the default.
- 0eed511: The left margin's versions start collapsed in a bar at its foot, and open upward.

## 2.0.0

### Major Changes

- 49143df: The agent contract speaks the viewer's words, with no aliases. Every tier changes together (HTTP, MCP, the stdio MCP server, the CLI, `run`, the pi extension, the guide and the skill). Old name → new name:
  - `POST /api/mocks/:id/resolve` → `POST /api/mocks/:id/close` (`/reopen` is unchanged); a mock's `resolvedAt` → `closedAt`; the feedback batch's `resolved: true` → `closed: true` (`dismissed` is unchanged); `pending[].resolved` → `pending[].closed`.
  - The feedback batch's `comments` (the user's thread messages) → `messages`; `mockpit watch` prints `mockpit message on <mock>` and `mockpit closed <mock>`.
  - `reply.decision` `{kind: accept|revise|drop}` → `reply.verdict` `{kind: use|revise}`. Drop is gone: the reply body no longer takes it and no variant is ever `dropped`.
  - `accepted` (feedback batch) → `inUse`; a variant's `status: "accepted"` → `status: "inUse"` and `acceptedVersion` → `inUseVersion` (in `read`, the tree, publish, export and restore). The feedback batch's `dropped` is gone.
  - `reply.mix` and the draft's `mix` → `borrowed`; `decisions…from` → `decisions…borrowedFrom`.
  - Publish's `slots` → `fills` and `suggestedSlotAsks` → `suggestedFillAsks`; `decisions.states[…].slots` and a fill's nested `slots` → `parts`. The `<mockpit-slot>` alias is gone: write `<mockpit-embed>`.
  - `read --tree`: `uses` → `embeds`, `usedIn` → `embeddedIn`.
  - `export`: `source` → `allFills`; the CLI writes `all-fills.html` instead of `source.html`.
  - The suggested variant question publish offers is id `choice` (per state `choice-<state>`), "Which variant?", instead of `look`, "Which one?".
  - Guide, skill and tool descriptions call an ask a question, a slot a part with fills, and a state a state (screen only glosses `page`).

  An existing workspace migrates in place on the first start: the `resolvedAt` column becomes `closedAt`, `dropped` variants become `archived`, stored replies and drafts are rewritten into the new keys (`decision` accept/revise → `verdict` use/revise, a `drop` decision is removed, `mix` → `borrowed`, `resolved` → `closed`), and `<mockpit-slot>` tags in stored html, current and history, become `<mockpit-embed>`.

### Minor Changes

- c0fc2d0: A mock can name its area and its source, and a new `edit` verb changes a mock or a project without SQL.
  - `--area Shell` (MCP/HTTP `area`) says where in the product a mock belongs, in the project's own words. Home groups every tab by area, alphabetically, with unnamed mocks last; a flow joins an area when all its screens are in it. A project that names no area looks as before.
  - `--source apps/web/src/shell` (MCP/HTTP `source`) names the code that implements a mock. Read views return it, and the viewer shows it quietly on Home and in the mock's top bar.
  - `mockpit edit --mock <slug>` (MCP `edit`, `PATCH /api/mocks/:id`) changes the slug, title, kind, area or source without a new version; `""` clears area or source. A new slug rewrites every `<mockpit-embed>`, `data-goto` and flow step that names the old one, in every version, so pages and their history keep rendering. A mock still embedded somewhere can't become a sketch, and a page that stops being one is nudged out of its flows rather than removed silently.
  - `mockpit edit --project <name> --rename <new>` (MCP `edit({ rename })`, `PATCH /api/projects/:name`) moves a project's mocks, sessions, flows and design settings to a new name; it is refused when that name already has mocks.

- a6fa8f8: Borrow in Studio sends a structured steer: the comment carries `borrow: { from: "felt@2", part? }`, and `watch`, `feedback` and pi print it as `borrow face from felt@2 into dark@3`. The guide now says "more like this" asks for 2–3 variants forked from that version.
- 7760b38: Structure is now declared, never assumed. A mock published without `--kind` is a sketch instead of a component; embedding a sketch in another mock makes it a component. Home shows a tab only for the kinds in use, in the order Pages · Flows · Components · Sketches, and no tab bar when only one applies. The Flows tab lists only declared flows. Existing components that nothing embeds and no flow uses become sketches when the workspace opens.
- 28c84e1: The brief takes guidance in layers, so design taste is opt-in rather than built in.
  - Core stays how mockpit works. The html topic's finish rules (flat, no shadows, two weights, sentence case, no emoji) are gone from it.
  - Packs ship with mockpit, off by default. The first, `design-craft`, covers asking before designing, variants that differ in one clear thing, real content, no filler, situations, and converging once the user has chosen.
  - `~/.mockpit/rules.md` (next to the database) is the user's own guidance, read live by a local server; `.mockpit/rules.md` is the project's, committed with the repo and sent by the new `mockpit rules` (and by `mockpit init`). Either turns packs on with `packs: [design-craft]` in its frontmatter and has `## Rules` and `## Suggestions`. Higher wins: project, then the user's, then packs, then core. `mockpit rules --mine` stores the user's file on a deployed server, which has no home folder.
  - The brief opens with a `Guidance:` line naming the layers that are on, and prints each under its own heading. With no rules file it is unchanged.
  - `mockpit init` now ignores `.mockpit/*` but keeps `.mockpit/rules.md` trackable, upgrading the `.mockpit/` line it wrote before.

- 6b672aa: Home is organised by area and says where each mock stands; the user can move mocks themselves.
  - Once a project names areas, Home gets a rail of them (chips on a phone) with counts and a dot where questions are open, plus an All tab. Area and kind combine, both in the URL (`?view=…&area=…`): pick an area on All to see its pages, flows, components and sketches together. A project with no areas looks as before.
  - Areas follow the project's own order: `mockpit edit --project <p> --area-order "Shell,Food"` (MCP `edit({ areaOrder })`, `PATCH /api/projects/:name` `{areaOrder}`). Areas it leaves out follow alphabetically, mocks with none sit last under "No area", and a project rename carries the order.
  - Each card carries one quiet status, derived from what is already stored: `N open`, `Changed` (a newer version than the one in use), `Decided` or `Exploring`. Closed mocks are faded and sorted last. It replaces the unexplained check on cards.
  - A dot marks mocks with versions this browser hasn't opened yet (per browser, no server state).
  - A ⋯ menu on each card moves a mock to Pages, Components or Sketches, sets its area (an existing one or a new one), and closes or reopens it, with the edit verb's rules. The agent hears each move once, as `edited: {kind, area}` in its next feedback batch.
  - Sketch thumbnails are shaped to their design width like pages instead of slivers in a wide tile; code paths are cut from the left (`…/spaces/food`), always right after the name, full on hover.
  - The mock screen's crumb names its area (a link back to Home on that area), and a Related sidebar (toggled from the top bar, remembered per browser) lists the pages it is used in, what it uses and the flows it is a step of.
  - The guide asks agents to title mocks by what they are, not by process ("Round 2 · …", "v2", "Prototype"), and publish nudges when a title does.

- 532f7a3: The pi extension wakes the agent on a reply: in an interactive or RPC session, a reply sent from the viewer arrives as a mockpit message and starts a turn, or waits for a busy agent to finish.
- a6fa8f8: A heavy page can carry a poster: a still the agent takes of it, sent as `poster` on the html surface (CLI `--poster shot.png`, MCP `poster`, an image path on stdio and in the pi extension, an asset id over HTTP and in `run`). Studio and Home show the picture instead of running the page, so a board of 3D sketches costs no live frames; Stage still runs the page. A version that changes the page without a new poster drops the old one, so a still never shows an older page. A new variant whose page draws on a `<canvas>` without a poster gets a nudge.
- 8d6adca: Situations: another render of one state ("Couldn't save", "Loading", "12 items"), published with `--situation` beside `--state`. The flow still steps through states; a quiet switch under the design flips the state between its situations (↑/↓), and a grid button in the version bar shows them side by side. Each situation is a state of its own key (`"Writing · Couldn't save"`), so asks, comments, decisions and export reach it like any state.

  An ask can mark the option the agent would pick (`"recommended": true`, `mockpit ask --recommend <label>`): a small dot on its corner, the why on hover.

  Home: the project name gives way to the bell and theme buttons on a phone, a page's new dot sits after its name, and the status chip stays clear of a phone-shaped picture's round corner.

- a6e0d68: Studio: a state zoomed out, every variant side by side with its newest version on top and a fork's first version hanging under the one it came from. The dock's "N variants" steps out, a card steps back in, and the choice is remembered per mock (a state that owes an answer still opens on Stage). Each steer goes as its own reply and leaves the draft alone: More like this, Comment (on a version or one of its parts) and Borrow. The × hides a version, or archives a variant from its last one, with Undo; archived variants wait in an Archived column with Restore. A reaction can name an older version, which agents read as `variant dark@2`.

  A quieter mock screen: the path is the way up (project and area are links; a phone keeps one arrow, labelled with where it goes), the mock's name opens what's around it (Appears in, Built from, flows, other states, code path), and the Related panel and the layers button are gone. Tune's parts open with Tune. One × everywhere, engraved, with a soft glow on hover that warms to red where it removes.

- a6fa8f8: One step-back: "N variants" opens Studio for a state with situations too, with a switch above the columns that names each situation and counts its variants. A variant not drawn in that situation keeps its column, with an empty "No Error yet" slot. A state with one variant and several situations steps back to every situation side by side ("N situations"); the version bar's grid button is gone. Comment's icon is a round speech bubble.
- a4998ee: The viewer's words, one meaning each. A version is named by its variant's own number, "Dark #2" (or "#2" for a lone variant), the same number agents write as `dark@2`; "vN", which counted three different ways, is gone. Closing a mock says Close everywhere. The Thread's free text is a Message, and the part-pinning tool is Comment. The variant question reads "Which variant?", and Tune's whole-page entry is "Whole design". The button that asks the agent for another version says Revise. A component lists where it Appears in, a page what it is Built from. A question that waits on another answer is inactive. A state is called a state, never a screen, and a part's alternatives are named by the part.

### Patch Changes

- a6fa8f8: The Claude Code plugin's monitor runs again: current Claude Code refuses `${user_config.*}` in a monitor command, so it never started. A SessionStart hook now leaves the server and token for it. `mockpit watch` finds its conversation's own session by Claude Code's session id (`GET /api/sessions?key=`), so two agents in one repo no longer take each other's replies. The plugin uses an installed `mockpit` before `npx`.
- 884c765: Home's Resolve button on a waiting mock is always visible on desktop instead of appearing only on hover.

## 1.3.0

### Minor Changes

- 3b40479: Questions that depend on each other. An ask can name `after: "<ask id>"` (CLI `--after`): it stays closed until that question is answered, then its pictures render with that answer, marked "With Warm · change". Every question also says which parts its options change.
- a580a55: An ask option can point at one version of a variant (`{ "label": "Before", "variant": "quiet", "version": 2 }`, CLI `--option Before=quiet@2`). Its picture and its preview show that version, and answering puts that variant in use at that version.
- bcefdac: On the canvas (a tablet, or a window too narrow for the panel), a design shows at its full height, fitted to the width, instead of in a box one screen tall that scrolled inside. Drag and pinch move and zoom the whole canvas freely; the question card floats over the design without shrinking it.
- ff252eb: Home fits the device. On a phone, Tree / Library / Picks sit in a row under the top bar, the list is grouped into pages and components, and a mock's tree button opens its screens as strips of versions with stars, then the components in it and the pages it appears on. An upright tablet gets the touch canvas (pinch to zoom, drag to pan) with the mock list as a drawer; a tablet held sideways lists what waits on you as rows and the decided pages and components as cards.
- 8a58705: Drop now hides a variant instead of archiving it. Archived variants stay in view, muted; dropped ones leave the switcher and the Look question and wait in a "Dropped" fold beside the switcher, each restorable. Feedback lists them under `dropped`.
- 000b8c8: Flows: an agent declares the screens a user moves between, across mocks, with `publish --flow Morning --step 2` (MCP/HTTP `flow`, `step`; `step: 0` takes a screen out, `flow` without html places an existing screen). `read` and `read --tree` return `flows`. The mock screen's flow bar and edge neighbours walk the declared flow, opening the other mock at its state with Back returning; with Try on, a design's `data-goto="next"`, `"prev"` or `"<mock>:<state>"` moves the user there. Thread rows number versions as the version bar does.
- 828a1eb: Variants can fork. `publish` takes `fork: "quiet@2"` (CLI `--fork`) to start a new variant from a sibling's version: alone it copies it, with `parts`/`fills` it edits the copy. The variant records `forkedFrom`, shown in its version list and the switcher.
- a2a3e6d: Home is now three tabs, Flows, Pages and Components, each showing the design in use for every screen. A screen opened from a flow walks that flow, and Back returns to the tab and place you left. The project canvas, Library and Picks views are gone. The open count above the tabs lists the waiting mocks, where you can resolve them. On the mock screen, the flow neighbours step aside while more than one width is on the canvas.
- 992d771: Accepting a variant now pins the exact version you were looking at: export and embeds keep showing that version in use even after the agent publishes newer ones, and `read` reports it per state as `inUse`.
- 4d109cf: Find and come back to designs. Home gains a Library view: every mock with all its variants, each pictured whole with its status, version, lineage and a star, filtered by pages or components, starred, or status. Star any variant from its stage or the Library to mark a favourite (it decides nothing; agents see `starred` in `read`). Picks groups the chosen designs by mock with how many states are decided, and shows the starred ones on a switch. The canvas opens at a readable size on the first mocks, with a minimap of the rest; Fit all shows everything. The guide now tells agents to build screens from components.
- db4b7e1: Composition goes deeper. Any mock can embed another (`<mockpit-embed slug="card">`), and an embedded component's own embeds expand in turn, so pages build from sections and sections from components. An embed without `version` now follows the component's latest version (with `version` it stays pinned), and one without `variant` follows the component's accepted variant. A component's new version reloads every page that shows it, and the stage's Components row lets the user peek at older versions. A component shows in its pages as decided: the fills and knob values settled on it carry into every page that embeds it. A chain that loops back on itself is refused at publish. `read` lists each variant's `embeds` as they render now and `publishedWith`, what the version rendered with when published.
- aa992e6: Every decision in one view. Home's Picks view packs each accepted design tightly at its own height, pictured with everything you've settled and its components as they are now, so it grows as you send answers. Pages come first, then the components they are built from; a tile opens that mock's place in the tree.
- 7edf473: The project as a tree. On a wide screen Home is a canvas beside the mock list: every mock is a cluster with its chosen design large, the open alternatives beside it and archived ones folded into a stack that fans out, pages above the components they are built from, joined by their embeds. Pan by dragging or scrolling, zoom with a pinch or the buttons; a row's tree button finds its mock on the canvas. On a phone the same button opens the tree one level at a time: a mock's variants, the components it is built from and where it is used. Agents read the same tree with `read --tree` (MCP `read({tree: true})`).
- 9204482: The floating question card, revised. Word answers are full-width rows that wrap, wherever the card rests; the question is the headline and its topic a small label. Accept / Revise / Drop and the note fit a narrow card instead of spilling past its edge. Dragging moves the card itself, lifted under the finger, and it glides into the spot it lands on. A fold button shrinks it to one line (the question it is on), which a tap opens again.
- 45cc045: Questions live with their state. Each state now shows only the questions about it: a `state` ask on its state, a `part` ask on every state that marks the part, and a mock-wide ask that picks between variants on every state that has them, answered once for all. The count ("Lab open · Question 1 of 2") is per state, the state tabs show how many each still owes, and after the last question on a state the flow moves on to the next state that asks something. The arrows walk every state in turn, one Send and one reply as before.

  Answered questions stay answered. Only open questions are shown and counted: once a Send answers one, it folds into a collapsed, read-only Answered list showing what you picked, and new questions from the agent no longer sit beside it. Changing a sent answer takes its "Change answer" button (and "Keep sent answer" backs out).

  Resolve a mock from the project list: swipe its row left on a phone, or use the Resolve button that shows on hover or keyboard focus elsewhere. Its open questions close unanswered, it moves to a folded Resolved list, and Undo or Reopen bring it back. The agent hears it once in `feedback`, as a batch with `resolved: true` and the `dismissed` asks (`mockpit watch` prints a `mockpit resolved on …` line, `pending` marks the mock `resolved`); a dismissed ask reads `dismissed: true`, and `ask` skips re-asking it with a nudge. A new ask reopens the mock.

- 20071bb: A quieter mock screen. The top bar keeps only back, where you are, the width and "Built from"; the design fills the canvas with the state's steps above it and one bar below: ask for a New version, step through every version of the state (v1…vN), Use this to put one in use, and Try, Mark and Tune. The agent's question floats above the bar as one compact card. The version label opens the history (every variant as a line of versions, the one in use marked) and the thread. Versions can be hidden from the history and restored; the version in use can't be hidden (`POST /api/mocks/:id/hide`).
- 9b0b89b: Answers and tuning stay in force after Send. The stage, Tune and every later question's pictures render on top of everything already sent, so a later choice is judged in the context of earlier ones. `read` and `export` return it as `settled` (every value sent, later replies winning), replacing `read`'s `tuned`, which held only the last reply's.
- 5394d45: Publish takes `fills` (`--fills part#fill=file`): replace one alternative of a slot, or add a new one after the others, without resending the page. Page composition is now `<mockpit-embed>` (`<mockpit-slot>` still parses), freeing "slot" for a region with fills. The guide teaches slots, `suggestedSlotAsks`, `decisions` and the composed export.
- 8754aae: The viewer understands slots. A question that chooses a slot's fill says so ("Slot · Entry"), its pictures crop to that region, and a pick outlines it on stage as "Entry · A skeleton card". A slot inside a fill gets its question right after its parent's, and only while that fill is chosen: otherwise it is skipped, marked "Only for …" if you go to it, shown struck through as "not sent" in the review, and left out of the reply. The review groups answers by state and indents nested slots. In Tune, a slot's fill is a control under its own part. Borrowing a part from another look moved from the trailing "Mix" question into Tune, as a "Borrow" line per part; the Mix question is gone. The variant view's page-embed list is now `embeds` (it was `slots`).
- 0992355: Slots: a region of the design with alternative fills, declared in the markup. Elements that share a `data-part` name and carry distinct `data-fill` values make one slot (`data-fill-label` names a fill for the user, `data-fill-default` picks the default, else the first). mockpit shows only the chosen fill, with no switching CSS from the agent; each slot is a select knob on its part, so an ask option chooses a fill with `set: {"entry": "skeleton"}`. A fill may hold further slots. `publish` lists the slots it found and hands back `suggestedSlotAsks` for any slot no ask sets. A reply carries `decisions`, the screen as decided (per state the look and each slot's fill, nested slots under the fill that holds them, plus the knob values set), and `export` returns the composed screen with only the chosen fills (the authored markup as `source`); the CLI writes `index.html`, `source.html` and `decisions.json`.
- f946494: Try a design as a prototype. A Try switch on the stage hands taps, scrolls and the design's own motion to the design, so a clickable prototype can be clicked through in place; off again, taps select and mark parts. The guide tells agents to name states by what the user sees on the screen.
- 01dec81: A new layout for phones and iPads in portrait. The design is a canvas you pan and pinch under a plain two-row header (where you are, Mark and a menu; then the version, the look and its note, and the widths), and the questions float over it in a card instead of a bottom sheet, so answering never starts with a drag. Drag the card by its grip or its header row and it snaps to a corner, the middle of the top or bottom, or the middle of a side, where it becomes a column and the design fits beside it; carry it to an edge and it tucks into a small tab there. Tune and Thread open in the card from the menu. A width that fits the screen is drawn at true size, and mock-wide question pins are gone from this layout since the card lists them.

  Two new publish parameters, on the CLI (`--note`, `--widths`), MCP, HTTP and `run`: `note` is a line on what a variant is, shown on the variant and under its option, so the design itself carries no captions; `widths` names the device widths a mock is judged at, shown side by side on the canvas as artboards. The guide tells agents to keep the html to the UI alone and to declare knobs for what is worth fine-tuning even unasked.

  A design wider than the width it opens at is no longer cut off on both sides: unless you picked a width or the mock names its own, the stage steps up to the next width until the design fits. Option pictures render at the stage's width, so a phone design is pictured at phone size. On touch, a tap on an option shows it on the stage and a second tap picks it and moves on, as a click does. Swiping sideways no longer changes the question; the arrow buttons do. A long crumb no longer pushes the page wider than the screen.

### Patch Changes

- c94029e: Answers reach the design on stage reliably. The stage now opens with your answers already applied (they ride in the frame's address, as option pictures already did), and every pick or preview reaches it as soon as the page starts, even while it is still loading a slow stylesheet such as a web font; before, such a page showed its bare markup and ignored taps until it finished loading. When a pick changes the design, the part it changed is outlined on stage for a moment, and brought into view if it was out of sight.
- 4ffb1b1: On the iPad canvas, markdown, mermaid and the other non-html surfaces pan and pinch like an html design, and the other widths' artboards show every surface instead of staying blank.
- d612d73: On the canvas, each artboard now stops at the canvas's height and its page scrolls inside it. Under a finger the page takes the touch itself, so the browser scrolls it natively, with momentum, and the canvas never moves with it, not even at the page's end; drag or pinch the space around the artboards to move the canvas. A tap inside the page still selects the part under it, and Mark works as before. With a mouse, a wheel over an artboard scrolls its page.
- fd9ee5c: The canvas header's tools are icons. The width is one button showing the current device; a tap opens a menu of Phone, Tablet, Desktop, Wide and All widths. Try and Mark are icons too.

  On the iPad canvas, a swipe or pinch on a markdown or mermaid surface now moves the canvas, as it does on an html design, instead of scrolling the page out from under it; the canvas no longer covers the header's second row when Safari's bars change the top safe area. Markdown tables keep whole words in narrow columns instead of breaking "Topic" into "Top/ic".

- 817859b: A quieter question card. The header row is gone: a tap on the card's grip minimises it to its edge tab (a drag still moves it), and one footer holds a note button, the count as "1/3" and the arrows. A note opens from its speech-bubble button and still reaches the agent with your next Send, whatever you pick.
- f4c1b7a: The compact question layout (meta line, footer with note, count and arrows) is now used in the desktop side panel and the phone sheet too.
- 439d9f1: The minimised card's tab is roomier and clearer: a chevron pointing the way it opens, with the number of open questions under it (beside it on a top or bottom edge).
- ae4d6b9: On a phone, a question about a slot or a part zooms the stage to that region and scrolls the page to it, instead of fitting the whole screen at a scale too small to see a change by. In every layout, each question brings its region into view once.
- 45cc045: A write-in under "Other…" or a note can be minimized to one line, and stays so as you move between questions. Picking an option no longer throws away what you typed under "Other…": ticking it again brings the text and images back.
- 2622ba9: Markdown surfaces render with markdown-it 15.0.3, which fixes two quadratic-time denial-of-service advisories.
- 40077b8: Minimising the question card docks it on the nearest edge as a slim tab, the same place dragging it there leaves it: the card shrinks into the tab, which slides out of the edge, and a tap grows it back. The tab is drawn in the card's own surface and says only how many questions are open (a check when none).
- d142cdd: A design opens where you clicked it: a tile on the canvas or a row in the tree opens its mock on that state and variant (`?state=&variant=`). Question pictures and tree thumbnails show the whole design instead of its top, and the tree shows each variant's status as a chip.
- 9942a44: Option pictures now show the screen you would actually get: your other answers and tuned values, with only that option changed. Before, every picture used the mock's defaults, so a question asked after "Plain facts" still pictured the default headline. Pictures update in place as you answer, without reloading.
- 8f3d3d8: On a phone or iPad, the canvas now opens a design as one whole screen of its device (a 390 design shows its full 390×844 screen), and shrinks it to fit above or below the question card while the card is open. A pinch on the design itself zooms the canvas, down to half of that fit; tap the scale for true size. Tuned knob values now survive a theme switch instead of falling back to the defaults on the live frame. The color picker opens at full height on iOS Safari, and the header's menu opens above the question card instead of under it.
- 45cc045: On a phone, the mock screen has one scroll and one zoom. The design is a single page fitted to the width that the browser scrolls natively, sideways too once zoomed. A pinch zooms only the design and never scales the viewer around it. The questions are a sheet fixed to the bottom instead of a card that can be dragged and docked. A tap or a swipe folds the sheet to one line naming the current question, the question is its headline, and word answers stack as full-width rows.
- a7f0080: A change to how surfaces render (an upgrade, or an edit to the server) now reaches browsers that already viewed a version: surface documents are cached as immutable only under the current render revision, which the viewer names in their URLs.
- 45cc045: A question opened from Review moves on to the next one still open once answered, and returns to Review only when none are left. The question header says how many are still open on other states, since its count is per state.
- 45cc045: After a Send, the screen moves on by itself only to the next mock from the same agent conversation. A mock owed by another conversation in the repo is offered as Next without moving there.
- 27c063f: Zoom never gets stuck on the design. A trackpad pinch or ⌘/Ctrl+scroll zooms the stage around the pointer, over the design too, and in Try mode as well, while one finger or the mouse keep working the design; two fingers already moved the canvas there. The design on stage gets an accent outline while Try is on.
- e27dd60: Mobile polish for the viewer. A device width that fits the screen now renders at true size: over the bottom sheet the stage goes edge to edge (inside the safe area), a touch screen opens at Phone (up to 600 px wide), Tablet (up to 900) or Desktop, and the current scale ("100%", "84%") shows next to the width picker. Option pictures keep a fixed 4:3 box from the start, so nothing moves under a finger as they load. When a later answer takes a borrowed part out of Mix, Mix and the review say which answer did it. Accent-filled controls (Mark, reactions, part labels, pins) use darker fills so small white text reaches 4.5:1 in dark and light mode. Home rows no longer run off the right edge of a phone.
- b48fa7e: The viewer works over plain http on a LAN or tailnet address: it names itself with a header, so drafts, answers and Send no longer fail there while the browser omits Fetch Metadata.

## 1.2.0

### Minor Changes

- 0358542: Mix can no longer contradict a choice you already made. It skips parts that an answered question or a tuned part knob decided, and it closes wherever you answered a question in words. A borrow that a later answer contradicts is dropped from the draft. Mix never offers a part that fills the whole frame. A borrow previews on the stage with the part spotlit: hover it, or tap it on touch. Mix is marked "Optional · from mockpit". The "Mix uses … instead · undo" override is gone.

  Nudges: a new variant is bound to your existing Look ask when every state has the same variants, and gets a state ask otherwise. `ask` flags visual-sounding options with no `variant` or `set`, and plain asks placed next to a Look ask. The brief and skills now say: a variant decides everything it differs on, and visual options carry a `variant` or knob `set`.

- c17c84a: Attach images to an "Other…" write-in or a note: pick them, paste a screenshot, or drop them on the box; each shows as a thumbnail with a × to remove it. Images upload as soon as they're added (downscaled to fit a model) and reach the agent as `images` / `noteImages` URLs in feedback, plus image content over MCP.
- fb4399a: Answering across many mocks takes fewer steps. After the last question, a review lists every answer (a picture for a variant pick). Tap one to change it and you come straight back. Send stays pinned within thumb reach on a phone. After Send, the viewer moves you to the next mock that still owes answers, oldest first, which is the order the agent published them in. It shows "Next: <title> · N questions ›" with a Stay here button, and your Send's Delivered / Not seen yet chip comes along. The same happens after Accept, Revise or Drop. Home's "Answer next" uses the same order, and a mock you've started shows "draft 2/4". Mock lists on every tier now carry `drafted`, the number of open asks the unsent draft answers (absent when there is no draft). Keys: 1–9 pick, ←/→ move between questions, Enter goes on (Next, Review, Send), `[`/`]` jump to the previous or next mock that owes answers, Esc clears a preview, and `?` lists the keys. On touch, a sideways swipe on the panel moves between questions, and a preview shrinks the sheet so you can see the change.
- a5786f4: The viewer works on phones and tablets (iPhone 13 Pro and iPad mini 6 as the baseline). A finger scrolls a tall mock and a tap selects a part; the stage renders the design at a chosen width (Phone 390, Tablet 744, Desktop 820, Wide 1280), remembered per mock; Inspect opens the stage full screen with Fit / 100% and two-finger pinch zoom. Tune is available in the bottom sheet, the sheet appears whenever the panel won't fit beside a readable stage, fields no longer trigger iOS zoom, touch targets are 44px, and a half-placed mark has visible Cancel and Save buttons. Part comments now record the stage width they were placed at (`anchor.width` in the reply), and marks placed at another width are dimmed.
- c5e941b: Review from a phone without typing. Tap a part and react with 👍, 👎 or "More like this", or react to a whole variant from the stage head when a state has several. Reactions are draft part comments (`reaction`, `variant`), so they travel in the one reply, and the agent reads them as compact lines in `reply.reactions` (`👍 part "hero" (variant B)`) on every tier, apart from typed `comments`. The viewer installs to a home screen: a web app manifest (standalone, theme colours from the workspace mode), icons, and Apple meta tags. On a tokened workspace the manifest's start URL carries the key for a signed-in caller, so a home-screen launch signs itself in. The number of mocks owing answers shows in the tab title and, where the browser supports it, on the app icon badge, live while the viewer is open.

### Patch Changes

- fa39590: Fewer false nudges. `ask` judges option labels, not the question, and no longer flags words like "size", "background", "compact" or "white". A plain ask next to a Look ask is nudged only when an option names a variant or reads visual. Toggles no longer get the knob nudge; a 2–3 option select gets "ask with options that `set` it". A publish's `suggestedAsk` now uses the id `look` (`look-<state>` per state) instead of the built-in's reserved `variant`. The CLI takes `--option Label=knob:path=value` to set a knob from an option. The guide calls the variant-choosing question "the Look ask" throughout.
- fc922ee: Replies no longer get lost when the agent restarts. If you Send to a session that has gone quiet (new conversation, `/clear`, crash), the next agent session in the same project and checkout picks it up through feedback, piggyback or `mockpit watch`, and the batch carries a `handoff` line saying where it came from. Agents running side by side keep their own replies: the earlier session must have made no call since the newer one started, must have no `watch` open, and gets two minutes after a Send to claim it first. In the Thread, a Send waiting on a session like that now reads "Waiting — the agent that asked restarted; the next agent in this project will get it" instead of "Not seen yet".
- 8b661e4: On a phone or tablet, options with nothing to preview (no variant, no knob set) now pick on the first tap, so those questions can be answered and Send appears; taking back a multi pick or a Mix borrow is one tap too. Tapping the panel's grip no longer also taps the option that slides under your finger.

## 1.1.0

### Minor Changes

- 06b8df0: The server keeps an event log for diagnosing agent sessions after the fact: one JSON line per agent call, viewer write and live-feed connection. Each line records the client and its version, the status, the session, the mock, the reply seqs delivered and what was pending, but never content. On Node it is on by default at `~/.mockpit/events.jsonl` (next to the database, rolled over at 10 MB); `MOCKPIT_LOG` sets another path, or `off` disables it. On Workers it goes to Workers Logs. The CLI, the stdio MCP server and the Pi extension now send an `x-mockpit-client: <tier>/<version>` header, so a client left running across an upgrade shows up in the log. `createApp` accepts a `log` sink.

### Patch Changes

- 06b8df0: `pending.viewerOpen` in `feedback`, `read` and the mock list now means "a browser has this mock on screen", not "any browser has the workspace open". Before, every mock in the project read `viewerOpen: true` while a single tab was open, so agents told users a mock was open when it wasn't. The viewer names the mock it shows with `/api/events?viewing=<mockId>`, and the CLI and Pi `pending` lines now print per mock.

## 1.0.0

### Major Changes

- 7c1dda3: The decide rebuild: mockpit is now a design-decision loop. The model is
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
  engine (`mockpit/viewer-embed`) with its `mockpit/theme-tokens` contract, and the JSON file store (`MOCKPIT_STORE=json`)
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

- 8945355: The agent contract never blocks. Design decisions take as long as they take,
  so nothing an agent calls waits for the user: it publishes, asks, tells the
  user in one line where to look, and ends its turn. The user answers in the
  browser at their own pace.
  - **Nine verbs, the same on every tier.** `publish`, `ask`, `read`,
    `feedback`, `say`, `export`, `upload`, `guide` and `run` (code mode). The MCP
    tools carry those names (the server name is the namespace), the Pi extension
    has `mockpit_<verb>`, and the CLI adds `init` and `watch`.
  - **`publish` is the one write.** It creates a mock, state or variant, or the
    next version of an existing one. Send `html`, the full ordered `surfaces`
    list (an entry that is only `{id}` keeps that surface, a missing id removes
    it, the order is the list order), or `parts` to splice marked elements into
    the latest version.
  - **`feedback` returns at once** (`GET /api/feedback`) with every batch the
    user sent since the agent last heard, plus `pending` per mock: `viewerOpen`
    and the draft's progress (`answered`, `of`, `comments`, `touchedAt`). `read`
    returns `pending` too. Every write still returns `feedback`, now under that
    name, and each Send is delivered exactly once across writes, `feedback` and
    `mockpit watch`. In Claude Code, `mockpit watch` under Monitor turns a Send
    into a wake-up.
  - **`say`** (`POST /api/mocks/:id/say`) posts the agent's plain-text message in
    a mock's thread.
  - **Ask discipline.** A publish that leaves several variants with no ask
    binding them returns a nudge and a ready `suggestedAsk`. Until an ask binds
    them, the viewer shows a built-in "Which one?" with a picture per variant;
    its answer arrives like any ask under the reserved id `variant` (per state:
    `variant:<state>`) and accepts and archives per state. Home, `read` and
    `pending` count it as open.
  - **Delivered / Not seen yet.** Each Send in the Thread says whether an agent
    has received it, and the Send confirmation suggests telling your agent
    you've answered when none has.
  - **`run`** scripts publish and ask in one call; `mockpit.feedback()` replaces
    `mockpit.wait()` and the wall limit is 10 s.

  Removed: the CLI's `wait`, `revise`, `comment`, `status`, `show`, `surface`
  and `agent-howto` (use `feedback`, `publish`, `say`, `read` and `guide`); the
  MCP tools `publish_mock`, `revise_mock`, `ask_user`, `wait_for_feedback`,
  `reply_to_user`, `list_mocks`, `get_mock`, `export_mock`, `upload_asset`,
  `get_design_guide`, `add_surface`, `edit_surface`, `remove_surface` and
  `reorder_surfaces`; `POST /api/mocks/:id/revise`, the `/api/mocks/:id/surfaces`
  routes and agent `POST /api/comments`; `timeoutSeconds`; and the `userFeedback`
  field; the guide topic `reply` is now `feedback`, the SSE event `comment-seen`
  is `comment-delivered`, and the page-slot `item=` attribute alias is gone (use
  `slug=`). Refresh pasted setup blocks from `/setup`.

### Minor Changes

- fe09bd2: Icons by name, part-scoped revisions, a shorter brief, and typed MCP results.
  - **Icons by name.** html surfaces write `<i icon="lucide:check"></i>` and the
    server inlines the svg, so frames need no fetch. lucide and mage are bundled;
    `mockpit icons add <set>` installs any other Iconify set for the project
    (`mockpit icons remove` drops it). Publish and revise warn about unknown icon
    names. This replaces the per-project mage sprite upload.
  - **Part-scoped revise.** `revise_mock`, `edit_surface` and the HTTP revise body
    take `parts: { "name" | "name#key": "<outer html>" }`; the CLI takes
    `mockpit revise --part name=file`. The server splices each part into the
    current version's html and reports `applied` next to `partChanges`.
  - **One brief, then topics.** `mockpit agent-howto`, `mockpit guide --brief` and
    `get_design_guide` return one project-aware brief (the loop, parts, asks,
    knobs, the reply, and the project's palette, kit and icons). Reference
    topics (knobs, asks, surfaces, html, reply, http) come on demand with
    `agent-howto --topic <id>` or `get_design_guide({ topic })`. With no server
    running, `agent-howto` prints the generic brief.
  - **MCP output schemas.** Publish, revise, ask, wait, list, get and export
    declare an `outputSchema` and return `structuredContent` on both transports,
    so codemode harnesses can type results. Surfaces share one `Surface`
    definition, which shrinks the catalog.
  - **tunekit from the registry.** The viewer bundles `tunekit@^1.5.0` from npm
    instead of a pinned git commit.
  - **Tailwind projects keep their classes.** `mockpit init` stores the repo's
    Tailwind entry stylesheet (non-core imports, plugins and config stripped) and
    the frame loads it as Tailwind source, so `bg-card` and
    `text-muted-foreground` resolve like in the codebase. No more
    `bg-[var(--card)]`.
  - **Kits by reference.** A kit can be a hosted stylesheet. `basecoat` ships as
    the shadcn-shaped vocabulary for projects with no design system, and a project
    can register its own stylesheet with `mockpit kit add <id> --url … --doc …`
    (or `init --kit-url`). Any bundled or project kit can be the project's default.
  - **The brief reads the repo's design files.** `DESIGN.md`, DTCG `tokens.json`
    and shadcn `components.json` feed the brief when present: the team's rules,
    the main tokens and the installed component list.
  - **Waits agree.** `mockpit wait`, `wait_for_feedback` (stdio and HTTP) and the
    Pi extension all default to 55 seconds and cap at 230: under the 60 s tool
    timeout Codex and the MCP SDK use by default, and under claude.ai's 240 s
    limit. A wait the client cancels no longer consumes the feedback; the next
    wait gets it.
  - `mockpit ask "<question>" --asks <file>` is now an error instead of dropping
    the question, and `mockpit watch --help` prints its own help.

- 4b756d2: Designer reshape: mockpit is now organised as **project › item › variant ›
  version** instead of a stream of posts. A project is a repo, an item is a
  component or a page addressed by a stable slug, variants are parallel takes shown
  as tabs, and versions are the item's history with the basis version and the
  prompt that produced it.
  - **Review loop.** Comments accumulate as drafts on a version and are released as
    one batch by the user's decision: **Revise** sends them, **Accept** approves a
    version and archives its sibling variants, **Drop** archives a variant
    (restorable). Agents wake once with the whole batch.
  - **Markers.** Comments can carry several anchors drawn on the render, referenced
    as `@1`, `@2` in the text, each with the element's CSS path and visible text,
    plus the viewport preset (390 / 820 / 1280) that was being reviewed.
  - **`mockpit init`.** Detects the repo's design system (Tailwind/shadcn, CSS
    custom properties, fonts), imports its palette, picks a kit, uploads a Mage icon
    sprite, and writes `.mockpit/starter.html` — so agent markup speaks the repo's
    vocabulary. `mockpit guide --brief` and `get_design_guide` render the project's
    real tokens, kit and icons.
  - **New CLI verbs:** `init`, `publish --item/--variant`, `revise --from`, `page`,
    `ask`, `wait` (batched), `status`, `show`, `export`, plus `--json`/`--quiet`.
  - **New MCP tools:** `publish_item`, `revise_item`, `ask_user`, `list_items`,
    `get_item`, `export_item`, `init_project` (stdio), with `wait_for_feedback`
    returning the batch shape.
  - **Leaner reads.** `get_item` / `mockpit show` return history metadata only;
    bodies are opt-in behind `--body` / `--history`.
  - **Push and webhooks.** Web Push on `ask` and on new versions, plus outbound
    `POST /api/hooks` webhooks.
  - **Export.** Accept hands the agent the accepted html, its prompt history and a
    screenshot; `mockpit export` writes them to `.mockpit/accepted/`.

  The item screen no longer renders the post card, so the share menu,
  per-comment copy and delete-post controls are reachable only on the standalone
  `/p/:id` page. Project routes (`/api/projects*`) are not exposed under
  session-scoped public read.

  Back-compat: legacy HTTP routes, the `parts` body key, `?part=`, the `/s/:id`
  alias and the deprecated MCP tool aliases are unchanged. The deprecated aliases
  are now hidden from `tools/list` unless `MOCKPIT_MCP_LEGACY=1` is set.

- 429574f: Renamed the fork from sideshow to mockpit: the CLI binary, package, MCP server,
  `MOCKPIT_*` environment variables, the `~/.mockpit` data directory and the viewer
  brand all use the new name.
- d3b2a93: Scripts. `run` executes a JavaScript script on the server against a typed
  `mockpit` API, so an agent can publish variants, ask and wait for the reply in
  one call. It is `POST /api/run`, `mockpit run <file>`, and the one tool of a new
  codemode MCP catalog at `/mcp?mode=code` (stdio: `MOCKPIT_MCP_MODE=code`, with a
  `path` param for local scripts). The default `/mcp` catalog is unchanged.
  Scripts run in QuickJS inside a worker thread with no network, timers, imports
  or `process`, under a 200 s wall limit, a CPU budget, 32 MiB of memory and caps
  on calls and output. The result lists every host call in order and carries
  every reply the run received, even when the script then fails. The Cloudflare
  Worker has no sandbox and answers that `run` is unavailable. New guide topic:
  `scripts`.

### Patch Changes

- 67cf8dc: Every question in the viewer now has an "Other…" write-in and an opt-in note.
  Other is the answer when no option fits. It arrives in the reply's `asks[]` as
  a `chosen` entry `{ id: "other", label, other: true }`, flips no variant and
  sets no knob, and `other` is now a reserved option id. A note qualifies the
  answer ("Table on desktop, Cards on mobile") and arrives as `note` on that
  `asks[]` entry. Either one alone answers the question. Both stay in the draft
  until Send. The Tune tab now shows only when there is something to tune: knobs,
  marked parts or a part ask.
- 4099f20: A resumed Claude Code conversation (`--resume`, `--continue`, a restart or an MCP reconnect) now reclaims its mockpit session instead of starting a new one, so the reply sent while the agent was away reaches it on its next `feedback`. The stdio MCP server and the CLI key the session on `CLAUDE_CODE_SESSION_ID`; `POST /api/sessions` accepts a `key` and returns the existing session for it.
- 8f89777: The viewer can notify you. Turn on the bell in the top bar and, while a mockpit
  tab is open but not in front, a new question, a new version or an agent comment
  raises a browser notification for that mock. A burst of writes to one mock is
  one notification, and clicking it opens the mock. `post-created` and
  `post-updated` feed events now carry `by: "agent" | "user"`.

## 0.14.0

### Minor Changes

- 604ca24: serve: add `--host` / `SIDESHOW_HOST` to bind one address

  `serve` listened on every interface with no way to restrict it, and printed
  `listening on http://localhost:PORT` regardless — so a server sharing a host or
  a network with anything else was reachable from it, and the startup line said
  otherwise. The default is unchanged (every interface, which is what containers
  and LAN-shared instances need); `--host 127.0.0.1` now keeps it off the network
  entirely, and the startup line reports the address actually bound.

- 14a8ea3: viewer: fold the card's export actions into one share menu, with copy-as-markdown

  A card's footer carried three separate icons that all meant "take this
  elsewhere" — copy link, open in a new tab, open as a PNG — and no room for a
  fourth. They are now rows in a single **Share** menu, joined by **Copy as
  markdown**: the whole post as portable markdown, with prose kept as prose,
  code/diffs/terminal output/JSON/mermaid as fenced blocks, images as image links,
  and an html surface degraded to a link back to it rather than a dump of its
  markup.

  The flattening is served, not derived in the browser, so every tier can have it:
  `GET /api/posts/:id/markdown` returns the same text for `curl` and the CLI.

### Patch Changes

- 68531b2: Show a recent-posts Home view for first-time visitors to multi-session workspaces, with live updates and safe themed previews.
- 11c4434: Cache fully pinned social-preview screenshots at the Cloudflare edge so repeated link unfurls avoid redundant Browser Rendering calls. Access, post existence, and revision are revalidated on every edge request, and token-protected boards keep private client cache headers.
- feac177: Make recent-post ordering deterministic when multiple writes share the same millisecond timestamp, preventing different SQLite versions from selecting different posts at the result limit.
- 102990f: Load the rich-surface renderers and publish-time parsers on first use instead of
  at boot. shiki, `@pierre/diffs`, markdown-it and `@mermaid-js/parser` are now
  imported when a markdown/code/diff/terminal surface is rendered or a diff/mermaid
  surface is published, rather than by every server at startup. Idle memory drops
  from ~132 MB to ~102 MB and boot time from ~486 ms to ~275 ms; a workspace that
  only ever uses html surfaces never loads them at all. No behavior change.
- ea2fb02: Highlight code against one theme instead of two when the color scheme is already
  known. shiki tokenizes once per theme, so asking for a light/dark pair costs
  exactly twice as much — and the viewer always tells the server which scheme it
  resolved, so half that work was being discarded with CSS. Rendering a
  1400-line code surface drops from 1.14s to 543ms and its document from 751KB to
  529KB; markdown with fenced code improves by roughly the same proportion. An
  unpinned direct load of `/s/:id` still gets both themes and follows the OS.
- b0f6a94: Comment authors are now derived from the session agent for CLI, MCP, and other programmatic writes. The reserved `user` label is limited to same-origin viewer comments, preventing agent integrations from forging user feedback.
- 6c1073a: Invalid Mermaid submitted through the posts API now returns a typed validation
  error with the failing request field, diagram type, complete parser diagnostic,
  and concrete retry steps. The existing human-readable `error` string remains
  for compatibility, and rejected diagrams are not persisted.

## 0.13.0

### Minor Changes

- 8822dea: Add a minimal control to collapse the desktop session sidebar into a narrow rail.

### Patch Changes

- 4161897: Coalesce the session-list refreshes triggered by a burst of live post events. Each post still streams into the open session independently, while sidebar metadata waits for a short quiet window and shares one request instead of fetching the full session list once per post.
- 120705e: Stop live viewer updates and session hydration from downloading a post's complete revision history. Both paths now use a compact viewer representation with current render metadata, native surface data, and a retained-version count, while the existing post detail endpoints keep returning full history.
- 6f81fa1: Refresh runtime and build dependencies to patched releases so the security audit passes with no known vulnerabilities. This also moves the Cloudflare type configuration to the current package entrypoint required by the latest Wrangler release.
- 287bb3d: Make the session-list endpoint count posts through a narrow store aggregate. SQLite no longer selects or decodes post surfaces and history, while the JSON store avoids cloning and sorting posts after loading the workspace. Custom stores without the optional capability keep the existing `listPosts` fallback.
- f15dc13: Speed up SQLite-backed workspaces by indexing session posts, recent posts, comment lookups, and session assets.
- 66c5f74: Align the shipped Pi extension with the current post contract: support JSON and code surfaces, require a real surface target for browser-thread replies, and remove experimental trace publishing from agent-facing schemas and guidance.
- 2b98bbf: Cut session-opening hydrate responses by omitting sandboxed surface bodies the viewer never reads. Sandboxed surfaces render through their own versioned iframe URLs, so duplicating those bodies in the session payload only delayed the stream. Across the six largest sessions in a real store, this reduced the response by 95% raw and 91% gzipped. The compact viewer contract above now also replaces retained history with a version count, while full post-detail APIs remain unchanged.

- 9bbcb5e: Fix surface iframes staying stuck at their seed height when a host mounts two
  viewer instances into one JS realm at once (e.g. an embedding host that
  cross-fades an outgoing viewer into an incoming one during an in-place
  navigation). Because the engine loads as a single shared module, both instances
  shared the module-level surface-frame registry (`cardEls`) and the single
  `message` bridge listener. Two instances routing to the same URL rendered a
  `Card` for the same post, so keying `cardEls` by post id let them clobber each
  other's entry — and the outgoing instance's teardown deleted the entry the
  still-visible instance needed, so its surface `resize` messages were dropped and
  the frames never grew past their seed height. The shared listener had the same
  hazard: `removeEventListener` on the first teardown tore it out from under the
  survivor.

  `cardEls` is now keyed by a per-`Card` token (resolved by `contentWindow`, with a
  new `cardForPost` for the scroll-to-card pill), and the bridge listener is
  reference-counted so it lives while any viewer is mounted. Self-hosted single-
  instance behavior is unchanged.

## 0.12.0

### Minor Changes

- a11db09: Add fullscreen Mermaid diagrams and guidance for vertical, card-friendly flowcharts.
- 9e9eb90: Add `send_test_post` — a built-in welcome/test post for newly connected agents. One no-arg call publishes a fixed card (shipped with sideshow, themed for light/dark) that confirms the connection works and shows the user example prompts to try. Available on all three tiers: the `send_test_post` MCP tool (HTTP and stdio), `POST /api/test-post`, and `sideshow test-post`. Idempotent — if the welcome card is already on the board it is returned (`alreadySent: true`), never duplicated. The MCP initialize instructions now nudge freshly connected agents toward it.

### Patch Changes

- d6e56e0: Port the cleaner connect-an-agent onboarding screen from sideshow-cloud to the self-hosted viewer.
- ef445fd: Show a pulsing sidecar dot next to the version pill when a post revision was updated recently.
- b4d6a42: Harden the trusted viewer against clickjacking and referrer leaks. The viewer
  HTML (the app origin, shared with the authenticated API and the comment→agent
  channel) now sends `Content-Security-Policy: frame-ancestors 'self'`, refusing
  cross-origin framing; the sandboxed `/s/:id` surface documents are unaffected
  and keep their own `sandbox` CSP. External links the viewer opens — the
  `openLink` bridge's `window.open`, the release-notes markdown links, and the
  image/trace/footer anchors — now use `rel="noopener noreferrer"` (and the
  `noreferrer` window feature), so the current URL (which can carry the `?key=`
  deploy token) never rides an outbound `Referer`.
- bf0dd67: Fix blank page when opening a post permalink (`/p/:id`) on a
  `publicRead="session"` workspace without authentication. The SSE connection
  fired before the viewer discovered the post's session ID, hitting `/api/events`
  without the required `?session=` param and getting a 401. The connection is now
  deferred until after the initial post fetch resolves.
- 32ed841: Add reusable skeleton loading states for viewer streams and lists.
- 5d2bd91: Reduce MCP instruction and tool-schema context overhead while preserving every canonical and deprecated tool.

## 0.11.1

### Patch Changes

- af09e7a: Emit canonical `/p/<id>` post links everywhere a link is produced, finishing
  the post/surface vocabulary migration. The CLI (`sideshow publish` / `update`
  output), the viewer's copy-link and open-as-image actions, the `<link
  rel="canonical">` / OpenGraph preview tags, the viewer's History API URL shapes
  (`/p/:id` and `/session/:id/p/:postId`), and every MCP tool response —
  including the deprecated `publish_surface` / `publish_snippet` aliases — now
  return `/p/` URLs.

  Nothing inbound changes: `/s/:id`, `/session/:id/s/:postId`, and `/s/:id.png`
  remain accepted as legacy aliases (the screenshot Worker now matches both
  `/p/:id.png` and `/s/:id.png`), and old `/s/` links keep resolving to the same
  post page.

## 0.11.0

### Minor Changes

- 2bc9db6: Return per-surface ids, kinds, and indexes in write responses without echoing surface payload bodies, and remove the redundant top-level `kinds` array. Read kinds from `surfaces.map((surface) => surface.kind)` instead.
- 28a3a6d: Add a host-overridable `ss:aside-head` slot at the top of the sidebar, above the session list (mirrors `ss:aside-foot`). Self-hosted rendering is unchanged; an embedder can project a sidebar header — e.g. a workspace picker and a pinned Home link — above the session list.
- 71bf606: Add a `hideBrand` flag to the embed host contract. When set, the engine omits its own "sideshow" wordmark (the sidebar/header home-link brand) so a host that supplies its own branding — e.g. a workspace picker atop the sidebar and a wordmark in the footer — isn't doubled up. Self-hosted leaves it unset and shows the wordmark as before.
- 1b7a28c: Add a `homeView` flag to the embed host contract. When a host owns its own session-less landing (e.g. a "home" feed), the engine no longer auto-selects a session on boot — it honors a deep-linked route session but otherwise stays session-less so nothing is highlighted behind the host's landing, and it clears the selection when the route later becomes session-less. Self-hosted leaves the flag unset and is unchanged (auto-selects the latest session on boot).
- 5eba65a: Add a server `onEvent` feed tap for hosts and a `liveTransport: "ws"` viewer-embed option so hosted wrappers can provide hibernation-friendly WebSocket live updates while self-hosted sideshow keeps using SSE by default.
- ffe7099: Embed host contract: `onThemeChange` now receives a second `meta` argument —
  `{ theme, mode }` — naming the resolved theme id and light/dark scheme behind the
  tokens it already reports. Hosts that re-render surfaces out-of-band (e.g.
  server-side preview frames they can't theme from the token values alone) can pass
  those identifiers to `/s/:id?theme=&mode=` to reproduce the exact look; hosts that
  only paint from the token values ignore it. Additive — the tokens argument is
  unchanged and the default self-hosted host is unaffected.

### Patch Changes

- ed8b987: Validate `sideshow surface add` has at least one surface flag before resolving or creating a session, and resolve long-poll waits promptly when clients disconnect.
- 7698b1f: Hydrate session post streams from the session list endpoint to avoid N+1 post detail requests on open.
- 23dad90: Lazy-load sandboxed surface iframes to reduce initial viewer work on long sessions.
- 46cf918: Fix markdown/code/diff/mermaid surfaces rendering on a white canvas (washed-out
  text) on a dark board. These rich-part frames are sandboxed opaque-origin
  iframes, which default to `color-scheme: normal` (light), so in dark mode the UA
  painted a white backdrop behind the transparent body. They now pin `color-scheme`
  to the resolved scheme — like html surfaces already do — so the frame's canvas
  tracks the card in both light and dark.
- 2bc9db6: List session posts with canonical `surfaces` entries that include surface ids and omit elided html bodies.
- cc6504c: Slides kit now grid-stacks its deck so it cross-fades in normal flow. Previously
  it swapped slides with `display:none`, which can't fade — so decks were hand-rolled
  with `position:absolute` slides over a `min-height` stage, an out-of-flow layout the
  surface-page height bridge can't measure (the overlay grows `scrollHeight` but not
  the box its ResizeObserver watches), leaving the frame clipped/frozen. The kit now
  stacks slides in one grid cell (in flow, sized to the tallest slide) and fades with
  opacity/visibility, so the frame follows it. DESIGN_GUIDE documents the out-of-flow
  trap and the grid-stack recipe alongside the existing `position: fixed` ban.
- 2bc9db6: Expose derived 0-based surface indexes on post detail, session post list, and post history read responses.
- 0a094ac: Let direct rich-surface renders without an explicit mode follow the browser's system color scheme.
- 565c85f: Fix intermittent clipping in surface iframes when async content settles after the initial resize pass.

## 0.10.0

### Minor Changes

- 132699b: `sideshow publish` and `sideshow surface add` now accept repeated surface
  flags to add several surfaces of the same kind. Previously a repeated
  non-multiple flag (`--diff a --diff b`) was silently dropped to the last
  value with no error.
  - `sideshow publish <html> --diff a.patch --code c.ts --diff b.patch` now
    produces `[html, diff, code, diff]` — each repeat adds a surface, in
    command-line flag order.
  - `sideshow surface add <id> --md a.md --md b.md` appends two markdown
    surfaces (one append call per surface, so `--before`/`--after` positioning
    still applies per surface).
  - The seven surface flags (`--md`, `--mermaid`, `--diff`, `--terminal`,
    `--json`, `--code`, `--image`) are now `repeatable` in both commands.

  This closes the remaining gap from #151 (multiple surfaces of the same kind
  on the CLI); surface order control was already fixed in 0.9.x via the
  token-walk for #158.

- d58264a: Per-surface operations across CLI, HTTP API, and MCP. Surfaces now carry
  stable server-assigned ids for targeted operations.

  **CLI**
  - `sideshow publish` now honors flag order: surfaces appear in the order
    their `--md` / `--code` / `--diff` / etc. flags appear on the command line,
    not a fixed sequence (fixes #158).
  - `sideshow update <id> <file|-> --surface N` targets a specific surface in a
    multi-surface post (by id or 0-based index) for content-only edits.
  - New `sideshow surface` subcommand:
    - `surface add <postId> [--md f] [--code f] ...` — append surfaces to an
      existing post (flag order honored).
    - `surface remove <postId> <N|id>` — remove a single surface.
    - `surface edit <postId> <N|id> <file|->` — replace a surface's content.
    - `surface move <postId> <N|id> --to M` — reorder a surface.

  **HTTP API**
  - `POST /api/posts/:id/surfaces` — append a surface (optional `before`/`after`
    for insert position).
  - `PATCH /api/posts/:id/surfaces/:target` — replace a surface (full or
    content-only). `:target` is a surface id or 0-based index.
  - `DELETE /api/posts/:id/surfaces/:target` — remove a surface (400 if last).
  - `PATCH /api/posts/:id/surfaces` — reorder surfaces. Body: `{order: [id, ...]}`
    or `{order: [2, 0, 1]}`.
  - `PATCH /api/posts/:id` extended: optional `surface` param targets a specific
    surface in multi-surface posts (previously rejected with 400).

  **MCP**
  - New tools: `add_surface`, `edit_surface`, `remove_surface`,
    `reorder_surfaces` — all additive; `update_post` full-replace stays for
    back-compat. Available on both stdio and HTTP MCP transports.

  **Data model**
  - Every surface now carries an optional `id: string`, assigned server-side on
    create/update. Existing data is migrated automatically (one-time migration
    on first boot, gated on a settings sentinel for SqlStore; in-memory
    normalization on load for JsonFileStore).

  **Viewer**
  - Surfaces are keyed by stable `id` (Solid `<For>` with `reconcile({ key: "id"
    })`) instead of array position, so reordering moves DOM nodes instead of
    re-creating them.

### Patch Changes

- f0e0337: Drop the dead `/u/`-prefix URL fallback from the default viewer host. The
  embeddable engine's `createDefaultHost()` now derives its base path solely from
  `window.__SIDESHOW_BASE_PATH__` (empty at root) instead of also sniffing a
  `/u/:account` prefix out of `location.pathname`. That fallback was specific to an
  old hosted-wrapper URL shape; self-hosted sideshow already runs at the root or
  sets the global explicitly, so behavior is unchanged for every supported host.
- 132699b: Fixed a latent bug where post, surface, and session ids could start with `-`
  or `_` (URL-safe base64 maps `+`→`-`, `/`→`_`, so ~1/64 of ids began with a
  separator). Any id starting with `-` broke CLI commands that take an id as a
  positional — `node:util` `parseArgs` treated it as an unknown option
  (`Unknown option '-6'` for an id like `-6K4AJsKD4M`), affecting `sideshow
  update`, `show`, and `surface add/remove/edit/move`. Two fixes:
  - `newId` now swaps a leading separator for an alphanumeric, so new ids are
    always CLI-safe.
  - The CLI's `parse()` wrapper swaps id-shaped `-`/`_`-prefixed tokens for a
    sentinel before `parseArgs` sees them, then restores them in the result
    (positionals, tokens, option values). This rescues already-stored ids that
    start with a separator.

- ab5f91a: Fix the mobile sessions drawer in embedded WebKit viewers so the menu button
  opens the session list reliably.
- d26f7cc: Respect configured base paths for uploaded asset URLs and native image/trace surface loads.
- 9e61484: Add a recent posts feed endpoint at `GET /api/surfaces/recent`, returning the newest updated posts across sessions with capped surface previews.
- 392a134: Add a light/dark/system color-mode switcher next to the theme picker.
- 35f75c8: Add a proof-of-concept for anchored comments on surfaces. Comments can now carry sanitized surface anchor metadata, the viewer can place host-owned pins over rendered surfaces, and agent feedback includes anchor context.
- c498e7d: Use post and session titles for browser tab and share-page titles.
- 3672369: `sideshow update` now preserves the surface kind instead of always treating
  content as HTML. A markdown post updated with `sideshow update <id> file.md`
  stays markdown; a code post stays code with its language preserved; diffs keep
  their layout, terminals keep their cols — every kind-specific field is carried
  forward. The same fix applies to all text-content surface kinds (html,
  markdown, code, diff, terminal, mermaid, json).

  Implemented as a new `PATCH /api/posts/:id` endpoint that accepts raw
  `content` (plus optional `title` and `kits`) and slots it into the existing
  surface's kind, rather than requiring the caller to construct the full typed
  surface object. Multi-surface posts return a 400 for now — surface-level
  targeting is a future addition. The existing `PUT` full-replacement API is
  unchanged.

- b04251f: Stop the viewer engine from pinning the default (topmost) surface in the URL
  when a session auto-opens. Landing at the top of a session feed now keeps the
  URL at `/session/:id`; only an explicit surface open (a deep link, or scrolling
  into a surface) writes `/session/:id/s/:id`. Deep links loaded from the URL are
  still honored and preserved.

## 0.9.0

### Minor Changes

- 3046bc9: Add a host-overridable `ss:aside-empty` slot for the sidebar's empty state. When the session list is empty (post-load), it now shows a lightweight native "Connect an agent" row — the first item of an otherwise-empty list — with a plug icon and a one-line helper, instead of a blank list area. Clicking it scrolls to the empty-board pane (`ss:empty`) that holds the connect instructions. An embedder can project a `slot="ss:aside-empty"` child to replace the fallback with its own empty-list nudge; once a session exists, neither renders. Self-hosted gets the affordance via the fallback; the slot lets embedders override it.
- fdc5b3e: The engine now uses the canonical `/api/posts` wire and `post-*` SSE events; legacy `/api/surfaces` routes, `surface-*` aliases, and `publish_surface` MCP tools remain as deprecated aliases.
- 14c48dd: Bring the new **post / surface** vocabulary to the HTTP and MCP wire layers,
  additively. The canonical hierarchy is now **workspace ▸ session ▸ post ▸
  surface** (a post is an ordered list of surfaces); the older spellings keep
  working as deprecated aliases — nothing is removed.

  New HTTP routes mirror the existing surface routes, sharing the same handlers:
  `GET/POST/PUT/DELETE /api/posts(/:id)`, `GET /p/:id` (with `?surface=N`),
  `GET /session/:id/p/:postId`, and `GET /api/sessions/:id/posts`. The publish
  and revise handlers now accept a `surfaces` body (falling back to the legacy
  `parts`), so both `/api/posts` and `/api/surfaces` take either field; `/p/:id`
  and `/s/:id` accept `?surface=N` as well as `?part=N`.

  New MCP tools `publish_post`, `update_post`, and `list_posts` are advertised on
  both transports, advertising a `surfaces` argument and emitting `/p/<id>` view
  URLs. The legacy `publish_surface` / `update_surface` / `list_surfaces` tools
  remain (now described as deprecated aliases) and still accept `parts`.
  `reply_to_user` additionally accepts a `postId` argument. Tool prose and schemas
  are rewritten in the new vocabulary (surface→post, part→surface,
  board→workspace).

- 13e6a14: Each surface footer gains an **open-as-image** action that opens the surface
  rendered as a PNG (`/s/:id.png`). The image is captured by Cloudflare Browser
  Rendering, so the action is live only on a Workers deployment; on a plain Node
  server it is shown but disabled, with a tooltip pointing at the README. The
  embeddable engine learns the capability through a new host field
  (`SideshowHost.screenshots`); `createApp({ screenshots })` surfaces it to the
  self-hosted viewer via `window.__SIDESHOW_SCREENSHOTS__`, and the Workers entry
  sets it (the Node entry leaves it off).
- 80cc684: Adopt the **post / surface** vocabulary throughout the viewer engine and the
  host contract. The canonical hierarchy is **workspace ▸ session ▸ post ▸
  surface**: a **post** is the published artifact (an ordered list of surfaces),
  and a **surface** is one block inside a post.

  This is an internal rename of the viewer's local identifiers, component names,
  props, CSS classes, and user-visible strings — behavior is unchanged and all
  wire paths, query keys (`?part=`), SSE event types, and server-provided JSON
  field names are kept byte-identical for compatibility. The block component
  files were renamed (`ImagePart`→`ImageSurface`, `JsonPart`→`JsonSurface`,
  `TracePart`→`TraceSurface`), and the server helper `surfaceParts.ts` is now
  `postSurfaces.ts` (`coerceSurfaceParts`→`coerceSurfaces`,
  `validateSurfaceParts`→`validateSurfaces`).

  **Host-contract change (embedders must update):** the host identity key
  `identity.accountSlug` is renamed to `identity.workspaceSlug`. Any embedder
  passing `accountSlug` on the injected host's `identity` must rename it to
  `workspaceSlug`.

### Patch Changes

- 138dafe: Add `sideshow --version`, `-V`, and `version` subcommand. Prints the installed version and checks the npm registry for updates (best-effort, 3 s timeout, 24 h disk cache).
- 5dfcb82: Held SSE (`/api/events`) and long-poll (`/api/comments?wait=N`) connections
  are now bounded per workspace. Both are GETs that pin a socket open and, on a
  `publicRead` board, are reachable unauthenticated — without a ceiling a flood
  could exhaust connections (cleanup was already correct, there was just no
  limit). Once over `maxHoldConnections` (default 32, configurable via
  `AppOptions`), new held connections return `503`; an instant `?wait=0` read
  still succeeds since it doesn't hold a slot. Slots release exactly once on
  stream/request abort or normal return. The default is sized for the real
  concurrency of a single-user workspace — a few viewer tabs (one SSE each) plus
  active agent long-polls, including a multi-agent session with several agents
  connected at once — since one workspace is one user; a real flood is orders of
  magnitude bigger, so the cap rejects it regardless of the exact default.

  Also indexes the referenced-asset set used by `/a/:id`'s optimistic-read wait
  and asset eviction: it was re-parsing every post's `surfaces` + `history` JSON
  on each call (a full-table scan on every `/a/:id` miss), and is now built
  lazily and maintained incrementally on post create/update and invalidated on
  remove. History is append-only, so an asset id once referenced stays
  referenced until its whole post is deleted — the cache stays correct without
  re-scanning.

- faa1322: The `json` and `code` surface kinds (publishable over the CLI and REST since
  they were added) are now advertised by the MCP tools too. Both the streamable
  HTTP (`/mcp`) and stdio MCP transports list `json` and `code` in their
  `publish_post`/`update_post` (and the deprecated `publish_surface`/
  `update_surface` aliases) `kind` enums and document their fields (`data` for
  json; `code`/`language`/`title`/`lineStart` for code), so an MCP agent can
  publish a collapsible JSON tree or a syntax-highlighted code block — not just
  CLI/REST callers.

  To stop the surface-kind list from drifting between tiers again, all three
  surfaces now derive from one canonical `SURFACE_KINDS` list in
  `server/types.ts`: the `SurfaceKind` type, both MCP `kind` enums, and a new
  `test/mcpSpec.test.ts` guard that fails if any kind is missing from the MCP
  schemas or the runtime validator.

- 3177e5b: Improve the mobile viewer layout for phone-sized screens, including sidebar ergonomics, native surface primitives, and timeline trace readability.
- 67a9681: Adopt the **post / surface** vocabulary across all human-readable text: the
  design/how-to guides (`guide/*.md`, `AGENTS.md`), the CLI help, usage, and
  user-facing messages (`bin/sideshow.js`), and the comments and non-wire strings
  in `server/*` and the residual viewer comments. The canonical hierarchy is
  **workspace ▸ session ▸ post ▸ surface**: a **post** is the published artifact
  (an ordered list of surfaces), a **surface** is one block inside a post, and the
  tenant is a **workspace**. This is prose and CLI-help only — no behavior, API,
  route, query-key, SSE-event, MCP-tool-name, or identifier changes. All
  wire-bound strings (`/api/surfaces`, the `parts` body key, `?part=`,
  `surface-created/updated/deleted`, the deprecated MCP tool aliases, the
  `status board` kit, `--surface`) are kept byte-identical, and the CLI keeps
  every endpoint and subcommand it has today (a new `--post` flag on `sideshow
  comment` is added alongside the existing `--surface`/`--snippet` aliases).
- 76a9976: Move the default data directory from the package-relative `<package-root>/data/` to a user-owned `~/.sideshow/`. The package-relative default was read-only under `sudo npm install -g` (crashing with `EACCES` even after the #157 mkdir guard) and was wiped on every `npm install -g` upgrade — silent data loss. `~/.sideshow/` is always writable and survives reinstalls. A one-time migration copies any existing `sideshow.{db,db-wal,db-shm,json}` from the old location to the new one on first boot (only when using default paths; `SIDESHOW_DATA`/`SIDESHOW_DB` overrides are unchanged and skip the migration).
- 61b57f2: Fix first-run crash when the SQLite db path's parent directory does not exist. `node:sqlite` does not create missing parent directories, so the default `<package-root>/data/sideshow.db` path (no `data/` shipped in the package) failed with `ERR_SQLITE_ERROR: unable to open database file` on a fresh `npx sideshow serve`. `createSqliteStorage` now `mkdirSync(dirname(path), { recursive: true })` before opening, guarded by the existing `:memory:` check so the in-memory contract suite is untouched. A user-supplied `SIDESHOW_DB` pointing into a not-yet-created directory now works too.
- da74857: Submit-time validation now rejects diffs and mermaid diagrams that won't
  render, not just ones with the wrong shape. A `diff` part whose `patch`
  parses to zero files (e.g. a hunk without `---`/`+++` headers) returns a
  `400` from `POST /api/surfaces` and `PUT /api/surfaces/:id` with the parse
  error. A `mermaid` part whose source fails to parse also returns a `400`;
  the parser (`@mermaid-js/parser`, the official mermaid-js extraction) covers
  the 15 Langium-migrated diagram types (pie, gitGraph, architecture, radar,
  treemap, wardley, …) — types still on Jison (flowchart, sequence, class,
  state, er, gantt) skip validation and fall back to the viewer's existing
  graceful render-failure UI. MCP tool calls (loose mode) drop the invalid
  part instead of publishing a broken card.

## 0.8.0

### Minor Changes

- f8fb7b3: Viewer: the sidebar wordmark is now a home link. Clicking "sideshow" (in the aside, or the mobile topbar) clears the current session and returns to the session-less base route — a guaranteed way back to the board from anywhere. It's a real `<button>`, so it's keyboard- and screen-reader-reachable. The new `goHome()` always asks the host to navigate (it never short-circuits on the engine's own selection), so an embedding host that layers its own view over the board — e.g. sideshow cloud's full-page Settings, which has no session rows to click out of on an empty board — gets a reliable exit through the same click; the host dedupes a no-op move. Self-hosted behaviour is otherwise unchanged.
- 4822f77: Embeddable engine: add `onReady?()` to the `SideshowHost` contract and stop flashing the empty-board onboarding before sessions load. On mount the board has no sessions yet, so it rendered `#onboard` (the "setup" pane) until `/api/sessions` resolved, then swapped to a session — a visible flash. The onboarding pane is now gated behind a first-load signal so neither pane is decided before that fetch returns, and the engine calls `host.onReady()` once it resolves and the board is decided. An embedder (e.g. sideshow cloud) holds its loading overlay until then so its users never see the pre-load flash; it fires even if the fetch failed (the board falls back to onboarding), so an overlay can't get stuck. Optional: the trivial self-hosted host omits it — self-hosted simply no longer flashes onboard.
- 760320f: Embeddable engine: add `onThemeChange?(tokens)` to the Host contract. The engine now PUSHES its fully-resolved palette to the host on initial mount, on every live theme switch, and on an OS light/dark flip — symmetric with `router.navigate`. An embedder (e.g. sideshow cloud) mirrors those tokens onto its own chrome instead of scraping computed styles across the shadow boundary. Optional: the trivial self-hosted host omits it, so self-hosted behaviour is unchanged.
- 38992d7: Embeddable engine: expose `layout` and `readonly` on the `SideshowHost` contract. A host can now request the stream-only layout (`layout: "stream"` — no sidebar/session list, just the current session's stream) and hide write affordances (`readonly: true`) without relying on the self-hosted `window.__SIDESHOW_*` globals. Self-hosted public-read "session" links keep mapping to the stream layout, so that flow is unchanged.
- 23be3a1: Link unfurl / inline preview support. Bare `/s/:id` URLs now serve the viewer shell with Open Graph and Twitter Card metadata, so pasting a surface link into Slack, Twitter/X, Discord, or iMessage renders an inline preview card. The `og:image` points to `/s/:id.png?card=1`, which captures a fixed 1200×630 social-card screenshot. Metadata uses only the surface title and a static description — no tokens or session context are leaked.
- 12bb6b4: Embeddable engine: add a `ss:main` host-overridable slot (`SLOTS.main`) wrapping the whole main content pane (onboarding + session stream). Its fallback is the engine's normal board, so a plain embed and self-hosted sideshow are unchanged. Unlike the always-on footer/empty/session-action overrides, this one is meant to be projected conditionally: an embedder (e.g. sideshow cloud) projects a `slot="ss:main"` child only while its own full-pane view is active — taking over the main area while the sidebar (session list, account footer) stays — and the engine falls back to the board when the child is gone.
- bd8df08: Screenshot surfaces as PNG by appending `.png` to any surface URL (e.g. `/s/:id.png`). Uses Cloudflare Browser Rendering to capture the rendered page. Supports `?mode=dark|light`, `?theme=`, `?w=` (width), and `?nocache` params. The viewer persists the user's OS color-scheme in a cookie so screenshots automatically match their light/dark preference.
- e924954: Rename the data model: the published artifact `Surface` → `Post`, and its blocks (`SurfacePart` and the `*Part` variants) → `Surface`. The block field `parts` → `surfaces`, and comment links `surfaceId`/`surfaceTitle` → `postId`/`postTitle`. Exported types, `Store` methods (`listSurfaces`→`listPosts`, …), and helpers (`htmlPart`→`htmlSurface`, `MAX_BOARD_ASSET_BYTES`→`MAX_WORKSPACE_ASSET_BYTES`, `BoardSnapshot`→`WorkspaceSnapshot`) are renamed to match — **a breaking change for library consumers importing these names.**

  SQLite boards migrate in place via a new idempotent `migrateToPosts()` (table `surfaces`→`posts`, column `parts`→`surfaces`, comment columns renamed, history blob re-keyed), mirroring the JSON store's read-time shims. Existing data is preserved.

  Wire: full-object reads `GET /api/surfaces/:id` and `GET`/`POST` `/api/comments` now emit the renamed fields (`surfaces`, `postId`/`postTitle`). Route paths and MCP tool names are unchanged in this release.

- eb2001d: Embeddable engine: add a `ss:session-actions` host-overridable slot (`SLOTS.sessionActions`) in the session header, beside the stream/timeline toggle. It is empty by default — self-hosted renders nothing there — so an embedder (e.g. sideshow cloud) can project session-scoped controls such as a "Share" button into the engine's own chrome without forking the viewer.
- 9da948d: The local Node server now stores data in SQLite (via the built-in `node:sqlite`)
  by default — the same `SqlStore` the Cloudflare Durable Object deploy runs, so
  local development mirrors production over one storage code path instead of a
  separate JSON file. On first SQLite boot an existing `sideshow.json` board is
  migrated in once automatically (sessions, surfaces, version history, comment
  ordering, and assets preserved); the JSON file is left untouched as a backup,
  and the import never runs again or overwrites a non-empty database.

  This also fixes the JSON store's scaling cliff — it rewrote the entire file
  (assets base64-inlined) on every write — since assets are now per-row BLOBs.

  Both stores now strip embedded NUL bytes from stored text (titles, comments,
  trace labels, settings) so they behave identically — SQLite would otherwise
  truncate a value at the first NUL while the JSON file preserved it.

  Configuration: `SIDESHOW_STORE=json` keeps the legacy single-file JSON store;
  `SIDESHOW_DB` sets the SQLite file path (default `data/sideshow.db`);
  `SIDESHOW_DATA` still names the JSON file and doubles as the migration source.
  The `sideshow/server` package now also exports `SqlStore` and
  `createSqliteStorage` alongside `JsonFileStore`.

- f5e89d7: Direct links to a surface open a full-page standalone view again. Visiting a bare `/s/:id` URL now shows just that one surface — its title and parts, no sidebar, session feed, or comment thread — with a small "made with sideshow" watermark beneath it, instead of resolving the link into its session's stream. The parts still render in the same sandboxed iframes the board uses (sized by the same resize bridge), and the link keeps its canonical `/s/:id` URL. Link-preview metadata from the bare route is unchanged.
- 5436598: Embeddable engine: publish the theme-token contract as data via a new lightweight `sideshow/theme-tokens` entry (also re-exported from `sideshow/viewer-embed`). It exports `THEME_TOKEN_NAMES` (the coarse subset of palette vars a host mirrors), the `ThemeTokens` type, and `THEME_DEFAULTS` (the default theme's built-in light/dark values, derived from the theme registry — never hand-copied). A host (e.g. sideshow cloud) can now consume the token names and no-flash fallback colors as typed data instead of copying hex by hand, so the two design systems can't silently drift. The `/theme-tokens` entry is engine-free and Node-safe, so build scripts can read it without pulling in the viewer runtime.

### Patch Changes

- b60c9a2: Cap the asset-upload body while streaming so a chunked request can't OOM the
  server. `POST /api/assets` rejected oversize uploads by their `Content-Length`
  header, then read the rest with `arrayBuffer()` — but a chunked upload sends no
  `Content-Length`, so the header check was skipped and the entire body was
  buffered into memory before any size check. On a board reachable beyond
  localhost (and the local default has no auth token), that's an unauthenticated
  out-of-memory vector. The body is now read through a capped reader that stops at
  the same limit, so an over-cap stream is refused with a 413 without being
  buffered first. The post-decode cap in `uploadAsset` is unchanged.
- eb269b5: Cap every request body so an oversize JSON or MCP payload can't OOM the server.
  The previous fix bounded `/api/assets`, but every other write endpoint
  (`/api/surfaces`, `/api/comments`, `/api/sessions`, the trace ingest, `/api/theme`)
  and `/mcp` still read their body with an unbounded `c.req.json()` — so the same
  unauthenticated out-of-memory vector was reachable by POSTing a giant JSON body
  instead (the local default has no auth token). A global `bodyLimit` now rejects
  any request body over a generous ceiling with a 413, short-circuiting on an
  oversize `Content-Length` and otherwise aborting the stream at the cap so a
  chunked body can't slip past. It runs after auth (unauthenticated requests on a
  token board are refused before their body is read) and exempts `/api/assets`,
  which streams its own stricter cap.
- ff217bf: The pi extension's tool schema now accepts the `mermaid` surface part kind. It was omitted from the extension's `kind` enum when mermaid landed, so a pi agent publishing `{kind:"mermaid", mermaid:"..."}` hit a validation error (`parts.0.kind: must be equal to one of the allowed values`) even though the server, MCP spec, and CLI already accepted it. The extension schema now mirrors `mcpSpec.ts`.
- c8f7c68: Tighten input validation at the edges:
  - Malformed base64 in an asset upload (REST `/api/assets` and the `upload_asset`
    MCP tool) now returns a clean 400 instead of surfacing a raw decode error as a 500.
  - Comment text and surface/session titles are capped (8 KB / 500 chars) before
    they ride the feedback channel back to the agent, so one oversize value can't
    bloat the agent's context on every poll.
  - The CLI's `--after` flag (`wait`, `watch`) now fails fast on a non-numeric
    value instead of silently ignoring it.

- c04a9ac: Mermaid diagrams now fully re-theme on a light/dark flip. The renderer drove mermaid's `base` theme from the design tokens but left mermaid to derive the rest, so colors it computes itself stayed stuck in light mode — most visibly arrowheads (derived from a hardcoded light canvas) kept their dark fill while the edges they cap flipped. The renderer now passes `darkMode` and `background` and pins the previously-derived arrow/text colors to the viewer's tokens, so every element tracks the active scheme.
- 58c515f: Validate the `openLink` scheme host-side so a surface can't ask the viewer to
  open a non-http(s) URL. The in-frame click handler only forwards `http(s)`
  hrefs, but a surface script can call `openLink()` directly — or post the bridge
  message raw — with any scheme (`javascript:`, `data:`, `file:`), and the host
  opened it after a confirm without re-checking. `noopener` already kept those
  from reaching the board, but the host now refuses anything that isn't
  `http(s)://` outright, matching the documented "external link" contract.
- 6e3c1b6: Refresh two README surface-gallery examples so each shows off what its part is for: the `html` example is now a shadcn/ui-style ecommerce products data table (filters, status badges, row selection, pagination) instead of a node-flow diagram, and the `image` example is a designed SaaS billboard ad instead of a before/after bar chart. Updates `scripts/surface-examples/*` and regenerates `docs/surfaces/{01-html,06-image}.png`; no runtime or API changes.
- 134a926: Reserve the `user` comment author so surface content can't impersonate the user
  to the agent. `author:"user"` was a forgeable label trusted as a security
  signal: a surface's script could call `sendPrompt()` (or post the raw bridge
  message) with no user interaction, and the result became an `author:"user"`
  comment indistinguishable from one the user typed — laundering untrusted content
  rendered in a surface into instructions delivered to the agent through the
  feedback loop. Now `user` is minted only by the viewer's composer (genuine
  keystrokes in the trusted origin): surface `sendPrompt` posts an `author:"surface"`
  thread message that is never delivered through the feedback channel, and the
  HTTP MCP `reply_to_user` tool coerces `author:"user"` to `"agent"` so the agent
  can't claim it either. The impersonation is now structurally impossible rather
  than gated.
- bd3ea88: Fix rich parts (markdown/code/diff/terminal) that intermittently rendered blank
  or clipped on reload under a Chrome 149 field trial, by rendering them
  server-side and serving each from `/s/:id?part=N` by real URL — the same
  opaque-origin, real-navigation load path html parts already use, which the field
  trial doesn't break (it defers layout only for in-memory `srcdoc`/`blob:`
  documents). Rich documents render with shiki, @pierre/diffs, markdown-it, and
  ansi_up on the server (no DOM/WASM, so they run on the Worker too) under a tight
  `sandbox` CSP response header with no `connect-src` and no CDN script source.
  Mermaid, which needs a DOM, instead emits a self-rendering document that loads
  mermaid from the CDN inside the sandbox. Versioned, themed `/s/:id` responses
  are immutable, so they now carry a long-lived `Cache-Control` and an in-memory
  render cache. Removes the viewer→server `POST /api/frames` → `/f/:id` round-trip
  and transient frame store the previous workaround added, and drops mermaid and
  shiki from the viewer bundle.
- 3752061: Sandbox the `/s/:id` surface document with a CSP response header, so agent
  script can never run in the board origin even on a top-level load. The viewer
  embeds surfaces in a `sandbox="allow-scripts"` iframe (opaque origin), but the
  document is served from the board's own origin — so opening `/s/:id` directly (a
  user choosing "open frame in new tab", an agent-shared link) ran the agent's
  script _in the board origin_, where it could reach same-origin storage or
  `window.open()` the real viewer. A `sandbox` directive can only be set as a
  response header (not the page's meta-tag CSP), and now forces the same
  opaque-origin sandbox however the document is loaded: `allow-scripts` so the
  bridge still runs, never `allow-same-origin`. Mirrors the iframe's own flags.
- 57829c0: Fix an auto-resize feedback loop that could pin a CPU core. A sandboxed surface reports its content height to the host, which sizes the iframe to match; when the content's height inverts with the frame height (a scrollbar that toggles at a threshold, a 100vh/percentage layout), sizing the frame changes the content height back, so reports alternate A, B, A, B… once per frame. The old `h !== lastH` guard couldn't catch a 2-cycle, and on a heavy syntax-highlighted surface each relayout was expensive enough to sit at 100% CPU until the surface unmounted. The height reporter now remembers the previous height and drops a rapid return to it (< 250ms), breaking the loop while still honoring genuine changes (a `<details>` toggle, a textarea drag) that recur on a human timescale.
- 7f86b13: Harden share-link secrecy: session and surface ids are now 11 url-safe base64
  characters — 8 random bytes, ~64 bits, YouTube-video-id sized — instead of a
  UUID's first 32-bit segment. In `publicRead` mode these ids double as bearer
  capabilities (`/s/:id` and `/api/{sessions,surfaces}/:id` are reachable without
  the board token), so a 32-bit id (~4e9) was enumerable; 64 bits (~1.8e19) is
  far past sweepable. Existing ids keep working — nothing validates id shape — so
  only newly minted ones change. (Asset ids are a separate content hash and were
  already unguessable.)

## 0.7.0

### Minor Changes

- ee75c8d: Add an embeddable viewer engine. `mountViewer(el, host)` (the new
  `sideshow/viewer-embed` export) renders the viewer into a shadow root with its
  own runtime, reading its base path, route, and theme from an injected host
  instead of `window`/`location` — so a host application can own the page shell
  and URL while embedding the viewer. The self-hosted page is unchanged: it now
  uses a trivial default History-API host and behaves identically.
- a4033cf: Add host-overridable slots to the embeddable viewer engine. Two layout regions
  that carry deployment-specific guidance — the empty-board onboarding and the
  sidebar footer's instructional links — are now wrapped in named `<slot>`s whose
  fallback content is the existing self-hosted markup. An embedder projects
  light-DOM children with a matching `slot=` attribute into the mount element to
  replace a whole region; with nothing projected (and self-hosted, outside a
  shadow root) the fallback renders unchanged, so self-hosted parity is preserved.
  The new `SLOTS` registry and `SlotName` type are exported from the embed entry
  and `embed.d.ts` so embedders share one typed source of truth.
- 91db9a3: Add hosted wrapper seams, including injectable public base-path support for deployments mounted below an origin root while preserving default self-hosted routes.
- 3f45e76: Add `json` and `code` part kinds for surfaces.
  - **`json`** — a pre-parsed JSON value rendered natively by the trusted viewer
    as a collapsible tree. Objects and arrays expand/collapse on click; primitives
    show inline with type-colored values (strings, numbers, booleans, null). Reach
    for it for API responses, config files, test results — any structured data
    where a tree beats a fenced code block. Like image/trace it is data, not
    markup: the viewer renders it with escaped text nodes, so no sandbox is needed.

  - **`code`** — source code highlighted with shiki (the same highlighter as
    markdown fenced code blocks), rendered in a sandboxed iframe with line
    numbers, an optional filename header, and a copy button. `language` is a
    shiki lang id; `title` is a filename shown in the header; `lineStart` shows
    original line numbers for excerpts ("lines 80-150 of x.ts"). CLI:
    `sideshow code app.ts --title "app.ts" --line-start 80`.

  Also extracts the shared shiki highlighter into `viewer/src/highlight.ts` so
  MarkdownPart and CodePart share one lazy-loaded highlighter.

- ddbfab2: Add `SIDESHOW_PUBLIC_READ` env var for public read-only access to deployed boards. Set to `session` for unlisted-link style sharing or `full` to expose the entire board read-only.

### Patch Changes

- 5e3f292: Fix invisible markdown/mermaid/diff/terminal surfaces caused by a Chrome field trial that breaks layout measurement in opaque-origin srcdoc iframes. The viewer now retries the srcdoc parse after 2 seconds if the iframe is still stuck at minimum height.
- c2e4443: fix(viewer): honor `lineStart` in code-part gutter numbers. The code part's range label already reflected `lineStart`, but the gutter still counted from 1 — shiki emits `<pre class="shiki …" style="…">`, which the counter-reset injection didn't match. The starting line number now applies, so excerpts render at their original line numbers.
- 3c56cc1: Deep links to `/session/:id/s/:surfaceId` now scroll to the target surface card instead of showing the session from the top.
- 84e7057: Reject oversize asset uploads before buffering the body into memory. The /api/assets handler previously read the entire request body before checking the 5 MB cap, so a multi-GB upload could exhaust Node's heap on `sideshow serve` before the 413 fired.
- 6962019: Fix cursor lag in `waitForComments`. The `lastSeq` returned to the caller and the `agentSeq` cursor were both derived from the filtered (author-matched) comment list, not the full list. When an agent reply landed after the last user comment, the cursor stayed behind the agent's seq, so every subsequent `author=user` call re-read the agent's own comment, filtered it out, and advanced in a wasted round-trip. Both `lastSeq` and `markAgentSeen` now use the last seq from the unfiltered list, mirroring `collectFeedback`.
- a18f210: Fix surface iframes rendering in the wrong color scheme when it diverges from
  the chrome (e.g. dark chrome with a white, light-inked html part). Light/dark
  was resolved independently in every layer purely from the OS
  `prefers-color-scheme`, but a surface part is a separate iframe document whose
  scheme resolution can diverge from its embedder across the frame boundary. The
  viewer now resolves the scheme once and pins each sandboxed frame to it — html
  parts via a `mode` query param on `/s/:id` (with a forced `color-scheme`), and
  markdown/code/comment frames via `renderSandboxedPart` — so a frame always
  matches the chrome instead of re-deriving the scheme on its own. The theme
  tokens, the kit's teal/coral SVG accents, and shiki's dark flip are all pinned
  together. With no mode passed the OS media query is kept, so self-hosted parity
  is preserved.
- f0c6cd4: Fix a lost-update race in `SqlStore.updateSurface`. Two concurrent `PUT /api/surfaces/:id` calls could both read the same version, push a duplicate history entry, and write the same version number — silently losing one caller's parts. The fix uses compare-and-set (`WHERE id=? AND version=?`) with `SELECT changes()` to detect whether the update landed, retrying with the current version if it lost the race.
- db463ce: Improve intro readme.

## 0.6.0

Sideshow 0.6 focuses on richer surfaces, safer rendering, and better agent setup.

### Highlights

- **Timeline traces.** Sessions can show the prompts, reasoning, and commands behind a surface. Claude Code users can install the Stop hook with `sideshow install-hook`, or run `sideshow trace-sync` manually.
- **Themes.** The board now has seven light/dark theme presets — GitHub, Gruvbox, One, Solarized, Catppuccin, Rosé Pine, and Everforest — applied across viewer chrome, html tokens, markdown/diff highlighting, mermaid, and terminal parts.
- **Mermaid parts.** Agents can publish Mermaid diagrams directly with `sideshow mermaid`, `--mermaid`, MCP, or HTTP.
- **HTML kits.** Opt-in `issues` and `slides` kits give agents ready-made, theme-aware building blocks for issue trees, status boards, and decks. Discover them with `sideshow kits` or `GET /api/kits`.
- **Deep links.** Viewer URLs now track the current session and surface (`/session/:id`, `/session/:id/s/:surfaceId`), including back/forward navigation.
- **Pi extension.** Installing the package in Pi adds native `sideshow_*` tools for publishing, updating, uploading assets, waiting for feedback, replying, listing surfaces, and fetching the guide.

### Agent and viewer polish

- Added `/agent-howto` and `sideshow agent-howto`; the bundled skill/setup block is now a small bootstrap that asks the running server for current Sideshow guidance.
- Changed the default local server from `http://localhost:4242` to `http://localhost:8228`.
- Sidebar sessions now show agent logos, a surface count, and cleaner metadata.
- The card comment footer is flatter and quieter.
- Comments now always attach to a surface; `sideshow comment` requires `--surface`.
- The agent design guide is shorter and frames kits/theme tokens as optional scaffolding, not a required house style.

### Safety and reliability

- Markdown, Mermaid, diff, terminal parts, and comment text now render inside opaque-origin sandboxed iframes, matching html parts and reducing the impact of sanitizer regressions.
- The viewer only accepts host-affecting `postMessage` events from frames it embedded.
- Added focused unit and e2e coverage for sandbox isolation, themes, kits, trace ingest, and cross-channel feedback delivery.

## [0.5.0] - 2026-06-17

### Added

- Surfaces: a published card is now an ordered list of parts, not a single HTML
  blob. New part kinds render natively in the viewer alongside sandboxed `html`:
  `diff` (a syntax-highlighted code review from a patch), `markdown` (prose with
  highlighted fenced code), `terminal` (monospace output with ANSI colors), plus
  `image` and `trace`. Publish any of them across all three tiers — MCP
  (`publish_surface`/`update_surface`), `POST /api/surfaces`, and the CLI.
- Uploads: push images, traces, and files across all three tiers (`POST
  /api/assets`, the `upload_asset` MCP tool, `sideshow upload`/`image`/`trace`).
  Assets are content-addressed by SHA-256, identical uploads dedupe, and an
  asset lives as long as any surface references it. Capped at 5 MB each.
- A Claude Code plugin (`plugin/`, via a repo-hosted marketplace) bundles the
  MCP server, the skill, and a background monitor — browser comments arrive in
  the agent as notifications without pasting or re-arming a watcher. Install with
  `/plugin marketplace add modem-dev/sideshow` then
  `/plugin install sideshow@sideshow`.
- `sideshow watch` streams user comments to stdout, re-arming the long-poll
  forever (exactly-once across watch, wait, and piggyback).
- A "connect Claude Code" link in the viewer opens an integrations panel with
  the plugin install commands and caveats.
- A copy button on each comment puts an agent-ready paste block (surface title +
  id + comment) on the clipboard.
- The npm package exposes a stable `sideshow/server` entrypoint so integrations
  can reuse `createApp`/`JsonFileStore` without importing private internals.

### Changed

- Snippets are now "surfaces" throughout the API (`/api/surfaces`, `surface-*`
  SSE events, comments keyed by `surfaceId`). The old snippet endpoints and
  `publish_snippet`/`update_snippet` tools remain as back-compat aliases; stored
  boards migrate in place on load.
- The session sidebar groups sessions by recency (Today / Yesterday / Earlier),
  and sessions with no surfaces yet are dimmed and sunk to the bottom.
- The viewer is framed around leaving comments rather than messaging an agent —
  composers read "Leave a comment…", with no delivery receipts or "listening"
  indicators.
- A surface card's open and delete actions are now minimal Lucide icons.
- `sideshow-term` auto-starts a local server when needed (bare `sideshow-term`
  opens the watcher, default port 4243), supports mouse input, and gains
  `clear` / `clear --all`.

### Fixed

- `sideshow-term` hardens STML parsing/rendering for untrusted markup (tested
  entity decoding, bounded size/depth, neutralized control characters, render
  failures degrade to an in-view error).
- Local JSON storage shares a single cold-load promise across concurrent first
  requests, fixing a race that could overwrite persisted board data.
- The viewer shows a neutral "refresh sideshow to update the viewer" hint for an
  unrecognized part kind instead of a broken-diff error.
- Malformed `POST`/`PUT /api/surfaces` part payloads are rejected before they
  reach storage.
- `sideshow-term` can be packaged and installed standalone (declared server
  dependencies, reuses the `sideshow` server core, runs built JavaScript).

## [0.4.0] - 2026-06-15

### Added

- Cmd+Option+Up/Down switches between sessions in the viewer without reaching
  for the sidebar — Down moves to the next session in the list, Up the
  previous, wrapping at the ends.
- The viewer notices new releases: a dismissable banner in the sidebar names
  the latest version with a copyable upgrade command (npm install locally,
  redeploy for workers), and the release notes render as a card at the top of
  the stream. Dismissing either hides both until the next release. The check
  lives server-side at `/api/version` (npm registry + GitHub release notes),
  is cached for six hours, and fails silently — offline costs nothing but the
  absence of the notice.
- The CLI now runs on Windows: session detection walks the process tree with a
  single PowerShell call instead of `ps`, and `sideshow serve --open` launches
  the browser via `cmd /c start`. macOS and Linux are unchanged.

## [0.3.0] - 2026-06-12

### Added

- A session thread at the bottom of each session in the viewer: a composer
  for messaging the agent without picking a snippet.
- Feedback now reaches agents without polling: publish/update/reply responses
  carry a `userFeedback` array with any comments the user left since the
  agent's last call (delivered once; a consumed `wait` also counts as seen).
- The design guide, setup block, and Claude Code skill teach the background
  watch pattern: arm `sideshow wait` as a background process after publishing
  and react when it exits, instead of blocking or polling.
- Agents can name their session at creation: `sessionTitle` on the publish
  body and both MCP `publish_snippet` tools, `--session-title` on
  `sideshow publish`. Applied only when the publish creates the session —
  it never overwrites a title, including renames made in the viewer.
- A snippet kit baked into every snippet doc, so agents publish compact
  markup instead of hand-written inline CSS: bare `button`/`input`/`select`/
  `textarea` pre-styled to match the viewer, SVG utility classes (`t`/`ts`/
  `th` text presets, `box`, `arr`, `leader`, `node`, `c-*` color ramps with
  dark-mode-aware text), and a shared `#arrow` marker injected into every
  doc. The design guide documents it as a compact reference table.

### Changed

- New snippets no longer steal the scroll position: the viewer only follows
  them when already at the bottom of the stream, and shows a "new snippet ↓"
  pill otherwise.
- Activity the user isn't looking at — another session, or any session while
  the tab is hidden — badges the tab title with an unread count.
- The Claude Code skill now documents the repo-local CLI fallback and a
  checkpoint-drain feedback pattern for harnesses that cannot surface
  background watcher output.

### Fixed

- Feedback was re-delivered when channels were mixed: a fresh `sideshow wait`
  process (or restarted stdio MCP server) started from seq 0 and replayed
  comments the agent had already received via piggyback or another channel.
  `author=user` session reads with no explicit `after` now resume from the
  server-side agent cursor, and the CLI and stdio MCP keep no cursor of their
  own — delivery is exactly-once across CLI, MCP, and piggyback. Pass
  `--after <seq>` (CLI) or `afterSeq` (MCP at `/mcp`) to deliberately re-read.
- A comment that failed to send was silently lost (input cleared, no error).
  The viewer now echoes comments immediately (pending until confirmed) and on
  failure restores the text to the input with an error toast.
- After an SSE reconnect the viewer refetches the selected session, so
  snippets and comments that arrived during the gap can no longer be
  silently missing from a live-looking board.
- The viewer layout no longer breaks at phone widths: below 700px the
  sidebar collapses into a drawer behind a slim top bar (hamburger toggle,
  unread dot), the stream takes the full width, and hover-only actions
  (card open/delete, session delete) stay visible on narrow or touch
  screens.
- Comments not attached to a snippet (e.g. `sideshow comment` without
  `--snippet`) were stored and delivered to agents but never shown in the
  viewer; they now render in the session thread.
- The viewer is now usable by keyboard and assistive tech: session rows are
  focusable and activate with Enter/Space (focus survives live re-renders),
  hover-only actions (session delete, card open/delete) are reachable and
  shown on focus, the editable session title is labeled and Escape cancels
  an edit, snippet iframes carry the snippet title, and toasts are announced
  via a polite live region.
- `--help`/`-h` on CLI subcommands (`sideshow publish --help`, …) printed a
  raw parseArgs stack trace; it now prints the usage text and exits 0. An
  unknown option or missing option value likewise fails with a one-line
  error and a `sideshow help` hint instead of a stack trace.
- Following the README quick start from a git clone failed: `npx sideshow
  serve` exited with `viewer build missing` because nothing built the viewer.
  `npm install` in the repo now builds it (the published npm package was
  unaffected — `prepack` already ships a built viewer).

## [0.2.0] - 2026-06-11

### Added

- `sideshow demo` seeds two example sessions (a sequence diagram with a
  comment thread, an interactive explainer, a metrics card) so the viewer can
  be explored without an agent.

## [0.1.0] - 2026-06-11

First release.

### Added

- Initial release: live preview surface (Hono server + single-file viewer)
  with sessions, versioned snippets, and comment threads.
- Zero-dependency `sideshow` CLI: `serve`, `publish`, `update`, `wait`,
  `comment`, `list`, `sessions`, `guide`, `setup`. Sessions resolve
  automatically per agent conversation.
- Stdio MCP server with `publish_snippet`, `update_snippet`,
  `wait_for_feedback`, `reply_to_user`, `list_snippets`, `get_design_guide`.
- Long-poll feedback endpoint (`GET /api/comments?wait=N`) so terminal agents
  can block on user comments without extra infrastructure.
- Agent design contract served at `/guide`; paste-able AGENTS.md integration
  block at `/setup`.
- Sandboxed snippet rendering (`sandbox="allow-scripts"`, CSP CDN allowlist)
  with light/dark theme CSS variables and a `sendPrompt`/`openLink` bridge.
- Cloudflare Workers deployment (`npm run deploy`): the whole app runs in a
  Durable Object with SQLite storage; local and cloud are the same product
  behind `SIDESHOW_URL` + `SIDESHOW_TOKEN`.
- Built-in MCP over streamable HTTP at `/mcp` on every server (local and
  deployed) — agents can connect without any local process.
- Token auth for deployed instances: bearer header for APIs, `/?key=<token>`
  cookie flow for the viewer; `/guide` and `/setup` stay public.
- Claude Code skill at `skills/sideshow/` teaching agents the publish →
  feedback → iterate workflow.
