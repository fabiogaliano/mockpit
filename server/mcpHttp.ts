import type { Hono } from "hono";
import type { CommentWait, FlowContext, FlowResult } from "./app.ts";
import { decodeBase64 } from "./base64.ts";
import { type GuideTopic, isGuideTopic, unknownTopicMessage } from "./designGuide.ts";
import { HTTP_MCP_TOOLS, MCP_INSTRUCTIONS, MCP_SERVER_INFO, toolResult } from "./mcpSpec.ts";
import type { Asset, AssetKind, Store } from "./types.ts";

// Stateless MCP over streamable HTTP: every request is self-contained, which
// is what a serverless deployment needs. Session continuity is explicit —
// publish_mock returns a sessionId the agent passes back on later calls.

type Flow<A extends unknown[]> = (...args: A) => Promise<FlowResult>;

// The same flows the REST routes call, so every tier returns the same shapes.
export interface McpFlows {
  publish: Flow<[body: any, ctx: FlowContext]>;
  revise: Flow<[body: any, ctx: FlowContext]>;
  list: Flow<[query: { project?: string }]>;
  get: Flow<[ref: unknown, query: { project?: unknown; body?: boolean; history?: boolean }]>;
  ask: Flow<[ref: unknown, body: any, ctx: FlowContext]>;
  exportMock: Flow<
    [
      ref: unknown,
      query: { project?: unknown; state?: unknown; variant?: unknown },
      ctx: FlowContext,
    ]
  >;
  comment: Flow<[body: any, ctx: FlowContext]>;
  feedback: Flow<[query: CommentWait, signal?: AbortSignal]>;
  appendSurface: Flow<[ref: unknown, body: any, ctx: FlowContext]>;
  replaceSurface: Flow<[ref: unknown, target: string, body: any, ctx: FlowContext]>;
  removeSurface: Flow<[ref: unknown, target: string, body: any, ctx: FlowContext]>;
  reorderSurfaces: Flow<[ref: unknown, body: any, ctx: FlowContext]>;
}

export interface McpDeps {
  store: Store;
  basePath?: (request: Request) => string;
  flows: McpFlows;
  uploadAsset(input: {
    data: Uint8Array;
    contentType: string;
    filename?: string;
    kind?: AssetKind;
    session?: string;
  }): Promise<{ asset: Omit<Asset, "data"> } | { error: string; status: number }>;
  // The brief rendered for a project (palette, kit, icons), or one topic.
  guide(project: string, topic?: GuideTopic): string | Promise<string>;
}

// A flow's error status becomes a tool error carrying the same JSON body the
// REST tier returns, so the agent sees the hint (states, variants) either way.
function unwrap(result: FlowResult): unknown {
  if (result.status >= 400) {
    const { error, ...extra } = result.body ?? {};
    throw new Error(
      Object.keys(extra).length ? `${error} ${JSON.stringify(extra)}` : String(error),
    );
  }
  return result.body;
}

// What a wait returns on every tier: the batches plus the cursor.
export function feedbackResult(body: { feedback?: unknown[]; lastSeq?: number }) {
  const feedback = body.feedback ?? [];
  return feedback.length === 0
    ? {
        feedback,
        lastSeq: body.lastSeq,
        note: "no user feedback yet — continue, or wait again later",
      }
    : { feedback, lastSeq: body.lastSeq };
}

export function registerMcp(app: Hono, deps: McpDeps) {
  const { flows, store } = deps;

  async function projectOf(args: any): Promise<string> {
    if (typeof args.project === "string" && args.project) return args.project;
    if (typeof args.session === "string") {
      const session = await store.getSession(args.session);
      if (session?.project) return session.project;
    }
    const projects = await store.listProjects();
    return projects[0]?.name ?? "workspace";
  }

  async function callTool(name: string, args: any, ctx: FlowContext): Promise<unknown> {
    switch (name) {
      case "publish_mock":
        return unwrap(await flows.publish(args, ctx));
      case "revise_mock":
        return unwrap(await flows.revise(args, ctx));
      case "list_mocks":
        return unwrap(await flows.list({ project: args.project }));
      case "get_mock":
        return unwrap(
          await flows.get(args.mock, {
            project: args.project,
            body: args.body === true,
            history: args.history === true,
          }),
        );
      case "ask_user":
        return unwrap(await flows.ask(args.mock, args, ctx));
      case "export_mock":
        return unwrap(await flows.exportMock(args.mock, args, ctx));
      case "wait_for_feedback": {
        if (typeof args.session !== "string" || !args.session) {
          throw new Error("wait_for_feedback needs the session id returned by publish_mock");
        }
        const body = unwrap(
          await flows.feedback(
            {
              sessionId: args.session,
              author: "user",
              waitSeconds: typeof args.timeoutSeconds === "number" ? args.timeoutSeconds : 60,
            },
            ctx.signal,
          ),
        ) as { feedback: unknown[]; lastSeq: number };
        return feedbackResult(body);
      }
      case "reply_to_user":
        return unwrap(await flows.comment({ ...args, text: args.message }, ctx));
      case "add_surface":
        return unwrap(await flows.appendSurface(args.mock, args, ctx));
      case "edit_surface":
        return unwrap(await flows.replaceSurface(args.mock, String(args.target ?? ""), args, ctx));
      case "remove_surface":
        return unwrap(await flows.removeSurface(args.mock, String(args.target ?? ""), args, ctx));
      case "reorder_surfaces":
        return unwrap(await flows.reorderSurfaces(args.mock, args, ctx));
      case "upload_asset": {
        if (typeof args.data !== "string" || args.data.length === 0) {
          throw new Error("upload_asset needs base64 `data`");
        }
        const result = await deps.uploadAsset({
          data: decodeBase64(args.data),
          contentType: typeof args.contentType === "string" ? args.contentType : "",
          filename: typeof args.filename === "string" ? args.filename : undefined,
          kind: args.kind === "image" || args.kind === "file" ? args.kind : undefined,
          session: typeof args.session === "string" ? args.session : undefined,
        });
        if ("error" in result) throw new Error(result.error);
        return {
          id: result.asset.id,
          sessionId: result.asset.sessionId,
          url: `${ctx.base}/a/${result.asset.id}`,
          contentType: result.asset.contentType,
          byteLength: result.asset.byteLength,
          kind: result.asset.kind,
        };
      }
      case "get_design_guide": {
        if (args.topic === undefined) return await deps.guide(await projectOf(args));
        if (!isGuideTopic(args.topic)) throw new Error(unknownTopicMessage(String(args.topic)));
        return await deps.guide("", args.topic);
      }
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  }

  app.post("/mcp", async (c) => {
    const rpc = (id: unknown, result: unknown) => c.json({ jsonrpc: "2.0", id, result });
    const rpcError = (id: unknown, code: number, message: string, status = 200) =>
      c.json({ jsonrpc: "2.0", id, error: { code, message } }, status as 200);

    let msg: any;
    try {
      msg = await c.req.json();
    } catch {
      return rpcError(null, -32700, "parse error", 400);
    }
    if (Array.isArray(msg)) {
      return rpcError(null, -32600, "batch requests are not supported", 400);
    }

    if (msg.method === "initialize") {
      return rpc(msg.id, {
        protocolVersion:
          typeof msg.params?.protocolVersion === "string"
            ? msg.params.protocolVersion
            : "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions: MCP_INSTRUCTIONS,
      });
    }
    if (msg.id === undefined) return c.body(null, 202); // notifications
    if (msg.method === "ping") return rpc(msg.id, {});
    if (msg.method === "tools/list") return rpc(msg.id, { tools: HTTP_MCP_TOOLS });
    if (msg.method === "tools/call") {
      const url = new URL(c.req.url);
      const ctx: FlowContext = {
        base: `${url.origin}${deps.basePath?.(c.req.raw) ?? ""}`,
        // An MCP caller is an agent, never the viewer.
        viewer: false,
        strict: false,
        request: c.req.raw,
        signal: c.req.raw.signal,
      };
      try {
        const name = msg.params?.name;
        return rpc(
          msg.id,
          toolResult(name, await callTool(name, msg.params?.arguments ?? {}, ctx)),
        );
      } catch (err) {
        return rpc(msg.id, {
          content: [{ type: "text", text: `error: ${err instanceof Error ? err.message : err}` }],
          isError: true,
        });
      }
    }
    return rpcError(msg.id, -32601, `method not found: ${msg.method}`);
  });

  // Stateless server: no SSE stream to resume, no session to delete.
  app.get("/mcp", (c) => c.text("mockpit MCP is stateless — POST JSON-RPC messages here", 405));
  app.delete("/mcp", (c) => c.body(null, 405));
}
