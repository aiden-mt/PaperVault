# Tạo lối tắt "PaperVault" trên Desktop và Start Menu.
# Ưu tiên file .exe đã đóng gói (dist\PaperVault\PaperVault.exe); nếu chưa có thì trỏ tới pythonw desktop.py.
$root = $PSScriptRoot
$exe = Join-Path $root "dist\PaperVault\PaperVault.exe"
$icon = Join-Path $root "static\icons\papervault.ico"
$shell = New-Object -ComObject WScript.Shell

if (Test-Path $exe) {
  $target = $exe; $args = ""; $workdir = Split-Path $exe
} else {
  $pyw = (Get-Command pythonw -ErrorAction SilentlyContinue).Source
  if (-not $pyw) { $pyw = (Get-Command python -ErrorAction SilentlyContinue).Source }
  if (-not $pyw) { Write-Host "Không tìm thấy Python."; exit 1 }
  $target = $pyw; $args = "`"$(Join-Path $root 'desktop.py')`""; $workdir = $root
}

foreach ($dir in @([Environment]::GetFolderPath("Desktop"), (Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs"))) {
  $lnk = Join-Path $dir "PaperVault.lnk"
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = $target
  $s.Arguments = $args
  $s.WorkingDirectory = $workdir
  $s.IconLocation = "$icon,0"
  $s.Description = "PaperVault - quản lý & tổng hợp paper"
  $s.Save()
  Write-Host "Đã tạo: $lnk"
}
