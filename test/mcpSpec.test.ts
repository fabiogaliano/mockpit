import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { z } from "zod/v4";
import {
  HTTP_MCP_TOOLS,
  MCP_INSTRUCTIONS,
  MCP_TOOL_DEFS,
  MCP_TOOL_NAMES,
  STDIO_MCP_CATALOG,
  STDIO_MCP_TOOLS,
} from "../server/mcpSpec.ts";
import { validateSurfaces } from "../server/postSurfaces.ts";
import {
  isSandboxedSurfaceKind,
  isSurfaceKind,
  SANDBOXED_SURFACE_KINDS,
  SURFACE_CONTENT_FIELDS,
  SURFACE_FRAME_CLASSES,
  SURFACE_KIND_METADATA,
  SURFACE_KINDS,
  type Surface,
} from "../server/types.ts";

// This suite guards the regression where a surface kind shipped to CLI/REST
// but never reached the MCP schemas — publishable on two tiers and invisible on
// the third. It pins the HTTP JSON-Schema enum, the stdio zod enum and the
// runtime validator to the one canonical list (SURFACE_KINDS).

const EXPECTED_TOOLS = ["publish", "ask", "read", "feedback", "say", "export", "upload", "guide"];

// What a model reads per catalog (name, description, inputSchema, _meta). The
// eight-tool catalog measured 7.6 KB (HTTP) and 7.2 KB (stdio) with the surface
// schema one $defs entry on publish (from 15.7 / 15.3 KB for fourteen tools).
// Output schemas are budgeted apart: only typed/codemode harnesses read them.
// Growth past these is bloat, not scope.
const BUDGET_HTTP = 8_000;
const BUDGET_STDIO = 7_500;
const BUDGET_OUTPUT = 6_000;
const ALWAYS_LOADED = ["publish", "ask", "feedback", "guide"];

const modelBytes = (tools: object[]) =>
  Buffer.byteLength(JSON.stringify(tools.map(({ outputSchema: _, ...rest }: any) => rest)));
const outputBytes = (tools: object[]) =>
  Buffer.byteLength(JSON.stringify(tools.map((t: any) => t.outputSchema ?? null)));

const httpTool = (name: string) => {
  const tool = HTTP_MCP_TOOLS.find((t) => t.name === name);
  assert.ok(tool, `${name} must exist`);
  return tool as any;
};
const stdioTool = (name: string) => {
  const tool = STDIO_MCP_TOOLS.find((t) => t.name === name);
  assert.ok(tool, `${name} must exist`);
  return tool;
};

// The surface JSON Schema a client receives for the publish tool.
const httpSurfaceSchema = httpTool("publish").inputSchema.$defs.Surface;
const httpKindEnum = httpSurfaceSchema.properties.kind.enum as string[];

// A representative valid example per kind, including optional fields, so a
// field missing from the MCP schema surfaces here.
const EXAMPLES: Record<(typeof SURFACE_KINDS)[number], Surface> = {
  html: { kind: "html", html: "<p>hi</p>", kits: ["issues"] },
  diff: {
    kind: "diff",
    patch: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b",
    files: [{ filename: "a.ts", before: "a", after: "b", language: "ts" }],
    layout: "split",
  },
  image: { kind: "image", assetId: "asset123", alt: "screenshot", caption: "after" },
  markdown: { kind: "markdown", markdown: "# heading" },
  terminal: { kind: "terminal", text: "$ ls\nfile.txt", cols: 80, title: "shell" },
  mermaid: { kind: "mermaid", mermaid: "flowchart TD\nA-->B" },
  json: { kind: "json", data: { ok: true, items: [1, 2, 3] } },
  code: { kind: "code", code: "const x = 1;", language: "ts", title: "x.ts", lineStart: 10 },
};

test("both transports advertise exactly the mock tool set", () => {
  assert.deepEqual(MCP_TOOL_NAMES, EXPECTED_TOOLS);
  assert.deepEqual(
    HTTP_MCP_TOOLS.map((t) => t.name),
    EXPECTED_TOOLS,
  );
  assert.deepEqual(
    STDIO_MCP_TOOLS.map((t) => t.name),
    EXPECTED_TOOLS,
  );
});

test("HTTP and stdio params agree except the documented transport-specific ones", () => {
  for (const def of MCP_TOOL_DEFS) {
    const httpOnly = new Set(def.httpOnly ?? []);
    const stdioExtra = new Set(Object.keys(def.stdioExtra ?? {}));
    const http = Object.keys(httpTool(def.name).inputSchema.properties);
    const stdio = Object.keys(stdioTool(def.name).inputSchema);
    assert.deepEqual(
      http.filter((k) => !httpOnly.has(k)).sort(),
      stdio.filter((k) => !stdioExtra.has(k)).sort(),
      `${def.name} params drifted between transports`,
    );
    for (const key of httpOnly) assert.ok(!stdio.includes(key), `${def.name}.${key} is http-only`);
    for (const key of stdioExtra) {
      assert.ok(!http.includes(key), `${def.name}.${key} is stdio-only`);
    }
  }
});

test("the mock is required where a tool addresses one; feedback needs a session on HTTP", () => {
  for (const name of ["publish", "ask", "say", "export"]) {
    assert.ok(httpTool(name).inputSchema.required?.includes("mock"), `${name} requires mock`);
  }
  assert.equal(httpTool("read").inputSchema.required, undefined, "read lists without a mock");
  assert.deepEqual(httpTool("feedback").inputSchema.required, ["session"]);
  // Over stdio the server owns the conversation's session.
  assert.equal(stdioTool("feedback").inputSchema.session, undefined);
  assert.ok(z.object(stdioTool("feedback").inputSchema).safeParse({}).success);
});

test("nothing in the catalog waits", () => {
  const catalog = JSON.stringify(HTTP_MCP_TOOLS) + MCP_INSTRUCTIONS;
  assert.doesNotMatch(catalog, /timeoutSeconds|wait_for|\bwait\b|55 s|230/);
  assert.ok(
    MCP_INSTRUCTIONS.includes("A choice is several variants plus one ask that binds them."),
  );
});

test("ask advertises options bound to variants or knob values", () => {
  const asks = httpTool("ask").inputSchema.properties.asks;
  const option = asks.items.properties.options.items;
  assert.ok(option.properties.variant, "options bind to a variant");
  assert.ok(option.properties.set, "options bind to knob values");
  assert.deepEqual(asks.items.required, ["text", "options"]);
  const schema = z.object(stdioTool("ask").inputSchema);
  assert.ok(
    schema.safeParse({
      mock: "writer",
      asks: [{ text: "Which look?", options: [{ label: "Dark", variant: "dark" }] }],
    }).success,
  );
  assert.equal(schema.safeParse({ mock: "writer", asks: [{ text: "no options" }] }).success, false);
});

test("HTTP publish advertises exactly the canonical kind set", () => {
  assert.deepEqual([...httpKindEnum].sort(), [...SURFACE_KINDS].sort());
  assert.ok(!httpKindEnum.includes("trace"));
});

test("HTTP publish advertises every field used by canonical examples", () => {
  const assertFieldsAdvertised = (schema: any, value: object, path: string) => {
    assert.ok(schema?.properties, `${path} must advertise object properties`);
    for (const [key, nested] of Object.entries(value)) {
      assert.ok(Object.hasOwn(schema.properties, key), `${path} must advertise ${key}`);
      if (Array.isArray(nested) && typeof nested[0] === "object" && nested[0] !== null) {
        assertFieldsAdvertised(schema.properties[key].items, nested[0], `${path}.${key}[]`);
      }
    }
  };
  for (const kind of SURFACE_KINDS) {
    assertFieldsAdvertised(httpSurfaceSchema, EXAMPLES[kind], `surface ${kind}`);
  }
  assert.equal(httpSurfaceSchema.properties.steps, undefined, "trace fields are gone");
});

test("compact MCP schemas retain critical surface semantics", () => {
  assert.match(httpSurfaceSchema.properties.html.description, /body fragment/);
  assert.match(httpSurfaceSchema.properties.markdown.description, /raw HTML is escaped/);
  assert.match(httpSurfaceSchema.properties.mermaid.description, /do not set colors/);
  assert.match(httpSurfaceSchema.properties.assetId.description, /upload/);
  assert.match(httpSurfaceSchema.properties.id.description, /alone keeps it/);
  assert.match(httpSurfaceSchema.properties.lineStart.description, /1-based/);
  assert.match(httpTool("publish").inputSchema.properties.knobs.description, /tunekit/);
});

test("the stdio publish schema accepts every kind and rejects an unknown one", () => {
  const publish = z.object(stdioTool("publish").inputSchema);
  for (const kind of SURFACE_KINDS) {
    const result = publish.safeParse({ mock: "m", surfaces: [EXAMPLES[kind]] });
    assert.ok(
      result.success,
      `stdio schema rejected "${kind}": ${result.success ? "" : result.error}`,
    );
  }
  assert.ok(publish.safeParse({ mock: "m", surfaces: [{ id: "s1" }, EXAMPLES.html] }).success);
  assert.equal(
    publish.safeParse({ mock: "m", surfaces: [{ kind: "bogus", html: "x" }] }).success,
    false,
  );
  assert.equal(
    publish.safeParse({ mock: "m", surfaces: [{ kind: "trace", steps: [] }] }).success,
    false,
  );
});

test("the runtime validator accepts a representative example of every kind", async () => {
  for (const kind of SURFACE_KINDS) {
    const result = await validateSurfaces([EXAMPLES[kind]]);
    assert.ok(result.ok, `validator rejected kind "${kind}": ${result.ok ? "" : result.error}`);
  }
});

test("instructions speak the mock vocabulary and nothing retired remains", () => {
  assert.match(MCP_INSTRUCTIONS, /mock/);
  assert.match(MCP_INSTRUCTIONS, /state/);
  assert.match(MCP_INSTRUCTIONS, /variant/);
  assert.doesNotMatch(MCP_INSTRUCTIONS, /\bitems?\b/);
  const catalog = JSON.stringify(HTTP_MCP_TOOLS) + MCP_INSTRUCTIONS;
  for (const retired of [
    "publish_item",
    "revise_item",
    "list_items",
    "get_item",
    "export_item",
    "publish_post",
    "update_post",
    "list_posts",
    "get_post",
    "publish_surface",
    "update_surface",
    "publish_snippet",
    "update_snippet",
    "list_surfaces",
    "send_test_post",
    "init_project",
    "MOCKPIT_MCP_LEGACY",
  ]) {
    assert.ok(!catalog.includes(retired), `${retired} must not be advertised`);
  }
});

test("MCP instructions and tool schemas stay within their context budgets", () => {
  assert.ok(Buffer.byteLength(MCP_INSTRUCTIONS) <= 500, "MCP instructions exceeded 500 bytes");
  assert.ok(modelBytes(HTTP_MCP_TOOLS) <= BUDGET_HTTP, `HTTP MCP tools exceeded ${BUDGET_HTTP}`);
  assert.ok(
    outputBytes(HTTP_MCP_TOOLS) <= BUDGET_OUTPUT,
    `outputSchemas exceeded ${BUDGET_OUTPUT}`,
  );
});

test("the surface schema is declared once, by reference", () => {
  const schema = httpTool("publish").inputSchema;
  assert.deepEqual(schema.properties.surfaces.items, { $ref: "#/$defs/Surface" });
  assert.equal(JSON.stringify(schema).split('"lineStart"').length - 1, 1, "no inlined copy");
  const others = HTTP_MCP_TOOLS.filter((t) => t.name !== "publish");
  assert.ok(!JSON.stringify(others).includes('"lineStart"'), "only publish carries surfaces");
});

test("both catalogs mark the core loop alwaysLoad and compile under the SDK's validator", () => {
  const ajv = new AjvJsonSchemaValidator();
  for (const tools of [HTTP_MCP_TOOLS, STDIO_MCP_CATALOG] as any[][]) {
    assert.deepEqual(
      tools.filter((t) => t._meta?.["anthropic/alwaysLoad"] === true).map((t) => t.name),
      ALWAYS_LOADED,
    );
    for (const t of tools) {
      // What an Ajv-based client does before it trusts structuredContent.
      ajv.getValidator(t.inputSchema);
      if (t.outputSchema) ajv.getValidator(t.outputSchema);
      assert.ok(!JSON.stringify(t).includes('"$schema"'), `${t.name} carries no $schema`);
    }
  }
  assert.deepEqual(
    STDIO_MCP_TOOLS.filter((t) => t._meta).map((t) => t.name),
    ALWAYS_LOADED,
    "stdio registers the same _meta it lists",
  );
});

test("the serialized stdio MCP catalog stays within budget and lists only mock tools", () => {
  const input = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "size-test", version: "1" },
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  ]
    .map((message) => JSON.stringify(message))
    .join("\n");
  const result = spawnSync(process.execPath, [join(import.meta.dirname, "../mcp/server.ts")], {
    input: `${input}\n`,
    encoding: "utf8",
    timeout: 5_000,
    env: { ...process.env, MOCKPIT_MCP_LEGACY: "1" },
  });

  assert.equal(result.status, 0, result.stderr);
  const responses = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const list = responses.find((response) => response.id === 2);
  assert.ok(list, "stdio MCP server omitted the tools/list response");
  // The legacy switch is gone: setting it must not resurrect retired tools.
  assert.deepEqual(
    list.result.tools.map((t: { name: string }) => t.name),
    EXPECTED_TOOLS,
  );
  // stdio lists the shared compact catalog, not the SDK's own zod serialization.
  assert.deepEqual(list.result.tools, STDIO_MCP_CATALOG);
  assert.ok(
    modelBytes(list.result.tools) <= BUDGET_STDIO,
    `stdio MCP tools exceeded ${BUDGET_STDIO}`,
  );
});

test("surface-kind metadata covers every kind and drives derived helpers", () => {
  assert.deepEqual(Object.keys(SURFACE_KIND_METADATA).sort(), [...SURFACE_KINDS].sort());
  for (const kind of SURFACE_KINDS) {
    assert.equal(isSurfaceKind(kind), true);
    assert.equal(isSandboxedSurfaceKind(kind), SANDBOXED_SURFACE_KINDS.includes(kind));
  }
  assert.equal(isSurfaceKind("bogus"), false);
  assert.equal(isSurfaceKind("trace"), false);
  assert.equal(isSurfaceKind("toString"), false);
  assert.equal(isSandboxedSurfaceKind("bogus"), false);
  assert.equal(SURFACE_CONTENT_FIELDS.html, "html");
  assert.equal(SURFACE_CONTENT_FIELDS.diff, "patch");
  assert.equal(SURFACE_CONTENT_FIELDS.json, "data");
  assert.equal(SURFACE_FRAME_CLASSES.markdown, "mdframe");
  assert.equal(SURFACE_FRAME_CLASSES.html, undefined);
});
