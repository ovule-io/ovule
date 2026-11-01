@echo off
bun "%~dp0..\tuff.mjs" %*
exit /b %errorlevel%
