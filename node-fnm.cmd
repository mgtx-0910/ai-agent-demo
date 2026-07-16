@echo off
setlocal enabledelayedexpansion

set "NODE_ROOT=%CD%"

REM Find .env directory from script file path
set "ENV_ROOT="
if not "%~1"=="" for %%F in ("%~1") do set "ENV_ROOT=%%~dpF"
if not "!ENV_ROOT!"=="" if "!ENV_ROOT:~-1!"=="\" set "ENV_ROOT=!ENV_ROOT:~0,-1!"
call :search_env

REM Find .node-version directory upward
call :search_node
if errorlevel 1 set "NODE_ROOT=%CD%"

cd /d "%NODE_ROOT%"
fnm use
if defined ENV_ROOT cd /d "%ENV_ROOT%"
node %*
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
