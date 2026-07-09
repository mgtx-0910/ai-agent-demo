@echo off
REM 为 CodeBuddy 调试器提供 fnm 版本自动切换的 node 入口
REM 版本由 .node-version 决定，不需要硬编码

cd /d %~dp0
fnm use
node %*
