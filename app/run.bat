@echo off
rem Khởi động PaperVault App (Windows). Cần Python 3.9+ trong PATH.
cd /d "%~dp0"
where python >nul 2>nul
if %errorlevel% neq 0 (
  where py >nul 2>nul
  if %errorlevel% neq 0 (
    echo Khong tim thay Python. Cai Python 3 tu https://www.python.org/downloads/ roi chay lai.
    pause
    exit /b 1
  )
  py -3 server.py %*
) else (
  python server.py %*
)
pause
