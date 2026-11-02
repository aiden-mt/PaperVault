# Bộ cài chạy file này trước khi đóng PaperVault đang mở: tìm các thư mục PaperVault cũ (bản giải nén zip, bản build
# trong dự án) để lần chạy đầu bản cài đặt lấy lại thư viện (server.py: _adopt_legacy_data). Ghi mỗi thư mục một dòng.
param([Parameter(Mandatory = $true)][string]$Out)
$ErrorActionPreference = 'SilentlyContinue'
$dirs = New-Object System.Collections.Generic.List[string]

# PaperVault.exe đang chạy (bấm "Tải bản mới" trong app rồi mở Setup)
Get-CimInstance Win32_Process -Filter "Name='PaperVault.exe'" | ForEach-Object {
  if ($_.ExecutablePath) { $dirs.Add((Split-Path $_.ExecutablePath)) }
}

# Lối tắt trên Desktop, Start Menu, thanh tác vụ: trỏ tới PaperVault.exe hoặc pythonw desktop.py (create_shortcut.ps1)
$shell = New-Object -ComObject WScript.Shell
$places = @(
  [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory'),
  [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonPrograms'),
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar')
)
foreach ($p in $places) {
  if (-not $p -or -not (Test-Path $p)) { continue }
  Get-ChildItem $p -Filter *.lnk -Recurse -Depth 2 | ForEach-Object {
    $s = $shell.CreateShortcut($_.FullName)
    if ($s.TargetPath -and (Split-Path $s.TargetPath -Leaf) -ieq 'PaperVault.exe' -and (Test-Path $s.TargetPath)) {
      $dirs.Add((Split-Path $s.TargetPath))
    } elseif ($s.Arguments -match '"?([^"]*desktop\.py)"?' -and (Test-Path $Matches[1])) {
      $dirs.Add((Split-Path $Matches[1]))
    }
  }
}

$dirs | Select-Object -Unique | Set-Content -Path $Out -Encoding UTF8
