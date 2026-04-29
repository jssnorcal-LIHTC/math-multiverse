@echo off
REM Math Multiverse local server launcher.
REM
REM Run this on the Windows machine that hosts the game.  Devices on
REM your Tailscale network (iPad, phone, other laptop) can then load
REM the game by visiting:
REM
REM   http://<this-machines-tailscale-IP>:8765/Math-Multiverse.html
REM
REM Tailscale IP shows up in the Tailscale tray-icon menu.  Looks
REM like 100.x.x.x.

cd /d "%~dp0"
echo Starting Math Multiverse server on port 8765...
echo.
echo Local: http://localhost:8765/Math-Multiverse.html
echo iPad:  http://100.x.x.x:8765/Math-Multiverse.html  (your Tailscale IP)
echo.
echo Leave this window open while the kid is playing.  Close to stop.
echo.
start http://localhost:8765/Math-Multiverse.html
python -m http.server 8765
