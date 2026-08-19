# node-fnm.ps1 — fnm + node wrapper for both Code Runner and F5 debugger
# Usage: node-fnm.ps1 [node args...]
# Forwards ALL arguments to node after setting up fnm environment
#
# NOTE: Unlike a plain "fnm use", this script locates node.exe DIRECTLY under
# the fnm install directory. VS Code debugger / Code Runner spawn a clean
# process that never ran "fnm env", so FNM_MULTISHELL_PATH is missing and
# "fnm use" would fail with "can't find the necessary environment variables".

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

# Read desired version from .node-version (e.g. "24.18.0")
$nodeVersion = $null
$versionFile = Join-Path $nodeRoot ".node-version"
if (Test-Path $versionFile) {
    $nodeVersion = (Get-Content $versionFile -Raw).Trim()
}

# Locate node.exe under the fnm install directory
$fnmDir = if ($env:FNM_DIR) { $env:FNM_DIR } else { Join-Path $HOME "AppData\Roaming\fnm" }
$nodeExe = $null
if ($nodeVersion) {
    $candidates = @(
        (Join-Path $fnmDir "node-versions\v$nodeVersion\installation\node.exe"),
        (Join-Path $fnmDir "node-versions\$nodeVersion\installation\node.exe")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { $nodeExe = $candidate; break }
    }
}
if (-not $nodeExe) {
    $fallback = Join-Path $fnmDir "node-versions\v24.18.0\installation\node.exe"
    if (Test-Path $fallback) { $nodeExe = $fallback }
}

if (-not $nodeExe) {
    Write-Host "[node-fnm] ERROR: cannot locate node.exe under $fnmDir. Check .node-version and fnm install." -ForegroundColor Red
    exit 1
}

# CD to .env directory if found (so dotenv/config auto-loads .env)
if ($envRoot) {
    Set-Location $envRoot
}

# Forward ALL arguments to node (works for both Code Runner and F5 debugger)
& $nodeExe @args
$exitCode = $LASTEXITCODE

# Restore original directory
Set-Location $cwd
exit $exitCode
