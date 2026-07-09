@echo off
REM =====================================================================
REM run-esm.cmd — 启动 ESM 文件前清除 CodeBuddy CN 注入的 NODE_OPTIONS
REM
REM 用法（从 rag-test 或 tool-test 目录）：
REM   ..\run-esm.cmd src\loader-and-splitter2.mjs
REM
REM 用法（从项目根目录）：
REM   run-esm.cmd rag-test\src\loader-and-splitter2.mjs
REM =====================================================================

if "%~1"=="" (
    echo 用法: run-esm.cmd ^<target-file.mjs^> [args...]
    exit /b 1
)

set "NODE_OPTIONS="
set "VSCODE_INSPECTOR_OPTIONS="

REM 优先使用外层 ai-agent-study 工作区封装的 Node v24
set "NODE_EXE=%~dp0..\node.cmd"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

"%NODE_EXE%" %*
