// Waits for a Send on each mockpit session this OpenCode process has used, and
// wakes the OpenCode session that last called it. Nothing runs before a mockpit call.
// One default export serves both OpenCode lines: 1.x calls server() and 2.x setup(),
// and 2.x doesn't run 1.x plugins. No imports, so the package has no dependencies.

const BASE = (process.env.MOCKPIT_URL || "http://localhost:8228").replace(/\/+$/, "");
const HEADERS = {
  "x-mockpit-client": "opencode",
  ...(process.env.MOCKPIT_TOKEN ? { authorization: `Bearer ${process.env.MOCKPIT_TOKEN}` } : {}),
};

const pause = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

// A shell command, or 2.x's code tool, which is how it calls MCP tools, names mockpit
// only in its arguments.
const isMockpitCall = (tool, args) =>
  /mockpit/i.test(tool) ||
  (/^(bash|shell|execute)$/i.test(tool) && /\bmockpit/.test(JSON.stringify(args ?? "")));

// A write's result names its session. The rest don't, and the MCP server records the
// directory it runs in, so the newest session there is this process's own.
async function mockpitSession(output, directory) {
  const named = /\\?"sessionId\\?"\s*:\s*\\?"([^"\\]+)/.exec(output ?? "")?.[1];
  if (named) return named;
  const res = await fetch(`${BASE}/api/sessions`, { headers: HEADERS });
  if (!res.ok) return undefined;
  const newest = (await res.json())
    .filter((s) => s.cwd === directory)
    .sort((a, b) => String(b.lastActiveAt).localeCompare(String(a.lastActiveAt)))[0];
  return newest?.id;
}

const wakeText = (batches) =>
  `The user replied in the mockpit viewer on ${[...new Set(batches.map((b) => b.design ?? "a design"))].join(", ")}. Call mockpit's feedback for the reply.`;

function createWaker(wake) {
  const callers = new Map();
  const stop = new AbortController();

  async function wait(session) {
    while (!stop.signal.aborted) {
      try {
        const query = new URLSearchParams({ session, author: "user", wait: "60", peek: "1" });
        const res = await fetch(`${BASE}/api/comments?${query}`, {
          headers: HEADERS,
          signal: stop.signal,
        });
        if (!res.ok) {
          await pause(2000, stop.signal);
          continue;
        }
        const batches = (await res.json()).feedback ?? [];
        if (batches.length === 0 || stop.signal.aborted) continue;
        // The reply stays on the session's cursor, so a wake that fails loses only the
        // wake: feedback or the next write still delivers it.
        await wake(callers.get(session), wakeText(batches));
      } catch {
        await pause(2000, stop.signal);
      }
    }
  }

  return {
    async noteCall({ tool, args, output, sessionID, directory }) {
      if (!isMockpitCall(tool, args)) return;
      const session = await mockpitSession(output, directory).catch(() => undefined);
      if (!session) return;
      const known = callers.has(session);
      callers.set(session, sessionID);
      if (!known) void wait(session);
    },
    stop: () => stop.abort(),
  };
}

const text = (result) => (typeof result === "string" ? result : JSON.stringify(result ?? ""));

export default {
  id: "mockpit",

  server: async ({ client, directory }) => {
    const waker = createWaker(async (sessionID, message) => {
      await client.session.promptAsync({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text: message }] },
      });
    });
    return {
      "tool.execute.after": async (input, output) => {
        await waker.noteCall({
          tool: input.tool,
          args: input.args,
          output: output?.output,
          sessionID: input.sessionID,
          directory,
        });
      },
    };
  },

  setup: async (ctx) => {
    const waker = createWaker(async (sessionID, message) => {
      await ctx.session.synthetic({ sessionID, text: message, description: "mockpit reply" });
    });
    await ctx.tool.hook("execute.after", async (event) => {
      await waker.noteCall({
        tool: event.tool,
        args: event.input,
        output: event.status === "completed" ? text(event.result) : undefined,
        sessionID: event.sessionID,
        directory: process.cwd(),
      });
    });
    return () => waker.stop();
  },
};
