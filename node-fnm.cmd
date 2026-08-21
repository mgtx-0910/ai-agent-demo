@echo off
setlocal enabledelayedexpansion

set "NODE_ROOT=%CD%"

REM Find .env directory from script file path (only if arg is an existing file,
REM e.g. the .js/.mjs to run; flags like --version / --inspect-brk must be skipped)
set "ENV_ROOT="
if not "%~1"=="" (
    if exist "%~1" (
        for %%F in ("%~1") do set "ENV_ROOT=%%~dpF"
    )
)
if defined ENV_ROOT if "!ENV_ROOT:~-1!"=="\" set "ENV_ROOT=!ENV_ROOT:~0,-1!"
call :search_env

REM Find .node-version directory upward
call :search_node
if errorlevel 1 set "NODE_ROOT=%CD%"

REM Read desired version from .node-version (e.g. "24.18.0")
set "NODE_VERSION="
if exist "%NODE_ROOT%\.node-version" set /p NODE_VERSION=<"%NODE_ROOT%\.node-version"

REM Locate node.exe under the fnm install directory.
REM Do NOT rely on "fnm use" here: VS Code debugger / Code Runner spawn a
REM clean process that never ran "fnm env", so FNM_MULTISHELL_PATH is missing
REM and "fnm use" would fail with "can't find the necessary environment variables".
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
    echo [node-fnm] ERROR: cannot locate node.exe. Install fnm + node, or add node to PATH.
    exit /b 1
)

REM Convert existing relative file-path args to absolute BEFORE any cd.
REM The .env cd below changes the working directory, so a relative path arg
REM would be resolved by node against the WRONG cwd -> duplicated directory
REM names in the path -> "Cannot find module".
set "ARGS="
:convert_args
if "%~1"=="" goto run_node
set "ARG=%~1"
if not "%ARG:~1,1%"==":" (
    if exist "%ARG%" set "ARG=%~f1"
)
set "ARGS=!ARGS! "%ARG%""
shift
goto convert_args
:run_node
if defined ENV_ROOT cd /d "%ENV_ROOT%"
"!NODE_EXE!" %ARGS%
exit /b %errorlevel%

:search_env
if not defined ENV_ROOT exit /b 1
if exist "%ENV_ROOT%\.env" exit /b 0
for %%D in ("%ENV_ROOT%") do set "PAR=%%~dpD"
if "%PAR%"=="%ENV_ROOT%\" set "ENV_ROOT="
if not defined ENV_ROOT exit /b 1
set "ENV_ROOT=%PAR:~0,-1%"
goto :search_env

:search_node
if exist "%NODE_ROOT%\.node-version" exit /b 0
for %%D in ("%NODE_ROOT%") do set "PAR=%%~dpD"
set "PAR_NO_SLASH=%PAR:~0,-1%"
if "%PAR_NO_SLASH%"=="%NODE_ROOT%" exit /b 1
set "NODE_ROOT=%PAR_NO_SLASH%"
goto :search_node
