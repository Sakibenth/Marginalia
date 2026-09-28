@echo off
cd /d "%~dp0"

rem --- Pick Python (anaconda 'python', else the Windows 'py' launcher) ---
where python >nul 2>nul
if %errorlevel%==0 (set "PY=python") else (set "PY=py")

rem --- Find the newest .html file in this folder ---
set "PAGE="
for /f "delims=" %%F in ('dir /b /a-d /o-d *.html 2^>nul') do (
  set "PAGE=%%F"
  goto :gotpage
)
:gotpage
if "%PAGE%"=="" (
  echo No .html file was found in this folder.
  echo Put Marginalia's .html file next to this launcher and run it again.
  echo.
  pause
  exit /b
)

echo Starting Marginalia server for "%PAGE%" ...
if exist "marginalia_server.py" (
  start "Marginalia server" %PY% marginalia_server.py 8000
) else (
  echo marginalia_server.py not found - starting a basic server ^(Reader view for websites will be off^).
  start "Marginalia server" %PY% -m http.server 8000 --bind 127.0.0.1
)
timeout /t 2 >nul
start "" "http://localhost:8000/%PAGE%"
echo.
echo Marginalia is now open in your browser at:
echo     http://localhost:8000/%PAGE%
echo.
echo A separate "Marginalia server" window is running the server.
echo Keep it open while you work; close it when you are done.
echo.
pause
