@echo off
REM Launch EasyEDA Pro with Chrome DevTools Protocol enabled so a2n's
REM sch_export_image (CDP screenshot) can capture the editor window.
REM
REM The backgrounding flags keep the renderer painting while EasyEDA is not the
REM foreground window; without them, screenshots stall.
REM
REM Close any running EasyEDA Pro first, then run this file.

set EDA="C:\Program Files\easyeda-pro\easyeda-pro.exe"
set PORT=9222

start "" %EDA% --remote-debugging-port=%PORT% --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-background-timer-throttling

echo EasyEDA Pro launched with CDP on port %PORT%.
