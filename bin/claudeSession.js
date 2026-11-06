// Which Claude Code conversation is current in the Claude Code process above us.
// /clear starts a new conversation (a new session id) in the same process, and
// nothing tells a child about it: a stdio MCP server keeps the id it was spawned
// with, and the CLI's state file is keyed by that same process. Claude Code writes
// each process's current id to <config dir>/sessions/<pid>.json, so this reads it.
// Built-ins only; any failure is null, and callers keep the id they have.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const sessionsDir = () =>
  join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "sessions");

function parentOf(pid) {
  try {
    const out = execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return Number(out.trim()) || 0;
  } catch {
    return 0;
  }
}

// The nearest ancestor with a sessions file: the parent when Claude Code spawns us
// directly, a few hops up through sh, npx or a Bash tool's shell otherwise. The
// ancestry never changes, so it is looked up once.
let claudePid;
function findClaudePid() {
  let pid = process.ppid;
  for (let hops = 0; hops < 6 && pid > 1; hops++) {
    if (existsSync(join(sessionsDir(), `${pid}.json`))) return pid;
    if (process.platform === "win32") return null;
    pid = parentOf(pid);
  }
  return null;
}

export function currentClaudeSession() {
  if (claudePid === undefined) claudePid = findClaudePid();
  if (!claudePid) return null;
  try {
    const { sessionId } = JSON.parse(
      readFileSync(join(sessionsDir(), `${claudePid}.json`), "utf8"),
    );
    return typeof sessionId === "string" && sessionId ? sessionId : null;
  } catch {
    return null;
  }
}
