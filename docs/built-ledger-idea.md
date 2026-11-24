# Idea: a built ledger for decisions

Status: idea, not shaped, nothing built. Audience: mockpit maintainers/agents. Written
2026-11-24 from a working session on a portfolio site (project `fabiogaliano/demo`).

## Problem

Mockpit records what the user decided, but not whether the code caught up.

- **Ready** is the user's mark that a version is the one to build.
- **Changed** is derived and only means the design moved after Ready.
- **`source`** is a code path stored as a label. Nothing checks it.
- **Use** is an instruction to change the code, with no record of whether it happened.

In the session, answering "what's decided but not built?" meant an agent reading 18
decision lines and grepping the code for each. Six were unbuilt. Once the code then moved
past the design (a section renamed, a click behaviour removed), nothing in mockpit knew.

## The idea

Give each decision line, and each behaviour line of a spec, a build status the agent
records when it implements it:

- **status**: built, not built, deferred, dropped, or built differently (with a reason)
- **commit**: the git commit it was built at
- **files**: the files that implement it (the design's `source`, or narrower)

`read` then answers "what's decided but not built?" directly, per design and per project.

A stored status is only a claim. To know when to distrust it, check whether those files
changed since that commit (`git log <commit>..HEAD -- <files>`). No commits: still trusted.
Any commits: the entry reads "needs re-check", and an agent re-audits that one line.

## Why this one

Seven approaches were compared:

| Approach                                | Weakness                                                    |
| --------------------------------------- | ----------------------------------------------------------- |
| Audit on demand (today)                 | Slow, repeated every time, easy to miss things              |
| A Built mark per design                 | Too coarse: says which design is behind, not which decision |
| **Ledger per decision**                 | A claim; stale when the code changes later                  |
| Checklist file exported to the repo     | Two stores to keep aligned                                  |
| Markers in code that mockpit scans for  | Litters the code; presence isn't correctness                |
| A browser test per decision             | Expensive; taste decisions can't be tested                  |
| **Re-check when `source` files change** | Needs an agent run; only as good as the audit               |

The ledger plus the re-check signal was picked because it:

- answers the actual question, per decision;
- works for React, Vue and plain HTML alike, since it needs only text, paths and commits;
- is honest: each entry is "built, untouched since" or "needs re-check", never a silent guess;
- leaves the code alone;
- extends decisions, the spec and `source`, which already exist.

## Known limits and open questions

- **The staleness signal means "might be stale", not "is broken".** An unrelated edit to the
  same file triggers it. One large file implementing many decisions flags all of them.
- **The server can't see the repo.** The git check has to run in the CLI or the agent's
  session, so it happens on a command, not continuously in the viewer.
- **It depends on agents recording status every time.** The skill and guide would have to
  make it part of finishing any build.
- **Not every decision is buildable.** Some are deferred ("I'll come back to this") or reject
  every option. Hence deferred and dropped.
- **Decisions get superseded in code on purpose.** Without "built differently", those would
  be flagged forever. Should that also write a spec line back?
- **`source` has to be right.** In the session one pointed at an old sketch file, not the
  live code. Does marking something built validate or correct it?
- **Who may mark built?** Ready is the user's alone. Is built the agent's claim, the user's
  confirmation, or both?

## Not part of this

- Pixel comparison between the design and the running app.
- Translating a design's HTML into framework components.
- Tests per decision. Worth adding later only for behaviours that are objectively checkable
  and tend to regress (for example, nothing animating with reduced motion set).
