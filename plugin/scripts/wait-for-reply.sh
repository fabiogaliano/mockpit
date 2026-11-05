#!/bin/sh
# Runs after every mockpit call and at the end of every turn. The first mockpit
# call starts the wait, and a turn's end restarts it after a wake (--if-started),
# so a conversation that never uses mockpit keeps nothing running and a woken agent
# doesn't have to do anything to hear the next Send.
input=$(cat)
session=$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9-]*\)".*/\1/p')
[ -n "$session" ] && [ -n "${CLAUDE_PLUGIN_DATA:-}" ] || exit 0

dir="$CLAUDE_PLUGIN_DATA/waiting"
lock="$dir/$session"
if [ "${1:-}" = "--if-started" ] && [ ! -e "$lock" ]; then exit 0; fi
mkdir -p "$dir" || exit 0
find "$dir" -type f -mtime +2 -exec rm -f {} + 2>/dev/null
# A second waiter would be harmless to delivery, which is exactly-once on the
# server, but one per conversation is all a wake needs.
if ! (set -C; echo "$$" >"$lock") 2>/dev/null; then
  pid=$(cat "$lock" 2>/dev/null)
  if [ -z "$pid" ] || kill -0 "$pid" 2>/dev/null; then exit 0; fi
  rm -f "$lock"
  (set -C; echo "$$" >"$lock") 2>/dev/null || exit 0
fi

export MOCKPIT_URL="${CLAUDE_PLUGIN_OPTION_MOCKPITURL:-http://localhost:8228}"
if [ -n "${CLAUDE_PLUGIN_OPTION_APITOKEN:-}" ]; then
  export MOCKPIT_TOKEN="$CLAUDE_PLUGIN_OPTION_APITOKEN"
fi
export CLAUDE_CODE_SESSION_ID="$session"

# Exit code 2 is what wakes Claude Code. exec keeps the lock's pid on the process
# that is really waiting. An installed mockpit too old for --once would never
# wake anyone, so it loses to npx.
if command -v mockpit >/dev/null 2>&1 && mockpit watch --help 2>/dev/null | grep -q -- --once; then
  exec mockpit watch --once --exit-code 2
fi
exec npx -y mockpit watch --once --exit-code 2
