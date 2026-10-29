---
"mockpit": minor
---

The brief takes guidance in layers, so design taste is opt-in rather than built in.

- Core stays how mockpit works. The html topic's finish rules (flat, no shadows, two weights, sentence case, no emoji) are gone from it.
- Packs ship with mockpit, off by default. The first, `design-craft`, covers asking before designing, variants that differ in one clear thing, real content, no filler, situations, and converging once the user has chosen.
- `~/.mockpit/rules.md` (next to the database) is the user's own guidance, read live by a local server; `.mockpit/rules.md` is the project's, committed with the repo and sent by the new `mockpit rules` (and by `mockpit init`). Either turns packs on with `packs: [design-craft]` in its frontmatter and has `## Rules` and `## Suggestions`. Higher wins: project, then the user's, then packs, then core. `mockpit rules --mine` stores the user's file on a deployed server, which has no home folder.
- The brief opens with a `Guidance:` line naming the layers that are on, and prints each under its own heading. With no rules file it is unchanged.
- `mockpit init` now ignores `.mockpit/*` but keeps `.mockpit/rules.md` trackable, upgrading the `.mockpit/` line it wrote before.
