@echo off
setlocal
python "%~dp0scripts\run_app.py" %*
exit /b %ERRORLEVEL%
