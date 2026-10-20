@echo off
rem Mở PaperVault dưới dạng ứng dụng cửa sổ riêng (không hiện console).
cd /d "%~dp0"
where pythonw >nul 2>nul
if %errorlevel% equ 0 (
  start "" pythonw desktop.py
) else (
  start "" python desktop.py
)
