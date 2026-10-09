#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  MCP_INSTRUCTIONS,
  MCP_SERVER_INFO,
  runToolResult,
  STDIO_MCP_CATALOG,
  STDIO_MCP_TOOLS,
  STDIO_RUN_CATALOG,
  STDIO_RUN_TOOLS,
  toolResult,
} from "../server/mcpSpec.ts";
import { RUN_INSTRUCTIONS } from "../server/runApi.ts";

// Point at a deployed instance later by setting MOCKPIT_URL.
const API = process.env.MOCKPIT_URL ?? "http://localhost:8228";
const TOKEN = process.env.MOCKPIT_TOKEN;
const AGENT = process.env.MOCKPIT_AGENT ?? "claude-code";
// "code" serves the codemode catalog: one `run` tool instead of the mock tools.
const CODE_MODE = process.env.MOCKPIT_MCP_MODE === "code";

// Names this client in the server's event log; the version is how a stdio
// server left running across an upgrade shows up there.
const CLIENT = `mcp-stdio/${packageVersion()}`;

// Source runs as mcp/server.ts, the published copy as dist/mcp/server.js.
function packageVersion(): string {
  for (const rel of ["../package.json", "../../package.json"]) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), "utf8"),
      );
      if (pkg.name === "mockpit") return String(pkg.version);
    } catch {
      // Not at this depth.
    }
  }
  return "unknown";
}

async function api(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-mockpit-client": CLIENT,
  };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { ...init, headers });
  } catch {
    throw new Error(
      `mockpit server not reachable at ${API} — ask the user to start it with "mockpit serve" or "npm run dev"`,
    );
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text}`);
  return text;
}

// Stdio runs on the agent's machine, so a value may name a file: markup and
// asset bytes never have to travel through the model's context.
function readMaybeFile(value: string): string {
  if (value.includes("\n") || value.length > 512) return value;
  try {
    if (statSync(value).isFile()) return readFileSync(value, "utf8");
  } catch {
    // not a path — it is the content itself
  }
  return value;
}

// Part values may be file paths too, like html; anything not a string map
// goes through untouched so the server reports what is wrong with it.
function readPartFiles(parts: unknown): unknown {
  if (!parts || typeof parts !== "object" || Array.isArray(parts)) return parts;
  return Object.fromEntries(
    Object.entries(parts).map(([k, v]) => [k, typeof v === "string" ? readMaybeFile(v) : v]),
  );
}

// The project this repo is: explicit, environment, git remote, then directory
// name. Same order as the CLI, so both tiers land in the same project.
function resolveProject(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.MOCKPIT_PROJECT) return process.env.MOCKPIT_PROJECT;
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const m = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/);
    if (m) return `${m[1]}/${m[2]}`;
  } catch {
    // not a git checkout
  }
  return process.cwd().split(/[\\/]/).filter(Boolean).pop() ?? "workspace";
}

const ASSET_CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  json: "application/json",
  txt: "text/plain",
  csv: "text/csv",
  pdf: "application/pdf",
};

const contentTypeForPath = (file: string) =>
  ASSET_CONTENT_TYPES[file.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

const enc = encodeURIComponent;
const json = async (path: string, init?: RequestInit) => JSON.parse(await api(path, init));
const post = (path: string, body: unknown, method = "POST") =>
  json(path, { method, body: JSON.stringify(body) });
const query = (params: Record<string, unknown>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== false) q.set(k, v === true ? "1" : String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
};

// One MCP server process lives as long as one agent conversation, so a
// lazily-created session shared across tool calls maps cleanly onto it.
let sessionId: string | null = process.env.MOCKPIT_SESSION ?? null;

// A resumed Claude Code conversation spawns a new MCP process; its session id
// survives the resume, so keying on it hands back the same mockpit session.
const harnessKey = process.env.CLAUDE_CODE_SESSION_ID
  ? `claude-code:${process.env.CLAUDE_CODE_SESSION_ID}`
  : undefined;

// `title` is used only when this call creates the session — once one exists
// (here or in the viewer, where the user can rename it) it is never retitled.
async function ensureSession(title?: string): Promise<string> {
  if (sessionId) return sessionId;
  const session = JSON.parse(
    await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        agent: AGENT,
        cwd: process.cwd(),
        title,
        project: resolveProject(),
        key: harnessKey,
      }),
    }),
  );
  sessionId = session.id as string;
  return sessionId;
}

// Every tool is a pass-through to the REST route the CLI uses, mapped the way
// server/mcpHttp.ts maps HTTP MCP: same request, same response, so the tiers
// cannot drift. Only the session (one per conversation), the project (this
// repo) and file paths are filled in here.
const handlers: Record<string, (args: any) => Promise<unknown>> = {
  async publish(args) {
    const session = await ensureSession(args.sessionTitle);
    const html = typeof args.html === "string" ? readMaybeFile(args.html) : undefined;
    return post("/api/mocks", {
      ...args,
      html,
      parts: readPartFiles(args.parts),
      session,
      agent: AGENT,
      project: resolveProject(args.project),
    });
  },
  async ask(args) {
    const session = await ensureSession();
    return post(`/api/mocks/${enc(args.mock)}/asks`, {
      ...args,
      session,
      project: resolveProject(args.project),
    });
  },
  read: (args) =>
    json(
      args.mock === undefined
        ? `/api/mocks${query({ project: resolveProject(args.project) })}`
        : `/api/mocks/${enc(args.mock)}${query({
            project: resolveProject(args.project),
            body: args.body,
            history: args.history,
          })}`,
    ),
  // Never waits: the server reads from the session's cursor, shared with
  // piggyback and `mockpit watch`, so each Send is delivered exactly once.
  async feedback(args) {
    const session = await ensureSession();
    return json(`/api/feedback${query({ session, project: resolveProject(args.project) })}`);
  },
  async say(args) {
    const session = await ensureSession();
    return post(`/api/mocks/${enc(args.mock)}/say`, {
      state: args.state,
      variant: args.variant,
      project: resolveProject(args.project),
      session,
      message: args.message,
    });
  },
  export: (args) =>
    json(
      `/api/mocks/${enc(args.mock)}/export${query({
        project: resolveProject(args.project),
        state: args.state,
        variant: args.variant,
      })}`,
    ),
  async upload({ path, data, contentType, filename, kind }) {
    const session = await ensureSession();
    // Stdio shares the agent's filesystem, so a path beats base64 in context.
    return post("/api/assets", {
      data: path ? readFileSync(path, "base64") : data,
      contentType: contentType ?? (path ? contentTypeForPath(path) : "application/octet-stream"),
      filename: filename ?? (path ? path.split(/[\\/]/).pop() : undefined),
      kind,
      session,
    });
  },
  // The brief renders this project's real palette, kit, and icons, so the
  // agent never restates them; a topic is the same text on every tier.
  guide: (args) =>
    api(
      `/agent-howto${query(
        args.topic === undefined
          ? { project: resolveProject(args.project) }
          : { topic: args.topic },
      )}`,
    ),
};

// The script travels as a file path when it can, so it is never JSON-escaped
// into the model's tool call.
async function run(args: any) {
  const code =
    typeof args.path === "string" && args.path
      ? readFileSync(args.path, "utf8")
      : typeof args.code === "string"
        ? readMaybeFile(args.code)
        : "";
  if (!code.trim()) throw new Error("run needs code, or path to a .js file");
  const session = await ensureSession();
  return json("/api/run", {
    method: "POST",
    body: JSON.stringify({ code, session, project: resolveProject(args.project), agent: AGENT }),
  });
}

const server = new McpServer(MCP_SERVER_INFO, {
  instructions: CODE_MODE ? RUN_INSTRUCTIONS : MCP_INSTRUCTIONS,
});

if (CODE_MODE) {
  const [{ name, ...config }] = STDIO_RUN_TOOLS;
  server.registerTool(name, config, async (args: any) => runToolResult(await run(args)));
} else {
  for (const tool of STDIO_MCP_TOOLS) {
    const handler = handlers[tool.name];
    const { name, ...config } = tool;
    server.registerTool(name, config, async (args: any) => toolResult(name, await handler(args)));
  }
}
// Replaces the SDK's own listing (registered above), so stdio advertises the
// same compact 2020-12 schemas as HTTP; calls still validate against zod.
server.server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: CODE_MODE ? STDIO_RUN_CATALOG : STDIO_MCP_CATALOG,
}));

await server.connect(new StdioServerTransport());
