$ErrorActionPreference = "Stop"

Write-Host "Setting up Q-Lab..." -ForegroundColor Cyan

if (-not (Test-Path ".venv")) {
    Write-Host "Creating virtual environment..." -ForegroundColor Yellow
    py -m venv .venv
}

$Python = ".\.venv\Scripts\python.exe"

Write-Host "Upgrading pip..." -ForegroundColor Yellow
& $Python -m pip install --upgrade pip

Write-Host "Installing backend dependencies..." -ForegroundColor Yellow
& $Python -m pip install -r .\backend\requirements.txt

Write-Host "Installing Q-Lab SDK in editable mode..." -ForegroundColor Yellow
& $Python -m pip install -e .\qlab_sdk

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host ""
Write-Host "Start Q-Lab:"
Write-Host "  .\run_dev.ps1"
Write-Host ""
Write-Host "Open dashboard:"
Write-Host "  http://127.0.0.1:8000/ui"
Write-Host ""
Write-Host "Optional, in a compatible researcher environment:"
Write-Host "  .\.venv\Scripts\python.exe -m pip install qiskit qiskit-ibm-runtime"
