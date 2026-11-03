---
"mockpit": minor
---

After Send. With another design owing answers the screen moves on as before. With none it stays and shows how far the Send has come: Not seen yet, Delivered, Agent working, then a new version with a way to see it. The Thread still renders every Send, with Delivered and Not seen yet read from the same cursor.

Waking the agent. The setup block, the brief, the skills and `docs/connecting-agents.md` say how a Claude Code agent runs `mockpit watch` under Monitor, re-armed when the monitor expires, so a Send wakes it. Where no watcher is open for the agent's session, the viewer shows a line to copy and paste to it, under the status, on the next design and in the Thread.

Whose turn is always visible, on the open screen at every width and on each album: N questions, Draft to send, Changed, Not seen yet, Agent working, In use, Sent, Exploring or Nothing waiting. "Agent working" appears only after a write or `feedback` call from that session since the Send, for five minutes; a watcher re-arming doesn't count.

QR code. A tool beside Try draws a code for the design, state and version on stage, encoded in the viewer with no outside service, to open it on a phone or iPad. On `localhost` or `127.0.0.1` it says a phone can't reach that and offers this computer's network addresses instead. The code never carries the workspace key, and says what a phone that hasn't signed in will meet.
