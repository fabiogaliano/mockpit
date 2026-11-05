# mockpit topic: scripts

`run` executes a JavaScript script on the server against the mockpit API: one run can
publish two variants and ask which. A script never waits for the user. End the turn after the
run that asks; once they say they answered, a later run reads `mockpit.feedback()`.

## When to use it

- Your client loads every MCP tool into each conversation and has no codemode of its own
  (claude.ai, Desktop and ChatGPT connectors): connect to `/mcp?mode=code` for one `run` tool.
- You work from a shell and want the whole loop in one file: `mockpit run loop.js`.
- Skip it when your harness already turns MCP tools into code (pi, Cloudflare Agents).
- On the Cloudflare Worker, which has no sandbox, `run` answers that it is unavailable.

| CLI                                 | MCP                                                                       | HTTP                                               |
| ----------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| `mockpit run <file>` (`-` is stdin) | `run` on `/mcp?mode=code`, or stdio with `MOCKPIT_MCP_MODE=code` (`path`) | `POST /api/run {code, session?, project?, agent?}` |

The session, project and agent are fixed for a run. The result carries the `session`; pass it
to the next run so its `feedback()` hears the reply. The CLI and stdio server keep one for you.

## The API

The script is the body of an async function in plain JavaScript. Write html in
template literals; a backtick or `${` inside the markup needs a backslash.

<!-- run-api -->

## Publish A/B, ask

```js
const card = (tone) => `
  <section data-part="hero" style="padding: 32px; color: var(--color-text-${tone === "bold" ? "primary" : "secondary"})">
    <h1>Writer</h1>
    <button data-part="cta">Start writing</button>
  </section>`;
await mockpit.publish({ design: "writer", title: "Writer", variant: "calm", html: card("calm") });
await mockpit.publish({ design: "writer", variant: "bold", html: card("bold") });
const { url } = await mockpit.ask("writer", [
  {
    id: "tone",
    text: "Calm or bold?",
    options: [
      { label: "Calm", variant: "calm" },
      { label: "Bold", variant: "bold" },
    ],
  },
]);
return url;
```

Tell the user where to look and end your turn. Once they say they answered:

```js
const { feedback, pending } = await mockpit.feedback();
return feedback.length ? feedback : pending;
```

## The result

```json
{
  "ok": true,
  "value": "http://localhost:8228/project/demo/writer",
  "prints": [],
  "calls": [
    { "fn": "publish", "ok": true, "summary": "writer/calm v1" },
    { "fn": "publish", "ok": true, "summary": "writer/bold v1" },
    { "fn": "ask", "ok": true, "summary": "writer 1 ask(s)" }
  ],
  "feedback": [],
  "session": "S"
}
```

- `calls` lists every host call in order. After a failure it shows which writes landed; a
  rerun publishes new versions, so check it first.
- `feedback` holds every batch the run received, from `feedback()` and from writes, even when
  the script threw or timed out. It is delivered once: read it here.
- `error.kind` is `script` (a throw or a syntax error, with `line` and
  `column`), `timeout`, `limit` (CPU, memory, code size, call count) or
  `aborted` (the caller went away).

## Errors

A failed host call rejects with REST's message, so `try`/`catch` works:

```js
try {
  await mockpit.publish({
    design: "writer",
    variant: "calm",
    parts: { hero: '<section data-part="hero">…</section>' },
  });
} catch (e) {
  print("part splice failed:", e.message);
  await mockpit.publish({
    design: "writer",
    variant: "calm",
    html: '<section data-part="hero">…</section>',
  });
}
```

## Limits

| What       | Limit                                                        |
| ---------- | ------------------------------------------------------------ |
| Wall time  | 10 s per run                                                 |
| CPU        | 10 s of script compute                                       |
| Memory     | 32 MiB heap, 256 KiB stack                                   |
| Code       | 1 MiB                                                        |
| Output     | 24,000 chars of value and prints; the head and tail are kept |
| Host calls | 100 per run, 4 in flight                                     |
| Runs       | 4 at a time per server                                       |

The sandbox has no network, timers, imports, `require` or `process`. The only way out is
`mockpit.*`, with what your token can do over REST.
