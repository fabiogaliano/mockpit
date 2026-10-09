// Diagnose how agents used mockpit, after the fact. Three sources, joined by
// ids: the workspace DB (sessions, asks, replies, the agentSeq cursor), the
// server's event log (every agent call and viewer write, see
// server/eventLog.ts), and the agent's own transcript (Claude Code's
// ~/.claude/projects/<cwd>/<uuid>.jsonl; a Claude Code session's mockpit key
// is `claude-code:<uuid>`). Read-only on all three.
//
//   node scripts/inspect.ts find [--since 2026-10-09]       transcripts that called mockpit
//   node scripts/inspect.ts sessions [--since …] [--project …]
//   node scripts/inspect.ts undelivered                     replies their session never received
//   node scripts/inspect.ts log [--session id] [--mock slug] [--client cli] [--since …] [--limit 50]
//   node scripts/inspect.ts transcript <session id | transcript uuid | path.jsonl> [--full]
//
// MOCKPIT_DB, MOCKPIT_LOG and CLAUDE_CONFIG_DIR point it elsewhere.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const DB = process.env.MOCKPIT_DB ?? join(homedir(), ".mockpit", "mockpit.db");
const LOG = process.env.MOCKPIT_LOG || join(dirname(DB), "events.jsonl");
const PROJECTS = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");

const { positionals, values: flags } = parseArgs({
  allowPositionals: true,
  options: {
    since: { type: "string" },
    project: { type: "string" },
    session: { type: "string" },
    mock: { type: "string" },
    client: { type: "string" },
    limit: { type: "string" },
    full: { type: "boolean" },
  },
});
const [command, target] = positionals;
const since = flags.since ? new Date(flags.since).getTime() : 0;

type Row = Record<string, any>;
let db: DatabaseSync | undefined;
function query(sql: string, ...params: (string | number)[]): Row[] {
  db ??= new DatabaseSync(DB, { readOnly: true });
  return db.prepare(sql).all(...params) as Row[];
}

const clip = (s: string, n: number) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
};

// --- transcripts ---

function transcriptFiles(): string[] {
  if (!existsSync(PROJECTS)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".jsonl")) out.push(p);
    }
  };
  walk(PROJECTS);
  return out;
}

function lines(file: string): Row[] {
  const rows: Row[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // A transcript being written ends mid-line.
    }
  }
  return rows;
}

const isMockpitCall = (block: Row) =>
  block.type === "tool_use" &&
  (/mockpit/.test(block.name) ||
    (block.name === "Bash" && /\bmockpit\b/.test(String(block.input?.command ?? ""))));

const resultText = (block: Row): string =>
  Array.isArray(block.content)
    ? block.content.map((c: Row) => c.text ?? "").join(" ")
    : String(block.content ?? "");

function find() {
  const rows = [];
  for (const file of transcriptFiles()) {
    const mtime = statSync(file).mtimeMs;
    if (mtime < since) continue;
    const raw = readFileSync(file, "utf8");
    if (!raw.includes("mockpit")) continue;
    let calls = 0;
    let prompt = "";
    for (const r of lines(file)) {
      if (r.type === "assistant") {
        for (const b of r.message?.content ?? []) if (isMockpitCall(b)) calls++;
      } else if (!prompt && r.type === "user" && typeof r.message?.content === "string") {
        if (!r.message.content.startsWith("<")) prompt = r.message.content;
      }
    }
    if (calls) rows.push({ mtime, calls, file, prompt });
  }
  for (const r of rows.sort((a, b) => a.mtime - b.mtime)) {
    console.log(
      `${new Date(r.mtime).toISOString().slice(0, 16)}  ${String(r.calls).padStart(3)} calls  ${r.file.slice(PROJECTS.length + 1)}`,
    );
    if (r.prompt) console.log(`    ${clip(r.prompt, 140)}`);
  }
}

function transcriptFor(ref: string): string | undefined {
  if (ref.endsWith(".jsonl")) return ref;
  const sessions = existsSync(DB) ? query("SELECT key FROM sessions WHERE id = ?", ref) : [];
  const uuid = String(sessions[0]?.key ?? ref).replace(/^claude-code:/, "");
  return transcriptFiles().find((f) => basename(f) === `${uuid}.jsonl`);
}

function transcript(ref: string | undefined) {
  if (!ref) throw new Error("transcript <session id | transcript uuid | path.jsonl>");
  const file = transcriptFor(ref);
  if (!file) {
    throw new Error(
      `no transcript for ${ref}: only sessions with a claude-code key map to one — try \`find\` and pass the path`,
    );
  }
  const n = flags.full ? 4000 : 1;
  const callIds = new Set<string>();
  let afterResult = false;
  for (const r of lines(file)) {
    const at = String(r.timestamp ?? "").slice(11, 19);
    const content = r.message?.content;
    if (r.type === "user" && typeof content === "string") {
      if (!content.startsWith("<local-command") && !content.startsWith("<command-")) {
        console.log(`\n${at} USER  ${clip(content, 300 * n)}`);
      }
      afterResult = false;
    } else if (r.type === "user" && Array.isArray(content)) {
      for (const b of content) {
        if (b.type === "tool_result" && callIds.has(b.tool_use_id)) {
          console.log(`${at} <<<   ${clip(resultText(b), 600 * n)}`);
          afterResult = true;
        }
      }
    } else if (r.type === "assistant") {
      for (const b of content ?? []) {
        if (isMockpitCall(b)) {
          callIds.add(b.id);
          const name = b.name.replace(/^mcp__mockpit__/, "");
          const input = b.name === "Bash" ? b.input.command : JSON.stringify(b.input);
          console.log(`${at} CALL  ${name} ${clip(String(input), 400 * n)}`);
        } else if (b.type === "text" && afterResult) {
          // What the agent made of a mockpit result is where misreadings show.
          console.log(`${at} SAID  ${clip(b.text, 500 * n)}`);
          afterResult = false;
        }
      }
    }
  }
}

// --- the workspace DB ---

function sessions() {
  const rows = query(
    `SELECT s.*,
       (SELECT count(*) FROM comments c WHERE c.sessionId = s.id AND c.kind = 'ask') AS asks,
       (SELECT count(*) FROM comments c WHERE c.sessionId = s.id AND c.kind = 'reply') AS replies,
       (SELECT count(*) FROM comments c WHERE c.sessionId = s.id AND c.author = 'user' AND c.seq > s.agentSeq) AS unheard
     FROM sessions s WHERE s.lastActiveAt >= ? ${flags.project ? "AND s.project = ?" : ""}
     ORDER BY s.createdAt`,
    new Date(since).toISOString(),
    ...(flags.project ? [flags.project] : []),
  );
  for (const s of rows) {
    const file = s.key ? transcriptFor(s.id) : undefined;
    console.log(
      `${s.createdAt.slice(0, 16)}  ${s.id}  ${s.agent}  ${s.project ?? "-"}  "${s.title ?? ""}"  ` +
        `asks ${s.asks} replies ${s.replies} cursor ${s.agentSeq}${s.unheard ? `  UNHEARD ${s.unheard}` : ""}`,
    );
    console.log(
      `    ${s.cwd ?? "-"}  ${file ? file.slice(PROJECTS.length + 1) : s.key ? `${s.key} (no transcript)` : "no key"}`,
    );
  }
}

// A Send whose seq is past its session's cursor never reached the agent. One
// in a session the agent abandoned (a restart that started a new session) is
// how a reply gets lost.
function undelivered() {
  const rows = query(
    `SELECT c.seq, c.createdAt, c.kind, c.sessionId, s.agentSeq, s.lastActiveAt, s.key, m.project, m.slug,
       (SELECT count(*) FROM sessions o WHERE o.cwd = s.cwd AND o.createdAt > c.createdAt) AS later
     FROM comments c JOIN sessions s ON s.id = c.sessionId LEFT JOIN mocks m ON m.id = c.mockId
     WHERE c.author = 'user' AND c.seq > s.agentSeq ORDER BY c.seq`,
  );
  if (!rows.length) return console.log("every user comment and reply was delivered");
  for (const r of rows) {
    console.log(
      `seq ${r.seq}  ${r.createdAt.slice(0, 16)}  ${r.kind}  ${r.project}/${r.slug}  session ${r.sessionId} (cursor ${r.agentSeq}, last active ${r.lastActiveAt.slice(0, 16)}${r.key ? "" : ", no key"})` +
        (r.later ? `  — ${r.later} newer session(s) in the same cwd: likely orphaned` : ""),
    );
  }
}

// --- the event log ---

function log() {
  const files = [`${LOG}.1`, LOG].filter((f) => existsSync(f));
  if (!files.length)
    throw new Error(`no event log at ${LOG} (MOCKPIT_LOG=off, or a server older than the log)`);
  const out: Row[] = [];
  for (const f of files) {
    for (const e of lines(f)) {
      if (since && Date.parse(e.t) < since) continue;
      if (flags.session && e.session !== flags.session) continue;
      if (flags.mock && e.mock !== flags.mock) continue;
      if (flags.client && !String(e.client).startsWith(flags.client)) continue;
      out.push(e);
    }
  }
  for (const e of out.slice(-Number(flags.limit ?? 50))) {
    const { t, op, client, status, ms, ...rest } = e;
    const extra = Object.entries(rest)
      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : v}`)
      .join(" ");
    console.log(
      `${t.slice(0, 19)}  ${status}  ${String(ms).padStart(5)}ms  ${client.padEnd(16)} ${op}  ${extra}`,
    );
  }
}

const commands: Record<string, () => void> = {
  find,
  sessions,
  undelivered,
  log,
  transcript: () => transcript(target),
};
const run = commands[command ?? ""];
if (!run) {
  console.error(readFileSync(new URL(import.meta.url), "utf8").split("\nimport")[0]);
  process.exit(2);
}
try {
  run();
} catch (err) {
  console.error(`inspect: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
