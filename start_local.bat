@echo off
echo ===================================================
echo Gram Panchayat Automation - Local Startup Script
echo ===================================================
echo.

cd /d "%~dp0"

echo [1/4] Checking Backend Dependencies...
if not exist "backend\node_modules\" (
    echo Installing Backend Dependencies...
    cd backend
    call npm install
    cd ..
) else (
    echo Backend Dependencies already installed.
)

echo.
echo [2/4] Checking Dashboard Dependencies...
if not exist "dashboard\node_modules\" (
    echo Installing Dashboard Dependencies...
    cd dashboard
    call npm install
    cd ..
) else (
    echo Dashboard Dependencies already installed.
)

echo.
echo [3/4] Starting Backend Server...
cd backend
start "Gram Panchayat Backend" cmd /k "npm start"
cd ..

echo.
echo [4/4] Starting Dashboard Server...
cd dashboard
start "Gram Panchayat Dashboard" cmd /k "npm run dev -- -p 3001"
cd ..

echo.
echo ===================================================
echo All services are launching in separate windows!
echo.
echo - Backend terminal will handle API requests
echo - Dashboard terminal will handle the Web UI
echo.
echo Close the newly opened terminal windows to stop the servers.
echo ===================================================
pause
