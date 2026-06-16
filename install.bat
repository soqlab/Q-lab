@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  py -m venv .venv
)

".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
".venv\Scripts\python.exe" -m pip install -e qlab_sdk

echo.
echo Installation complete.
echo Start Q-Lab with:
echo   powershell -ExecutionPolicy Bypass -File run_dev.ps1
echo.
echo Dashboard:
echo   http://127.0.0.1:8000/ui
echo.
pause
