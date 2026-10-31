#!/bin/sh
# Hooks receive the plugin's options as CLAUDE_PLUGIN_OPTION_*; monitors receive
# neither those nor ${user_config.*}. Leave the server and token where the
# monitor reads them, as raw files, so no value is ever parsed by a shell.
umask 077
mkdir -p "$CLAUDE_PLUGIN_DATA" || exit 0
printf '%s' "${CLAUDE_PLUGIN_OPTION_MOCKPITURL:-http://localhost:8228}" > "$CLAUDE_PLUGIN_DATA/url"
printf '%s' "${CLAUDE_PLUGIN_OPTION_APITOKEN:-}" > "$CLAUDE_PLUGIN_DATA/token"
