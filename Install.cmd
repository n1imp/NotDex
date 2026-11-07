@echo off
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set "notdex_status=%errorlevel%"
if not "%notdex_status%"=="0" echo NotDex installation failed. Read the error above.
pause
exit /b %notdex_status%
