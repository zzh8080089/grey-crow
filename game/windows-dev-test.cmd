@echo off

if /I "%~1" NEQ "--inner" (
  "%ComSpec%" /d /k call "%~f0" --inner
  exit /b
)

setlocal

set "ROOT=%~dp0"
set "DESKTOP=%ROOT%apps\desktop\electron"

echo.
echo Grey Crow Windows Dev Rehearsal
echo Game folder: %ROOT%
echo Desktop: %DESKTOP%
echo.

if not exist "%DESKTOP%\package.json" (
  echo [FAIL] Cannot find apps\desktop\electron\package.json.
  echo Make sure this script is run from the extracted game folder.
  echo Do not run this script directly from inside the compressed zip preview.
  goto fail
)

where node >nul 2>nul
if errorlevel 1 (
  echo [FAIL] Node.js is not installed or is not on PATH.
  echo Install Node.js LTS, reopen this terminal, then run this script again.
  goto fail
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [FAIL] npm is not installed or is not on PATH.
  echo Install Node.js LTS, reopen this terminal, then run this script again.
  goto fail
)

echo Node:
node -v
echo npm:
call npm -v
echo.

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

echo npm registry mirror: %npm_config_registry%
echo npm replace-registry-host: %npm_config_replace_registry_host%
echo Electron binary mirror: %ELECTRON_MIRROR%
echo.

cd /d "%DESKTOP%" || goto fail

echo [1/4] Installing dependencies with npm ci through npm mirror...
call npm ci --registry "%npm_config_registry%" --replace-registry-host=always
if errorlevel 1 goto fail

echo.
echo [2/4] Running full desktop check...
call npm run check
if errorlevel 1 goto fail

echo.
echo [3/4] Re-running startup smoke directly...
call npm run smoke:dev-startup
if errorlevel 1 goto fail

echo.
echo [4/4] Automated checks passed.
echo.
set "START_APP=Y"
set /p START_APP=Start Grey Crow now for manual UI check? [Y/n] 
if /I "%START_APP%"=="N" goto done

echo.
echo Starting Grey Crow. Close the app window when manual checks are done.
echo Manual checks:
echo - First screen is the Grey Crow main menu.
echo - New Game opens Settings when no API key has been tested.
echo - Settings shows DeepSeek API Key, model, TTS placeholders, and game volume.
echo - Do not enter a real key unless live DeepSeek testing was explicitly requested.
echo.
call npm start
if errorlevel 1 goto fail

:done
echo.
echo [OK] Windows Dev Rehearsal commands completed.
echo Next: report this result before trying win-unpacked, NSIS, signing, or installer work.
pause
exit /b 0

:fail
echo.
echo [FAIL] Windows Dev Rehearsal stopped.
echo Send the visible error above plus:
echo - Windows version and architecture
echo - node -v
echo - npm -v
echo - Whether npm ci completed
echo - The first npm run check error, if any
echo - Any SmartScreen, antivirus, permission, GPU, or Electron startup prompt
pause
exit /b 1
