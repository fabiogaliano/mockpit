# Connecting agents

mockpit meets an agent wherever it is. Pick whichever tier the agent supports —
each one covers the full loop: publish a design, ask the user, read their one
batched reply, revise. Nothing on any tier waits for the user: the agent asks,
says where to look and ends its turn, and reads the reply with `feedback` once
the user says they answered (or a background `mockpit watch` wakes it).

The fastest path for any agent with a shell is to paste the setup block into its
instructions:

```sh
curl -s http://localhost:8228/setup >> AGENTS.md
```

That block is intentionally small: it tells any agent (Pi, opencode, amp,
codex, Claude Code) to fetch the current instructions from the running server at
`/agent-howto` (or `mockpit guide`). The sections below are
the underlying tiers those live instructions build on.

## Shell (CLI)

The `mockpit` CLI has no dependencies and keeps one session per agent
conversation for you:

```sh
mockpit publish --design cache --state "Cold" --variant grid --html grid.html   # or --md / --diff …
mockpit publish --design cache --state "Cold" --variant list --html list.html
mockpit ask --design cache "Which layout?" --option Grid=grid --option List=list
mockpit feedback                               # after the user says they answered; returns at once
mockpit watch                                  # one line per Send, for a background monitor
mockpit guide                                  # print the brief
mockpit guide --topic html                     # print one reference topic
mockpit run loop.js                            # publish and ask in one script
```

## Pi extension

Pi users can install the package directly. It adds the ten verbs as native
tools (`mockpit_publish`, `mockpit_ask`, `mockpit_read`, `mockpit_feedback`,
`mockpit_say`, `mockpit_edit`, `mockpit_export`, `mockpit_upload`,
`mockpit_guide`, `mockpit_run`):

```sh
pi install npm:mockpit
# or try it for one run:
pi -e npm:mockpit
```

In an interactive (or RPC) pi session, a reply sent from the viewer arrives on
its own as a mockpit message and starts a turn: an idle agent wakes, and a busy
one gets it when it finishes. One-shot runs (`-p`, json) don't listen.

## MCP

Tools: `publish`, `ask`, `read`, `feedback`, `say`, `move`, `edit`, `export`,
`upload`, `guide`; the server name is the namespace. Connect over stdio or straight to
the server at `/mcp`:

```sh
claude mcp add --scope user mockpit -- npx -y mockpit mcp
# or, no local process:
claude mcp add --scope user --transport http mockpit http://localhost:8228/mcp
```

MCP agents get the usage instructions automatically.

**Code mode.** Clients that load every tool into each conversation and have no
codemode of their own (claude.ai, Desktop and ChatGPT connectors) can connect to
`/mcp?mode=code` instead. It serves one tool, `run`, whose description is the
typed script API: the agent writes one JavaScript script that publishes and
asks, and the server runs it in a QuickJS sandbox; a later run reads
`mockpit.feedback()`. Over stdio, set
`MOCKPIT_MCP_MODE=code`; `run` then also takes a `path` to a local script. Skip
it in harnesses that already turn MCP tools into code (pi, Cloudflare Agents),
and on the Cloudflare Worker, which has no sandbox. See the `scripts` topic.

```sh
claude mcp add --scope user --transport http mockpit-code "http://localhost:8228/mcp?mode=code"
```

## Plain HTTP

`POST /api/designs` to publish (create or next version), `POST /api/designs/:id/asks`,
`GET /api/designs` and `GET /api/designs/:id` to read, `GET /api/feedback?session=…`
for the user's reply (returns at once), `POST /api/designs/:id/say`,
`GET /api/designs/:id/export`, and `POST /api/assets` for blob uploads.
`POST /api/run {code}` runs a script against the same API. Documented at
`/agent-howto?topic=http`.

## Claude Code

Claude Code users can have a Send wake the agent, with no prompt from them: the
agent runs `mockpit watch` under the Monitor tool, and each line it prints arrives as
a notification, even while the agent sits idle. `mockpit watch` never returns, so it
only ever runs in the background; no tool, verb or HTTP call waits for the user.
There are two ways to get this.

**Skill.** Install the bundled skill. It tells the agent to arm the watch after
asking, then end its turn:

```sh
cp -r skills/mockpit ~/.claude/skills/
```

```text
Monitor({ command: "mockpit watch", description: "mockpit replies", timeout_ms: 1800000 })
```

A monitor expires after at most 30 minutes, with one notice; the agent re-arms it
while it still expects a reply. An agent without the skill can be told the same thing
in its instructions.

**Plugin.** A plugin bundles all three integrations at once — the MCP server, the
skill, and a **background monitor** that streams your replies from the browser to the
agent as notifications, so each reply arrives without pasting or re-arming a
watcher:

```text
/plugin marketplace add fabiogaliano/mockpit
/plugin install mockpit@mockpit
```

On install it asks for your **Mockpit URL** (default `http://localhost:8228`, or
your deployed instance) and an optional token. The monitor runs `mockpit watch`
for the conversation's own session, so two agents in one repo never take each
other's replies, and a reply wakes the agent even while it sits idle. Each reply
is delivered exactly once. An installed `mockpit` (global, or a checkout on your
`PATH`) is used before `npx`.
Requires Claude Code ≥ 2.1.105. The plugin lives in [`../plugin/`](../plugin/).

## Agents with nothing to wake them

An agent with no background monitor hears a Send on its next call, in any write's
`feedback` or the `feedback` verb, or when you tell it. After a Send, when the server
sees no `mockpit watch` open for that agent's session, the viewer shows a line to copy
and paste to it. It can't tell a stopped agent from a busy one, so it says only that no
watcher is open. Where a harness can run a background command and notify the agent of
its output, `mockpit watch` works there too: one line per Send on stdout. Pi's extension
already does this.

## The design contract

`/agent-howto` is the brief agents read before their first publish: the loop,
parts, asks and knobs, the reply, the html rules, and the project's own palette,
kit and icons, in about 1.2k tokens. Everything deeper is a topic, fetched only
when needed: `knobs`, `asks`, `surfaces`, `html`, `reply`, `http`, `scripts`
(`mockpit guide --topic <id>`, `guide({ topic })`, or
`curl -s …/agent-howto?topic=<id>`). `/guide` serves the `html` topic.
