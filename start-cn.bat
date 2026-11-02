@echo off
:: Starts StarPoint for the globalized CN World Flipper (run setup.bat once first).
:: The game talks to 127.0.0.1:8000; an emulator reaches this PC through adb reverse, set up here
:: whenever adb is available. The dashboard is at http://127.0.0.1:8000 in your browser.
setlocal
cd /d "%~dp0"
title StarPoint
if not exist "out\server.js" (
    echo The server isn't built yet: run setup.bat first.
    pause
    exit /b 1
)
where adb >nul 2>nul
if not errorlevel 1 (
    adb reverse tcp:8000 tcp:8000 >nul 2>nul
    adb reverse tcp:18888 tcp:18888 >nul 2>nul
)
echo StarPoint is starting. Dashboard: http://127.0.0.1:8000  (close this window to stop the server)
node --env-file=.env out\server.js
pause
