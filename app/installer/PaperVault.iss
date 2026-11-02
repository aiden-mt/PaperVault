; Bộ cài PaperVault cho Windows (Inno Setup 6.5+).
; Build: app\installer\build_setup.bat (sau app\build_exe.bat), hoặc ISCC.exe app\installer\PaperVault.iss.
; Đầu vào: app\dist\PaperVault (PyInstaller onedir). Đầu ra: app\dist\PaperVault-Setup-<ver>.exe.
; Phiên bản lấy từ APP_VERSION trong app\server.py (ghi đè được: ISCC /DAppVersion=1.2.3).
;
; Thư mục cài chỉ chứa chương trình. config.json và data nằm ở %LOCALAPPDATA%\PaperVault (server.py: INSTALLED), nên cài đè
; bản mới hay gỡ cài đặt đều không đụng tới thư viện và API key. Lần chạy đầu, app lấy lại dữ liệu của bản giải nén zip cũ
; (cạnh .exe, hoặc các thư mục detect-legacy.ps1 tìm được, ghi trong legacy-dirs.txt).

#ifndef AppVersion
  #define VerFile FileOpen(AddBackslash(SourcePath) + "..\server.py")
  #define VerLine ""
  #define AppVersion ""
  #for {0; AppVersion == "" && !FileEof(VerFile); 0}     (VerLine = FileRead(VerFile), Pos('APP_VERSION = "', VerLine) == 1 ? AppVersion = Copy(VerLine, 16, Pos('"', Copy(VerLine, 16)) - 1) : 0)
  #expr FileClose(VerFile)
  #if AppVersion == ""
    #error Không đọc được APP_VERSION trong app\server.py
  #endif
#endif

#define AppName "PaperVault"
#define AppExe "PaperVault.exe"
#define DistDir "..\dist\PaperVault"
; Bộ cài tải bản Evergreen Bootstrapper chính thức của Microsoft khi máy chưa có WebView2 Runtime.
#define WebView2Url "https://go.microsoft.com/fwlink/p/?LinkId=2124703"

[Setup]
AppId={{B053EF28-A786-4B78-99F7-7AC8BB9B52BC}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Thong Nguyen
AppPublisherURL=https://github.com/aiden-mt/PaperVault
AppSupportURL=https://github.com/aiden-mt/PaperVault/issues
AppUpdatesURL=https://github.com/aiden-mt/PaperVault/releases/latest
VersionInfoVersion={#AppVersion}
VersionInfoDescription={#AppName} Setup
; Mặc định cài cho riêng người dùng hiện tại (%LOCALAPPDATA%\Programs\PaperVault, không cần quyền admin);
; hộp thoại đầu tiên cho chọn cài cho mọi người dùng (Program Files, cần admin).
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
DefaultDirName={autopf}\{#AppName}
DisableProgramGroupPage=yes
DisableWelcomePage=no
DisableDirPage=no
UsePreviousAppDir=yes
UsePreviousTasks=yes
LicenseFile=..\..\LICENSE
SetupIconFile=..\static\icons\papervault.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\dist
OutputBaseFilename=PaperVault-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
; Đóng PaperVault đang chạy trước khi chép đè (PrepareToInstall gửi lệnh thoát qua cửa sổ khay trước).
CloseApplications=yes
RestartApplications=no
ShowLanguageDialog=no

[Languages]
; Default.isl đứng trước để câu nào bản dịch còn thiếu thì hiện tiếng Anh thay vì để trống.
Name: "vi"; MessagesFile: "compiler:Default.isl,Vietnamese.isl"

[CustomMessages]
vi.TaskShortcuts=Lối tắt:
vi.TaskDesktop=Tạo lối tắt trên &Desktop
vi.TaskStartMenu=Tạo lối tắt trong &Start Menu
vi.TaskStartup=Khởi động:
vi.TaskAutoStart=&Mở PaperVault cùng Windows (chạy ẩn ở khay hệ thống, vẫn nhắc việc)
vi.WebView2Title=Tải Microsoft Edge WebView2 Runtime
vi.WebView2Desc=PaperVault cần WebView2 để hiện cửa sổ ứng dụng. Máy chưa có nên bộ cài đang tải bản chính thức của Microsoft.
vi.WebView2Installing=Đang cài Microsoft Edge WebView2 Runtime...
vi.WebView2Failed=Không tải được Microsoft Edge WebView2 Runtime:%n%1%n%nVẫn cài PaperVault? Sau đó có thể tự cài WebView2 tại https://developer.microsoft.com/microsoft-edge/webview2/ (chưa có WebView2 thì PaperVault mở bằng cửa sổ Edge / Chrome).
vi.ClosingApp=Đang đóng PaperVault...
vi.DataNote=Thư viện, PDF và API key mặc định lưu ở %1, không nằm trong thư mục cài: cài bản mới đè lên hay gỡ cài đặt đều không mất dữ liệu.

[Tasks]
Name: "desktopicon"; Description: "{cm:TaskDesktop}"; GroupDescription: "{cm:TaskShortcuts}"
Name: "startmenu"; Description: "{cm:TaskStartMenu}"; GroupDescription: "{cm:TaskShortcuts}"
Name: "autostart"; Description: "{cm:TaskAutoStart}"; GroupDescription: "{cm:TaskStartup}"; Flags: unchecked

[InstallDelete]
; Bỏ thư viện Python của bản trước để không sót file cũ lẫn với bản mới (dữ liệu không nằm ở đây).
Type: filesandordirs; Name: "{app}\_internal"

[Files]
Source: "{#DistDir}\*"; DestDir: "{app}"; Excludes: "\data,\config.json,\LICENSE,\dist-data-backup,*.lock"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "PaperVault.installed"; DestDir: "{app}"; Flags: ignoreversion
Source: "detect-legacy.ps1"; Flags: dontcopy

[Icons]
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; Comment: "PaperVault - quản lý & tổng hợp paper"; Tasks: desktopicon
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; Comment: "PaperVault - quản lý & tổng hợp paper"; Tasks: startmenu

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "PaperVault"; ValueData: """{app}\{#AppExe}"" --tray"; Tasks: autostart; Flags: uninsdeletevalue
; Bỏ chọn "Mở cùng Windows" khi cài đè thì xoá lệnh khởi động cũ.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueName: "PaperVault"; ValueType: none; Tasks: not autostart; Flags: deletevalue dontcreatekey

[Run]
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "{cm:WebView2Installing}"; Check: WebView2Downloaded; Flags: waituntilterminated
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: files; Name: "{app}\legacy-dirs.txt"
Type: dirifempty; Name: "{app}"

[Code]
const
  WebView2Guid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WM_CLOSE = $0010;

var
  DownloadPage: TDownloadWizardPage;
  NeedWebView2, HaveWebView2Setup: Boolean;

function WebView2Version(RootKey: Integer; const Key: String): String;
begin
  if not RegQueryStringValue(RootKey, Key + WebView2Guid, 'pv', Result) then
    Result := '';
end;

// Theo hướng dẫn của Microsoft: WebView2 Runtime đã cài khi khoá EdgeUpdate\Clients\{GUID} có giá trị pv khác rỗng và khác 0.0.0.0.
function WebView2Installed: Boolean;
var
  V: String;
begin
  V := WebView2Version(HKLM32, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\');
  if (V = '') or (V = '0.0.0.0') then
    V := WebView2Version(HKLM64, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\');
  if (V = '') or (V = '0.0.0.0') then
    V := WebView2Version(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\');
  Result := (V <> '') and (V <> '0.0.0.0');
end;

function WebView2Downloaded: Boolean;
begin
  Result := HaveWebView2Setup;
end;

procedure InitializeWizard;
begin
  // /FORCEWEBVIEW2=1: luôn tải và chạy bộ cài WebView2 (để thử bước này trên máy đã có sẵn).
  NeedWebView2 := not WebView2Installed or (ExpandConstant('{param:FORCEWEBVIEW2|0}') = '1');
  DownloadPage := CreateDownloadPage(CustomMessage('WebView2Title'), CustomMessage('WebView2Desc'), nil);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = wpReady) and NeedWebView2 then begin
    DownloadPage.Clear;
    DownloadPage.Add('{#WebView2Url}', 'MicrosoftEdgeWebview2Setup.exe', '');
    DownloadPage.Show;
    try
      try
        DownloadPage.Download;
        HaveWebView2Setup := True;
      except
        if not DownloadPage.AbortedByUser then
          Result := SuppressibleMsgBox(FmtMessage(CustomMessage('WebView2Failed'), [GetExceptionMessage]),
            mbError, MB_YESNO, IDYES) = IDYES
        else
          Result := False;
      end;
    finally
      DownloadPage.Hide;
    end;
  end;
end;

// Thoát hẳn PaperVault đang chạy (cả khi đang thu ở khay): gửi WM_CLOSE tới cửa sổ ẩn của biểu tượng khay (tray.py).
procedure ClosePaperVault(InWizard: Boolean);
var
  Wnd: HWND;
  I: Integer;
begin
  Wnd := FindWindowByClassName('PaperVaultTray');
  if Wnd = 0 then
    Exit;
  if InWizard then
    WizardForm.PreparingLabel.Caption := CustomMessage('ClosingApp');
  PostMessage(Wnd, WM_CLOSE, 0, 0);
  for I := 1 to 40 do begin
    Sleep(250);
    if FindWindowByClassName('PaperVaultTray') = 0 then
      Break;
  end;
  Sleep(1500);  // chờ WebView2 (msedgewebview2.exe) thả file
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Result := '';
  // Tìm thư mục PaperVault cũ trước khi đóng app (lúc còn chạy mới biết .exe nằm đâu).
  ExtractTemporaryFile('detect-legacy.ps1');
  Exec('powershell.exe', '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\detect-legacy.ps1') +
    '" -Out "' + ExpandConstant('{tmp}\legacy-dirs.txt') + '"', '', SW_HIDE, ewWaitUntilTerminated, Code);
  ClosePaperVault(True);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and FileExists(ExpandConstant('{tmp}\legacy-dirs.txt')) then
    CopyFile(ExpandConstant('{tmp}\legacy-dirs.txt'), ExpandConstant('{app}\legacy-dirs.txt'), False);
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then
    WizardForm.FinishedLabel.Caption := WizardForm.FinishedLabel.Caption + #13#10#13#10 +
      FmtMessage(CustomMessage('DataNote'), [ExpandConstant('{localappdata}\PaperVault')]);
end;

function InitializeUninstall: Boolean;
begin
  ClosePaperVault(False);
  Result := True;
end;
