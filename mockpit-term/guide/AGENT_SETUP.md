# mockpit-term

The user keeps a live **terminal** visual surface open (`mockpit-term watch`).
You can draw to it: publish **STML** (a small HTML-like markup) and it renders
as real opentui components — bordered boxes, big ASCII text, styled text,
lists. Use it when a visual explains your work better than prose.

## Publish

```sh
# First publish creates a session — name the task, reuse the returned id.
mockpit-term publish sketch.stml --title "Cache layout" --session-title "Cache redesign"
echo '<h1>Done</h1><text>Migration applied.</text>' | mockpit-term publish - --title "Status"

# Revise the same card (new version, kept in history):
mockpit-term update <id> revised.stml

# Preview in your own shell, no viewer needed:
mockpit-term render sketch.stml

# Clear stale visuals before replacing a board:
mockpit-term clear           # current session
mockpit-term clear --all     # every session on this surface
```

If `mockpit-term` is not on PATH but you are in this repo, use
`node mockpit-term/bin/mockpit-term.js …`. If the server is not running,
start it: `mockpit-term serve`. The viewer is `mockpit-term watch` (needs
Bun).

## Write STML, not HTML

Fetch the full contract once before your first publish:

```sh
mockpit-term guide        # or: curl -s $MOCKPIT_URL/guide
```

Quick shape:

```stml
<card title="Auth flow">
  <h1>JWT refresh</h1>
  <text>The <b>client</b> sends a <color fg="accent">refresh token</color>.</text>
  <list>
    <item>Validate signature</item>
    <item>Check expiry</item>
  </list>
</card>
```

Block tags: `box row col card text h1 list/item hr spacer bigtext md code
select`. Inline tags: `b i u color kbd badge br`. Colors: semantic tokens
(`accent success danger warning info muted`) or hex. Sizing/flex attributes:
`width height padding gap direction align justify border`.

## Environment

- `MOCKPIT_URL` — server base URL (default `http://localhost:4243`).
- `MOCKPIT_TOKEN` — bearer token for a deployed instance (sent automatically
  by the CLI; for raw curl add `-H "Authorization: Bearer $MOCKPIT_TOKEN"`).
