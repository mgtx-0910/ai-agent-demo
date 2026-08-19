# node-npm.ps1 -- portable npm launcher for VS Code debugger / Code Runner.
# Works on any machine WITHOUT hardcoded paths: it locates node.exe by
#  1) reading the nearest .node-version (upward from cwd)
#  2) falling back to the newest version installed under fnm
#  3) falling back to `node` on PATH
# then runs the npm-cli.js bundled with that node installation.

$ErrorActionPreference = "Continue"

$cwd = (Get-Location).Path

# Find .node-version by walking up from cwd
$nodeRoot = $cwd
while ($nodeRoot) {
    if (Test-Path (Join-Path $nodeRoot ".node-version")) { break }
    $parent = Split-Path $nodeRoot -Parent
    if (-not $parent -or $parent -eq $nodeRoot) { $nodeRoot = $cwd; break }
    $nodeRoot = $parent
}

# Read desired version from .node-version (e.g. "24.18.0")
$nodeVersion = $null
$versionFile = Join-Path $nodeRoot ".node-version"
if (Test-Path $versionFile) {
    $nodeVersion = (Get-Content $versionFile -Raw).Trim()
}

# Locate node.exe -- no hardcoded paths/versions, portable across machines
$fnmDir = $null
if ($env:FNM_DIR) { $fnmDir = $env:FNM_DIR }
if (-not $fnmDir -and $env:LOCALAPPDATA -and (Test-Path (Join-Path $env:LOCALAPPDATA "fnm"))) {
    $fnmDir = Join-Path $env:LOCALAPPDATA "fnm"
}
if (-not $fnmDir -and (Test-Path (Join-Path $HOME "AppData\Roaming\fnm"))) {
    $fnmDir = Join-Path $HOME "AppData\Roaming\fnm"
}

$nodeExe = $null
if ($fnmDir) {
    if ($nodeVersion) {
        $candidates = @(
            (Join-Path $fnmDir "node-versions\v$nodeVersion\installation\node.exe"),
            (Join-Path $fnmDir "node-versions\$nodeVersion\installation\node.exe")
        )
        foreach ($candidate in $candidates) {
            if (Test-Path $candidate) { $nodeExe = $candidate; break }
        }
    }
    # newest installed version under fnm (no hardcoded version)
    if (-not $nodeExe) {
        $versionsDir = Join-Path $fnmDir "node-versions"
        if (Test-Path $versionsDir) {
            $nodeExe = Get-ChildItem $versionsDir -Directory -ErrorAction SilentlyContinue |
                Where-Object { Test-Path (Join-Path $_.FullName "installation\node.exe") } |
                Sort-Object Name -Descending |
                Select-Object -First 1 -ExpandProperty FullName |
                ForEach-Object { Join-Path $_ "installation\node.exe" }
        }
    }
}

# fallback to node on PATH
if (-not $nodeExe -and (Get-Command node -ErrorAction SilentlyContinue)) {
    $nodeExe = "node"
}

if (-not $nodeExe) {
    Write-Host "[node-npm] ERROR: cannot locate node.exe. Install fnm + node, or add node to PATH." -ForegroundColor Red
    exit 1
}

# Derive npm-cli.js path from node.exe location
if ($nodeExe -ne "node") {
    $npmCli = Join-Path (Split-Path $nodeExe -Parent) "node_modules\npm\bin\npm-cli.js"
} else {
    $npmCli = $null
}

if (-not $npmCli -or -not (Test-Path $npmCli)) {
    Write-Host "[node-npm] ERROR: cannot locate npm-cli.js near $nodeExe." -ForegroundColor Red
    exit 1
}

& $nodeExe $npmCli @args
$exitCode = $LASTEXITCODE
Set-Location $cwd
exit $exitCode
