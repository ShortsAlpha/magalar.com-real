@echo off
title Magalar - local server
cd /d "%~dp0"
echo.
echo   Magalar  -  starting local server on http://localhost:8000
echo   Press Ctrl+C to stop.
echo.
start "" http://localhost:8000

where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server 8000
  goto :eof
)
where py >nul 2>nul
if %errorlevel%==0 (
  py -m http.server 8000
  goto :eof
)
where npx >nul 2>nul
if %errorlevel%==0 (
  npx --yes serve -l 8000 .
  goto :eof
)
echo   No Python or Node found. Install Python from https://python.org (tick "Add to PATH")
echo   or simply double-click index.html to open the site directly.
pause
