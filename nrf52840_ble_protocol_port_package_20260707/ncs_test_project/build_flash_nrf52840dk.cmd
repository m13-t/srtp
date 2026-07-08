@echo off
setlocal

pushd "%~dp0"
set "APP_DIR=%CD%"

echo.
echo ========================================
echo  BabyBadge nRF52840DK NCS Build Flash
echo ========================================
echo.

where west >nul 2>nul
if errorlevel 1 (
    echo [ERROR] west was not found in PATH.
    echo Open "nRF Connect SDK Toolchain" from Toolchain Manager, then run this script again.
    echo.
    echo Or run these commands in the SDK terminal:
    echo   cd /d "%APP_DIR%"
    echo   west build -p always -b nrf52840dk_nrf52840 .
    echo   west flash
    echo.
    pause
    exit /b 1
)

echo [1/2] Building nrf52840dk_nrf52840...
west build -p always -b nrf52840dk_nrf52840 .
if errorlevel 1 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
)

echo [2/2] Flashing board...
west flash
if errorlevel 1 (
    echo [ERROR] Flash failed. Check board connection and J-Link driver.
    pause
    exit /b 1
)

echo.
echo Flash done. BLE device name should be BabyBadge-NUS.
echo.
pause
popd
