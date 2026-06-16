@echo off
REM Double-click to update TabView (Windows). Pulls the latest production code,
REM then tells you to reload the extension. (The trackpad swipe helper is macOS-only.)
cd /d "%~dp0"
echo Updating TabView...
git pull --ff-only origin main
if errorlevel 1 (
  echo.
  echo Pull failed - you may have local changes. Resolve manually, then rerun.
  pause
  exit /b 1
)
echo.
echo Updated. Final step: open chrome://extensions and click Reload on TabView,
echo or click "Reload now" in TabView's blue update banner.
pause
