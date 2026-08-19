@echo off
setlocal enabledelayedexpansion

REM node-npm.cmd -- portable npm launcher for VS Code debugger / Code Runner.
REM Works on any machine WITHOUT hardcoded paths: it locates node.exe by
REM  1) reading the nearest .node-version (upward from cwd)
REM  2) falling back to the newest version installed under fnm
REM  3) falling back to `node` on PATH
REM then runs the npm-cli.js bundled with that node installation.

REM ---- Locate node.exe (same logic as node-fnm.cmd) ----
set "NODE_ROOT=%CD%"
call :search_node
if errorlevel 1 set "NODE_ROOT=%CD%"

set "NODE_VERSION="
if exist "%NODE_ROOT%\.node-version" set /p NODE_VERSION=<"%NODE_ROOT%\.node-version"

set "FNM_DIR="
if defined FNM_DIR_GLOBAL set "FNM_DIR=%FNM_DIR_GLOBAL%"
if not defined FNM_DIR if defined LOCALAPPDATA if exist "%LOCALAPPDATA%\fnm" set "FNM_DIR=%LOCALAPPDATA%\fnm"
if not defined FNM_DIR if defined USERPROFILE if exist "%USERPROFILE%\AppData\Roaming\fnm" set "FNM_DIR=%USERPROFILE%\AppData\Roaming\fnm"

set "NODE_EXE="
REM 1) explicit version from .node-version
if defined NODE_VERSION (
    if defined FNM_DIR (
        if exist "!FNM_DIR!\node-versions\v!NODE_VERSION!\installation\node.exe" set "NODE_EXE=!FNM_DIR!\node-versions\v!NODE_VERSION!\installation\node.exe"
        if not defined NODE_EXE if exist "!FNM_DIR!\node-versions\!NODE_VERSION!\installation\node.exe" set "NODE_EXE=!FNM_DIR!\node-versions\!NODE_VERSION!\installation\node.exe"
    )
)

REM 2) newest installed version under fnm (no hardcoded version)
if not defined NODE_EXE if defined FNM_DIR (
    for /f "delims=" %%D in ('dir /b /a:d "!FNM_DIR!\node-versions" 2^>nul') do (
        for %%V in ("%%D") do if exist "!FNM_DIR!\node-versions\%%D\installation\node.exe" set "NODE_EXE=!FNM_DIR!\node-versions\%%D\installation\node.exe"
    )
)

REM 3) fallback to node on PATH
if not defined NODE_EXE (
    where node >nul 2>nul
    if not errorlevel 1 set "NODE_EXE=node"
)

if not defined NODE_EXE (
    echo [node-npm] ERROR: cannot locate node.exe. Install fnm + node, or add node to PATH.
    exit /b 1
)

REM ---- Derive npm-cli.js path from node.exe location ----
REM node.exe is at ...\node-versions\vX\installation\node.exe
REM npm-cli.js is at ...\node-versions\vX\installation\node_modules\npm\bin\npm-cli.js
REM Normalize the path (cmd does not resolve ".." in `if exist`), so resolve
REM the parent dir of node.exe first, then append the npm-cli.js relative path.
set "NPM_CLI="
if not "!NODE_EXE!"=="node" (
    for %%F in ("!NODE_EXE!") do set "NODE_DIR=%%~dpF"
    set "NPM_CLI=!NODE_DIR!node_modules\npm\bin\npm-cli.js"
)

if not defined NPM_CLI (
    echo [node-npm] ERROR: cannot locate npm-cli.js near "!NODE_EXE!".
    exit /b 1
)
if not exist "!NPM_CLI!" (
    echo [node-npm] ERROR: npm-cli.js not found at "!NPM_CLI!".
    exit /b 1
)

"!NODE_EXE!" "!NPM_CLI!" %*
exit /b %errorlevel%

:search_node
if exist "%NODE_ROOT%\.node-version" exit /b 0
for %%D in ("%NODE_ROOT%") do set "PAR=%%~dpD"
set "PAR_NO_SLASH=%PAR:~0,-1%"
if "%PAR_NO_SLASH%"=="%NODE_ROOT%" exit /b 1
set "NODE_ROOT=%PAR_NO_SLASH%"
goto :search_node
