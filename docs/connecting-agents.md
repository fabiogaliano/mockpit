# Connecting agents

mockpit meets an agent wherever it is. Pick whichever tier the agent supports —
each one covers the full loop: publish a mock, ask the user, read their one
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
mockpit publish --mock cache --state "Cold" --variant grid --html grid.html   # or --md / --diff …
mockpit publish --mock cache --state "Cold" --variant list --html list.html
mockpit ask --mock cache "Which layout?" --option Grid=grid --option List=list
mockpit feedback                               # after the user says they answered; returns at once
mockpit watch                                  # one line per Send, for a background monitor
mockpit guide                                  # print the brief
mockpit guide --topic html                     # print one reference topic
mockpit run loop.js                            # publish and ask in one script
```

## Pi extension

Pi users can install the package directly. It adds the nine verbs as native
tools (`mockpit_publish`, `mockpit_ask`, `mockpit_read`, `mockpit_feedback`,
`mockpit_say`, `mockpit_export`, `mockpit_upload`, `mockpit_guide`,
`mockpit_run`):

```sh
pi install npm:mockpit
# or try it for one run:
pi -e npm:mockpit
```

## MCP

Tools: `publish`, `ask`, `read`, `feedback`, `say`, `export`, `upload`,
`guide`; the server name is the namespace. Connect over stdio or straight to
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

`POST /api/mocks` to publish (create or next version), `POST /api/mocks/:id/asks`,
`GET /api/mocks` and `GET /api/mocks/:id` to read, `GET /api/feedback?session=…`
for the user's reply (returns at once), `POST /api/mocks/:id/say`,
`GET /api/mocks/:id/export`, and `POST /api/assets` for blob uploads.
`POST /api/run {code}` runs a script against the same API. Documented at
`/agent-howto?topic=http`.

## Claude Code

Claude Code users have two extra options.

**Skill.** Install the bundled skill. It tells the agent to arm `mockpit watch`
under Monitor after asking, so your Send wakes it:

```sh
cp -r skills/mockpit ~/.claude/skills/
```

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
against your workspace; each reply is delivered to the agent exactly once.
Requires Claude Code ≥ 2.1.105. The plugin lives in [`../plugin/`](../plugin/).

## The design contract

`/agent-howto` is the brief agents read before their first publish: the loop,
parts, asks and knobs, the reply, the html rules, and the project's own palette,
kit and icons, in about 1.2k tokens. Everything deeper is a topic, fetched only
when needed: `knobs`, `asks`, `surfaces`, `html`, `reply`, `http`, `scripts`
(`mockpit guide --topic <id>`, `guide({ topic })`, or
`curl -s …/agent-howto?topic=<id>`). `/guide` serves the `html` topic.
