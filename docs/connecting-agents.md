# Connecting agents

mockpit meets an agent wherever it is. Pick whichever tier the agent supports —
each one covers the full loop: publish a post, render it live, read the user's
comments, reply or revise.

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

The `mockpit` CLI has no dependencies and groups a conversation's posts into
one session for you:

```sh
mockpit publish sketch.html --title "Cache layout"
mockpit diff change.patch --title "Refactor"   # or markdown / image / terminal
mockpit wait                                   # block until the user comments
mockpit agent-howto                     # print current agent how-to
mockpit guide                                  # print the design contract
```

## Pi extension

Pi users can install the package directly. It adds native `mockpit_*` tools for
publishing/updating posts, uploading assets, waiting for feedback, and replying
in browser threads:

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

## Plain HTTP

`POST /api/mocks` to publish, `POST /api/mocks/:id/revise`,
`POST /api/mocks/:id/asks`, `GET /api/mocks/:id/export`, `POST /api/assets` for
blob uploads, and `GET /api/comments?session=…&author=user&wait=60` for
long-polling the user's reply. Documented at `/guide`.

## Claude Code

Claude Code users have two extra options.

**Skill.** Install the bundled skill:

```sh
cp -r skills/mockpit ~/.claude/skills/
```

**Plugin.** A plugin bundles all three integrations at once — the MCP server, the
skill, and a **background monitor** that streams your browser comments to the
agent as notifications, so feedback arrives without pasting or re-arming a
watcher:

```text
/plugin marketplace add fabiogaliano/mockpit
/plugin install mockpit@mockpit
```

On install it asks for your **Mockpit URL** (default `http://localhost:8228`, or
your deployed instance) and an optional token. The monitor runs `mockpit watch`
against your workspace; comments are delivered to the agent exactly once. Requires
Claude Code ≥ 2.1.105. The viewer's "connect agent" link (sidebar footer) shows
generic MCP client setup; the Claude Code plugin lives in [`../plugin/`](../plugin/).

## The design contract

`/agent-howto` is the current operational playbook for agents: publishing,
feedback, CLI/MCP/curl choices, and gotchas. The contract at `/guide` is the
lower-level design reference: fragment-only HTML, theme CSS variables, dark mode
rules, and when to reach for each surface kind. Agents should fetch the instructions
first, then fetch the guide once before their first publish (`mockpit guide`,
`get_design_guide`, or `curl -s …/guide`).
