---
"mockpit": minor
---

Icons by name, part-scoped revisions, a shorter brief, and typed MCP results.

- **Icons by name.** html surfaces write `<i icon="lucide:check"></i>` and the
  server inlines the svg, so frames need no fetch. lucide and mage are bundled;
  `mockpit icons add <set>` installs any other Iconify set for the project
  (`mockpit icons remove` drops it). Publish and revise warn about unknown icon
  names. This replaces the per-project mage sprite upload.
- **Part-scoped revise.** `revise_mock`, `edit_surface` and the HTTP revise body
  take `parts: { "name" | "name#key": "<outer html>" }`; the CLI takes
  `mockpit revise --part name=file`. The server splices each part into the
  current version's html and reports `applied` next to `partChanges`.
- **One brief, then topics.** `mockpit agent-howto`, `mockpit guide --brief` and
  `get_design_guide` return one project-aware brief (the loop, parts, asks,
  knobs, the reply, and the project's palette, kit and icons). Reference
  topics (knobs, asks, surfaces, html, reply, http) come on demand with
  `agent-howto --topic <id>` or `get_design_guide({ topic })`. With no server
  running, `agent-howto` prints the generic brief.
- **MCP output schemas.** Publish, revise, ask, wait, list, get and export
  declare an `outputSchema` and return `structuredContent` on both transports,
  so codemode harnesses can type results. Surfaces share one `Surface`
  definition, which shrinks the catalog.
- **tunekit from the registry.** The viewer bundles `tunekit@^1.5.0` from npm
  instead of a pinned git commit.
- **Tailwind projects keep their classes.** `mockpit init` stores the repo's
  Tailwind entry stylesheet (non-core imports, plugins and config stripped) and
  the frame loads it as Tailwind source, so `bg-card` and
  `text-muted-foreground` resolve like in the codebase. No more
  `bg-[var(--card)]`.
- **Kits by reference.** A kit can be a hosted stylesheet. `basecoat` ships as
  the shadcn-shaped vocabulary for projects with no design system, and a project
  can register its own stylesheet with `mockpit kit add <id> --url … --doc …`
  (or `init --kit-url`). Any bundled or project kit can be the project's default.
- **The brief reads the repo's design files.** `DESIGN.md`, DTCG `tokens.json`
  and shadcn `components.json` feed the brief when present: the team's rules,
  the main tokens and the installed component list.
- **Waits agree.** `mockpit wait`, `wait_for_feedback` (stdio and HTTP) and the
  Pi extension all default to 55 seconds and cap at 230: under the 60 s tool
  timeout Codex and the MCP SDK use by default, and under claude.ai's 240 s
  limit. A wait the client cancels no longer consumes the feedback; the next
  wait gets it.
- `mockpit ask "<question>" --asks <file>` is now an error instead of dropping
  the question, and `mockpit watch --help` prints its own help.
