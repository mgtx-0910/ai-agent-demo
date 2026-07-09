# 清除 CodeBuddy 注入的 NODE_OPTIONS 后运行 node
# 用法: .\run-node.ps1 .\rag-test\src\hello-rag.mjs
$env:NODE_OPTIONS = ""
node @args
