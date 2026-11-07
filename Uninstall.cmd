@echo off
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
set "notdex_status=%errorlevel%"
if not "%notdex_status%"=="0" echo NotDex removal failed. Read the error above.
pause
exit /b %notdex_status%
