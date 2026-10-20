@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 goto use_py
where python >nul 2>nul
if %errorlevel%==0 goto use_python
echo Python was not found. Install Python 3 or use the VS Code Live Server extension.
echo For microphone and PWA support, use localhost or an HTTPS host. Opening index.html directly is limited.
pause
exit /b 1
:use_py
start "EUPHONIA Local Server" /D "%~dp0" cmd /k "py -m http.server 8080 --bind 127.0.0.1"
goto launch
:use_python
start "EUPHONIA Local Server" /D "%~dp0" cmd /k "python -m http.server 8080 --bind 127.0.0.1"
:launch
timeout /t 2 >nul
start "" "http://127.0.0.1:8080"