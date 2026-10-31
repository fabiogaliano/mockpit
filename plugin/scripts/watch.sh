#!/bin/sh
# The monitor and the SessionStart hook start together; give the hook a moment
# to leave the server and token (see remember-server.sh).
data="$1"
i=0
while [ ! -f "$data/url" ] && [ "$i" -lt 30 ]; do
  sleep 1
  i=$((i + 1))
done
if [ -s "$data/url" ]; then
  MOCKPIT_URL=$(cat "$data/url")
  export MOCKPIT_URL
fi
if [ -s "$data/token" ]; then
  MOCKPIT_TOKEN=$(cat "$data/token")
  export MOCKPIT_TOKEN
fi
# An installed mockpit (global, or a checkout linked on PATH) wins over npx, so
# the watcher speaks the same contract as the server it was installed with.
if command -v mockpit >/dev/null 2>&1; then
  exec mockpit watch
fi
exec npx -y mockpit watch
