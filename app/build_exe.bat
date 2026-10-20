@echo off
rem Đóng gói PaperVault thành ứng dụng Windows (thư mục dist\PaperVault\PaperVault.exe).
rem Yêu cầu: pip install pywebview pyinstaller
cd /d "%~dp0"
rem PyInstaller xoa sach dist\PaperVault truoc khi build. Neu ban .exe cu tung luu du lieu / config o do thi sao luu ra ngoai truoc.
if exist "dist\PaperVault\data" (
  echo Phat hien du lieu trong dist\PaperVault\data, dang sao luu sang dist-data-backup ...
  robocopy "dist\PaperVault\data" "dist-data-backup\data" /E /NFL /NDL /NJH /NJS >nul
  if errorlevel 8 ( echo Sao luu that bai, dung build de khong mat du lieu. & pause & exit /b 1 )
)
if exist "dist\PaperVault\config.json" if not exist "dist-data-backup" mkdir "dist-data-backup"
if exist "dist\PaperVault\config.json" copy /y "dist\PaperVault\config.json" "dist-data-backup\config.json" >nul
python -m PyInstaller --noconfirm --clean --windowed --name PaperVault ^
  --icon static\icons\papervault.ico ^
  --add-data "static;static" ^
  --add-data "rankings;rankings" ^
  --collect-all webview --collect-all clr_loader --collect-all pythonnet ^
  --hidden-import webview.platforms.edgechromium --hidden-import webview.platforms.winforms ^
  desktop.py
if %errorlevel% neq 0 (
  echo.
  echo Dong goi that bai. Kiem tra da cai: python -m pip install pywebview pyinstaller
  pause
  exit /b 1
)
echo.
echo Xong: dist\PaperVault\PaperVault.exe
echo Ban .exe nam trong du an dung chung du lieu app\data va app\config.json voi ban chay bang Python.
echo Copy ca thu muc dist\PaperVault di noi khac thi du lieu nam canh file .exe (thu muc data).
pause
