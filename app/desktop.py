#!/usr/bin/env python3
"""PaperVault Desktop - mở ứng dụng trong cửa sổ riêng (không cần trình duyệt).

Dùng pywebview (WebView2 của Windows / WebKit trên macOS). Nếu chưa cài pywebview,
tự động rơi về chế độ "app window" của Chrome/Edge (cửa sổ không có thanh địa chỉ).

    pip install pywebview
    python desktop.py            # hoặc pythonw desktop.py để không hiện console
"""
import json
import os
import shutil
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

import server  # cùng thư mục

APP_TITLE = "PaperVault"
APP_ICON = server.STATIC / "icons" / "papervault.ico"
WIN_FILE = server.DATA / "window.json"


def load_window_state():
    try:
        return json.loads(WIN_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_window_state(state):
    try:
        WIN_FILE.write_text(json.dumps(state), encoding="utf-8")
    except Exception:
        pass


def _virtual_screen():
    """(left, top, width, height) của toàn bộ màn hình (mọi màn hình gộp lại), None nếu không đọc được."""
    if not sys.platform.startswith("win"):
        return None
    try:
        import ctypes
        m = ctypes.windll.user32.GetSystemMetrics
        return m(76), m(77), m(78), m(79)  # SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN
    except Exception:
        return None


def _usable_geometry(st):
    """Kích thước và vị trí đã lưu, chỉ giữ khi hợp lệ: cửa sổ thu nhỏ có toạ độ -32000 (Windows) hoặc nằm ngoài
    mọi màn hình (đã rút màn hình phụ) thì bỏ vị trí để cửa sổ mở giữa màn hình."""
    w = max(900, min(int(st.get("width") or 1280), 10000))
    h = max(600, min(int(st.get("height") or 820), 10000))
    x, y = st.get("x"), st.get("y")
    ok = isinstance(x, int) and isinstance(y, int) and x > -10000 and y > -10000
    vs = _virtual_screen()
    if ok and vs:
        left, top, vw, vh = vs
        # Cần thấy được ít nhất 120 x 80 px của cửa sổ (đủ để kéo thanh tiêu đề).
        ok = x + w - 120 >= left and x + 120 <= left + vw and y >= top - 20 and y + 80 <= top + vh
    return w, h, (x if ok else None), (y if ok else None)


_window = None  # giữ ở module, KHÔNG gắn vào DesktopApi: pywebview duyệt đệ quy thuộc tính của js_api
_tray = None     # biểu tượng ở khay hệ thống (tray.py), None nếu không tạo được
_quitting = False


def close_action():
    """Bấm ✕: "ask" hỏi mỗi lần (thu xuống khay hay thoát), "tray" thu xuống khay (vẫn nhắc việc), "quit" thoát hẳn.
    Đổi trong Cài đặt → Ứng dụng, hoặc tick "Ghi nhớ lựa chọn" trong hộp thoại hỏi."""
    try:
        s = server.get_settings()
    except Exception:
        return "ask"
    a = s.get("closeAction")
    if a in ("ask", "tray", "quit"):
        return a
    return "quit" if s.get("closeToTray") is False else "ask"  # cài đặt cũ (trước khi có hộp thoại hỏi)


def hide_to_tray():
    """Ẩn cửa sổ xuống khay. Lần đầu báo cho người dùng biết app vẫn chạy ở đó."""
    if _window is None:
        return
    try:
        _window.hide()
    except Exception:
        pass
    st = load_window_state()
    if _tray is not None and _tray.ok and not st.get("trayHintShown"):
        _tray.notify("PaperVault vẫn đang chạy", "App thu xuống khay hệ thống để nhắc việc. Bấm biểu tượng để mở lại; chuột phải → Thoát để tắt hẳn.")
        save_window_state({**st, "trayHintShown": True})


def mark_quitting():
    """Windows sắp tắt / đăng xuất: cho cửa sổ đóng luôn, không hỏi, không thu xuống khay."""
    global _quitting
    _quitting = True


def show_window(hash_=""):
    """Hiện lại cửa sổ (từ khay / bấm thông báo), đưa lên trước và mở trang hash_ nếu có."""
    w = _window
    if w is None:
        return
    try:
        w.show()
        w.restore()
    except Exception:
        pass
    if sys.platform.startswith("win"):
        try:
            import ctypes
            hwnd = ctypes.windll.user32.FindWindowW(None, w.title)
            if hwnd:
                ctypes.windll.user32.ShowWindow(hwnd, 9)  # SW_RESTORE
                ctypes.windll.user32.SetForegroundWindow(hwnd)
        except Exception:
            pass
    if hash_ and str(hash_).startswith("#/"):
        try:
            w.evaluate_js(f"window.pvShowHash ? window.pvShowHash({json.dumps(hash_)}) : (location.hash = {json.dumps(hash_)})")
        except Exception:
            pass


def quit_app():
    global _quitting
    _quitting = True
    if _tray:
        _tray.remove()
    # Đóng cửa sổ có thể bị kẹt (trang đang mở hộp thoại, WebView2 dọn dẹp lâu): quá 3 giây thì thoát hẳn.
    threading.Timer(3, lambda: os._exit(0)).start()
    try:
        if _window is not None:
            _window.destroy()
    except Exception:
        pass
    os._exit(0)


class DesktopApi:
    """Các hàm JS gọi được qua window.pywebview.api.*"""

    def app_info(self):
        return {
            "desktop": True,
            "frozen": server.FROZEN,
            "dataDir": str(server.DATA),
            "configFile": str(server.HOME_DIR / "config.json"),
            "platform": sys.platform,
        }

    def pick_folder(self, start=""):
        import webview
        start_dir = start if start and Path(start).exists() else str(Path.home())
        res = _window.create_file_dialog(webview.FOLDER_DIALOG, directory=start_dir)
        if not res:
            return None
        return res[0] if isinstance(res, (list, tuple)) else res

    def pick_files(self, pdf_only=True):
        import webview
        types = ("PDF (*.pdf)",) if pdf_only else ("Tất cả (*.*)",)
        res = _window.create_file_dialog(webview.OPEN_DIALOG, allow_multiple=True, file_types=types)
        return list(res or [])

    def save_file(self, filename, data_b64, label=""):
        """Hộp thoại "Lưu thành" của hệ điều hành rồi ghi file. Trả về đường dẫn đã lưu, None nếu người dùng huỷ."""
        import base64
        import re
        import webview
        name = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "-", str(filename or "papervault.txt")).strip() or "papervault.txt"
        ext = Path(name).suffix.lower()
        desc = re.sub(r"[^\w ]+", " ", label or ext[1:].upper()).strip() or "File"
        types = (f"{desc} (*{ext})", "Tất cả (*.*)") if re.fullmatch(r"\.\w+", ext or "") else ("Tất cả (*.*)",)
        state = load_window_state()
        start = state.get("saveDir") or str(Path.home() / "Downloads")
        res = _window.create_file_dialog(webview.FileDialog.SAVE, directory=start if Path(start).exists() else "", save_filename=name, file_types=types)
        if not res:
            return None
        path = Path(res if isinstance(res, str) else res[0])
        if ext and not path.suffix:
            path = path.with_suffix(ext)
        path.write_bytes(base64.b64decode(data_b64))
        state["saveDir"] = str(path.parent)
        save_window_state(state)
        return str(path)

    def reveal_file(self, path):
        """Mở thư mục chứa file và chọn sẵn file đó."""
        p = Path(path)
        if sys.platform.startswith("win"):
            subprocess.Popen(["explorer", "/select,", str(p)])
        else:
            self.open_path(str(p.parent))
        return True

    def read_file_base64(self, path):
        import base64
        p = Path(path)
        if not p.exists() or p.stat().st_size > 64 * 1024 * 1024:
            return None
        return {"name": p.name, "base64": base64.b64encode(p.read_bytes()).decode("ascii"), "size": p.stat().st_size}

    def set_data_dir(self, path, move=False):
        """Ghi dataDir vào config.json. move=True: copy dữ liệu hiện tại sang thư mục mới (nếu nơi đó chưa có DB)."""
        target = Path(path).expanduser().resolve()
        target.mkdir(parents=True, exist_ok=True)
        if move and not (target / "papervault.db").exists() and server.DB_PATH.exists():
            shutil.copy2(server.DB_PATH, target / "papervault.db")
            if server.PDF_DIR.exists():
                shutil.copytree(server.PDF_DIR, target / "pdfs", dirs_exist_ok=True)
        cfg_file = server.HOME_DIR / "config.json"
        cfg = {}
        if cfg_file.exists():
            try:
                cfg = json.loads(cfg_file.read_text(encoding="utf-8"))
            except Exception:
                cfg = {}
        cfg["dataDir"] = str(target)
        cfg_file.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"dataDir": str(target), "configFile": str(cfg_file)}

    def open_path(self, path):
        p = str(path)
        if sys.platform.startswith("win"):
            os.startfile(p)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", p])
        else:
            subprocess.Popen(["xdg-open", p])
        return True

    def open_url(self, url):
        webbrowser.open(url)
        return True

    def attention(self):
        """Nháy nút app trên thanh tác vụ (nhắc việc) khi cửa sổ không ở trước."""
        if not sys.platform.startswith("win") or _window is None:
            return False
        try:
            import ctypes
            from ctypes import wintypes

            class FLASHWINFO(ctypes.Structure):
                _fields_ = [("cbSize", wintypes.UINT), ("hwnd", wintypes.HWND), ("dwFlags", wintypes.DWORD), ("uCount", wintypes.UINT), ("dwTimeout", wintypes.DWORD)]
            hwnd = ctypes.windll.user32.FindWindowW(None, _window.title)
            if not hwnd:
                return False
            # FLASHW_ALL | FLASHW_TIMERNOFG: nháy tới khi người dùng mở cửa sổ
            info = FLASHWINFO(ctypes.sizeof(FLASHWINFO), hwnd, 0x03 | 0x0C, 0, 0)
            ctypes.windll.user32.FlashWindowEx(ctypes.byref(info))
            return True
        except Exception:
            return False

    def notify(self, title, body="", hash_=""):
        """Thông báo của Windows (qua biểu tượng khay); bấm thông báo thì mở app tới trang hash_. False nếu không có khay."""
        if _tray is None or not _tray.ok:
            return False
        return _tray.notify(title, body, on_click=lambda: show_window(hash_))

    def tray_info(self):
        return {"tray": bool(_tray and _tray.ok), "closeAction": close_action()}

    def close_choice(self, action):
        """Trả lời hộp thoại "Đóng PaperVault?": "tray" thu xuống khay, "quit" thoát hẳn, khác thì giữ cửa sổ."""
        if action == "tray":
            hide_to_tray()
        elif action == "quit":
            threading.Timer(0.15, quit_app).start()  # để lời gọi từ JS trả về trước khi tiến trình thoát
        return True

    def restart(self):
        """Khởi động lại tiến trình (sau khi đổi thư mục dữ liệu)."""
        exe = sys.executable
        args = [exe] + ([] if server.FROZEN else [str(Path(__file__).resolve())])
        subprocess.Popen(args, cwd=str(server.BASE))
        if _tray:
            _tray.remove()
        os._exit(0)

    def quit(self):
        quit_app()


LOCK_FILE = server.DATA / "app.lock"
WEBVIEW_DIR = server.DATA / "webview"


def instance_running():
    """Trả về URL của bản PaperVault đang chạy (theo app.lock), hoặc None."""
    try:
        info = json.loads(LOCK_FILE.read_text(encoding="utf-8"))
        import urllib.request
        with urllib.request.urlopen(f"{info['url']}api/health", timeout=1.5) as r:
            if json.loads(r.read()).get("ok"):
                return info["url"]
    except Exception:
        pass
    return None


def cleanup_orphan_webview():
    """Lần chạy trước bị tắt đột ngột có thể để lại msedgewebview2.exe giữ thư mục webview -> WebView2 báo 'resource in use'."""
    if not sys.platform.startswith("win"):
        return
    try:
        ps = ("Get-CimInstance Win32_Process -Filter \"Name='msedgewebview2.exe'\" | "
              f"Where-Object {{ $_.CommandLine -like '*{str(WEBVIEW_DIR).replace(chr(39), chr(39) * 2)}*' }} | "
              "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }")
        subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], timeout=15,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), capture_output=True)
    except Exception:
        pass


def notify(title, msg):
    if sys.platform.startswith("win"):
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, msg, title, 0x40)
            return
        except Exception:
            pass
    print(f"{title}: {msg}")


def run_server_thread():
    # Cổng cố định (mặc định 8765, đổi bằng PV_PORT hoặc "port" trong config.json). Cổng phải giữ nguyên giữa các lần mở
    # app: trình duyệt nhớ localStorage (giao diện, bố cục chia đôi, ô "Bắt đầu"…) theo địa chỉ http://127.0.0.1:<cổng>,
    # đổi cổng là mất hết. 8765 cũng là địa chỉ extension dùng để đẩy paper sang app. Cổng bận thì thử vài cổng kế tiếp,
    # cuối cùng mới để hệ điều hành chọn.
    want = server.PORT
    srv = url = None
    for port in [want, *range(want + 1, want + 6), 0]:
        try:
            srv, url = server.start_server(port=port)
            break
        except OSError:
            continue
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, url


def set_app_id():
    """Cho Windows biết đây là app riêng: taskbar hiện logo PaperVault thay vì biểu tượng python.exe."""
    if sys.platform.startswith("win"):
        try:
            import ctypes
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("PaperVault.Desktop")
        except Exception:
            pass


def start_tray():
    global _tray
    if not sys.platform.startswith("win"):
        return
    try:
        import tray
        t = tray.Tray(APP_ICON if APP_ICON.exists() else None, tip="PaperVault · bấm để mở, chuột phải để thoát",
                      on_open=show_window, on_quit=quit_app, on_session_end=mark_quitting)
        if t.start():
            _tray = t
    except Exception as e:
        print("Không tạo được biểu tượng khay:", e)


def run_pywebview(url):
    global _window
    import webview

    set_app_id()

    api = DesktopApi()
    st = load_window_state()
    width, height, x, y = _usable_geometry(st)
    window = webview.create_window(
        APP_TITLE, url + "?desktop=1",
        js_api=api,
        width=width, height=height,
        x=x, y=y,
        min_size=(900, 600),
        text_select=True,
        zoomable=True,
    )
    _window = window

    def on_closing():
        try:
            # Đang thu nhỏ (Windows đặt toạ độ -32000) thì không lưu vị trí / kích thước, giữ lần lưu trước.
            if (window.x or 0) > -10000 and (window.y or 0) > -10000 and (window.width or 0) >= 300:
                save_window_state({**load_window_state(), "width": window.width, "height": window.height, "x": window.x, "y": window.y})
        except Exception:
            pass
        if _quitting or _tray is None or not _tray.ok:
            return None
        action = close_action()
        if action == "quit":
            return None
        if action == "tray":
            hide_to_tray()
            return False

        # Hỏi trong app (thu xuống khay / thoát, có ô ghi nhớ). Gọi JS ở luồng khác: sự kiện closing chạy trên luồng
        # giao diện, gọi evaluate_js ngay tại đây sẽ treo. Trang không trả lời được thì thu xuống khay cho an toàn.
        def ask():
            try:
                window.restore()  # đóng từ thanh tác vụ khi đang thu nhỏ: hiện cửa sổ để thấy hộp thoại
            except Exception:
                pass
            try:
                ok = window.evaluate_js("window.pvAskClose ? (window.pvAskClose(), true) : false")
            except Exception as e:
                print("[close] không hỏi được trong trang:", repr(e))
                ok = False
            if not ok:
                ask_native()

        def ask_native():
            """Trang chưa tải xong / bị lỗi: hỏi bằng hộp thoại của Windows (Có = khay, Không = thoát, Huỷ = ở lại)."""
            try:
                import ctypes
                hwnd = ctypes.windll.user32.FindWindowW(None, window.title)
                msg = "Thu PaperVault xuống khay hệ thống (vẫn nhắc việc)?\n\nCó: thu xuống khay · Không: thoát hẳn · Huỷ: ở lại"
                r = ctypes.windll.user32.MessageBoxW(hwnd, msg, "Đóng PaperVault?", 0x03 | 0x20)  # MB_YESNOCANCEL | MB_ICONQUESTION
            except Exception:
                r = 6
            if r == 6:
                hide_to_tray()
            elif r == 7:
                quit_app()

        threading.Thread(target=ask, daemon=True).start()
        return False

    def on_closed():
        if _tray:
            _tray.remove()
        os._exit(0)

    window.events.closing += on_closing
    window.events.closed += on_closed
    start_tray()
    webview.start(debug=bool(os.environ.get("PV_DEBUG")), private_mode=False, storage_path=str(WEBVIEW_DIR),
                  icon=str(APP_ICON) if APP_ICON.exists() else None)


def run_browser_app_mode(url):
    """Dự phòng: mở Chrome/Edge ở chế độ --app (cửa sổ riêng, không thanh địa chỉ)."""
    candidates = []
    if sys.platform.startswith("win"):
        pf = [os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), os.environ.get("LocalAppData", "")]
        for base in pf:
            candidates += [Path(base) / "Microsoft/Edge/Application/msedge.exe", Path(base) / "Google/Chrome/Application/chrome.exe"]
    elif sys.platform == "darwin":
        candidates += [Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge")]
    else:
        candidates += [Path(p) for p in (shutil.which("google-chrome"), shutil.which("chromium"), shutil.which("microsoft-edge")) if p]
    for exe in candidates:
        if exe and Path(exe).exists():
            profile = server.DATA / "browser-profile"
            proc = subprocess.Popen([str(exe), f"--app={url}?desktop=0", "--window-size=1280,820", f"--user-data-dir={profile}", "--no-first-run", "--no-default-browser-check"])
            proc.wait()
            return True
    return False


def main():
    running = instance_running()
    if running:
        notify("PaperVault", f"PaperVault đang chạy rồi ({running}). Hãy dùng cửa sổ đang mở.")
        webbrowser.open(running) if os.environ.get("PV_OPEN_EXISTING") else None
        return
    cleanup_orphan_webview()
    srv, url = run_server_thread()
    try:
        LOCK_FILE.write_text(json.dumps({"url": url, "pid": os.getpid()}), encoding="utf-8")
    except Exception:
        pass
    print(f"PaperVault Desktop · {url} · dữ liệu: {server.DATA}")
    try:
        import webview  # noqa: F401
        has_webview = True
    except ImportError:
        has_webview = False
    if has_webview:
        run_pywebview(url)
    else:
        print("Chưa cài pywebview (pip install pywebview) - dùng cửa sổ app của Chrome/Edge.")
        if not run_browser_app_mode(url):
            webbrowser.open(url)
            print("Không tìm thấy Chrome/Edge, đã mở trong trình duyệt mặc định. Nhấn Ctrl+C để thoát.")
            try:
                threading.Event().wait()
            except KeyboardInterrupt:
                pass


if __name__ == "__main__":
    main()
