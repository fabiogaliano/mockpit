// Prints the per-tool size of the MCP catalog as each transport lists it, to
// see where an agent's fixed context goes. `tool` is what a model reads (name,
// description, inputSchema, _meta); `output` is the outputSchema, which only
// codemode/typed harnesses consume. `--json out.json` saves the numbers;
// `--compare before.json` prints before/after columns.
//
//   node scripts/mcp-catalog-size.ts [--json out.json] [--compare before.json]
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HTTP_MCP_TOOLS } from "../server/mcpSpec.ts";

interface Size {
  tool: number;
  output: number;
}
type Sizes = Record<string, { http: Size; stdio: Size }>;

function stdioTools(): object[] {
  const input = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "size", version: "1" },
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  ]
    .map((m) => JSON.stringify(m))
    .join("\n");
  const run = spawnSync(process.execPath, [join(import.meta.dirname, "../mcp/server.ts")], {
    input: `${input}\n`,
    encoding: "utf8",
    timeout: 10_000,
  });
  if (run.status !== 0) throw new Error(run.stderr);
  const list = run.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((r) => r.id === 2);
  return list.result.tools;
}

function measure(tool: object): Size {
  const { outputSchema, ...rest } = tool as { outputSchema?: unknown };
  return {
    tool: JSON.stringify(rest).length,
    output: outputSchema ? JSON.stringify(outputSchema).length + ',"outputSchema":'.length : 0,
  };
}

const empty = (): Size => ({ tool: 0, output: 0 });
const sizes: Sizes = {};
const row = (name: string) => (sizes[name] ??= { http: empty(), stdio: empty() });
for (const tool of HTTP_MCP_TOOLS) row(tool.name).http = measure(tool);
for (const tool of stdioTools() as { name: string }[]) row(tool.name).stdio = measure(tool);

const sum = (pick: (s: { http: Size; stdio: Size }) => Size): Size =>
  Object.values(sizes).reduce(
    (t, s) => ({ tool: t.tool + pick(s).tool, output: t.output + pick(s).output }),
    empty(),
  );
const total = { http: sum((s) => s.http), stdio: sum((s) => s.stdio) };

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = flag("--json");
if (out) writeFileSync(out, JSON.stringify({ ...sizes, total }, null, 2));
const compare = flag("--compare");
const before: Sizes | undefined = compare ? JSON.parse(readFileSync(compare, "utf8")) : undefined;

const header = before
  ? ["tool", "http before", "http after", "+output", "stdio before", "stdio after", "+output"]
  : ["tool", "http", "+output", "stdio", "+output"];
console.log(`| ${header.join(" | ")} |`);
console.log(`| ${header.map(() => "---").join(" | ")} |`);
for (const [name, s] of [...Object.entries(sizes), ["total", total] as const]) {
  const b = before?.[name];
  const cells = before
    ? [name, b?.http.tool ?? "-", s.http.tool, s.http.output, b?.stdio.tool ?? "-", s.stdio.tool]
    : [name, s.http.tool, s.http.output, s.stdio.tool];
  cells.push(s.stdio.output);
  console.log(`| ${cells.join(" | ")} |`);
}
