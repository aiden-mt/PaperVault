@echo off
rem Tao bo cai dat dist\PaperVault-Setup-<phien ban>.exe tu dist\PaperVault (chay build_exe.bat truoc).
rem Can Inno Setup 6.5+: winget install JRSoftware.InnoSetup  (hoac tai tai https://jrsoftware.org/isdl.php)
setlocal
cd /d "%~dp0"
set "ISCC="
for %%I in (ISCC.exe) do if not "%%~$PATH:I"=="" set "ISCC=%%~$PATH:I"
if not defined ISCC if exist "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" set "ISCC=%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe"
if not defined ISCC if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if not defined ISCC if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if not defined ISCC (
  echo Chua cai Inno Setup 6. Cai bang lenh: winget install JRSoftware.InnoSetup
  exit /b 2
)
if not exist "..\dist\PaperVault\PaperVault.exe" (
  echo Chua co dist\PaperVault\PaperVault.exe. Chay build_exe.bat truoc.
  exit /b 1
)
"%ISCC%" /Q PaperVault.iss
if %errorlevel% neq 0 (
  echo Tao bo cai that bai.
  exit /b 1
)
echo Xong: bo cai nam trong thu muc app\dist (PaperVault-Setup-*.exe)
