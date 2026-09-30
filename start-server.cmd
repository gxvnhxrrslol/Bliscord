@echo off
title Bliscord Server
cd /d "%~dp0server"
if not exist node_modules (
  echo Installing server dependencies...
  call npm install --omit=dev
)
if not exist "..\dist\index.html" (
  echo Building the web client...
  pushd ..
  call npx vite build
  popd
)
if exist "..\tools\cloudflared.exe" (
  start "Bliscord Tunnel" /min cmd /c node "%~dp0scripts\tunnel.mjs"
)
:loop
node --disable-warning=ExperimentalWarning index.js
echo Server stopped. Restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto loop
