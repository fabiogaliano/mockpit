#!/bin/sh
# The first mockpit call in a conversation starts the wait, so one that never uses
# mockpit keeps nothing running. In Claude Code the wait ends with each wake and the
# turn's end restarts it (--if-started), so a woken agent has nothing to do to hear
# the next Send. In Codex (--codex) one wait runs on.
input=$(cat)
session=$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9-]*\)".*/\1/p')
[ -n "$session" ] && [ -n "${CLAUDE_PLUGIN_DATA:-}" ] || exit 0

harness=claude
if_started=
for arg in "$@"; do
  case "$arg" in
    --codex) harness=codex ;;
    --if-started) if_started=1 ;;
  esac
done

# Codex can't filter a Bash hook by command, so every shell call lands here.
if [ "$harness" = codex ]; then
  case "$input" in
    *'"tool_name":"Bash"'* | *'"tool_name": "Bash"'*)
      case "$input" in *mockpit*) ;; *) exit 0 ;; esac
      ;;
  esac
fi

dir="$CLAUDE_PLUGIN_DATA/waiting"
lock="$dir/$session"
if [ -n "$if_started" ] && [ ! -e "$lock" ]; then exit 0; fi
mkdir -p "$dir" || exit 0
find "$dir" -type f -mtime +2 -exec rm -f {} + 2>/dev/null
# A second waiter would only repeat what the first one heard; one per conversation
# is all a wake needs.
if ! (set -C; echo "$$" >"$lock") 2>/dev/null; then
  pid=$(cat "$lock" 2>/dev/null)
  if [ -z "$pid" ] || kill -0 "$pid" 2>/dev/null; then exit 0; fi
  rm -f "$lock"
  (set -C; echo "$$" >"$lock") 2>/dev/null || exit 0
fi

export MOCKPIT_URL="${CLAUDE_PLUGIN_OPTION_MOCKPITURL:-${MOCKPIT_URL:-http://localhost:8228}}"
if [ -n "${CLAUDE_PLUGIN_OPTION_APITOKEN:-}" ]; then
  export MOCKPIT_TOKEN="$CLAUDE_PLUGIN_OPTION_APITOKEN"
fi

# An installed mockpit too old for --once would never wake anyone, so it loses to npx.
if command -v mockpit >/dev/null 2>&1 && mockpit watch --help 2>/dev/null | grep -q -- --once; then
  set -- mockpit watch --once
else
  set -- npx -y mockpit watch --once
fi

if [ "$harness" = claude ]; then
  export CLAUDE_CODE_SESSION_ID="$session"
  # Exit code 2 is what wakes Claude Code. exec keeps the lock's pid on the process
  # that is really waiting.
  exec "$@" --exit-code 2
fi

# A Codex hook finishing starts no turn, and only codex queue does. The reply stays
# on the session's cursor, so a queue that fails loses a wake and never the reply.
export MOCKPIT_SESSION_KEY="codex:$session"
# Codex dying leaves this loop running with nothing to wake.
(
  while [ "$(ps -o ppid= -p "$$" | tr -d ' ')" != 1 ]; do sleep 30; done
  kill "$$"
) >/dev/null 2>&1 &
while :; do
  line=$("$@") || { sleep 5; continue; }
  [ -n "$line" ] || continue
  queued=
  for delay in 1 5 15; do
    if codex queue --thread "$session" --message "$line" >/dev/null 2>&1; then
      queued=1
      break
    fi
    sleep "$delay"
  done
  # The thread is gone or Codex can't reach it. The next mockpit call starts again.
  [ -n "$queued" ] || exit 0
done
