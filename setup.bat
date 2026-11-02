@echo off
:: One-time setup for the globalized CN World Flipper on StarPoint (Windows).
:: Installs the server's packages, builds it, checks the game files, optionally installs the game on an
:: emulator or phone over adb, then starts the server. Run start-cn.bat to start it again later.
setlocal
cd /d "%~dp0"
title StarPoint setup

:: 1. Node.js 20 or newer
where node >nul 2>nul
if errorlevel 1 goto nonode
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 20 goto oldnode

:: 2. the server's packages and build
if exist "node_modules\better-sqlite3\build\Release\better_sqlite3.node" goto build
echo Installing the server's packages (needs internet once)...
call npm ci --no-audit --no-fund
if errorlevel 1 goto failed
:build
echo Building the server...
call npx tsc -p .
if errorlevel 1 goto failed

:: 3. settings and save folder
if not exist ".env" copy ".env.example" ".env" >nul
if not exist ".database" mkdir ".database"

:: 4. the game files
echo Checking the game files...
node scripts\verify_package.cjs
if errorlevel 1 goto failed

:: 5. the game on an emulator or phone (optional)
where adb >nul 2>nul
if errorlevel 1 goto noadb
choice /c YN /m "Install the game on the emulator or phone connected with adb now"
if errorlevel 2 goto start
adb devices
for %%a in (apk\*.apk) do (
    echo Installing %%a ...
    adb install -r "%%a"
)
goto start
:noadb
echo.
echo adb was not found, so the game is not installed for you. Install the APK in the "apk" folder on your
echo emulator yourself, and if it is an emulator, let it reach this PC with:
echo     adb reverse tcp:8000 tcp:8000
echo     adb reverse tcp:18888 tcp:18888
echo (start-cn.bat does this for you whenever adb is available.)

:start
echo.
echo Setup done. From now on, start the server with start-cn.bat.
choice /c YN /m "Start the server now"
if errorlevel 2 goto end
call start-cn.bat
goto end

:nonode
echo Node.js is not installed. Install Node.js 20 or newer from https://nodejs.org, then run setup.bat again.
start "" "https://nodejs.org/en/download"
goto end
:oldnode
echo Node.js %NODEMAJOR% is too old: install Node.js 20 or newer from https://nodejs.org, then run setup.bat again.
goto end
:failed
echo.
echo Setup stopped: see the message above.
:end
pause
