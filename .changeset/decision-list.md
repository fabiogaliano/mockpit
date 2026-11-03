---
"mockpit": minor
---

Decision list: mockpit now writes down what you settled, so the next agent doesn't make you say it again. Each project gets a list built from your replies with no agent's help: what was asked, what you picked and left, your words, and what you put in use. A later reply replaces its line. Open it from Home (Recent's Decisions filter, `?sec=recent&show=decisions`); every line links to its mock, and you can reword or remove any of them. Agents get it first: `read` of a project or a mock now carries `decisionList` on all three tiers, with that mock's lines marked `here`, and the brief tells them to treat it as settled unless you say otherwise. `read --decisions` (MCP `read({decisions: true})`, `GET /api/projects/:name/decisions`) returns all of it when a read was cut to stay small. A changed answer also drops the note written on the old one, everywhere `read` shows it.
