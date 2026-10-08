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
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { serveUrl } from "./serveUrl.js";

const BASE = (process.env.MOCKPIT_URL ?? "http://localhost:8228").replace(/\/$/, "");
const TOKEN = process.env.MOCKPIT_TOKEN;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

const HELP = `mockpit — a live visual surface for terminal coding agents

vocabulary: project › mock › state › variant › version. A project is a repo; a
mock is the page or component on stage; a state is one moment of it ("Lab
open"); a variant is a parallel design of a state; a version is its history.
Mark the parts you want feedback on with data-part="name" in the html.

design loop:
  mockpit init [--project name]          detect the repo's design system, store
                                          palette/kit/icon sets, write .mockpit/starter.html
  mockpit icons [add|remove <set>...]    list the icon sets html surfaces can name
                                          (icon="prefix:name"); add or remove an
                                          Iconify set for this project
  mockpit publish --mock <slug> --html <file> [options]
                                          publish (or re-version) one variant of
                                          one state
      --state <label>   state, in the user's words (omit for a single-state mock)
      --variant <name>  variant label (default "default")
      --title <t>       mock title
      --kind <k>        component|page (default component)
      --knobs <json|file>  knobs in tunekit usePane shape, keyed by path
      --from <N>        branch from version N
      --prompt <text>   what prompted this version
      --project <name>  project (default: git remote, else directory name)
      --kit <id>        opt the html surface into a kit (repeatable; see "mockpit kits")
      --md/--mermaid/--diff/--terminal/--data/--code/--image <file|->
                        add a surface of that kind after the html (repeatable;
                        --data is a JSON tree)
  mockpit revise --mock <slug> --html <file> [--state s] [--variant v] [--from N]
                                          publish the next version of a variant
      --part <name=file|->  instead of --html: replace just that data-part's
                        element (repeatable; name#key targets one instance)
  mockpit ask --mock <slug> "<question>" --option <label[=variant]> ...
                                          ask the user; bind options to variants
      --option <l[=v]>  an option (repeatable); "=variant" binds it to a variant
      --scope <s>       mock|state|part (default mock)
      --state <label>   the state a state-scoped ask is about
      --part <name>     the part a part-scoped ask is about
      --multi           allow several answers
      --id <id>         stable id; reusing one replaces that ask
      --asks <json|file>  several asks at once, full shape
  mockpit wait [--mock <slug>] [--timeout s]
                                          block until the user sends their reply;
                                          prints the feedback batch as JSON
      --timeout <sec>   max seconds to wait (default 120)
      --session <id>    session to watch (default: auto)
      --after <seq>     re-read after this cursor (default: where the agent left
                        off, tracked server-side across CLI/MCP)
  mockpit status [--project <name>]      one line per mock: states, variants, open asks
  mockpit show --mock <slug> [--body] [--history]
                                          mock metadata, asks, parts, knobs;
                                          bodies and version rows are opt-in
  mockpit export --mock <slug> [--state s] [--variant v] [--out <dir>]
                                          write the accepted html + history per state
                                          to .mockpit/accepted/<mock>/<state>/
  mockpit guide --brief                  the short, project-aware agent guide

other commands:
  mockpit serve [--port N] [--host H] [--open]
                                          start the server (API + viewer)
  mockpit demo                           seed the Writer mock to explore the viewer
  mockpit comment "<text>" --mock <slug> [--state s] [--variant v]
                                          reply to the user in a mock's thread
  mockpit watch [--session <id>]         stream user feedback forever, one line
                                          each (for a background monitor)
  mockpit surface add|remove|edit|move --mock <slug> ...
                                          edit one surface of a variant
  mockpit upload <file> [--kind image|file]
                                          upload an asset, print its id and URL
  mockpit asset-url <file>               print the URL a file will have (no upload)
  mockpit kits                           list the opt-in html kits
  mockpit agent-howto [--topic <id>]     print the brief to read before publishing,
                                          or one reference topic
  mockpit guide [--brief|--topic <id>]   print the html topic (or the brief, or a topic)
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
  MOCKPIT_HOST     address serve binds to (default: every interface)
  MOCKPIT_SESSION  fixed session id (overrides auto-detection)
  MOCKPIT_AGENT    agent name used when creating sessions
`;

// Per-command help, so `mockpit publish --help` costs a few lines instead of
// the whole manual. Commands without an entry fall back to HELP.
const COMMAND_HELP = {
  init: `mockpit init [--project <name>]
  Detect the repo's design system, store palette + kit for the project, add the
  Iconify sets matching its icon packages, and write .mockpit/starter.html
  (gitignored).`,
  icons: `mockpit icons [--project <name>]
mockpit icons add <set> [<set>...]
mockpit icons remove <set> [<set>...]
  html surfaces write <i icon="lucide:check"></i>; the server inlines the svg.
  lucide and mage are bundled. add finds @iconify-json/<set> in node_modules,
  the global npm root or bun's cache, else fetches it from jsDelivr.`,
  publish: `mockpit publish --mock <slug> --html <file> [options]
  --state <label>    state in the user's words (omit for a single-state mock)
  --variant <name>   variant label (default "default")
  --title <t>        mock title
  --kind <k>         component|page (default component)
  --knobs <json|file>  knobs in tunekit usePane shape
  --from <N>         branch from version N
  --prompt <text>    what prompted this version
  --project <name>   project (default: git remote, else directory name)
  --md/--mermaid/--diff/--terminal/--data/--code/--image <file>  more surfaces
  --json / --quiet
  Prints the parts found per state and flags parts that vanished or were renamed.`,
  revise: `mockpit revise --mock <slug> --html <file> [--state s] [--variant v] [--from <N>]
  mockpit revise --mock <slug> --part <name=file|-> ... [--state s] [--variant v]
  Publish the next version of an existing variant. --part replaces only the element
  carrying data-part="name" (name#key for one instance); the rest is kept.`,
  ask: `mockpit ask --mock <slug> "<question>" --option <label[=variant]> ... [--scope mock|state|part]
  [--state s] [--part p] [--multi] [--id id]
  mockpit ask --mock <slug> --asks <json|file>
  Ask the user. Two renders needed to show a choice: bind options to variants.`,
  wait: `mockpit wait [--mock <slug>] [--timeout <seconds>] [--session <id>]
  Block until the user sends, then print the feedback batch:
  {mock, reply: {answers, mix, tuned, comments, text}, comments, accepted, archived}.`,
  status: `mockpit status [--project <name>]
  One line per mock: slug, kind, states, variants, open asks.`,
  show: `mockpit show --mock <slug> [--body] [--history]
  Metadata, asks, parts and knobs. --body includes surfaces, --history version rows.`,
  export: `mockpit export --mock <slug> [--state s] [--variant v] [--out <dir>]
  Write index.html + history.json per state to .mockpit/accepted/<mock>/<state>/.`,
  comment: `mockpit comment "<text>" --mock <slug> [--state s] [--variant v]
  Reply to the user in a mock's thread.`,
  surface: `mockpit surface add --mock <slug> [--state s] [--variant v] --md <f> [--before N|--after N]
mockpit surface remove --mock <slug> [--state s] [--variant v] <N|id>
mockpit surface edit --mock <slug> [--state s] [--variant v] <N|id> <file|->
mockpit surface move --mock <slug> [--state s] [--variant v] <N|id> --to <M>`,
  "agent-howto": `mockpit agent-howto [--topic <id>] [--project <name>]
  No flag prints the brief: the loop, parts, asks and knobs, the reply, and
  this project's palette, kit and icons. --topic prints one reference topic
  (knobs, asks, surfaces, html, reply, http).`,
  guide: `mockpit guide [--brief] [--topic <id>]
  No flag prints the html topic. --brief prints the project-aware brief
  (same as mockpit agent-howto). --topic prints one reference topic.`,
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
// `mockpit: …` (exit 1); the mock verbs pass `die` so the error / fix / exit 2
// format is what an agent parses.
async function api(path, init = {}, { report, fix } = {}) {
  const bail = (what, hint) => (report === "die" ? die(what, hint ?? fix) : fail(what));
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
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
    bail(extra && !main.includes(extra) ? `${main}: ${extra}` : main);
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

async function resolveSession(flags, { create = false } = {}) {
  if (flags.session) return flags.session;
  if (process.env.MOCKPIT_SESSION) return process.env.MOCKPIT_SESSION;
  const state = readState();
  if (state.session && !flags["new-session"]) {
    const ok = await fetch(`${BASE}/api/sessions/${state.session}`, {
      headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {},
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
    }),
  });
  writeState({ session: session.id, agent: agentName(flags) });
  return session.id;
}

// A monitor process (e.g. the Claude Code plugin) may not share the local
// state file written by the agent's CLI calls — different spawn tree, so
// `agentPid()` can hash to a different key. Fall back to asking the server for
// the most recently active session whose cwd matches ours. Uses raw fetch (not
// `api()`) so a transient failure returns null instead of exiting the process.
async function resolveSessionByCwd(cwd = process.cwd()) {
  try {
    const res = await fetch(`${BASE}/api/sessions`, {
      headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {},
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
        ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
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
  if (added.length === 0) return { added: [], errors, design: null };
  const stored = (await api(`${projectPath(project)}/design`)) ?? {};
  const keep = (stored.iconSets ?? []).filter((s) => !added.some((a) => a.prefix === s.prefix));
  const design = await api(`${projectPath(project)}/design`, {
    method: "PUT",
    body: JSON.stringify({ ...stored, iconSets: [...keep, ...added] }),
  });
  return {
    added: design.iconSets.filter((s) => added.some((a) => a.prefix === s.prefix)),
    errors,
    design,
  };
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

const mockPath = (slug) => `/api/mocks/${encodeURIComponent(slug)}`;

const query = (params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== false) q.set(k, v === true ? "1" : String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
};

// The flags every mock verb shares: which mock, which state, which variant.
const MOCK_FLAGS = {
  mock: { type: "string" },
  state: { type: "string" },
  variant: { type: "string" },
  project: { type: "string" },
  session: { type: "string" },
};

function requireMock(flags, example) {
  const slug = flags.mock ? slugify(flags.mock) : "";
  if (!slug) die("--mock needs a slug", example);
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

// One line per write: what was published, its URL, the parts found per state,
// anything that moved, and feedback the user left while the agent worked.
function printPublished(result, flags) {
  if (flags.json) return out(result);
  if (flags.quiet) return;
  const { mock, post } = result;
  const branch = post.from !== undefined && post.from !== post.version - 1;
  console.log(
    `${mock.slug}/${stateLabel(post.state)}${post.variant} v${post.version}${branch && post.from ? ` (from v${post.from})` : ""} · ${result.url}`,
  );
  for (const { state, parts } of result.parts ?? []) {
    if (parts.length === 0) continue;
    console.log(`parts${state ? ` (${state})` : ""}: ${parts.map((p) => p.name).join(", ")}`);
  }
  if (result.applied?.length) console.log(`applied: ${result.applied.join(", ")}`);
  const changes = result.partChanges;
  if (changes?.renamed?.length) {
    console.log(`renamed: ${changes.renamed.map((r) => `${r.from} → ${r.to}`).join(", ")}`);
  }
  if (changes?.vanished?.length) console.log(`vanished: ${changes.vanished.join(", ")}`);
  for (const nudge of result.nudges ?? []) console.log(`nudge: ${nudge}`);
  for (const warning of result.warnings ?? []) console.log(`warning: ${warning}`);
  // Only speak when there IS feedback: an empty line per publish is pure token
  // cost, and the cursor guarantees anything pending arrives on some write.
  if (result.userFeedback?.length)
    console.log(`userFeedback: ${JSON.stringify(result.userFeedback)}`);
}

// publish and revise share one flag set and one body.
function parsePublishFlags() {
  return parse({
    tokens: true,
    allowPositionals: true,
    options: {
      ...MOCK_FLAGS,
      title: { type: "string" },
      kind: { type: "string" },
      html: { type: "string" },
      part: { type: "string", multiple: true },
      knobs: { type: "string" },
      from: { type: "string" },
      prompt: { type: "string" },
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
    },
  });
}

// `--part name=file` (repeatable; `name#key` targets one instance): the new
// outer html of one part, spliced server-side into the current version.
function readPartFlags(values, slug, revise) {
  if (!values?.length) return undefined;
  const example = `mockpit revise --mock ${slug} --part body=body.html`;
  if (!revise) die("--part edits a published version; use it with revise", example);
  const parts = {};
  let stdin = false;
  for (const raw of values) {
    const at = raw.indexOf("=");
    if (at <= 0 || at === raw.length - 1) die(`--part needs name=file (got "${raw}")`, example);
    const name = raw.slice(0, at);
    const file = raw.slice(at + 1);
    if (file === "-") {
      if (stdin) die("only one --part can read stdin", example);
      stdin = true;
    } else if (!existsSync(file)) die(`cannot read ${file}`, `ls ${file}`);
    parts[name] = readContent(file);
  }
  return parts;
}

async function publishMock({ revise = false } = {}) {
  const { values: flags, positionals, tokens } = parsePublishFlags();
  const verb = revise ? "revise" : "publish";
  const slug = requireMock(flags, `mockpit ${verb} --mock writer --html writer.html`);
  const project = resolveProject(flags).name;
  const from = flags.from === undefined ? undefined : Number(flags.from);
  if (from !== undefined && !Number.isInteger(from)) {
    die(
      `--from must be a version number (got "${flags.from}")`,
      `mockpit show --mock ${slug} --history`,
    );
  }
  const file = flags.html ?? positionals[0];
  // Checked before the session exists so a typo'd path leaves nothing behind on the server.
  if (file && file !== "-" && !existsSync(file)) die(`cannot read ${file}`, `ls ${file}`);
  const parts = readPartFlags(flags.part, slug, revise);
  const session = await resolveSession(flags, { create: true });
  const surfaces = [];
  if (file) {
    const html = { kind: "html", html: readContent(file) };
    const kits = normalizeKits(flags.kit);
    if (kits) html.kits = kits;
    surfaces.push(html);
  }
  surfaces.push(...(await surfacesFromFlags(flags, tokens, { session, layout: flags.layout })));
  if (surfaces.length === 0 && !parts)
    die(`no html for ${slug}`, `mockpit ${verb} --mock ${slug} --html <file>`);
  const body = {
    session,
    project,
    mock: slug,
    state: flags.state,
    variant: flags.variant,
    title: flags.title,
    kind: flags.kind,
    ...(flags.knobs !== undefined && { knobs: readJsonFlag("knobs", flags.knobs) }),
    ...(from !== undefined && { from }),
    prompt: flags.prompt,
    ...(surfaces.length && { surfaces }),
    ...(parts && { parts }),
  };
  const result = await api(
    revise ? `${mockPath(slug)}/revise` : "/api/mocks",
    { method: "POST", body: JSON.stringify(body) },
    { report: "die", fix: `mockpit show --mock ${slug}` },
  );
  printPublished(result, flags);
  return result;
}

// "Quiet" is an unbound option; "Quiet=quiet" binds it to the quiet variant.
function parseOption(raw) {
  const at = raw.lastIndexOf("=");
  if (at <= 0) return { label: raw };
  return { label: raw.slice(0, at), variant: raw.slice(at + 1) };
}

// One feedback batch, one line — for a background monitor's notifications.
function watchLines(batch) {
  const lines = [];
  const name = batch.mock ?? "a mock";
  if (batch.reply) {
    const r = batch.reply;
    const bits = [
      r.asks?.length
        ? r.asks
            .map((a) => `${a.text || a.ask}: ${a.chosen.map((o) => o.label).join("+")}`)
            .join("; ")
        : "",
      Object.keys(r.tuned ?? {}).length ? `${Object.keys(r.tuned).length} tuned` : "",
      Object.keys(r.mix ?? {}).length
        ? `mix ${Object.entries(r.mix)
            .map(([p, v]) => `${p}←${v}`)
            .join(", ")}`
        : "",
      r.comments?.length ? `${r.comments.length} comment${r.comments.length === 1 ? "" : "s"}` : "",
      r.decision ? r.decision.kind : "",
      r.text ?? "",
    ].filter(Boolean);
    lines.push(`mockpit reply on ${name}: ${bits.join(" · ").replace(/\s+/g, " ")}`);
  }
  for (const c of batch.comments ?? []) {
    lines.push(
      `mockpit comment on ${name}: “${String(c.text ?? "")
        .replace(/\s+/g, " ")
        .trim()}”`,
    );
  }
  return lines;
}

// GET where "not there yet" is an answer, not an exit — a project or mock that
// doesn't exist is the normal state before the first publish.
async function apiSoft(path) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {},
    });
  } catch {
    die(`cannot reach mockpit at ${BASE}`, "mockpit serve");
  }
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

// Keep the scratch directory out of the repo. Returns true when .gitignore was
// touched, so init can report it.
function ignoreMockpitDir() {
  const file = join(process.cwd(), ".gitignore");
  let current = "";
  try {
    current = readFileSync(file, "utf8");
  } catch {
    // no .gitignore yet — create one
  }
  if (/^\.mockpit\/?$/m.test(current)) return false;
  writeFileSync(
    file,
    current && !current.endsWith("\n") ? `${current}\n.mockpit/\n` : `${current}.mockpit/\n`,
  );
  return true;
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
    const { values: flags } = parse({ options: { project: { type: "string" } } });
    const { name: project, source } = resolveProject(flags);
    const say = (label, text) => {
      if (!flags.quiet && !flags.json) console.log(`${label.padEnd(8)} ${text}`);
    };
    const { detectDesign, detectIconSets, renderStarter } = await import("./initDesign.js");
    say("project:", `${project} (from ${source})`);

    const design = await detectDesign(process.cwd());
    const d = design.detected;
    // `detected` is always an object, so emptiness has to be read off the
    // fields — otherwise a repo with no design system printed a blank line.
    const found = [
      d?.tailwind && "tailwind",
      d?.shadcn && "shadcn",
      d?.cssVars ? `${d.cssVars} css vars${design.source ? ` from ${design.source}` : ""}` : null,
      d?.fonts?.length ? `fonts ${d.fonts.join(", ")}` : null,
    ].filter(Boolean);
    say(
      "design:",
      found.length ? found.join(" · ") : "nothing detected — using the built-in palette",
    );
    say("kit:", design.kit);

    let stored = await api(`${projectPath(project)}/design`, {
      method: "PUT",
      body: JSON.stringify({
        detected: design.detected ?? null,
        palette: design.palette ?? null,
        cssVars: design.cssVars ?? "",
        kit: design.kit ?? "builtin",
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
      if (result.design) stored = result.design;
    }
    const iconSets = [
      ...new Set([...(stored?.iconSets ?? []).map((s) => s.prefix), ...BUNDLED_ICON_SETS]),
    ];
    say("icons:", `${iconSets.join(", ")} available, as <i icon="prefix:name"></i>`);

    const starter = join(process.cwd(), ".mockpit", "starter.html");
    mkdirSync(dirname(starter), { recursive: true });
    writeFileSync(starter, renderStarter(design, iconSets));
    say("wrote:", ".mockpit/starter.html");
    if (ignoreMockpitDir()) say("wrote:", ".gitignore (+ .mockpit/)");
    say("next:", "mockpit guide --brief");
    if (flags.json) out({ project, design: stored, starter });
  },

  async publish() {
    await publishMock();
  },

  async revise() {
    await publishMock({ revise: true });
  },

  async ask() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: {
        mock: { type: "string" },
        project: { type: "string" },
        session: { type: "string" },
        option: { type: "string", multiple: true },
        scope: { type: "string" },
        state: { type: "string" },
        part: { type: "string" },
        multi: { type: "boolean" },
        id: { type: "string" },
        asks: { type: "string" },
      },
    });
    const slug = requireMock(flags, 'mockpit ask --mock writer "Which look?" --option Quiet=quiet');
    let asks;
    if (flags.asks !== undefined) {
      asks = readJsonFlag("asks", flags.asks);
      if (!Array.isArray(asks)) asks = [asks];
    } else {
      const text = positionals.join(" ").trim();
      if (!text)
        die(
          "ask needs a question",
          `mockpit ask --mock ${slug} "Which look?" --option Quiet=quiet`,
        );
      const options = (flags.option ?? []).map(parseOption);
      if (options.length === 0) {
        die(
          "ask needs options",
          `mockpit ask --mock ${slug} "${text}" --option Quiet=quiet --option Dark=dark`,
        );
      }
      asks = [
        {
          text,
          options,
          ...(flags.id && { id: flags.id }),
          ...(flags.scope && { scope: flags.scope }),
          ...(flags.state && { state: flags.state }),
          ...(flags.part && { part: flags.part }),
          ...(flags.multi && { multi: true }),
        },
      ];
    }
    const session = await resolveSession(flags);
    const result = await api(
      `${mockPath(slug)}/asks`,
      {
        method: "POST",
        body: JSON.stringify({
          project: resolveProject(flags).name,
          session: session ?? undefined,
          asks,
        }),
      },
      { report: "die", fix: `mockpit show --mock ${slug}` },
    );
    if (flags.json) return out(result);
    if (flags.quiet) return;
    for (const ask of result.asks) {
      console.log(
        `asked on ${result.mock}: ${ask.text} [${ask.options.map((o) => o.label).join(" | ")}]`,
      );
    }
    if (result.userFeedback?.length)
      console.log(`userFeedback: ${JSON.stringify(result.userFeedback)}`);
  },

  async status() {
    const { values: flags } = parse({ options: { project: { type: "string" } } });
    const project = resolveProject(flags).name;
    const list = (await apiSoft(`/api/mocks${query({ project })}`)) ?? { mocks: [], open: 0 };
    if (flags.json) return out(list);
    if (flags.quiet) return;
    const mocks = list.mocks ?? [];
    console.log(
      `${project} · ${mocks.length} mock${mocks.length === 1 ? "" : "s"}` +
        (list.open
          ? ` · ${list.open} open ask${list.open === 1 ? "" : "s"}`
          : " · nothing waiting on the user"),
    );
    for (const m of mocks) {
      const states = m.states.length ? m.states.join(" / ") : "single state";
      console.log(
        `  ${m.slug} · ${m.kind} · ${states} · ${m.variants} variant${m.variants === 1 ? "" : "s"}${m.open ? ` · ${m.open} open` : ""}`,
      );
    }
  },

  // Metadata by default. Bodies and version rows are opt-in, because a full
  // variant with its history is the biggest thing an agent can pull into context.
  async show() {
    const { values: flags } = parse({
      options: {
        mock: { type: "string" },
        project: { type: "string" },
        body: { type: "boolean" },
        history: { type: "boolean" },
      },
    });
    const slug = requireMock(flags, "mockpit show --mock writer");
    const project = resolveProject(flags).name;
    out(
      await api(
        `${mockPath(slug)}${query({ project, body: flags.body, history: flags.history })}`,
        {},
        { report: "die", fix: `mockpit status --project ${project}` },
      ),
    );
  },

  async export() {
    const { values: flags } = parse({
      options: {
        mock: { type: "string" },
        state: { type: "string" },
        variant: { type: "string" },
        project: { type: "string" },
        out: { type: "string" },
      },
    });
    const slug = requireMock(flags, "mockpit export --mock writer");
    const project = resolveProject(flags).name;
    const data = await api(
      `${mockPath(slug)}/export${query({ project, state: flags.state, variant: flags.variant })}`,
      {},
      { report: "die", fix: `mockpit show --mock ${slug}` },
    );
    if (flags.json) return out(data);
    const root = join(flags.out ? flags.out : join(process.cwd(), ".mockpit", "accepted"), slug);
    for (const entry of data.states) {
      const dir = join(root, entry.state === null ? "default" : slugify(entry.state));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "index.html"), entry.html ?? "");
      writeFileSync(
        join(dir, "history.json"),
        JSON.stringify(
          {
            project,
            mock: slug,
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

  async wait() {
    const { values: flags } = parse({
      options: {
        session: { type: "string" },
        timeout: { type: "string" },
        after: { type: "string" },
        mock: { type: "string" },
      },
    });
    const session = await resolveSession(flags);
    if (!session) fail("no active session — publish something first, or pass --session");
    if (flags.after !== undefined && !/^\d+$/.test(flags.after)) {
      fail(`--after must be a number (got "${flags.after}")`);
    }
    const timeout = Math.max(1, Number(flags.timeout ?? 120));
    const deadline = Date.now() + timeout * 1000;
    // No client-side cursor: without --after, the server resumes from the
    // session's agent cursor, shared with piggyback and MCP delivery.
    let cursor = flags.after;
    let batches = [];
    while (Date.now() < deadline && batches.length === 0) {
      const chunk = Math.min(60, Math.ceil((deadline - Date.now()) / 1000));
      const result = await api(
        `/api/comments${query({ session, author: "user", after: cursor, wait: chunk })}`,
      );
      if (cursor !== undefined) cursor = result.lastSeq ?? cursor;
      batches = result.feedback ?? [];
      if (flags.mock) {
        const slug = slugify(flags.mock);
        batches = batches.filter((b) => b.mock === slug);
      }
    }
    if (flags.quiet) return;
    if (batches.length === 0) {
      return out({
        feedback: [],
        timedOut: true,
        hint: "no user feedback yet — run wait again or continue",
      });
    }
    out(batches.length === 1 ? batches[0] : batches);
  },

  async watch() {
    const { values: flags } = parse({
      options: { session: { type: "string" }, after: { type: "string" } },
    });
    if (flags.after !== undefined && !/^\d+$/.test(flags.after)) {
      fail(`--after must be a number (got "${flags.after}")`);
    }
    // A continuous long-poll that streams each piece of feedback as one line —
    // one line is one monitor notification. It re-arms forever; a transient
    // network error backs off and retries rather than exiting.
    //
    // After the first poll it carries no client cursor: an author=user read
    // resumes from the session's server-side cursor and advances it, so
    // feedback is delivered exactly once across watch, wait, and piggyback.
    let firstAfter = flags.after;
    for (;;) {
      const session = (await resolveSession(flags)) ?? (await resolveSessionByCwd());
      if (!session) {
        await sleep(2000);
        continue;
      }
      let result;
      try {
        const res = await fetch(
          `${BASE}/api/comments${query({ session, author: "user", after: firstAfter, wait: 60 })}`,
          { headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {} },
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
      for (const batch of result.feedback ?? []) {
        for (const line of watchLines(batch)) console.log(line);
      }
    }
  },

  async comment() {
    const { values: flags, positionals } = parse({ allowPositionals: true, options: MOCK_FLAGS });
    const text = positionals.join(" ").trim();
    if (!text) die("comment needs text", 'mockpit comment "…" --mock writer');
    const slug = requireMock(flags, `mockpit comment "${text}" --mock writer`);
    const session = await resolveSession(flags);
    out(
      await api(
        "/api/comments",
        {
          method: "POST",
          body: JSON.stringify({
            text,
            mock: slug,
            state: flags.state,
            variant: flags.variant,
            project: resolveProject(flags).name,
            session: session ?? undefined,
          }),
        },
        { report: "die", fix: `mockpit show --mock ${slug}` },
      ),
    );
  },

  async surface() {
    const sub = rest.shift();
    if (!sub || sub === "--help" || sub === "-h") printAndExit(COMMAND_HELP.surface);
    const target = (flags, extra = {}) => ({
      project: resolveProject(flags).name,
      state: flags.state,
      variant: flags.variant,
      ...extra,
    });
    const send = (path, method, body, flags) =>
      api(path, { method, body: JSON.stringify(body) }, { report: "die" }).then((r) =>
        printPublished(r, flags),
      );

    if (sub === "add") {
      const { values: flags, tokens } = parse({
        tokens: true,
        allowPositionals: true,
        options: {
          ...MOCK_FLAGS,
          md: { type: "string", multiple: true },
          mermaid: { type: "string", multiple: true },
          diff: { type: "string", multiple: true },
          terminal: { type: "string", multiple: true },
          data: { type: "string", multiple: true },
          code: { type: "string", multiple: true },
          image: { type: "string", multiple: true },
          before: { type: "string" },
          after: { type: "string" },
          layout: { type: "string" },
        },
      });
      const slug = requireMock(flags, "mockpit surface add --mock writer --md notes.md");
      const session = await resolveSession(flags, { create: true });
      const surfaces = await surfacesFromFlags(flags, tokens, { session, layout: flags.layout });
      if (surfaces.length === 0) fail("provide at least one surface flag (--md, --code, ...)");
      // One append per surface so --before/--after applies to each, in order.
      for (const surface of surfaces) {
        await send(
          `${mockPath(slug)}/surfaces`,
          "POST",
          target(flags, { surface, before: flags.before, after: flags.after }),
          { ...flags, quiet: true },
        );
      }
      if (!flags.quiet) console.log(`added ${surfaces.length} surface(s) to ${slug}`);
    } else if (sub === "remove") {
      const { values: flags, positionals } = parse({ allowPositionals: true, options: MOCK_FLAGS });
      const slug = requireMock(flags, "mockpit surface remove --mock writer 1");
      if (!positionals[0]) fail("usage: mockpit surface remove --mock <slug> <N|id>");
      const result = await api(
        `${mockPath(slug)}/surfaces/${encodeURIComponent(positionals[0])}${query(target(flags))}`,
        { method: "DELETE" },
        { report: "die" },
      );
      printPublished(result, flags);
    } else if (sub === "edit") {
      const { values: flags, positionals } = parse({ allowPositionals: true, options: MOCK_FLAGS });
      const slug = requireMock(flags, "mockpit surface edit --mock writer 0 writer.html");
      const [which, file] = positionals;
      if (!which || file === undefined)
        fail("usage: mockpit surface edit --mock <slug> <N|id> <file|->");
      await send(
        `${mockPath(slug)}/surfaces/${encodeURIComponent(which)}`,
        "PATCH",
        target(flags, { content: readContent(file) }),
        flags,
      );
    } else if (sub === "move") {
      const { values: flags, positionals } = parse({
        allowPositionals: true,
        options: { ...MOCK_FLAGS, to: { type: "string" } },
      });
      const slug = requireMock(flags, "mockpit surface move --mock writer 2 --to 0");
      const which = positionals[0];
      if (!which || flags.to === undefined)
        fail("usage: mockpit surface move --mock <slug> <N|id> --to <M>");
      const mock = await api(
        `${mockPath(slug)}${query({ project: resolveProject(flags).name })}`,
        {},
        { report: "die" },
      );
      const variants = (mock.variants ?? []).filter(
        (v) =>
          (flags.state === undefined || v.state === flags.state) &&
          (flags.variant === undefined || v.variant === flags.variant),
      );
      if (variants.length !== 1) {
        die(
          `${slug} has ${variants.length} matching variants; pass --state and --variant`,
          `mockpit show --mock ${slug}`,
        );
      }
      const ids = variants[0].surfaces.map((s) => s.id ?? String(s.index));
      let fromIdx = ids.indexOf(which);
      if (fromIdx < 0) fromIdx = Number(which);
      const toIdx = Number(flags.to);
      if (!Number.isInteger(fromIdx) || fromIdx < 0 || fromIdx >= ids.length)
        fail(`surface "${which}" not found`);
      if (!Number.isInteger(toIdx) || toIdx < 0 || toIdx >= ids.length) {
        fail(`--to must be a valid index (0-${ids.length - 1})`);
      }
      const order = ids.map((_, i) => i);
      const [moved] = order.splice(fromIdx, 1);
      order.splice(toIdx, 0, moved);
      await send(
        `${mockPath(slug)}/surfaces`,
        "PATCH",
        target(flags, { state: variants[0].state, variant: variants[0].variant, order }),
        flags,
      );
    } else {
      fail(`unknown surface subcommand: ${sub} (use add, remove, edit, or move)`);
    }
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
        await api("/api/mocks", {
          method: "POST",
          body: JSON.stringify({
            session: session.id,
            project: DEMO.project,
            mock: DEMO.slug,
            title: DEMO.title,
            state: state.label,
            variant: variant.name,
            knobs: DEMO.knobs,
            surfaces: [{ kind: "html", html: DEMO.render(state, variant) }],
          }),
        });
      }
    }
    await api(`${mockPath(DEMO.slug)}/asks`, {
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
      if (flags.json) return out(result.design);
      for (const a of result.added) {
        if (!flags.quiet) console.log(`added ${a.prefix} (${a.count} icons)`);
      }
      return;
    }
    if (sub === "remove") {
      const stored = await api(`${projectPath(project)}/design`);
      const installed = stored?.iconSets ?? [];
      for (const set of sets) {
        if (installed.some((s) => s.prefix === set)) continue;
        fail(
          BUNDLED_ICON_SETS.includes(set)
            ? `${set} is bundled with the server and cannot be removed`
            : `${set} is not installed for ${project}`,
        );
      }
      const design = await api(`${projectPath(project)}/design`, {
        method: "PUT",
        body: JSON.stringify({
          ...stored,
          iconSets: installed.filter((s) => !sets.includes(s.prefix)),
        }),
      });
      if (flags.json) return out(design);
      if (!flags.quiet) console.log(`removed ${sets.join(", ")}`);
      return;
    }
    fail(`unknown icons command "${sub}" — run "mockpit icons --help"`);
  },

  async kits() {
    parse();
    out(await api("/api/kits"));
  },

  async guide() {
    const { values: flags } = parse({
      options: {
        brief: { type: "boolean" },
        topic: { type: "string" },
        project: { type: "string" },
      },
    });
    if (flags.topic !== undefined) return printTopic(flags.topic);
    if (flags.brief) return printBrief(flags);
    return printTopic("html");
  },

  async setup() {
    parse();
    console.log(await fetchTextWithFallback("/setup", join(ROOT, "guide", "AGENT_SETUP.md")));
  },

  async "agent-howto"() {
    const { values: flags } = parse({
      options: { topic: { type: "string" }, project: { type: "string" } },
    });
    if (flags.topic !== undefined) return printTopic(flags.topic);
    return printBrief(flags);
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
      `mockpit agent-howto --topic ${topics[0]}`,
    );
  }
  const path = `/agent-howto?${new URLSearchParams({ topic })}`;
  console.log(await fetchTextWithFallback(path, join(TOPICS_DIR, `${topic}.md`)));
}

// The brief is rendered from the project's stored design settings, so unlike
// a topic it has no bundled copy to fall back on.
async function printBrief(flags) {
  const params = new URLSearchParams({ project: resolveProject(flags).name });
  let res;
  try {
    res = await fetch(`${BASE}/agent-howto?${params}`);
  } catch {
    die(`cannot reach mockpit at ${BASE}`, "mockpit serve");
  }
  if (!res.ok) die(`mockpit at ${BASE} answered ${res.status}`, "mockpit serve");
  console.log(await res.text());
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
