---
"mockpit": patch
---

Replies no longer get lost when the agent restarts. If you Send to a session that has gone quiet (new conversation, `/clear`, crash), the next agent session in the same project and checkout picks it up through feedback, piggyback or `mockpit watch`, and the batch carries a `handoff` line saying where it came from. Agents running side by side keep their own replies: the earlier session must have made no call since the newer one started, must have no `watch` open, and gets two minutes after a Send to claim it first. In the Thread, a Send waiting on a session like that now reads "Waiting — the agent that asked restarted; the next agent in this project will get it" instead of "Not seen yet".
