@echo off
cd /d "%~dp0"
title Tutur

if not exist .env (
  copy .env.example .env >nul
  echo.
  echo   File .env dibuat. Isi AI_API_KEY dan MY_NAME dulu, lalu jalankan lagi.
  echo.
  notepad .env
  pause
  exit /b
)

if not exist node_modules (
  echo   Memasang dependency...
  call npm install
)

echo.
echo   Membuka dashboard di http://localhost:3000
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"

node src/index.js
pause
