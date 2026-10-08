@echo off
title Magalar - dev server
cd /d "%~dp0"
echo.
echo   Magalar  -  starting dev server on http://localhost:3000
echo   Press Ctrl+C to stop.
echo.
where npm >nul 2>nul
if not %errorlevel%==0 (
  echo   Node.js not found. Install it from https://nodejs.org
  pause
  exit /b
)
if not exist "node_modules" call npm install
if not exist ".env.local" (
  copy .env.example .env.local >nul
  echo   Created .env.local from .env.example - fill in your Clerk keys, then run start.bat again.
  pause
  exit /b
)
start "" http://localhost:3000
npm run dev
