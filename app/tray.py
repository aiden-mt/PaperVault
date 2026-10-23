"""Biểu tượng PaperVault ở khay hệ thống Windows (cạnh đồng hồ) và thông báo của Windows, chỉ dùng ctypes.

- Bấm biểu tượng: mở lại cửa sổ. Chuột phải: menu Mở PaperVault / Thoát.
- notify(title, msg): hiện thông báo của Windows (Windows 10/11 đưa vào Trung tâm thông báo); bấm thông báo thì
  gọi on_click của lần thông báo đó (mở app tới đúng trang).
Chạy trong một luồng riêng có vòng lặp thông điệp; mọi hàm công khai an toàn khi gọi từ luồng khác.
"""
import ctypes
import sys
import threading
from ctypes import wintypes

WM_USER = 0x0400
WM_TRAY = WM_USER + 20
WM_DESTROY = 0x0002
WM_CLOSE = 0x0010
WM_QUERYENDSESSION = 0x0011
WM_LBUTTONUP = 0x0202
WM_LBUTTONDBLCLK = 0x0203
WM_RBUTTONUP = 0x0205
NIN_BALLOONUSERCLICK = WM_USER + 5
NIM_ADD, NIM_MODIFY, NIM_DELETE = 0, 1, 2
NIF_MESSAGE, NIF_ICON, NIF_TIP, NIF_INFO = 0x1, 0x2, 0x4, 0x10
NIIF_USER, NIIF_LARGE_ICON = 0x4, 0x20
IMAGE_ICON, LR_LOADFROMFILE, LR_DEFAULTSIZE = 1, 0x10, 0x40
MF_STRING, MF_SEPARATOR = 0x0, 0x800
TPM_RIGHTBUTTON, TPM_RETURNCMD, TPM_NONOTIFY = 0x2, 0x100, 0x80
CMD_OPEN, CMD_QUIT = 1001, 1002

LRESULT = ctypes.c_ssize_t
WNDPROC = ctypes.WINFUNCTYPE(LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)


class GUID(ctypes.Structure):
    _fields_ = [("Data1", wintypes.DWORD), ("Data2", wintypes.WORD), ("Data3", wintypes.WORD), ("Data4", ctypes.c_ubyte * 8)]


class NOTIFYICONDATAW(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD), ("hWnd", wintypes.HWND), ("uID", wintypes.UINT), ("uFlags", wintypes.UINT),
        ("uCallbackMessage", wintypes.UINT), ("hIcon", wintypes.HICON), ("szTip", wintypes.WCHAR * 128),
        ("dwState", wintypes.DWORD), ("dwStateMask", wintypes.DWORD), ("szInfo", wintypes.WCHAR * 256),
        ("uVersion", wintypes.UINT), ("szInfoTitle", wintypes.WCHAR * 64), ("dwInfoFlags", wintypes.DWORD),
        ("guidItem", GUID), ("hBalloonIcon", wintypes.HICON),
    ]


class WNDCLASSEXW(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.UINT), ("style", wintypes.UINT), ("lpfnWndProc", WNDPROC), ("cbClsExtra", ctypes.c_int),
        ("cbWndExtra", ctypes.c_int), ("hInstance", wintypes.HINSTANCE), ("hIcon", wintypes.HICON), ("hCursor", wintypes.HANDLE),
        ("hbrBackground", wintypes.HANDLE), ("lpszMenuName", wintypes.LPCWSTR), ("lpszClassName", wintypes.LPCWSTR), ("hIconSm", wintypes.HICON),
    ]


class Tray:
    def __init__(self, icon_path, tip="PaperVault", on_open=None, on_quit=None, on_session_end=None):
        self.icon_path = str(icon_path) if icon_path else ""
        self.tip = tip
        self.on_open = on_open or (lambda: None)
        self.on_quit = on_quit or (lambda: None)
        self.on_session_end = on_session_end or (lambda: None)  # Windows sắp tắt / đăng xuất
        self.hwnd = None
        self.hicon = None
        self._click = None  # việc chạy khi bấm thông báo gần nhất
        self._ready = threading.Event()
        self._proc = WNDPROC(self._wndproc)  # giữ tham chiếu, không để bị thu gom
        self._taskbar_created = 0
        self.ok = False

    # ---------- công khai ----------
    def start(self):
        if not sys.platform.startswith("win"):
            return False
        threading.Thread(target=self._run, name="pv-tray", daemon=True).start()
        self._ready.wait(5)
        return self.ok

    def notify(self, title, msg, on_click=None):
        """Thông báo của Windows. Trả về False nếu khay chưa sẵn sàng (gọi nơi khác hiện cách dự phòng)."""
        if not self.ok:
            return False
        self._click = on_click
        nid = self._nid(NIF_INFO)
        nid.szInfoTitle = str(title or "PaperVault")[:63]
        nid.szInfo = str(msg or " ")[:255]
        nid.dwInfoFlags = NIIF_USER | NIIF_LARGE_ICON
        nid.hBalloonIcon = self.hicon
        return bool(ctypes.windll.shell32.Shell_NotifyIconW(NIM_MODIFY, ctypes.byref(nid)))

    def remove(self):
        """Gỡ biểu tượng ngay (trước khi thoát tiến trình, để không còn biểu tượng "ma" ở khay)."""
        if self.ok:
            self.ok = False
            ctypes.windll.shell32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(self._nid(0)))

    # ---------- bên trong ----------
    def _nid(self, flags):
        nid = NOTIFYICONDATAW()
        nid.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
        nid.hWnd = self.hwnd
        nid.uID = 1
        nid.uFlags = flags
        return nid

    def _add_icon(self):
        nid = self._nid(NIF_MESSAGE | NIF_ICON | NIF_TIP)
        nid.uCallbackMessage = WM_TRAY
        nid.hIcon = self.hicon
        nid.szTip = self.tip[:127]
        return bool(ctypes.windll.shell32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(nid)))

    def _menu(self):
        u = ctypes.windll.user32
        m = u.CreatePopupMenu()
        u.AppendMenuW(m, MF_STRING, CMD_OPEN, "Mở PaperVault")
        u.AppendMenuW(m, MF_SEPARATOR, 0, None)
        u.AppendMenuW(m, MF_STRING, CMD_QUIT, "Thoát PaperVault")
        pt = wintypes.POINT()
        u.GetCursorPos(ctypes.byref(pt))
        u.SetForegroundWindow(self.hwnd)  # để menu tự đóng khi bấm ra ngoài
        cmd = u.TrackPopupMenu(m, TPM_RIGHTBUTTON | TPM_RETURNCMD | TPM_NONOTIFY, pt.x, pt.y, 0, self.hwnd, None)
        u.DestroyMenu(m)
        if cmd == CMD_OPEN:
            self._safe(self.on_open)
        elif cmd == CMD_QUIT:
            self._safe(self.on_quit)

    @staticmethod
    def _safe(fn):
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            print("[tray]", e)

    def _wndproc(self, hwnd, msg, wparam, lparam):
        u = ctypes.windll.user32
        if msg == WM_TRAY:
            ev = lparam & 0xFFFF
            if ev in (WM_LBUTTONUP, WM_LBUTTONDBLCLK):
                self._safe(self.on_open)
            elif ev == WM_RBUTTONUP:
                self._menu()
            elif ev == NIN_BALLOONUSERCLICK:
                fn, self._click = self._click, None
                self._safe(fn or self.on_open)
            return 0
        if msg == self._taskbar_created and msg:
            self._add_icon()  # Explorer khởi động lại: thêm lại biểu tượng
            return 0
        if msg == WM_QUERYENDSESSION:
            self._safe(self.on_session_end)  # cho cửa sổ chính đóng luôn, không hỏi
            return 1
        if msg == WM_CLOSE:
            # Ai đó yêu cầu đóng (trình cài đặt, tắt máy…): thoát hẳn app, không để tiến trình chạy ẩn mất biểu tượng.
            self.remove()
            self._safe(self.on_quit)
            u.DestroyWindow(hwnd)
            return 0
        if msg == WM_DESTROY:
            u.PostQuitMessage(0)
            return 0
        return u.DefWindowProcW(hwnd, msg, wparam, lparam)

    def _run(self):
        try:
            u = ctypes.windll.user32
            k = ctypes.windll.kernel32
            u.DefWindowProcW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
            u.DefWindowProcW.restype = LRESULT
            u.CreateWindowExW.restype = wintypes.HWND
            u.CreateWindowExW.argtypes = [wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD, ctypes.c_int, ctypes.c_int,
                                          ctypes.c_int, ctypes.c_int, wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID]
            u.LoadImageW.restype = wintypes.HANDLE
            u.LoadImageW.argtypes = [wintypes.HINSTANCE, wintypes.LPCWSTR, wintypes.UINT, ctypes.c_int, ctypes.c_int, wintypes.UINT]
            u.TrackPopupMenu.argtypes = [wintypes.HMENU, wintypes.UINT, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.HWND, wintypes.LPVOID]
            u.AppendMenuW.argtypes = [wintypes.HMENU, wintypes.UINT, ctypes.c_size_t, wintypes.LPCWSTR]
            u.CreatePopupMenu.restype = wintypes.HMENU
            ctypes.windll.shell32.Shell_NotifyIconW.argtypes = [wintypes.DWORD, ctypes.POINTER(NOTIFYICONDATAW)]
            k.GetModuleHandleW.restype = wintypes.HMODULE
            hinst = k.GetModuleHandleW(None)
            cls = WNDCLASSEXW()
            cls.cbSize = ctypes.sizeof(WNDCLASSEXW)
            cls.lpfnWndProc = self._proc
            cls.hInstance = hinst
            cls.lpszClassName = "PaperVaultTray"
            u.RegisterClassExW(ctypes.byref(cls))
            self._taskbar_created = u.RegisterWindowMessageW("TaskbarCreated")
            # Cửa sổ ẩn bình thường (không phải message-only) để nhận được TaskbarCreated.
            self.hwnd = u.CreateWindowExW(0, "PaperVaultTray", "PaperVault tray", 0, 0, 0, 0, 0, None, None, hinst, None)
            if self.icon_path:
                self.hicon = u.LoadImageW(None, self.icon_path, IMAGE_ICON, 0, 0, LR_LOADFROMFILE | LR_DEFAULTSIZE)
            if not self.hicon:
                self.hicon = u.LoadIconW(None, ctypes.c_void_p(32512))  # IDI_APPLICATION
            self.ok = bool(self.hwnd) and self._add_icon()
        except Exception as e:  # noqa: BLE001
            print("[tray] không tạo được biểu tượng khay:", e)
            self.ok = False
        finally:
            self._ready.set()
        if not self.ok:
            return
        msg = wintypes.MSG()
        while ctypes.windll.user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            ctypes.windll.user32.TranslateMessage(ctypes.byref(msg))
            ctypes.windll.user32.DispatchMessageW(ctypes.byref(msg))
