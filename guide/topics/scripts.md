# mockpit topic: scripts

`run` executes a JavaScript script on the server against the mockpit API. One
run can publish two variants, ask which one, and wait for the reply. That is
four tool calls in one.

## When to use it

- Your client loads every MCP tool into each conversation and has no codemode
  of its own (claude.ai, Desktop and ChatGPT connectors). Connect to
  `/mcp?mode=code` instead of `/mcp`: one `run` tool, about a third of the
  catalog.
- You work from a shell and want the whole loop in one file:
  `mockpit run loop.js`.
- Skip it when your harness already turns MCP tools into code (pi, Cloudflare
  Agents). A script inside a script means double escaping; use the plain tools.
- The Cloudflare Worker has no sandbox. There `run` answers that it is
  unavailable.

| CLI                                 | MCP                                                                       | HTTP                                               |
| ----------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| `mockpit run <file>` (`-` is stdin) | `run` on `/mcp?mode=code`, or stdio with `MOCKPIT_MCP_MODE=code` (`path`) | `POST /api/run {code, session?, project?, agent?}` |

The session, project and agent are fixed for a run. The result carries the
`session`; pass it to the next run so its waits hear the reply. The CLI and the
stdio server keep one session for you.

## The API

The script is the body of an async function in plain JavaScript. Write html in
template literals; a backtick or `${` inside the markup needs a backslash.

<!-- run-api -->

## Publish A/B, ask, wait

```js
const card = (tone) => `
  <section data-part="hero" style="padding: 32px; color: var(--color-text-${tone === "bold" ? "primary" : "secondary"})">
    <h1>Writer</h1>
    <button data-part="cta">Start writing</button>
  </section>`;
await mockpit.publish({ mock: "writer", title: "Writer", variant: "calm", html: card("calm") });
await mockpit.publish({ mock: "writer", variant: "bold", html: card("bold") });
const { url } = await mockpit.ask("writer", [
  {
    id: "look",
    text: "Which look?",
    options: [
      { label: "Calm", variant: "calm" },
      { label: "Bold", variant: "bold" },
    ],
  },
]);
print("review at", url);
const [reply] = await mockpit.wait(150);
return reply ?? "no reply yet";
```

## The result

```json
{
  "ok": true,
  "value": {
    "mock": "writer",
    "reply": { "asks": [{ "ask": "look", "chosen": [{ "label": "Bold" }] }] }
  },
  "prints": ["review at http://localhost:8228/project/demo/writer"],
  "calls": [
    { "fn": "publish", "ok": true, "summary": "writer/calm v1" },
    { "fn": "publish", "ok": true, "summary": "writer/bold v1" },
    { "fn": "ask", "ok": true, "summary": "writer 1 ask(s)" },
    { "fn": "wait", "ok": true, "summary": "1 batch(es)" }
  ],
  "feedback": [{ "mock": "writer", "reply": { "…": "…" } }],
  "session": "S"
}
```

- `calls` lists every host call in order. After a failure it tells you which
  writes landed. A rerun publishes new versions, so check it first.
- `feedback` holds every batch the run received, from `wait()` and from the
  feedback that rides on writes. It is there even when the script threw or ran
  out of time. Feedback is delivered once: read it here, not from a later wait.
- `error.kind` is `script` (a throw or a syntax error, with `line` and
  `column`), `timeout`, `limit` (CPU, memory, code size, call count) or
  `aborted` (the caller went away).

## Errors

A host call that fails rejects with the message REST would give, so
`try`/`catch` works:

```js
try {
  await mockpit.revise({
    mock: "writer",
    variant: "calm",
    parts: { hero: '<section data-part="hero">…</section>' },
  });
} catch (e) {
  print("revise failed:", e.message);
  await mockpit.publish({
    mock: "writer",
    variant: "calm",
    html: '<section data-part="hero">…</section>',
  });
}
```

## Limits

| What       | Limit                                                        |
| ---------- | ------------------------------------------------------------ |
| Wall time  | 200 s per run; `wait()` returns a few seconds before that    |
| CPU        | 10 s of script compute                                       |
| Memory     | 32 MiB heap, 256 KiB stack                                   |
| Code       | 1 MiB                                                        |
| Output     | 24,000 chars of value and prints; the head and tail are kept |
| Host calls | 100 per run, 4 in flight                                     |
| Runs       | 4 at a time per server                                       |

No network, timers, imports, `require` or `process` exist in the sandbox. The
only way out is `mockpit.*`, and it can do what your token can over REST, no
more.
