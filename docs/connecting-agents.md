# Connecting agents

mockpit meets an agent wherever it is. Pick whichever tier the agent supports —
each one covers the full loop: publish a mock, ask the user, read their one
batched reply, revise.

The fastest path for any agent with a shell is to paste the setup block into its
instructions:

```sh
curl -s http://localhost:8228/setup >> AGENTS.md
```

That block is intentionally small: it tells any agent (Pi, opencode, amp,
codex, Claude Code) to fetch the current instructions from the running server at
`/agent-howto` (or `mockpit agent-howto`). The sections below are
the underlying tiers those live instructions build on.

## Shell (CLI)

The `mockpit` CLI has no dependencies and keeps one session per agent
conversation for you:

```sh
mockpit publish --mock cache --state "Cold" --variant grid --html grid.html   # or --md / --diff …
mockpit publish --mock cache --state "Cold" --variant list --html list.html
mockpit ask --mock cache "Which layout?" --option Grid=grid --option List=list
mockpit wait                                   # block until the user sends their reply
mockpit agent-howto                            # print the brief
mockpit agent-howto --topic html               # print one reference topic
mockpit run loop.js                            # publish, ask and wait in one script
```

## Pi extension

Pi users can install the package directly. It adds native `mockpit_*` tools for
publishing and revising mocks, asking, uploading assets, waiting for the reply,
and replying in a mock's thread:

```sh
pi install npm:mockpit
# or try it for one run:
pi -e npm:mockpit
```

## MCP

Tools: `publish_mock`, `revise_mock`, `list_mocks`, `get_mock`, `ask_user`,
`wait_for_feedback`, `reply_to_user`, `export_mock`, `upload_asset`,
`get_design_guide`, and the surface edits `add_surface`, `edit_surface`,
`remove_surface`, `reorder_surfaces`. Connect over stdio or straight to the
server at `/mcp`:

```sh
claude mcp add --scope user mockpit -- npx -y mockpit mcp
# or, no local process:
claude mcp add --scope user --transport http mockpit http://localhost:8228/mcp
```

MCP agents get the usage instructions automatically.

**Code mode.** Clients that load every tool into each conversation and have no
codemode of their own (claude.ai, Desktop and ChatGPT connectors) can connect to
`/mcp?mode=code` instead. It serves one tool, `run`, whose description is the
typed script API: the agent writes one JavaScript script that publishes, asks
and waits, and the server runs it in a QuickJS sandbox. Over stdio, set
`MOCKPIT_MCP_MODE=code`; `run` then also takes a `path` to a local script. Skip
it in harnesses that already turn MCP tools into code (pi, Cloudflare Agents),
and on the Cloudflare Worker, which has no sandbox. See the `scripts` topic.

```sh
claude mcp add --scope user --transport http mockpit-code "http://localhost:8228/mcp?mode=code"
```

## Plain HTTP

`POST /api/mocks` to publish, `POST /api/mocks/:id/revise`,
`POST /api/mocks/:id/asks`, `GET /api/mocks/:id/export`, `POST /api/assets` for
blob uploads, and `GET /api/comments?session=…&author=user&wait=60` for
long-polling the user's reply. `POST /api/run {code}` runs a script against
the same API. Documented at `/guide`.

## Claude Code

Claude Code users have two extra options.

**Skill.** Install the bundled skill:

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
(`mockpit agent-howto --topic <id>`, `get_design_guide({ topic })`, or
`curl -s …/agent-howto?topic=<id>`). `/guide` serves the `html` topic.
