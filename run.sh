#!/usr/bin/env bash
# Start Nudge and open it in the browser.
#   ./run.sh            # this PC only (http://127.0.0.1:8765)
#   ./run.sh --lan      # also from your phone on the same Wi-Fi (no password!)
cd "$(dirname "$0")"
PORT=8765
for a in "$@"; do [[ "$prev" == "--port" ]] && PORT="$a"; prev="$a"; done
( sleep 1; xdg-open "http://127.0.0.1:$PORT" >/dev/null 2>&1 ) &
exec /usr/bin/python3 server.py "$@"
