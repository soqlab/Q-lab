param(
    [int]$Port = 8000,
    [string]$HostAddress = "127.0.0.1",
    [switch]$Install
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $Root ".venv\Scripts\python.exe"

if (-not (Test-Path $Python)) {
    Write-Host "Creating virtual environment..." -ForegroundColor Cyan
    py -m venv (Join-Path $Root ".venv")
}

if ($Install) {
    Write-Host "Installing backend dependencies and editable SDK..." -ForegroundColor Cyan
    & $Python -m pip install --upgrade pip
    & $Python -m pip install -r (Join-Path $Root "backend\requirements.txt")
    & $Python -m pip install -e (Join-Path $Root "qlab_sdk")
}

Write-Host "Starting Q-Lab at http://$HostAddress`:$Port/ui" -ForegroundColor Green
Set-Location $Root
& $Python -m uvicorn backend.app.main:app --host $HostAddress --port $Port
