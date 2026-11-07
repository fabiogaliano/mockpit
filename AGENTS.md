# mockpit — agent guide

Guidance for agents developing this repo. (The block that teaches agents to
_use_ a running mockpit lives in `guide/AGENT_SETUP.md`, served at `/setup`.)
`CLAUDE.md` symlinks here.

## What this is and why

A design-decision loop for terminal coding agents: an agent publishes a **design**
(html, or any surface kind: markdown, diff, terminal, image, mermaid, json, code)
over CLI/MCP/HTTP, asks structured questions on it and exposes knobs; the user
answers in place in a browser, tunes, comments on parts, and presses Send once.
The loop — publish → ask → answer/tune/comment → one reply → revise — is the
product. When in doubt, optimize for the loop.

The model is **project › design › state › alternative › version**: a project is a repo
(from the agent's cwd/git remote), a design is a screen or component by stable slug
owning ordered **states**, **asks** and global **knobs**; an alternative (a `Post`) is
a parallel take on one state; versions are its history. A **part** is a
`data-part` element in a render. The agent's twelve verbs are `publish`, `ask`,
`read`, `feedback`, `say`, `move`, `edit`, `system`, `export`, `upload`, `guide` and `run`
(the CLI adds `init` and `watch`); `system` reads and changes the project's **system**
(below); `move` takes alternatives to another design or state,
archives or restores them (never touches one in use, and says so in the Thread), and,
when the user asks, hides or deletes their older versions (`hideOlder`, `deleteOlder`:
deleting skips any version a reply, comment, question, instance, copy, fork or Ready mark points at,
`deleteBlocker` in `server/app.ts`); `edit` changes a design (slug, title, kind, area,
group, variants, for, becomes, source, spec, or the first name of its one unnamed state) without a new version, renames a project, sets its area order, or says what the project or one area is for;
`publish` with `amend` replaces an alternative's latest version in place and with
`withdraw` deletes it, both only from the session that published it and only
while the user hasn't acted on it (`touchedBy` in `server/app.ts`). A
design may name its **area** (the project's own words, e.g. "Shell"; Home
groups by it, in the order of the project's `areas:<project>` setting, then
alphabetical; each area there has a one-line `description`, one the order leaves out is
kept only for it as `alphabetical`, never ranked, and the project has its own in
`description:<project>`, a user's standing against agents until cleared) and its
**source** (the code path that implements it); a component may name its **group** (what
it does, any word; a component with no area is **shared**, and the library lists the shared
ones by group). The user can move a design too,
from Home's ⋯ menu (kind, area, archive); the agent hears a move as a feedback
batch's `edited`, through the same cursor as a Send. The user's is Send (or Use this / New version on a design whose
state has one alternative and no asks), which releases one **reply**. A screen or component
has nothing to choose between: no Use this, no Which alternative?, nothing in use; its newest
version is current, and the user's one mark on it is **Ready** (below).

Current product stances (deliberate choices, not accidents — revisit
consciously, not as a side effect):

- One workspace per person; one session per agent conversation. Sessions are
  metadata only — auth, the feedback cursor, and authorship on versions; they are
  not a navigation unit, and the user meets one only as `SendTo`, while the agent
  that asked isn't listening. Accounts and multi-user are out of scope; auth is a
  single deploy token.
- Three integration tiers, most universal first: zero-dependency CLI, MCP
  (stdio and streamable HTTP at `/mcp`), raw HTTP. Features should work on
  all three — the CLI and curl tiers are why agents with only a shell can
  use this.
- Never block. No tool, CLI verb, HTTP call or `run` function waits for the
  user: the agent asks, says where to look and ends its turn. Long-poll and
  SSE are plumbing for `mockpit watch` and the viewer, never agent contract.
- Feedback is never silently lost: a Send renders in the viewer (the Thread,
  marked Delivered / Not seen yet from the sessions' `agentSeq`) and reaches the
  agent (`feedback` piggybacked on writes, the non-blocking `feedback` verb, or
  a background `mockpit watch`). Guard this hardest — both halves have
  regressed before.
- Tiers, no modes: each thing the agent adds lights up its part of the viewer
  (alternatives → switcher and the built-in Which alternative? question, which never counts as open, asks → Questions, `data-part` → Tune parts and part
  comments, `knobs` → Tune knobs, states and flows → the flow bar, `kind`
  screen/component and flows → Home's sections; undeclared is an idea or a document,
  by what it contains). A plain publish of any kind still gets stage + Thread + Use
  this / New version, except a document (only written surfaces and pictures, no declared
  width), which opens in `Reader` with its paragraphs to comment on and no Use this.
- Archive tells the agent nothing, and nothing blocks a question. Ending a design or
  archiving an alternative writes nothing to the agent's stream and instructs no one:
  `read` shows `archivedAt`, `archiveReason`, `status` and `archiveReason` as information,
  and a question on an archived design brings it back. Guidance over hard rules.
- Self-hosted only; the instancedable viewer engine was dropped. Keep the
  `root()`/`host()` habit in `viewer/src` anyway.

## Map

- `server/app.ts` — runtime-agnostic Hono app: all routes (`/api/designs…`,
  `/api/comments` long-poll, SSE `/api/events`, renderer `/s/:id`, assets
  `/api/assets` + `/a/:id`), and the flow functions REST and MCP share
  (publish, asks, read, feedback, say, edit, draft, reply, export). A slug
  rename rewrites every stored version's instances in place (`SqlStore.renameDesign`):
  instances resolve by slug at render time, so history must name the new one.
- `server/types.ts` — data model + `Store` interface; no runtime imports.
  `Design` (states, asks, knobs, draft), `Post` (one alternative of one state: an
  ordered list of surfaces — `html` | `markdown` | `diff` | `terminal` | `image`
  | `mermaid` | `json` | `code` — plus history and per-part knob overrides),
  `Ask`/`AskOption`, the knob shapes (tunekit's `usePane` config as data),
  `Draft`, `Reply`. Assets are a separate entity; `selectEvictions` is the
  reference-aware LRU policy.
- `server/decisionLog.ts` — the project's decision log: plain lines derived from
  what replies left on designs (answered asks, alternatives in use) and the system's palettes
  and settled project knobs (`system: true`, first on every read), never summarised,
  with the user's hand edits laid over them (`decisions:<project>` setting, each
  edit bound to the answer it was made on, so a new answer outranks it). `read`
  carries a bounded copy on every agent tier. Not `server/decisions.ts`, which is
  what one reply chose, state by state.
- `server/system.ts` — a project's **system**, what every render of the project wears:
  a sheet and its classes, fonts, typed tokens, scales (type and space, fixed or fluid
  `clamp()`), colour roles and palettes (`default`, `kept`, `open`, `hidden`), contrast
  pairs, `as` (mockpit's `--color-*` pointed at roles), project knobs with `settled` values
  and their answer `additions`, the kit, project kits and icon sets, and `repo` (what
  `mockpit init` read, from which `deriveRepoTokens` makes the repo-owned tokens, roles
  and `repo` palette no `system` write can change). One row per project in `systems`; every
  write is a revision in `system_revisions` (30 kept), restore keeps repo-owned entries
  (the `repo` palette keeps its status across rereads too), and an agent's restore also keeps
  what the user decided: palette statuses, `settled` and the knobs and `additions` those values
  need (`kept` in its result). The user's Restore brings back everything else. A name has one
  owner (`nameOwners`): a write giving a token, scale step, text-token field, role or a name
  the repo declares a second owner fails, naming both.
  `systemCss` builds what a frame wears; `systemAfterAnswers` is what a Send decides for
  the project (a `palette` answer becomes the default, the old one kept; a `set` on a
  project knob settles it), written in the reply's transaction; `systemExport` hands it to
  code. The user's own changes (`POST /api/projects/:name/system/decide`, viewer only) are
  a reply with no design to `systemReplySession`, a project batch in `feedbackBatch.ts`.
  `server/systemChecks.ts` (contrast through `server/contrast.ts`, WCAG 2.2, five colour
  notations, never passing what it can't parse; the sheet; pages and answer styles against
  the system) returns nudges and never blocks.
- Render contract: a version records the `contract` and the system revision it was
  published under (absent contract = 1). Contract 2 renders in cascade layers,
  `@layer mockpit, kit, system`, with tokens and the page unlayered, so a page rule wins at
  plain specificity (with the `tailwind` kit, `theme, base, mockpit, kit, system, components,
  utilities`, so preflight sits under the sheet and utilities over it); contract 1 keeps the old order, so an approved version looks as it
  did. Frame URLs carry `y` (the system's rev), `sys` (peek at an older revision) and `p` (a
  palette other than the default); a poster taken under another rev is dropped.
  `viewer/src/systemRev.ts` holds all three for the viewer. `y` comes from each view and
  the `system-changed` event, `p` is the tool strip's `PaletteTool` (localStorage per
  project, settles nothing), and `sys` is the System changed note's See before. While
  `p` or `sys` is set, frames draw live and no poster is shown (`posterShown`). The
  event's `by` says whose change it was: only an agent's raises `SystemNote` (See
  before, Restore, which is the user's own change through `/system/decide`).
- `server/knobs.ts` — knob schema and value validation (Q3): every declared knob
  and every value (`?k=`, drafts, replies, ask `set`s) is checked here;
  `discreteChoices` drives the ask-not-knob nudge.
- `server/jump.ts` — search to jump, over names, states, alternatives, descriptions,
  questions and areas read by `SqlStore.listJumpRows`, never surfaces.
- `server/parts.ts` — reads part identity (`data-part`, `-label`, `-key`) from
  html strings with a regex, and diffs versions into vanished/renamed. Never
  geometry: boxes are the bridge's job.
- `server/apiViews.ts` / `server/feedbackBatch.ts` — the response shapes every
  tier returns (design views; one feedback batch per design).
- `server/eventLog.ts` — the event log: a middleware that writes one entry per
  agent call, viewer write and live-feed connection (ids, statuses, delivered
  seqs, pending; never content) to a host-supplied sink. `server/logFile.ts` is
  the Node sink (JSONL, rolled at 10 MB); the Worker logs to Workers Logs.
- `server/public.ts` — the `mockpit/server` export (`createApp`, `SqlStore`,
  `createSqliteStorage`, types).
- `server/sqlStore.ts` — `SqlStore`, the only `Store`. It takes a `SqlStorage`
  (the narrow SQL surface in `types.ts`), so the SAME store runs on the Durable
  Object (`ctx.storage.sql`) and on Node via `server/sqliteStorage.ts`'s
  `node:sqlite` adapter. Its constructor migrates any older workspace in place
  (items → single-state designs, draft comments → design drafts, traces dropped,
  `resolvedAt` → `archivedAt`, the 2.0 contract words in stored replies, drafts
  and html, situations → ordinary states named `state · situation`, leaving an inert
  `situations` column, each project's design settings → its system at rev 1, a design's
  notes → its spec's purpose, leaving an inert `notes` column, each project's area
  order → its `areas`, and the 4.0 words: `alternative` for a choice's `variant` in
  stored JSON (asks, drafts, replies, standings, forks and copies), `data-swap` on every part
  that had `data-fill`, `<mockpit-instance>` and `data-mockpit-instance` in every stored
  version, a reply's `combo`, a reply's `apply` and `lift` under its `followUps`, and the design
  a follow-up names by its id, `usedIn.targetId`).
- **Follow-ups** (`followUps` on a feedback batch, `FollowUps` in `server/types.ts`): what a
  decision now requires, each by what and where, never prose. A reply stores only what the
  moment knew (`StoredFollowUps`: `apply` with the target's id, a Ready mark's `lift`, a flow
  idea's `placeFlow`) and a
  use's `usedIn` with `targetId` and `drawn`. Everything else is worked out at delivery from the
  designs as they stand (`withFollowUps` → `decisionFollowUps`): `apply`'s states still
  missing, `gaps` (`gapsOf` in `server/ideas.ts`) and `instanceIn` (`hostsShowing`: live
  product designs whose shown versions show the entries at those versions or newer, nested
  included; each host's `ready` now), slugs resolved from ids, so a rename changes nothing
  stored. `spec` (`specFollowUp`, `specBehind` in `server/spec.ts`) comes from
  `withSpecNudges`. A publish of a component's new current version (not amend or withdraw)
  says `instanceIn` in its result and in a batch of its own in the feedback it carries
  (`writeResult`, nothing stored). "Done since" is judged by the shown version's write time
  (`shownAt`, stays and Ready covers respected). `read` without a design carries each
  design's open ones under `pending` (`openFollowUps`: an idea's latest use and a screen's
  latest Ready edit, read with `SqlStore.latestReplies`, bounded; a lift stands while that
  edit is the latest and no `lift` question came after it). Every list stops at 40 with
  `more`; 40 designs carry follow-ups, `followUpsMore` counts the rest. The guide says the
  agent does `spec` and `apply` itself, and publishes an idea with one question for `gaps`
  (never writing onto the product design) and for anything touching another design. The viewer shows nothing new.
- A design with a declared `kind` and no posts is **planned** (`isPlanned` in `types.ts`,
  derived, never stored): `publish` with a kind and no body declares one, and the first
  drawing fills it. `Design.stateOutlines` holds per-design answers to the outlines of
  missing states (`dismissed`, `requested`; `POST /api/designs/:id/outlines`, viewer only),
  and only a declared page with html offers them (`canOutline` in `viewer/src/logic.ts`).
- **Ready** (`server/ready.ts`, shared with the viewer): `Design.ready` (`{at, covers:
  [{state, name, version}], states}`, a column; an older mark without `states` gets those its
  covers name, `migrateReadyStates`) records what each state of a screen or
  component showed when the user marked it, and the states it declared then
  (`POST /api/designs/:id/ready`, viewer only, never a tool; a screen's mark carries to the
  components it includes, nested ones included, at the versions they resolve to there; taking
  it off clears one design). A covered version is acted on (`touchedBy`: amend and withdraw
  refuse) and kept past history's limit (`SqlStore.pinnedVersions`, `deleteBlocker`); one
  gone anyway reads `missing: true` (`readyView`), never replaced. `changed` (another
  version or entry shows, or a state was declared since), `status` (`In design`, `Ready`,
  `Changed`), `builtFrom` and `holdsAlternatives` are derived on every read
  (`readyFields`). `shipped` reads an older reply's `accepted` rows on a product design as
  open, so every current-status path (views, export, instances, Jump, decisions, option
  targeting, the hide, copy and tidy guards) sees nothing in use there; `useFlow` and a
  `use` verdict refuse (409), a Send's answers flip nothing, and a draft's pick for the
  retired built-in question is dropped (`dropBuiltinPicks`). `shownVersion` is the newest
  visible version, or after a stay the one Back goes to (`backVersion`: the Ready version, else
  the visible one before the newest; `stayFlow`, until something newer comes, an unmarked
  entry's stay naming the newest exactly so hiding it doesn't go back further); export hands over every covered entry with the spec and
  the `builtFrom` of those versions (`buildHandover`, `instancesIn`, every distinct alternative and
  version referenced), and reads and the tree take `builtFrom` and instance edges from the
  versions they show (`shownInstances`), once per design. A screen's mark carries to each
  component once, at the newest version its entries show (`carried` names the others). The agent hears a mark as
  `edited.ready`. Viewer: `ReadyMark` beside the name in `TopRow`, the cover's dot
  (`Album.tsx`, its word in the status line where nothing hovers), each instance's word in
  `BuiltFrom`, and `ChangedNote`'s way back with no countdown, marked or not (a detail read's
  `back: {version, from}`; unmarked, × keeps the newest, `keepNewest`, localStorage per post),
  which follows the server's shown version (`followShown`) so a newer one takes the stage again.
- `Design.spec` (`server/spec.ts`, `MAX_SPEC`) is a design's own record, under three
  headings: What it is for (`purpose`), How it works (`behaviour`, lines that may name a
  state and a `part`, which makes the line an **annotation**: a numbered pin on that part
  while the Spec panel is open, never otherwise) and Decisions (the design's lines of the
  decision log, then those of the ideas `for` it, each "From <idea>: …" (`specLines`,
  `specLineText`), derived on every read, never stored; `specBehind` counts both). `edit` writes the first two, `read`
  returns all three, the viewer shows them in text nodes. A hand edit holds against agents
  per section (`held`) until the user clears it (`editDesignFlow`), the agent is told when
  its draft didn't apply, and it hears the user's edit as `edited.spec`. A product design
  with no spec, or with decisions newer than `spec.at`, is nudged on publish and in its
  feedback batch (`specNudge`).
- `read --area <name>` (`GET /api/projects/:name/areas/:area`, `areaView` in
  `server/apiViews.ts`) is one area, everything settled in it: what the project and the
  area are for, its screens, flows and components (purpose, states, `ready`), the shared
  components (with their `group`), their decisions and `ideasWaiting`. Home's area page
  draws the same view.
- The component library (`server/library.ts`, shared with the viewer): a component with no
  area is shared (`shared: true` in every view, `placeOf`), `Design.group` names its group
  (stored as the `libraryGroup` column, `group` being an SQL keyword), and a group is there
  only while a component names it. A component of one area that live screens of two or more
  areas show (`areasShowing`, from their shown versions' instances, nested included) is offered a
  move to shared: `inAreas` on its tree node (About's note), and a nudge on publish and in a
  feedback batch of the component itself (`sharedNudgeFor`, `withSpecNudges`), saying the user decides. Nothing moves by itself. The system's
  component index (`componentIndex`) lists the shared first, by group.
- **Lift** (`server/lift.ts`): marking a screen Ready works out what its covered versions draw
  themselves (`partsOutsideInstances` in `server/parts.ts`: a part on a `<mockpit-instance>` tag,
  or holding only instances in plain boxes and no text, is an instance's place), split into
  `parts` and `likeLibrary` (named like a live component), each with `alsoIn` (other live
  designs whose shown versions have the name). It rides on the mark's stored edit as
  `Reply.followUps.lift` and reaches the agent as a batch's `followUps.lift`. The agent lifts and asks `lift`; a
  Send answering it on a Ready screen (`settleLift` in `replyFlow`) marks the screen again at
  what it shows and carries Ready (`carryReady`) to each lifted component not chosen.
- **What an idea is for** (`server/ideas.ts`): an idea's `Design.for` (a
  screen's or component's id, the `forDesign` column, `for` being an SQL keyword; set and read
  by slug) or `Design.becomes` (`screen`, `component`, `flow`, `system`; the `becomes` column),
  never both and never on a product design. `publish` nudges an idea that says neither and
  looks like it is for one (`likelyTarget`: same area and code path, then name). `read` of such
  an idea and each batch of a reply on it carry `target` (`ruledOutOf`: the design's archived
  alternatives, hidden answers and decisions' "Not:"); a product design's reads carry
  `ideasFor`, and `read --area` groups `ideasWaiting` by `for`. Using an alternative there
  (`useInTarget`, from `useFlow` and `replyFlow`, one decision per design at a time and one copy
  per project at a time, instance checks included, `serialDecision`) copies each version put in use onto the
  design as the next version of the entry of the same name in the state of the same name, else
  the entry the idea's last use there landed on (`entryFor`, `lastLanding`), so a later use
  replaces it, `copiedFrom.asVersion` naming the version it became and `author: "user"`, so it
  is current at once and amend refuses it; the reply says `usedIn`, with `added` and a `note`
  where it made a new entry beside others (a variants design, a state holding several). When the idea draws the
  alternative in a state the design lacks (`statesFor`), nothing is copied and the batch's
  `followUps` say `apply`. An idea that `becomes` a screen or component makes it on first use and is then for
  it. New idea is typed by where it starts (`POST /api/copies` with `for`, `becomes`, `area`).
  Viewer: Use in <target> (`UseThis`), the ideas folded under the states and in Studio's bar
  (`IdeasFor.tsx`), a product cover's count opening `?sec=ideas&for=<slug>`, the Ideas shelf's
  Group by (Area · For · In use, localStorage per project), and New idea for this in the
  design's ⋯.
- A **flow idea** (`becomes: flow`, or `for: "flow:<name>"`: `isFlowIdea`, `flowFor` in
  `server/types.ts`; the flow's name is stored in the `forDesign` column with that prefix) is a
  flow told as a story: its states are the steps, in order. The viewer opens it on Stage with
  the flow bar named after it (`flowNav.ts`'s `ideaFlow`, which wins over any declared flow
  holding some of its states), walkable with Try. Using it copies
  nothing: the reply stores `followUps.placeFlow: true`, and delivery works out `placeFlow`
  (`placeFlowOf`: the steps with the alternative each shows, the live screens of the idea's
  area), open until the idea is for a flow written since the use. The agent places each step
  (an existing state, a new state, or a planned screen), sets `for`, and asks `placement` on
  the idea. A flow step may name a declared state with nothing drawn: `flow` alone on a screen's
  new state declares it (`publishFlow`'s `planning`, in the design's `serialDecision` queue so
  plans landing at once all keep their state; `step: 0` never declares, and taking out a state
  that isn't declared is a 404), and `read` marks the step `planned`
  (`flowsView`, `SqlStore.drawnStates`). A state-only link lands there (the planned stage).
  Home, the bar and the docked list draw such a step as Not drawn, and the Flows shelf says
  "N states in no flow" under each area with screens, flows or not; a screen's cover says
  nothing of it. A flow carries no mark: its `status` is derived in `flowsView` (`flowWord` in
  `server/ready.ts`: Ready when every step's screen is Ready, Changed when any is, else In
  design, an undrawn step included), in `read`, `read --area`, the tree and as the word on
  Home's Flows rows.
- A **gathered idea** is a design with `shortlist` set (the stored name, which is also in
  `read`), gathered by the user from the project's other designs: New idea on Home's
  shelves (`AddCandidates`), or a Studio bookmark, Keep, with Move beside it (`SaveMenu`,
  `viewer/src/shortlist.ts`), which can also copy into any other design or state
  and take the version out of where it is. Each is one version copied as an alternative
  with `copiedFrom`, originals untouched unless the user moves it. Until an agent writes to it, replies go to
  the project's live agent (`replySessionId` in `server/app.ts`).
- Answers in `Questions.tsx`: `OptionCard` holds a preview after the pointer rests `HOLD_MS`
  (`heldPreview` in `state.ts`, which the stage falls back to when no answer is hovered; it never
  answers). `MoreAnswers` sends `reply.more` through `sendAlone`, so the draft stays;
  `feedbackBatch.ts` resolves it to the question, its answers and what's settled around it, and
  the agent replies by asking the same id again. `answersView.ts` is the pictures or list choice.
- One choice, one question (`server/alternativeQuestion.ts`, shared with the viewer): a Send
  answering an alternative question settles every live alternative in the states it chooses in, so an
  open question of the agent's that names some of a state's alternatives shows the rest as answers
  mockpit added (`added: true`, id `added:<alternative>`, stored on the ask once a Send answers
  it), and the built-in Which alternative? appears only where no such question chooses. Archiving
  an alternative answer archives the alternative (the why as its reason; the one in use refuses), any
  restore unhides it (`unhideRestored`), and an alternative answer whose alternative is archived reads
  as hidden, so the question and Studio read one list.
- Kept and archived answers (stored as `hidden`; `server/standings.ts`, `Design.standings` by ask id, the built-in
  Which alternative? included): saved on the click through `POST /api/designs/:id/standings`
  (serialized per design), never waiting for a Send; the next reply of any kind carries the
  changed ones (`Reply.standings`, `unsent`). A re-ask remaps them to the new option ids; a
  hidden answer stays folded and `existing` in `more` leaves it out. An alternative some question
  keeps is never archived by a Send or Use this, only released from use (`release` in
  `commitReply`). The cards (`OptionCard`'s actions, `flipCards` for the fade and slide) put
  kept ones first and archived ones in `HiddenAnswers` ("Archived · N"); `Kept.tsx` holds what waits after a
  Send: `KeptAnswers` beside the design (Use this instead, a kept screen's missing updates
  counted from `since`, Update it now, `carried`), `AnswerPills` on the design's top edge,
  and `AnswerCombos` (`Design.combos`, `POST /api/designs/:id/combos`, put in use as `Reply.combo`).
  `AnswerBoard.tsx` is Studio's Answers arrangement: the open question laid out whole, with
  keys and On every state. The old `starred` column is inert.
- A Send goes to the design's owner unless the owner can't hear it: with no watch open and
  no call in `OWNER_BUSY_MS`, it goes to the user's pick (`SendTo`, from
  `GET /api/designs/:id/recipients`) or else to a session started in this project that is
  listening (`sendTarget`, `recipientsFor`). That session becomes the owner and hears a
  `handoff` note. A move from Home and a thread comment still go to the owner.
- `server/answerAdditions.ts` — what an answer brings so it can draw itself, with no new
  version: `style` or `swap` beside a `set` of a new value, kept on `Design.answerAdditions`
  (never removed; asked again with a new style or swap, revised under the same value) and
  laid over every render in `buildSurfaceDoc`, the system's `additions` after them. Adding one
  bumps every post's `rewrites`, which is how open frames reload. An answer's `html` is a
  whole page: a hidden version (`addAnswerPage`) that joins the versions only if chosen, so
  `newestVisible`, not `post.version`, is what `parts`, `swaps` and kept surfaces build on.
- `server/kits.ts` — opt-in style/behavior bundles for html surfaces; listed at
  `/api/kits`, allowlisted in `server/postSurfaces.ts`. Adding a kit is a
  registry entry + a guide bullet. A reference kit (`href`/`script`, e.g.
  basecoat) loads from the CDN allowlist in `server/cdn.ts`; project kits live
  on `System.projectKits` and pass the same URL check. The `layout` kit places boxes
  only, its gaps from `--layout-space`, which the system points at its space scale's base.
- `server/richRender.ts` — server-side renderers for markdown/code/diff/terminal
  (`{body, css}`), runtime-agnostic (shiki JS regex engine, @pierre/diffs SSR,
  markdown-it, ansi_up — no WASM/DOM).
- `server/surfacePage.ts` — sandboxed documents: `renderHtmlPage` (html surface,
  CDN-allowlist CSP, kits, the stage bridge), `renderSandboxedPart` (rich kinds,
  no `connect-src`, no CDN), `renderMermaidPage` (self-rendering CDN doc). The
  bridge protocol is documented at the top of its "Stage bridge" section:
  `parts` reports, `hit`/`highlight`/`clear`/`scroll`/`knobs` commands, and the
  `?k=` knob preamble (`--k-<path>` vars, `data-k-<path>` attrs,
  `[data-k-bind]`, `mockpit:knobs`). A written surface loaded with `#read` adds
  `PARAGRAPHS_JS`: `paragraphs` reports and `paragraph-tap` out, `paragraph-marks` in.
  A tap sends only a block's number; the text a comment quotes comes from the report.
  An html surface loaded with `#small` (every `Thumb` but the closer look and Studio's columns) runs `FREEZE_JS`:
  once settled, animations stop and no more frames are handed out. Its comment holds the rule.
- `server/cdnInline.ts` — bakes what an html surface links from the CDN allowlist into its
  document at render (fonts as `data:` URLs, stylesheets and classic scripts inline). A
  failed fetch leaves the link and makes the render `complete: false`: not stored, not
  immutable. Mermaid's module graph stays on the CDN.
- `server/themes.ts` — the one dialkit palette, dark and light; viewer-chrome
  vars and html-surface `--color-*` tokens are both derived from it. Mode is
  persisted per workspace (`/api/theme`).
- `server/mcpSpec.ts` — the MCP tool catalog, one definition generating both
  transports' schemas. `server/mcpHttp.ts` — stateless MCP at `/mcp`;
  `mcp/server.ts` — stdio MCP, a thin client over the HTTP API.
- `viewer/` — Solid + TypeScript in `viewer/src/`, Vite-built into one
  self-contained `viewer/dist/index.html`. `Home` is a `Sidebar` beside one place,
  named by `?sec=needs|ideas|screens|flows|components|shared|documents|archive|recent|system`
  and `?area=` (absent: the first section lit), with `?for=` narrowing Ideas to one design's. Components is the library on one page:
  Shared first, its groups as headings, then each area's own; while it is shown, its sidebar
  row opens into Shared (`?sec=shared`) and each area with components
  (`?sec=components&area=`). `SystemPlace` (`?sec=system`, in the
  sidebar after the sections once the system holds anything, `hasSystem` on the tree)
  is the project's system in tabs per family: palettes as swatch rows with Default /
  Keep / Hide, their checks, a type and space specimen (`server/systemSpecimen.ts`, a
  sandboxed document from `GET /api/projects/:name/system/specimen`), tokens, classes,
  components and revisions with Restore. `albums.ts` holds the rules:
  `sectionOf` keeps declared screens and components and derives idea or document
  from what a design contains (one render, nothing asked and no width is a document),
  and only lit sections show. The sidebar has two groups: Product (Screens, Flows,
  Components, System) first, where Home opens, then the areas as chips under their own
  heading, then Ideas; Documents sit at the foot. A project of 1 or 2 designs
  has no sidebar and large covers; one small section lists its designs instead of
  section rows; a phone gets the sidebar as a drawer. `Album` is one thing and all
  its pictures: a cover by shape (phone, wide, both, part, or text for something to
  read), sheets behind it for states else alternatives, and one turn word plus what's
  inside under the title, never on the art (`turnWord`, `designStatus`). Questions
  waiting glow on the cover and on the project's name (`ProjectSwitcher`), in words
  too, and `seen.ts` (localStorage) marks new work "New". Written pages are a dated
  list (`DocRow`, `dateGroups`). Section rows sit above the areas a project names, a
  project with none looks as if areas did not exist, and `?area=` alone is the area page:
  its description (written in place), screens, flows, components, decisions and ideas,
  from `GET /api/projects/:name/areas/:area`. An area's description is one line under its
  heading wherever a shelf groups by area. Flows are rows of screens opened with `?flow=`. Components say "in N
  screens". The Archive holds what left the shelves, one concept however it left: ended
  by hand (the × on an idea, ⋯, a swipe in Needs you; `archivedAt`, with an optional
  `archiveReason`) or with everything archived and no question waiting (`nothingLeft`).
  Needs you lists the waiting ones, with Answer next above every place. A cover shows
  what's in use, else the agent's recommendation, else the first (`screenPicture`).
  Hide is per version and dims in place; archive is per alternative and per design, with Undo. `Jump` is search
  from anywhere (`/` or ⌘K), through `GET /api/search` (`server/jump.ts`), which
  never reads surfaces; results are text nodes. `DesignScreen`
  (`VersionCaption`: the version and New version / Use this on the design's top edge, or a document's column; `TopRow`, in three zones with the views centred: the path is the way up, project and area as links, ending at the
  design's name, with a ⋯ menu (Copy name, Archive for an idea) opening `About` (a component's
  place in the library, "Shared · Cards" or its area, with Make it shared where screens of
  several areas show it / Appears in / Instances / flows / code), and `SideOver`, the project's sidebar opening over the design from a button; the state tabs alone say which state;
  `BuiltFrom` is Tune's drawer, open while Tune is; `Grid`, states against alternatives
  with what's missing shown (`?view=grid`, an arrangement offered where names repeat across states,
  a screen's or component's All states, and how a variants design opens), sharing Studio's
  live-frame limit; `Outlines` (missing states in the margin or flow bar, `StateAsk`,
  `PlannedStage` where nothing is drawn); `Spec`; `Studio`, the state zoomed
  out with every alternative side by side, entered from the top bar's Stage | Studio switch (Stage |
  All states on a screen or component, whose second view is the grid). A design opens by what it is,
  nothing remembered per design: a question the agent waits on opens Answers (Stage when its
  answers have no pictures), something to read opens to read, a variants design as its grid, a
  screen or component on Stage, a flow idea on Stage, any other idea in Studio. Studio has one row of controls in the header (`StudioBar`: states, filter, what's live, in use, hidden or archived, and Wall | Columns | Palettes | Grid; `PalettesBoard` is the state on stage in each visible palette, a column per palette, light over dark, offered once there are two), each steer its own reply (`steer`, `sendAlone`), with `SelectBar` acting on
  several versions at once. A fork is a column of its own saying where it came from.
  On an idea, past Use this a newer version takes over by itself (`changedTo`, `ChangedNote`): the stage
  moves to it when the tab has focus and it goes in use ten seconds later, writing nothing
  before then. Back to the old one is a stay, which `stayedVersion` remembers until a newer one
  comes, as does Use this on an older version. Anything underway (a draft, an open question, a
  tool, typing) holds it to a See pill, and touching the page stops the count.
  A design of `WALL_FROM` alternatives or more opens Studio as a wall: one grid of all its
  states, filtered by state, status and text, with the closer look beside it as a
  preview on a wide window and over it otherwise; every card without a poster shares
  the live-frame budget; a closer look has no strip, its name opens the list;
  `Reader`, the stage for a document: one column of sandboxed frames at full height,
  pins and comments built from the blocks they report;
  `Stage`, a pannable canvas whose design's other `widths` spread out as
  picture-only artboards under "All widths", between the margins), `Margins` (states
  and versions on the left, On this design, Spec, Instances and Thread on the right, Try,
  Comment, Tune and the preview in a strip by the design; each there only with content, and
  `marginLayout` in `logic.ts` turns one into a tab that floats over the canvas when
  it would take a design below 80%; a phone has none of this: `VersionBar`,
  `QuestionCard`, `BottomPanel` and the `BuiltFrom` sheet float over it instead),
  `Stage` (frames, part overlay, pins, hit-testing through the bridge), `Thumb`
  (shrunk sandboxed frames for Home and option pictures);
  `state.ts` (the design screen's state and actions), `flowNav.ts` (the declared
  flow around the screen: flow bar, neighbours across designs, Try's `data-goto`),
  `logic.ts` (pure rules),
  `tune.ts` (tunekit mounted via `initPane({ host })`),
  `presets.ts` (Tune presets in localStorage), `theme.ts`, `host.ts`.
- `bin/poster.js` — automatic posters for the CLI and stdio MCP: a publish leaves a job, a
  detached worker renders it in one headless browser and attaches the still with
  `POST /api/designs/:id/alternatives/:postId/poster`, which makes no new version. A `system`
  write that changed something leaves a retake: the worker queues the project's latest live
  alternatives that show no still now, and a still mockpit took under another revision may be
  replaced, by any session (`setPosterOnce`); an agent's own poster never is. Built-ins only.
- `bin/mockpit.js` — CLI, Node built-ins only; `bin/demoData.js` — the Writer
  design `mockpit demo` seeds.
- `viewer/src/qr.ts` + `QrTool.tsx` — the QR code in `PreviewTool`, with the widths, in the tool strip: a local encoder, and
  `GET /api/reach` for what a phone would meet (`networkHosts` from `server/index.ts`).
  The code never holds the workspace key.
- `workers/index.ts` — Cloudflare entry; one Durable Object runs the whole app.
- `plugin/` — the Claude Code plugin (`.claude-plugin/`, `hooks/hooks.json`) and the Codex
  plugin (`.codex-plugin/`, `hooks/codex.json`, `mcp/codex.json`), sharing the skill and
  `scripts/wait-for-reply.sh`, which a harness's first mockpit call starts.
- `opencode/` — the OpenCode plugin: one dependency-free file whose default export serves
  1.x (`server`) and 2.x (`setup`), waiting from a session's first mockpit call.
- `skills/mockpit/`, `plugin/` + `guide/` — teach agents to use a running mockpit.
  The brief (`server/designGuide.ts`) is core: how mockpit works, no taste.
  `server/guidance.ts` layers on top, lowest first: the packs in
  `guide/packs/` (off until a rules file names them), the user's `rules.md`
  next to the DB (read live on Node; `userRules` setting on the Worker), the
  project's `.mockpit/rules.md` (`rules:<project>`, sent by `mockpit rules` /
  `init`). Design taste goes in a pack, never in core.
- `scripts/record-demo.mjs` — regenerates the README gif.
- `scripts/inspect.ts` — read-only diagnosis of real agent sessions (see
  Diagnosing agent sessions below).

## Architecture invariants

- `server/{app,events,knobs,mcpHttp,parts,surfacePage,types}.ts` stay runtime-agnostic
  (and any other server file imported by Workers: no `node:` imports);
  `tsconfig.workers.json` typechecks them. Node wiring belongs in `server/index.ts` / `server/sqliteStorage.ts`.
- Server/CLI TypeScript runs directly on Node ≥22.18 via type stripping:
  erasable syntax only (no enums, no parameter properties), `.ts` extensions
  in relative imports, no build step (`npm pack` compiles `dist/` for the
  published CLI). The viewer is the one exception: Solid JSX needs real
  compilation, so `viewer/src/` is Vite-built (`npm run build:viewer`).
- **Agent-authored content that becomes HTML MUST render inside a sandboxed
  iframe — never as `innerHTML` (or any HTML sink) in the trusted viewer
  origin.** This is the core isolation rule, and it's load-bearing: the viewer
  shares an origin with the workspace's authenticated API and the comment→agent
  channel, so any markup that executes there can read every post, act as the
  user, and inject prompts back to the agent. The rule applies to every surface
  kind, comments, and anything else agent-authored. The two safe ways to render
  it: (a) **build a STRING and serve it from `/s/:id` under a `sandbox` CSP
  header** — `renderHtmlPage` for html surfaces, `renderSandboxedPart` for the
  server-rendered rich kinds (markdown/code/diff/terminal), and
  `renderMermaidPage` for the mermaid CDN doc; or (b) **keep it as data and
  render with Solid text nodes / element attributes**, which escape by
  construction (image, json, comments, and part/knob data). String-building
  on the server is fine — a string is not a DOM sink; danger only starts when it
  reaches the DOM, which must happen at an opaque origin. When you add a surface
  kind, pick (a) or (b); never a third way. The iframes are sandboxed without
  `allow-same-origin` (opaque origin) and `connect-src`-free for rich surfaces (no
  exfil even if contained script runs); never weaken this. Treat anything agent-
  or user-produced as untrusted, whatever its kind or route. Content served from
  a workspace-origin URL must be sandboxed by the response itself (a `sandbox` CSP
  **header**), not just the embedding iframe — a top-level load bypasses the
  attribute (as `/s/:id` does).
- Untrusted content can reach the host only through narrow channels (the
  postMessage bridge, the write API). Gate each so contained content can't
  impersonate the user, exfiltrate, or exhaust the server; add any new channel
  the same way.
- A frame's document carries everything it needs. Chrome partitions a sandboxed
  frame's subresources by its opaque origin, so nothing a frame fetches is cached
  or shared with another frame, while the version-pinned document comes from disk
  cache. Mockpit pays this cost, not the design or the agent: don't reintroduce a
  subresource for what the document could hold.
- Every surface that becomes HTML (html + the rich kinds) is rendered server-side
  and served from `/s/:id?surface=N` by real URL under a `sandbox` CSP header —
  opaque origin, not srcdoc/blob (which a Chrome 149 field trial fails to lay
  out). There is no viewer→server render round-trip and no transient frame store;
  don't reintroduce one, and don't render rich markup inline in the trusted
  viewer. Version-pinned `/s/:id` responses are immutable, so they carry a
  long-lived `Cache-Control` and a per-`(id,surface,version,mode,knobs)`
  in-memory render cache (single-instance DO; swap for KV/Cache API if
  multi-instance). The one rewritable version is an alternative's latest, before
  the user acts on it: amend and withdraw bump `Post.rewrites`, which frame
  URLs (`w`), render keys and instance stamps carry, since the number stays.
  `?k=` values are re-validated against the knobs declared
  now on every request, so a `?k=` request never takes the early cache hit.
- Parts bridge: identity is declared (`data-part`), geometry is measured inside
  the frame and reported as data (`parts` reports in document px, tagged with
  the document's version — the host drops reports for any other version, since
  a reloading frame keeps its `contentWindow`). The host only ever sends
  `hit`/`highlight`/`clear`/`scroll`/`knobs`; what is under the pointer is the
  frame's `elementFromPoint` answer, never overlay order. The trusted overlay is
  built from reported numbers and names only. Never let an agent declare boxes
  (`docs/tmp/experiments/parts-declared/RESULTS.md`: it forces brittle layout).
- WebKit quirk in sandboxed iframes: ResizeObserver's initial callback may not
  fire and `documentElement.scrollHeight` ratchets to viewport height — the
  bridge reports `body.scrollHeight` on `load` plus staggered timers. Don't
  "simplify" it back; check it on real WebKit. Watch the inverse too: the
  bridge sizes the frame from `body.scrollHeight`, so a `white-space: pre-wrap`
  on `body` makes a template's surrounding newlines render as blank lines and
  inflate the height — scope `pre-wrap` to a wrapper element.
- Feedback cursor: each session carries `agentSeq`, the highest comment seq
  already delivered to the agent. Piggyback collection, `GET /api/feedback`
  and `author=user` long-polls advance it, and they resume
  from it when no explicit `after` is given — clients keep no cursor of their
  own, so CLI, MCP, `run` and piggyback share one stream. `mockpit watch` reads with
  `peek`: it says a reply landed and never moves the cursor, and a per-session memory of
  what it has been told keeps a restarted waiter from repeating a wake. The viewer's unfiltered reads never touch it.
  Delivery is exactly-once by design, across channels. For the signed-in viewer alone,
  a comment also says `listening` (undelivered, a watch held open will take it) and
  `calledAt` (delivered, with a write or `feedback` from that session since; held in
  memory, and a watch re-arming doesn't count). "Agent working" rests on `calledAt`
  and nothing else: `agentActiveAt` can't back it, since a watch keeps that fresh.
- Drafts (Q13): the user's picks, tuned values, borrowed parts and part comments are a
  server-side draft per design — they survive reload, stay bound to the version
  they were made on, are never delivered before Send, and are cleared by it.
  The reply is one `kind: "reply"` comment through the same cursor; a
  alternative-bound answer puts one alternative in use and archives its siblings, except
  kept ones, in the same transaction (stored as `accepted`, read as `inUse`).
- Borrow (Tune, per part) offers a part from another alternative only when that alternative's frame reports it
  differently (count, labels, rounded sizes, visibility); a pure restyle at
  equal size is not offered.
- tunekit is a second renderer (Preact) in a Solid page: it stays in its own
  shadow root, the viewer talks to it only through `PaneStore`, and the one
  other contact is a single stylesheet injected into that shadow root to map
  its tokens onto the viewer theme (`viewer/src/tune.ts`).
- `SqlStore` schema changes need in-place migration — deployed Durable
  Objects can't be reset. Follow the `pragma_table_info` probe pattern in its
  constructor.
- A dark/light switch must re-theme every layer or it looks broken — the chrome,
  tunekit's controls, and each sandboxed-iframe surface (whose colors are baked
  into its string, so it must re-render via `?mode=`, not just restyle). The
  terminal is intentionally theme-independent.
- The server reads `viewer/dist/index.html` and `guide/` files at boot —
  rebuild (`npm run build:viewer`) and restart to see viewer changes.
  `npm run dev` runs a Vite watch build alongside the server.

## Validation

```sh
npm run typecheck    # three tsc programs: node + workers + viewer
npm run lint         # oxlint, warnings are errors
npm run format:check # oxfmt
npm run security:audit
npm run bench        # performance suite (separate CI job); bench:check gates it
```

The first four must pass before committing. Mockpit has no tests, on purpose:
don't write any (unit, e2e or otherwise) or add a test runner. Verify a change by
running it (a screenshot, a curl, the CLI). CI also gates PRs on changeset status and smoke-tests
the packed CLI. Pre-commit formats staged files (`npm run prepare` after a fresh clone).

Performance (`bench/`, see `bench/README.md`):

- `npm run bench` runs the in-process suites (store, render, api, events);
  `npm run bench:all` adds the ones that spawn processes or a browser.
- `npm run bench:check` compares against the committed `bench/baseline.json` and
  exits non-zero on regression. CI runs it with `--gate deterministic`, so only
  byte/count metrics can fail the job — those are machine-independent, while
  timings on a shared runner are not (they're still measured and printed).
- Changed a hot path deliberately? Re-record with `npm run bench:baseline` and
  say so in the PR — the baseline is committed, so the trade is visible in the diff.
- Prefer adding a deterministic metric (bytes, counts) over a timing where one
  exists: it gates reliably, and payload size is itself a CPU/memory cost for the
  viewer.

## Diagnosing agent sessions

When asked how agents used mockpit, or why a reply or a call went wrong, read
the evidence before theorizing. There are three sources, joined by ids:

- **The workspace DB** (`~/.mockpit/mockpit.db`, or `$MOCKPIT_DB`): sessions
  with their `agentSeq` cursor and `key`, and `comments`, where asks and
  replies (`kind`), with their `seq`, are the loop's ground truth.
- **The event log** (`events.jsonl` next to the DB, plus `events.jsonl.1`): what
  each client called, from which tier and version (`client`: `cli/1.0.0`,
  `mcp-stdio/…`, `pi/…`, `mcp-http`, `viewer`, `http`), the status, which reply
  seqs a response `delivered`, and the `pending` the agent was told. It only
  exists for servers since the log shipped.
- **The agent's transcript.** A Claude Code session's `key` is
  `claude-code:<uuid>`, and its transcript is
  `~/.claude/projects/<cwd with / and . as ->/<uuid>.jsonl`. Sessions with no
  key (other agents, older servers) are matched by `cwd` and time.

`node scripts/inspect.ts` does the joins:

```sh
node scripts/inspect.ts find --since 2026-10-09   # transcripts that called mockpit
node scripts/inspect.ts sessions --since …        # sessions: asks, replies, cursor, transcript
node scripts/inspect.ts undelivered               # Sends past their session's cursor (lost replies)
node scripts/inspect.ts log --session <id>        # the event log, filterable by design/client/since
node scripts/inspect.ts transcript <session id>   # mockpit calls, results, and what the agent then said
```

What to look for:

- A reply in `undelivered` with a newer session in the same cwd: the agent
  restarted into a new session and never heard it.
- `feedback` calls with no `delivered` while `pending` names a draft: the user
  hadn't pressed Send.
- A client version older than the server's: a stdio MCP server or CLI left
  running across an upgrade. `/clear` doesn't restart MCP servers.
- One Claude Code process, two sessions keyed to two transcripts: `/clear` gives the
  conversation a new id in the same process. The stdio MCP server, the CLI and
  `watch` follow the id in `~/.claude/sessions/<pid>.json` (`bin/claudeSession.js`);
  a client older than that stays on the old session, and its replies look lost.
- What the agent said (`SAID`) right after a result: misreadings of `pending`,
  nudges or replies show up there first.

Write findings to `docs/tmp/`. Transcripts hold user data, so quote only what
the finding needs.

## Conventions

- **Naming.** project › design › state › alternative › version; part, ask, knob,
  reply, draft. The words follow the design tools: an **alternative** is one of several
  to choose between; a **variant** is a form that ships, on a design whose entries all ship
  (`Design.variants`, named with `--variant`); a state is what the user meets, a variant
  what the product picks. A part's **swaps** are what can go in it (`data-swap`); an
  **instance** is an included component (`<mockpit-instance>`); a **combo** is a named
  combination of answers; the project's **decision log** is what replies settled. A
  project has one **system**: sheet, token, scale, role, palette, pair, project knob. Its
  revisions are `rev`. An alternative is stored as a `Post` (an ordered list of
  **surfaces**); the tenant DB is a **workspace**. To agents and users an ask
  is a "question" (`ask` stays the tool and key name), a part with
  alternatives is "a part with swaps", and an alternative the user picked is "in
  use". A design's **kind** is idea, screen or component; a part is a named bit inside
  one design, a component a whole design others include as instances. Each level has one
  status ladder, capitalised wherever it shows: a screen or component is In design, Ready
  or Changed (or Archived); an idea Exploring or In use in <target> (or how many questions
  wait); an alternative is Kept, In use or Archived; a version is current or, older ones, Hidden.
  Hide only ever means a version, taking an alternative out is Archive, and the bookmark
  is Keep. An alternative has a `description`,
  a design has a `spec`, an area and a project a `description`, an answer has a `comment`. Retired words — item, group (for a lead's followers; a component's library `group` is live),
  snippet, board, stream, `part` for a surface, trace, look (for an alternative), slot, mix
  (now borrow), resolve, close and end (now archive), mock (now design), `page` and
  `sketch` as kinds (now screen and idea), note for an alternative or an answer, screen for
  a state, moment, design system and design settings (now system), accepted and dropped
  in anything an agent reads, variant for one of several to choose between (now
  alternative), fill (now swap), embed (now instance), set for saved answers (now combo),
  decision list (now decision log) — appear nowhere in new code, routes,
  tools or docs. The SQL columns keep their first names (`posts.variant`,
  `posts.slots`, `designs.sets`, `status = 'accepted'`), and a component instance's
  `variant="…"` names the form it shows. There is no back-compat beyond `SqlStore`'s in-place
  migration: no legacy routes, aliases or query keys.
- Conventional Commits: `type(scope): description`.
- Changesets drive release notes. For user-visible changes run
  `npm run changeset` and select `patch`/`minor`/`major`; for maintenance-only
  PRs run `npm run changeset -- --empty`. Do not edit `CHANGELOG.md` for normal
  PRs — the release PR updates it.
- Release: CI-driven. After CI passes on `main`, the Release workflow opens the
  `chore: release packages` PR from pending changesets; merging it publishes
  npm (trusted publishing, with provenance) and creates the `vX.Y.Z` GitHub
  release from that changelog section. Never publish or tag by hand. See
  `docs/releasing.md`.
