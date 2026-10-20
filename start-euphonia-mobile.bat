@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 goto use_py
where python >nul 2>nul
if %errorlevel%==0 goto use_python
echo Python was not found. Install Python 3 or use another local web server.
echo Do not open index.html as a file if you need PWA or microphone support.
pause
exit /b 1
:use_py
start "EUPHONIA LAN Server" /D "%~dp0" cmd /k "py -m http.server 8080 --bind 0.0.0.0"
goto instructions
:use_python
start "EUPHONIA LAN Server" /D "%~dp0" cmd /k "python -m http.server 8080 --bind 0.0.0.0"
:instructions
echo.
echo Find this PC's Wi-Fi IPv4 address by running ipconfig.
echo On a phone connected to the same trusted Wi-Fi, open http://PC-IP:8080.
echo Replace PC-IP with the actual IPv4 address. Microphone/PWA features require HTTPS on mobile.
echo Do not expose this development server to the public internet.
pause