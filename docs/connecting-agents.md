# Connecting agents

Every tier covers the whole loop: publish, ask, read the one reply, revise. Nothing waits
for the user: the agent asks, says where to look and ends its turn.

With a shell, paste the setup block into the agent's instructions. It points the agent at
the live instructions on `/agent-howto`.

```sh
curl -s http://localhost:8228/setup >> AGENTS.md
```

## Shell (CLI)

No dependencies. Keeps one session per agent conversation.

```sh
mockpit publish --design cache --state "Cold" --alternative grid --html grid.html   # or --md / --diff …
mockpit publish --design cache --state "Cold" --alternative list --html list.html
mockpit ask --design cache "Which layout?" --option Grid=grid --option List=list
mockpit feedback            # after the user answers; returns at once
mockpit watch               # one line per Send, for a background monitor
mockpit guide               # the brief; --topic html for one topic
mockpit run loop.js         # publish and ask in one script
```

## MCP

Tools: `publish`, `ask`, `read`, `feedback`, `say`, `move`, `edit`, `export`, `upload`,
`guide`. MCP agents get the usage instructions automatically.

```sh
claude mcp add --scope user mockpit -- npx -y mockpit mcp
# or, no local process:
claude mcp add --scope user --transport http mockpit http://localhost:8228/mcp
```

**Code mode** serves one tool, `run`: the agent writes one script that publishes and asks,
run in a QuickJS sandbox; a later run reads `mockpit.feedback()`. Use it for clients that
load every tool into each conversation and have no codemode of their own (claude.ai,
Desktop and ChatGPT connectors). Skip it in harnesses that already turn MCP tools into code
(pi, Cloudflare Agents) and on the Cloudflare Worker, which has no sandbox. Over stdio, set
`MOCKPIT_MCP_MODE=code`; `run` then also takes a `path` to a local script. See the `scripts`
topic.

```sh
claude mcp add --scope user --transport http mockpit-code "http://localhost:8228/mcp?mode=code"
```

## Plain HTTP

| Call                          | Does                         |
| ----------------------------- | ---------------------------- |
| `POST /api/designs`           | publish, or the next version |
| `POST /api/designs/:id/asks`  | ask                          |
| `GET /api/designs[/:id]`      | read                         |
| `GET /api/feedback?session=…` | the reply; returns at once   |
| `POST /api/designs/:id/say`   | say                          |
| `GET /api/designs/:id/export` | export                       |
| `POST /api/assets`            | upload a blob                |
| `POST /api/run {code}`        | run a script                 |

Details: `/agent-howto?topic=http`.

## Waking the agent

Each harness below wakes on a Send, even when idle. With its plugin, nothing runs until a
conversation's first mockpit call, and each session hears only its own replies.

### Claude Code

```text
/plugin marketplace add fabiogaliano/mockpit
/plugin install mockpit@mockpit
```

Asks for your Mockpit URL (default `http://localhost:8228`) and an optional token. Bundles
the MCP server, the skill and an `asyncRewake` hook, which Claude Code must support. A wait
that reaches the hook's 24 hours ends without waking anyone; the reply arrives on the next
call. Uses an installed `mockpit` new enough for `--once`, else `npx`.

Without the plugin, install the skill (`cp -r skills/mockpit ~/.claude/skills/`). The agent
then arms the watch itself after asking and re-arms it when it expires, at 30 minutes at most:

```text
Monitor({ command: "mockpit watch", description: "mockpit replies", timeout_ms: 1800000 })
```

### Codex

Requires 0.149.0 or later. Bundles the MCP server, the skill and a hook.

```sh
codex plugin marketplace add fabiogaliano/mockpit
codex plugin add mockpit@mockpit
```

Review the hook once in `/hooks`. A Send reaches the thread through `codex queue`, usually
within ten seconds. `MOCKPIT_URL` and `MOCKPIT_TOKEN` set another server.

### OpenCode

Add the plugin and the MCP server to `opencode.json`. On 1.x, use the key `plugin` and the
path `…/opencode/mockpit.js`.

```json
{
  "plugins": ["file:///path/to/mockpit/opencode"],
  "mcp": { "mockpit": { "type": "local", "command": ["npx", "-y", "mockpit", "mcp"] } }
}
```

`MOCKPIT_URL` and `MOCKPIT_TOKEN` set another server.

### Pi

Adds the verbs as native tools named `mockpit_*`. Interactive and RPC sessions wake; one-shot
runs (`-p`, json) don't listen.

```sh
pi install npm:mockpit
# or for one run:
pi -e npm:mockpit
```

### Anything else

An agent with nothing watching hears a Send on its next call, or when you tell it. If no
`mockpit watch` is open for its session, the viewer shows a line to paste to it. Where a
harness can run a background command and notify the agent of its output, `mockpit watch`
works there too.

## The design contract

`/agent-howto` is the brief agents read before their first publish. Deeper topics are
fetched when needed: `knobs`, `asks`, `surfaces`, `html`, `feedback`, `http`, `scripts`
(`mockpit guide --topic <id>`, `guide({ topic })`, or `/agent-howto?topic=<id>`). `/guide`
serves the `html` topic.
