Write-Host ""
Write-Host "  _        ___   __  __"
Write-Host " | |      / _ \  \ \/ /"
Write-Host " | |     | | | |  \  /"
Write-Host " | |___  | |_| |  /  \"
Write-Host " |_____|  \___/  /_/\_\"
Write-Host ""
Write-Host "  Where knowledge lives."
Write-Host ""

# Check Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "Node.js not found. Installing via winget..."
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

$nodeVersion = (node -e "console.log(process.version)") -replace 'v',''
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 22) {
    Write-Host "Node.js 22+ required (found: v$nodeVersion)"
    exit 1
}

# Clone and run installer
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "lox-install-$(Get-Random)"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
Write-Host "Cloning Lox installer..."
git clone --depth 1 https://github.com/isorensen/lox-brain.git "$tempDir\lox-brain"
Set-Location "$tempDir\lox-brain"
Write-Host "Installing dependencies..."
npm ci --silent
Write-Host "Building..."
npm run build --workspaces --silent
Write-Host ""
node packages\installer\dist\index.js

# Cleanup
Set-Location $HOME
Remove-Item -Recurse -Force $tempDir
