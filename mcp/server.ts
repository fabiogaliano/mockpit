#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { feedbackResult } from "../server/mcpHttp.ts";
import { MCP_INSTRUCTIONS, MCP_SERVER_INFO, STDIO_MCP_TOOLS } from "../server/mcpSpec.ts";

// Point at a deployed instance later by setting MOCKPIT_URL.
const API = process.env.MOCKPIT_URL ?? "http://localhost:8228";
const TOKEN = process.env.MOCKPIT_TOKEN;
const AGENT = process.env.MOCKPIT_AGENT ?? "claude-code";

async function api(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
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

const text = (value: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});

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
      }),
    }),
  );
  sessionId = session.id as string;
  return sessionId;
}

// Every tool is a pass-through to the REST route the CLI uses: same request,
// same response, so the three tiers cannot drift. Only the session (one per
// conversation), the project (this repo) and file paths are filled in here.
const handlers: Record<string, (args: any) => Promise<unknown>> = {
  async publish_mock(args) {
    const session = await ensureSession(args.sessionTitle);
    const html = typeof args.html === "string" ? readMaybeFile(args.html) : undefined;
    return post("/api/mocks", {
      ...args,
      html,
      session,
      agent: AGENT,
      project: resolveProject(args.project),
    });
  },
  async revise_mock(args) {
    const session = await ensureSession();
    const html = typeof args.html === "string" ? readMaybeFile(args.html) : undefined;
    return post(`/api/mocks/${enc(args.mock)}/revise`, {
      ...args,
      html,
      session,
      project: resolveProject(args.project),
    });
  },
  list_mocks: (args) => json(`/api/mocks${query({ project: resolveProject(args.project) })}`),
  get_mock: (args) =>
    json(
      `/api/mocks/${enc(args.mock)}${query({
        project: resolveProject(args.project),
        body: args.body,
        history: args.history,
      })}`,
    ),
  async ask_user(args) {
    const session = await ensureSession();
    return post(`/api/mocks/${enc(args.mock)}/asks`, {
      ...args,
      session,
      project: resolveProject(args.project),
    });
  },
  async wait_for_feedback(args) {
    const session = await ensureSession();
    // No client-side cursor: the server resumes author=user reads from the
    // session's agent cursor, shared with piggyback delivery.
    const wait = args.timeoutSeconds ?? 120;
    return feedbackResult(await json(`/api/comments${query({ session, author: "user", wait })}`));
  },
  async reply_to_user(args) {
    const session = await ensureSession();
    return post("/api/comments", {
      mock: args.mock,
      state: args.state,
      variant: args.variant,
      project: resolveProject(args.project),
      session,
      text: args.message,
    });
  },
  export_mock: (args) =>
    json(
      `/api/mocks/${enc(args.mock)}/export${query({
        project: resolveProject(args.project),
        state: args.state,
        variant: args.variant,
      })}`,
    ),
  async upload_asset({ path, data, contentType, filename, kind }) {
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
  // The brief guide renders this project's real palette, kit, and icons, so
  // the agent never restates them.
  get_design_guide: (args) =>
    api(`/agent-howto${query({ brief: true, project: resolveProject(args.project) })}`),
  add_surface: (args) =>
    post(`/api/mocks/${enc(args.mock)}/surfaces`, {
      ...args,
      project: resolveProject(args.project),
    }),
  edit_surface: (args) =>
    post(
      `/api/mocks/${enc(args.mock)}/surfaces/${enc(args.target)}`,
      { ...args, project: resolveProject(args.project) },
      "PATCH",
    ),
  remove_surface: (args) =>
    json(
      `/api/mocks/${enc(args.mock)}/surfaces/${enc(args.target)}${query({
        state: args.state,
        variant: args.variant,
        project: resolveProject(args.project),
      })}`,
      { method: "DELETE" },
    ),
  reorder_surfaces: (args) =>
    post(
      `/api/mocks/${enc(args.mock)}/surfaces`,
      { ...args, project: resolveProject(args.project) },
      "PATCH",
    ),
};

const server = new McpServer(MCP_SERVER_INFO, { instructions: MCP_INSTRUCTIONS });

for (const tool of STDIO_MCP_TOOLS) {
  const handler = handlers[tool.name];
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.inputSchema },
    async (args: any) => text(await handler(args)),
  );
}

await server.connect(new StdioServerTransport());
