#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { currentClaudeSession } from "./claudeSession.js";
import { findBrowser, queuePoster, queueRetakes } from "./poster.js";
import { serveUrl } from "./serveUrl.js";

const BASE = (process.env.MOCKPIT_URL ?? "http://localhost:8228").replace(/\/$/, "");
const TOKEN = process.env.MOCKPIT_TOKEN;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
// Every request names this client and its version, so the server's event log
// can tell the CLI from MCP and spot one older than the server.
const HEADERS = {
  "x-mockpit-client": `cli/${PKG_VERSION}`,
  ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
};

const HELP = `mockpit — a live visual surface for terminal coding agents

vocabulary: project › design › state › alternative › version. A project is a repo; a
design is an idea, screen or component, by slug; a state is one thing the user sees in it ("Lab
open"); an alternative is a parallel take on a state; a version is its history.
A screen or component whose entries all ship (sizes, tones) holds variants instead
(--variants), named with --variant.
Declare the parts you want feedback on with data-part="name" in the html.

the loop (never blocks on the user):
  1. mockpit init once per repo; read the brief (mockpit guide).
  2. mockpit publish once per alternative; declare parts with data-part.
  3. A choice is several alternatives plus one question that binds them: mockpit ask
     with options bound to alternatives. An alternative decides everything it differs
     on; don't re-ask it. Visual options carry an alternative or knob set. One
     render plus a control: --knobs.
  4. Tell the user in one line where to look, then end your turn. The question
     itself lives in the design, never in chat. The user answers in the
     browser at their own pace. Never poll.
  5. When the user says they answered (or a mockpit watch line wakes you), run
     mockpit feedback. Every write also returns feedback; read it.
  6. mockpit publish the revision; mockpit export once an alternative is in use.
  In Claude Code, arm mockpit watch under Monitor after asking, then end the
  turn, unless you have the mockpit plugin, which wakes you itself; elsewhere
  the user's next message is the wake-up.

verbs:
  mockpit init [--project name] [--kit <id>] [--kit-url <url> --kit-doc <file|text>]
                                          read the repo's tokens, kit and icon sets
                                          into the project's system, write .mockpit/starter.html
  mockpit publish --design <slug> --html <file> [options]
                                          create or version one alternative of one state
      --state <label>   state, in the user's words (omit for a single-state design)
      --alternative <name>  alternative label (default "default")
      --variant <name>  on a variants design, the variant's label instead
      --variants        its entries are variants that all ship, not alternatives
                        to choose between (screen or component; --no-variants: off)
      --html <file|->   the html body (or a positional file)
      --surfaces <json|file>  instead: the full ordered surface list; {"id"}
                        alone keeps a surface, a missing id removes it
      --parts <name=file|->  instead: replace just that data-part's element in
                        the latest version (repeatable; name#key targets one instance)
      --swaps <part#swap=file|->  instead: replace or add one swap of a part in
                        the latest version (repeatable)
      --title <t>       design title
      --kind <k>        screen|component, only for an app's screens (default idea);
                        with no html it plans one, drawn by a later publish
      --area <name>     where in the product it belongs ("Shell"); Home groups by it
      --group <word>    a component's library group (Actions, Inputs, Navigation, ...)
      --source <path>   the code path that implements it
      --knobs <json|file>  knobs in tunekit usePane shape, keyed by path
      --from <N>        branch from version N
      --amend           replace the latest version in place: a fix before the
                        user has acted on it (one request, one version)
      --withdraw        take the latest version back, under the same rule
      --prompt <text>   what prompted this version
      --description <text>  one line on what this alternative is, shown beside it
      --widths <list>   device widths to show it at, e.g. 390,1280
      --flow <name> [--step <N>]  make this state step N of a flow (0 takes
                        it out); with no html it only places the state
      --project <name>  project (default: git remote, else directory name)
      --kit <id>        opt the html surface into a kit (repeatable; see "mockpit kits")
      --poster <file>   a still of the page (png, jpg); Studio and Home show it
                        instead of running the page. Send one with every version
                        that changes the page, or it goes
      --md/--mermaid/--diff/--terminal/--data/--code/--image <file|->
                        add a surface of that kind after the html (repeatable;
                        --data is a JSON tree)
  mockpit ask --design <slug> "<question>" --option <label[=alternative]> ...
                                          ask the user; bind options to alternatives
      --option <l[=v]>  an option (repeatable); "=alternative" binds it to an alternative,
                        "=alternative@3" to its version 3, "=knob:path=value" sets one knob,
                        "=palette:id" chooses a palette of the project's system
      --recommend <l>   the option you would pick, by label; a quiet mark on it
      --scope <s>       design|state|part (default design)
      --state <label>   the state a state-scoped question is about
      --states <label>  a design-wide question: a state its answers can be seen
                        on (repeatable, best first)
      --part <name>     the part a part-scoped question is about
      --multi           allow several answers
      --id <id>         stable id; reusing one replaces that question
      --asks <json|file>  several questions at once, full shape
  mockpit read [slug] [--body] [--history] [--decisions] [--area <name>]
                                          what the user already decided, then
                                          no slug: every design plus what the user
                                          is doing now; a slug: that design and its
                                          spec; --area: one area, all settled in it
  mockpit feedback                       what the user sent since you last heard,
                                          plus pending; returns at once
  mockpit say "<text>" --design <slug> [--state s] [--alternative v]
                                          a plain-text message in a design's thread
  mockpit move --design <slug> --alternative <v>... (--to <design> [--to-state s] | --archive | --restore)
                                          move alternatives elsewhere, archive or restore them
  mockpit edit <slug> [--slug s] [--title t] [--kind k] [--area a] [--group g] [--[no-]variants] [--source p]
          [--purpose t] [--behaviour t [--state s] [--part p]]
                                          change a design or its spec without a new
                                          version ("" clears)
  mockpit edit --project <name> --rename <new>
                                          rename a project
  mockpit edit --project <name> --areas "Shell,Food"
                                          the order Home lists areas in
  mockpit edit --project <name> [--area a] --description <line>
                                          what the project, or one area, is for
  mockpit system [--sheet f.css] [--classes j] [--tokens j] [--scales j] [--palettes j] ...
                                          the project's system: read it, or change a part
                                          (applies to every design at once)
  mockpit export --design <slug> [--state s] [--alternative v] [--out <dir>]
                                          write the html in use + history per state
                                          to .mockpit/accepted/<design>/<state>/
  mockpit upload <file> [--kind image|file]
                                          upload an asset, print its id and URL
  mockpit guide [--topic <id>]           the project-aware brief, or one reference topic
  mockpit rules [--mine]                 send .mockpit/rules.md (or, with --mine, your
                                          ~/.mockpit/rules.md) to the server for the brief
  mockpit run <file|->                   run a script against the mockpit API on the
                                          server (mockpit guide --topic scripts)
  mockpit watch [--session <id>]         stream user feedback, one line per Send
                                          (for a background monitor)

other commands:
  mockpit serve [--port N] [--host H] [--open]
                                          start the server (API + viewer)
  mockpit demo                           seed the Writer design to explore the viewer
  mockpit icons [add|remove <set>...]    list the icon sets html surfaces can name
                                          (icon="prefix:name"); add or remove an
                                          Iconify set for this project
  mockpit asset-url <file>               print the URL a file will have (no upload)
  mockpit kits                           list the opt-in html kits (bundled + project)
  mockpit kit add <id> --url <css> --doc <file|text> [--script <js>]
                                          define a project kit from a CDN stylesheet
  mockpit kit remove <id>                remove a project kit
  mockpit setup                          print the AGENTS.md integration block
  mockpit version                        show version and check for updates
  mockpit mcp                            run the stdio MCP server (for agent configs)

flags:
  --version, -V                           print version and exit
  --json                                  print the raw server response
  --quiet                                 print nothing on success
  --help, -h                              per-command help (mockpit publish --help)

environment:
  MOCKPIT_PROJECT  project name; overrides the git-remote/directory default
  MOCKPIT_URL      server base URL (default http://localhost:8228)
  MOCKPIT_TOKEN    bearer token for a deployed instance
  CHROME_PATH      the browser for automatic posters; pointing nowhere turns them off
  MOCKPIT_HOST     address serve binds to (default: every interface)
  MOCKPIT_LOG      serve's event log file, or "off" (default ~/.mockpit/events.jsonl)
  MOCKPIT_SESSION  fixed session id (overrides auto-detection)
  MOCKPIT_AGENT    agent name used when creating sessions
`;

// Per-command help, so `mockpit publish --help` costs a few lines instead of
// the whole manual. Commands without an entry fall back to HELP.
const COMMAND_HELP = {
  init: `mockpit init [--project <name>] [--kit <id>]
  [--kit-url <https url> [--kit-script <url>] --kit-doc <file.md|text>]
  Read the repo's tokens and kit into the project's system, add the
  Iconify sets matching its icon packages, and write .mockpit/starter.html
  (gitignored). --kit makes a bundled or project kit the default for every html
  surface. --kit-url defines the project's own kit (id from --kit, else
  "project") and makes it the default; the doc is the cheat sheet the brief prints.`,
  rules: `mockpit rules [--project <name>]
mockpit rules --mine
  Guidance on top of the core brief, highest first: the project's
  .mockpit/rules.md (committed with the repo), your ~/.mockpit/rules.md, then
  the packs either names (\`packs: [design-craft, foundations]\` in its frontmatter:
  design-craft for how to design, foundations for starting a project's system). A file
  has "## Rules" (always followed) and "## Suggestions" (aimed for).
  This sends the file as it is on disk; a missing file clears the stored copy.
  init sends the project's too. A local server reads yours live, so --mine is
  for a deployed one.`,
  kit: `mockpit kit add <id> --url <https url> --doc <file.md|text> [--script <url>]
mockpit kit remove <id>
  A project kit is a stylesheet (and optional script) on the CDN allowlist plus a
  class cheat sheet of at most 1,200 chars. Surfaces name it in kits like a
  bundled kit.`,
  icons: `mockpit icons [--project <name>]
mockpit icons add <set> [<set>...]
mockpit icons remove <set> [<set>...]
  html surfaces write <i icon="lucide:check"></i>; the server inlines the svg.
  lucide and mage are bundled. add finds @iconify-json/<set> in node_modules,
  the global npm root or bun's cache, else fetches it from jsDelivr.`,
  publish: `mockpit publish --design <slug> --html <file> [options]
mockpit publish --design <slug> --surfaces <json|file> [options]
mockpit publish --design <slug> --parts <name=file|-> ... [options]
mockpit publish --design <slug> --swaps <part#swap=file|-> ... [options]
mockpit publish --design <slug> [--state s] [--alternative v] --withdraw
  Creates the design, state or alternative, or the next version of an existing one.
  One request gets one version: fixes to it before the user acts use --amend.
  --amend            replace the alternative's latest version in place (same number)
                     instead of adding one. Only from the session that published
                     it, and only while the user hasn't acted on it (no Send,
                     comment, draft answer, not in use)
  --withdraw         take the alternative's latest version back under the same
                     rule: the version before it is current again, and an
                     alternative with no other version goes
  --state <label>    state in the user's words (omit for a single-state design)
  --alternative <name>   alternative label (default "default")
  --variant <name>   on a variants design, the variant's label instead; the wrong one
                     fails, naming the right one
  --variants         its entries are variants that all ship (a component's sizes or
                     tones), not alternatives to choose between: nothing on it is
                     chosen. Screen or component only; --no-variants turns it off
  --surfaces <json|file>  the full ordered list: {"id"} alone keeps a surface,
                     a missing id removes it, order is the list order
  --parts <name=file|->   replace only the element carrying data-part="name"
                     (name#key for one instance) in the latest version; repeatable
  --swaps <part#swap=file|->  replace the element carrying data-part="part"
                     data-swap="swap" in the latest version, or add it after
                     that part's other swaps; the marks are added if missing
  --title <t>        design title
  --kind <k>         screen|component|idea: screen for a screen of the product,
                     component for a reusable design screens include (being included makes one);
                     omit for ideas, diagrams, reviews (default idea)
  --area <name>      where in the product it belongs, in the project's words
                     ("Shell", "Food"); Home groups each tab by it. "" clears
  --group <word>     a component's group in the library, by what it does: Actions,
                     Inputs, Navigation, Feedback, Containers, or the project's own
                     word. A component with no area is shared. "" clears
  --source <path>    the code path that implements it (apps/web/src/shell). "" clears
  --knobs <json|file>  knobs in tunekit usePane shape
  --from <N>         branch from version N
  --fork <v[@N]>     start this new alternative from sibling v (its version N, else
                     its latest); alone it copies v, with --parts/--swaps it
                     edits the copy
  --prompt <text>    what prompted this version
  --description <text>  one line on what this alternative is, shown beside it (never
                     inside the design)
  --widths <list>    device widths the design is judged at, side by side, e.g.
                     390,1280 (the ones the user ships to)
  --flow <name>      a flow this state is a step of: the states the user moves
                     between, in order, across designs; without html it only
                     places the existing state
  --step <N>         its 1-based place in the flow (moves it if it is there);
                     0 takes it out; omitted, it joins at the end
  --project <name>   project (default: git remote, else directory name)
  --poster <file>    a still of the page (png, jpg) that Studio and Home show; without
                     one, a local Chrome or Chromium takes it just after the publish
                     instead of running it; with --parts or --swaps it is the
                     still of the spliced page. A version that changes the page
                     without one drops the old still
  --md/--mermaid/--diff/--terminal/--data/--code/--image <file>  more surfaces
  --json / --quiet
  Prints the parts found per state, parts that vanished or were renamed,
  nudges, a ready-to-run "mockpit ask" when alternatives have no question, and feedback.`,
  ask: `mockpit ask --design <slug> "<question>" --option <label[=alternative]> ... [--scope design|state|part]
  [--state s] [--states s]... [--part p] [--multi] [--id id] [--after <ask id>] [--recommend <label>]
  mockpit ask --design <slug> --asks <json|file>
  Ask the user. A choice is several alternatives plus one question that binds them.
  Then tell the user where to look and end your turn.`,
  read: `mockpit read [slug] [--project <name>] [--body] [--history] [--tree] [--decisions]
mockpit read --area <name> [--project <name>]
  Read this first. Every form carries the project's decision list, what the user
  already settled, from their replies: treat each line as settled unless they say
  otherwise. No slug: one line per design (states, alternatives, open questions), one per
  flow, plus pending, what the user is doing now, then the decisions. A slug: the
  design's spec (purpose: what it is for; behaviour: how it works; decisions: what was
  settled on it), states, alternatives, questions with answers, parts, knobs and settled
  values, plus its pending and decisionList (its own lines marked here), as JSON.
  --area: one product area, read before drawing in it: what the project and the area
  are for, its screens, flows and components (purpose, states), the shared components,
  their decisions and the ideas waiting there, as JSON.
  --body includes surfaces, --history version rows. --tree (no slug): the
  project as a tree, each design's alternatives with status and forkedFrom, and the
  designs it includes and is included in, as JSON. --decisions: the whole list, when
  a read says lines were left out. Never consumes feedback.`,
  feedback: `mockpit feedback [--project <name>] [--session <id>]
  Returns at once with {feedback, pending} as JSON: one batch per design the user
  sent since you last heard ({design, reply: {asks, borrowed, tuned, comments,
  verdict}, messages, inUse, archived}), delivered once across feedback, watch and
  every write; and pending ({design, viewerOpen, draft}) so you can tell the
  user "take your time" or "2 of 3 answered". Run it when the user says they
  answered.`,
  say: `mockpit say "<text>" --design <slug> [--state s] [--alternative v]
  A plain-text message in the design's thread, as your session's agent.`,
  move: `mockpit move --design <slug> [--state s] --alternative <v> [--alternative <v>...]
  --to <design> [--to-state <s>] | --to-state <s> | --archive | --restore
mockpit move --design <slug> [--state s] [--alternative <v>...] --hide-older | --delete-older
  Tidy up. --to or --to-state moves them to another design or tab (a new state is
  created) and takes them out of here; --archive takes them out of sight; --restore
  brings them back. Their group goes along; one in use stays and is reported. The
  thread says what happened, so the user can undo it.
  Only when the user asks: --hide-older hides all but each alternative's newest visible
  version (no --alternative: every alternative), and --delete-older deletes them for good,
  skipping and listing any that a reply, comment, question, instance, copy or fork still
  points at, or that is in use. It can't be undone: confirm first.`,
  edit: `mockpit edit <slug> [--slug <new>] [--title <t>] [--kind screen|component|idea]
  [--first-state <name>] [--purpose <text>|""]
  [--behaviour <text> [--state <s>] [--part <p>] | --behaviour <json|file>|""]
  [--area <name>|""] [--group <word>|""] [--[no-]variants] [--source <path>|""] [--project <name>]
mockpit edit --project <name> --rename <new name>
mockpit edit --project <name> --areas "Shell,Food,Chat"
mockpit edit --project <name> [--area <name>] --description <one line>|""
  Change a design without publishing a new version; "" clears area, group or source.
  The design is named first, or with --design. A component with no area is shared;
  --group files it in the library by what it does (Actions, Inputs, Navigation,
  Feedback, Containers, or the project's own word). --variants says a screen's or
  component's entries all ship, so they are named with --variant and nothing on it is
  chosen; --no-variants makes them alternatives again. A new
  slug rewrites every instance, data-goto and flow step that names the old one, in
  every version. A design still included somewhere stays a component, not an idea.
  --purpose and --behaviour write the design's spec, which read returns: what it is for,
  and how it works where the picture can't show it (pinch, timing, what happens next).
  That goes here, never in side files. --behaviour with text adds one line, about
  --state and pinned to --part (an annotation); with a JSON list
  ('[{"text":"…","state":"Now","part":"river"}]') it replaces every line; "" clears. A
  section the user wrote by hand stands, so a draft is then not applied and the
  result says so.
  --first-state names a design's one unnamed state, and every alternative it holds goes
  there, so the design can then have more states.
  --rename moves the project's designs, sessions, flows, system and settings to the
  new name (refused if that project has designs); pass --project <new> or set
  MOCKPIT_PROJECT afterwards if the repo still resolves to the old name.
  --areas lists the project's areas in the order Home shows them; areas it leaves
  out follow alphabetically, "" goes back to alphabetical. --description says in one
  line what the project is for, or with --area what that area is for; the user's own
  stands until they clear it.`,
  system: `mockpit system [--project <name>] [--json]
mockpit system [--sheet <file.css>|""] [--classes <json>] [--fonts <json>] [--tokens <json>]
  [--scales <json>] [--roles <json>] [--palettes <json>] [--pairs <json>] [--as <json>]
  [--knobs <json>] [--remove <json>]
mockpit system --restore <rev>
  The project's system: a shared stylesheet, typed tokens, type and space scales, colour
  palettes and project knobs that every render of the project wears. With no flags it
  prints the system, its checks and its latest revisions (--json: all of it). Each flag
  replaces that part and leaves the rest; --tokens, --scales and --palettes upsert by
  name or id, --remove '{"tokens":["x"]}' takes them out. A JSON flag may name a file.
  Every change is a new revision the user can restore. The repo's own tokens (from
  mockpit init) can't be written here: change the code and rerun init.
  mockpit guide --topic system has the contract.`,
  run: `mockpit run <file|-> [--session <id>] [--project <name>] [--json]
  Run a script (the body of an async function, plain JavaScript) in the server's
  sandbox against the mockpit API; see mockpit guide --topic scripts. Prints each
  host call in order, the script's prints, its value or error, and any user
  feedback the run received. --json prints the whole result. Exits 2 when the
  script failed.`,
  watch: `mockpit watch [--session <id>] [--after <seq>] [--once] [--exit-code <n>]
  Print one line per Send, for a background monitor (in Claude Code, arm it
  under Monitor after asking, then end the turn; with the mockpit plugin, don't,
  since it wakes you itself). A line says a reply landed;
  feedback or the next write delivers it, once.
  --once stops after the first Send, for a harness whose wake is a process
  exiting; --exit-code sets the code it stops with (default 0).`,
  export: `mockpit export --design <slug> [--state s] [--alternative v] [--out <dir>]
  Write index.html + history.json per state to .mockpit/accepted/<design>/<state>/;
  with swaps, index.html is the chosen state, plus all-swaps.html and decisions.json.
  A screen or component writes every entry marked Ready (unmarked: every live one as it
  shows) as <alternative>.html + <alternative>.history.json (with the start of the post id where two
  alternative names would share a file), and design.json: its mark, its spec
  and the components those versions are built from, each with its own mark.`,
  upload: `mockpit upload <file> [--kind image|file] [--session <id>]
  Upload an asset; prints its id and URL. Use the id as an image surface's assetId.`,
  guide: `mockpit guide [--topic <id>] [--project <name>]
  No flag prints the brief: the loop, parts, questions and knobs, feedback, and
  this project's system, kit and icons. --topic prints one reference topic
  (system, knobs, asks, surfaces, html, feedback, http, scripts).`,
};

// `console.log(...)` on a pipe is asynchronous, so exiting on the next line
// truncates anything past the pipe buffer (~8 KB) — which is most of the help
// text. Write to fd 1 synchronously, retrying the non-blocking EAGAIN, then exit.
function printAndExit(text) {
  let buf = Buffer.from(text.endsWith("\n") ? text : `${text}\n`);
  while (buf.length > 0) {
    try {
      buf = buf.subarray(writeSync(1, buf));
    } catch (err) {
      if (err?.code !== "EAGAIN") throw err;
    }
  }
  process.exit(0);
}

function fail(msg) {
  console.error(`mockpit: ${msg}`);
  process.exit(1);
}

// The agent-facing error format: name the thing, offer one fix, say nothing was
// written, exit 2. No stack traces, no prose.
function die(what, fix) {
  console.error(`error ${what}`);
  if (fix) console.error(`  fix: ${fix}`);
  process.exit(2);
}

// `report` decides how a failure reads: plumbing verbs keep the one-line
// `mockpit: …` (exit 1); the design verbs pass `die` so the error / fix / exit 2
// format is what an agent parses.
async function api(path, init = {}, { report, fix } = {}) {
  const bail = (what, hint) => (report === "die" ? die(what, hint ?? fix) : fail(what));
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...HEADERS,
        ...init.headers,
      },
    });
  } catch {
    if (report === "die") die(`cannot reach mockpit at ${BASE}`, "mockpit serve");
    fail(`server not reachable at ${BASE} — start it with: mockpit serve`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A surface validation failure carries typed issues; the first one is the
    // actionable line ("error … : <message>") the agent needs.
    const issue = Array.isArray(body.issues) ? body.issues[0] : null;
    // The server names the valid choices when a call is ambiguous; say them.
    const choices = body.alternatives ?? body.states ?? body.projects;
    const main =
      (body.error ?? `${res.status} ${res.statusText}`) +
      (Array.isArray(choices) ? ` (${choices.join(", ")})` : "");
    const extra = issue?.message ?? issue?.code;
    // The server's own fix, when it names one, beats the caller's generic hint.
    bail(
      extra && !main.includes(extra) ? `${main}: ${extra}` : main,
      typeof body.fix === "string" ? body.fix : undefined,
    );
  }
  return body;
}

// Session state is keyed by (agent process pid, cwd). Many agents spawn a
// fresh shell per command, so the immediate parent is unstable — walk up the
// process tree past shells to the agent process itself. Falls back to
// cwd-only keying where `ps` is unavailable.
const SHELLS = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "csh", "tcsh"]);

function getParentPosix(pid) {
  const out = execFileSync("ps", ["-o", "ppid=,comm=", "-p", String(pid)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const m = out.match(/^\s*(\d+)\s+(.*)$/);
  if (!m) return { ppid: 0, isShell: false };
  const ppid = Number(m[1]);
  const comm = m[2].trim().split("/").pop() ?? "";
  return { ppid, isShell: SHELLS.has(comm.replace(/^-/, "")) };
}

function agentPidWindows(startPid) {
  // wmic is removed in Windows 11. Walk the process tree in a single
  // PowerShell call to avoid repeated startup overhead (~300ms per spawn).
  // $procId, not $pid: $PID is a PowerShell automatic variable holding the
  // host process's own id, and reassigning it is confusing at best.
  const script = `
    $procId = ${startPid}
    $shells = @('cmd.exe','powershell.exe','pwsh.exe')
    for ($i = 0; $i -lt 10; $i++) {
      $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId"
      if (!$p) { break }
      if ($shells -notcontains $p.Name.ToLower()) { break }
      if ($p.ParentProcessId -le 1) { break }
      $procId = $p.ParentProcessId
    }
    $procId
  `;
  const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  return Number(out) || startPid;
}

function agentPid() {
  try {
    if (process.platform === "win32") return agentPidWindows(process.ppid);
    let pid = process.ppid;
    for (let hops = 0; hops < 10; hops++) {
      const { ppid, isShell } = getParentPosix(pid);
      if (!isShell || !ppid || ppid <= 1) return pid;
      pid = ppid;
    }
    return pid;
  } catch {
    return 0;
  }
}

function stateFile() {
  const dir = join(tmpdir(), `mockpit-${userInfo().username}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const key = createHash("sha1")
    .update(`${agentPid()}:${process.cwd()}`)
    .digest("hex")
    .slice(0, 12);
  return join(dir, `${key}.json`);
}

function readState() {
  try {
    return JSON.parse(readFileSync(stateFile(), "utf8"));
  } catch {
    return {};
  }
}

function writeState(patch) {
  const next = { ...readState(), ...patch };
  writeFileSync(stateFile(), JSON.stringify(next));
  return next;
}

function agentName(flags) {
  return flags.agent ?? process.env.MOCKPIT_AGENT ?? readState().agent ?? "agent";
}

// The state file is keyed by the agent's pid, which a resumed conversation
// doesn't keep; Claude Code's session id does, so the server can hand back the
// same mockpit session (and its feedback cursor).
function harnessKey() {
  if (process.env.MOCKPIT_SESSION_KEY) return process.env.MOCKPIT_SESSION_KEY;
  if (process.env.CLAUDE_CODE_SESSION_ID)
    return `claude-code:${process.env.CLAUDE_CODE_SESSION_ID}`;
  if (process.env.CODEX_THREAD_ID) return `codex:${process.env.CODEX_THREAD_ID}`;
  return undefined;
}

async function resolveSession(flags, { create = false } = {}) {
  if (flags.session) return flags.session;
  if (process.env.MOCKPIT_SESSION) return process.env.MOCKPIT_SESSION;
  const state = readState();
  const key = harnessKey();
  // The state file is per process and cwd, which /clear keeps: a session made for
  // the conversation before it isn't this one's, and the watcher waits on this one's.
  if (state.session && !flags["new-session"] && state.key === key) {
    const ok = await fetch(`${BASE}/api/sessions/${state.session}`, {
      headers: HEADERS,
    }).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return state.session;
  }
  if (!create) return null;
  const session = await api("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      agent: agentName(flags),
      title: flags["session-title"],
      cwd: process.cwd(),
      project: resolveProject(flags).name,
      key,
    }),
  });
  writeState({ session: session.id, agent: agentName(flags), key });
  return session.id;
}

// The harness's conversation id names exactly one session, where the cwd can
// match several agents working in one repo; the watcher would then take a
// sibling's replies. Never creates one: most conversations never use mockpit.
async function resolveSessionByKey(key) {
  try {
    const res = await fetch(`${BASE}/api/sessions${query({ key })}`, { headers: HEADERS });
    if (!res.ok) return null;
    return (await res.json())[0]?.id ?? null;
  } catch {
    return null;
  }
}

// A monitor process (e.g. the Claude Code plugin) may not share the local
// state file written by the agent's CLI calls — different spawn tree, so
// `agentPid()` can hash to a different key. Fall back to asking the server for
// the most recently active session whose cwd matches ours. Uses raw fetch (not
// `api()`) so a transient failure returns null instead of exiting the process.
async function resolveSessionByCwd(cwd = process.cwd()) {
  try {
    const res = await fetch(`${BASE}/api/sessions`, {
      headers: HEADERS,
    });
    if (!res.ok) return null;
    const sessions = await res.json();
    return (
      sessions
        .filter((s) => s.cwd === cwd)
        .sort((a, b) => String(b.lastActiveAt).localeCompare(String(a.lastActiveAt)))[0]?.id ?? null
    );
  } catch {
    return null;
  }
}

function readContent(arg) {
  if (!arg || arg === "-") {
    try {
      return readFileSync(0, "utf8");
    } catch {
      fail("no input — pass a file path or pipe HTML on stdin");
    }
  }
  try {
    return readFileSync(arg, "utf8");
  } catch {
    fail(`cannot read file: ${arg}`);
  }
}

function out(value) {
  console.log(JSON.stringify(value, null, 2));
}

const CONTENT_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  json: "application/json",
  jsonl: "application/x-ndjson",
  ndjson: "application/x-ndjson",
  txt: "text/plain",
  log: "text/plain",
  csv: "text/csv",
  pdf: "application/pdf",
};

function contentTypeFor(file) {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

// Map a filename extension to a shiki language id. Only common languages —
// shiki knows many more, but this covers the files an agent is likely to
// `mockpit code`. Unmapped extensions return undefined (shiki "text").
const LANG_BY_EXT = {
  ts: "typescript",
  tsx: "tsx",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  json: "json",
  jsonl: "json",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sql: "sql",
  md: "markdown",
  markdown: "markdown",
  dockerfile: "docker",
  makefile: "make",
  lua: "lua",
  r: "r",
  scala: "scala",
  clj: "clojure",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  ml: "ocaml",
  nim: "nim",
  dart: "dart",
  groovy: "groovy",
  gradle: "groovy",
  vue: "vue",
  svelte: "svelte",
  xml: "xml",
  graphql: "graphql",
  gql: "graphql",
};

function inferLang(file) {
  const base = file.split("/").pop() ?? file;
  if (/^Dockerfile/i.test(base)) return "docker";
  if (/^Makefile/i.test(base)) return "make";
  const ext = base.split(".").pop()?.toLowerCase() ?? "";
  return LANG_BY_EXT[ext];
}

// POST raw bytes to /api/assets. Returns { id, url, contentType, ... }.
async function uploadBytes(bytes, { filename, contentType, session, kind } = {}) {
  const params = new URLSearchParams();
  params.set("filename", filename ?? "upload");
  if (session) params.set("session", session);
  if (kind) params.set("kind", kind);
  let res;
  try {
    res = await fetch(`${BASE}/api/assets?${params}`, {
      method: "POST",
      headers: {
        "content-type": contentType ?? "application/octet-stream",
        ...HEADERS,
      },
      body: bytes,
    });
  } catch {
    fail(`server not reachable at ${BASE} — start it with: mockpit serve`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) fail(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

// Upload a file from disk to /api/assets.
async function uploadFile(file, { session, kind } = {}) {
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch {
    fail(`cannot read file: ${file}`);
  }
  return uploadBytes(bytes, {
    filename: file.split(/[\\/]/).pop() ?? "upload",
    contentType: contentTypeFor(file),
    session,
    kind,
  });
}

// Served by every mockpit server without an install (server/icons.ts).
const BUNDLED_ICON_SETS = ["lucide", "mage"];

// Find each Iconify set, upload it as a file asset, and record them all on the
// project's design in one PUT. A set that cannot be found is reported in
// `errors` and does not stop the others.
async function installIconSets(project, prefixes) {
  const { findIconSet } = await import("./initDesign.js");
  const added = [];
  const errors = [];
  for (const prefix of new Set(prefixes)) {
    try {
      const { set } = await findIconSet(prefix, process.cwd());
      const asset = await uploadBytes(new TextEncoder().encode(JSON.stringify(set)), {
        filename: `icons-${prefix}.json`,
        contentType: "application/json",
        kind: "file",
      });
      added.push({ prefix, assetId: asset.id });
    } catch (err) {
      errors.push({ prefix, message: err instanceof Error ? err.message : String(err) });
    }
  }
  if (added.length === 0) return { added: [], errors, system: null };
  const stored = (await api(`${projectPath(project)}/system`)) ?? {};
  const keep = (stored.iconSets ?? []).filter((s) => !added.some((a) => a.prefix === s.prefix));
  await api(`${projectPath(project)}/system`, {
    method: "PUT",
    body: JSON.stringify({ iconSets: [...keep, ...added] }),
  });
  const system = await api(`${projectPath(project)}/system`);
  return {
    added: system.iconSets.filter((s) => added.some((a) => a.prefix === s.prefix)),
    errors,
    system,
  };
}

// Every page of the project looks different after a system change, so its stills are
// taken again in the background; until then the overviews run the pages live.
function retakeStills(project, session) {
  queueRetakes({ base: BASE, token: TOKEN, client: HEADERS["x-mockpit-client"], session, project });
}

// The system at a glance; `--json` prints all of it.
function printSystem(s) {
  const palettes = s.color?.palettes ?? [];
  const lines = [
    `${s.project} · r${s.rev}${s.kit && s.kit !== "none" ? ` · kit ${s.kit}` : ""}`,
    s.sheet
      ? `sheet ${(s.sheet.css.length / 1000).toFixed(1)} KB · ${s.sheet.classes.length} classes`
      : null,
    s.fonts?.length ? `fonts ${s.fonts.map((f) => f.family).join(", ")}` : null,
    s.scales?.length
      ? `scales ${s.scales.map((x) => `${x.id} (${x.steps.join(" ")})`).join(", ")}`
      : null,
    s.tokens?.length
      ? `tokens ${s.tokens.filter((t) => !t.scale).length} (+${s.tokens.filter((t) => t.scale).length} from scales)`
      : null,
    s.color?.roles?.length ? `roles ${s.color.roles.map((r) => r.name).join(", ")}` : null,
    palettes.length
      ? `palettes ${palettes.map((p) => `${p.label} (${p.status})`).join(", ")}`
      : null,
    Object.keys(s.knobs ?? {}).length ? `knobs ${Object.keys(s.knobs).join(", ")}` : null,
  ].filter(Boolean);
  for (const l of lines) console.log(l);
  for (const c of s.checks ?? []) console.log(`check: ${c}`);
  for (const r of (s.revisions ?? []).slice(0, 5))
    console.log(`r${r.rev} ${r.at.slice(0, 16)} ${r.summary}`);
  if (s.url) console.log(s.url);
}

// `--doc` is a file when one exists at that path, else the cheat sheet itself.
function readKitDoc(doc) {
  if (doc === undefined) return undefined;
  try {
    if (existsSync(doc)) return readFileSync(doc, "utf8");
  } catch {}
  return doc;
}

// The server checks the URLs against the CDN allowlist and the doc's length;
// its one-line error is the message.
function putProjectKit(project, id, { url, script, doc }) {
  return api(`${projectPath(project)}/system`, {
    method: "PUT",
    body: JSON.stringify({ projectKits: [{ id, href: url, script, doc: readKitDoc(doc) }] }),
  });
}

// Normalize repeated/comma-joined --kit flags into a deduped id list (or
// undefined). The server allowlists the ids; an unknown one is a clean 400.
function normalizeKits(flag) {
  if (!flag) return undefined;
  const ids = (Array.isArray(flag) ? flag : [flag])
    .flatMap((s) => String(s).split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? [...new Set(ids)] : undefined;
}

// Surface-kind flags accepted by `publish` and `surface add` (the two commands
// that compose a post from one flag per surface kind). Each is declared
// `multiple: true` in the parser, so a repeated flag yields an array — letting
// an author emit several surfaces of the same kind (--diff a --diff b).
const SURFACE_FLAGS = new Map([
  ["md", "markdown"],
  ["mermaid", "mermaid"],
  ["diff", "diff"],
  ["terminal", "terminal"],
  ["data", "json"],
  ["code", "code"],
  ["image", "image"],
]);

// Build a single surface object from one flag value. Mirrors the per-kind
// construction that used to be inlined in `publish` and `surface add`.
async function buildSurface(kind, value, { session, layout }) {
  const file = value || "-";
  if (kind === "markdown") return { kind: "markdown", markdown: readContent(file) };
  if (kind === "mermaid") return { kind: "mermaid", mermaid: readContent(file) };
  if (kind === "diff")
    return {
      kind: "diff",
      patch: readContent(file),
      ...(layout === "split" && { layout: "split" }),
    };
  if (kind === "terminal") return { kind: "terminal", text: readContent(file) };
  if (kind === "json") {
    const text = readContent(file);
    try {
      return { kind: "json", data: JSON.parse(text) };
    } catch {
      fail(`--data: invalid JSON${value && value !== "-" ? ` in ${value}` : ""}`);
    }
  }
  if (kind === "code") {
    const part = { kind: "code", code: readContent(file) };
    const codeLang = value && value !== "-" ? inferLang(value) : undefined;
    if (codeLang) part.language = codeLang;
    if (value && value !== "-") part.title = value.split("/").pop() || value;
    return part;
  }
  if (kind === "image") {
    const asset = await uploadFile(value, { session, kind: "image" });
    return { kind: "image", assetId: asset.id };
  }
  fail(`unknown surface kind: ${kind}`);
}

// Walk parseArgs `tokens` (which preserve command-line order, including
// repeats when a surface flag is `multiple: true`) and build one surface per
// flag occurrence, pulling successive values from each flag's value array.
// Surfaces render top-to-bottom, so order is user-visible — this honors the
// order the author wrote the flags, repeats included.
async function surfacesFromFlags(flags, tokens, { session, layout }) {
  const idx = new Map();
  const out = [];
  for (const t of tokens ?? []) {
    if (t.kind !== "option" || !SURFACE_FLAGS.has(t.name)) continue;
    const flagName = t.name;
    const arr = flags[flagName];
    if (!Array.isArray(arr)) continue;
    const i = idx.get(flagName) ?? 0;
    const value = arr[i];
    if (value === undefined) continue;
    idx.set(flagName, i + 1);
    out.push(await buildSurface(SURFACE_FLAGS.get(flagName), value, { session, layout }));
  }
  return out;
}

// A project is the repo the agent runs in. Resolution order is explicit flag,
// environment, git remote (owner/repo), then the directory name — so an agent
// that passes nothing still lands in a stable, human-recognizable project.
function resolveProject(flags = {}) {
  if (flags.project) return { name: String(flags.project), source: "flag" };
  if (process.env.MOCKPIT_PROJECT) {
    return { name: process.env.MOCKPIT_PROJECT, source: "MOCKPIT_PROJECT" };
  }
  const remote = gitRemoteProject();
  if (remote) return { name: remote, source: "git remote" };
  return { name: process.cwd().split(/[\\/]/).filter(Boolean).pop() || "workspace", source: "cwd" };
}

function gitRemoteProject() {
  let url;
  try {
    url = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
  if (!url) return null;
  const m = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

function slugify(text) {
  return String(text)
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

const projectPath = (project) => `/api/projects/${encodeURIComponent(project)}`;

const designPath = (slug) => `/api/designs/${encodeURIComponent(slug)}`;

const query = (params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== false) q.set(k, v === true ? "1" : String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
};

// The flags every design verb shares: which design, which state, which alternative
// (a variants design's entries are variants, named with --variant).
const DESIGN_FLAGS = {
  design: { type: "string" },
  state: { type: "string" },
  alternative: { type: "string" },
  variant: { type: "string" },
  project: { type: "string" },
  session: { type: "string" },
};

// `mockpit export` with no design: the project's system as files code can import.
async function exportSystem(flags) {
  const project = resolveProject(flags).name;
  const data = await api(
    `/api/projects/${encodeURIComponent(project)}/system/export`,
    {},
    { report: "die", fix: "mockpit system" },
  );
  if (flags.json) return out(data);
  const dir = flags.out ? flags.out : join(process.cwd(), ".mockpit", "system");
  mkdirSync(dir, { recursive: true });
  const files = [];
  const write = (name, text) => {
    if (!text) return;
    writeFileSync(join(dir, name), text);
    files.push(name);
  };
  write("sheet.css", data.sheet);
  write("tokens.css", data.css);
  const { sheet: _s, css: _c, ...rest } = data;
  write("system.json", JSON.stringify(rest, null, 2) + "\n");
  if (!flags.quiet) console.log(`${project} system r${data.rev} → ${dir} (${files.join(", ")})`);
}

function requireDesign(flags, example) {
  const slug = flags.design ? slugify(flags.design) : "";
  if (!slug) die("--design needs a slug", example);
  return slug;
}

// `--behaviour`: "" clears, a JSON list (inline or a file) replaces every line, and
// plain text is one more line, about --state and pinned to --part. A line with the
// same text is replaced, so running it again doesn't repeat it.
async function behaviourLines(slug, project, flags) {
  const value = flags.behaviour;
  if (value === "") return [];
  const looksJson = /^\s*\[/.test(value) || (existsSync(value) && /\.json$/i.test(value));
  if (looksJson) {
    if (flags.state !== undefined || flags.part !== undefined) {
      die("--state and --part go with one --behaviour line, not a list", "mockpit edit --help");
    }
    const list = readJsonFlag("behaviour", value);
    if (!Array.isArray(list)) die("--behaviour takes a JSON list of lines", "mockpit edit --help");
    return list;
  }
  const design = await api(
    `${designPath(slug)}${query({ project })}`,
    {},
    { report: "die", fix: `mockpit read --project ${project}` },
  );
  const line = {
    text: value.trim(),
    ...(flags.state ? { state: flags.state } : {}),
    ...(flags.part ? { part: flags.part } : {}),
  };
  const lines = (design.spec?.behaviour ?? []).filter((l) => l.text !== line.text);
  return [...lines, line];
}

// A value that may be inline JSON or a file holding it.
function readJsonFlag(name, value) {
  const text = existsSync(value) ? readFileSync(value, "utf8") : value;
  try {
    return JSON.parse(text);
  } catch {
    die(`--${name} is not valid JSON`, `--${name} '{"size":[16,8,48,1]}'`);
  }
}

const stateLabel = (s) => (s === null || s === undefined ? "" : `${s}/`);

// A shell-quoted argument for the ready-to-run lines the CLI prints.
const shq = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);

// The server's suggested ask as the command that sends it: an agent that was
// nudged can run it as is. --asks carries ids and scope, which flags can't.
function suggestedAskLine(slug, ask) {
  return `mockpit ask --design ${shq(slug)} --asks ${shq(JSON.stringify([ask]))}`;
}

// One line per write: what was published, its URL, the parts found per state,
// anything that moved, and feedback the user left while the agent worked.
function printPublished(result, flags) {
  if (flags.json) return out(result);
  if (flags.quiet) return;
  const { design, post } = result;
  if (result.planned) {
    console.log(`${design.slug}: planned, nothing drawn yet · ${result.url}`);
    if (result.flow) console.log(flowLine(result.flow));
    for (const nudge of result.nudges ?? []) console.log(`nudge: ${nudge}`);
    printFeedback(result.feedback);
    return;
  }
  const branch = post.from !== undefined && post.from !== post.version - 1;
  const how = result.withdrawn
    ? ` (v${result.withdrawn.version} withdrawn)`
    : flags.amend
      ? " (amended)"
      : "";
  console.log(
    `${design.slug}/${stateLabel(post.state)}${post.alternative ?? post.variant} v${post.version}${branch && post.from ? ` (from v${post.from})` : ""}${how} · ${result.url}`,
  );
  for (const { state, parts } of result.parts ?? []) {
    if (parts.length === 0) continue;
    console.log(`parts${state ? ` (${state})` : ""}: ${parts.map((p) => p.name).join(", ")}`);
  }
  if (result.applied?.length) console.log(`applied: ${result.applied.join(", ")}`);
  if (result.flow) console.log(flowLine(result.flow));
  const changes = result.partChanges;
  if (changes?.renamed?.length) {
    console.log(`renamed: ${changes.renamed.map((r) => `${r.from} → ${r.to}`).join(", ")}`);
  }
  if (changes?.vanished?.length) console.log(`vanished: ${changes.vanished.join(", ")}`);
  for (const nudge of result.nudges ?? []) console.log(`nudge: ${nudge}`);
  if (result.suggestedAsk)
    console.log(`suggested: ${suggestedAskLine(design.slug, result.suggestedAsk)}`);
  for (const warning of result.warnings ?? []) console.log(`warning: ${warning}`);
  printFeedback(result.feedback);
}

async function withdrawVersion(flags, slug, project) {
  const session = await resolveSession(flags);
  if (!session) die(`no session has published ${slug} from here`, `mockpit read ${slug}`);
  const result = await api(
    "/api/designs",
    {
      method: "POST",
      body: JSON.stringify({
        session,
        project,
        design: slug,
        state: flags.state,
        alternative: flags.alternative,
        variant: flags.variant,
        withdraw: true,
      }),
    },
    { report: "die", fix: `mockpit read ${slug} --history` },
  );
  if (!result.removed) return printPublished(result, flags);
  if (flags.json) return out(result);
  if (flags.quiet) return;
  const w = result.withdrawn;
  console.log(
    `${slug}/${stateLabel(w.state)}${w.alternative ?? w.variant} v${w.version} withdrawn, ${w.variant === undefined ? "alternative" : "variant"} removed · ${result.url}`,
  );
  printFeedback(result.feedback);
}

function flowLine(flow) {
  const steps = flow.steps.map((x) => (x.state === null ? x.design : `${x.design}/${x.state}`));
  return `flow ${flow.name}: ${steps.length ? steps.join(" → ") : "empty, removed"}`;
}

// Only speak when there IS feedback: an empty line per write is pure token
// cost, and the cursor guarantees anything pending arrives on some write.
function printFeedback(feedback) {
  if (feedback?.length) console.log(`feedback: ${JSON.stringify(feedback)}`);
}

// What the user is doing right now, per design.
function pendingLines(pending) {
  return (pending ?? []).flatMap((p) =>
    p.draft
      ? [
          `pending: ${p.design} — the user is answering (${p.draft.answered} of ${p.draft.of} answered, ${p.draft.comments} comment${p.draft.comments === 1 ? "" : "s"})`,
        ]
      : p.viewerOpen
        ? [`pending: ${p.design} — open in the viewer`]
        : [],
  );
}

function parsePublishFlags() {
  return parse({
    tokens: true,
    allowPositionals: true,
    options: {
      ...DESIGN_FLAGS,
      title: { type: "string" },
      kind: { type: "string" },
      area: { type: "string" },
      group: { type: "string" },
      variants: { type: "boolean" },
      source: { type: "string" },
      html: { type: "string" },
      poster: { type: "string" },
      surfaces: { type: "string" },
      parts: { type: "string", multiple: true },
      swaps: { type: "string", multiple: true },
      knobs: { type: "string" },
      from: { type: "string" },
      fork: { type: "string" },
      prompt: { type: "string" },
      description: { type: "string" },
      widths: { type: "string" },
      flow: { type: "string" },
      step: { type: "string" },
      kit: { type: "string", multiple: true },
      layout: { type: "string" },
      md: { type: "string", multiple: true },
      mermaid: { type: "string", multiple: true },
      diff: { type: "string", multiple: true },
      terminal: { type: "string", multiple: true },
      data: { type: "string", multiple: true },
      code: { type: "string", multiple: true },
      image: { type: "string", multiple: true },
      "session-title": { type: "string" },
      agent: { type: "string" },
      "new-session": { type: "boolean" },
      amend: { type: "boolean" },
      withdraw: { type: "boolean" },
    },
  });
}

// `--parts name=file` (repeatable; `name#key` targets one instance): the new
// outer html of one part, spliced server-side into the latest version.
// `--swaps part#swap=file` is the same for one swap of a part.
function readPartFlags(values, slug, flag = "parts") {
  if (!values?.length) return undefined;
  const example =
    flag === "parts"
      ? `mockpit publish --design ${slug} --parts body=body.html`
      : `mockpit publish --design ${slug} --swaps entry#skeleton=skeleton.html`;
  const parts = {};
  let stdin = false;
  for (const raw of values) {
    const at = raw.indexOf("=");
    if (at <= 0 || at === raw.length - 1) {
      die(
        `--${flag} needs ${flag === "parts" ? "name" : "part#swap"}=file (got "${raw}")`,
        example,
      );
    }
    const name = raw.slice(0, at);
    const file = raw.slice(at + 1);
    if (file === "-") {
      if (stdin) die(`only one --${flag} can read stdin`, example);
      stdin = true;
    } else if (!existsSync(file)) die(`cannot read ${file}`, `ls ${file}`);
    parts[name] = readContent(file);
  }
  return parts;
}

async function publishDesign() {
  const { values: flags, positionals, tokens } = parsePublishFlags();
  const slug = requireDesign(flags, "mockpit publish --design writer --html writer.html");
  const project = resolveProject(flags).name;
  const from = flags.from === undefined ? undefined : Number(flags.from);
  if (from !== undefined && !Number.isInteger(from)) {
    die(`--from must be a version number (got "${flags.from}")`, `mockpit read ${slug} --history`);
  }
  if (flags.withdraw) return withdrawVersion(flags, slug, project);
  const step = flags.step === undefined ? undefined : Number(flags.step);
  if (step !== undefined && !(Number.isInteger(step) && step >= 0)) {
    die(
      `--step must be a place in the flow, 1 or more, or 0 (got "${flags.step}")`,
      `mockpit read`,
    );
  }
  const file = flags.html ?? positionals[0];
  const composed =
    file !== undefined || tokens.some((t) => t.kind === "option" && SURFACE_FLAGS.has(t.name));
  const given = [
    composed && "--html",
    flags.surfaces !== undefined && "--surfaces",
    flags.parts?.length && "--parts",
    flags.swaps?.length && "--swaps",
  ].filter(Boolean);
  if (given.length > 1) {
    die(
      `pass one of --html, --surfaces, --parts or --swaps, not ${given.join(" and ")}`,
      `mockpit publish --help`,
    );
  }
  // Checked before the session exists so a typo'd path leaves nothing behind on the server.
  if (file && file !== "-" && !existsSync(file)) die(`cannot read ${file}`, `ls ${file}`);
  if (flags.poster !== undefined && !existsSync(flags.poster)) {
    die(`cannot read ${flags.poster}`, `ls ${flags.poster}`);
  }
  const parts = readPartFlags(flags.parts, slug);
  const swaps = readPartFlags(flags.swaps, slug, "swaps");
  let surfaces =
    flags.surfaces === undefined ? undefined : readJsonFlag("surfaces", flags.surfaces);
  if (surfaces !== undefined && !Array.isArray(surfaces)) {
    die(
      "--surfaces must be a JSON array",
      `--surfaces '[{"id":"<id>"},{"kind":"markdown","markdown":"# notes"}]'`,
    );
  }
  const session = await resolveSession(flags, { create: true });
  if (composed) {
    surfaces = [];
    if (file) {
      const html = { kind: "html", html: readContent(file) };
      const kits = normalizeKits(flags.kit);
      if (kits) html.kits = kits;
      surfaces.push(html);
    }
    surfaces.push(...(await surfacesFromFlags(flags, tokens, { session, layout: flags.layout })));
  }
  const declaring = flags.kind === "screen" || flags.kind === "component";
  if (!surfaces && !parts && !swaps && !flags.fork && flags.flow === undefined && !declaring)
    die(`no html for ${slug}`, `mockpit publish --design ${slug} --html <file>`);
  const poster =
    flags.poster === undefined ? undefined : (await uploadFile(flags.poster, { session })).id;
  const body = {
    session,
    project,
    design: slug,
    state: flags.state,
    alternative: flags.alternative,
    variant: flags.variant,
    title: flags.title,
    kind: flags.kind,
    area: flags.area,
    group: flags.group,
    variants: flags.variants,
    source: flags.source,
    ...(flags.knobs !== undefined && { knobs: readJsonFlag("knobs", flags.knobs) }),
    ...(from !== undefined && { from }),
    ...(flags.fork !== undefined && { fork: flags.fork }),
    prompt: flags.prompt,
    description: flags.description,
    ...(flags.widths !== undefined && {
      widths: flags.widths
        .split(",")
        .filter((w) => w.trim())
        .map((w) => Number(w)),
    }),
    ...(flags.flow !== undefined && { flow: flags.flow }),
    ...(step !== undefined && { step }),
    ...(surfaces && { surfaces }),
    ...(parts && { parts }),
    ...(swaps && { swaps }),
    ...(poster && { poster }),
    ...(!poster && findBrowser() && { posterComing: true }),
    ...(flags.amend && { amend: true }),
  };
  const result = await api(
    "/api/designs",
    { method: "POST", body: JSON.stringify(body) },
    { report: "die", fix: `mockpit read ${slug}` },
  );
  printPublished(result, flags);
  if (!poster && result.post?.surfaces?.some((s) => s.kind === "html") && !result.withdrawn) {
    queuePoster({
      base: BASE,
      token: TOKEN,
      client: HEADERS["x-mockpit-client"],
      session,
      design: result.design.id,
      postId: result.post.id,
      version: result.post.version,
    });
  }
  return result;
}

// "Quiet" is an unbound option; "Quiet=quiet" binds it to the quiet alternative;
// "Before=quiet@2" to its version 2 ("=@2" names the state's only alternative);
// "Above=knob:trim.position=top" sets one knob. The value is JSON when it
// parses (17, true), else a string, so slider and toggle values keep their type.
// "Grape=palette:grape" chooses a palette of the project's system.
function parseOption(raw) {
  const palette = raw.indexOf("=palette:");
  if (palette > 0) {
    const id = raw.slice(palette + "=palette:".length);
    if (!id) die(`option "${raw}" needs palette:<id>`, "--option Grape=palette:grape");
    return { label: raw.slice(0, palette), palette: id };
  }
  const knob = raw.indexOf("=knob:");
  if (knob > 0) {
    const pair = raw.slice(knob + "=knob:".length);
    const eq = pair.indexOf("=");
    if (eq <= 0)
      die(`option "${raw}" needs knob:<path>=<value>`, "--option Above=knob:trim.position=top");
    const text = pair.slice(eq + 1);
    let value = text;
    try {
      value = JSON.parse(text);
    } catch {}
    return { label: raw.slice(0, knob), set: { [pair.slice(0, eq)]: value } };
  }
  const at = raw.lastIndexOf("=");
  if (at <= 0) return { label: raw };
  const label = raw.slice(0, at);
  const bound = raw.slice(at + 1);
  const pin = /^(.*)@(\d+)$/.exec(bound);
  if (!pin) return { label, alternative: bound };
  return { label, ...(pin[1] ? { alternative: pin[1] } : {}), version: Number(pin[2]) };
}

// One feedback batch, one line — for a background monitor's notifications.
// The run envelope for a reader: what landed, what the script said, how it
// ended, and the feedback it took (which no later read will return).
function printRun(r) {
  for (const c of r.calls ?? []) console.log(`${c.ok ? "ok  " : "fail"} ${c.fn} ${c.summary}`);
  for (const line of r.prints ?? []) console.log(`> ${line}`);
  if (r.error) {
    const at = r.error.line
      ? ` at ${r.error.line}${r.error.column ? `:${r.error.column}` : ""}`
      : "";
    console.log(`error ${r.error.kind}${at}: ${r.error.message}`);
  } else if (r.value !== undefined) {
    console.log(typeof r.value === "string" ? r.value : JSON.stringify(r.value, null, 2));
  }
  if (r.feedback?.length) console.log(`feedback\n${JSON.stringify(r.feedback, null, 2)}`);
  if (r.truncated) console.log("(output truncated)");
}

// What a screen just marked Ready draws itself: its parts to lift, and the copies of
// library components to swap for instances.
const liftText = (lift) =>
  [
    lift.parts.length
      ? `lift ${lift.parts.map((p) => `${p.name}${p.alsoIn ? ` (also in ${p.alsoIn.join(", ")})` : ""}`).join(", ")}`
      : "",
    lift.likeLibrary.length
      ? `swap for instances ${lift.likeLibrary.map((p) => `${p.name} → ${p.component}`).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("; ");

// One line of a spec's How it works, with where it applies.
const specLineText = (l) =>
  `${[l.state, l.part].filter(Boolean).length ? `[${[l.state, l.part].filter(Boolean).join(" · ")}] ` : ""}${l.text}`;

function watchLines(batch) {
  const lines = [];
  const name = batch.design ?? "a design";
  if (batch.handoff) lines.push(`mockpit handoff on ${name}: ${batch.handoff}`);
  if (batch.edited) {
    const e = batch.edited;
    const bits = [
      e.kind ? `now a ${e.kind}` : "",
      e.area !== undefined ? (e.area ? `area ${e.area}` : "no area") : "",
    ].filter(Boolean);
    if (bits.length) lines.push(`mockpit edited ${name}: the user moved it (${bits.join(", ")})`);
    if (e.spec?.purpose !== undefined) {
      lines.push(
        e.spec.purpose === null
          ? `mockpit edited ${name}: the user cleared what it is for`
          : `mockpit edited ${name}: the user wrote what it is for: ${e.spec.purpose}`,
      );
    }
    if (e.spec?.behaviour !== undefined) {
      lines.push(
        e.spec.behaviour === null
          ? `mockpit edited ${name}: the user cleared how it works`
          : `mockpit edited ${name}: the user wrote how it works: ${e.spec.behaviour.map(specLineText).join(" / ")}`,
      );
    }
    if (e.ready) {
      lines.push(
        e.ready.ready
          ? `mockpit edited ${name}: the user marked it Ready`
          : `mockpit edited ${name}: the user took Ready off`,
      );
    }
  }
  if (batch.lift) lines.push(`mockpit lift ${name}: ${liftText(batch.lift)}`);
  if (batch.reply) {
    const r = batch.reply;
    const bits = [
      r.asks?.length
        ? r.asks
            .map(
              (a) =>
                `${a.text || a.ask}: ${a.chosen.map((o) => (o.other ? `“${o.label}”` : o.label)).join("+")}${a.comment ? ` (“${a.comment}”)` : ""}`,
            )
            .join("; ")
        : "",
      Object.keys(r.tuned ?? {}).length ? `${Object.keys(r.tuned).length} tuned` : "",
      Object.keys(r.borrowed ?? {}).length
        ? `borrowed ${Object.entries(r.borrowed)
            .map(([p, v]) => `${p}←${v}`)
            .join(", ")}`
        : "",
      ...(r.comments ?? [])
        .filter((c) => c.borrow)
        .map(
          (c) =>
            `borrow ${c.borrow.part ? `${c.borrow.part} ` : ""}from ${c.borrow.from} into ${c.alternative}@${c.version}${c.text ? ` (“${c.text}”)` : ""}`,
        ),
      (() => {
        const n = (r.comments ?? []).filter((c) => !c.borrow).length;
        return n ? `${n} comment${n === 1 ? "" : "s"}` : "";
      })(),
      r.reactions?.length ? r.reactions.join(", ") : "",
      r.verdict ? `${r.verdict.kind} ${r.verdict.alternative}` : "",
      r.text ?? "",
    ].filter(Boolean);
    lines.push(`mockpit reply on ${name}: ${bits.join(" · ").replace(/\s+/g, " ")}`);
  }
  for (const c of batch.messages ?? []) {
    lines.push(
      `mockpit message on ${name}: “${String(c.text ?? "")
        .replace(/\s+/g, " ")
        .trim()}”`,
    );
  }
  return lines;
}

// GET where "not there yet" is an answer, not an exit — a project or design that
// doesn't exist is the normal state before the first publish.
async function apiSoft(path) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: HEADERS,
    });
  } catch {
    die(`cannot reach mockpit at ${BASE}`, "mockpit serve");
  }
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

// Keep the scratch directory out of the repo, all but the project's rules
// file, which is meant to be committed. Git can't re-include a file under an
// ignored directory, so the ignore has to name the directory's contents, and
// the `.mockpit/` line older versions wrote is upgraded in place. Returns true
// when .gitignore was touched, so init can report it.
const MOCKPIT_IGNORE = ".mockpit/*\n!.mockpit/rules.md";

function ignoreMockpitDir() {
  const file = join(process.cwd(), ".gitignore");
  let current = "";
  try {
    current = readFileSync(file, "utf8");
  } catch {
    // no .gitignore yet — create one
  }
  if (/^\.mockpit\/\*$/m.test(current) && /^!\.mockpit\/rules\.md$/m.test(current)) return false;
  if (/^\.mockpit\/?$/m.test(current)) {
    writeFileSync(file, current.replace(/^\.mockpit\/?$/m, MOCKPIT_IGNORE));
    return true;
  }
  const lines = /^\.mockpit\/\*$/m.test(current) ? "!.mockpit/rules.md" : MOCKPIT_IGNORE;
  writeFileSync(
    file,
    current && !current.endsWith("\n") ? `${current}\n${lines}\n` : `${current}${lines}\n`,
  );
  return true;
}

function repoRoot() {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (top) return top;
  } catch {}
  return process.cwd();
}

// Where `mockpit serve` reads the user's own rules: next to its database.
const myRulesFile = () =>
  join(dirname(process.env.MOCKPIT_DB ?? join(homedir(), ".mockpit", "mockpit.db")), "rules.md");

// Sends a rules file as it is on disk: a missing file clears the stored copy,
// so deleting the file and re-running is how rules are switched off.
async function sendRules(file, path) {
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const result = await api(
    path,
    { method: "PUT", body: JSON.stringify({ text }) },
    { report: "die", fix: "mockpit rules --help" },
  );
  return { ...result, missing: !text };
}

function rulesSummary(r) {
  if (r.cleared) return "none (cleared)";
  const bits = [
    r.packs?.length ? `packs ${r.packs.join(", ")}` : null,
    r.rules ? "own rules" : null,
  ].filter(Boolean);
  const unknown = r.unknown?.length ? ` · unknown pack ${r.unknown.join(", ")}` : "";
  return `${bits.join(" · ") || "empty"}${unknown}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Semver greater-than for plain x.y.z (mirrors server/app.ts versionGt).
function versionGt(a, b) {
  const pa = a.split("-")[0].split(".").map(Number);
  const pb = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

// Disk-cached update check so `mockpit version` doesn't hit the registry every
// time. TTL = 24 hours; stale/missing/corrupt cache is silently ignored.
const UPDATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function updateCachePath() {
  const dir = join(tmpdir(), `mockpit-${userInfo().username}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, "update-check.json");
}

function readUpdateCache() {
  try {
    const data = JSON.parse(readFileSync(updateCachePath(), "utf8"));
    if (Date.now() - data.at < UPDATE_CACHE_TTL_MS && typeof data.version === "string") {
      return data.version;
    }
  } catch {}
  return null;
}

function writeUpdateCache(version) {
  try {
    writeFileSync(updateCachePath(), JSON.stringify({ at: Date.now(), version }));
  } catch {}
}

const [cmd, ...rest] = process.argv.slice(2);

// Subcommand flag parsing. parseArgs is strict, so without this --help (or
// any typo) throws a raw stack trace; instead --help/-h prints usage and
// exits 0, and an unknown option fails with a one-line hint.
//
// Ids are base64url and can start with - or _ (~1/64 each). parseArgs strict
// mode treats those as unknown options ("Unknown option '-6'" for an id like
// "-6K4AJsKD4M"). We swap any id-shaped token that starts with a separator
// for a sentinel before parsing, then restore it in the result — so positionals,
// tokens, and option values all get the original id back, in the right order.
const ID_LIKE = /^[-_](?![-_])[A-Za-z0-9_-]{7,}$/;
function parse(config = {}) {
  const rescued = new Map();
  const args = rest.map((a) => {
    if (ID_LIKE.test(a)) {
      const s = `\x00${rescued.size}\x00`;
      rescued.set(s, a);
      return s;
    }
    return a;
  });
  let parsed;
  try {
    parsed = parseArgs({
      args,
      // --no-variants turns a design's variants off.
      allowNegative: true,
      ...config,
      // --json/--quiet are global, but a command may redefine them (legacy
      // `publish --json <file>` adds a json surface), so config wins.
      options: {
        json: { type: "boolean" },
        quiet: { type: "boolean" },
        ...config.options,
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (err) {
    if (!String(err?.code).startsWith("ERR_PARSE_ARGS")) throw err;
    fail(`${err.message.split(". ")[0]} — run "mockpit help"`);
  }
  if (parsed.values.help) printAndExit(COMMAND_HELP[cmd] ?? HELP);
  const restore = (v) => (typeof v === "string" && rescued.has(v) ? rescued.get(v) : v);
  if (parsed.positionals) parsed.positionals = parsed.positionals.map(restore);
  if (parsed.tokens) {
    parsed.tokens = parsed.tokens.map((t) =>
      t.kind === "positional" && rescued.has(t.value) ? { ...t, value: rescued.get(t.value) } : t,
    );
  }
  for (const k of Object.keys(parsed.values ?? {})) {
    const v = parsed.values[k];
    parsed.values[k] = Array.isArray(v) ? v.map(restore) : restore(v);
  }
  return parsed;
}

// Development checkouts run TypeScript directly (Node strips types), but Node
// refuses to type-strip files under node_modules — installed packages ship
// compiled JS in dist/ (built on prepack) and must use it.
function entrypoint(...parts) {
  const built = join(ROOT, "dist", ...parts).replace(/\.ts$/, ".js");
  return existsSync(built) ? built : join(ROOT, ...parts);
}

const commands = {
  async serve() {
    const { values: flags } = parse({
      options: {
        port: { type: "string" },
        host: { type: "string" },
        open: { type: "boolean" },
      },
    });
    const port = flags.port ?? process.env.PORT ?? "8228";
    const host = flags.host ?? process.env.MOCKPIT_HOST;
    const child = spawn(process.execPath, [entrypoint("server", "index.ts")], {
      stdio: "inherit",
      env: { ...process.env, PORT: port, ...(host ? { MOCKPIT_HOST: host } : {}) },
    });
    if (flags.open) {
      const url = serveUrl(host, port);
      const { opener, openerArgs } =
        process.platform === "darwin"
          ? { opener: "open", openerArgs: [url] }
          : process.platform === "win32"
            ? { opener: "cmd", openerArgs: ["/c", "start", url] }
            : { opener: "xdg-open", openerArgs: [url] };
      setTimeout(() => spawn(opener, openerArgs, { stdio: "ignore" }), 700);
    }
    child.on("exit", (code) => process.exit(code ?? 0));
  },

  async mcp() {
    parse();
    const child = spawn(process.execPath, [entrypoint("mcp", "server.ts")], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => process.exit(code ?? 0));
  },

  // Read the repo's tokens and kit once into the project's system, and leave a
  // starter file behind — so every later publish is markup only, with no CSS or
  // icon paths pasted into the agent's context.
  async init() {
    const { values: flags } = parse({
      options: {
        project: { type: "string" },
        kit: { type: "string" },
        "kit-url": { type: "string" },
        "kit-script": { type: "string" },
        "kit-doc": { type: "string" },
      },
    });
    const { name: project, source } = resolveProject(flags);
    const say = (label, text) => {
      if (!flags.quiet && !flags.json) console.log(`${label.padEnd(8)} ${text}`);
    };
    const { detectDesignSystem, detectIconSets, renderStarter } = await import("./initDesign.js");
    say("project:", `${project} (from ${source})`);

    const designSystem = await detectDesignSystem(process.cwd());
    const d = designSystem.detected;
    // `detected` is always an object, so emptiness has to be read off the
    // fields — otherwise a repo with nothing to read printed a blank line.
    const stripped = designSystem.strippedImports?.length
      ? ` (stripped: ${designSystem.strippedImports.join(", ")})`
      : "";
    const found = [
      d?.tailwind &&
        (designSystem.tailwindSource
          ? `tailwind: ${designSystem.tailwindSource}${stripped}`
          : "tailwind"),
      d?.shadcn && "shadcn",
      d?.cssVars
        ? `${d.cssVars} css vars${designSystem.source ? ` from ${designSystem.source}` : ""}`
        : null,
      d?.fonts?.length ? `fonts ${d.fonts.join(", ")}` : null,
    ].filter(Boolean);
    say(
      "design:",
      found.length ? found.join(" · ") : "nothing detected — using the built-in palette",
    );
    let kit = flags.kit ?? designSystem.kit ?? "builtin";
    // A project kit goes in the same write, so the system can name it as default.
    let projectKits;
    if (flags["kit-url"] !== undefined) {
      kit = flags.kit ?? "project";
      projectKits = [
        {
          id: kit,
          href: flags["kit-url"],
          script: flags["kit-script"],
          doc: readKitDoc(flags["kit-doc"]),
        },
      ];
    }
    say("kit:", kit);
    const files = designSystem.designFiles;
    if (files) {
      const sh = files.shadcn;
      say(
        "files:",
        [
          files.designMd && "DESIGN.md",
          files.tokens && `${files.tokens.count} tokens`,
          sh && `shadcn${sh.style ? ` ${sh.style}` : ""} (${sh.components.length} components)`,
        ]
          .filter(Boolean)
          .join(" · "),
      );
    }

    const wrote = await api(`${projectPath(project)}/system`, {
      method: "PUT",
      body: JSON.stringify({
        repo: {
          detected: designSystem.detected ?? null,
          cssVars: designSystem.cssVars ?? "",
          tailwindCss: designSystem.tailwindCss ?? "",
          strippedImports: designSystem.strippedImports ?? [],
          designFiles: designSystem.designFiles ?? null,
        },
        kit,
        ...(projectKits ? { projectKits } : {}),
      }),
    });
    if (wrote?.changed?.length) {
      const session = await resolveSession(flags);
      if (session) retakeStills(project, session);
    }
    const derived = wrote?.derived;
    if (derived) {
      say(
        "system:",
        [
          `r${wrote.rev}`,
          derived.roles
            ? `${derived.roles} colour role${derived.roles === 1 ? "" : "s"} (palette repo)`
            : null,
          derived.tokens
            ? `${derived.tokens} token${derived.tokens === 1 ? "" : "s"}, repo-owned`
            : null,
          derived.untyped?.length
            ? `${derived.untyped.length} untyped, from the raw block only`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
      );
    }
    let stored = await api(`${projectPath(project)}/system`);

    // Sets the repo already uses are added the same way `icons add` does; one
    // that cannot be fetched (offline) is reported, never fatal to init.
    const usedSets = detectIconSets(process.cwd());
    const wanted = usedSets.filter((f) => !BUNDLED_ICON_SETS.includes(f.prefix));
    for (const f of usedSets) {
      if (BUNDLED_ICON_SETS.includes(f.prefix))
        say("icons:", `${f.prefix} (bundled, from ${f.from})`);
    }
    if (wanted.length) {
      const result = await installIconSets(
        project,
        wanted.map((f) => f.prefix),
      );
      for (const f of wanted) {
        const added = result.added.find((a) => a.prefix === f.prefix);
        const error = result.errors.find((e) => e.prefix === f.prefix);
        if (added) say("icons:", `${f.prefix} (${added.count} icons, from ${f.from})`);
        else say("icons:", `${f.prefix} not added: ${error?.message ?? "unknown error"}`);
      }
      if (result.system) stored = result.system;
    }
    const iconSets = [
      ...new Set([...(stored?.iconSets ?? []).map((s) => s.prefix), ...BUNDLED_ICON_SETS]),
    ];
    say("icons:", `${iconSets.join(", ")} available, as <i icon="prefix:name"></i>`);

    const starter = join(process.cwd(), ".mockpit", "starter.html");
    mkdirSync(dirname(starter), { recursive: true });
    writeFileSync(starter, renderStarter({ ...designSystem, kit }, iconSets));
    say("wrote:", ".mockpit/starter.html");
    if (ignoreMockpitDir()) say("wrote:", ".gitignore (+ .mockpit/, keeping .mockpit/rules.md)");
    const rulesFile = join(repoRoot(), ".mockpit", "rules.md");
    if (existsSync(rulesFile)) {
      say("rules:", rulesSummary(await sendRules(rulesFile, `${projectPath(project)}/rules`)));
    }
    say("next:", "mockpit guide");
    if (flags.json) out({ project, system: stored, derived: derived ?? null, starter });
  },

  async publish() {
    await publishDesign();
  },

  async ask() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: {
        design: { type: "string" },
        project: { type: "string" },
        session: { type: "string" },
        option: { type: "string", multiple: true },
        recommend: { type: "string" },
        scope: { type: "string" },
        state: { type: "string" },
        states: { type: "string", multiple: true },
        part: { type: "string" },
        multi: { type: "boolean" },
        id: { type: "string" },
        after: { type: "string" },
        asks: { type: "string" },
      },
    });
    const slug = requireDesign(
      flags,
      'mockpit ask --design writer "Quiet or dark?" --option Quiet=quiet',
    );
    let asks;
    if (flags.asks !== undefined) {
      if (positionals.length > 0) {
        die(
          "use the question or --asks, not both",
          `mockpit ask --design ${slug} --asks <json|file>`,
        );
      }
      asks = readJsonFlag("asks", flags.asks);
      if (!Array.isArray(asks)) asks = [asks];
    } else {
      const text = positionals.join(" ").trim();
      if (!text)
        die(
          "ask needs a question",
          `mockpit ask --design ${slug} "Quiet or dark?" --option Quiet=quiet`,
        );
      const options = (flags.option ?? []).map(parseOption);
      if (options.length === 0) {
        die(
          "ask needs options",
          `mockpit ask --design ${slug} "${text}" --option Quiet=quiet --option Dark=dark`,
        );
      }
      if (flags.recommend !== undefined) {
        const pick = options.find(
          (o) => o.label.toLowerCase() === flags.recommend.trim().toLowerCase(),
        );
        if (!pick)
          die(
            `--recommend "${flags.recommend}" names no option`,
            `mockpit ask --design ${slug} "${text}" --option Quiet=quiet --option Dark=dark --recommend Quiet`,
          );
        pick.recommended = true;
      }
      asks = [
        {
          text,
          options,
          ...(flags.id && { id: flags.id }),
          ...(flags.scope && { scope: flags.scope }),
          ...(flags.state && { state: flags.state }),
          ...(flags.states && { states: flags.states }),
          ...(flags.part && { part: flags.part }),
          ...(flags.multi && { multi: true }),
          ...(flags.after && { after: flags.after }),
        },
      ];
    }
    const session = await resolveSession(flags);
    const result = await api(
      `${designPath(slug)}/asks`,
      {
        method: "POST",
        body: JSON.stringify({
          project: resolveProject(flags).name,
          session: session ?? undefined,
          asks,
        }),
      },
      { report: "die", fix: `mockpit read ${slug}` },
    );
    if (flags.json) return out(result);
    if (flags.quiet) return;
    for (const ask of result.asks) {
      console.log(
        `asked on ${result.design}: ${ask.text} [${ask.options.map((o) => o.label).join(" | ")}]`,
      );
    }
    for (const nudge of result.nudges ?? []) console.log(`nudge: ${nudge}`);
    console.log(`tell the user to look at ${result.url}, then end your turn`);
    printFeedback(result.feedback);
  },

  // Metadata by default. Bodies and version rows are opt-in, because a full
  // alternative with its history is the biggest thing an agent can pull into context.
  async read() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: {
        project: { type: "string" },
        body: { type: "boolean" },
        history: { type: "boolean" },
        tree: { type: "boolean" },
        decisions: { type: "boolean" },
        area: { type: "string" },
      },
    });
    const project = resolveProject(flags).name;
    if (positionals.length > 1) die("read takes one design slug", "mockpit read writer");
    if (flags.area !== undefined) {
      if (positionals.length) die("--area reads an area, not a design", "mockpit read --area Food");
      return out(
        await api(
          `/api/projects/${encodeURIComponent(project)}/areas/${encodeURIComponent(flags.area)}`,
          {},
          { report: "die", fix: `mockpit read --project ${project}` },
        ),
      );
    }
    if (flags.decisions) {
      return out(
        await api(
          `/api/projects/${encodeURIComponent(project)}/decisions`,
          {},
          { report: "die", fix: `mockpit read --project ${project}` },
        ),
      );
    }
    if (flags.tree) {
      return out(
        await api(
          `/api/projects/${encodeURIComponent(project)}/tree`,
          {},
          { report: "die", fix: `mockpit read --project ${project}` },
        ),
      );
    }
    if (positionals.length === 1) {
      const slug = slugify(positionals[0]);
      return out(
        await api(
          `${designPath(slug)}${query({ project, body: flags.body, history: flags.history })}`,
          {},
          { report: "die", fix: `mockpit read --project ${project}` },
        ),
      );
    }
    const list = (await apiSoft(`/api/designs${query({ project })}`)) ?? {
      designs: [],
      open: 0,
      pending: [],
    };
    if (flags.json) return out(list);
    if (flags.quiet) return;
    const designs = list.designs ?? [];
    console.log(
      `${project} · ${designs.length} design${designs.length === 1 ? "" : "s"}` +
        (list.open
          ? ` · ${list.open} open question${list.open === 1 ? "" : "s"}`
          : " · nothing waiting on the user"),
    );
    if (list.system) console.log(`  system ${list.system}`);
    // A variants design's entries all ship: the count says variants.
    const entries = (m) => {
      const [n, word] =
        m.variants === undefined ? [m.alternatives, "alternative"] : [m.variants, "variant"];
      return `${n} ${word}${n === 1 ? "" : "s"}`;
    };
    for (const m of designs) {
      const states = m.states.length ? m.states.join(" / ") : "single state";
      console.log(
        `  ${m.slug} · ${m.kind}${m.area ? ` · ${m.area}` : ""} · ${states} · ${entries(m)}${m.planned ? " · planned" : ""}${m.archivedAt ? " · archived" : m.open ? ` · ${m.open} open` : ""}`,
      );
    }
    for (const flow of list.flows ?? []) console.log(`  ${flowLine(flow)}`);
    for (const line of pendingLines(list.pending)) console.log(line);
    if (list.decisionList) {
      console.log(
        `Decided, ${list.decisionList.total}. Treat as settled unless the user says otherwise:`,
      );
      for (const d of list.decisionList.lines)
        console.log(`  ${d.system ? "project" : d.design}: ${d.text}`);
      if (list.decisionList.more) console.log(`  ${list.decisionList.more} (--decisions)`);
    }
  },
  async export() {
    const { values: flags } = parse({
      options: {
        design: { type: "string" },
        state: { type: "string" },
        alternative: { type: "string" },
        variant: { type: "string" },
        project: { type: "string" },
        out: { type: "string" },
      },
    });
    if (!flags.design) return exportSystem(flags);
    const slug = requireDesign(flags, "mockpit export --design writer");
    const project = resolveProject(flags).name;
    const data = await api(
      `${designPath(slug)}/export${query({ project, state: flags.state, alternative: flags.alternative, variant: flags.variant })}`,
      {},
      { report: "die", fix: `mockpit read ${slug}` },
    );
    if (flags.json) return out(data);
    const root = join(flags.out ? flags.out : join(process.cwd(), ".mockpit", "accepted"), slug);
    // A screen or a component: what a build plan points at, beside its states.
    if (data.ready !== undefined) {
      mkdirSync(root, { recursive: true });
      const { ready, changed, spec, builtFrom } = data;
      writeFileSync(
        join(root, "design.json"),
        JSON.stringify({ project, design: slug, ready, changed, spec, builtFrom }, null, 2) + "\n",
      );
      if (!flags.quiet) {
        console.log(
          `${slug} · ${ready ? (changed ? "Changed since Ready" : "Ready") : "in design"} · ${builtFrom.length} instances → ${join(root, "design.json")}`,
        );
      }
    }
    // A screen or a component hands over every entry of a state, so each is named by its
    // alternative beside its siblings; an idea's one entry a state stays index.html. Two
    // alternative names can normalise to one file name ("A B", "A-B"): then every file of
    // those entries carries the start of its post id, which is stable, so none is lost.
    const product = data.ready !== undefined;
    const base = (entry) => slugify(entry.alternative ?? entry.variant) || "entry";
    const taken = new Map();
    for (const entry of data.states) {
      const key = `${entry.state ?? ""}\n${base(entry)}`;
      taken.set(key, (taken.get(key) ?? 0) + 1);
    }
    const stem = (entry) =>
      taken.get(`${entry.state ?? ""}\n${base(entry)}`) > 1
        ? `${base(entry)}-${entry.postId.slice(0, 6)}`
        : base(entry);
    for (const entry of data.states) {
      const dir = join(root, entry.state === null ? "default" : slugify(entry.state));
      const name = (file) => (product ? `${stem(entry)}.${file}` : file);
      const page = join(dir, product ? name("html") : "index.html");
      mkdirSync(dir, { recursive: true });
      writeFileSync(page, entry.html ?? "");
      // The state with every swap, when the html is the composed choice.
      if (entry.allSwaps) writeFileSync(join(dir, name("all-swaps.html")), entry.allSwaps);
      const decided = data.decisions?.states?.[entry.state ?? ""];
      if (decided) {
        writeFileSync(
          join(dir, "decisions.json"),
          JSON.stringify({ ...decided, knobs: data.decisions.knobs }, null, 2) + "\n",
        );
      }
      writeFileSync(
        join(dir, name("history.json")),
        JSON.stringify(
          {
            project,
            design: slug,
            state: entry.state,
            alternative: entry.alternative,
            variant: entry.variant,
            version: entry.version,
            status: entry.status,
            history: entry.history,
            ...(entry.screenshotUrl && { screenshotUrl: entry.screenshotUrl }),
            ...(data.reply && { tuned: data.reply.tuned }),
          },
          null,
          2,
        ) + "\n",
      );
      if (!flags.quiet) {
        const files = [page, ...(entry.allSwaps ? [join(dir, name("all-swaps.html"))] : [])];
        console.log(
          `${slug}/${stateLabel(entry.state)}${entry.alternative ?? entry.variant} v${entry.version} → ${files.join(", ")} (+ ${name("history.json")})`,
        );
      }
    }
    // A version the Ready mark records that history no longer holds: said, not replaced.
    for (const c of data.missing ?? []) {
      console.error(
        `${slug}/${stateLabel(c.state)}${c.name} v${c.version}: marked Ready, and that version is gone`,
      );
    }
  },

  async run() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: {
        session: { type: "string" },
        project: { type: "string" },
        agent: { type: "string" },
      },
    });
    if (positionals.length !== 1)
      die("run needs one script", "mockpit run loop.js (- reads stdin)");
    const code = readContent(positionals[0]);
    const session = await resolveSession(flags, { create: true });
    const result = await api(
      "/api/run",
      {
        method: "POST",
        body: JSON.stringify({
          code,
          session,
          project: resolveProject(flags).name,
          agent: agentName(flags),
        }),
      },
      { report: "die" },
    );
    if (flags.json) out(result);
    else if (!flags.quiet) printRun(result);
    if (!result.ok) process.exit(2);
  },

  // Never waits: the server reads from the session's cursor, shared with watch
  // and piggyback, so each Send is delivered exactly once.
  async feedback() {
    const { values: flags } = parse({
      options: { session: { type: "string" }, project: { type: "string" } },
    });
    const session = await resolveSession(flags, { create: true });
    const result = await api(
      `/api/feedback${query({ session, project: resolveProject(flags).name })}`,
      {},
      { report: "die" },
    );
    if (!flags.quiet) out(result);
  },
  async watch() {
    const { values: flags } = parse({
      options: {
        session: { type: "string" },
        after: { type: "string" },
        once: { type: "boolean" },
        "exit-code": { type: "string" },
      },
    });
    if (flags.after !== undefined && !/^\d+$/.test(flags.after)) {
      fail(`--after must be a number (got "${flags.after}")`);
    }
    const exitCode = flags["exit-code"] ?? "0";
    if (!/^\d+$/.test(exitCode)) fail(`--exit-code must be a number (got "${exitCode}")`);
    // A waiter outliving its agent would take a Send and tell no one, and each
    // Send is delivered only once.
    if (flags.once) {
      const parent = process.ppid;
      setInterval(() => {
        if (process.ppid !== parent || process.ppid === 1) process.exit(0);
      }, 5000).unref();
    }
    // /clear keeps the Claude Code process, so the check above never fires for the
    // conversation it ended. Its watcher would hold the old session "listening",
    // which keeps a Send there instead of handing it to whoever listens now, and
    // would wake the new conversation with a reply its feedback can't take.
    const conversation =
      !flags.session && !process.env.MOCKPIT_SESSION && !process.env.MOCKPIT_SESSION_KEY
        ? process.env.CLAUDE_CODE_SESSION_ID
        : undefined;
    if (conversation) {
      setInterval(() => {
        const current = currentClaudeSession();
        if (current && current !== conversation) process.exit(0);
      }, 5000).unref();
    }
    // A continuous long-poll that streams each piece of feedback as one line —
    // one line is one monitor notification. It re-arms forever; a transient
    // network error backs off and retries rather than exiting.
    //
    // It only says a reply landed (peek): the reply stays on the session's cursor
    // until the agent's feedback or next write takes it, so a harness dropping or
    // cutting this output can't lose it, and each Send is still delivered once.
    let firstAfter = flags.after;
    for (;;) {
      const key = harnessKey();
      // The state file is per process and cwd, which several threads of one harness
      // can share, so a conversation's own key decides whenever there is one.
      const session =
        flags.session ??
        process.env.MOCKPIT_SESSION ??
        (key
          ? await resolveSessionByKey(key)
          : ((await resolveSession(flags)) ?? (await resolveSessionByCwd())));
      if (!session) {
        // A conversation that hasn't used mockpit yet may never; ask rarely.
        await sleep(key ? 10_000 : 2000);
        continue;
      }
      let result;
      try {
        const res = await fetch(
          `${BASE}/api/comments${query({ session, author: "user", after: firstAfter, wait: 60, peek: 1 })}`,
          { headers: HEADERS },
        );
        if (!res.ok) {
          await sleep(2000);
          continue;
        }
        result = await res.json();
      } catch {
        await sleep(2000);
        continue;
      }
      firstAfter = undefined;
      const lines = (result.feedback ?? []).flatMap(watchLines);
      for (const line of lines) console.log(line);
      if (flags.once && lines.length) {
        // A harness may frame this output as a hook failure, so it says what it is.
        console.log(
          "This is the user's reply from the mockpit viewer, not an error. Call mockpit's feedback for all of it.",
        );
        process.exit(Number(exitCode));
      }
    }
  },

  async say() {
    const { values: flags, positionals } = parse({ allowPositionals: true, options: DESIGN_FLAGS });
    const text = positionals.join(" ").trim();
    if (!text) die("say needs text", 'mockpit say "…" --design writer');
    const slug = requireDesign(flags, `mockpit say "${text}" --design writer`);
    const session = await resolveSession(flags);
    const result = await api(
      `${designPath(slug)}/say`,
      {
        method: "POST",
        body: JSON.stringify({
          message: text,
          state: flags.state,
          alternative: flags.alternative,
          variant: flags.variant,
          project: resolveProject(flags).name,
          session: session ?? undefined,
        }),
      },
      { report: "die", fix: `mockpit read ${slug}` },
    );
    if (flags.json) return out(result);
    if (flags.quiet) return;
    console.log(`said on ${slug}`);
    printFeedback(result.feedback);
  },
  async move() {
    const { values: flags } = parse({
      options: {
        ...DESIGN_FLAGS,
        alternative: { type: "string", multiple: true },
        variant: { type: "string", multiple: true },
        to: { type: "string" },
        "to-state": { type: "string" },
        archive: { type: "boolean" },
        restore: { type: "boolean" },
        "hide-older": { type: "boolean" },
        "delete-older": { type: "boolean" },
      },
    });
    const example = "mockpit move --design writer --alternative quiet --archive";
    const slug = requireDesign(flags, example);
    const tidying = flags["hide-older"] || flags["delete-older"];
    if (!flags.alternative?.length && !flags.variant?.length && !tidying) {
      die("move needs --alternative (--variant on a variants design)", example);
    }
    const session = await resolveSession(flags);
    const result = await api(
      `${designPath(slug)}/move`,
      {
        method: "POST",
        body: JSON.stringify({
          state: flags.state,
          alternatives: flags.alternative,
          variants: flags.variant,
          to: flags.to,
          toState: flags["to-state"],
          archive: flags.archive,
          restore: flags.restore,
          hideOlder: flags["hide-older"],
          deleteOlder: flags["delete-older"],
          project: resolveProject(flags).name,
          session: session ?? undefined,
        }),
      },
      { report: "die", fix: `mockpit read ${slug}` },
    );
    if (flags.json) return out(result);
    if (flags.quiet) return;
    if (tidying) {
      const verb = flags["delete-older"] ? "deleted" : "hid";
      console.log(`${verb} ${result.versions.length} older versions`);
      for (const s of result.skipped) {
        const which = s.version ? ` v${s.version}` : "";
        console.log(`stayed: ${s.state ? `${s.state}/` : ""}${s.alternative}${which} (${s.why})`);
      }
      printFeedback(result.feedback);
      return;
    }
    const names = result.alternatives.map((v) => v.alternative).join(", ") || "nothing";
    const done = result.to
      ? `moved to ${result.to.design}`
      : flags.restore
        ? "restored"
        : "archived";
    console.log(`${done}: ${names}`);
    for (const s of result.skipped) console.log(`stayed: ${s.alternative} (${s.why})`);
    printFeedback(result.feedback);
  },
  async edit() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: {
        design: { type: "string" },
        project: { type: "string" },
        session: { type: "string" },
        slug: { type: "string" },
        title: { type: "string" },
        kind: { type: "string" },
        area: { type: "string" },
        group: { type: "string" },
        variants: { type: "boolean" },
        source: { type: "string" },
        "first-state": { type: "string" },
        purpose: { type: "string" },
        behaviour: { type: "string" },
        state: { type: "string" },
        part: { type: "string" },
        rename: { type: "string" },
        areas: { type: "string" },
        description: { type: "string" },
      },
    });
    // `edit receipt --area ''` names the design as --design does.
    if (positionals.length > 1) die("edit takes one design", "mockpit edit --help");
    if (positionals[0] !== undefined) {
      if (flags.design !== undefined && slugify(flags.design) !== slugify(positionals[0])) {
        die("name the design once", `mockpit edit ${positionals[0]} --area Shell`);
      }
      flags.design = positionals[0];
    }
    const project = resolveProject(flags).name;
    const session = (await resolveSession(flags)) ?? undefined;
    const areas = flags.areas;
    if (flags.rename !== undefined || areas !== undefined || flags.description !== undefined) {
      if (flags.design) {
        die(
          "--rename, --areas and --description edit the project (with --area, that area); edit the design without them",
          "mockpit edit --help",
        );
      }
      if (flags.rename !== undefined && !flags.rename.trim()) {
        die("--rename needs the new name", `mockpit edit --rename <name>`);
      }
      const result = await api(
        projectPath(project),
        {
          method: "PATCH",
          body: JSON.stringify({
            name: flags.rename,
            ...(areas === undefined ? {} : { areas: areas ? areas.split(",") : [] }),
            ...(flags.description === undefined
              ? {}
              : { description: flags.description, area: flags.area }),
            session,
          }),
        },
        { report: "die", fix: "mockpit read" },
      );
      if (flags.json) return out(result);
      if (flags.quiet) return;
      if (areas !== undefined && result.areas) {
        const ordered = result.areas.filter((a) => !a.alphabetical).map((a) => a.name);
        console.log(
          `area order ${ordered.length ? ordered.join(", ") : "alphabetical"} · ${result.url}`,
        );
      }
      if (result.description) {
        const what = result.area ? `area ${result.area}` : `project ${result.project}`;
        console.log(
          result.description.applied
            ? `${what}: description saved · ${result.url}`
            : `${what}: description NOT applied, the user's stands: ${result.description.text}`,
        );
      }
      for (const nudge of result.nudges ?? []) console.log(`nudge: ${nudge}`);
      if (!result.renamed) return printFeedback(result.feedback);
      console.log(
        `renamed project ${result.renamed.from} → ${result.renamed.to} · ${result.designs} design${result.designs === 1 ? "" : "s"} · ${result.url}`,
      );
      if (!flags.project && !process.env.MOCKPIT_PROJECT) {
        console.log(
          `note: this repo still resolves to "${project}"; pass --project ${shq(result.project)} or set MOCKPIT_PROJECT`,
        );
      }
      printFeedback(result.feedback);
      return;
    }
    const slug = requireDesign(flags, "mockpit edit --design writer --area Shell");
    const fields = [
      "slug",
      "title",
      "kind",
      "area",
      "group",
      "variants",
      "source",
      "purpose",
    ].filter((k) => flags[k] !== undefined);
    if (!fields.length && flags["first-state"] === undefined && flags.behaviour === undefined) {
      die(
        "edit needs --slug, --title, --kind, --area, --group, --variants, --source, --purpose, --behaviour or --first-state",
        "mockpit edit --help",
      );
    }
    if ((flags.state !== undefined || flags.part !== undefined) && flags.behaviour === undefined) {
      die(
        "--state and --part place a --behaviour line",
        `mockpit edit ${slug} --behaviour "…" --state Now`,
      );
    }
    const behaviour =
      flags.behaviour === undefined ? undefined : await behaviourLines(slug, project, flags);
    const result = await api(
      designPath(slug),
      {
        method: "PATCH",
        body: JSON.stringify({
          project,
          session,
          ...Object.fromEntries(fields.map((k) => [k, flags[k]])),
          ...(behaviour === undefined ? {} : { behaviour }),
          firstState: flags["first-state"],
        }),
      },
      { report: "die", fix: `mockpit read ${slug}` },
    );
    if (flags.json) return out(result);
    if (flags.quiet) return;
    const m = result.design;
    console.log(
      [
        result.renamed ? `${result.renamed.from} → ${m.slug}` : m.slug,
        m.kind,
        m.kind === "component" && !m.area ? "shared" : m.area && `area ${m.area}`,
        m.group && `group ${m.group}`,
        m.variants && "variants",
        m.source && `source ${m.source}`,
        result.spec?.purpose &&
          (result.spec.purpose.applied ? "purpose saved" : "purpose NOT applied"),
        result.spec?.behaviour &&
          (result.spec.behaviour.applied ? "behaviour saved" : "behaviour NOT applied"),
        result.url,
      ]
        .filter(Boolean)
        .join(" · "),
    );
    for (const nudge of result.nudges ?? []) console.log(`nudge: ${nudge}`);
    if (result.spec?.purpose && !result.spec.purpose.applied) {
      console.log(`what it is for, as the user wrote it: ${result.spec.purpose.text}`);
    }
    if (result.spec?.behaviour && !result.spec.behaviour.applied) {
      console.log("how it works, as the user wrote it:");
      for (const l of result.spec.behaviour.lines ?? []) console.log(`  ${specLineText(l)}`);
    }
    printFeedback(result.feedback);
  },
  async demo() {
    parse();
    const { DEMO } = await import("./demoData.js");
    // The demo goes in through the same path an agent uses: one session, one
    // publish per (state, alternative), then the asks.
    const session = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ agent: DEMO.agent, title: DEMO.sessionTitle, project: DEMO.project }),
    });
    for (const state of DEMO.states) {
      for (const alternative of DEMO.alternatives) {
        await api("/api/designs", {
          method: "POST",
          body: JSON.stringify({
            session: session.id,
            project: DEMO.project,
            design: DEMO.slug,
            kind: "screen",
            title: DEMO.title,
            state: state.label,
            alternative: alternative.name,
            knobs: DEMO.knobs,
            surfaces: [{ kind: "html", html: DEMO.render(state, alternative) }],
          }),
        });
      }
    }
    await api(`${designPath(DEMO.slug)}/asks`, {
      method: "POST",
      body: JSON.stringify({ project: DEMO.project, session: session.id, asks: DEMO.asks }),
    });
    console.log(
      `Seeded ${DEMO.project} › ${DEMO.title} (${DEMO.states.length} states × ${DEMO.alternatives.length} alternatives) — open ${BASE}/project/${encodeURIComponent(DEMO.project)}/${DEMO.slug}`,
    );
  },

  async upload() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: { session: { type: "string" }, kind: { type: "string" } },
    });
    const file = positionals[0];
    if (!file || file === "-") fail("usage: mockpit upload <file> [--kind k] [--session id]");
    const session = flags.session ?? (await resolveSession(flags, { create: true }));
    const asset = await uploadFile(file, { session, kind: flags.kind });
    out(asset);
  },

  // Print the URL a file WILL have once uploaded, derived from its content hash
  // alone — no server call. Lets you write an <img src> (or reference the id)
  // before, or in parallel with, the upload. Matches the server's hashAssetId.
  async "asset-url"() {
    const { positionals } = parse({ allowPositionals: true, options: {} });
    const file = positionals[0];
    if (!file || file === "-") fail("usage: mockpit asset-url <file>");
    const id = createHash("sha256").update(readFileSync(file)).digest("hex");
    out({ id, url: `${BASE}/a/${id}` });
  },

  // List the opt-in html kits this workspace offers (id, label, summary, classes).
  // Pair with `publish --kit <id>` to inject a kit's CSS/JS into an html surface.
  async icons() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: { project: { type: "string" } },
    });
    const [sub = "list", ...sets] = positionals;
    const { name: project } = resolveProject(flags);
    if (sub === "list") {
      const { sets: rows } = await api(`${projectPath(project)}/icons`);
      if (flags.json) return out(rows);
      if (flags.quiet) return;
      for (const r of rows)
        console.log(`${r.prefix.padEnd(16)} ${String(r.count).padStart(6)}  ${r.source}`);
      return;
    }
    if (sets.length === 0) fail(`usage: mockpit icons ${sub} <set> [<set>...]`);
    if (sub === "add") {
      const result = await installIconSets(project, sets);
      if (result.errors.length) fail(result.errors.map((e) => e.message).join("; "));
      if (flags.json) return out(result.system);
      for (const a of result.added) {
        if (!flags.quiet) console.log(`added ${a.prefix} (${a.count} icons)`);
      }
      return;
    }
    if (sub === "remove") {
      const stored = await api(`${projectPath(project)}/system`);
      const installed = stored?.iconSets ?? [];
      for (const set of sets) {
        if (installed.some((s) => s.prefix === set)) continue;
        fail(
          BUNDLED_ICON_SETS.includes(set)
            ? `${set} is bundled with the server and cannot be removed`
            : `${set} is not installed for ${project}`,
        );
      }
      const result = await api(`${projectPath(project)}/system`, {
        method: "PUT",
        body: JSON.stringify({ iconSets: installed.filter((s) => !sets.includes(s.prefix)) }),
      });
      if (flags.json) return out(result);
      if (!flags.quiet) console.log(`removed ${sets.join(", ")}`);
      return;
    }
    fail(`unknown icons command "${sub}" — run "mockpit icons --help"`);
  },

  async kits() {
    const { values: flags } = parse({ options: { project: { type: "string" } } });
    const { name: project } = resolveProject(flags);
    out(await api(`/api/kits?${new URLSearchParams({ project })}`));
  },

  async kit() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: {
        project: { type: "string" },
        url: { type: "string" },
        script: { type: "string" },
        doc: { type: "string" },
      },
    });
    const [sub, id] = positionals;
    const { name: project } = resolveProject(flags);
    if ((sub !== "add" && sub !== "remove") || !id)
      fail("usage: mockpit kit add <id> --url <url> --doc <file|text> | mockpit kit remove <id>");
    const result =
      sub === "add"
        ? await putProjectKit(project, id, flags)
        : await api(`${projectPath(project)}/system`, {
            method: "PUT",
            body: JSON.stringify({ removeKits: [id] }),
          });
    if (flags.json) return out(result);
    if (!flags.quiet) console.log(`${sub === "add" ? "added" : "removed"} kit ${id} (${project})`);
  },

  // The project's system: no flags reads it, any flag writes that part.
  async system() {
    const JSON_FLAGS = [
      "classes",
      "fonts",
      "tokens",
      "scales",
      "roles",
      "palettes",
      "pairs",
      "as",
      "knobs",
      "remove",
    ];
    const { values: flags } = parse({
      options: {
        project: { type: "string" },
        session: { type: "string" },
        sheet: { type: "string" },
        restore: { type: "string" },
        ...Object.fromEntries(JSON_FLAGS.map((f) => [f, { type: "string" }])),
      },
    });
    const project = resolveProject(flags).name;
    const body = {};
    if (flags.sheet !== undefined) {
      // CSS text has a block; anything else is a path, which must be a file.
      const sheet = flags.sheet;
      if (sheet === "") body.sheet = null;
      else if (sheet.includes("{")) body.sheet = sheet;
      else if (!existsSync(sheet))
        die(`--sheet: no file at ${sheet}`, "mockpit system --sheet sheet.css");
      else if (!statSync(sheet).isFile())
        die(`--sheet: ${sheet} is not a file`, "mockpit system --sheet sheet.css");
      else body.sheet = readFileSync(sheet, "utf8");
    }
    for (const f of JSON_FLAGS) {
      if (flags[f] === undefined) continue;
      const raw = existsSync(flags[f]) ? readFileSync(flags[f], "utf8") : flags[f];
      try {
        body[f] = JSON.parse(raw);
      } catch {
        die(`--${f} must be JSON (or a JSON file)`, `mockpit guide --topic system`);
      }
    }
    if (flags.restore !== undefined) body.restore = Number(flags.restore);
    if (Object.keys(body).length === 0) {
      const system = await api(`${projectPath(project)}/system`, {}, { report: "die" });
      if (flags.json || !process.stdout.isTTY) return out(system);
      printSystem(system);
      return;
    }
    const session = (await resolveSession(flags, { create: true })) ?? undefined;
    const result = await api(
      `${projectPath(project)}/system`,
      { method: "PUT", body: JSON.stringify({ ...body, session }) },
      { report: "die", fix: "mockpit guide --topic system" },
    );
    if (result.changed?.length) retakeStills(project, session);
    if (flags.json) return out(result);
    if (flags.quiet) return;
    console.log(
      result.changed?.length
        ? `r${result.rev}: ${result.changed.join("; ")}`
        : `r${result.rev}: nothing changed`,
    );
    for (const c of result.checks ?? []) console.log(`check: ${c}`);
    console.log(result.url);
    printFeedback(result.feedback);
  },

  async guide() {
    const { values: flags } = parse({
      options: { topic: { type: "string" }, project: { type: "string" } },
    });
    if (flags.topic !== undefined) return printTopic(flags.topic, flags);
    return printBrief(flags);
  },

  // A rules file is the user's or the project's own guidance on top of the
  // core brief; the brief prints it, so this only has to put it on the server.
  async rules() {
    const { values: flags } = parse({
      options: { mine: { type: "boolean" }, project: { type: "string" } },
    });
    const mine = !!flags.mine;
    const file = mine ? myRulesFile() : join(repoRoot(), ".mockpit", "rules.md");
    const project = mine ? null : resolveProject(flags).name;
    const result = await sendRules(file, mine ? "/api/rules" : `${projectPath(project)}/rules`);
    if (flags.json) return out(result);
    if (flags.quiet) return;
    const where = mine ? "your rules" : `project ${project}`;
    const from = result.missing ? `no ${file}` : file;
    console.log(`${where}: ${rulesSummary(result)} (from ${from})`);
    if (!result.missing) console.log("next:", "mockpit guide");
  },

  async setup() {
    parse();
    console.log(await fetchTextWithFallback("/setup", join(ROOT, "guide", "AGENT_SETUP.md")));
  },

  // Print the running version and check for updates (non-blocking, best-effort).
  async version() {
    parse();
    console.log(`mockpit ${PKG_VERSION}`);
    try {
      const cached = readUpdateCache();
      let latest = cached;
      if (!latest) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 3000);
        try {
          const res = await fetch("https://registry.npmjs.org/mockpit/latest", {
            signal: ctrl.signal,
          });
          clearTimeout(timer);
          if (res.ok) {
            const pkg = await res.json();
            if (typeof pkg.version === "string") {
              latest = pkg.version;
              writeUpdateCache(latest);
            }
          }
        } catch {
          // Offline / timed out — skip silently.
        }
      }
      if (latest && versionGt(latest, PKG_VERSION)) {
        console.log(`\nUpdate available: ${PKG_VERSION} → ${latest}`);
        console.log(`Run: npm install -g mockpit`);
      }
    } catch {
      // Never let the update check fail the command.
    }
  },
};

// Topics ship with the CLI, so a typo is caught, and a known topic read, with
// no server running.
const TOPICS_DIR = join(ROOT, "guide", "topics");

async function printTopic(topic, flags = {}) {
  const topics = readdirSync(TOPICS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .sort();
  if (!topics.includes(topic)) {
    die(
      `unknown topic "${topic}"; topics: ${topics.join(", ")}`,
      `mockpit guide --topic ${topics[0]}`,
    );
  }
  const path = `/agent-howto?${new URLSearchParams(
    topic === "system" ? { topic, project: resolveProject(flags).name } : { topic },
  )}`;
  console.log(await fetchTextWithFallback(path, join(TOPICS_DIR, `${topic}.md`)));
}

// The brief is rendered from the project's stored system, so the
// server's copy is the real one. With no server it still has to print: an
// agent reads it before anything else, so render the generic brief locally
// (the same code the server runs) and say where the project-aware one comes from.
async function printBrief(flags) {
  const params = new URLSearchParams({ project: resolveProject(flags).name });
  try {
    const res = await fetch(`${BASE}/agent-howto?${params}`);
    if (res.ok) return console.log(await res.text());
  } catch {}
  const { renderBriefGuide } = await import(entrypoint("server", "designGuide.ts"));
  console.log(renderBriefGuide(null));
  console.error(
    `note: no mockpit at ${BASE}; this is the generic brief. Run mockpit serve, then mockpit init for this project's system, kit and icons.`,
  );
}

async function fetchTextWithFallback(path, localFile) {
  try {
    const res = await fetch(`${BASE}${path}`);
    if (res.ok) return await res.text();
  } catch {}
  return readFileSync(localFile, "utf8");
}

if (cmd === "--version" || cmd === "-V") {
  await commands.version();
} else if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
  console.log(HELP);
} else if (commands[cmd]) {
  await commands[cmd]();
} else {
  fail(`unknown command "${cmd}" — run "mockpit help"`);
}
