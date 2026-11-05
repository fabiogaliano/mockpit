#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { findBrowser, queuePoster } from "./poster.js";
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

vocabulary: project › design › state › variant › version. A project is a repo; a
design is an idea, screen or component, by slug; a state is one thing the user sees in it ("Lab
open"); a variant is a parallel take on a state; a version is its history.
Declare the parts you want feedback on with data-part="name" in the html.

the loop (never blocks on the user):
  1. mockpit init once per repo; read the brief (mockpit guide).
  2. mockpit publish once per variant; declare parts with data-part.
  3. A choice is several variants plus one question that binds them: mockpit ask
     with options bound to variants. A variant decides everything it differs
     on; don't re-ask it. Visual options carry a variant or knob set. One
     render plus a control: --knobs.
  4. Tell the user in one line where to look, then end your turn. The question
     itself lives in the design, never in chat. The user answers in the
     browser at their own pace. Never poll.
  5. When the user says they answered (or a mockpit watch line wakes you), run
     mockpit feedback. Every write also returns feedback; read it.
  6. mockpit publish the revision; mockpit export once a variant is in use.
  In Claude Code, arm mockpit watch under Monitor after asking, then end the
  turn; elsewhere the user's next message is the wake-up.

verbs:
  mockpit init [--project name] [--kit <id>] [--kit-url <url> --kit-doc <file|text>]
                                          detect the repo's design system, store
                                          palette/kit/icon sets, write .mockpit/starter.html
  mockpit publish --design <slug> --html <file> [options]
                                          create or version one variant of one state
      --state <label>   state, in the user's words (omit for a single-state design)
      --variant <name>  variant label (default "default")
      --html <file|->   the html body (or a positional file)
      --surfaces <json|file>  instead: the full ordered surface list; {"id"}
                        alone keeps a surface, a missing id removes it
      --parts <name=file|->  instead: replace just that data-part's element in
                        the latest version (repeatable; name#key targets one instance)
      --fills <part#fill=file|->  instead: replace or add one fill of a part in
                        the latest version (repeatable)
      --title <t>       design title
      --kind <k>        screen|component, only for an app's screens (default idea);
                        with no html it plans one, drawn by a later publish
      --area <name>     where in the product it belongs ("Shell"); Home groups by it
      --source <path>   the code path that implements it
      --knobs <json|file>  knobs in tunekit usePane shape, keyed by path
      --from <N>        branch from version N
      --amend           replace the latest version in place: a fix before the
                        user has acted on it (one request, one version)
      --withdraw        take the latest version back, under the same rule
      --prompt <text>   what prompted this version
      --description <text>  one line on what this variant is, shown beside it
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
  mockpit ask --design <slug> "<question>" --option <label[=variant]> ...
                                          ask the user; bind options to variants
      --option <l[=v]>  an option (repeatable); "=variant" binds it to a variant,
                        "=variant@3" to its version 3, "=knob:path=value" sets one knob
      --recommend <l>   the option you would pick, by label; a quiet mark on it
      --scope <s>       design|state|part (default design)
      --state <label>   the state a state-scoped question is about
      --states <label>  a design-wide question: a state its answers can be seen
                        on (repeatable, best first)
      --part <name>     the part a part-scoped question is about
      --multi           allow several answers
      --id <id>         stable id; reusing one replaces that question
      --asks <json|file>  several questions at once, full shape
  mockpit read [slug] [--body] [--history] [--decisions]
                                          what the user already decided, then
                                          no slug: every design plus what the user
                                          is doing now; a slug: that design
  mockpit feedback                       what the user sent since you last heard,
                                          plus pending; returns at once
  mockpit say "<text>" --design <slug> [--state s] [--variant v]
                                          a plain-text message in a design's thread
  mockpit move --design <slug> --variant <v>... (--to <design> [--to-state s] | --archive | --restore)
                                          move variants elsewhere, archive or restore them
  mockpit edit --design <slug> [--slug s] [--title t] [--kind k] [--area a] [--source p]
                                          change a design without a new version ("" clears)
  mockpit edit --project <name> --rename <new>
                                          rename a project
  mockpit edit --project <name> --area-order "Shell,Food"
                                          the order Home lists areas in
  mockpit export --design <slug> [--state s] [--variant v] [--out <dir>]
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
  Detect the repo's design system, store palette + kit for the project, add the
  Iconify sets matching its icon packages, and write .mockpit/starter.html
  (gitignored). --kit makes a bundled or project kit the default for every html
  surface. --kit-url defines the project's own kit (id from --kit, else
  "project") and makes it the default; the doc is the cheat sheet the brief prints.`,
  rules: `mockpit rules [--project <name>]
mockpit rules --mine
  Guidance on top of the core brief, highest first: the project's
  .mockpit/rules.md (committed with the repo), your ~/.mockpit/rules.md, then
  the packs either names (\`packs: [design-craft]\` in its frontmatter). A file
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
mockpit publish --design <slug> --fills <part#fill=file|-> ... [options]
mockpit publish --design <slug> [--state s] [--variant v] --withdraw
  Creates the design, state or variant, or the next version of an existing one.
  One request gets one version: fixes to it before the user acts use --amend.
  --amend            replace the variant's latest version in place (same number)
                     instead of adding one. Only from the session that published
                     it, and only while the user hasn't acted on it (no Send,
                     comment, draft answer, not in use)
  --withdraw         take the variant's latest version back under the same
                     rule: the version before it is current again, and a
                     variant with no other version goes
  --state <label>    state in the user's words (omit for a single-state design)
  --variant <name>   variant label (default "default")
  --surfaces <json|file>  the full ordered list: {"id"} alone keeps a surface,
                     a missing id removes it, order is the list order
  --parts <name=file|->   replace only the element carrying data-part="name"
                     (name#key for one instance) in the latest version; repeatable
  --fills <part#fill=file|->  replace the element carrying data-part="part"
                     data-fill="fill" in the latest version, or add it after
                     that part's other fills; the marks are added if missing
  --title <t>        design title
  --kind <k>         screen|component|idea: screen for a screen of the product,
                     component for a reusable design screens embed (embedding makes one);
                     omit for ideas, diagrams, reviews (default idea)
  --area <name>      where in the product it belongs, in the project's words
                     ("Shell", "Food"); Home groups each tab by it. "" clears
  --source <path>    the code path that implements it (apps/web/src/shell). "" clears
  --knobs <json|file>  knobs in tunekit usePane shape
  --from <N>         branch from version N
  --fork <v[@N]>     start this new variant from sibling v (its version N, else
                     its latest); alone it copies v, with --parts/--fills it
                     edits the copy
  --prompt <text>    what prompted this version
  --description <text>  one line on what this variant is, shown beside it (never
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
                     instead of running it; with --parts or --fills it is the
                     still of the spliced page. A version that changes the page
                     without one drops the old still
  --md/--mermaid/--diff/--terminal/--data/--code/--image <file>  more surfaces
  --json / --quiet
  Prints the parts found per state, parts that vanished or were renamed,
  nudges, a ready-to-run "mockpit ask" when variants have no question, and feedback.`,
  ask: `mockpit ask --design <slug> "<question>" --option <label[=variant]> ... [--scope design|state|part]
  [--state s] [--states s]... [--part p] [--multi] [--id id] [--after <ask id>] [--recommend <label>]
  mockpit ask --design <slug> --asks <json|file>
  Ask the user. A choice is several variants plus one question that binds them.
  Then tell the user where to look and end your turn.`,
  read: `mockpit read [slug] [--project <name>] [--body] [--history] [--tree] [--decisions]
  Read this first. Both forms carry the project's decision list, what the user
  already settled, from their replies: treat each line as settled unless they say
  otherwise. No slug: one line per design (states, variants, open questions), one per
  flow, plus pending, what the user is doing now, then the decisions. A slug: the
  design's states, variants, questions with answers, parts, knobs and settled values,
  plus its pending and decisionList (its own lines marked here), as JSON.
  --body includes surfaces, --history version rows. --tree (no slug): the
  project as a tree, each design's variants with status and forkedFrom, and the
  designs it embeds and is embedded in, as JSON. --decisions: the whole list, when
  a read says lines were left out. Never consumes feedback.`,
  feedback: `mockpit feedback [--project <name>] [--session <id>]
  Returns at once with {feedback, pending} as JSON: one batch per design the user
  sent since you last heard ({design, reply: {asks, borrowed, tuned, comments,
  verdict}, messages, inUse, archived}), delivered once across feedback, watch and
  every write; and pending ({design, viewerOpen, draft}) so you can tell the
  user "take your time" or "2 of 3 answered". Run it when the user says they
  answered.`,
  say: `mockpit say "<text>" --design <slug> [--state s] [--variant v]
  A plain-text message in the design's thread, as your session's agent.`,
  move: `mockpit move --design <slug> [--state s] --variant <v> [--variant <v>...]
  --to <design> [--to-state <s>] | --to-state <s> | --archive | --restore
mockpit move --design <slug> [--state s] [--variant <v>...] --hide-older | --delete-older
  Tidy up. --to or --to-state moves them to another design or tab (a new state is
  created) and takes them out of here; --archive takes them out of sight; --restore
  brings them back. Their group goes along; one in use stays and is reported. The
  thread says what happened, so the user can undo it.
  Only when the user asks: --hide-older hides all but each variant's newest visible
  version (no --variant: every variant), and --delete-older deletes them for good,
  skipping and listing any that a reply, comment, question, embed, copy or fork still
  points at, or that is in use. It can't be undone: confirm first.`,
  edit: `mockpit edit --design <slug> [--slug <new>] [--title <t>] [--kind screen|component|idea]
  [--first-state <name>] [--notes <text>|""]
  [--area <name>|""] [--source <path>|""] [--project <name>]
mockpit edit --project <name> --rename <new name>
mockpit edit --project <name> --area-order "Shell,Food,Chat"
  Change a design without publishing a new version; "" clears area or source. A new
  slug rewrites every embed, data-goto and flow step that names the old one, in
  every version. A design still embedded somewhere stays a component, not an idea.
  --notes drafts the design's short plain-text spec, which read returns; the user's own
  edit of it stands, so the draft is then not applied and the result says so.
  --first-state names a design's one unnamed state, and every variant it holds goes
  there, so the design can then have more states.
  --rename moves the project's designs, sessions, flows and design settings to the
  new name (refused if that project has designs); pass --project <new> or set
  MOCKPIT_PROJECT afterwards if the repo still resolves to the old name.
  --area-order lists the project's areas in the order Home shows them; areas it
  leaves out follow alphabetically, "" goes back to alphabetical.`,
  run: `mockpit run <file|-> [--session <id>] [--project <name>] [--json]
  Run a script (the body of an async function, plain JavaScript) in the server's
  sandbox against the mockpit API; see mockpit guide --topic scripts. Prints each
  host call in order, the script's prints, its value or error, and any user
  feedback the run received. --json prints the whole result. Exits 2 when the
  script failed.`,
  watch: `mockpit watch [--session <id>] [--after <seq>] [--once] [--exit-code <n>]
  Print one line per Send, for a background monitor (in Claude Code, arm it
  under Monitor after asking, then end the turn). A line says a reply landed;
  feedback or the next write delivers it, once.
  --once stops after the first Send, for a harness whose wake is a process
  exiting; --exit-code sets the code it stops with (default 0).`,
  export: `mockpit export --design <slug> [--state s] [--variant v] [--out <dir>]
  Write index.html + history.json per state to .mockpit/accepted/<design>/<state>/;
  with fills, index.html is the chosen state, plus all-fills.html and decisions.json.`,
  upload: `mockpit upload <file> [--kind image|file] [--session <id>]
  Upload an asset; prints its id and URL. Use the id as an image surface's assetId.`,
  guide: `mockpit guide [--topic <id>] [--project <name>]
  No flag prints the brief: the loop, parts, questions and knobs, feedback, and
  this project's palette, kit and icons. --topic prints one reference topic
  (knobs, asks, surfaces, html, feedback, http, scripts).`,
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
    const choices = body.variants ?? body.states ?? body.projects;
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
  if (state.session && !flags["new-session"]) {
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
      key: harnessKey(),
    }),
  });
  writeState({ session: session.id, agent: agentName(flags) });
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
  if (added.length === 0) return { added: [], errors, designSystem: null };
  const stored = (await api(`${projectPath(project)}/design-system`)) ?? {};
  const keep = (stored.iconSets ?? []).filter((s) => !added.some((a) => a.prefix === s.prefix));
  const designSystem = await api(`${projectPath(project)}/design-system`, {
    method: "PUT",
    body: JSON.stringify({ ...stored, iconSets: [...keep, ...added] }),
  });
  return {
    added: designSystem.iconSets.filter((s) => added.some((a) => a.prefix === s.prefix)),
    errors,
    designSystem,
  };
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
  return api(`${projectPath(project)}/kits/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ href: url, script, doc: readKitDoc(doc) }),
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

// The flags every design verb shares: which design, which state, which variant.
const DESIGN_FLAGS = {
  design: { type: "string" },
  state: { type: "string" },
  variant: { type: "string" },
  project: { type: "string" },
  session: { type: "string" },
};

function requireDesign(flags, example) {
  const slug = flags.design ? slugify(flags.design) : "";
  if (!slug) die("--design needs a slug", example);
  return slug;
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
    `${design.slug}/${stateLabel(post.state)}${post.variant} v${post.version}${branch && post.from ? ` (from v${post.from})` : ""}${how} · ${result.url}`,
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
    `${slug}/${stateLabel(w.state)}${w.variant} v${w.version} withdrawn, variant removed · ${result.url}`,
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
      source: { type: "string" },
      html: { type: "string" },
      poster: { type: "string" },
      surfaces: { type: "string" },
      parts: { type: "string", multiple: true },
      fills: { type: "string", multiple: true },
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
// `--fills part#fill=file` is the same for one fill of a part.
function readPartFlags(values, slug, flag = "parts") {
  if (!values?.length) return undefined;
  const example =
    flag === "parts"
      ? `mockpit publish --design ${slug} --parts body=body.html`
      : `mockpit publish --design ${slug} --fills entry#skeleton=skeleton.html`;
  const parts = {};
  let stdin = false;
  for (const raw of values) {
    const at = raw.indexOf("=");
    if (at <= 0 || at === raw.length - 1) {
      die(
        `--${flag} needs ${flag === "parts" ? "name" : "part#fill"}=file (got "${raw}")`,
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
    flags.fills?.length && "--fills",
  ].filter(Boolean);
  if (given.length > 1) {
    die(
      `pass one of --html, --surfaces, --parts or --fills, not ${given.join(" and ")}`,
      `mockpit publish --help`,
    );
  }
  // Checked before the session exists so a typo'd path leaves nothing behind on the server.
  if (file && file !== "-" && !existsSync(file)) die(`cannot read ${file}`, `ls ${file}`);
  if (flags.poster !== undefined && !existsSync(flags.poster)) {
    die(`cannot read ${flags.poster}`, `ls ${flags.poster}`);
  }
  const parts = readPartFlags(flags.parts, slug);
  const fills = readPartFlags(flags.fills, slug, "fills");
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
  if (!surfaces && !parts && !fills && !flags.fork && flags.flow === undefined && !declaring)
    die(`no html for ${slug}`, `mockpit publish --design ${slug} --html <file>`);
  const poster =
    flags.poster === undefined ? undefined : (await uploadFile(flags.poster, { session })).id;
  const body = {
    session,
    project,
    design: slug,
    state: flags.state,
    variant: flags.variant,
    title: flags.title,
    kind: flags.kind,
    area: flags.area,
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
    ...(fills && { fills }),
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

// "Quiet" is an unbound option; "Quiet=quiet" binds it to the quiet variant;
// "Before=quiet@2" to its version 2 ("=@2" names the state's only variant);
// "Above=knob:trim.position=top" sets one knob. The value is JSON when it
// parses (17, true), else a string, so slider and toggle values keep their type.
function parseOption(raw) {
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
  if (!pin) return { label, variant: bound };
  return { label, ...(pin[1] ? { variant: pin[1] } : {}), version: Number(pin[2]) };
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
    if (e.notes !== undefined) {
      lines.push(
        e.notes === null
          ? `mockpit edited ${name}: the user cleared its notes`
          : `mockpit edited ${name}: the user edited its notes: ${e.notes}`,
      );
    }
  }
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
            `borrow ${c.borrow.part ? `${c.borrow.part} ` : ""}from ${c.borrow.from} into ${c.variant}@${c.version}${c.text ? ` (“${c.text}”)` : ""}`,
        ),
      (() => {
        const n = (r.comments ?? []).filter((c) => !c.borrow).length;
        return n ? `${n} comment${n === 1 ? "" : "s"}` : "";
      })(),
      r.reactions?.length ? r.reactions.join(", ") : "",
      r.verdict ? `${r.verdict.kind} ${r.verdict.variant}` : "",
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

  // Detect the repo's design system once, store it on the project, and leave a
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
    // fields — otherwise a repo with no design system printed a blank line.
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
    // The project kit is stored first so the design PUT can name it as default.
    if (flags["kit-url"] !== undefined) {
      kit = flags.kit ?? "project";
      await putProjectKit(project, kit, {
        url: flags["kit-url"],
        script: flags["kit-script"],
        doc: flags["kit-doc"],
      });
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

    let stored = await api(`${projectPath(project)}/design-system`, {
      method: "PUT",
      body: JSON.stringify({
        detected: designSystem.detected ?? null,
        palette: designSystem.palette ?? null,
        cssVars: designSystem.cssVars ?? "",
        tailwindCss: designSystem.tailwindCss ?? "",
        strippedImports: designSystem.strippedImports ?? [],
        kit,
        designFiles: designSystem.designFiles ?? null,
      }),
    });

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
      if (result.designSystem) stored = result.designSystem;
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
    if (flags.json) out({ project, designSystem: stored, starter });
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
  // variant with its history is the biggest thing an agent can pull into context.
  async read() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: {
        project: { type: "string" },
        body: { type: "boolean" },
        history: { type: "boolean" },
        tree: { type: "boolean" },
        decisions: { type: "boolean" },
      },
    });
    const project = resolveProject(flags).name;
    if (positionals.length > 1) die("read takes one design slug", "mockpit read writer");
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
    for (const m of designs) {
      const states = m.states.length ? m.states.join(" / ") : "single state";
      console.log(
        `  ${m.slug} · ${m.kind}${m.area ? ` · ${m.area}` : ""} · ${states} · ${m.variants} variant${m.variants === 1 ? "" : "s"}${m.planned ? " · planned" : ""}${m.archivedAt ? " · archived" : m.open ? ` · ${m.open} open` : ""}`,
      );
    }
    for (const flow of list.flows ?? []) console.log(`  ${flowLine(flow)}`);
    for (const line of pendingLines(list.pending)) console.log(line);
    if (list.decisionList) {
      console.log(
        `Decided, ${list.decisionList.total}. Treat as settled unless the user says otherwise:`,
      );
      for (const d of list.decisionList.lines) console.log(`  ${d.design}: ${d.text}`);
      if (list.decisionList.more) console.log(`  ${list.decisionList.more} (--decisions)`);
    }
  },
  async export() {
    const { values: flags } = parse({
      options: {
        design: { type: "string" },
        state: { type: "string" },
        variant: { type: "string" },
        project: { type: "string" },
        out: { type: "string" },
      },
    });
    const slug = requireDesign(flags, "mockpit export --design writer");
    const project = resolveProject(flags).name;
    const data = await api(
      `${designPath(slug)}/export${query({ project, state: flags.state, variant: flags.variant })}`,
      {},
      { report: "die", fix: `mockpit read ${slug}` },
    );
    if (flags.json) return out(data);
    const root = join(flags.out ? flags.out : join(process.cwd(), ".mockpit", "accepted"), slug);
    for (const entry of data.states) {
      const dir = join(root, entry.state === null ? "default" : slugify(entry.state));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "index.html"), entry.html ?? "");
      // The state with every fill, when index.html is the composed choice.
      if (entry.allFills) writeFileSync(join(dir, "all-fills.html"), entry.allFills);
      const decided = data.decisions?.states?.[entry.state ?? ""];
      if (decided) {
        writeFileSync(
          join(dir, "decisions.json"),
          JSON.stringify({ ...decided, knobs: data.decisions.knobs }, null, 2) + "\n",
        );
      }
      writeFileSync(
        join(dir, "history.json"),
        JSON.stringify(
          {
            project,
            design: slug,
            state: entry.state,
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
        console.log(
          `${slug}/${stateLabel(entry.state)}${entry.variant} v${entry.version} → ${dir}`,
        );
      }
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
        variant: { type: "string", multiple: true },
        to: { type: "string" },
        "to-state": { type: "string" },
        archive: { type: "boolean" },
        restore: { type: "boolean" },
        "hide-older": { type: "boolean" },
        "delete-older": { type: "boolean" },
      },
    });
    const example = "mockpit move --design writer --variant quiet --archive";
    const slug = requireDesign(flags, example);
    const tidying = flags["hide-older"] || flags["delete-older"];
    if (!flags.variant?.length && !tidying) die("move needs --variant", example);
    const session = await resolveSession(flags);
    const result = await api(
      `${designPath(slug)}/move`,
      {
        method: "POST",
        body: JSON.stringify({
          state: flags.state,
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
        console.log(`stayed: ${s.state ? `${s.state}/` : ""}${s.variant}${which} (${s.why})`);
      }
      printFeedback(result.feedback);
      return;
    }
    const names = result.variants.map((v) => v.variant).join(", ") || "nothing";
    const done = result.to
      ? `moved to ${result.to.design}`
      : flags.restore
        ? "restored"
        : "archived";
    console.log(`${done}: ${names}`);
    for (const s of result.skipped) console.log(`stayed: ${s.variant} (${s.why})`);
    printFeedback(result.feedback);
  },
  async edit() {
    const { values: flags } = parse({
      options: {
        design: { type: "string" },
        project: { type: "string" },
        session: { type: "string" },
        slug: { type: "string" },
        title: { type: "string" },
        kind: { type: "string" },
        area: { type: "string" },
        source: { type: "string" },
        "first-state": { type: "string" },
        notes: { type: "string" },
        rename: { type: "string" },
        "area-order": { type: "string" },
      },
    });
    const project = resolveProject(flags).name;
    const session = (await resolveSession(flags)) ?? undefined;
    const areaOrder = flags["area-order"];
    if (flags.rename !== undefined || areaOrder !== undefined) {
      if (flags.design) {
        die(
          "--rename and --area-order edit the project; edit the design without them",
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
            ...(areaOrder === undefined ? {} : { areaOrder: areaOrder.split(",") }),
            session,
          }),
        },
        { report: "die", fix: "mockpit read" },
      );
      if (flags.json) return out(result);
      if (flags.quiet) return;
      if (result.areaOrder) {
        console.log(
          `area order ${result.areaOrder.length ? result.areaOrder.join(", ") : "alphabetical"} · ${result.url}`,
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
    const fields = ["slug", "title", "kind", "area", "source", "notes"].filter(
      (k) => flags[k] !== undefined,
    );
    if (!fields.length && flags["first-state"] === undefined) {
      die(
        "edit needs --slug, --title, --kind, --area, --source, --notes or --first-state",
        "mockpit edit --help",
      );
    }
    const result = await api(
      designPath(slug),
      {
        method: "PATCH",
        body: JSON.stringify({
          project,
          session,
          ...Object.fromEntries(fields.map((k) => [k, flags[k]])),
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
        m.area && `area ${m.area}`,
        m.source && `source ${m.source}`,
        result.notes && (result.notes.applied ? "notes saved" : "notes NOT applied"),
        result.url,
      ]
        .filter(Boolean)
        .join(" · "),
    );
    for (const nudge of result.nudges ?? []) console.log(`nudge: ${nudge}`);
    if (result.notes && !result.notes.applied) console.log(`notes: ${result.notes.text}`);
    printFeedback(result.feedback);
  },
  async demo() {
    parse();
    const { DEMO } = await import("./demoData.js");
    // The demo goes in through the same path an agent uses: one session, one
    // publish per (state, variant), then the asks.
    const session = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ agent: DEMO.agent, title: DEMO.sessionTitle, project: DEMO.project }),
    });
    for (const state of DEMO.states) {
      for (const variant of DEMO.variants) {
        await api("/api/designs", {
          method: "POST",
          body: JSON.stringify({
            session: session.id,
            project: DEMO.project,
            design: DEMO.slug,
            kind: "screen",
            title: DEMO.title,
            state: state.label,
            variant: variant.name,
            knobs: DEMO.knobs,
            surfaces: [{ kind: "html", html: DEMO.render(state, variant) }],
          }),
        });
      }
    }
    await api(`${designPath(DEMO.slug)}/asks`, {
      method: "POST",
      body: JSON.stringify({ project: DEMO.project, session: session.id, asks: DEMO.asks }),
    });
    console.log(
      `Seeded ${DEMO.project} › ${DEMO.title} (${DEMO.states.length} states × ${DEMO.variants.length} variants) — open ${BASE}/project/${encodeURIComponent(DEMO.project)}/${DEMO.slug}`,
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
      if (flags.json) return out(result.designSystem);
      for (const a of result.added) {
        if (!flags.quiet) console.log(`added ${a.prefix} (${a.count} icons)`);
      }
      return;
    }
    if (sub === "remove") {
      const stored = await api(`${projectPath(project)}/design-system`);
      const installed = stored?.iconSets ?? [];
      for (const set of sets) {
        if (installed.some((s) => s.prefix === set)) continue;
        fail(
          BUNDLED_ICON_SETS.includes(set)
            ? `${set} is bundled with the server and cannot be removed`
            : `${set} is not installed for ${project}`,
        );
      }
      const designSystem = await api(`${projectPath(project)}/design-system`, {
        method: "PUT",
        body: JSON.stringify({
          ...stored,
          iconSets: installed.filter((s) => !sets.includes(s.prefix)),
        }),
      });
      if (flags.json) return out(designSystem);
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
    const designSystem =
      sub === "add"
        ? await putProjectKit(project, id, flags)
        : await api(`${projectPath(project)}/kits/${encodeURIComponent(id)}`, {
            method: "DELETE",
          });
    if (flags.json) return out(designSystem);
    if (!flags.quiet) console.log(`${sub === "add" ? "added" : "removed"} kit ${id} (${project})`);
  },

  async guide() {
    const { values: flags } = parse({
      options: { topic: { type: "string" }, project: { type: "string" } },
    });
    if (flags.topic !== undefined) return printTopic(flags.topic);
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

async function printTopic(topic) {
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
  const path = `/agent-howto?${new URLSearchParams({ topic })}`;
  console.log(await fetchTextWithFallback(path, join(TOPICS_DIR, `${topic}.md`)));
}

// The brief is rendered from the project's stored design settings, so the
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
    `note: no mockpit at ${BASE}; this is the generic brief. Run mockpit serve, then mockpit init for this project's palette, kit and icons.`,
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
