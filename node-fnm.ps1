# node-fnm.ps1 — fnm + node wrapper for both Code Runner and F5 debugger
# Usage: node-fnm.ps1 [node args...]
# Forwards ALL arguments to node after setting up fnm environment

$ErrorActionPreference = "Continue"

$cwd = (Get-Location).Path

# Detect the script file from arguments (first .js/.mjs path in args)
# Works for both: Code Runner (file path first) and F5 debugger (--inspect-brk followed by file)
$scriptFile = $null
foreach ($arg in $args) {
    if ($arg -and (Test-Path -LiteralPath $arg -PathType Leaf) -and $arg -match '\.m?js$') {
        $scriptFile = (Resolve-Path $arg).Path
        break
    }
}

# Find .node-version by walking up from cwd
$nodeRoot = $cwd
while ($nodeRoot) {
    if (Test-Path (Join-Path $nodeRoot ".node-version")) { break }
    $parent = Split-Path $nodeRoot -Parent
    if (-not $parent -or $parent -eq $nodeRoot) { $nodeRoot = $cwd; break }
    $nodeRoot = $parent
}

# Find .env: prefer walking up from script file directory, fallback to cwd
$searchRoot = if ($scriptFile) { Split-Path $scriptFile -Parent } else { $cwd }
$envRoot = $searchRoot
while ($envRoot) {
    if (Test-Path (Join-Path $envRoot ".env")) { break }
    $parent = Split-Path $envRoot -Parent
    if (-not $parent -or $parent -eq $envRoot) { $envRoot = $null; break }
    $envRoot = $parent
}

# Run fnm use in the .node-version directory
Set-Location $nodeRoot
fnm use 2>&1 | Out-Null

# CD to .env directory if found (so dotenv/config auto-loads .env)
if ($envRoot) {
    Set-Location $envRoot
}

# Forward ALL arguments to node (works for both Code Runner and F5 debugger)
node @args
$exitCode = $LASTEXITCODE

# Restore original directory
Set-Location $cwd
exit $exitCode
