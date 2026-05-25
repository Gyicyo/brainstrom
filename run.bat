@echo off
cd /d "%~dp0"

echo Starting Brainstorm — Bridge Server + Frontend
echo ===============================================

:: Start bridge server in background
echo [1/2] Starting bridge server...
start "Brainstorm Bridge" cmd /c "cd /d "%~dp0bridge" && npm run dev"

:: Wait a moment for bridge to initialize
timeout /t 2 /nobreak >nul

:: Start frontend dev server
echo [2/2] Starting frontend dev server...
cd /d "%~dp0frontend"
start "Brainstorm Frontend" cmd /c "cd /d "%~dp0frontend" && npm run dev"

echo.
echo Both servers starting:
echo   Bridge:  http://localhost:3001
echo   Frontend: http://localhost:5173
echo.
echo Close the terminal windows to stop.
pause
