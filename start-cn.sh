#!/bin/sh
# Starts StarPoint for the globalized CN World Flipper (run ./setup.sh once first). UNTESTED, see setup.sh.
# The game talks to 127.0.0.1:8000; an emulator reaches this machine through adb reverse, set up here
# whenever adb is available. The dashboard is at http://127.0.0.1:8000 in your browser.
cd "$(dirname "$0")"
if [ ! -f out/server.js ]; then
    echo "The server isn't built yet: run ./setup.sh first."
    exit 1
fi
if command -v adb >/dev/null 2>&1; then
    adb reverse tcp:8000 tcp:8000 >/dev/null 2>&1
    adb reverse tcp:18888 tcp:18888 >/dev/null 2>&1
fi
echo "StarPoint is starting. Dashboard: http://127.0.0.1:8000  (Ctrl+C stops the server)"
exec node --env-file=.env out/server.js
