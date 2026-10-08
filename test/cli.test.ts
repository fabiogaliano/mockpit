import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "../server/app.ts";
import { SqlStore } from "../server/sqlStore.ts";
import { createSqliteStorage } from "../server/sqliteStorage.ts";
import { serveUrl } from "../bin/serveUrl.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "mockpit.js");

function run(...args: string[]) {
  return runWith({}, ...args);
}

// Richer runner: optional cwd (install-hook writes ./.claude), env (point the
// CLI at the test server), and stdin (the hook reads its payload from stdin).
function testEnv(overrides?: Record<string, string>) {
  const env = { ...process.env };
  delete env.MOCKPIT_URL;
  delete env.MOCKPIT_SESSION;
  delete env.MOCKPIT_AGENT;
  delete env.MOCKPIT_TOKEN;
  return { ...env, ...overrides };
}

function runWith(
  opts: { cwd?: string; env?: Record<string, string>; stdin?: string },
  ...args: string[]
) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = execFile(
      process.execPath,
      [CLI, ...args],
      { cwd: opts.cwd, env: testEnv(opts.env) },
      (err, stdout, stderr) => {
        resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr });
      },
    );
    if (opts.stdin != null) child.stdin!.end(opts.stdin);
  });
}

// A real listening server for the commands that hit the network (the CLI talks
// over fetch, not in-process). Stub viewer so no build is needed.
function serveApp() {
  const store = new SqlStore(createSqliteStorage());
  const app = createApp({
    store,
    viewerHtml: "<html>viewer</html>",
    topics: { html: "# guide" },
    setupText: "# setup",
  });
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      resolve({
        url: `http://localhost:${info.port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            (
              server as typeof server & { closeAllConnections?: () => void }
            ).closeAllConnections?.();
          }),
      });
    });
  });
}

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  }).then((r) => r.json() as Promise<any>);

const getJson = (url: string) => fetch(url).then((r) => r.json() as Promise<any>);

async function waitFor(pred: () => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 50));
  }
}

function tmpFile(name: string, content: string) {
  const dir = mkdtempSync(join(tmpdir(), "mockpit-cli-file-"));
  const file = join(dir, name);
  writeFileSync(file, content);
  return file;
}

const tmpRepo = () => mkdtempSync(join(tmpdir(), "mockpit-cli-repo-"));

async function serveSession() {
  const server = await serveApp();
  const session = await post(`${server.url}/api/sessions`, { agent: "cli-test", title: "CLI" });
  return { ...server, session };
}

// The mock verbs write into the repo they run in (.mockpit/…), so they get a
// throwaway cwd and an explicit project — never the checkout this test runs in.
// The session is pinned via env so state-file resolution never leaks across tests.
function cli(
  server: { url: string; session: { id: string } },
  opts: { cwd?: string; project?: string },
  ...args: string[]
) {
  return runWith(
    {
      cwd: opts.cwd ?? tmpRepo(),
      env: {
        MOCKPIT_URL: server.url,
        MOCKPIT_SESSION: server.session.id,
        MOCKPIT_PROJECT: opts.project ?? "acme/site",
      },
    },
    ...args,
  );
}

const mockId = async (url: string, slug = "writer", project = "acme/site") =>
  (await getJson(`${url}/api/mocks?project=${encodeURIComponent(project)}`)).mocks.find(
    (m: any) => m.slug === slug,
  ).id as string;

// Two states, two variants of the first: the shape most loop tests start from.
async function seedWriter(server: { url: string; session: { id: string } }) {
  const quiet = tmpFile("q.html", '<h1 data-part="title">T</h1><p data-part="body">b</p>');
  const dark = tmpFile("d.html", '<h1 data-part="title">T</h1><p data-part="body">dark</p>');
  const lab = tmpFile("l.html", '<aside data-part="lab">L</aside>');
  for (const [state, variant, file] of [
    ["Writing", "quiet", quiet],
    ["Writing", "dark", dark],
    ["Lab open", "quiet", lab],
  ]) {
    const r = await cli(
      server,
      {},
      "publish",
      "--mock",
      "writer",
      "--state",
      state,
      "--variant",
      variant,
      "--html",
      file,
      "--quiet",
    );
    assert.equal(r.code, 0, r.stderr);
  }
  return mockId(server.url);
}

const viewerReply = (url: string, id: string, body: unknown) =>
  post(`${url}/api/mocks/${id}/reply`, body);

// --- version / help / parsing ----------------------------------------------

for (const flag of ["--version", "-V", "version"]) {
  test(`${flag} prints the version`, async () => {
    const { code, stdout } = await run(flag);
    assert.equal(code, 0);
    assert.match(stdout, /^mockpit \d+\.\d+\.\d+/);
  });
}

test("serve --open URL uses the concrete bind address", () => {
  assert.equal(serveUrl(undefined, "8228"), "http://localhost:8228");
  assert.equal(serveUrl("0.0.0.0", "8228"), "http://localhost:8228");
  assert.equal(serveUrl("::", "8228"), "http://localhost:8228");
  assert.equal(serveUrl("127.0.0.2", "8228"), "http://127.0.0.2:8228");
  assert.equal(serveUrl("::1", "8228"), "http://[::1]:8228");
});

// None of these reach the network: --help resolves in parsing.
for (const cmd of [
  "serve",
  "init",
  "publish",
  "revise",
  "ask",
  "wait",
  "watch",
  "status",
  "show",
  "export",
  "comment",
  "surface",
  "kits",
  "demo",
]) {
  test(`${cmd} --help prints help and exits 0`, async () => {
    const { code, stdout, stderr } = await run(cmd, "--help");
    assert.equal(code, 0);
    assert.ok(stdout.includes(`mockpit ${cmd}`), `help must document "${cmd}"`);
    assert.equal(stderr, "");
  });
}

test("watch --help prints its own help, not the catalog", async () => {
  const { code, stdout } = await run("watch", "--help");
  assert.equal(code, 0);
  assert.match(stdout, /^mockpit watch \[--session <id>\]/);
  assert.ok(!stdout.includes("a live visual surface"));
});

test("wait --help states the shared default and ceiling", async () => {
  const { stdout } = await run("wait", "--help");
  assert.match(stdout, /default 120 s, max 300/);
});

test("ask rejects a positional question alongside --asks", async () => {
  const { code, stdout, stderr } = await runWith(
    { env: { MOCKPIT_URL: "http://127.0.0.1:1" } },
    "ask",
    "--mock",
    "writer",
    "Which look?",
    "--asks",
    "[]",
  );
  assert.equal(code, 2);
  assert.equal(stdout, "");
  assert.match(
    stderr,
    /^error use the question or --asks, not both\n {2}fix: mockpit ask --mock writer --asks/,
  );
});

test("-h is a short alias for --help", async () => {
  const { code, stdout } = await run("publish", "-h");
  assert.equal(code, 0);
  assert.match(stdout, /mockpit publish --mock/);
});

test("top-level help prints the command catalog in the mock vocabulary", async () => {
  for (const args of [[], ["help"], ["--help"], ["-h"]]) {
    const { code, stdout, stderr } = await run(...args);
    assert.equal(code, 0);
    assert.match(stdout, /^mockpit — a live visual surface/);
    assert.match(stdout, /project › mock › state › variant › version/);
    for (const verb of ["init", "publish", "revise", "ask", "wait", "status", "show", "export"]) {
      assert.ok(stdout.includes(`mockpit ${verb}`), `catalog must list "${verb}"`);
    }
    for (const verb of ["serve", "demo"]) assert.ok(stdout.includes(`mockpit ${verb}`));
    // retired verbs are gone from the catalog
    for (const gone of ["trace-sync", "install-hook", "test-post", "mockpit list", "--item"]) {
      assert.ok(!stdout.includes(gone), `catalog must not mention "${gone}"`);
    }
    assert.equal(stderr, "");
  }
});

test("removed verbs are unknown commands", async () => {
  for (const verb of [
    "trace",
    "trace-sync",
    "install-hook",
    "test-post",
    "list",
    "page",
    "update",
  ]) {
    const { code, stderr } = await run(verb);
    assert.equal(code, 1);
    assert.match(stderr, new RegExp(`unknown command "${verb}"`));
  }
});

test("unknown command fails with a one-line hint", async () => {
  const { code, stdout, stderr } = await run("bogus-command");
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /^mockpit: unknown command "bogus-command" — run "mockpit help"\n$/);
});

test("unknown option fails with a one-line error, not a stack trace", async () => {
  const { code, stdout, stderr } = await run("publish", "--bogus");
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /^mockpit: Unknown option '--bogus' — run "mockpit help"\n$/);
});

test("missing option value fails with a one-line error, not a stack trace", async () => {
  const { code, stderr } = await run("publish", "--mock");
  assert.equal(code, 1);
  assert.match(
    stderr,
    /^mockpit: Option '--mock <value>' argument missing — run "mockpit help"\n$/,
  );
});

test("a non-numeric --after fails fast instead of being silently dropped", async () => {
  for (const verb of ["watch", "wait"]) {
    const { code, stderr } = await runWith(
      { env: { MOCKPIT_URL: "http://127.0.0.1:1", MOCKPIT_SESSION: "s" } },
      verb,
      "--after",
      "abc",
    );
    assert.equal(code, 1);
    assert.match(stderr, /--after must be a number/);
  }
});

test("mock verbs without --mock fail in the agent error format", async () => {
  for (const verb of ["show", "export", "revise"]) {
    const { code, stderr } = await runWith({ env: { MOCKPIT_URL: "http://127.0.0.1:1" } }, verb);
    assert.equal(code, 2);
    assert.match(stderr, /^error --mock needs a slug\n {2}fix: mockpit /);
  }
});

// --- publish / revise ------------------------------------------------------

test("publish prints the variant line, the parts per state and the url", async () => {
  const server = await serveSession();
  try {
    const file = tmpFile("w.html", '<h1 data-part="title">T</h1><p data-part="body">b</p>');
    const { code, stdout, stderr } = await cli(
      server,
      {},
      "publish",
      "--mock",
      "writer",
      "--state",
      "Writing",
      "--variant",
      "quiet",
      "--html",
      file,
    );
    assert.equal(code, 0, stderr);
    assert.match(
      stdout,
      /^writer\/Writing\/quiet v1 · http:\/\/localhost:\d+\/project\/acme%2Fsite\/writer\?state=Writing&variant=quiet$/m,
    );
    assert.match(stdout, /^parts \(Writing\): title, body$/m);

    const second = await cli(
      server,
      {},
      "publish",
      "--mock",
      "writer",
      "--state",
      "Writing",
      "--variant",
      "quiet",
      "--html",
      file,
    );
    assert.match(second.stdout, /^writer\/Writing\/quiet v2 · /m, "same triple is a new version");
  } finally {
    await server.close();
  }
});

test("publish without a state publishes a single-state mock; html may come from a positional or stdin", async () => {
  const server = await serveSession();
  try {
    const positional = await cli(
      server,
      {},
      "publish",
      "--mock",
      "card",
      tmpFile("c.html", "<p>c</p>"),
    );
    assert.equal(positional.code, 0, positional.stderr);
    assert.match(positional.stdout, /^card\/default v1 · /m);

    const stdin = await runWith(
      {
        cwd: tmpRepo(),
        env: {
          MOCKPIT_URL: server.url,
          MOCKPIT_SESSION: server.session.id,
          MOCKPIT_PROJECT: "acme/site",
        },
        stdin: "<p>from stdin</p>",
      },
      "publish",
      "--mock",
      "card",
      "--html",
      "-",
      "--json",
    );
    assert.equal(stdin.code, 0, stdin.stderr);
    const out = JSON.parse(stdin.stdout);
    assert.equal(out.post.version, 2);
    assert.equal(out.post.state, null);
  } finally {
    await server.close();
  }
});

test("publish combines html with surface flags in flag order", async () => {
  const server = await serveSession();
  try {
    const { code, stdout, stderr } = await cli(
      server,
      {},
      "publish",
      "--mock",
      "notes",
      "--html",
      tmpFile("n.html", "<p>n</p>"),
      "--terminal",
      tmpFile("t.txt", "$ ls"),
      "--md",
      tmpFile("a.md", "# a"),
      "--data",
      tmpFile("d.json", '{"ok":true}'),
      "--code",
      tmpFile("x.ts", "const x = 1;"),
      "--md",
      tmpFile("b.md", "# b"),
      "--json",
    );
    assert.equal(code, 0, stderr);
    const out = JSON.parse(stdout);
    assert.deepEqual(
      out.post.surfaces.map((s: any) => s.kind),
      ["html", "terminal", "markdown", "json", "code", "markdown"],
    );
    const mock = await getJson(`${server.url}/api/mocks/${out.mock.id}?body=1`);
    assert.equal(mock.variants[0].surfaces[4].language, "typescript");
  } finally {
    await server.close();
  }
});

test("publish --data with invalid JSON fails with a clear error", async () => {
  const server = await serveSession();
  try {
    const { code, stderr } = await cli(
      server,
      {},
      "publish",
      "--mock",
      "x",
      "--data",
      tmpFile("bad.json", "{nope"),
    );
    assert.equal(code, 1);
    assert.match(stderr, /--data: invalid JSON/);
  } finally {
    await server.close();
  }
});

test("publish --kit puts the (deduped) kit ids on the html surface; an unknown kit is refused", async () => {
  const server = await serveSession();
  try {
    const file = tmpFile("k.html", "<div class=tree></div>");
    const ok = await cli(
      server,
      {},
      "publish",
      "--mock",
      "ci",
      "--html",
      file,
      "--kit",
      "issues",
      "--kit",
      "slides,issues",
      "--json",
    );
    assert.equal(ok.code, 0, ok.stderr);
    const id = JSON.parse(ok.stdout).mock.id;
    const mock = await getJson(`${server.url}/api/mocks/${id}?body=1`);
    assert.deepEqual(mock.variants[0].surfaces[0].kits, ["issues", "slides"]);

    const bad = await cli(server, {}, "publish", "--mock", "ci2", "--html", file, "--kit", "bogus");
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /unknown kit "bogus"/);
  } finally {
    await server.close();
  }
});

test("publish --knobs declares knobs and prints a nudge for a few discrete options", async () => {
  const server = await serveSession();
  try {
    const file = tmpFile("k.html", '<p data-part="body">b</p>');
    const { code, stdout, stderr } = await cli(
      server,
      {},
      "publish",
      "--mock",
      "writer",
      "--html",
      file,
      "--knobs",
      '{"body.size":[17,14,22,1],"trim":{"type":"select","options":["top","bottom"]}}',
    );
    assert.equal(code, 0, stderr);
    assert.match(stdout, /^nudge: knob "trim" has 2 discrete options/m);
    assert.doesNotMatch(stdout, /knob "body.size"/);
    const mock = await getJson(`${server.url}/api/mocks/${await mockId(server.url)}`);
    assert.deepEqual(mock.knobs["body.size"], [17, 14, 22, 1]);

    // --knobs also reads a file; invalid JSON is an agent error
    const fromFile = await cli(
      server,
      {},
      "publish",
      "--mock",
      "writer",
      "--html",
      file,
      "--knobs",
      tmpFile("k.json", '{"accent":"#ff0000"}'),
      "--json",
    );
    assert.equal(fromFile.code, 0, fromFile.stderr);
    const bad = await cli(
      server,
      {},
      "publish",
      "--mock",
      "writer",
      "--html",
      file,
      "--knobs",
      "{x",
    );
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /^error --knobs is not valid JSON/);
  } finally {
    await server.close();
  }
});

test("revise flags parts that vanished or were renamed", async () => {
  const server = await serveSession();
  try {
    await seedWriter(server);
    const v2 = tmpFile("v2.html", '<h1 data-part="headline" data-part-label="Title">T</h1>');
    const { code, stdout, stderr } = await cli(
      server,
      {},
      "revise",
      "--mock",
      "writer",
      "--state",
      "Writing",
      "--variant",
      "dark",
      "--html",
      v2,
    );
    assert.equal(code, 0, stderr);
    assert.match(stdout, /^writer\/Writing\/dark v2 · /m);
    assert.match(stdout, /^vanished: .*body/m);
  } finally {
    await server.close();
  }
});

test("revise --part splices one part per flag, one of them from stdin", async () => {
  const server = await serveSession();
  try {
    const id = await seedWriter(server);
    const title = tmpFile("title.html", '<h1 data-part="title">New title</h1>');
    const { code, stdout, stderr } = await runWith(
      {
        cwd: tmpRepo(),
        env: {
          MOCKPIT_URL: server.url,
          MOCKPIT_SESSION: server.session.id,
          MOCKPIT_PROJECT: "acme/site",
        },
        stdin: '<section data-part="copy">from stdin</section>',
      },
      "revise",
      "--mock",
      "writer",
      "--state",
      "Writing",
      "--variant",
      "quiet",
      "--part",
      `title=${title}`,
      "--part",
      "body=-",
    );
    assert.equal(code, 0, stderr);
    assert.match(stdout, /^writer\/Writing\/quiet v2 · /m);
    assert.match(stdout, /^applied: title, body$/m);
    assert.match(stdout, /^vanished: body$/m);
    const mock = await getJson(`${server.url}/api/mocks/${id}?body=1`);
    const quiet = mock.variants.find((v: any) => v.state === "Writing" && v.variant === "quiet");
    assert.equal(
      quiet.surfaces[0].html,
      '<h1 data-part="title">New title</h1><section data-part="copy">from stdin</section>',
    );
  } finally {
    await server.close();
  }
});

test("revise --part errors: bad flag, unknown part, publish", async () => {
  const server = await serveSession();
  try {
    await seedWriter(server);
    const file = tmpFile("p.html", "<nav data-part='nav'>N</nav>");
    const target = ["--mock", "writer", "--state", "Writing", "--variant", "quiet"];
    const malformed = await cli(server, {}, "revise", ...target, "--part", "nav");
    assert.equal(malformed.code, 2);
    assert.match(malformed.stderr, /--part needs name=file \(got "nav"\)/);
    const unknown = await cli(server, {}, "revise", ...target, "--part", `nav=${file}`);
    assert.equal(unknown.code, 2);
    assert.match(unknown.stderr, /no part "nav"; parts present: title, body/);
    const publish = await cli(server, {}, "publish", ...target, "--part", `nav=${file}`);
    assert.equal(publish.code, 2);
    assert.match(publish.stderr, /--part edits a published version; use it with revise/);
  } finally {
    await server.close();
  }
});

test("revise refuses to create a mock, and ambiguity names the choices", async () => {
  const server = await serveSession();
  try {
    const file = tmpFile("x.html", "<p>x</p>");
    const missing = await cli(server, {}, "revise", "--mock", "nope", "--html", file);
    assert.equal(missing.code, 2);
    assert.match(
      missing.stderr,
      /^error acme\/site has no mock "nope"\n {2}fix: mockpit show --mock nope\n$/,
    );

    await seedWriter(server);
    const ambiguous = await cli(
      server,
      {},
      "publish",
      "--mock",
      "writer",
      "--state",
      "Writing",
      "--html",
      file,
    );
    assert.equal(ambiguous.code, 2);
    assert.match(
      ambiguous.stderr,
      /several variants; pass variant \(Writing\/quiet, Writing\/dark\)/,
    );

    const noState = await cli(server, {}, "publish", "--mock", "writer", "--html", file);
    assert.equal(noState.code, 2);
    assert.match(noState.stderr, /writer has states; pass state \(Writing, Lab open\)/);
  } finally {
    await server.close();
  }
});

test("publish reports a missing html file", async () => {
  const server = await serveSession();
  try {
    const missing = join(tmpRepo(), "missing.html");
    const { code, stdout, stderr } = await cli(
      server,
      {},
      "publish",
      "--mock",
      "x",
      "--html",
      missing,
    );
    assert.equal(code, 2);
    assert.equal(stdout, "");
    assert.match(stderr, /^error cannot read .*missing\.html/);
  } finally {
    await server.close();
  }
});

// The agent guide promises "nothing is written on a failed command": a local
// file error must surface before the CLI creates a session on the server.
test("a missing html file fails before any request reaches the server", async () => {
  const missing = join(tmpRepo(), "missing.html");
  const { code, stderr } = await runWith(
    { cwd: tmpRepo(), env: { MOCKPIT_URL: "http://127.0.0.1:1", MOCKPIT_PROJECT: "p" } },
    "publish",
    "--mock",
    "x",
    "--html",
    missing,
  );
  assert.equal(code, 2);
  assert.match(stderr, /^error cannot read /);
});

// --- ask / wait / watch -----------------------------------------------------

test("ask binds options to variants; --asks takes the full shape", async () => {
  const server = await serveSession();
  try {
    const id = await seedWriter(server);
    const { code, stdout, stderr } = await cli(
      server,
      {},
      "ask",
      "--mock",
      "writer",
      "Which",
      "look?",
      "--option",
      "Quiet=quiet",
      "--option",
      "Dark=dark",
      "--id",
      "look",
    );
    assert.equal(code, 0, stderr);
    assert.match(stdout, /^asked on writer: Which look\? \[Quiet \| Dark\]$/m);

    const many = await cli(
      server,
      {},
      "ask",
      "--mock",
      "writer",
      "--asks",
      JSON.stringify([
        {
          text: "Where do versions live?",
          scope: "state",
          state: "Lab open",
          options: ["Drawer", "Margin"],
        },
      ]),
      "--json",
    );
    assert.equal(many.code, 0, many.stderr);
    assert.equal(JSON.parse(many.stdout).asks[0].scope, "state");

    const mock = await getJson(`${server.url}/api/mocks/${id}`);
    const look = mock.asks.find((a: any) => a.id === "look");
    assert.deepEqual(
      look.options.map((o: any) => [o.label, o.variant]),
      [
        ["Quiet", "quiet"],
        ["Dark", "dark"],
      ],
    );
    assert.equal(mock.open, 2);

    const unbound = await cli(server, {}, "ask", "--mock", "writer", "No options?");
    assert.equal(unbound.code, 2);
    assert.match(unbound.stderr, /^error ask needs options/);
    const badVariant = await cli(
      server,
      {},
      "ask",
      "--mock",
      "writer",
      "Pick",
      "--option",
      "Loud=loud",
    );
    assert.equal(badVariant.code, 2);
    assert.match(badVariant.stderr, /names variant "loud"/);
  } finally {
    await server.close();
  }
});

test("wait prints the reply batch once; a second wait does not redeliver it", async () => {
  const server = await serveSession();
  try {
    const id = await seedWriter(server);
    await cli(
      server,
      {},
      "ask",
      "--mock",
      "writer",
      "Look?",
      "--option",
      "Quiet=quiet",
      "--option",
      "Dark=dark",
      "--id",
      "look",
    );
    const reply = await viewerReply(server.url, id, {
      answers: { look: "dark" },
      comments: [{ part: "title", state: "Writing", text: "bigger" }],
      text: "go dark",
    });
    assert.equal(reply.reply.kind, "reply");

    const first = await cli(server, {}, "wait", "--timeout", "5");
    assert.equal(first.code, 0, first.stderr);
    const batch = JSON.parse(first.stdout);
    assert.equal(batch.mock, "writer");
    assert.deepEqual(batch.reply.answers, { look: "dark" });
    assert.equal(batch.reply.text, "go dark");
    assert.equal(batch.reply.asks[0].chosen[0].variant, "dark");
    assert.deepEqual(batch.accepted, [{ state: "Writing", variant: "dark" }]);
    assert.deepEqual(batch.archived, [{ state: "Writing", variant: "quiet" }]);

    const second = await cli(server, {}, "wait", "--timeout", "1");
    assert.equal(second.code, 0);
    const empty = JSON.parse(second.stdout);
    assert.equal(empty.timedOut, true);
    assert.deepEqual(empty.feedback, []);
  } finally {
    await server.close();
  }
});

test("wait --mock filters batches to one mock", async () => {
  const server = await serveSession();
  try {
    const id = await seedWriter(server);
    await viewerReply(server.url, id, { text: "hello" });
    const other = await cli(server, {}, "wait", "--mock", "card", "--timeout", "1");
    assert.equal(JSON.parse(other.stdout).timedOut, true);
  } finally {
    await server.close();
  }
});

test("wait explains when there is no active session", async () => {
  const { code, stdout, stderr } = await runWith(
    { cwd: tmpRepo(), env: { MOCKPIT_URL: "http://127.0.0.1:1" } },
    "wait",
    "--timeout",
    "1",
  );
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /no active session/);
});

test("watch streams each piece of feedback as one line and re-arms", async () => {
  const server = await serveSession();
  let child: ChildProcess | undefined;
  let childExited = false;
  let childExit: Promise<void> = Promise.resolve();
  try {
    const id = await seedWriter(server);
    child = spawn(process.execPath, [CLI, "watch"], {
      env: testEnv({ MOCKPIT_URL: server.url, MOCKPIT_SESSION: server.session.id }),
    });
    childExit = new Promise<void>((resolve) =>
      child?.once("exit", () => {
        childExited = true;
        resolve();
      }),
    );
    let stdout = "";
    child.stdout?.on("data", (d) => (stdout += d));

    await post(`${server.url}/api/comments`, {
      mock: id,
      text: "tighten\nthe spacing",
      author: "user",
    });
    await waitFor(() => stdout.includes("tighten the spacing"));
    assert.match(stdout, /^mockpit comment on writer: “tighten the spacing”$/m);

    await viewerReply(server.url, id, { text: "ship it" });
    await waitFor(() => stdout.includes("ship it"));
    assert.match(stdout, /^mockpit reply on writer: ship it$/m);

    assert.equal(stdout.match(/tighten the spacing/g)?.length, 1);
  } finally {
    // Kill in finally so a failed assertion can't leave the long-polling child
    // alive and block server.close().
    if (child) {
      child.kill();
      await Promise.race([childExit, new Promise((resolve) => setTimeout(resolve, 1000))]);
      if (!childExited) child.kill("SIGKILL");
      await childExit;
    }
    await server.close();
  }
});

// --- status / show / export / comment ---------------------------------------

test("status prints one line per mock with its states, variants and open asks", async () => {
  const server = await serveSession();
  try {
    await seedWriter(server);
    await cli(server, {}, "ask", "--mock", "writer", "Look?", "--option", "Quiet=quiet");
    const { code, stdout } = await cli(server, {}, "status");
    assert.equal(code, 0);
    assert.match(stdout, /^acme\/site · 1 mock · 1 open ask$/m);
    assert.match(stdout, /^ {2}writer · component · Writing \/ Lab open · 3 variants · 1 open$/m);

    const json = JSON.parse((await cli(server, {}, "status", "--json")).stdout);
    assert.equal(json.mocks[0].slug, "writer");

    const empty = await cli(server, { project: "empty/repo" }, "status");
    assert.match(empty.stdout, /^empty\/repo · 0 mocks · nothing waiting on the user$/m);
  } finally {
    await server.close();
  }
});

test("show prints mock metadata; bodies and history are opt-in", async () => {
  const server = await serveSession();
  try {
    await seedWriter(server);
    const meta = JSON.parse((await cli(server, {}, "show", "--mock", "writer")).stdout);
    assert.deepEqual(meta.states, ["Writing", "Lab open"]);
    assert.equal(meta.variants.length, 3);
    assert.equal(meta.variants[0].surfaces[0].html, undefined, "no body by default");
    assert.equal(meta.variants[0].history, undefined);
    assert.deepEqual(
      meta.parts.map((p: any) => [p.state, p.parts.map((x: any) => x.name)]),
      [
        ["Writing", ["title", "body"]],
        ["Lab open", ["lab"]],
      ],
    );

    const full = JSON.parse(
      (await cli(server, {}, "show", "--mock", "writer", "--body", "--history")).stdout,
    );
    assert.match(full.variants[0].surfaces[0].html, /data-part="title"/);
    assert.equal(full.variants[0].history[0].version, 1);

    const missing = await cli(server, {}, "show", "--mock", "nope");
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /^error acme\/site has no mock "nope"/);
  } finally {
    await server.close();
  }
});

test("export writes index.html + history.json per state into the repo", async () => {
  const server = await serveSession();
  const cwd = tmpRepo();
  try {
    const id = await seedWriter(server);
    await cli(
      server,
      {},
      "ask",
      "--mock",
      "writer",
      "Look?",
      "--option",
      "Quiet=quiet",
      "--option",
      "Dark=dark",
      "--id",
      "look",
    );
    await viewerReply(server.url, id, { answers: { look: "dark" }, tuned: {} });

    const { code, stdout, stderr } = await cli(server, { cwd }, "export", "--mock", "writer");
    assert.equal(code, 0, stderr);
    assert.match(stdout, /^writer\/Writing\/dark v1 → .*writing$/m);
    assert.match(stdout, /^writer\/Lab open\/quiet v1 → .*lab-open$/m);

    const writing = join(cwd, ".mockpit", "accepted", "writer", "writing");
    assert.match(readFileSync(join(writing, "index.html"), "utf8"), /dark/);
    const history = JSON.parse(readFileSync(join(writing, "history.json"), "utf8"));
    assert.equal(history.mock, "writer");
    assert.equal(history.state, "Writing");
    assert.equal(history.variant, "dark");
    assert.equal(history.status, "accepted");
    assert.equal(history.history.length, 1);
    assert.ok(
      readFileSync(join(cwd, ".mockpit", "accepted", "writer", "lab-open", "index.html"), "utf8"),
    );

    // --out, --state and --variant narrow and redirect it
    const out = tmpRepo();
    const narrow = await cli(
      server,
      { cwd },
      "export",
      "--mock",
      "writer",
      "--state",
      "Writing",
      "--variant",
      "quiet",
      "--out",
      out,
    );
    assert.equal(narrow.code, 0, narrow.stderr);
    assert.match(readFileSync(join(out, "writer", "writing", "index.html"), "utf8"), />b</);

    const json = JSON.parse(
      (await cli(server, { cwd }, "export", "--mock", "writer", "--json")).stdout,
    );
    assert.equal(json.states.length, 2);
  } finally {
    await server.close();
  }
});

test("comment replies in the mock's thread as the session's agent", async () => {
  const server = await serveSession();
  try {
    const id = await seedWriter(server);
    const { code, stdout, stderr } = await cli(
      server,
      {},
      "comment",
      "on",
      "it",
      "--mock",
      "writer",
      "--state",
      "Writing",
      "--variant",
      "dark",
    );
    assert.equal(code, 0, stderr);
    const comment = JSON.parse(stdout);
    assert.equal(comment.text, "on it");
    assert.equal(comment.mockId, id);
    assert.equal(comment.author, "cli-test");
    assert.ok(comment.postId);

    const noText = await cli(server, {}, "comment", "--mock", "writer");
    assert.equal(noText.code, 2);
    assert.match(noText.stderr, /^error comment needs text/);
  } finally {
    await server.close();
  }
});

// --- surface edits ----------------------------------------------------------

test("surface add/edit/move/remove edit one variant", async () => {
  const server = await serveSession();
  try {
    const id = await seedWriter(server);
    const where = ["--mock", "writer", "--state", "Writing", "--variant", "dark"];
    const surfaces = async () =>
      (await getJson(`${server.url}/api/mocks/${id}?body=1`)).variants.find(
        (v: any) => v.state === "Writing" && v.variant === "dark",
      ).surfaces;

    const add = await cli(
      server,
      {},
      "surface",
      "add",
      ...where,
      "--md",
      tmpFile("a.md", "# a"),
      "--terminal",
      tmpFile("t.txt", "$ ls"),
    );
    assert.equal(add.code, 0, add.stderr);
    assert.match(add.stdout, /^added 2 surface\(s\) to writer$/m);
    assert.deepEqual(
      (await surfaces()).map((s: any) => s.kind),
      ["html", "markdown", "terminal"],
    );

    const edit = await cli(server, {}, "surface", "edit", ...where, "1", tmpFile("b.md", "# b"));
    assert.equal(edit.code, 0, edit.stderr);
    assert.equal((await surfaces())[1].markdown, "# b");

    const move = await cli(server, {}, "surface", "move", ...where, "2", "--to", "0");
    assert.equal(move.code, 0, move.stderr);
    assert.deepEqual(
      (await surfaces()).map((s: any) => s.kind),
      ["terminal", "html", "markdown"],
    );

    const remove = await cli(server, {}, "surface", "remove", ...where, "0");
    assert.equal(remove.code, 0, remove.stderr);
    assert.match(remove.stdout, /^writer\/Writing\/dark v6 · /m);
    assert.deepEqual(
      (await surfaces()).map((s: any) => s.kind),
      ["html", "markdown"],
    );

    const none = await cli(server, {}, "surface", "add", ...where);
    assert.equal(none.code, 1);
    assert.match(none.stderr, /provide at least one surface flag/);
    const badTo = await cli(server, {}, "surface", "move", ...where, "0", "--to", "9");
    assert.match(badTo.stderr, /--to must be a valid index/);
    const ambiguous = await cli(
      server,
      {},
      "surface",
      "move",
      "--mock",
      "writer",
      "0",
      "--to",
      "1",
    );
    assert.equal(ambiguous.code, 2);
    assert.match(ambiguous.stderr, /3 matching variants/);
    const unknown = await cli(server, {}, "surface", "bogus");
    assert.match(unknown.stderr, /unknown surface subcommand: bogus/);
  } finally {
    await server.close();
  }
});

// --- demo / init / assets / kits / guides -----------------------------------

test("demo seeds the Writer mock: 4 states × 3 variants and 3 asks", async () => {
  const server = await serveSession();
  try {
    const { code, stdout, stderr } = await cli(server, {}, "demo");
    assert.equal(code, 0, stderr);
    assert.match(stdout, /Seeded demo\/writer › Writer \(4 states × 3 variants\)/);
    const id = await mockId(server.url, "writer", "demo/writer");
    const mock = await getJson(`${server.url}/api/mocks/${id}`);
    assert.deepEqual(mock.states, ["Writing", "Lab open", "Versions open", "Ghost text"]);
    assert.equal(mock.variants.length, 12);
    assert.deepEqual(
      [...new Set(mock.variants.map((v: any) => v.variant))],
      ["quiet", "dark", "editorial"],
    );
    assert.equal(mock.asks.length, 3);
    assert.deepEqual(
      mock.asks[0].options.map((o: any) => o.variant),
      ["quiet", "dark", "editorial"],
    );
    const parts = new Set(mock.parts.flatMap((s: any) => s.parts.map((p: any) => p.name)));
    for (const name of ["title", "body", "lab", "versions", "trim", "ghost", "toast"]) {
      assert.ok(parts.has(name), `demo marks part "${name}"`);
    }
    assert.ok(Object.keys(mock.knobs).length >= 3);
  } finally {
    await server.close();
  }
});

test("init imports the repo's design system and writes the starter", async () => {
  const server = await serveSession();
  const cwd = tmpRepo();
  try {
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({ devDependencies: { tailwindcss: "^4" } }),
    );
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(
      join(cwd, "src", "globals.css"),
      ":root{--background:#ffffff;--foreground:#111111;--primary:#0af;--radius:0.5rem}",
    );

    const { code, stdout } = await cli(server, { cwd }, "init");
    assert.equal(code, 0);
    assert.match(stdout, /^project: +acme\/site \(from MOCKPIT_PROJECT\)$/m);
    assert.match(
      stdout,
      /^design: +tailwind: src\/globals\.css · 4 css vars from src\/globals\.css$/m,
    );
    assert.match(stdout, /^kit: +tailwind$/m);
    assert.match(stdout, /^icons: +lucide, mage available/m);
    assert.match(stdout, /^wrote: +\.mockpit\/starter\.html$/m);

    const starter = readFileSync(join(cwd, ".mockpit", "starter.html"), "utf8");
    assert.ok(!starter.includes("<!doctype"));
    assert.match(readFileSync(join(cwd, ".gitignore"), "utf8"), /^\.mockpit\/$/m);

    const design = await getJson(
      `${server.url}/api/projects/${encodeURIComponent("acme/site")}/design`,
    );
    assert.equal(design.kit, "tailwind");
    assert.deepEqual(design.iconSets, []);

    const brief = await cli(server, { cwd }, "guide", "--brief");
    assert.match(brief.stdout, /Kit: tailwind/);
    assert.match(brief.stdout, /mockpit publish --mock/);
  } finally {
    await server.close();
  }
});

// End to end up to the browser: the utility itself compiles in the frame from
// jsDelivr, so this stops at the document the frame loads.
test("init on a shadcn repo: the frame gets the repo's Tailwind stylesheet", async () => {
  const server = await serveSession();
  const cwd = tmpRepo();
  try {
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({ dependencies: { tailwindcss: "^4", "tw-animate-css": "^1" } }),
    );
    mkdirSync(join(cwd, "src", "app"), { recursive: true });
    writeFileSync(
      join(cwd, "src", "app", "globals.css"),
      [
        '@import "tailwindcss";',
        '@import "tw-animate-css";',
        "@custom-variant dark (&:is(.dark *));",
        "@theme inline { --color-card: var(--card); --color-card-foreground: var(--card-foreground); }",
        ":root { --card: oklch(1 0 0); --card-foreground: oklch(0.15 0 0); }",
        ".dark { --card: oklch(0.2 0 0); --card-foreground: oklch(0.98 0 0); }",
      ].join("\n"),
    );
    const init = await cli(server, { cwd }, "init");
    assert.equal(init.code, 0, init.stderr);
    assert.match(
      init.stdout,
      /^design: +tailwind: src\/app\/globals\.css \(stripped: tw-animate-css\)/m,
    );

    const brief = await cli(server, { cwd }, "guide", "--brief");
    assert.match(brief.stdout, /`bg-card`/);
    assert.match(brief.stdout, /not available: `tw-animate-css`/);

    const file = tmpFile("card.html", '<div class="bg-card text-card-foreground">Card</div>');
    const pub = await cli(server, { cwd }, "publish", "--mock", "card", "--html", file, "--json");
    assert.equal(pub.code, 0, pub.stderr);
    const mock = await getJson(`${server.url}/api/mocks/${JSON.parse(pub.stdout).mock.id}`);
    const doc = await fetch(`${server.url}/s/${mock.variants[0].postId}?surface=0&mode=dark`).then(
      (r) => r.text(),
    );
    const style = doc.match(/<style type="text\/tailwindcss">([\s\S]*?)<\/style>/);
    assert.ok(style, "the repo's stylesheet is in the frame");
    assert.match(style[1], /--card: oklch\(1 0 0\)/);
    assert.ok(!style[1].includes("tw-animate-css"));
    assert.ok(doc.indexOf(style[0]) < doc.indexOf("@tailwindcss/browser@4"));
    assert.match(doc, /<html class="dark"/);
    assert.match(doc, /<div class="bg-card text-card-foreground">Card<\/div>/);
  } finally {
    await server.close();
  }
});

test("init adds the repo's icon sets; icons lists, adds and removes them", async () => {
  const server = await serveSession();
  const cwd = tmpRepo();
  try {
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({ dependencies: { "@iconify-json/zz": "1", "lucide-react": "1" } }),
    );
    const pkg = join(cwd, "node_modules", "@iconify-json", "zz");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, "icons.json"),
      JSON.stringify({
        prefix: "zz",
        info: { name: "dropped on upload" },
        icons: { dot: { body: "<circle r='4'/>" }, ring: { body: "<circle/>" } },
      }),
    );

    const init = await cli(server, { cwd }, "init");
    assert.equal(init.code, 0, init.stderr);
    assert.match(init.stdout, /^icons: +lucide \(bundled, from lucide-react\)$/m);
    assert.match(init.stdout, /^icons: +zz \(2 icons, from @iconify-json\/zz\)$/m);
    assert.match(init.stdout, /^icons: +zz, lucide, mage available/m);

    const list = await cli(server, { cwd }, "icons");
    assert.match(list.stdout, /^zz +2 +installed$/m);
    assert.match(list.stdout, /^lucide +\d+ +bundled$/m);

    const add = await cli(server, { cwd }, "icons", "add", "zz");
    assert.equal(add.code, 0, add.stderr);
    assert.match(add.stdout, /^added zz \(2 icons\)$/m);

    const bundled = await cli(server, { cwd }, "icons", "remove", "lucide");
    assert.notEqual(bundled.code, 0);
    assert.match(bundled.stderr, /lucide is bundled/);

    const removed = await cli(server, { cwd }, "icons", "remove", "zz");
    assert.equal(removed.code, 0, removed.stderr);
    const design = await getJson(
      `${server.url}/api/projects/${encodeURIComponent("acme/site")}/design`,
    );
    assert.deepEqual(design.iconSets, []);
  } finally {
    await server.close();
  }
});

test("upload stores an asset and prints its id and url", async () => {
  const server = await serveSession();
  try {
    const png = tmpFile("up.png", String.fromCharCode(0x89, 0x50, 0x4e, 0x47));
    const { code, stdout } = await cli(server, {}, "upload", png, "--kind", "image");
    assert.equal(code, 0);
    const out = JSON.parse(stdout);
    assert.equal(out.url, `${server.url}/a/${out.id}`);
    assert.equal(out.kind, "image");
  } finally {
    await server.close();
  }
});

test("asset-url prints the content-hash id and url without hitting the server", async () => {
  const bytes = "asset-url-payload";
  const file = tmpFile("f.bin", bytes);
  const expected = createHash("sha256").update(bytes).digest("hex");
  const { code, stdout } = await runWith(
    { env: { MOCKPIT_URL: "http://127.0.0.1:1" } },
    "asset-url",
    file,
  );
  assert.equal(code, 0);
  const out = JSON.parse(stdout);
  assert.equal(out.id, expected);
  assert.equal(out.url, `http://127.0.0.1:1/a/${expected}`);
});

test("usage errors fail before hitting the server", async () => {
  const cases: Array<[string[], RegExp]> = [
    [["upload"], /usage: mockpit upload/],
    [["asset-url"], /usage: mockpit asset-url/],
  ];
  for (const [args, pattern] of cases) {
    const { code, stdout, stderr } = await runWith(
      { env: { MOCKPIT_URL: "http://127.0.0.1:1" } },
      ...args,
    );
    assert.notEqual(code, 0);
    assert.equal(stdout, "");
    assert.match(stderr, pattern);
  }
});

test("kits lists the workspace's available kits", async () => {
  const server = await serveApp();
  try {
    const { code, stdout } = await runWith({ env: { MOCKPIT_URL: server.url } }, "kits");
    assert.equal(code, 0);
    const kits = JSON.parse(stdout);
    assert.ok(kits.some((k: any) => k.id === "issues"));
    assert.ok(kits.some((k: any) => k.id === "slides"));
  } finally {
    await server.close();
  }
});

test("topics and setup fall back to bundled markdown when no server is reachable", async () => {
  const offline = { env: { MOCKPIT_URL: "http://127.0.0.1:1" } };
  for (const args of [["guide"], ["setup"], ["agent-howto", "--topic", "knobs"]]) {
    const { code, stdout, stderr } = await runWith(offline, ...args);
    assert.equal(code, 0);
    assert.match(stdout, /#/);
    assert.equal(stderr, "");
  }
  assert.match((await runWith(offline, "guide")).stdout, /# mockpit topic: html/);
});

test("the brief prints the generic version with no server; an unknown topic lists the real ones", async () => {
  const offline = { cwd: tmpRepo(), env: { MOCKPIT_URL: "http://127.0.0.1:1" } };
  const brief = await runWith(offline, "agent-howto");
  assert.equal(brief.code, 0);
  assert.match(brief.stdout, /^# mockpit brief\n/);
  assert.match(brief.stdout, /Run `mockpit init` in the repo/);
  assert.match(
    brief.stderr,
    /^note: no mockpit at http:\/\/127\.0\.0\.1:1; this is the generic brief/,
  );

  const unknown = await runWith(offline, "agent-howto", "--topic", "colours");
  assert.equal(unknown.code, 2);
  assert.match(
    unknown.stderr,
    /unknown topic "colours"; topics: asks, html, http, knobs, reply, surfaces/,
  );
});

test("an unreachable server fails with a one-line error, not a stack trace", async () => {
  const { code, stdout, stderr } = await runWith(
    { cwd: tmpRepo(), env: { MOCKPIT_URL: "http://127.0.0.1:1", MOCKPIT_SESSION: "s" } },
    "publish",
    "--mock",
    "x",
    "--html",
    tmpFile("x.html", "<p/>"),
  );
  assert.equal(code, 2);
  assert.equal(stdout, "");
  assert.match(
    stderr,
    /^error cannot reach mockpit at http:\/\/127\.0\.0\.1:1\n {2}fix: mockpit serve\n$/,
  );
});

test("kit add/remove and kits manage a project kit; init --kit-url makes it the default", async () => {
  const server = await serveSession();
  const url = "https://cdn.jsdelivr.net/npm/@acme/ui@2/dist/ui.css";
  const sheet = "Buttons: `.acme-btn`. Cards: `.acme-card`.";
  const doc = tmpFile("acme.md", sheet);
  const designUrl = `${server.url}/api/projects/${encodeURIComponent("acme/site")}/design`;
  try {
    const bad = await cli(
      server,
      {},
      "kit",
      "add",
      "acme",
      "--url",
      "https://x.example/a.css",
      "--doc",
      "x",
    );
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /must be an https URL on .*cdn\.jsdelivr\.net/);

    const added = await cli(server, {}, "kit", "add", "acme", "--url", url, "--doc", doc);
    assert.equal(added.code, 0, added.stderr);
    assert.match(added.stdout, /added kit acme/);
    const listed = JSON.parse((await cli(server, {}, "kits")).stdout);
    assert.ok(listed.some((k: any) => k.id === "basecoat"));
    assert.deepEqual(
      listed.find((k: any) => k.id === "acme"),
      {
        id: "acme",
        href: url,
        doc: sheet,
        source: "project",
      },
    );

    const removed = await cli(server, {}, "kit", "remove", "acme");
    assert.equal(removed.code, 0, removed.stderr);
    const after = JSON.parse((await cli(server, {}, "kits")).stdout);
    assert.ok(!after.some((k: any) => k.id === "acme"));

    const cwd = tmpRepo();
    const init = await cli(
      server,
      { cwd },
      "init",
      "--kit",
      "acme",
      "--kit-url",
      url,
      "--kit-doc",
      doc,
    );
    assert.equal(init.code, 0, init.stderr);
    assert.match(init.stdout, /^kit: +acme$/m);
    const brief = await cli(server, { cwd }, "guide", "--brief");
    assert.match(brief.stdout, /Kit: acme[\s\S]*\.acme-card/);

    const basecoat = await cli(server, { cwd }, "init", "--kit", "basecoat");
    assert.equal(basecoat.code, 0, basecoat.stderr);
    const design = await getJson(designUrl);
    assert.equal(design.kit, "basecoat");
    assert.deepEqual(
      design.projectKits.map((k: any) => k.id),
      ["acme"],
      "init keeps project kits",
    );
  } finally {
    await server.close();
  }
});
