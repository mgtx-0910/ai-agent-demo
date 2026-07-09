@echo off
chcp 65001 >nul
REM =====================================================
REM node-fnm.cmd - unified node entry point (Run Code / F5 debug)
REM find .node-version upward and auto-switch version
REM =====================================================

setlocal enabledelayedexpansion

set "ROOT=%CD%"
set "ORIGINAL_DIR=%CD%"

:search_up
if exist "%ROOT%\.node-version" goto :found
for %%D in ("%ROOT%") do set "PARENT=%%~dpD"
if "%PARENT%"=="%ROOT%" goto :not_found
set "ROOT=%PARENT:~0,-1%"
goto :search_up

:found
cd /d "%ROOT%"
fnm use
REM resolve relative file paths against the original working directory
set "FINAL_ARGS="
for %%a in (%*) do (
    set "a=%%~a"
    if "!a:~0,1!"=="\" (set "isAbs=1") else if "!a:~0,1!"=="/" (set "isAbs=1") else if "!a:~1,1!"==":" (set "isAbs=1") else (set "isAbs=0")
    if "!isAbs!"=="1" (
        set "FINAL_ARGS=!FINAL_ARGS! "%%~a""
    ) else (
        set "FINAL_ARGS=!FINAL_ARGS! "!ORIGINAL_DIR!\%%~a""
    )
)
node !FINAL_ARGS!
exit /b %errorlevel%

:not_found
cd /d "%ORIGINAL_DIR%"
fnm use
node %*
exit /b 1
