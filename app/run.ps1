# Khởi động PaperVault App (PowerShell). Cần Python 3.9+.
Set-Location -Path $PSScriptRoot
$py = Get-Command python -ErrorAction SilentlyContinue
if ($null -eq $py) { $py = Get-Command py -ErrorAction SilentlyContinue }
if ($null -eq $py) {
  Write-Host "Không tìm thấy Python. Cài Python 3 từ https://www.python.org/downloads/ rồi chạy lại."
  exit 1
}
& $py.Source server.py @args
