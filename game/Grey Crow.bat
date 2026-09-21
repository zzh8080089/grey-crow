@echo off

if /I "%~1" NEQ "--inner" (
  "%ComSpec%" /d /k call "%~f0" --inner
  exit /b
)

setlocal

set "GAME_DIR=%~dp0"
set "DESKTOP=%GAME_DIR%apps\desktop\electron"

echo.
echo Grey Crow
echo Game folder: %GAME_DIR%
echo Desktop app: %DESKTOP%
echo.

if not exist "%DESKTOP%\package.json" (
  echo [FAIL] Cannot find apps\desktop\electron\package.json under the game folder.
  goto fail
)

where node >nul 2>nul
if errorlevel 1 (
  echo [FAIL] Node.js is not installed or is not on PATH.
  echo Install Node.js LTS, reopen this launcher, then try again.
  goto fail
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [FAIL] npm is not installed or is not on PATH.
  echo Install Node.js LTS, reopen this launcher, then try again.
  goto fail
)

if exist "%DESKTOP%\node_modules\electron" goto start_app

echo Desktop dependencies are missing.
set "INSTALL_DEPS=Y"
set /p INSTALL_DEPS=Install dependencies now through npm mirror? [Y/n] 
if /I "%INSTALL_DEPS%"=="N" goto fail

if not defined npm_config_registry (
  set "npm_config_registry=https://registry.npmmirror.com/"
)

if not defined npm_config_replace_registry_host (
  set "npm_config_replace_registry_host=always"
)

if not defined ELECTRON_MIRROR (
  set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
)

if not defined npm_config_electron_mirror (
  set "npm_config_electron_mirror=https://npmmirror.com/mirrors/electron/"
)

cd /d "%DESKTOP%" || goto fail
call npm install --registry "%npm_config_registry%" --replace-registry-host=always
if errorlevel 1 goto fail

:start_app
cd /d "%DESKTOP%" || goto fail
echo Starting Grey Crow...
call npm start
if errorlevel 1 goto fail
exit /b 0

:fail
echo.
echo [FAIL] Grey Crow launcher stopped.
echo Keep this window open and send the visible error if you need help.
pause
exit /b 1
