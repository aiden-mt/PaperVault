#!/usr/bin/env python3
"""PaperVault App - máy chủ cục bộ.

Chỉ dùng thư viện chuẩn của Python (>= 3.9):
- Phục vụ giao diện tĩnh trong thư mục static/
- REST API lưu paper / chủ đề / cài đặt vào SQLite (data/papervault.db)
- Lưu file PDF trong data/pdfs/
- Proxy tải nội dung (arXiv, Semantic Scholar, Crossref, PDF...) để trình duyệt không bị CORS chặn
- Ghi thư viện ra thư mục Markdown trên đĩa
"""
import base64
import gzip
import hashlib
import html
import io
import json
import mimetypes
import os
import re
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
import xml.etree.ElementTree as ET
import shutil
import subprocess
import tempfile
import zipfile
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# Console Windows mặc định dùng cp1252, in tiếng Việt sẽ lỗi -> ép UTF-8.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Khi đóng gói bằng PyInstaller: static nằm trong thư mục tạm _MEIPASS, còn dữ liệu/config đặt cạnh file .exe.
FROZEN = getattr(sys, "frozen", False)
BASE = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parent
BUNDLE = Path(getattr(sys, "_MEIPASS", BASE)) if FROZEN else BASE
STATIC = (Path(getattr(sys, "_MEIPASS", BASE)) / "static") if FROZEN else BASE / "static"


# Kiểu MIME cố định cho file tĩnh: trên Windows, mimetypes đọc registry nên .js/.mjs đôi khi bị trả sai,
# làm WebView2 từ chối chạy module (PDF.js dùng .mjs, .wasm, .ftl).
STATIC_TYPES = {
    ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
    ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
    ".wasm": "application/wasm", ".ftl": "text/plain", ".bcmap": "application/octet-stream",
    ".pfb": "application/octet-stream", ".ttf": "font/ttf", ".woff2": "font/woff2", ".woff": "font/woff", ".icc": "application/octet-stream", ".gif": "image/gif",
    ".webp": "image/webp", ".jpg": "image/jpeg",
}


def _project_dir():
    """Bản .exe build ngay trong dự án (app/dist/PaperVault/PaperVault.exe) -> trả về thư mục app/.
    Khi đó .exe dùng chung config.json và app/data với bản chạy bằng Python, không để dữ liệu trong dist/
    vì PyInstaller xoá sạch dist/PaperVault mỗi lần build lại."""
    if FROZEN and BASE.parent.name.lower() == "dist" and (BASE.parent.parent / "server.py").exists():
        return BASE.parent.parent
    return None


# Nơi đặt config.json và thư mục data mặc định.
HOME_DIR = _project_dir() or BASE


def load_config():
    """config.json cạnh server.py: {"dataDir": "...", "port": 8765, "host": "127.0.0.1", "openBrowser": true}"""
    cfg = {}
    f = HOME_DIR / "config.json"
    if f.exists():
        try:
            cfg = json.loads(f.read_text(encoding="utf-8"))
        except Exception as e:
            print("[PaperVault] config.json lỗi, bỏ qua:", e)
    return cfg


CONFIG = load_config()
# Thư mục dữ liệu: ưu tiên biến môi trường PV_DATA, rồi config.json, mặc định app/data.
# Đặt thư mục này vào OneDrive / Google Drive để đồng bộ giữa các máy (mỗi lúc chỉ mở app trên một máy).
DATA = Path(os.environ.get("PV_DATA") or CONFIG.get("dataDir") or (HOME_DIR / "data")).expanduser().resolve()
PDF_DIR = DATA / "pdfs"
IMG_DIR = DATA / "images"  # ảnh chèn vào Sổ tay
DB_PATH = DATA / "papervault.db"
HOST = os.environ.get("PV_HOST") or CONFIG.get("host") or "127.0.0.1"
PORT = int(os.environ.get("PV_PORT") or CONFIG.get("port") or 8765)
MAX_BODY = 64 * 1024 * 1024
# Phiên bản app (so với bản mới nhất trên GitHub Releases khi kiểm tra cập nhật). Tăng cùng lúc với tag phát hành.
APP_VERSION = "1.3.0"
RELEASES_API = "https://api.github.com/repos/aiden-mt/PaperVault/releases/latest"
RELEASES_PAGE = "https://github.com/aiden-mt/PaperVault/releases/latest"
UA = "PaperVault/1.0 (local research assistant; +https://github.com)"

# ----------------------------------------------------------------------------
# SQLite
# ----------------------------------------------------------------------------

_lock = threading.RLock()


def _connect():
    DATA.mkdir(parents=True, exist_ok=True)
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=10)
    # journal_mode=DELETE: không sinh file -wal/-shm cạnh DB, an toàn hơn khi DB nằm trong thư mục OneDrive/Google Drive.
    con.execute("PRAGMA journal_mode=DELETE")
    con.execute("PRAGMA synchronous=FULL")
    con.execute("""CREATE TABLE IF NOT EXISTS papers (
        id TEXT PRIMARY KEY, topicId TEXT, updatedAt TEXT, json TEXT NOT NULL)""")
    con.execute("""CREATE TABLE IF NOT EXISTS topics (
        id TEXT PRIMARY KEY, json TEXT NOT NULL)""")
    con.execute("""CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY, json TEXT NOT NULL)""")
    con.execute("""CREATE TABLE IF NOT EXISTS texts (
        paperId TEXT PRIMARY KEY, text TEXT NOT NULL, kind TEXT, updatedAt TEXT)""")
    con.execute("""CREATE TABLE IF NOT EXISTS pdfs (
        id TEXT PRIMARY KEY, name TEXT, size INTEGER, createdAt TEXT)""")
    con.execute("""CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY, updatedAt TEXT, json TEXT NOT NULL)""")
    con.execute("""CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY, updatedAt TEXT, json TEXT NOT NULL)""")
    con.execute("""CREATE TABLE IF NOT EXISTS page_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, pageId TEXT, at TEXT, title TEXT, size INTEGER, json TEXT NOT NULL)""")
    con.execute("CREATE INDEX IF NOT EXISTS page_versions_page ON page_versions (pageId, id)")
    con.execute("""CREATE TABLE IF NOT EXISTS usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, provider TEXT, model TEXT, task TEXT,
        inputTokens INTEGER, outputTokens INTEGER, paperId TEXT)""")
    for col in ("cacheRead", "cacheWrite"):
        try:
            con.execute(f"ALTER TABLE usage ADD COLUMN {col} INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass  # cột đã có
    con.commit()
    return con


DB = _connect()


def _init_fts():
    """Bảng FTS5 cho tìm kiếm toàn văn. Python sqlite3 trên Windows/macOS thường có sẵn FTS5; nếu không thì dùng LIKE."""
    try:
        with _lock:
            DB.execute("CREATE VIRTUAL TABLE IF NOT EXISTS texts_fts USING fts5(paperId UNINDEXED, body)")
            n_fts = DB.execute("SELECT COUNT(*) FROM texts_fts").fetchone()[0]
            n_txt = DB.execute("SELECT COUNT(*) FROM texts").fetchone()[0]
            if n_fts == 0 and n_txt > 0:
                for pid, text in DB.execute("SELECT paperId, text FROM texts").fetchall():
                    title = ""
                    row = DB.execute("SELECT json FROM papers WHERE id=?", (pid,)).fetchone()
                    if row:
                        title = json.loads(row[0]).get("title", "")
                    DB.execute("INSERT INTO texts_fts (paperId, body) VALUES (?,?)", (pid, f"{title}\n{text}"))
            DB.commit()
        return True
    except sqlite3.OperationalError as e:
        print("[PaperVault] FTS5 không khả dụng, dùng LIKE:", e)
        return False


HAS_FTS = _init_fts()


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + ".000Z"


def now_iso_ms():
    t = time.time()
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(t)) + f".{int(t * 1000) % 1000:03d}Z"


def uid(prefix="p"):
    import random
    return f"{prefix}_{int(time.time() * 1000):x}_{random.randrange(16 ** 6):06x}"


def db_all(sql, args=()):
    with _lock:
        return DB.execute(sql, args).fetchall()


def db_one(sql, args=()):
    with _lock:
        return DB.execute(sql, args).fetchone()


def db_run(sql, args=()):
    with _lock:
        DB.execute(sql, args)
        DB.commit()


# ---- papers ----

def get_papers(include_deleted=False, only_deleted=False):
    rows = db_all("SELECT json FROM papers ORDER BY updatedAt DESC")
    out = []
    for r in rows:
        p = json.loads(r[0])
        deleted = bool(p.get("deletedAt"))
        if only_deleted and not deleted:
            continue
        if not include_deleted and not only_deleted and deleted:
            continue
        out.append(p)
    return out


def get_paper(pid):
    row = db_one("SELECT json FROM papers WHERE id=?", (pid,))
    return json.loads(row[0]) if row else None


def attach_venue(p, force=False):
    """Gắn p["venueInfo"] (loại venue + hạng). Giữ nguyên nếu người dùng đã sửa tay."""
    vi = p.get("venueInfo") or {}
    if vi.get("manual") and not force:
        return p
    e = p.get("extraction") or {}
    cands = [e.get("venue") or "", p.get("venueRaw") or ""]
    hints = p.get("venueHints") or {}
    try:
        ver = RANK.version()
    except Exception:
        ver = "?"
    key = hashlib.md5(json.dumps([cands, hints, bool(p.get("arxivId")), ver], ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
    if not force and vi.get("key") == key:
        return p
    try:
        info = RANK.classify(cands, hints, has_arxiv=bool(p.get("arxivId")))
    except Exception as ex:  # pragma: no cover
        info = {"type": "unknown", "error": str(ex)}
    info["key"] = key
    p["venueInfo"] = info
    return p


def put_paper(paper, classify=True):
    p = dict(paper)
    p["id"] = p.get("id") or uid("p")
    p["createdAt"] = p.get("createdAt") or now_iso()
    p["updatedAt"] = now_iso()
    p.pop("sourceText", None)  # full text được lưu riêng trong bảng texts
    if classify:
        attach_venue(p)
    db_run("INSERT OR REPLACE INTO papers (id, topicId, updatedAt, json) VALUES (?,?,?,?)",
           (p["id"], p.get("topicId"), p["updatedAt"], json.dumps(p, ensure_ascii=False)))
    return p


def delete_paper(pid, permanent=False):
    p = get_paper(pid)
    if not p:
        return
    if not permanent:
        p["deletedAt"] = now_iso()
        put_paper(p)
        return
    db_run("DELETE FROM papers WHERE id=?", (pid,))
    db_run("DELETE FROM texts WHERE paperId=?", (pid,))
    if HAS_FTS:
        db_run("DELETE FROM texts_fts WHERE paperId=?", (pid,))
    if p and p.get("pdfId"):
        # xoá file PDF nếu không còn paper nào dùng
        others = db_one("SELECT COUNT(*) FROM papers WHERE json LIKE ?", (f'%"pdfId": "{p["pdfId"]}"%',))
        if not others or others[0] == 0:
            delete_pdf(p["pdfId"])


def restore_paper(pid):
    p = get_paper(pid)
    if p and p.get("deletedAt"):
        p.pop("deletedAt", None)
        put_paper(p)
    return p


def purge_trash(days=30):
    """Xoá hẳn các paper nằm trong thùng rác quá `days` ngày."""
    cutoff = time.time() - days * 86400
    n = 0
    for p in get_papers(only_deleted=True):
        try:
            t = time.mktime(time.strptime(p["deletedAt"][:19], "%Y-%m-%dT%H:%M:%S"))
        except Exception:
            continue
        if t < cutoff:
            delete_paper(p["id"], permanent=True)
            n += 1
    return n


# ---- topics ----

DEFAULT_TOPICS_FILE = STATIC / "js" / "topics.js"


def default_topics():
    """Đọc DEFAULT_TOPICS từ topics.js để không phải khai báo hai nơi."""
    try:
        src = DEFAULT_TOPICS_FILE.read_text(encoding="utf-8")
        m = re.search(r"DEFAULT_TOPICS\s*=\s*(\[[\s\S]*?\n\]);", src)
        block = m.group(1)
        # chuyển literal JS sang JSON: khoá không ngoặc kép, dấu nháy đơn, dấu phẩy cuối
        block = re.sub(r"(\{|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1 "\2":', block)
        block = re.sub(r"'((?:[^'\\]|\\.)*)'", lambda mm: json.dumps(mm.group(1).replace("\\'", "'"), ensure_ascii=False), block)
        block = re.sub(r",\s*([\]\}])", r"\1", block)
        return json.loads(block)
    except Exception as e:  # pragma: no cover
        print("[PaperVault] Không đọc được DEFAULT_TOPICS:", e)
        return [{"id": "t_inbox", "name": "Inbox (chưa phân loại)", "color": "#9aa0a6",
                 "description": "Nơi chứa tạm các paper chưa quyết định chủ đề.", "keywords": []}]


def get_topics():
    rows = db_all("SELECT json FROM topics")
    topics = [json.loads(r[0]) for r in rows]
    if not topics:
        topics = [dict(t, createdAt=now_iso()) for t in default_topics()]
        for t in topics:
            put_topic(t)
    return sorted(topics, key=lambda t: t.get("name", "").lower())


def put_topic(topic):
    t = {"keywords": [], "color": "#6b7cff", "description": ""}
    t.update(topic)
    t["id"] = t.get("id") or uid("t")
    db_run("INSERT OR REPLACE INTO topics (id, json) VALUES (?,?)", (t["id"], json.dumps(t, ensure_ascii=False)))
    return t


def delete_topic(tid, reassign_to="t_inbox"):
    n = 0
    for p in get_papers():
        if p.get("topicId") == tid:
            p["topicId"] = reassign_to
            put_paper(p)
            n += 1
    db_run("DELETE FROM topics WHERE id=?", (tid,))
    return n


# ---- kv / settings ----

DEFAULT_SETTINGS = {
    "provider": "anthropic",
    "models": {"anthropic": "claude-opus-5", "openai": "gpt-4o", "gemini": "gemini-2.0-flash"},
    "apiKeys": {"anthropic": "", "openai": "", "gemini": ""},
    "maxInputChars": 60000,
    "maxOutputTokens": 8000,
    "effort": "high",
    "language": "vi",
    "notesLang": "",
    # notesLang: ngôn ngữ hiển thị ghi chú ("" = giữ ngôn ngữ lúc trích xuất, "vi" / "en" = dịch khi cần).
    # chatLang: ngôn ngữ trả lời của Chat và Hỏi đáp ("" = theo ngôn ngữ trích xuất, "auto" = theo câu hỏi, "vi" / "en").
    "chatLang": "",
    "chatLength": "",  # độ dài câu trả lời của Chat: "" tự co giãn theo câu hỏi, "short" ngắn gọn, "long" chi tiết
    "myResearch": "",
    "translate": {"targetLang": "vi", "mode": "button", "openOn": "hover", "useContext": True, "showOriginal": True},
    "pdfMode": "auto",
    "exportDir": "",
    "autoSync": False,
    "theme": "auto",
    # Phông và cỡ chữ: uiFont/readFont rỗng = mặc định, uiScale/readScale tính bằng %, lineHeight 0 = mặc định.
    "appearance": {"uiFont": "", "uiScale": 100, "readFont": "", "readScale": 100, "lineHeight": 0},
    "s2ApiKey": "",
    # Model riêng cho từng nhóm việc: {"chat": {"provider": "openai", "model": "gpt-4o-mini"}, ...}; thiếu = dùng model chính.
    "taskModels": {},
    "nbPrompts": [],  # prompt nhanh tự lưu của AI trong Sổ tay: [{"label", "p", "mode"}]
    "onboardDismissed": False,  # đã tắt thẻ "Bắt đầu với PaperVault" ở Tổng quan
    # Tự sao lưu đầy đủ (.zip): every = "day" | "week", keep = số bản tự động giữ lại, dir rỗng = data/backups
    "autoBackup": {"enabled": False, "every": "day", "keep": 7, "dir": ""},
    "updateCheck": True,  # tự kiểm tra bản mới trên GitHub mỗi ngày một lần
    "closeAction": "ask",  # bản desktop, khi bấm ✕: "ask" hỏi mỗi lần, "tray" thu xuống khay (vẫn nhắc việc), "quit" thoát hẳn
    # Ngân sách AI mỗi tháng (USD, 0 = không giới hạn). mode khi vượt: "warn" chỉ cảnh báo, "cheap" chuyển sang model rẻ
    # cùng nhà cung cấp, "block" chặn gọi AI. warnAt: tỉ lệ bắt đầu cảnh báo.
    "aiBudget": {"limit": 0, "mode": "warn", "warnAt": 0.8},
}


def kv_get(key, fallback=None):
    row = db_one("SELECT json FROM kv WHERE key=?", (key,))
    return json.loads(row[0]) if row else fallback


def kv_set(key, value):
    db_run("INSERT OR REPLACE INTO kv (key, json) VALUES (?,?)", (key, json.dumps(value, ensure_ascii=False)))


def get_settings():
    s = kv_get("settings", {}) or {}
    out = json.loads(json.dumps(DEFAULT_SETTINGS))
    out.update({k: v for k, v in s.items() if k not in ("models", "apiKeys")})
    out["models"].update(s.get("models") or {})
    out["apiKeys"].update(s.get("apiKeys") or {})
    return out


# ---- texts ----

def get_text(pid):
    row = db_one("SELECT text, kind FROM texts WHERE paperId=?", (pid,))
    return {"text": row[0], "kind": row[1]} if row else {"text": "", "kind": ""}


def put_text(pid, text, kind=""):
    if not text:
        db_run("DELETE FROM texts WHERE paperId=?", (pid,))
        if HAS_FTS:
            db_run("DELETE FROM texts_fts WHERE paperId=?", (pid,))
        return
    db_run("INSERT OR REPLACE INTO texts (paperId, text, kind, updatedAt) VALUES (?,?,?,?)",
           (pid, text, kind or "", now_iso()))
    if HAS_FTS:
        p = get_paper(pid) or {}
        db_run("DELETE FROM texts_fts WHERE paperId=?", (pid,))
        db_run("INSERT INTO texts_fts (paperId, body) VALUES (?,?)", (pid, f"{p.get('title', '')}\n{text}"))


def search_text(q, limit=200):
    """Tìm toàn văn trong nội dung nguồn. Trả về [{paperId, snippet}]."""
    q = (q or "").strip()
    if not q:
        return []
    if HAS_FTS:
        terms = [t.replace('"', "") for t in q.split() if t.strip()]
        match = " ".join(f'"{t}"' for t in terms)
        try:
            rows = db_all("SELECT paperId, snippet(texts_fts, 1, '[[', ']]', ' … ', 14) FROM texts_fts WHERE texts_fts MATCH ? ORDER BY rank LIMIT ?", (match, limit))
            return [{"paperId": r[0], "snippet": r[1]} for r in rows]
        except sqlite3.OperationalError:
            pass
    like = f"%{q}%"
    rows = db_all("SELECT paperId, text FROM texts WHERE text LIKE ? LIMIT ?", (like, limit))
    out = []
    for pid, text in rows:
        i = text.lower().find(q.lower())
        a = max(0, i - 70)
        out.append({"paperId": pid, "snippet": (" … " if a else "") + text[a:a + 180].replace("\n", " ") + " … "})
    return out


# ---- usage (token đã dùng) ----

def log_usage(row):
    db_run("INSERT INTO usage (at, provider, model, task, inputTokens, outputTokens, paperId, cacheRead, cacheWrite) VALUES (?,?,?,?,?,?,?,?,?)",
           (row.get("at") or now_iso(), row.get("provider", ""), row.get("model", ""), row.get("task", ""),
            int(row.get("inputTokens") or 0), int(row.get("outputTokens") or 0), row.get("paperId") or "",
            int(row.get("cacheRead") or 0), int(row.get("cacheWrite") or 0)))


def get_usage(since=""):
    cols = ("at", "provider", "model", "task", "inputTokens", "outputTokens", "paperId", "cacheRead", "cacheWrite")
    rows = db_all(f"SELECT {', '.join(cols)} FROM usage WHERE at >= ? ORDER BY at DESC", (since or "",))
    items = [dict(zip(cols, r)) for r in rows]
    totals = {}
    for it in items:
        k = f"{it['provider']}/{it['model']}"
        t = totals.setdefault(k, {"provider": it["provider"], "model": it["model"], "calls": 0, "inputTokens": 0, "outputTokens": 0, "cacheRead": 0, "cacheWrite": 0})
        t["calls"] += 1
        t["inputTokens"] += it["inputTokens"]
        t["outputTokens"] += it["outputTokens"]
        t["cacheRead"] += it["cacheRead"] or 0
        t["cacheWrite"] += it["cacheWrite"] or 0
    return {"items": items[:300], "totals": list(totals.values()), "count": len(items)}


def usage_cost(since=""):
    """Chi phí ước tính (USD) từ mốc since: đơn giá người dùng nhập trong Cài đặt, thiếu thì lấy bảng giá tự động.
    Cùng cách tính với bảng "Sử dụng API & chi phí" (token cache tính theo giá cache nếu có, không thì theo hệ số)."""
    totals = get_usage(since)["totals"]
    s = get_settings()
    user_prices = s.get("prices") or {}
    keys = [f"{t['provider']}/{t['model']}" for t in totals]
    auto = {}
    if s.get("autoPrices", True) is not False and keys:
        try:
            auto = model_prices(keys).get("prices", {})
        except Exception:
            auto = {}
    total, rows, missing = 0.0, [], []
    for t in totals:
        key = f"{t['provider']}/{t['model']}"
        mine = user_prices.get(key) or {}
        pr = mine if (mine.get("in") is not None or mine.get("out") is not None) else (auto.get(key) or {})
        if pr.get("in") is None and pr.get("out") is None:
            missing.append(key)
            continue
        pin, pout = float(pr.get("in") or 0), float(pr.get("out") or 0)
        rf = {"anthropic": 0.1, "openai": 0.5, "gemini": 0.25}.get(t["provider"], 0.1)
        wf = 1.25 if t["provider"] == "anthropic" else 1
        cr = (t["cacheRead"] or 0) / 1e6 * (pr["cacheRead"] if pr.get("cacheRead") is not None else pin * rf)
        cw = (t["cacheWrite"] or 0) / 1e6 * (pr["cacheWrite"] if pr.get("cacheWrite") is not None else pin * wf)
        cost = t["inputTokens"] / 1e6 * pin + t["outputTokens"] / 1e6 * pout + cr + cw
        total += cost
        rows.append({"key": key, "cost": round(cost, 6), "calls": t["calls"]})
    return {"cost": round(total, 6), "byModel": rows, "missingPrice": missing}


# ---- đơn giá model (tự cập nhật từ bảng giá công khai của LiteLLM) ----

PRICE_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
PRICE_FILE = DATA / "model_prices.json"
PRICE_MAX_AGE = 7 * 86400  # làm mới mỗi tuần
_price_lock = threading.Lock()


def _price_table(refresh=False):
    """Bảng giá rút gọn {model: {in, out, cacheRead, cacheWrite}} (USD / 1 triệu token), lưu tạm trong thư mục dữ liệu."""
    with _price_lock:
        cached = None
        if PRICE_FILE.exists():
            try:
                cached = json.loads(PRICE_FILE.read_text(encoding="utf-8"))
            except Exception:
                cached = None
        fresh = cached and time.time() - cached.get("fetchedAt", 0) < PRICE_MAX_AGE
        if cached and fresh and not refresh:
            return cached
        try:
            _, _, raw, _ = http_get(PRICE_URL, timeout=30, max_bytes=20 * 1024 * 1024)
            src = json.loads(raw.decode("utf-8"))
        except Exception as e:
            if cached:
                cached["stale"] = f"Không tải được bảng giá mới ({e}), đang dùng bản lưu ngày {time.strftime('%d/%m/%Y', time.localtime(cached.get('fetchedAt', 0)))}."
                return cached
            raise ValueError(f"Không tải được bảng giá model: {e}")
        per_m = lambda v: round(float(v) * 1e6, 6) if isinstance(v, (int, float)) else None  # noqa: E731
        models = {}
        for name, info in src.items():
            if not isinstance(info, dict) or name == "sample_spec":
                continue
            if info.get("mode") not in (None, "chat", "completion", "responses"):
                continue
            pin, pout = per_m(info.get("input_cost_per_token")), per_m(info.get("output_cost_per_token"))
            if pin is None and pout is None:
                continue
            models[name.lower()] = {"in": pin, "out": pout,
                                    "cacheRead": per_m(info.get("cache_read_input_token_cost")),
                                    "cacheWrite": per_m(info.get("cache_creation_input_token_cost"))}
        table = {"source": "LiteLLM model_prices_and_context_window.json", "url": PRICE_URL, "fetchedAt": time.time(), "models": models}
        try:
            PRICE_FILE.write_text(json.dumps(table), encoding="utf-8")
        except Exception:
            pass
        return table


def _price_candidates(provider, model):
    """Các tên có thể có trong bảng giá cho một model app đã gọi (bỏ đuôi ngày, đổi 3.5 <-> 3-5, thêm tiền tố nhà cung cấp)."""
    p = (provider or "").lower().strip()
    m = (model or "").lower().strip()
    m = re.sub(r"^models/", "", m)
    bases = [m]
    nodate = re.sub(r"-(\d{4}-\d{2}-\d{2}|\d{8}|\d{4})$", "", m)
    for b in (nodate, re.sub(r"-latest$", "", m), re.sub(r"-latest$", "", nodate)):
        if b and b not in bases:
            bases.append(b)
    for b in list(bases):
        for alt in (re.sub(r"(\d)\.(\d)", r"\1-\2", b), re.sub(r"(\d)-(\d)(?=\D|$)", r"\1.\2", b)):
            if alt not in bases:
                bases.append(alt)
    out = []
    prefixes = {"gemini": ["gemini/", "vertex_ai/"], "anthropic": ["anthropic/"], "openai": ["openai/"],
                "openrouter": ["openrouter/"], "deepseek": ["deepseek/"], "groq": ["groq/"], "mistral": ["mistral/"],
                "xai": ["xai/"], "together": ["together_ai/"]}.get(p, [f"{p}/"] if p else [])
    for b in bases:
        out.append(b)
        out += [f"{px}{b}" for px in prefixes]
        if "/" in b:  # openrouter: "anthropic/claude-3.5-sonnet" -> "claude-3.5-sonnet"
            out.append(b.split("/", 1)[1])
    seen = set()
    return [x for x in out if not (x in seen or seen.add(x))]


def model_prices(keys, refresh=False):
    table = _price_table(refresh)
    models = table["models"]
    prices, missing = {}, []
    for key in keys:
        provider, _, model = key.partition("/")
        hit = next((c for c in _price_candidates(provider, model) if c in models), None)
        if hit:
            prices[key] = {**models[hit], "matched": hit}
        else:
            missing.append(key)
    return {"prices": prices, "missing": missing, "source": table.get("source"), "url": table.get("url"),
            "fetchedAt": table.get("fetchedAt"), "stale": table.get("stale", "")}


# ---- phát âm cho bong bóng dịch: phiên âm IPA (Wiktionary, dự phòng dictionaryapi.dev), bản ghi âm, giọng đọc ----

UK_ACCENTS = {"uk", "rp", "british", "england", "ssb", "received pronunciation", "southern england", "english", "br", "gb"}
US_ACCENTS = {"us", "ga", "genam", "general american", "american", "usa", "am"}
VOICELESS = set("ptkf")


def _word_forms(w):
    """Dạng để tra phiên âm: (dạng, đuôi IPA cần nối thêm). Từ biến đổi không có mục riêng thì tra dạng gốc rồi nối đuôi:
    bars -> bar + z, studies -> study + z, bootstrapping -> bootstrap + ɪŋ, compared -> compare + d."""
    forms = [(w, "")]
    if len(w) > 4 and w.endswith("ing"):
        stem = w[:-3]
        forms += [(stem, "ɪŋ"), (stem + "e", "ɪŋ")]
        if len(stem) > 2 and stem[-1] == stem[-2]:
            forms.append((stem[:-1], "ɪŋ"))
    if len(w) > 3 and w.endswith("ed"):
        for stem in ([w[:-2], w[:-1]] + ([w[:-3]] if len(w) > 4 and w[-3] == w[-4] else [])):
            last = stem[-1:]
            suf = "ɪd" if last in ("t", "d") else ("t" if last in VOICELESS or stem.endswith(("s", "x", "ch", "sh")) else "d")
            forms.append((stem, suf))
    if w.endswith("ies") and len(w) > 4:
        forms.append((w[:-3] + "y", "z"))
    if w.endswith("es") and len(w) > 3 and w[:-2].endswith(("s", "x", "z", "ch", "sh")):
        forms.append((w[:-2], "ɪz"))
    if w.endswith("s") and not w.endswith("ss") and len(w) > 3:
        stem = w[:-1]
        forms.append((stem, "s" if stem[-1:] in VOICELESS else "z"))
    seen, out = set(), []
    for f in forms:
        if f[0] and f[0] not in seen:
            seen.add(f[0])
            out.append(f)
    return out


def _with_suffix(ipa, suf):
    if not suf or not ipa:
        return ipa
    return f"{ipa[:-1]}{suf}{ipa[-1]}" if ipa[-1:] in "/]" else ipa + suf


def _accent_set(text):
    """Nhãn giọng trong một dòng: {{a|…}}, {{accent|…}}, a=…, aa=…"""
    acc = set()
    for a in re.findall(r"\{\{(?:a|accent|lb)\|(?:en\|)?([^}]*)\}\}", text):
        acc.update(x.strip().lower() for x in re.split(r"[|,]", a))
    for a in re.findall(r"\|a{1,2}=([^|}]*)", text):
        acc.update(x.strip().lower() for x in a.split(","))
    return acc


def _wiktionary_ipa(word):
    """Phiên âm từ mục tiếng Anh của Wiktionary, tách theo giọng. Trả về {"UK": "/…/", "US": "/…/", "both": "/…/"};
    None nếu không tra được (lỗi mạng); {} nếu trang không có phiên âm."""
    url = f"https://en.wiktionary.org/w/api.php?action=parse&page={urllib.parse.quote(word)}&prop=wikitext&format=json&formatversion=2&redirects=1"
    _wk_pace()
    try:
        _, _, raw, _ = http_get(url, timeout=12, max_bytes=8 * 1024 * 1024,
                                headers={"User-Agent": "PaperVault/1.0 (personal research library; pronunciation lookup)"})
        data = json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as e:
        return {} if e.code == 404 else None
    except Exception:
        return None
    if data.get("error"):
        return {}
    text = (data.get("parse") or {}).get("wikitext") or ""
    m = re.search(r"^==\s*English\s*==\s*$(.*?)(?=^==[^=]|\Z)", text, re.M | re.S)
    eng = m.group(1) if m else ""
    cands = {"UK": [], "US": [], "any": []}
    parent_regions = set()
    for line in eng.split("\n"):
        depth = len(line) - len(line.lstrip("*"))
        if depth == 0:
            continue
        acc = _accent_set(line)
        regions = ({"UK"} if acc & UK_ACCENTS else set()) | ({"US"} if acc & US_ACCENTS else set())
        if depth == 1:
            parent_regions = regions
        elif not regions:
            regions = parent_regions  # dòng con kế thừa giọng của dòng cha
        if "{{IPA|en|" not in line:
            continue
        # Dòng chỉ ghi giọng vùng khác (Úc, Canada, Ấn…) thì bỏ qua.
        if acc and not regions and not (depth > 1 and parent_regions):
            continue
        for tpl in re.findall(r"\{\{IPA\|en\|([^}]*)\}\}", line):
            parts = [p.strip() for p in tpl.split("|") if "=" not in p]
            ipas = [p for p in parts if p.startswith("/") and p.endswith("/")] or [p for p in parts if p.startswith("[") and p.endswith("]")]
            if not ipas:
                continue
            ipa = ipas[0]
            for r in (regions or {"any"}):
                cands[r].append(ipa)
    # Ưu tiên cách đọc dùng chung cho cả hai giọng (thường là cách phổ biến nhất).
    common = [x for x in cands["UK"] if x in cands["US"]]
    out = {}
    if cands["UK"]:
        out["UK"] = common[0] if common else cands["UK"][0]
    if cands["US"]:
        out["US"] = common[0] if common else cands["US"][0]
    # both: cách đọc không ghi giọng hoặc dùng chung cho cả hai giọng.
    out["both"] = (cands["any"][0] if cands["any"] else "") or (common[0] if common else "")
    return {k: v for k, v in out.items() if v}


CMU_URL = "https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict"
CMU_FILE = DATA / "cmudict.dict"
_cmu = None
_cmu_lock = threading.Lock()
ARPA_V = {"AA": "ɑ", "AE": "æ", "AH": "ʌ", "AO": "ɔ", "AW": "aʊ", "AY": "aɪ", "EH": "ɛ", "ER": "ɝ", "EY": "eɪ", "IH": "ɪ",
          "IY": "i", "OW": "oʊ", "OY": "ɔɪ", "UH": "ʊ", "UW": "u"}
ARPA_C = {"B": "b", "CH": "tʃ", "D": "d", "DH": "ð", "F": "f", "G": "ɡ", "HH": "h", "JH": "dʒ", "K": "k", "L": "l", "M": "m",
          "N": "n", "NG": "ŋ", "P": "p", "R": "ɹ", "S": "s", "SH": "ʃ", "T": "t", "TH": "θ", "V": "v", "W": "w", "Y": "j",
          "Z": "z", "ZH": "ʒ"}
# Cụm phụ âm có thể đứng đầu âm tiết (để đặt dấu trọng âm trước cả cụm: ˈstɹ…, ˈpl…).
ONSETS = {"pl", "pɹ", "bl", "bɹ", "tɹ", "dɹ", "kl", "kɹ", "ɡl", "ɡɹ", "fl", "fɹ", "θɹ", "ʃɹ", "sp", "st", "sk", "sm", "sn",
          "sl", "sw", "spl", "spɹ", "stɹ", "skɹ", "skw", "kw", "tw", "dw", "ɡw", "pj", "bj", "kj", "fj", "mj", "vj", "hj"}


def _cmu_dict():
    """Từ điển phát âm CMU (Anh-Mỹ, ~134 nghìn từ): tải về thư mục dữ liệu một lần, sau đó tra offline."""
    global _cmu
    with _cmu_lock:
        if _cmu is not None:
            return _cmu
        if not CMU_FILE.exists():
            try:
                _, _, raw, _ = http_get(CMU_URL, timeout=60, max_bytes=10 * 1024 * 1024)
                CMU_FILE.write_bytes(raw)
            except Exception:
                return {}
        d = {}
        for line in CMU_FILE.read_text(encoding="utf-8", errors="replace").splitlines():
            parts = line.split("#")[0].split()
            if len(parts) < 2:
                continue
            w = parts[0]
            if "(" in w:  # cách đọc phụ: giữ cách đọc chính
                continue
            d[w] = parts[1:]
        _cmu = d
        return d


def _arpa_to_ipa(phones, demote=False):
    """ARPAbet -> IPA kiểu Anh-Mỹ, đặt dấu trọng âm ˈ / ˌ trước phụ âm đầu âm tiết. demote: hạ trọng âm chính thành phụ (vế sau từ ghép)."""
    segs = []  # [(ipa, stress or None)]
    for p in phones:
        base, stress = re.match(r"([A-Z]+)(\d?)", p).groups()
        if base in ARPA_V:
            v = ARPA_V[base]
            if stress == "0":
                v = {"ʌ": "ə", "ɝ": "ɚ"}.get(v, v)
            segs.append((v, stress))
        else:
            segs.append((ARPA_C.get(base, base.lower()), None))
    # Chèn dấu trọng âm: tìm nguyên âm có trọng âm, lùi qua cụm phụ âm đầu hợp lệ.
    res = [s[0] for s in segs]
    marks = {}
    for idx, (ph, st) in enumerate(segs):
        if st in ("1", "2"):
            j = idx
            onset = ""
            while j > 0 and segs[j - 1][1] is None:
                cand = segs[j - 1][0] + onset
                if onset and cand not in ONSETS:
                    break
                onset = cand
                j -= 1
            mark = "ˌ" if st == "2" or demote else "ˈ"
            marks[j] = mark
    text = ""
    for idx, ph in enumerate(res):
        text += marks.get(idx, "") + ph
    return text


def _cmu_ipa(word, _depth=0):
    """Phiên âm Anh-Mỹ từ CMU: từ có sẵn, dạng biến đổi (nối đuôi), hoặc từ ghép tách làm hai (pseudo + labels)."""
    d = _cmu_dict()
    if not d:
        return ""
    if word in d:
        return _arpa_to_ipa(d[word])
    for form, suf in _word_forms(word)[1:]:
        if form in d:
            return _arpa_to_ipa(d[form]) + suf
    if _depth == 0 and len(word) >= 7:
        for i in range(len(word) - 3, 2, -1):
            left, right = word[:i], word[i:]
            if left in d:
                r = _cmu_ipa(right, 1)
                if r:
                    return _arpa_to_ipa(d[left]) + r.replace("ˈ", "ˌ")
    return ""


_wk_lock = threading.Lock()
_wk_last = [0.0]


def _wk_pace():
    """Giãn cách các lần gọi Wiktionary (tránh bị giới hạn tốc độ)."""
    with _wk_lock:
        wait = 0.6 - (time.time() - _wk_last[0])
        if wait > 0:
            time.sleep(wait)
        _wk_last[0] = time.time()


def _dictapi(word):
    """Phiên âm và bản ghi âm từ dictionaryapi.dev. Trả về (ipas, audio) hoặc None khi lỗi mạng (đã thử lại một lần)."""
    region = lambda url: ("UK" if re.search(r"-uk\.mp3$", url) else "US" if re.search(r"-us\.mp3$", url) else "AU" if re.search(r"-au\.mp3$", url) else "")  # noqa: E731
    data = None
    for attempt in range(2):
        try:
            _, _, raw, _ = http_get(f"https://api.dictionaryapi.dev/api/v2/entries/en/{urllib.parse.quote(word)}", timeout=12, max_bytes=2 * 1024 * 1024)
            data = json.loads(raw.decode("utf-8"))
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return [], []
        except Exception:
            pass
        if attempt == 0:
            time.sleep(1.5)
    if data is None:
        return None
    ipas, audio, seen_t, seen_a = [], [], set(), set()
    for entry in data if isinstance(data, list) else []:
        for ph in entry.get("phonetics") or []:
            t, a = (ph.get("text") or "").strip(), (ph.get("audio") or "").strip()
            r = region(a) if a else ""
            if t and t not in seen_t:
                seen_t.add(t)
                ipas.append({"text": t, "region": r})
            if a and a not in seen_a and a.startswith("https://"):
                seen_a.add(a)
                audio.append({"url": a, "region": r})
        if not ipas and entry.get("phonetic"):
            ipas.append({"text": entry["phonetic"], "region": ""})
    return ipas, audio


def dict_lookup(word):
    """Phiên âm (theo giọng UK / US) và bản ghi âm của một từ tiếng Anh.
    Trả về {word, base, ipa: {UK?, US?, both?}, audio: [{url, region}], src} (both: cách đọc chung cho cả hai giọng).
    Kết quả có phiên âm được lưu lâu dài;
    kết quả trống chỉ giữ 1 ngày (nguồn có thể lỗi tạm thời)."""
    w = re.sub(r"[^a-z'-]", "", (word or "").lower().replace("’", "'"))[:40]
    if not w:
        return {}
    key = f"dict5:{w}"
    cached = kv_get(key)
    if cached is not None and not (not cached.get("ipa") and time.time() - cached.get("at", 0) > 86400):
        return cached
    out = {"word": w, "base": "", "ipa": {}, "audio": [], "src": ""}
    network_failed = False
    forms = _word_forms(w)
    for form, suf in forms:
        wk = _wiktionary_ipa(form)
        if wk is None:
            network_failed = True
            continue
        if wk:
            out["ipa"] = {k: _with_suffix(v, suf) for k, v in wk.items()}
            out["src"] = "Wiktionary"
            out["base"] = form if form != w else ""
            break
    # Wiktionary không có: dùng từ điển CMU (Anh-Mỹ, offline), kể cả từ biến đổi và từ ghép.
    if not out["ipa"]:
        us = _cmu_ipa(w)
        if us:
            out["ipa"], out["src"] = {"US": f"/{us}/"}, "CMU Pronouncing Dictionary"
    # Bản ghi âm người thật: chỉ lấy của chính từ này (bản ghi của dạng gốc đọc khác).
    d = _dictapi(w)
    if d is None:
        network_failed = True
    else:
        ipas, audio = d
        out["audio"] = audio
        if not out["ipa"] and ipas:
            ipa = {}
            for x in ipas:
                ipa.setdefault(x["region"] if x["region"] in ("UK", "US") else "both", x["text"])
            out["ipa"], out["src"] = ipa, "dictionaryapi.dev"
    if out["ipa"] or not network_failed:
        kv_set(key, {**out, "at": time.time()})
    return out


TTS_DIR = DATA / "tts"
TTS_LANG = {"us": "en-US", "uk": "en-GB"}


def _tts_chunks(text, size=190):
    """Cắt đoạn thành các phần ≤ size ký tự theo ranh giới câu / từ (giới hạn của dịch vụ đọc)."""
    words, chunks, cur = text.split(), [], ""
    for wd in words:
        if len(cur) + len(wd) + 1 > size and cur:
            chunks.append(cur)
            cur = wd
        else:
            cur = f"{cur} {wd}".strip()
    if cur:
        chunks.append(cur)
    return chunks


def tts_audio(text, accent="us"):
    """MP3 đọc đoạn tiếng Anh theo giọng Anh-Mỹ (us) hoặc Anh-Anh (uk). Từ đơn có bản ghi âm người thật đúng giọng thì dùng
    bản ghi âm; còn lại dùng giọng đọc của Google Dịch. Lưu tạm theo nội dung để lần sau phát ngay.
    Trả về (bytes, nguồn)."""
    accent = accent if accent in TTS_LANG else "us"
    text = re.sub(r"\s+", " ", (text or "")).strip()[:1000]
    if not text:
        raise ValueError("Không có nội dung để đọc.")
    TTS_DIR.mkdir(parents=True, exist_ok=True)
    h = hashlib.sha1(f"{accent}|{text}".encode("utf-8")).hexdigest()
    for src in ("rec", "tts"):
        f = TTS_DIR / f"{h}.{src}.mp3"
        if f.exists() and f.stat().st_size > 0:
            return f.read_bytes(), src
    bg_rec = False
    if re.fullmatch(r"[A-Za-z][A-Za-z'’-]*", text):
        w = re.sub(r"[^a-z'-]", "", text.lower().replace("’", "'"))[:40]
        info = kv_get(f"dict5:{w}")
        audio = info.get("audio") if isinstance(info, dict) else kv_get(f"ttsrec:{w}")
        if audio is None:
            # Chưa biết từ này có bản ghi âm người thật không: tra ở nền (dictionaryapi.dev có thể mất vài giây),
            # song song với giọng máy bên dưới. Giọng máy xong trước thì phát luôn; lần sau dùng bản ghi nếu tra được.
            bg_rec = True
            threading.Thread(target=_fetch_recordings, args=(w, text), daemon=True).start()
        else:
            url = next((a["url"] for a in audio or [] if a.get("region") == accent.upper()), "")
            if url and url.startswith("https://api.dictionaryapi.dev/"):
                try:
                    _, _, data, _ = http_get(url, timeout=8, max_bytes=3 * 1024 * 1024)
                    if data:
                        (TTS_DIR / f"{h}.rec.mp3").write_bytes(data)
                        return data, "rec"
                except Exception:
                    pass
    parts = []
    chunks = _tts_chunks(text)
    for i, c in enumerate(chunks):
        u = (f"https://translate.google.com/translate_tts?ie=UTF-8&q={urllib.parse.quote(c)}&tl={TTS_LANG[accent]}"
             f"&total={len(chunks)}&idx={i}&textlen={len(c)}&client=tw-ob")
        _, ctype, data, _ = http_get(u, timeout=20, max_bytes=5 * 1024 * 1024, headers={"Referer": "https://translate.google.com/"})
        if "audio" not in (ctype or ""):
            raise ValueError("Dịch vụ đọc không trả về âm thanh.")
        parts.append(data)
    data = b"".join(parts)
    # Lưu bản giọng máy; nếu sau đó tải được bản ghi âm người thật (.rec) thì lần phát sau ưu tiên bản ghi.
    (TTS_DIR / f"{h}.tts.mp3").write_bytes(data)
    rec = TTS_DIR / f"{h}.rec.mp3"
    if bg_rec and rec.exists() and rec.stat().st_size > 0:  # bản ghi tra ở nền đã về kịp
        return rec.read_bytes(), "rec"
    return data, "tts"


def _fetch_recordings(w, text, done=None):
    """Ở nền: tra bản ghi âm người thật của từ trên dictionaryapi.dev, tải về đúng giọng (US / UK) để lần sau phát."""
    try:
        d = _dictapi(w)
        if d is None:
            return  # lỗi mạng: lần sau thử lại
        audio = d[1] or []
        kv_set(f"ttsrec:{w}", audio)
        for acc in ("us", "uk"):
            url = next((a["url"] for a in audio if a.get("region") == acc.upper()), "")
            if not url or not url.startswith("https://api.dictionaryapi.dev/"):
                continue
            h = hashlib.sha1(f"{acc}|{text}".encode("utf-8")).hexdigest()
            try:
                _, _, data, _ = http_get(url, timeout=12, max_bytes=3 * 1024 * 1024)
                if data:
                    tmp = TTS_DIR / f"{h}.rec.part"
                    tmp.write_bytes(data)
                    os.replace(tmp, TTS_DIR / f"{h}.rec.mp3")  # đổi tên một lần: luồng khác không đọc phải file ghi dở
            except Exception:
                pass
    finally:
        if done:
            done.set()


# ---- chats (hội thoại với nhiều paper) ----

def list_chats():
    out = []
    for r in db_all("SELECT json FROM chats ORDER BY updatedAt DESC"):
        c = json.loads(r[0])
        out.append({"id": c["id"], "title": c.get("title", ""), "updatedAt": c.get("updatedAt"),
                    "paperIds": c.get("paperIds", []), "turns": sum(1 for m in c.get("messages", []) if m.get("role") == "user")})
    return out


def get_chat(cid):
    r = db_one("SELECT json FROM chats WHERE id=?", (cid,))
    return json.loads(r[0]) if r else None


def put_chat(chat):
    c = dict(chat)
    c["id"] = c.get("id") or uid("c")
    c["createdAt"] = c.get("createdAt") or now_iso()
    c["updatedAt"] = now_iso()
    db_run("INSERT OR REPLACE INTO chats (id, updatedAt, json) VALUES (?,?,?)", (c["id"], c["updatedAt"], json.dumps(c, ensure_ascii=False)))
    return c


# ---- sao lưu & khôi phục ----

# Dữ liệu người dùng lưu trong kv cần sao lưu: macro LaTeX của Sổ tay.
BACKUP_KV = ("mathLib",)


def backup_data(with_texts=True):
    """Toàn bộ dữ liệu dạng JSON (không gồm API key, PDF, ảnh)."""
    papers = get_papers(include_deleted=True)
    texts = {r[0]: {"text": r[1], "kind": r[2]} for r in db_all("SELECT paperId, text, kind FROM texts")} if with_texts else {}
    chats = [json.loads(r[0]) for r in db_all("SELECT json FROM chats")]
    return {"format": "papervault-export", "version": 3, "appVersion": APP_VERSION, "exportedAt": now_iso(),
            "topics": get_topics(), "papers": papers, "texts": texts, "pages": list_pages(), "calendar": kv_get("calendar", []),
            "chats": chats, "settings": {k: v for k, v in get_settings().items() if k != "apiKeys"},
            "kv": {k: kv_get(k) for k in BACKUP_KV if kv_get(k) is not None}}


def import_data(data, merge=True):
    """Nhập bản sao lưu JSON. merge: gộp (bỏ qua mục đã có); không thì thay thế paper, texts, sổ tay, lịch, chat."""
    if not isinstance(data.get("papers"), list):
        raise ValueError("File import không đúng định dạng PaperVault.")
    existing = {p["id"] for p in get_papers()} if merge else set()
    if not merge:
        db_run("DELETE FROM papers")
        db_run("DELETE FROM texts")
    for t in data.get("topics") or []:
        put_topic(t)
    added = 0
    for p in data["papers"]:
        if merge and p.get("id") in existing:
            continue
        saved = put_paper(p)
        t = (data.get("texts") or {}).get(p.get("id"))
        if t:
            put_text(saved["id"], t.get("text", ""), t.get("kind", ""))
        added += 1
    # Lịch: gộp theo id (giữ kế hoạch đang có), thay thế thì lấy nguyên bản trong file.
    if isinstance(data.get("calendar"), list):
        cur = [] if not merge else (kv_get("calendar", []) or [])
        have = {e.get("id") for e in cur}
        kv_set("calendar", cur + [e for e in data["calendar"] if isinstance(e, dict) and e.get("id") not in have])
    # Cài đặt: chỉ khi thay thế toàn bộ; API key không có trong bản sao lưu nên giữ key đang có trên máy này.
    if not merge and isinstance(data.get("settings"), dict):
        cur = kv_get("settings", {}) or {}
        kv_set("settings", {**{k: v for k, v in data["settings"].items() if k != "apiKeys"}, "apiKeys": cur.get("apiKeys") or {}})
    # kv (macro LaTeX…): gộp thì giữ mục đang có trên máy này, thay thế thì lấy nguyên bản trong file.
    for k, v in (data.get("kv") or {}).items():
        if k not in BACKUP_KV or v is None:
            continue
        cur = kv_get(k)
        if merge and isinstance(cur, dict) and isinstance(v, dict):
            v = {**v, **cur}
        elif merge and isinstance(cur, list) and isinstance(v, list):
            have = {x.get("id") for x in cur if isinstance(x, dict)}
            v = cur + [x for x in v if isinstance(x, dict) and x.get("id") not in have]
        elif merge and cur is not None:
            continue
        kv_set(k, v)
    # Sổ tay và Chat: gộp thì bỏ qua mục đã có, thay thế thì xoá hết rồi nạp lại.
    for table, key in (("pages", "pages"), ("chats", "chats")):
        if not isinstance(data.get(key), list):
            continue
        if not merge:
            db_run(f"DELETE FROM {table}")
        have = {r[0] for r in db_all(f"SELECT id FROM {table}")}
        for item in data[key]:
            if isinstance(item, dict) and item.get("id") and item["id"] not in have:
                db_run(f"INSERT OR REPLACE INTO {table} (id, updatedAt, json) VALUES (?,?,?)", (item["id"], item.get("updatedAt") or now_iso(), json.dumps(item, ensure_ascii=False)))
    return added


BACKUP_NAME = re.compile(r"PaperVault-backup-(auto-)?\d{8}-\d{6}\.zip")


def backup_dir():
    d = ((get_settings().get("autoBackup") or {}).get("dir") or "").strip()
    p = Path(d).expanduser() if d else DATA / "backups"
    p.mkdir(parents=True, exist_ok=True)
    return p


def make_backup_zip(auto=False):
    """Bản sao lưu đầy đủ: dữ liệu (JSON, kèm toàn văn) + mọi file PDF + ảnh của Sổ tay. Trả về thông tin file."""
    d = backup_dir()
    name = f"PaperVault-backup-{'auto-' if auto else ''}{time.strftime('%Y%m%d-%H%M%S')}.zip"
    tmp = d / (name + ".part")
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("papervault-backup.json", json.dumps(backup_data(True), ensure_ascii=False))
        for folder, sub in ((PDF_DIR, "pdfs"), (IMG_DIR, "images")):
            if folder.exists():
                for f in sorted(folder.iterdir()):
                    if f.is_file():
                        # PDF và ảnh đã nén sẵn: lưu nguyên cho nhanh
                        z.write(f, f"{sub}/{f.name}", compress_type=zipfile.ZIP_STORED)
    path = d / name
    os.replace(tmp, path)
    kv_set("lastBackup", {"at": now_iso(), "file": name, "auto": auto})
    return backup_info(path)


def backup_info(p):
    st = p.stat()
    return {"name": p.name, "size": st.st_size, "at": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(st.st_mtime)), "auto": "-auto-" in p.name}


def list_backups():
    d = backup_dir()
    files = sorted((f for f in d.iterdir() if f.is_file() and BACKUP_NAME.fullmatch(f.name)), key=lambda f: f.stat().st_mtime, reverse=True)
    return {"dir": str(d), "list": [backup_info(f) for f in files], "last": kv_get("lastBackup"), "settings": get_settings().get("autoBackup") or {}}


def prune_auto_backups(keep):
    d = backup_dir()
    autos = sorted((f for f in d.iterdir() if f.is_file() and f.name.startswith("PaperVault-backup-auto-") and f.suffix == ".zip"), key=lambda f: f.stat().st_mtime, reverse=True)
    for f in autos[max(1, int(keep or 7)):]:
        try:
            f.unlink()
        except OSError:
            pass


def restore_backup_zip(path, merge=True):
    """Khôi phục từ file .zip: nhập dữ liệu, chép PDF và ảnh còn thiếu (không ghi đè file đã có)."""
    files = 0
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        if "papervault-backup.json" not in names:
            raise ValueError("File .zip không phải bản sao lưu PaperVault.")
        data = json.loads(z.read("papervault-backup.json").decode("utf-8"))
        for n in names:
            m = re.fullmatch(r"(pdfs|images)/([A-Za-z0-9_.-]+)", n)
            if not m:
                continue
            dest = (PDF_DIR if m.group(1) == "pdfs" else IMG_DIR) / m.group(2)
            if dest.exists():
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(z.read(n))
            files += 1
    # PDF mới chép vào cần có dòng trong bảng pdfs để mở được
    for f in PDF_DIR.glob("*.pdf") if PDF_DIR.exists() else []:
        if not db_one("SELECT 1 FROM pdfs WHERE id=?", (f.stem,)):
            db_run("INSERT INTO pdfs (id, name, size, createdAt) VALUES (?,?,?,?)", (f.stem, f.name, f.stat().st_size, now_iso()))
    added = import_data(data, merge=merge)
    return {"papers": added, "files": files}


def auto_backup_due():
    cfg = get_settings().get("autoBackup") or {}
    if not cfg.get("enabled"):
        return False
    last_auto = kv_get("lastAutoBackup")
    days = 7 if cfg.get("every") == "week" else 1
    if not last_auto:
        return True
    try:
        t0 = time.mktime(time.strptime(last_auto[:19], "%Y-%m-%dT%H:%M:%S"))
    except ValueError:
        return True
    return time.time() - t0 >= days * 86400 - 600


def _auto_backup_loop():
    time.sleep(90)  # để app khởi động xong
    while True:
        try:
            if auto_backup_due():
                make_backup_zip(auto=True)
                kv_set("lastAutoBackup", time.strftime("%Y-%m-%dT%H:%M:%S"))
                prune_auto_backups((get_settings().get("autoBackup") or {}).get("keep") or 7)
        except Exception as e:  # pragma: no cover
            print("[PaperVault] auto-backup:", e)
        time.sleep(1800)


# ---- xuất PDF: in trang HTML bằng Edge / Chrome chạy ẩn (Windows luôn có Edge) ----

def find_browser():
    cands = []
    if sys.platform.startswith("win"):
        for base in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA")):
            if base:
                cands += [Path(base) / "Microsoft/Edge/Application/msedge.exe", Path(base) / "Google/Chrome/Application/chrome.exe"]
    elif sys.platform == "darwin":
        cands += [Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"), Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")]
    for c in cands:
        if c.exists():
            return str(c)
    for n in ("msedge", "microsoft-edge", "google-chrome", "chromium", "chromium-browser", "chrome"):
        w = shutil.which(n)
        if w:
            return w
    return None


PRINT_DOCS = {}  # token -> HTML đang chờ in (Edge mở qua http để tải được phông KaTeX cùng nguồn)


def html_to_pdf(doc_html, port):
    exe = find_browser()
    if not exe:
        raise FileNotFoundError("no-browser")
    work = Path(tempfile.mkdtemp(prefix="pv-pdf-"))
    token = uid("pd")
    PRINT_DOCS[token] = doc_html
    try:
        out = work / "page.pdf"
        args = [exe, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
                f"--user-data-dir={work / 'profile'}", "--no-pdf-header-footer", "--print-to-pdf-no-header",
                "--virtual-time-budget=8000", "--run-all-compositor-stages-before-draw", f"--print-to-pdf={out}", f"http://127.0.0.1:{port}/api/print-doc/{token}"]
        flags = 0x08000000 if sys.platform.startswith("win") else 0  # CREATE_NO_WINDOW
        subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90, creationflags=flags)
        # Edge trên Windows giao việc cho tiến trình con rồi thoát ngay: chờ file PDF ghi xong (kích thước đứng yên).
        last, still, t0 = -1, 0, time.time()
        while time.time() - t0 < 90:
            size = out.stat().st_size if out.exists() else -1
            if size > 200 and size == last:
                still += 1
                if still >= 2:
                    break
            else:
                still = 0
            last = size
            time.sleep(0.3)
        if not out.exists() or out.stat().st_size < 200:
            raise RuntimeError("Trình duyệt không tạo được file PDF.")
        time.sleep(0.3)
        return out.read_bytes()
    finally:
        PRINT_DOCS.pop(token, None)
        # Tiến trình con của Edge có thể còn giữ thư mục hồ sơ vài giây: dọn sau.
        threading.Timer(20, shutil.rmtree, args=(work,), kwargs={"ignore_errors": True}).start()


# ---- kiểm tra bản mới trên GitHub ----

def _ver(s):
    return tuple(int(x) for x in re.findall(r"\d+", str(s or ""))[:3]) or (0,)


def update_check():
    _, _, raw, _ = http_get(RELEASES_API, timeout=15, max_bytes=2 * 1024 * 1024, headers={"Accept": "application/vnd.github+json"})
    rel = json.loads(raw.decode("utf-8"))
    latest = (rel.get("tag_name") or "").lstrip("vV")
    return {"current": APP_VERSION, "latest": latest, "newer": _ver(latest) > _ver(APP_VERSION),
            "url": rel.get("html_url") or RELEASES_PAGE, "name": rel.get("name") or latest,
            "download": next((x.get("browser_download_url") for x in rel.get("assets") or [] if str(x.get("name", "")).lower().endswith(".zip")), None),
            "publishedAt": rel.get("published_at"), "notes": (rel.get("body") or "")[:4000]}


# ---- sổ tay nghiên cứu (trang Markdown liên kết với nhau và với paper) ----

def list_pages():
    return [json.loads(r[0]) for r in db_all("SELECT json FROM pages ORDER BY updatedAt DESC")]


VERSION_GAP = 10 * 60   # tối đa một bản lưu mỗi 10 phút khi đang gõ liên tục
VERSION_KEEP = 80       # số phiên bản giữ lại cho mỗi trang


def snapshot_page(old, force=False):
    """Lưu trạng thái cũ của trang vào lịch sử phiên bản (gộp các lần lưu liên tiếp trong VERSION_GAP)."""
    if not old:
        return
    last = db_one("SELECT at, json FROM page_versions WHERE pageId=? ORDER BY id DESC LIMIT 1", (old["id"],))
    if last:
        prev = json.loads(last[1])
        if prev.get("content") == old.get("content") and prev.get("title") == old.get("title"):
            return
        if not force:
            try:
                t0 = time.mktime(time.strptime(last[0][:19], "%Y-%m-%dT%H:%M:%S"))
                if time.time() - t0 < VERSION_GAP:
                    return
            except ValueError:
                pass
    snap = {k: old.get(k) for k in ("id", "title", "icon", "content", "updatedAt")}
    db_run("INSERT INTO page_versions (pageId, at, title, size, json) VALUES (?,?,?,?,?)",
           (old["id"], time.strftime("%Y-%m-%dT%H:%M:%S"), old.get("title") or "", len(old.get("content") or ""), json.dumps(snap, ensure_ascii=False)))
    db_run("DELETE FROM page_versions WHERE pageId=? AND id NOT IN (SELECT id FROM page_versions WHERE pageId=? ORDER BY id DESC LIMIT ?)", (old["id"], old["id"], VERSION_KEEP))


def get_page(pid):
    r = db_one("SELECT json FROM pages WHERE id=?", (pid,))
    return json.loads(r[0]) if r else None


def put_page(page):
    p = dict(page)
    old = get_page(p["id"]) if p.get("id") else None
    if old and (old.get("content") != p.get("content") or old.get("title") != p.get("title")):
        snapshot_page(old)
    p["id"] = p.get("id") or uid("pg")
    p["createdAt"] = p.get("createdAt") or now_iso()
    # Mốc sửa chính xác tới mili-giây và luôn khác bản trước: trình soạn dùng nó để phát hiện trang bị sửa ở nơi khác
    # (409), hai lần lưu trong cùng một giây vẫn phân biệt được.
    prev = (old or {}).get("updatedAt")
    p["updatedAt"] = now_iso_ms()
    while p["updatedAt"] == prev:
        time.sleep(0.002)
        p["updatedAt"] = now_iso_ms()
    db_run("INSERT OR REPLACE INTO pages (id, updatedAt, json) VALUES (?,?,?)", (p["id"], p["updatedAt"], json.dumps(p, ensure_ascii=False)))
    return p


# ---- inbox (extension gửi sang) ----

def inbox_add(item):
    box = kv_get("inbox", []) or []
    item = dict(item)
    item["id"] = uid("i")
    item["at"] = now_iso()
    box.insert(0, item)
    kv_set("inbox", box[:100])
    return item


def inbox_remove(iid):
    box = [x for x in (kv_get("inbox", []) or []) if x.get("id") != iid]
    kv_set("inbox", box)
    return len(box)


# ---- pdfs ----

# ---- ảnh của Sổ tay ----
# Nhận diện loại ảnh bằng chữ ký đầu file (không tin phần mở rộng hay content-type). Không nhận SVG: SVG chứa được
# script, mở thẳng đường dẫn ảnh trên cùng nguồn với app thì script chạy được.
IMG_SIGS = [(b"\x89PNG\r\n\x1a\n", "png", "image/png"), (b"\xff\xd8\xff", "jpg", "image/jpeg"), (b"GIF87a", "gif", "image/gif"),
            (b"GIF89a", "gif", "image/gif"), (b"BM", "bmp", "image/bmp")]
IMG_TYPES = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "bmp": "image/bmp"}
IMG_MAX = 20 * 1024 * 1024


def image_kind(data: bytes):
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    for sig, ext, _ in IMG_SIGS:
        if data.startswith(sig):
            return ext
    return None


def save_image(data: bytes, name: str):
    if not data:
        raise ValueError("File ảnh trống.")
    if len(data) > IMG_MAX:
        raise ValueError(f"Ảnh quá lớn ({len(data) // (1024 * 1024)} MB), tối đa {IMG_MAX // (1024 * 1024)} MB.")
    ext = image_kind(data)
    if not ext:
        raise ValueError("Chỉ nhận ảnh PNG, JPEG, GIF, WebP hoặc BMP.")
    digest = hashlib.sha1(data).hexdigest()[:16]  # cùng một ảnh dán nhiều lần chỉ lưu một bản
    fname = f"{digest}.{ext}"
    path = IMG_DIR / fname
    if not path.exists():
        IMG_DIR.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return {"id": fname, "url": f"/api/image/{fname}", "name": name, "size": len(data)}


def image_path(fname: str):
    if not re.fullmatch(r"[0-9a-f]{16}\.(png|jpg|gif|webp|bmp)", fname or ""):
        return None
    p = IMG_DIR / fname
    return p if p.exists() else None


def save_pdf(data: bytes, name: str):
    if data[:5] != b"%PDF-":
        raise ValueError("File không phải PDF hợp lệ.")
    pid = uid("f")
    (PDF_DIR / f"{pid}.pdf").write_bytes(data)
    db_run("INSERT INTO pdfs (id, name, size, createdAt) VALUES (?,?,?,?)", (pid, name or "paper.pdf", len(data), now_iso()))
    return {"id": pid, "name": name or "paper.pdf", "size": len(data)}


def pdf_path(pid):
    if not re.fullmatch(r"f_[0-9a-f]+_[0-9a-f]+", pid or ""):
        return None
    p = PDF_DIR / f"{pid}.pdf"
    return p if p.exists() else None


def delete_pdf(pid):
    p = pdf_path(pid)
    if p:
        try:
            p.unlink()
        except OSError:
            pass
    db_run("DELETE FROM pdfs WHERE id=?", (pid,))


# ----------------------------------------------------------------------------
# Tải nội dung từ mạng
# ----------------------------------------------------------------------------

BLOCKED_HOSTS = ("localhost", "127.", "0.0.0.0", "10.", "192.168.", "169.254.", "[::1]", "::1")


def http_get(url, timeout=40, max_bytes=40 * 1024 * 1024, headers=None):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Chỉ hỗ trợ http/https.")
    host = (parsed.hostname or "").lower()
    if not host or host.startswith(BLOCKED_HOSTS) or host.startswith("172.") and host.split(".")[1].isdigit() and 16 <= int(host.split(".")[1]) <= 31:
        raise ValueError("Không cho phép tải từ địa chỉ nội bộ.")
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "gzip", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        ctype = res.headers.get("Content-Type", "")
        raw = res.read(max_bytes + 1)
        if len(raw) > max_bytes:
            raise ValueError("Nội dung tải về vượt quá giới hạn 40MB.")
        if res.headers.get("Content-Encoding", "").lower() == "gzip":
            raw = gzip.decompress(raw)
        return res.status, ctype, raw, res.geturl()


def fetch_ics(url):
    """Tải một lịch .ics công khai / link bí mật (Google Calendar, Outlook…) cho tính năng Đăng ký lịch. Trả về văn bản."""
    url = str(url or "").strip()
    if url.lower().startswith("webcal://"):
        url = "https://" + url[9:]
    status, ctype, raw, _ = http_get(url, timeout=25, max_bytes=8 * 1024 * 1024, headers={"Accept": "text/calendar, text/plain, */*"})
    text = raw.decode("utf-8", errors="replace").lstrip("\ufeff")
    if "BEGIN:VCALENDAR" not in text[:4000].upper():
        raise ValueError("Link không trả về lịch .ics (cần link “Địa chỉ bí mật ở định dạng iCal” hoặc link .ics công khai).")
    return text


import zotero_import  # noqa: E402

# PDF mà lần quét Zotero gần nhất tìm thấy: chỉ những file này được chép vào app (không đọc file tuỳ ý theo đường dẫn).
ZOTERO_PDFS = set()


def zotero_scan(data_dir=""):
    dirs = zotero_import.candidate_dirs()
    d = (data_dir or "").strip().strip('"')
    if d:
        p = Path(d)
        if p.is_file() and p.name.lower().startswith("zotero.sqlite"):
            p = p.parent
        if not (p / "zotero.sqlite").exists():
            raise ValueError("Thư mục này không có zotero.sqlite. Trong Zotero: Edit → Settings → Advanced → Files and Folders → Data Directory Location.")
    elif dirs:
        p = dirs[0]
    else:
        return {"found": False, "candidates": []}
    lib = zotero_import.read_library(p)
    ZOTERO_PDFS.clear()
    for it in lib["items"]:
        ZOTERO_PDFS.update(it["pdfs"])
    return {"found": True, "candidates": [str(x) for x in dirs], **lib}


def zotero_pdf(path):
    if path not in ZOTERO_PDFS:
        raise ValueError("File không nằm trong lần quét Zotero gần nhất. Quét lại rồi thử.")
    data = Path(path).read_bytes()
    return save_pdf(data, Path(path).name)


import rankings as _rankings  # noqa: E402  (cần http_get đã khai báo)

RANK = _rankings.Rankings(bundled_dir=BUNDLE / "rankings", data_dir=DATA / "rankings", http_get=http_get)


def reclassify_all(force=False):
    n = 0
    for p in get_papers(include_deleted=True):
        before = json.dumps(p.get("venueInfo"), sort_keys=True)
        attach_venue(p, force=force and not (p.get("venueInfo") or {}).get("manual"))
        if json.dumps(p.get("venueInfo"), sort_keys=True) != before:
            db_run("UPDATE papers SET json=? WHERE id=?", (json.dumps(p, ensure_ascii=False), p["id"]))
            n += 1
    return n


# ---- dịch nhanh (Google miễn phí, không cần key), kế thừa extension "Dịch Khi Bôi Đen" ----
# Máy chủ gọi thay trình duyệt để không vướng CORS. Ba nguồn thử lần lượt: endpoint từ điển của Chrome
# (nhận nhiều q trong một lượt, có nhận diện ngôn ngữ), client gtx, rồi MyMemory.

TR_CACHE = {}
TR_CACHE_LIMIT = 2000
TR_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"}
TR_SCRIPTS = (("ja", r"[぀-ヿ]"), ("ko", r"[가-힯]"), ("zh-CN", r"[一-鿿]"), ("ru", r"[Ѐ-ӿ]"),
              ("vi", r"[ăâđêôơưĂÂĐÊÔƠƯạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]"))


def _tr_json(url, timeout=6):
    _, _, raw, _ = http_get(url, timeout=timeout, max_bytes=4 * 1024 * 1024, headers=TR_UA)
    return json.loads(raw.decode("utf-8", errors="replace"))


def _tr_flatten(v):
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        return "".join(_tr_flatten(x) for x in v)
    return ""


def _tr_guess_lang(text):
    for lang, pat in TR_SCRIPTS:
        if re.search(pat, text):
            return lang
    return "en"


def _tr_dict_batch(texts, sl, tl):
    """Endpoint từ điển của Chrome: nhiều q một lượt. sl=auto -> mỗi phần tử [chữ, ngôn ngữ], sl cụ thể -> chuỗi."""
    base = "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=%s&tl=%s&" % (urllib.parse.quote(sl), urllib.parse.quote(tl))
    out, chunk, size = [], [], 0
    groups = []
    for t in texts:  # chia nhóm để URL không quá dài
        q = "q=" + urllib.parse.quote(t)
        if chunk and size + len(q) > 7000:
            groups.append(chunk)
            chunk, size = [], 0
        chunk.append(q)
        size += len(q) + 1
    if chunk:
        groups.append(chunk)
    for g in groups:
        data = _tr_json(base + "&".join(g))
        if not isinstance(data, list) or len(data) != len(g):
            raise ValueError("Phản hồi dịch không hợp lệ")
        for item in data:
            if isinstance(item, list):
                out.append({"translated": _tr_flatten(item[0]), "detected": (item[1] if len(item) > 1 and isinstance(item[1], str) else sl)})
            else:
                out.append({"translated": _tr_flatten(item), "detected": sl})
    return out


def _tr_single(text, sl, tl):
    try:
        data = _tr_json("https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=%s&tl=%s&q=%s"
                        % (urllib.parse.quote(sl), urllib.parse.quote(tl), urllib.parse.quote(text)))
        tr = "".join(seg[0] for seg in (data[0] or []) if seg and isinstance(seg[0], str))
        if tr:
            return {"translated": tr, "detected": data[2] if len(data) > 2 and isinstance(data[2], str) else sl, "engine": "Google"}
    except Exception:
        pass
    src = _tr_guess_lang(text) if sl == "auto" else sl
    if src == tl:
        return {"translated": text, "detected": src, "engine": "-"}
    data = _tr_json("https://api.mymemory.translated.net/get?q=%s&langpair=%s" % (urllib.parse.quote(text[:500]), urllib.parse.quote(src + "|" + tl)))
    return {"translated": (data.get("responseData") or {}).get("translatedText") or "", "detected": src, "engine": "MyMemory"}


def translate_batch(texts, sl="auto", tl="vi"):
    texts = [re.sub(r"\s+", " ", str(t or "")).strip()[:4500] for t in (texts or [])][:200]
    if not texts:
        return {"items": [], "engine": "-"}
    key = lambda t: f"{sl}|{tl}|{t}"  # noqa: E731
    todo = [t for t in dict.fromkeys(texts) if t and key(t) not in TR_CACHE]
    engine = "Google"
    if todo:
        try:
            rows = _tr_dict_batch(todo, sl, tl)
        except Exception:
            rows, engine = [], ""
            for t in todo:
                try:
                    r = _tr_single(t, sl, tl)
                except Exception as e:  # noqa: BLE001
                    raise ValueError(f"Không kết nối được dịch vụ dịch: {e}")
                engine = engine or r.get("engine", "")
                rows.append(r)
        for t, r in zip(todo, rows):
            if len(TR_CACHE) >= TR_CACHE_LIMIT:
                TR_CACHE.pop(next(iter(TR_CACHE)))
            TR_CACHE[key(t)] = {"translated": r.get("translated", ""), "detected": r.get("detected", sl)}
    items = [TR_CACHE.get(key(t), {"translated": "", "detected": sl}) for t in texts]
    return {"items": items, "engine": engine}


def http_post_json(url, payload, timeout=40, headers=None):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"User-Agent": UA, "Content-Type": "application/json", "Accept": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8", errors="replace"))


def arxiv_search(keywords, cats, max_results=50):
    """Tìm paper mới trên arXiv API: (từ khoá OR) AND (danh mục OR), mới nhất trước."""
    parts = []
    kws = [k.strip() for k in (keywords or []) if k.strip()]
    if kws:
        parts.append("(" + " OR ".join(f'all:"{k}"' if " " in k else f"all:{k}" for k in kws) + ")")
    cs = [c.strip() for c in (cats or []) if c.strip()]
    if cs:
        parts.append("(" + " OR ".join(f"cat:{c}" for c in cs) + ")")
    if not parts:
        raise ValueError("Cần ít nhất một từ khoá hoặc một danh mục arXiv.")
    query = " AND ".join(parts)
    url = ("https://export.arxiv.org/api/query?search_query=" + urllib.parse.quote(query)
           + f"&sortBy=submittedDate&sortOrder=descending&max_results={int(max_results)}")
    raw = None
    for attempt in range(3):  # arXiv API giới hạn ~1 request / 3 giây, trả 429 khi gọi dồn
        try:
            _, ctype, raw, _ = http_get(url, timeout=40)
            break
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 2:
                raise ValueError(f"arXiv API: HTTP {e.code}")
            time.sleep(6)
    root = ET.fromstring(raw)
    ns = {"a": "http://www.w3.org/2005/Atom", "ar": "http://arxiv.org/schemas/atom"}
    out = []
    for e in root.findall("a:entry", ns):
        idurl = e.findtext("a:id", "", ns)
        m = ARXIV_RE.search(idurl.split("/abs/")[-1]) if idurl else None
        aid = re.sub(r"v\d+$", "", m.group(1)) if m else ""
        out.append({
            "arxivId": aid,
            "title": re.sub(r"\s+", " ", e.findtext("a:title", "", ns)).strip(),
            "abstract": re.sub(r"\s+", " ", e.findtext("a:summary", "", ns)).strip(),
            "authors": ", ".join(a.findtext("a:name", "", ns) for a in e.findall("a:author", ns)[:6]),
            "published": (e.findtext("a:published", "", ns) or "")[:10],
            "cats": [c.get("term") for c in e.findall("a:category", ns)],
            "url": f"https://arxiv.org/abs/{aid}" if aid else idurl,
            "pdfUrl": f"https://arxiv.org/pdf/{aid}" if aid else "",
        })
    return out


def s2_refresh_citations(papers, s2_key=""):
    """Cập nhật citationCount cho nhiều paper bằng S2 batch API. Trả về số paper cập nhật."""
    ident_of = {}
    for p in papers:
        ident = p.get("s2Id") or (f"ARXIV:{re.sub(r'v\d+$', '', p['arxivId'])}" if p.get("arxivId") else (f"DOI:{p['doi']}" if p.get("doi") else ""))
        if ident:
            ident_of[ident] = p
    ids = list(ident_of.keys())
    headers = {"x-api-key": s2_key} if s2_key else {}
    updated = 0
    for i in range(0, len(ids), 100):
        chunk = ids[i:i + 100]
        try:
            _s2_pace()
            res = http_post_json("https://api.semanticscholar.org/graph/v1/paper/batch?fields=citationCount,paperId,externalIds",
                                 {"ids": chunk}, timeout=40, headers=headers)
        except Exception as e:
            raise ValueError(f"Semantic Scholar: {e}")
        for ident, d in zip(chunk, res or []):
            if not d:
                continue
            p = ident_of[ident]
            p["citationCount"] = d.get("citationCount")
            p["s2Id"] = d.get("paperId") or p.get("s2Id")
            p["citationUpdatedAt"] = now_iso()
            put_paper(p)
            updated += 1
        if i + 100 < len(ids):
            time.sleep(1.2)
    kv_set("lastCitationRefresh", now_iso())
    return updated


def bytes_to_text(raw, ctype):
    m = re.search(r"charset=([\w-]+)", ctype or "", re.I)
    enc = m.group(1) if m else "utf-8"
    try:
        return raw.decode(enc, errors="replace")
    except LookupError:
        return raw.decode("utf-8", errors="replace")


def html_to_text(src):
    s = re.sub(r"<script[\s\S]*?</script>", " ", src, flags=re.I)
    s = re.sub(r"<style[\s\S]*?</style>", " ", s, flags=re.I)
    s = re.sub(r"<noscript[\s\S]*?</noscript>", " ", s, flags=re.I)
    s = re.sub(r"<(br|/p|/div|/h[1-6]|/li|/tr|/section|/table)[^>]*>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    s = s.replace("\xa0", " ")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r" *\n *", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def html_main_text(src):
    """Ưu tiên nội dung trong <article>/<main>, giống scrape.js của extension."""
    for tag in ("article", "main"):
        m = re.search(rf"<{tag}[\s>][\s\S]*?</{tag}>", src, flags=re.I)
        if m:
            t = html_to_text(m.group(0))
            if len(t) > 1500:
                return t
    return html_to_text(src)


def _meta_tags(src):
    """Đọc mọi thẻ <meta> thành danh sách (tên, nội dung), chịu được thứ tự thuộc tính bất kỳ và thuộc tính không có dấu nháy."""
    out = []
    for tag in re.findall(r"<meta\b[^>]*>", src, re.I):
        attrs = {}
        for m in re.finditer(r"""([a-zA-Z_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))""", tag):
            attrs[m.group(1).lower()] = m.group(2) if m.group(2) is not None else (m.group(3) if m.group(3) is not None else m.group(4))
        key = (attrs.get("name") or attrs.get("property") or "").lower()
        if key and "content" in attrs:
            out.append((key, html.unescape(attrs["content"]).strip()))
    return out


def meta_of(src, name):
    name = name.lower()
    for k, v in _meta_tags(src):
        if k == name and v:
            return v
    return ""


def meta_all(src, name):
    name = name.lower()
    return [v for k, v in _meta_tags(src) if k == name and v]


def openalex_venue(title):
    """Tìm bản đã xuất bản của một paper trên OpenAlex theo tiêu đề. Trả về {venue, doi, kind} hoặc None."""
    try:
        _, _, raw, _ = http_get("https://api.openalex.org/works?search=" + urllib.parse.quote(re.sub(r"[?*:]", " ", title))
                                + "&per-page=8&select=title,doi,type,primary_location,locations", timeout=20)
    except Exception:
        return None
    for w in json.loads(raw.decode("utf-8")).get("results", []):
        if _title_sim(w.get("title"), title) < 0.9:
            continue
        locs = [w.get("primary_location") or {}] + (w.get("locations") or [])
        for loc in locs:
            src = loc.get("source") or {}
            if src.get("type") in ("conference", "journal", "book series") and src.get("display_name"):
                doi = (w.get("doi") or "").replace("https://doi.org/", "")
                return {"venue": src["display_name"], "kind": src["type"], "doi": "" if "arxiv" in doi.lower() else doi}
    return None


ARXIV_RE = re.compile(r"(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?/\d{7}(?:v\d+)?)", re.I)


def parse_arxiv_id(s):
    s = s.strip()
    m = re.search(r"arxiv\.org/(?:abs|pdf|html)/([^\s?#]+)", s, re.I)
    if m:
        cand = m.group(1).replace(".pdf", "")
        mm = ARXIV_RE.search(cand)
        return mm.group(1) if mm else None
    m = re.fullmatch(r"(?:arxiv:)?" + ARXIV_RE.pattern, s, re.I)
    return m.group(1) if m else None


def parse_doi(s):
    m = re.search(r"(10\.\d{4,9}/[^\s\"<>]+)", s.strip(), re.I)
    return m.group(1).rstrip(".,;)") if m else None


def fetch_arxiv(arxiv_id):
    """Metadata từ arXiv API + full text HTML nếu có."""
    id_nov = re.sub(r"v\d+$", "", arxiv_id)
    out = {"arxivId": arxiv_id, "url": f"https://arxiv.org/abs/{id_nov}", "pdfUrl": f"https://arxiv.org/pdf/{id_nov}",
           "title": "", "authors": "", "venue": "arXiv preprint", "year": "", "abstract": "", "text": "", "kind": "", "warnings": []}
    try:
        _, ctype, raw, _ = http_get(f"https://export.arxiv.org/api/query?id_list={urllib.parse.quote(id_nov)}", timeout=15)
        root = ET.fromstring(raw)
        ns = {"a": "http://www.w3.org/2005/Atom", "ar": "http://arxiv.org/schemas/atom"}
        entry = root.find("a:entry", ns)
        if entry is not None and entry.find("a:title", ns) is not None:
            out["title"] = re.sub(r"\s+", " ", entry.findtext("a:title", "", ns)).strip()
            out["abstract"] = re.sub(r"\s+", " ", entry.findtext("a:summary", "", ns)).strip()
            out["authors"] = ", ".join(a.findtext("a:name", "", ns) for a in entry.findall("a:author", ns)[:8])
            out["year"] = (entry.findtext("a:published", "", ns) or "")[:4]
            jref = entry.findtext("ar:journal_ref", "", ns)
            comment = entry.findtext("ar:comment", "", ns)
            if jref:
                out["venue"] = jref
            elif comment:
                out["venue"] = f"arXiv preprint ({comment[:80]})"
    except Exception as e:
        out["warnings"].append(f"arXiv API: {e}")

    try:
        st, ctype, raw, _ = http_get(f"https://arxiv.org/html/{arxiv_id}", timeout=40)
        src = bytes_to_text(raw, ctype)
        if st == 200 and not re.search(r"no html|not available|conversion (failed|is not available)", src[:1500], re.I):
            body = html_main_text(src)
            if len(body) > 3000:
                out["text"] = body
                out["kind"] = "full text (arXiv HTML)"
                if not out["title"]:
                    h1 = re.search(r"<h1[^>]*class=\"[^\"]*ltx_title_document[^\"]*\"[^>]*>([\s\S]*?)</h1>", src, re.I)
                    out["title"] = html_to_text(h1.group(1)) if h1 else (meta_of(src, "citation_title") or "")
                if not out["authors"]:
                    out["authors"] = ", ".join(meta_all(src, "citation_author")[:8])
    except Exception as e:
        out["warnings"].append(f"arXiv HTML: {e}")

    # arXiv API chậm/lỗi và HTML không có tiêu đề -> đọc trang abstract như extension làm
    if not out["title"] or not out["abstract"]:
        try:
            _, ctype, raw, _ = http_get(f"https://arxiv.org/abs/{id_nov}", timeout=30)
            page = bytes_to_text(raw, ctype)
            title = html_to_text(re.search(r'<h1 class="title[^"]*">([\s\S]*?)</h1>', page, re.I).group(1)) if re.search(r'<h1 class="title', page, re.I) else ""
            abs_ = html_to_text(re.search(r'<blockquote class="abstract[^"]*">([\s\S]*?)</blockquote>', page, re.I).group(1)) if re.search(r'<blockquote class="abstract', page, re.I) else ""
            authors = html_to_text(re.search(r'<div class="authors">([\s\S]*?)</div>', page, re.I).group(1)) if re.search(r'<div class="authors">', page, re.I) else ""
            out["title"] = out["title"] or re.sub(r"^\s*Title:\s*", "", title, flags=re.I).strip()
            out["abstract"] = out["abstract"] or re.sub(r"^\s*Abstract:\s*", "", abs_, flags=re.I).strip()
            out["authors"] = out["authors"] or re.sub(r"^\s*Authors:\s*", "", authors, flags=re.I).strip()
            if not out["year"]:
                m = re.search(r"\[Submitted on [^\]]*?(\d{4})\]", page)
                out["year"] = m.group(1) if m else ""
        except Exception as e:
            out["warnings"].append(f"arXiv abs: {e}")

    if not out["text"]:
        if out["abstract"]:
            out["text"] = f"Title: {out['title']}\nAuthors: {out['authors']}\n\nAbstract:\n{out['abstract']}"
            out["kind"] = "abstract (arXiv)"
        else:
            raise ValueError("Không lấy được thông tin từ arXiv cho ID " + arxiv_id)
    return out


BOT_PAGE_RE = re.compile(r"verifying your browser|just a moment\.\.\.|attention required|checking your browser|enable javascript and cookies|access denied|captcha", re.I)


# Semantic Scholar cấp key mặc định 1 request mỗi giây, tính chung mọi endpoint. App hay gọi dồn (danh sách bài dẫn,
# TLDR, liên kết đồ thị liền nhau) nên mọi lượt gọi đi qua một cửa giãn nhịp chung cho mọi luồng.
_S2_LOCK = threading.Lock()
_S2_LAST = [0.0]
S2_MIN_GAP = 1.15


def _s2_pace():
    with _S2_LOCK:
        wait = _S2_LAST[0] + S2_MIN_GAP - time.time()
        if wait > 0:
            time.sleep(wait)
        _S2_LAST[0] = time.time()


def s2_get(url, headers=None, timeout=25):
    """Gọi Semantic Scholar, chờ rồi thử lại khi bị giới hạn tốc độ (429). Không có API key thì giới hạn dùng chung rất chặt."""
    delays = [2.0, 5.0, 10.0]
    for attempt in range(len(delays) + 1):
        _s2_pace()
        try:
            return http_get(url, timeout=timeout, headers=headers)
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == len(delays):
                if e.code == 429:
                    raise ValueError("Semantic Scholar đang giới hạn tốc độ (429). Thêm S2 API key trong Cài đặt hoặc thử lại sau ít phút.")
                raise
            time.sleep(delays[attempt])


def _title_sim(a, b):
    ta = {w for w in re.findall(r"[a-z0-9]+", (a or "").lower()) if len(w) > 2}
    tb = {w for w in re.findall(r"[a-z0-9]+", (b or "").lower()) if len(w) > 2}
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / max(len(ta), len(tb))


def find_by_title(title, s2_key=""):
    """Tìm paper theo tiêu đề: Semantic Scholar trước, OpenAlex dự phòng. Trả về {query, title, score, source} hoặc None."""
    title = (title or "").strip()
    if not title:
        return None
    errors = []
    try:
        fields = "title,externalIds,url,venue,year"
        _, _, raw, _ = s2_get(f"https://api.semanticscholar.org/graph/v1/paper/search?query={urllib.parse.quote(title)}&fields={fields}&limit=5",
                              headers={"x-api-key": s2_key} if s2_key else {})
        best = max(json.loads(raw.decode("utf-8")).get("data", []) or [{}], key=lambda d: _title_sim(d.get("title"), title))
        sc = _title_sim(best.get("title"), title)
        if sc >= 0.75:
            ext = best.get("externalIds") or {}
            q = ext.get("ArXiv") or ext.get("DOI")  # link trang Semantic Scholar không tra cứu tiếp được
            if q:
                return {"query": q, "title": best.get("title"), "score": round(sc, 2), "source": "Semantic Scholar"}
    except Exception as e:
        errors.append(str(e))
    try:
        _, _, raw, _ = http_get("https://api.openalex.org/works?search=" + urllib.parse.quote(re.sub(r"[?*:]", " ", title))
                                + "&per-page=6&select=title,doi,type,primary_location,publication_year", timeout=25)
        results = json.loads(raw.decode("utf-8")).get("results", [])
        scored = sorted(((_title_sim(w.get("title"), title), w) for w in results), key=lambda x: (-x[0], x[1].get("type") == "preprint"))
        for sc, w in scored:
            if sc < 0.75:
                break
            doi = (w.get("doi") or "").replace("https://doi.org/", "")
            m = re.match(r"10\.48550/arxiv\.(.+)$", doi, re.I)
            q = m.group(1) if m else doi
            if q:
                return {"query": q, "title": w.get("title"), "score": round(sc, 2), "source": "OpenAlex"}
    except Exception as e:
        errors.append(f"OpenAlex: {e}")
    if errors:
        raise ValueError("Không tìm được theo tiêu đề. " + " · ".join(errors))
    return None


# ---- câu trích dẫn (citation contexts) từ Semantic Scholar ----
# Tác giả đã viết sẵn họ lấy gì từ mỗi bài được dẫn, ngay tại chỗ trích dẫn. S2 phát miễn phí nguyên văn các câu đó
# (contexts) và cờ isInfluential, nên không cần đọc từng bài tham khảo. Lưu đệm 7 ngày vì S2 giới hạn tốc độ rất chặt.

S2_EDGE_MAX = 5000  # số bài dẫn / tham khảo tối đa lấy về cho một paper (nhiều trang 1000 bài)
S2_TLDR_TTL = 30 * 24 * 3600


def s2_tldrs(paper_ids, s2_key=""):
    """TLDR một câu (model SciTLDR của Semantic Scholar) cho nhiều paper, bằng MỘT request batch.
    Các endpoint danh sách không trả tldr nên phải hỏi riêng. Lưu đệm từng bài 30 ngày (kể cả bài chưa có TLDR,
    để khỏi hỏi lại mãi). Lỗi mạng hay bị giới hạn tốc độ thì trả về những gì đã có, không làm hỏng danh sách."""
    ids = [i for i in dict.fromkeys(paper_ids or []) if i]
    out, missing = {}, []
    now = time.time()
    for i in ids:
        c = kv_get(f"s2tldr:{i}")
        if c and now - c.get("at", 0) < S2_TLDR_TTL:
            if c.get("t"):
                out[i] = c["t"]
        else:
            missing.append(i)
    if missing:
        headers = {"x-api-key": s2_key} if s2_key else {}
        try:
            for start in range(0, len(missing), 400):
                chunk = missing[start:start + 400]
                req = urllib.request.Request("https://api.semanticscholar.org/graph/v1/paper/batch?fields=tldr",
                                             data=json.dumps({"ids": chunk}).encode("utf-8"),
                                             headers={**headers, "Content-Type": "application/json", "User-Agent": UA}, method="POST")
                for attempt in range(2):  # không có key thì hay dính 429 ngay sau request danh sách: chờ rồi thử lại một lần
                    try:
                        _s2_pace()
                        with urllib.request.urlopen(req, timeout=25) as r:
                            rows = json.loads(r.read().decode("utf-8"))
                        break
                    except urllib.error.HTTPError as e:
                        if e.code != 429 or attempt:
                            raise
                        time.sleep(2.5)
                for pid, row in zip(chunk, rows):
                    text = ((row or {}).get("tldr") or {}).get("text") or ""
                    kv_set(f"s2tldr:{pid}", {"at": now, "t": text})
                    if text:
                        out[pid] = text
        except Exception:
            pass
    return out


S2_GRAPH_TTL = 7 * 24 * 3600


def _s2_batch(ids, fields, s2_key=""):
    """POST /paper/batch theo từng nhóm 400 mã, thử lại một lần khi bị 429. Trả về list cùng thứ tự (None nếu không có)."""
    headers = {"x-api-key": s2_key} if s2_key else {}
    out = []
    for start in range(0, len(ids), 400):
        chunk = ids[start:start + 400]
        req = urllib.request.Request(f"https://api.semanticscholar.org/graph/v1/paper/batch?fields={fields}",
                                     data=json.dumps({"ids": chunk}).encode("utf-8"),
                                     headers={**headers, "Content-Type": "application/json", "User-Agent": UA}, method="POST")
        for attempt in range(4):
            try:
                _s2_pace()
                with urllib.request.urlopen(req, timeout=60) as r:
                    out.extend(json.loads(r.read().decode("utf-8")))
                break
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt == 3:
                    raise ValueError("Semantic Scholar đang giới hạn tốc độ (429). Thử lại sau ít phút, hoặc thêm S2 API key trong Cài đặt.")
                if e.code != 429:
                    raise
                time.sleep(4 * (attempt + 1))
    return out


def _graph_ranks(data):
    """Gắn hạng venue (CORE A*..C, SJR Q1..Q4) cho từng bài trong đồ thị bằng bảng xếp hạng có sẵn của app.
    Tính lúc trả về (không lưu đệm) nên bảng xếp hạng cập nhật là đồ thị cũ cũng có hạng mới."""
    memo = {}
    for n in data.get("nodes") or []:
        v = (n.get("venue") or "").strip()
        key = (v, bool(n.get("arxiv")))
        if key not in memo:
            try:
                vi = RANK.classify([v], {}, bool(n.get("arxiv"))) if v or n.get("arxiv") else {"type": "unknown"}
            except Exception:
                vi = {"type": "unknown"}
            rank = vi.get("rank") if vi.get("rank") and not vi.get("parent") else (vi.get("quartile") or "")
            memo[key] = {"rank": rank or "", "venueType": vi.get("type") or "unknown", "venueShort": vi.get("acronym") or ""}
        n.update(memo[key])
    return data


def _graph_similarity(node_refs, cid, center_refs, top_k=8):
    """Độ tương đồng giữa các bài trong đồ thị, theo cách Connected Papers: hai bài giống nhau khi
    (1) dẫn nhiều bài chung (bibliographic coupling) và (2) hay được cùng một bài dẫn (co-citation), cộng thêm khi một bài
    dẫn trực tiếp bài kia. Trả về (cạnh tương đồng top_k mỗi bài, điểm tương đồng của từng bài với bài gốc,
    số bài trong đồ thị dẫn mỗi bài, số bài trong đồ thị mà mỗi bài dẫn)."""
    from collections import defaultdict
    refs = {pid: set(rs) for pid, rs in node_refs.items()}
    refs[cid] = set(center_refs)
    ids = set(refs)
    inv = defaultdict(list)
    for pid, rs in refs.items():
        for r in rs:
            inv[r].append(pid)
    bc = defaultdict(int)
    for r, ps in inv.items():
        if 2 <= len(ps) <= 250:
            ps = sorted(ps)
            for i in range(len(ps)):
                for j in range(i + 1, len(ps)):
                    bc[(ps[i], ps[j])] += 1
    cc = defaultdict(int)
    cited_in = defaultdict(int)  # số bài trong đồ thị dẫn bài này
    cites_in = {}                # số bài trong đồ thị mà bài này dẫn
    for citer, rs in refs.items():
        inside = sorted(r for r in rs if r in ids and r != citer)
        cites_in[citer] = len(inside)
        for r in inside:
            cited_in[r] += 1
        inside = inside[:400]
        for i in range(len(inside)):
            for j in range(i + 1, len(inside)):
                cc[(inside[i], inside[j])] += 1
    score = defaultdict(float)
    for (a, b), n in bc.items():
        la, lb = len(refs[a]), len(refs[b])
        if la and lb:
            score[(a, b)] += n / ((la * lb) ** 0.5)
    for (a, b), n in cc.items():
        ca, cb = cited_in.get(a, 0), cited_in.get(b, 0)
        if ca and cb:
            score[(a, b)] += n / ((ca * cb) ** 0.5)
    for a, rs in refs.items():
        for b in rs:
            if b in ids and b != a:
                k = (a, b) if a < b else (b, a)
                score[k] += 0.25
    best = defaultdict(list)
    to_seed = {}
    for (a, b), w in score.items():
        if a == cid:
            to_seed[b] = w
        elif b == cid:
            to_seed[a] = w
        best[a].append((w, b))
        best[b].append((w, a))
    keep = {}
    for a, lst in best.items():
        for w, b in sorted(lst, reverse=True)[:top_k]:
            k = (a, b) if a < b else (b, a)
            keep[k] = w
    sim = [{"a": a, "b": b, "w": round(w, 4)} for (a, b), w in keep.items() if w >= 0.02]
    return sim, {k: round(v, 4) for k, v in to_seed.items()}, dict(cited_in), cites_in


def s2_graph(ident, s2_key="", refresh=False, cits=100, hop2=False, min_shared=3):
    """Đồ thị trích dẫn quanh một paper: bài gốc, các bài nó dẫn, các bài dẫn nó, và cạnh GIỮA các bài đó với nhau
    (bài A trong đồ thị dẫn bài B trong đồ thị). Cạnh nội bộ lấy bằng MỘT request batch đọc danh sách tham khảo của mọi
    bài, thay vì gọi riêng từng bài. Lưu đệm 7 ngày."""
    cits = max(10, min(S2_EDGE_MAX, int(cits or 100)))
    min_shared = max(2, min(20, int(min_shared or 3)))
    cache_key = f"s2graph2:{ident}" + ("" if cits == 100 and not hop2 else f":{cits}:{int(bool(hop2))}:{min_shared}")  # v2: thêm độ tương đồng
    cached = kv_get(cache_key)
    if cached and not refresh and time.time() - cached.get("at", 0) < S2_GRAPH_TTL:
        return _graph_ranks({**cached["data"], "cachedAt": cached["at"]})
    refs = s2_edges(ident, "references", s2_key, refresh)["items"]
    cit_items = s2_edges(ident, "citations", s2_key, refresh, limit=cits)["items"]
    center = (_s2_batch([ident], "paperId,title,year,publicationDate,citationCount,venue,authors,externalIds,url,references.paperId", s2_key) or [None])[0] or {}
    cid = center.get("paperId") or "center"
    nodes = {}

    def add(p, kind):
        pid = p.get("paperId")
        if not pid or pid == cid:
            return
        n = nodes.get(pid)
        if n:
            if n["kind"] != kind:
                n["kind"] = "both"
            n["influential"] = n["influential"] or bool(p.get("_influential"))
            return
        ext = p.get("externalIds") or {}
        nodes[pid] = {
            "id": pid, "title": p.get("title") or "", "year": p.get("year"), "date": p.get("publicationDate") or "",
            "citations": p.get("citationCount") or 0, "venue": p.get("venue") or "",
            "authors": ", ".join(a.get("name", "") for a in (p.get("authors") or [])[:4]),
            "arxiv": ext.get("ArXiv") or "", "doi": ext.get("DOI") or "", "url": p.get("url") or "",
            "kind": kind, "influential": bool(p.get("_influential")),
            "contexts": (p.get("_contexts") or [])[:2], "intents": p.get("_intents") or [],
            "tldr": p.get("tldr") or "", "abstract": (p.get("abstract") or "")[:300],
        }

    for p in refs:
        add(p, "ref")
    for p in cit_items:
        add(p, "cit")
    links = [{"source": cid, "target": pid, "kind": "ref"} for pid, n in nodes.items() if n["kind"] in ("ref", "both")]
    links += [{"source": pid, "target": cid, "kind": "cit"} for pid, n in nodes.items() if n["kind"] in ("cit", "both")]
    inner = 0
    inner_failed = False
    shared = {}  # bài ngoài đồ thị -> các bài trong đồ thị cùng dẫn nó
    node_refs = {}  # bài trong đồ thị -> mọi bài nó dẫn (cả ngoài đồ thị), để tính độ tương đồng
    try:
        rows = _s2_batch(list(nodes), "references.paperId", s2_key)
        for pid, row in zip(list(nodes), rows):
            node_refs[pid] = [r.get("paperId") for r in ((row or {}).get("references") or []) if r.get("paperId")]
            for r in ((row or {}).get("references") or []):
                tid = r.get("paperId")
                if tid and tid in nodes and tid != pid:
                    links.append({"source": pid, "target": tid, "kind": "inner"})
                    inner += 1
                elif tid and tid != cid and tid not in nodes:
                    shared.setdefault(tid, []).append(pid)
    except Exception:
        inner_failed = True  # vẫn vẽ đồ thị hình sao quanh bài gốc, nhưng không lưu đệm để lần sau lấy lại
    # Bậc hai: bài nền chung, tức bài nằm ngoài đồ thị nhưng được nhiều bài trong đồ thị cùng dẫn. Thường là công trình
    # nền tảng của cả hướng nghiên cứu mà bài gốc không trực tiếp dẫn. Lấy tối đa 120 bài được dẫn chung nhiều nhất.
    hop2_count = 0
    if hop2 and not inner_failed and shared:
        top = sorted(((k, v) for k, v in shared.items() if len(v) >= min_shared), key=lambda kv: -len(kv[1]))[:120]
        if top:
            try:
                meta = _s2_batch([k for k, _ in top], "paperId,title,year,publicationDate,citationCount,venue,authors,externalIds,url,tldr", s2_key)
                for (tid, citers), m in zip(top, meta):
                    if not m or not m.get("title"):
                        continue
                    m = {**m, "tldr": ((m.get("tldr") or {}).get("text") if isinstance(m.get("tldr"), dict) else m.get("tldr")) or ""}
                    add(m, "hop2")
                    nodes[tid]["shared"] = len(citers)
                    for src in citers:
                        links.append({"source": src, "target": tid, "kind": "hop2"})
                    hop2_count += 1
            except Exception:
                pass
    sim, sim_seed, cited_in, cites_in = [], {}, {}, {}
    if not inner_failed:
        try:
            center_refs = [r.get("paperId") for r in (center.get("references") or []) if r.get("paperId")]
            center_refs = list(set(center_refs) | {pid for pid, n in nodes.items() if n["kind"] in ("ref", "both")})
            sim, sim_seed, cited_in, cites_in = _graph_similarity(node_refs, cid, center_refs)
        except Exception:
            sim = []
    for pid, n in nodes.items():
        n["simSeed"] = sim_seed.get(pid, 0)
        n["inG"] = cited_in.get(pid, 0)
        n["outG"] = cites_in.get(pid, 0)
    cext = center.get("externalIds") or {}
    data = {
        "center": {"id": cid, "title": center.get("title") or "", "year": center.get("year"), "citations": center.get("citationCount") or 0,
                   "authors": ", ".join(a.get("name", "") for a in (center.get("authors") or [])[:4]), "date": center.get("publicationDate") or "",
                   "venue": center.get("venue") or "", "arxiv": cext.get("ArXiv") or "", "doi": cext.get("DOI") or "", "url": center.get("url") or ""},
        "nodes": list(nodes.values()), "links": links, "sim": sim,
        "stats": {"refs": len(refs), "cits": len(cit_items), "inner": inner, "hop2": hop2_count, "citsLimit": cits}, "innerFailed": inner_failed,
    }
    if not inner_failed:
        kv_set(cache_key, {"at": time.time(), "data": data})
    return _graph_ranks({**data, "cachedAt": time.time()})


def s2_add_tldr(items, s2_key=""):
    tl = s2_tldrs([x.get("paperId") for x in items], s2_key)
    for x in items:
        if tl.get(x.get("paperId")):
            x["tldr"] = tl[x["paperId"]]
    return items


def s2_edges(ident, kind, s2_key="", refresh=False, limit=None, max_age=0):
    """kind = 'references' (bài này dẫn ai, nói gì về họ) | 'citations' (ai dẫn bài này, nói gì về nó).
    Trả về {items: [paper + _contexts/_intents/_influential], total, withContext, influential, cachedAt}."""
    default_limit = 300 if kind == "references" else 100
    limit = max(10, min(S2_EDGE_MAX, int(limit or default_limit)))  # trên 1000 bài thì lấy theo nhiều trang
    cache_key = f"s2edge2:{kind}:{ident}" + (f":{limit}" if limit != default_limit else "")  # v2: thêm ngày đăng và TLDR
    cached = kv_get(cache_key)
    # Kết quả khám phá được giữ tới khi người dùng bấm làm mới (refresh); Theo dõi paper mới luôn lấy mới.
    # max_age (giây, 0 = không giới hạn): bản đã lưu cũ hơn ngưỡng người dùng đặt thì tự lấy lại.
    if cached and max_age and time.time() - cached.get("at", 0) > max_age:
        refresh = True
    if cached and not refresh:
        data = cached["data"]
        lacking = [x for x in data["items"] if not x.get("tldr")]
        if lacking:  # lần trước bị giới hạn tốc độ nên thiếu TLDR: bổ sung (bài đã hỏi rồi thì lấy từ bộ đệm, không gọi lại)
            s2_add_tldr(lacking, s2_key)
        return {**data, "cachedAt": cached["at"]}
    headers = {"x-api-key": s2_key} if s2_key else {}
    fields = "contexts,intents,isInfluential,title,abstract,authors,year,publicationDate,venue,citationCount,externalIds,url,openAccessPdf"
    # Semantic Scholar trả tối đa 1000 bài mỗi request: lấy theo trang (offset) cho tới đủ số bài hoặc hết bài.
    rows = []
    try:
        offset = 0
        while offset < limit:
            page = min(1000, limit - offset)
            url = f"https://api.semanticscholar.org/graph/v1/paper/{urllib.parse.quote(ident, safe=':')}/{kind}?fields={fields}&limit={page}&offset={offset}"
            _, _, raw, _ = s2_get(url, headers=headers, timeout=60 if page > 300 else 25)
            body = json.loads(raw.decode("utf-8"))
            got = body.get("data", []) or []
            rows.extend(got)
            if len(got) < page or body.get("next") is None:
                break
            offset += page
    except Exception:
        if cached:  # S2 lỗi / giới hạn tốc độ: dùng tạm bản đệm cũ còn hơn không có gì
            return {**cached["data"], "cachedAt": cached["at"], "stale": True}
        if not rows:
            raise
    edge_key = "citingPaper" if kind == "citations" else "citedPaper"
    items = []
    for it in rows:
        paper = it.get(edge_key) or {}
        if not paper.get("title"):
            continue
        contexts = []
        for c in it.get("contexts") or []:
            c = re.sub(r"\s+", " ", c or "").strip()
            if len(c) > 30 and c not in contexts:
                contexts.append(c[:600])
        paper["abstract"] = (paper.get("abstract") or "")[:500]
        paper["_contexts"] = contexts[:8]
        paper["_intents"] = [x for x in (it.get("intents") or []) if x]
        paper["_influential"] = bool(it.get("isInfluential"))
        items.append(paper)
    # Bài có ảnh hưởng lớn và có nhiều câu trích dẫn lên đầu.
    items.sort(key=lambda p: (not p["_influential"], -len(p["_contexts"]), -(p.get("citationCount") or 0)))
    s2_add_tldr(items, s2_key)
    data = {"items": items, "total": len(items), "withContext": sum(1 for p in items if p["_contexts"]),
            "influential": sum(1 for p in items if p["_influential"])}
    now = time.time()
    kv_set(cache_key, {"at": now, "data": data})
    return {**data, "cachedAt": now}


# ---- tìm file PDF cho paper chưa có PDF ----

def pdf_from_url(url):
    """Suy ra link PDF từ link trang paper của các nguồn quen thuộc. Trả về (pdf_url, nguồn) hoặc None."""
    u = (url or "").strip()
    if not u:
        return None
    if re.search(r"\.pdf($|[?#])", u, re.I):
        return u, "Link paper"
    aid = parse_arxiv_id(u)
    if aid:
        return f"https://arxiv.org/pdf/{re.sub(r'v\d+$', '', aid)}", "arXiv"
    m = re.match(r"(https?://openaccess\.thecvf\.com/.+?)/html/(.+?)\.html", u, re.I)
    if m:
        return f"{m.group(1)}/papers/{m.group(2)}.pdf", "CVF Open Access"
    m = re.match(r"(https?://(?:proceedings|papers)\.(?:neurips|nips)\.cc/paper(?:_files)?/(?:paper/)?\d{4})/hash/([0-9a-f]+)-Abstract(-[A-Za-z_]+)?\.html", u, re.I)
    if m:
        return f"{m.group(1)}/file/{m.group(2)}-Paper{m.group(3) or ''}.pdf", "NeurIPS Proceedings"
    m = re.match(r"(https?://proceedings\.mlr\.press/v\d+)/([\w-]+)\.html", u, re.I)
    if m:
        return f"{m.group(1)}/{m.group(2)}/{m.group(2)}.pdf", "PMLR"
    m = re.match(r"https?://(?:www\.)?aclanthology\.org/([\w.-]+?)/?$", u, re.I)
    if m:
        return f"https://aclanthology.org/{m.group(1)}.pdf", "ACL Anthology"
    m = re.search(r"openreview\.net/(?:forum|pdf)\?id=([\w-]+)", u, re.I)
    if m:
        return f"https://openreview.net/pdf?id={m.group(1)}", "OpenReview"
    return None


def pdf_from_doi(doi):
    d = (doi or "").strip()
    m = re.match(r"10\.48550/arxiv\.(.+)$", d, re.I)
    if m:
        return f"https://arxiv.org/pdf/{m.group(1)}", "arXiv"
    m = re.match(r"10\.18653/v1/(.+)$", d, re.I)
    if m:
        return f"https://aclanthology.org/{m.group(1)}.pdf", "ACL Anthology"
    return None


def _best_title_matches(items, title, threshold=0.92):
    """Chỉ giữ kết quả trùng tên gần như tuyệt đối và có điểm cao nhất (tránh nhầm sang bài khảo sát cùng tên)."""
    scored = [(_title_sim(d.get("title"), title), d) for d in items]
    scored = [x for x in scored if x[0] >= threshold]
    if not scored:
        return []
    top = max(sc for sc, _ in scored)
    return [d for sc, d in scored if sc >= top - 1e-9][:2]


def find_pdf_candidates(title="", doi="", arxiv_id="", url="", s2_id="", s2_key=""):
    """Gom các link PDF có thể tải cho một paper. Trả về {candidates: [{url, source, note}], links: [{label, url}]}."""
    from concurrent.futures import ThreadPoolExecutor
    title = re.sub(r"\s+", " ", title or "").strip()
    doi = parse_doi(doi or "") or ""
    out, seen, errors = [], set(), []

    def add(u, source, note=""):
        if not u:
            return
        key = re.sub(r"^https?://(www\.)?", "", u.strip().rstrip("/")).lower()
        if key in seen:
            return
        seen.add(key)
        out.append({"url": u.strip(), "source": source, "note": note})

    if arxiv_id:
        add(f"https://arxiv.org/pdf/{re.sub(r'v\d+$', '', arxiv_id)}", "arXiv")
    for r in (pdf_from_url(url), pdf_from_doi(doi)):
        if r:
            add(r[0], r[1], "suy ra từ link / DOI của paper")

    def via_s2():
        ident = s2_id or (f"DOI:{doi}" if doi else (f"ARXIV:{arxiv_id}" if arxiv_id else ""))
        headers = {"x-api-key": s2_key} if s2_key else {}
        fields = "title,openAccessPdf,externalIds"
        if ident:
            _, _, raw, _ = s2_get(f"https://api.semanticscholar.org/graph/v1/paper/{urllib.parse.quote(ident, safe=':/')}?fields={fields}", headers=headers)
            items = [json.loads(raw.decode("utf-8"))]
        elif title:
            _, _, raw, _ = s2_get(f"https://api.semanticscholar.org/graph/v1/paper/search?query={urllib.parse.quote(title)}&fields={fields}&limit=5", headers=headers)
            items = _best_title_matches(json.loads(raw.decode("utf-8")).get("data") or [], title)
        else:
            return []
        res = []
        for d in items[:2]:
            ext = d.get("externalIds") or {}
            pdf = (d.get("openAccessPdf") or {}).get("url")
            if pdf and not re.match(r"https?://(dx\.)?doi\.org/", pdf, re.I):  # S2 đôi khi trả link DOI, không phải file PDF
                res.append((pdf, "Semantic Scholar (open access)", ""))
            if ext.get("ArXiv"):
                res.append((f"https://arxiv.org/pdf/{ext['ArXiv']}", "arXiv", "Semantic Scholar tìm thấy bản arXiv"))
            if ext.get("ACL"):
                res.append((f"https://aclanthology.org/{ext['ACL']}.pdf", "ACL Anthology", ""))
        return res

    def via_openalex():
        sel = "&select=title,doi,best_oa_location,locations,primary_location"
        if doi:
            _, _, raw, _ = http_get(f"https://api.openalex.org/works/doi:{urllib.parse.quote(doi)}?{sel[1:]}", timeout=20)
            works = [json.loads(raw.decode("utf-8"))]
        elif title:
            _, _, raw, _ = http_get("https://api.openalex.org/works?search=" + urllib.parse.quote(re.sub(r"[?*:]", " ", title)) + "&per-page=6" + sel, timeout=20)
            works = _best_title_matches(json.loads(raw.decode("utf-8")).get("results", []), title)
        else:
            return []
        res = []
        for w in works[:3]:
            locs = [w.get("best_oa_location") or {}] + (w.get("locations") or [])
            for loc in locs:
                pdf = loc.get("pdf_url")
                if pdf:
                    src = (loc.get("source") or {}).get("display_name") or "OpenAlex"
                    res.append((pdf, f"OpenAlex · {src}", loc.get("version") or ""))
                else:
                    guess = pdf_from_url(loc.get("landing_page_url"))
                    if guess:
                        res.append((guess[0], guess[1], "suy ra từ trang paper trên OpenAlex"))
        return res

    def via_arxiv_title():
        if not title or arxiv_id:
            return []
        clean = re.sub(r"[^\w\s-]", " ", title)
        q = urllib.parse.quote(f'ti:"{clean}"')
        _, _, raw, _ = http_get(f"https://export.arxiv.org/api/query?search_query={q}&max_results=5", timeout=20)
        ns = {"a": "http://www.w3.org/2005/Atom"}
        res = []
        for entry in ET.fromstring(raw).findall("a:entry", ns):
            t = re.sub(r"\s+", " ", entry.findtext("a:title", "", ns))
            if _title_sim(t, title) >= 0.92:
                aid = parse_arxiv_id(entry.findtext("a:id", "", ns))
                if aid:
                    res.append((f"https://arxiv.org/pdf/{re.sub(r'v\d+$', '', aid)}", "arXiv", "tìm theo tên paper"))
        return res

    with ThreadPoolExecutor(max_workers=3) as ex:
        futures = {name: ex.submit(fn) for name, fn in (("Semantic Scholar", via_s2), ("OpenAlex", via_openalex), ("arXiv", via_arxiv_title))}
        for name, fut in futures.items():
            try:
                for u, src, note in fut.result(timeout=40):
                    add(u, src, note)
            except Exception as e:  # noqa: BLE001
                errors.append(f"{name}: {e}")

    q = urllib.parse.quote(title or doi)
    links = [{"label": "Google Scholar", "url": f"https://scholar.google.com/scholar?q={q}"},
             {"label": "Semantic Scholar", "url": f"https://www.semanticscholar.org/search?q={q}"}]
    if doi:
        links.insert(0, {"label": "Trang nhà xuất bản (DOI)", "url": f"https://doi.org/{doi}"})
    return {"candidates": out, "links": links, "errors": errors}


def fetch_semantic_scholar(ident, s2_key=""):
    fields = "title,abstract,authors,year,venue,citationCount,openAccessPdf,externalIds,tldr,url,publicationVenue,publicationTypes,journal"
    url = f"https://api.semanticscholar.org/graph/v1/paper/{urllib.parse.quote(ident, safe=':/')}?fields={fields}"
    headers = {"x-api-key": s2_key} if s2_key else {}
    _, ctype, raw, _ = s2_get(url, headers=headers)
    d = json.loads(raw.decode("utf-8", errors="replace"))
    ext = d.get("externalIds") or {}
    return {
        "title": d.get("title") or "",
        "authors": ", ".join(a.get("name", "") for a in (d.get("authors") or [])[:8]),
        "venue": d.get("venue") or "",
        "year": str(d.get("year") or ""),
        "abstract": d.get("abstract") or "",
        "tldr": (d.get("tldr") or {}).get("text") or "",
        "citationCount": d.get("citationCount"),
        "pdfUrl": (d.get("openAccessPdf") or {}).get("url") or "",
        "arxivId": ext.get("ArXiv") or "",
        "doi": ext.get("DOI") or "",
        "s2Id": d.get("paperId") or "",
        "url": d.get("url") or "",
        "venueHints": s2_venue_hints(d),
    }


def s2_venue_hints(d):
    pv = d.get("publicationVenue") or {}
    j = d.get("journal") or {}
    issn = [x for x in [pv.get("issn")] + (pv.get("alternate_issns") or []) if x]
    return {k: v for k, v in {
        "s2Type": pv.get("type") or "", "pubTypes": d.get("publicationTypes") or [],
        "issn": issn, "journalName": j.get("name") or pv.get("name") or "",
        "venueFull": pv.get("name") or "", "venueAlt": (pv.get("alternate_names") or [])[:4],
    }.items() if v}


def fetch_crossref(doi):
    _, ctype, raw, _ = http_get(f"https://api.crossref.org/works/{urllib.parse.quote(doi)}", timeout=25)
    m = json.loads(raw.decode("utf-8", errors="replace")).get("message", {})
    authors = ", ".join(" ".join(filter(None, [a.get("given"), a.get("family")])) for a in m.get("author", [])[:8])
    year = ""
    for k in ("published-print", "published-online", "issued", "created"):
        parts = (m.get(k) or {}).get("date-parts") or [[None]]
        if parts and parts[0] and parts[0][0]:
            year = str(parts[0][0])
            break
    return {
        "title": " ".join(m.get("title") or []),
        "authors": authors,
        "venue": " ".join(m.get("container-title") or []) or m.get("publisher", ""),
        "year": year,
        "abstract": html_to_text(m.get("abstract", "")),
        "url": m.get("URL") or f"https://doi.org/{doi}",
        "doi": doi,
        "pdfUrl": next((l.get("URL") for l in m.get("link", []) if "pdf" in (l.get("content-type") or "")), ""),
        "venueHints": {k: v for k, v in {"crossrefType": m.get("type") or "", "issn": m.get("ISSN") or [],
                                          "journalName": " ".join(m.get("container-title") or [])}.items() if v},
    }


def resolve_source(query, s2_key=""):
    """Từ một chuỗi người dùng nhập (arXiv ID / URL / DOI / link bất kỳ) -> source cho LLM."""
    q = query.strip()
    if not q:
        raise ValueError("Chưa nhập gì.")
    arxiv_id = parse_arxiv_id(q)
    if arxiv_id:
        src = fetch_arxiv(arxiv_id)
        try:
            s2 = fetch_semantic_scholar(f"arXiv:{re.sub(r'v\\d+$', '', arxiv_id)}", s2_key)
            src["citationCount"] = s2.get("citationCount")
            src["s2Id"] = s2.get("s2Id")
            src["tldr"] = s2.get("tldr")
            src["venueHints"] = s2.get("venueHints") or {}
            if s2.get("doi"):
                src["doi"] = s2["doi"]
            if s2.get("venue") and src["venue"].startswith("arXiv"):
                src["venue"] = (s2.get("venueHints") or {}).get("venueFull") or s2["venue"]
        except Exception as e:
            src.setdefault("warnings", []).append(f"Không lấy được venue / số trích dẫn từ Semantic Scholar: {e}")
        # Không có venue nào ngoài arXiv -> thử tìm bản đã xuất bản trên OpenAlex
        if src.get("venue", "").startswith("arXiv") and not src.get("venueHints") and src.get("title"):
            oa = openalex_venue(src["title"])
            if oa:
                src["venue"] = oa["venue"]
                src["venueHints"] = {"s2Type": "conference" if oa["kind"] == "conference" else ("journal" if oa["kind"] == "journal" else "")}
                if oa["doi"] and not src.get("doi"):
                    src["doi"] = oa["doi"]
                src.setdefault("warnings", []).append(f"Venue lấy từ OpenAlex: {oa['venue']}")
        return src

    if re.search(r"openreview\.net", q, re.I):
        raise ValueError("OpenReview chặn truy cập tự động từ ứng dụng. Hãy mở trang trên trình duyệt, tải PDF rồi thả vào app, "
                         "hoặc dùng nút → App của extension PaperVault (extension đọc được trang đang mở).")
    doi = parse_doi(q)
    warnings = []
    src = {"url": q if q.startswith("http") else (f"https://doi.org/{doi}" if doi else ""), "title": "", "authors": "",
           "venue": "", "year": "", "text": "", "kind": "", "pdfUrl": "", "arxivId": "", "warnings": warnings}
    s2 = None
    try:
        ident = f"DOI:{doi}" if doi else f"URL:{q}"
        s2 = fetch_semantic_scholar(ident, s2_key)
    except Exception as e:
        warnings.append(f"Semantic Scholar: {e}")
    if s2 and s2.get("arxivId"):
        ax = fetch_arxiv(s2["arxivId"])
        ax["citationCount"] = s2.get("citationCount")
        ax["s2Id"] = s2.get("s2Id")
        ax["doi"] = s2.get("doi")
        ax["venueHints"] = s2.get("venueHints") or {}
        if s2.get("venue"):
            ax["venue"] = (s2.get("venueHints") or {}).get("venueFull") or s2["venue"]
        return ax
    if s2 and s2.get("title"):
        src.update({k: v for k, v in s2.items() if v})
        src["url"] = q if q.startswith("http") else (src.get("url") or "")
    if doi:
        # Crossref cho biết loại ấn phẩm (journal-article / proceedings-article / book-chapter) và ISSN
        try:
            cr = fetch_crossref(doi)
            hints = dict(cr.get("venueHints") or {})
            hints.update(src.get("venueHints") or {})
            src.update({k: v for k, v in cr.items() if v and not src.get(k)})
            src["venueHints"] = hints
        except Exception as e:
            if not (s2 and s2.get("title")):
                warnings.append(f"Crossref: {e}")

    if src.get("abstract"):
        src["text"] = f"Title: {src['title']}\nAuthors: {src['authors']}\n\nAbstract:\n{src['abstract']}"
        src["kind"] = "abstract (Semantic Scholar/Crossref)"

    # Trang web bất kỳ: lấy text heuristic, có thể dài hơn abstract
    if q.startswith("http"):
        try:
            st, ctype, raw, final = http_get(q, timeout=40)
            if "pdf" in ctype.lower() or raw[:5] == b"%PDF-":
                src["pdfUrl"] = final
                src["kind"] = src["kind"] or "PDF"
            else:
                page = bytes_to_text(raw, ctype)
                if BOT_PAGE_RE.search(page[:5000]) and not meta_of(page, "citation_title"):
                    raise ValueError("trang yêu cầu xác minh trình duyệt, không đọc tự động được. Hãy tải PDF về rồi thả vào app, hoặc dùng extension")
                body = html_main_text(page)
                if not src["venue"]:
                    src["venue"] = (meta_of(page, "citation_conference_title") or meta_of(page, "citation_journal_title")
                                    or meta_of(page, "citation_inbook_title") or meta_of(page, "citation_publisher"))
                if not src.get("doi") and meta_of(page, "citation_doi"):
                    src["doi"] = meta_of(page, "citation_doi")
                if not src["arxivId"] and meta_of(page, "citation_arxiv_id"):
                    src["arxivId"] = meta_of(page, "citation_arxiv_id")
                if not src["title"]:
                    src["title"] = meta_of(page, "citation_title") or meta_of(page, "og:title") or html_to_text(re.search(r"<title[^>]*>([\s\S]*?)</title>", page, re.I).group(1) if re.search(r"<title", page, re.I) else "")
                if not src["authors"]:
                    src["authors"] = ", ".join(meta_all(page, "citation_author")[:8])
                if not src["year"]:
                    src["year"] = (meta_of(page, "citation_publication_date") or meta_of(page, "citation_date"))[:4]
                if not src["pdfUrl"]:
                    src["pdfUrl"] = meta_of(page, "citation_pdf_url")
                if len(body) > len(src["text"]):
                    src["text"] = body
                    src["kind"] = "nội dung trang (heuristic)"
        except Exception as e:
            warnings.append(f"Tải trang: {e}")

    if not src["text"] and not src["pdfUrl"]:
        raise ValueError("Không lấy được nội dung từ nguồn này. Hãy tải PDF về rồi thêm bằng file, hoặc dán abstract.")
    return src


# ----------------------------------------------------------------------------
# Ghi thư viện ra thư mục Markdown
# ----------------------------------------------------------------------------

def safe_rel_path(rel):
    parts = [p for p in re.split(r"[\\/]+", rel) if p and p not in (".", "..")]
    cleaned = []
    for p in parts:
        p = re.sub(r'[\\/:*?"<>|]', "-", p).strip().rstrip(". ")
        cleaned.append(p[:120] or "untitled")
    return Path(*cleaned) if cleaned else None


def write_files(root, files, clean=False):
    root = Path(root).expanduser()
    if not root.is_absolute():
        raise ValueError("Đường dẫn thư mục phải là đường dẫn tuyệt đối.")
    root.mkdir(parents=True, exist_ok=True)
    written = 0
    if clean:
        for old in root.rglob("*.md"):
            try:
                old.unlink()
            except OSError:
                pass
    for f in files:
        rel = safe_rel_path(f.get("path", ""))
        if not rel:
            continue
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f.get("content", ""), encoding="utf-8")
        written += 1
    return {"files": written, "root": str(root)}


# ----------------------------------------------------------------------------
# HTTP handler
# ----------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "PaperVault/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else "") or os.environ.get("PV_DEBUG"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # ---- helpers ----
    CORS_PATHS = ("/api/inbox", "/api/health", "/api/import")

    def cors_headers(self):
        # Chỉ mở CORS cho vài đường dẫn extension cần; máy chủ vốn chỉ lắng nghe localhost.
        if self.path.split("?")[0].startswith(self.CORS_PATHS):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "content-type")

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def send_bytes(self, data, ctype, status=200, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def error(self, msg, status=400):
        self.send_json({"ok": False, "error": str(msg)}, status)

    def ok(self, data=None):
        self.send_json({"ok": True, "data": data})

    def read_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise ValueError("Body quá lớn.")
        return self.rfile.read(n) if n else b""

    def read_json(self):
        raw = self.read_body()
        return json.loads(raw.decode("utf-8")) if raw else {}

    # ---- routing ----
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        try:
            self.route("GET")
        except ValueError as e:  # lỗi nghiệp vụ có thông báo cho người dùng (không tìm thấy, bị chặn…)
            self.error(e, 422)
        except Exception as e:
            self.error(e, 500)

    def do_POST(self):
        try:
            self.route("POST")
        except ValueError as e:  # lỗi nghiệp vụ có thông báo cho người dùng (không tìm thấy, bị chặn…)
            self.error(e, 422)
        except Exception as e:
            self.error(e, 500)

    def do_PUT(self):
        self.do_POST()

    def do_DELETE(self):
        try:
            self.route("DELETE")
        except ValueError as e:  # lỗi nghiệp vụ có thông báo cho người dùng (không tìm thấy, bị chặn…)
            self.error(e, 422)
        except Exception as e:
            self.error(e, 500)

    def route(self, method):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)
        if path.startswith("/api/"):
            return self.api(method, path[5:].strip("/"), qs)
        if method != "GET":
            return self.error("Not found", 404)
        return self.static(path)

    def static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        # Test JS (tests/js) chỉ phục vụ khi chạy bộ test (PV_TEST=1), không có trong bản đóng gói.
        if path.startswith("/__tests__/") and os.environ.get("PV_TEST") == "1":
            tdir = (BASE / "tests" / "js").resolve()
            target = (tdir / path[len("/__tests__/"):]).resolve()
            if tdir not in target.parents or not target.is_file():
                return self.error("Not found", 404)
            ctype = "text/html; charset=utf-8" if target.suffix == ".html" else "application/javascript; charset=utf-8"
            return self.send_bytes(target.read_bytes(), ctype, extra={"Cache-Control": "no-cache"})
        target = (STATIC / path.lstrip("/")).resolve()
        if STATIC not in target.parents and target != STATIC:
            return self.error("Forbidden", 403)
        if target.is_dir():
            target = target / "index.html"
        if not target.exists():
            # Tài nguyên của thư viện kèm theo (PDF.js...) thiếu thì báo 404 thật, không trả index.html.
            if path.startswith("/vendor/"):
                return self.error("Not found", 404)
            # SPA: mọi đường dẫn khác trả về index.html
            target = STATIC / "index.html"
        ctype = STATIC_TYPES.get(target.suffix.lower()) or mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        self.send_bytes(target.read_bytes(), ctype, extra={"Cache-Control": "no-cache"})

    # ---- API ----
    def api(self, method, route, qs):
        seg = route.split("/") if route else []
        head = seg[0] if seg else ""

        if head == "state" and method == "GET":
            text_lens = {r[0]: r[1] for r in db_all("SELECT paperId, length(text) FROM texts")}
            return self.ok({"papers": get_papers(), "topics": get_topics(), "settings": get_settings(), "textLens": text_lens,
                            "inbox": kv_get("inbox", []) or [], "trashCount": len(get_papers(only_deleted=True)),
                            "lastCitationRefresh": kv_get("lastCitationRefresh"), "hasFts": HAS_FTS})

        if head == "venue":
            if method == "POST" and len(seg) == 2 and seg[1] == "classify":
                body = self.read_json()
                return self.ok(RANK.classify(body.get("candidates") or [body.get("venue", "")], body.get("hints") or {}, bool(body.get("hasArxiv"))))
            if method == "GET" and len(seg) == 2 and seg[1] == "search":
                return self.ok(RANK.search((qs.get("q") or [""])[0]))
            if method == "POST" and len(seg) == 2 and seg[1] == "reclassify":
                return self.ok({"changed": reclassify_all(force=bool(self.read_json().get("force")))})

        if head == "rankings":
            if method == "GET":
                RANK.ensure()
                return self.ok(RANK.info)
            if method == "POST" and len(seg) == 2 and seg[1] == "update":
                report = RANK.update_online()
                report["changed"] = reclassify_all(force=True)
                report["info"] = RANK.info
                return self.ok(report)

        if head == "chats":
            if method == "GET" and len(seg) == 1:
                return self.ok(list_chats())
            if method == "GET" and len(seg) == 2:
                c = get_chat(seg[1])
                return self.ok(c) if c else self.error("Không tìm thấy hội thoại.", 404)
            if method in ("POST", "PUT") and len(seg) == 1:
                return self.ok(put_chat(self.read_json()))
            if method == "DELETE" and len(seg) == 2:
                db_run("DELETE FROM chats WHERE id=?", (seg[1],))
                return self.ok(True)

        if head == "pages":
            if method == "GET" and len(seg) == 1:
                return self.ok(list_pages())
            if method in ("POST", "PUT") and len(seg) == 1:
                body = self.read_json()
                if isinstance(body, list):  # lưu nhiều trang một lượt (đổi tên trang thì sửa liên kết ở các trang khác)
                    return self.ok([put_page(x) for x in body])
                # baseUpdatedAt: phiên bản trang mà trình soạn bắt đầu sửa. Trang trên máy chủ đã được sửa ở nơi khác
                # sau mốc đó (khung chia đôi, tab khác) thì không ghi đè: trả 409 kèm bản hiện có để người dùng chọn.
                # force: người dùng chọn giữ bản của mình; bản bị đè vẫn được lưu vào lịch sử phiên bản.
                base = body.pop("baseUpdatedAt", None)
                force = body.pop("force", False)
                cur = get_page(body.get("id")) if body.get("id") else None
                if cur and base and cur.get("updatedAt") != base and not force and (
                        (cur.get("content") or "") != (body.get("content") or "") or (cur.get("title") or "") != (body.get("title") or "")):
                    return self.send_json({"ok": False, "error": "conflict", "current": cur}, 409)
                if cur and force:
                    snapshot_page(cur, force=True)
                return self.ok(put_page(body))
            if method == "DELETE" and len(seg) == 2:
                db_run("DELETE FROM pages WHERE id=?", (seg[1],))
                db_run("DELETE FROM page_versions WHERE pageId=?", (seg[1],))
                return self.ok(True)
            # Lịch sử phiên bản: GET pages/<id>/versions · GET pages/<id>/versions/<vid> · POST .../<vid>/restore
            if len(seg) >= 3 and seg[2] == "versions":
                pid = seg[1]
                if method == "GET" and len(seg) == 3:
                    rows = db_all("SELECT id, at, title, size FROM page_versions WHERE pageId=? ORDER BY id DESC", (pid,))
                    return self.ok([{"id": r[0], "at": r[1], "title": r[2], "size": r[3]} for r in rows])
                if len(seg) >= 4 and seg[3].isdigit():
                    r = db_one("SELECT json FROM page_versions WHERE pageId=? AND id=?", (pid, int(seg[3])))
                    if not r:
                        return self.error("Không có phiên bản này.", 404)
                    snap = json.loads(r[0])
                    if method == "GET" and len(seg) == 4:
                        return self.ok(snap)
                    if method == "POST" and len(seg) == 5 and seg[4] == "restore":
                        cur = get_page(pid)
                        if not cur:
                            return self.error("Trang đã bị xoá hẳn.", 404)
                        snapshot_page(cur, force=True)  # giữ lại bản hiện tại để có thể hoàn tác
                        cur.update({"title": snap.get("title") or cur.get("title"), "content": snap.get("content") or "", "icon": snap.get("icon", cur.get("icon"))})
                        cur["updatedAt"] = now_iso()
                        db_run("INSERT OR REPLACE INTO pages (id, updatedAt, json) VALUES (?,?,?)", (pid, cur["updatedAt"], json.dumps(cur, ensure_ascii=False)))
                        return self.ok(cur)

        if head == "search" and method == "GET":
            return self.ok(search_text((qs.get("q") or [""])[0]))

        if head == "zotero" and len(seg) == 2 and seg[1] == "scan" and method == "GET":
            try:
                return self.ok(zotero_scan((qs.get("dir") or [""])[0]))
            except (ValueError, OSError) as e:
                return self.send_json({"ok": False, "error": str(e)}, 400)
        if head == "zotero" and len(seg) == 2 and seg[1] == "pdf" and method == "POST":
            try:
                return self.ok(zotero_pdf(str((self.read_json() or {}).get("path") or "")))
            except (ValueError, OSError) as e:
                return self.send_json({"ok": False, "error": str(e)}, 400)

        if head == "ics-fetch" and method == "GET":
            try:
                return self.ok({"text": fetch_ics((qs.get("url") or [""])[0])})
            except urllib.error.HTTPError as e:
                return self.send_json({"ok": False, "error": f"Máy chủ lịch trả về lỗi HTTP {e.code}{' (link sai hoặc đã bị đặt lại)' if e.code in (401, 403, 404) else ''}."}, 502)
            except (ValueError, urllib.error.URLError, OSError) as e:
                return self.send_json({"ok": False, "error": str(getattr(e, "reason", None) or e)}, 400)

        if head == "papers":
            if method == "GET" and len(seg) == 1:
                return self.ok(get_papers(include_deleted=(qs.get("all") or ["0"])[0] == "1"))
            if method == "GET" and len(seg) == 2 and seg[1] == "trash":
                return self.ok(get_papers(only_deleted=True))
            if method == "POST" and len(seg) == 3 and seg[2] == "restore":
                return self.ok(restore_paper(seg[1]))
            if method == "GET" and len(seg) == 2:
                p = get_paper(seg[1])
                return self.ok(p) if p else self.error("Không tìm thấy paper.", 404)
            if method == "GET" and len(seg) == 3 and seg[2] == "text":
                return self.ok(get_text(seg[1]))
            if method in ("POST", "PUT") and len(seg) == 3 and seg[2] == "text":
                body = self.read_json()
                put_text(seg[1], body.get("text", ""), body.get("kind", ""))
                return self.ok(True)
            if method in ("POST", "PUT") and len(seg) == 1:
                body = self.read_json()
                text = body.pop("sourceText", None)
                p = put_paper(body)
                if text is not None:
                    put_text(p["id"], text, body.get("sourceKind", ""))
                return self.ok(p)
            if method == "POST" and len(seg) == 2 and seg[1] == "bulk":
                body = self.read_json()
                op, ids, value = body.get("op"), body.get("ids") or [], body.get("value")
                n = 0
                for pid in ids:
                    p = get_paper(pid)
                    if not p:
                        continue
                    if op == "delete":
                        delete_paper(pid)
                    elif op == "purge":
                        delete_paper(pid, permanent=True)
                    elif op == "restore":
                        restore_paper(pid)
                    elif op == "move":
                        p["topicId"] = value
                        put_paper(p)
                    elif op == "status":
                        p["status"] = value
                        put_paper(p)
                    else:
                        return self.error("op không hỗ trợ")
                    n += 1
                return self.ok(n)
            if method == "DELETE" and len(seg) == 2:
                delete_paper(seg[1], permanent=(qs.get("permanent") or ["0"])[0] == "1")
                return self.ok(True)

        if head == "usage" and len(seg) == 2 and seg[1] == "cost" and method == "GET":
            return self.ok(usage_cost((qs.get("since") or [""])[0]))

        if head == "usage":
            if method == "POST":
                log_usage(self.read_json())
                return self.ok(True)
            if method == "GET":
                return self.ok(get_usage((qs.get("since") or [""])[0]))

        if head == "dict" and method == "GET":
            return self.ok(dict_lookup((qs.get("w") or [""])[0]))

        if head == "tts" and method == "GET":
            # Đọc to đoạn tiếng Anh: ?q=…&accent=us|uk[&dl=1 để tải về]
            q = (qs.get("q") or [""])[0]
            accent = (qs.get("accent") or ["us"])[0]
            try:
                data, src = tts_audio(q, accent)
            except Exception as e:
                return self.error(f"Không tạo được âm thanh: {e}", 502)
            extra = {"Cache-Control": "private, max-age=604800", "X-Audio-Source": src, "Access-Control-Expose-Headers": "X-Audio-Source"}
            if (qs.get("dl") or [""])[0] == "1":
                name = re.sub(r"[^A-Za-z0-9]+", "-", q)[:40].strip("-") or "phat-am"
                extra["Content-Disposition"] = f'attachment; filename="{name}-{"anh-my" if accent != "uk" else "anh-anh"}.mp3"'
            return self.send_bytes(data, "audio/mpeg", extra=extra)

        if head == "prices" and method == "GET":
            keys = [k for k in (qs.get("models") or [""])[0].split(",") if k.strip()]
            try:
                return self.ok(model_prices(keys, refresh=(qs.get("refresh") or ["0"])[0] == "1"))
            except ValueError as e:
                return self.error(str(e), 502)

        if head == "inbox":
            if method == "POST":
                body = self.read_json()
                if not body.get("source") and not body.get("extraction"):
                    return self.error("Thiếu source/extraction.")
                return self.ok(inbox_add(body))
            if method == "GET":
                return self.ok(kv_get("inbox", []) or [])
            if method == "DELETE" and len(seg) == 2:
                return self.ok(inbox_remove(seg[1]))

        if head == "arxiv" and method == "GET" and len(seg) == 2 and seg[1] == "search":
            kws = [k for k in (qs.get("q") or [""])[0].split(",")]
            cats = [c for c in (qs.get("cats") or [""])[0].split(",")]
            return self.ok(arxiv_search(kws, cats, int((qs.get("max") or ["50"])[0])))

        if head == "topics":
            if method == "GET":
                return self.ok(get_topics())
            if method in ("POST", "PUT"):
                return self.ok(put_topic(self.read_json()))
            if method == "DELETE" and len(seg) == 2:
                n = delete_topic(seg[1], (qs.get("reassign") or ["t_inbox"])[0])
                return self.ok(n)

        if head == "settings":
            if method == "GET":
                return self.ok(get_settings())
            if method in ("POST", "PUT"):
                cur = get_settings()
                patch = self.read_json()
                cur.update({k: v for k, v in patch.items() if k not in ("models", "apiKeys")})
                cur["models"].update(patch.get("models") or {})
                cur["apiKeys"].update(patch.get("apiKeys") or {})
                kv_set("settings", cur)
                return self.ok(cur)

        if head == "kv" and len(seg) == 2:
            if method == "GET":
                return self.ok(kv_get(seg[1]))
            if method in ("POST", "PUT"):
                kv_set(seg[1], self.read_json().get("value"))
                return self.ok(True)

        if head == "image":
            if method == "POST" and len(seg) == 1:
                data = self.read_body()
                name = urllib.parse.unquote(self.headers.get("X-Filename") or "image")
                try:
                    return self.ok(save_image(data, name))
                except ValueError as e:
                    return self.error(str(e))
            if method == "GET" and len(seg) == 2:
                p = image_path(seg[1])
                if not p:
                    return self.error("Không có ảnh này.", 404)
                return self.send_bytes(p.read_bytes(), IMG_TYPES[p.suffix[1:]], extra={"Cache-Control": "max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"})

        if head == "pdf":
            if method == "POST" and len(seg) == 1:
                data = self.read_body()
                name = urllib.parse.unquote(self.headers.get("X-Filename") or "paper.pdf")
                return self.ok(save_pdf(data, name))
            if method == "GET" and len(seg) >= 2:
                p = pdf_path(seg[1])
                if not p:
                    return self.error("Không có file PDF này.", 404)
                data = p.read_bytes()
                if len(seg) == 3 and seg[2] == "base64":
                    return self.ok({"base64": base64.b64encode(data).decode("ascii"), "size": len(data)})
                return self.send_bytes(data, "application/pdf", extra={"Content-Disposition": "inline"})
            if method == "DELETE" and len(seg) == 2:
                delete_pdf(seg[1])
                return self.ok(True)

        if head == "find-title" and method == "GET":
            return self.ok(find_by_title((qs.get("q") or [""])[0], get_settings().get("s2ApiKey", "")))

        if head == "pdf-download" and method == "POST":
            # Tải PDF từ link rồi lưu luôn ở máy chủ (khỏi chuyển file qua lại trình duyệt). Trang HTML / trang chặn bot -> báo lỗi rõ.
            body = self.read_json()
            url = body.get("url", "")
            try:
                st, ctype, raw, final = http_get(url, timeout=60, headers={"Accept": "application/pdf,*/*"})
            except urllib.error.HTTPError as e:
                raise ValueError(f"Máy chủ nguồn trả lỗi HTTP {e.code}.")
            head_bytes = raw[:1024].lstrip()
            if not head_bytes.startswith(b"%PDF-"):
                text = raw[:3000].decode("utf-8", errors="replace")
                why = "trang chặn truy cập tự động" if BOT_PAGE_RE.search(text) else ("trang web, không phải file PDF" if "<html" in text.lower() else "file không phải PDF")
                raise ValueError(f"Link trả về {why}.")
            data = raw[raw.index(b"%PDF-"):]
            name = (body.get("name") or "").strip() or (urllib.parse.unquote(final.rsplit("/", 1)[-1].split("?")[0]) or "paper")
            if not name.lower().endswith(".pdf"):
                name += ".pdf"
            return self.ok({**save_pdf(data, re.sub(r'[\\/:*?"<>|]+', "-", name)[:120]), "url": final})

        if head == "pdf-find" and method == "POST":
            body = self.read_json()
            return self.ok(find_pdf_candidates(body.get("title", ""), body.get("doi", ""), body.get("arxivId", ""),
                                               body.get("url", ""), body.get("s2Id", ""), get_settings().get("s2ApiKey", "")))

        if head == "translate" and method == "POST":
            body = self.read_json()
            return self.ok(translate_batch(body.get("q") or [], body.get("sl") or "auto", body.get("tl") or "vi"))

        if head == "resolve" and method == "POST":
            body = self.read_json()
            return self.ok(resolve_source(body.get("query", ""), get_settings().get("s2ApiKey", "")))

        if head == "fetch" and method == "POST":
            body = self.read_json()
            url = body.get("url", "")
            st, ctype, raw, final = http_get(url)
            is_pdf = "pdf" in ctype.lower() or raw[:5] == b"%PDF-"
            if is_pdf or body.get("binary"):
                return self.ok({"status": st, "contentType": ctype, "base64": base64.b64encode(raw).decode("ascii"), "size": len(raw), "url": final, "isPdf": is_pdf})
            text = bytes_to_text(raw, ctype)
            return self.ok({"status": st, "contentType": ctype, "text": text, "url": final, "isPdf": False,
                            "plain": html_main_text(text) if "html" in ctype.lower() else text})

        if head == "s2" and method == "POST" and len(seg) == 2 and seg[1] == "details":
            # Chi tiết nhiều bài trong một request (tóm tắt đầy đủ, TLDR, lĩnh vực), dùng khi cần so sánh kỹ hơn.
            ids = [str(i) for i in (self.read_json().get("ids") or []) if i][:100]
            if not ids:
                return self.ok([])
            rows = _s2_batch(ids, "title,abstract,tldr,year,venue,fieldsOfStudy,publicationTypes", get_settings().get("s2ApiKey", ""))
            out = []
            for r in rows:
                if not r:
                    out.append(None)
                    continue
                out.append({"paperId": r.get("paperId"), "title": r.get("title") or "", "abstract": (r.get("abstract") or "")[:2000],
                            "tldr": ((r.get("tldr") or {}).get("text") or ""), "year": r.get("year"), "venue": r.get("venue") or "",
                            "fields": r.get("fieldsOfStudy") or [], "types": r.get("publicationTypes") or []})
            return self.ok(out)

        if head == "s2" and method == "POST" and len(seg) == 2 and seg[1] == "refresh":
            body = self.read_json()
            ids = set(body.get("ids") or [])
            papers = [p for p in get_papers() if not ids or p["id"] in ids]
            return self.ok({"updated": s2_refresh_citations(papers, get_settings().get("s2ApiKey", "")), "total": len(papers)})

        if head == "s2" and method == "GET":
            # /api/s2/recommend/<s2id|arXiv:...>  |  /api/s2/search?q=
            key = get_settings().get("s2ApiKey", "")
            headers = {"x-api-key": key} if key else {}
            fields = "title,abstract,authors,year,publicationDate,venue,citationCount,externalIds,url,openAccessPdf"
            try:  # ngưỡng tự làm mới kết quả khám phá, tính bằng ngày (0 = giữ tới khi bấm làm mới)
                max_age = max(0.0, float((qs.get("maxAgeDays") or ["0"])[0] or 0)) * 86400
            except ValueError:
                max_age = 0
            if len(seg) == 3 and seg[1] == "recommend":
                ident = urllib.parse.unquote(seg[2])
                # Gợi ý cũng được lưu kèm thời điểm lấy, chỉ lấy lại khi bấm làm mới.
                ckey = f"s2rec:{ident}"
                cached = kv_get(ckey)
                too_old = cached and max_age and time.time() - cached.get("at", 0) > max_age
                if cached and not too_old and (qs.get("refresh") or [""])[0] != "1":
                    return self.ok({"items": cached["items"], "cachedAt": cached["at"]})
                url = f"https://api.semanticscholar.org/recommendations/v1/papers/forpaper/{urllib.parse.quote(ident, safe=':')}?fields={fields}&limit=15"
                try:
                    _, _, raw, _ = s2_get(url, headers=headers)
                except Exception:
                    if cached:  # Semantic Scholar lỗi / giới hạn tốc độ: dùng bản đã lưu
                        return self.ok({"items": cached["items"], "cachedAt": cached["at"], "stale": True})
                    raise
                items = s2_add_tldr(json.loads(raw.decode("utf-8")).get("recommendedPapers", []), key)
                now = time.time()
                kv_set(ckey, {"at": now, "items": items})
                return self.ok({"items": items, "cachedAt": now})
            if len(seg) == 3 and seg[1] in ("citations", "references"):
                ident = urllib.parse.unquote(seg[2])
                try:
                    lim = int((qs.get("limit") or ["0"])[0] or 0) or None
                except ValueError:
                    lim = None
                return self.ok(s2_edges(ident, seg[1], key, refresh=(qs.get("refresh") or [""])[0] == "1", limit=lim, max_age=max_age))
            if len(seg) == 2 and seg[1] == "check":
                # Kiểm tra S2 API key: key sai -> 403, key đúng -> 200 (hoặc 429 khi đang bị giới hạn tốc độ).
                k = (qs.get("key") or [""])[0].strip() or key
                if not k:
                    return self.ok({"status": "none", "message": "Chưa nhập key. App vẫn dùng được Semantic Scholar nhưng dùng chung giới hạn tốc độ rất chặt."})
                res = None
                for attempt in range(3):
                    _s2_pace()
                    try:
                        req = urllib.request.Request("https://api.semanticscholar.org/graph/v1/paper/arXiv:1706.03762?fields=title",
                                                     headers={"x-api-key": k, "User-Agent": UA})
                        with urllib.request.urlopen(req, timeout=20) as r:
                            res = r.status
                        break
                    except urllib.error.HTTPError as e:
                        res = e.code
                        if e.code != 429:
                            break
                        time.sleep(2)
                    except Exception as e:
                        return self.ok({"status": "error", "message": f"Không kết nối được Semantic Scholar: {e}"})
                msg = {200: "Key hợp lệ, Semantic Scholar nhận key này.",
                       403: "Key không hợp lệ: Semantic Scholar trả 403 Forbidden. Kiểm tra lại key, chép thiếu hoặc thừa ký tự.",
                       429: "Key hợp lệ nhưng đang bị giới hạn tốc độ (key mặc định khoảng 1 request mỗi giây). App đã tự giãn nhịp các lượt gọi."}
                return self.ok({"status": {200: "ok", 403: "invalid", 429: "limited"}.get(res, "error"), "code": res,
                                "message": msg.get(res, f"Semantic Scholar trả mã {res}.")})
            if len(seg) == 3 and seg[1] == "graph":
                q1 = lambda k, d="": (qs.get(k) or [d])[0]
                return self.ok(s2_graph(urllib.parse.unquote(seg[2]), key, refresh=q1("refresh") == "1",
                                        cits=q1("cits", "100"), hop2=q1("hop2") == "1", min_shared=q1("minShared", "3")))
            if len(seg) == 3 and seg[1] == "authors":
                # Tác giả của một paper kèm mã tác giả Semantic Scholar (để theo dõi bài mới của họ).
                ident = urllib.parse.unquote(seg[2])
                _, _, raw, _ = s2_get(f"https://api.semanticscholar.org/graph/v1/paper/{urllib.parse.quote(ident, safe=':')}?fields=authors", headers=headers)
                return self.ok([a for a in (json.loads(raw.decode("utf-8")).get("authors") or []) if a.get("authorId")])
            if len(seg) == 3 and seg[1] == "author-papers":
                # Bài của một tác giả, mới nhất trước (tối đa 100 bài gần nhất mà Semantic Scholar trả về).
                aid = urllib.parse.unquote(seg[2])
                url = f"https://api.semanticscholar.org/graph/v1/author/{urllib.parse.quote(aid)}/papers?fields={fields}&limit=100"
                _, _, raw, _ = s2_get(url, headers=headers)
                items = json.loads(raw.decode("utf-8")).get("data") or []
                items.sort(key=lambda p: (p.get("publicationDate") or str(p.get("year") or "")), reverse=True)
                return self.ok(s2_add_tldr(items[:50], key))
            if len(seg) == 2 and seg[1] == "search":
                q = (qs.get("q") or [""])[0]
                url = f"https://api.semanticscholar.org/graph/v1/paper/search?query={urllib.parse.quote(q)}&fields={fields}&limit=20"
                _, _, raw, _ = s2_get(url, headers=headers)
                return self.ok(json.loads(raw.decode("utf-8")).get("data", []))

        if head == "sync" and method == "POST":
            body = self.read_json()
            root = body.get("root") or get_settings().get("exportDir")
            if not root:
                return self.error("Chưa cấu hình thư mục xuất trong Cài đặt.")
            return self.ok(write_files(root, body.get("files") or [], clean=bool(body.get("clean"))))

        if head == "backup" and method == "GET":
            return self.ok(backup_data((qs.get("texts") or ["0"])[0] == "1"))

        if head == "import" and method == "POST":
            body = self.read_json()
            try:
                return self.ok(import_data(body.get("data") or {}, merge=body.get("merge", True)))
            except ValueError as e:
                return self.error(str(e))

        if head == "backups":
            # /api/backups: GET danh sách · POST tạo bản sao lưu .zip · GET /api/backups/<tên> tải file
            # POST /api/backups/open mở thư mục · POST /api/backups/restore?merge=1 khôi phục (body = file .zip hoặc {"name"})
            sub = seg[1] if len(seg) > 1 else ""
            try:
                if method == "GET" and not sub:
                    return self.ok(list_backups())
                if method == "POST" and not sub:
                    return self.ok(make_backup_zip(auto=False))
                if method == "POST" and sub == "open":
                    d = backup_dir()
                    if sys.platform.startswith("win"):
                        os.startfile(str(d))  # type: ignore[attr-defined]
                    elif sys.platform == "darwin":
                        os.system(f'open "{d}"')
                    else:
                        os.system(f'xdg-open "{d}"')
                    return self.ok(str(d))
                if method == "POST" and sub == "restore":
                    merge = (qs.get("merge") or ["1"])[0] != "0"
                    ctype = self.headers.get("Content-Type") or ""
                    if ctype.startswith("application/json"):
                        name = (self.read_json().get("name") or "")
                        if not BACKUP_NAME.fullmatch(name):
                            return self.error("Tên file sao lưu không hợp lệ.")
                        return self.ok(restore_backup_zip(backup_dir() / name, merge=merge))
                    # file .zip tải lên (có thể lớn): ghi thẳng ra file tạm theo từng khúc
                    n = int(self.headers.get("Content-Length") or 0)
                    if not n or n > 8 * 1024 ** 3:
                        return self.error("File sao lưu trống hoặc quá lớn.")
                    tmp = backup_dir() / f"restore-{uid('r')}.zip.part"
                    try:
                        with open(tmp, "wb") as fh:
                            left = n
                            while left > 0:
                                chunk = self.rfile.read(min(left, 1024 * 1024))
                                if not chunk:
                                    break
                                fh.write(chunk)
                                left -= len(chunk)
                        return self.ok(restore_backup_zip(tmp, merge=merge))
                    finally:
                        try:
                            tmp.unlink()
                        except OSError:
                            pass
                if method == "GET" and BACKUP_NAME.fullmatch(sub):
                    p = backup_dir() / sub
                    if not p.exists():
                        return self.error("Không có file này.", 404)
                    return self.send_bytes(p.read_bytes(), "application/zip", extra={"Content-Disposition": f'attachment; filename="{sub}"'})
            except (ValueError, zipfile.BadZipFile, OSError) as e:
                return self.error(str(e))
            return self.error("Không hỗ trợ.", 404)

        if head == "print-doc" and method == "GET" and len(seg) == 2:
            doc = PRINT_DOCS.get(seg[1])
            if doc is None:
                return self.error("Không có.", 404)
            return self.send_bytes(doc.encode("utf-8"), "text/html; charset=utf-8")

        if head == "export" and method == "POST" and len(seg) == 2 and seg[1] == "pdf":
            # body: {"html": "<!doctype html>…"} (trang đầy đủ). Ảnh, CSS dạng đường dẫn tương đối lấy từ chính app.
            body = self.read_json()
            doc = str(body.get("html") or "")
            if not doc:
                return self.error("Thiếu nội dung.")
            base = f'<base href="http://127.0.0.1:{self.server.server_address[1]}/">'
            doc = re.sub(r"<head>", "<head>" + base, doc, count=1, flags=re.I) if re.search(r"<head>", doc, re.I) else base + doc
            try:
                return self.send_bytes(html_to_pdf(doc, self.server.server_address[1]), "application/pdf")
            except FileNotFoundError:
                return self.error("no-browser", 501)
            except Exception as e:
                return self.error(f"Không xuất được PDF: {e}")

        if head == "update-check" and method == "GET":
            try:
                return self.ok(update_check())
            except Exception as e:
                return self.error(f"Không kiểm tra được bản mới: {e}")

        if head == "open" and method == "POST":
            # mở thư mục xuất trong Explorer/Finder
            root = self.read_json().get("path") or get_settings().get("exportDir")
            if not root or not Path(root).exists():
                return self.error("Thư mục không tồn tại.")
            if sys.platform.startswith("win"):
                os.startfile(root)  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                os.system(f'open "{root}"')
            else:
                os.system(f'xdg-open "{root}"')
            return self.ok(True)

        if head == "health":
            return self.ok({"version": APP_VERSION, "db": str(DB_PATH), "dataDir": str(DATA), "pdfDir": str(PDF_DIR),
                            "papers": db_one("SELECT COUNT(*) FROM papers")[0], "configFile": str(HOME_DIR / "config.json")})

        return self.error(f"Không có API: {method} /api/{route}", 404)


def start_server(host=None, port=None):
    """Tạo máy chủ (chưa chạy). port=0 -> hệ điều hành tự chọn cổng trống. Trả về (server, url)."""
    host = host or HOST
    port = PORT if port is None else port
    srv = ThreadingHTTPServer((host, port), Handler)
    srv.daemon_threads = True
    return srv, f"http://{host}:{srv.server_address[1]}/"


def _warm_rankings():
    try:
        RANK.ensure()
        n = reclassify_all()
        if n:
            print(f"[PaperVault] Đã phân loại venue cho {n} paper.")
    except Exception as _e:  # pragma: no cover
        print("[PaperVault] rankings:", _e)


threading.Thread(target=_warm_rankings, daemon=True).start()
threading.Thread(target=_auto_backup_loop, daemon=True).start()

try:
    _purged = purge_trash(30)
    if _purged:
        print(f"[PaperVault] Đã xoá hẳn {_purged} paper trong thùng rác quá 30 ngày.")
except Exception as _e:
    print("[PaperVault] purge_trash:", _e)


def main():
    global PORT
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        PORT = int(sys.argv[1])
    srv, url = start_server()
    print(f"PaperVault App đang chạy tại {url}")
    print(f"Dữ liệu: {DB_PATH}")
    print("Nhấn Ctrl+C để dừng.")
    if os.environ.get("PV_NO_BROWSER") != "1" and CONFIG.get("openBrowser", True):
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
