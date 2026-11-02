#!/bin/sh
# One-time setup for the globalized CN World Flipper on StarPoint (Linux/macOS).
# UNTESTED: written to match setup.bat, which is the tested one.
# Installs the server's packages, builds it, checks the game files, optionally installs the game over
# adb, then starts the server. Run ./start-cn.sh to start it again later.
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
    echo "Node.js is not installed: install Node.js 20 or newer (https://nodejs.org), then run ./setup.sh again."
    exit 1
fi
major=$(node -p "process.versions.node.split('.')[0]")
if [ "$major" -lt 20 ]; then
    echo "Node.js $major is too old: install Node.js 20 or newer, then run ./setup.sh again."
    exit 1
fi

if [ ! -f node_modules/better-sqlite3/build/Release/better_sqlite3.node ]; then
    echo "Installing the server's packages (needs internet once)..."
    npm ci --no-audit --no-fund
fi
echo "Building the server..."
npx tsc -p .

[ -f .env ] || cp .env.example .env
mkdir -p .database

echo "Checking the game files..."
node scripts/verify_package.cjs

if command -v adb >/dev/null 2>&1; then
    printf "Install the game on the emulator or phone connected with adb now? [y/N] "
    read -r answer
    case "$answer" in
        [yY]*) adb devices; for apk in apk/*.apk; do echo "Installing $apk ..."; adb install -r "$apk"; done ;;
    esac
else
    echo "adb was not found: install the APK in the apk folder yourself. For an emulator, also run:"
    echo "    adb reverse tcp:8000 tcp:8000 && adb reverse tcp:18888 tcp:18888"
fi

echo "Setup done. From now on, start the server with ./start-cn.sh."
printf "Start the server now? [y/N] "
read -r answer
case "$answer" in
    [yY]*) exec ./start-cn.sh ;;
esac
