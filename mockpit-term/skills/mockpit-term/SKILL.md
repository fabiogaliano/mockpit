---
name: mockpit-term
description: Draw live terminal visualizations to the user's mockpit-term surface — bordered diagrams, dashboards, big ASCII headings, styled text, lists — using STML (a small HTML-like markup that renders via opentui). Use when the user asks you to illustrate, visualize, sketch, or show something in the terminal, mentions mockpit-term, or when a richer visual would explain your work better than plain output.
---

# mockpit-term

The user keeps a live terminal visual surface open (`mockpit-term watch`). You
publish **STML** — an HTML-like markup — and it renders instantly as real
opentui components (boxes, borders, big ASCII text, styled text, lists, menus).
This is a higher-fidelity surface than the text you normally print.

## Before your first publish

Fetch the markup contract once per session:

```sh
mockpit-term guide        # or: curl -s $MOCKPIT_URL/guide
```

If `MOCKPIT_URL` is unset, the surface is at `http://localhost:4243`. If the
server is not running, start it: `mockpit-term serve`. If the
`mockpit-term` command is not on PATH but you are inside this repo, use
`node mockpit-term/bin/mockpit-term.js ...`.

## Publishing

Prefer MCP tools if connected (`publish_snippet`, `update_snippet`,
`list_snippets`). Otherwise use the CLI — session grouping is automatic:

```sh
mockpit-term publish sketch.stml --title "Cache layout" --session-title "Cache redesign"
echo '<h1>Done</h1><text>Migration applied.</text>' | mockpit-term publish - --title "Status"
```

Save the returned `sessionId` and snippet `id`. Iterate with
`mockpit-term update <id> revised.stml` (same card, new version) instead of
publishing near-duplicates — versions are kept. Preview without the viewer:
`mockpit-term render sketch.stml`.

To remove stale visuals before replacing a board, run `mockpit-term clear` for
the current session or `mockpit-term clear --all` for every session on the
surface.

Rules of thumb:

- On your first publish, set a session title that names the task ("Auth
  refactor"), not the tool. It applies only when the session is created.
- One concept per snippet, with a clear title. A series of small snippets
  beats one giant page.
- Reach for `<card>`, `<row>`/`<col>`, `<list>`, `<bigtext>` and the semantic
  color tokens (`accent`, `success`, `danger`, `warning`, `info`, `muted`)
  before hand-tuning layout.

## Writing STML

Block tags: `box row col card text h1 h2 h3 list/item hr spacer bigtext code
select input`. Inline tags (inside `<text>`/headings): `b i u s dim color/c
kbd badge a br`. Layout attributes on blocks: `width height padding margin gap
direction align justify grow border border-style border-color bg title`.

```stml
<card title="Auth flow">
  <h1>JWT refresh</h1>
  <text>The <b>client</b> sends a <color fg="accent">refresh token</color>.</text>
  <row gap="2">
    <box border bg="#0f2a1a" padding="1"><text fg="success">200 OK</text></box>
    <box border padding="1"><text fg="danger">401</text></box>
  </row>
  <list>
    <item>Validate signature</item>
    <item>Check expiry</item>
  </list>
</card>
```

Whitespace in normal text is collapsed, so indent freely. Unknown tags and bad
colors show up as render notes rather than crashing — but check
`mockpit-term render` if something looks off.

## Remote surfaces

A deployed instance needs `MOCKPIT_URL` and `MOCKPIT_TOKEN` set; the CLI sends
the token automatically. For raw curl, add `-H "Authorization: Bearer $MOCKPIT_TOKEN"`.

## Note

This version is render-only: you publish and revise; the user watches. Typing
comments back from the terminal viewer is not yet wired up.
