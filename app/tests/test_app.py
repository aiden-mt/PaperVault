"""Bộ test tự động của PaperVault: máy chủ (API) và các hàm JS (chạy trong Edge / Chrome ẩn).

    cd app
    python -m unittest discover -s tests -v

Chạy trên thư mục dữ liệu tạm (PV_DATA), không đụng dữ liệu thật, không gọi model, không cần mạng.
Máy không có Edge / Chrome thì bỏ qua phần test JS.
"""
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="pv_test_"))
os.environ["PV_DATA"] = str(TMP / "data")
os.environ["PV_TEST"] = "1"
sys.path.insert(0, str(APP))

import server  # noqa: E402  (cần PV_DATA trước khi import)

server.Handler.log_message = lambda *a: None  # bớt log từng request khi chạy test
SRV, URL = server.start_server(host="127.0.0.1", port=0)
threading.Thread(target=SRV.serve_forever, daemon=True).start()


def call(method, path, body=None, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(URL + path.lstrip("/"), data=data, method=method, headers={"Content-Type": ctype} if data is not None else {})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"null")
        except ValueError:
            return e.code, None


def tearDownModule():
    SRV.shutdown()
    shutil.rmtree(TMP, ignore_errors=True)


class HealthTest(unittest.TestCase):
    def test_health(self):
        st, r = call("GET", "api/health")
        self.assertEqual(st, 200)
        self.assertEqual(r["data"]["version"], server.APP_VERSION)
        self.assertTrue(r["data"]["dataDir"].startswith(str(TMP)), "phải chạy trên thư mục dữ liệu tạm")


class PagesTest(unittest.TestCase):
    def test_crud_conflict_force_versions(self):
        st, r = call("POST", "api/pages", {"title": "Ghi chú", "content": "dòng 1"})
        self.assertEqual(st, 200)
        p = r["data"]
        # sửa bình thường (đúng mốc) thì được
        st, r = call("POST", "api/pages", {**p, "content": "dòng 1\ndòng 2", "baseUpdatedAt": p["updatedAt"]})
        self.assertEqual(st, 200)
        p2 = r["data"]
        # nơi khác sửa theo mốc cũ, nội dung khác -> 409 kèm bản hiện có
        st, r = call("POST", "api/pages", {**p, "content": "bản khác", "baseUpdatedAt": p["updatedAt"]})
        self.assertEqual(st, 409)
        self.assertEqual(r["error"], "conflict")
        self.assertEqual(r["current"]["content"], "dòng 1\ndòng 2")
        # theo mốc cũ nhưng nội dung trùng bản hiện có (chỉ đổi icon, sao…) -> không coi là xung đột
        st, _ = call("POST", "api/pages", {**p2, "fav": True, "baseUpdatedAt": p["updatedAt"]})
        self.assertEqual(st, 200)
        # chọn "Giữ bản của tôi" -> ghi đè, bản bị đè vào lịch sử
        st, r = call("POST", "api/pages", {**p, "content": "bản khác", "baseUpdatedAt": p["updatedAt"], "force": True})
        self.assertEqual(st, 200)
        self.assertEqual(r["data"]["content"], "bản khác")
        st, r = call("GET", f"api/pages/{p['id']}/versions")
        self.assertEqual(st, 200)
        self.assertTrue(r["data"], "phải có ít nhất một phiên bản")
        vid = r["data"][0]["id"]
        st, r = call("GET", f"api/pages/{p['id']}/versions/{vid}")
        self.assertEqual(r["data"]["content"], "dòng 1\ndòng 2")
        st, r = call("POST", f"api/pages/{p['id']}/versions/{vid}/restore")
        self.assertEqual(r["data"]["content"], "dòng 1\ndòng 2")
        st, _ = call("DELETE", f"api/pages/{p['id']}")
        self.assertEqual(st, 200)
        _, r = call("GET", "api/pages")
        self.assertNotIn(p["id"], [x["id"] for x in r["data"]])


class BackupTest(unittest.TestCase):
    def test_backup_list_and_bad_names(self):
        st, r = call("POST", "api/backups")
        self.assertEqual(st, 200, r)
        name = r["data"]["name"]
        _, r = call("GET", "api/backups")
        self.assertIn(name, [x["name"] for x in r["data"]["list"]])
        st, _ = call("POST", "api/backups/restore", {"name": "../../etc/passwd"})
        self.assertNotEqual(st, 200)
        st, _ = call("POST", "api/backups/restore", raw=b"not a zip file", ctype="application/zip")
        self.assertNotEqual(st, 200)


_seeded = []


def seed_usage():
    """Chi phí tháng này = $18 (1 triệu token vào × $3 + 1 triệu token ra × $15). Chỉ ghi một lần."""
    if _seeded:
        return
    _seeded.append(1)
    call("POST", "api/settings", {"autoPrices": False, "prices": {"anthropic/claude-test": {"in": 3, "out": 15}}})
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    call("POST", "api/usage", {"at": now, "provider": "anthropic", "model": "claude-test", "task": "chat", "inputTokens": 1_000_000, "outputTokens": 1_000_000})
    call("POST", "api/usage", {"at": now, "provider": "openai", "model": "no-price", "task": "chat", "inputTokens": 10, "outputTokens": 10})


class UsageCostTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        seed_usage()

    def test_cost_this_month(self):
        start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0).strftime("%Y-%m-%dT%H:%M:%S")
        st, r = call("GET", "api/usage/cost?since=" + urllib.parse.quote(start))
        self.assertEqual(st, 200)
        self.assertAlmostEqual(r["data"]["cost"], 18.0, places=4)
        self.assertIn("openai/no-price", r["data"]["missingPrice"])


class IcsFetchTest(unittest.TestCase):
    def test_rejects_bad_urls(self):
        for u in ("", "file:///C:/Windows/win.ini", "http://127.0.0.1:1/a.ics", "http://localhost/x.ics", "ftp://example.com/a.ics"):
            st, r = call("GET", "api/ics-fetch?url=" + urllib.parse.quote(u))
            self.assertEqual(st, 400, (u, r))
            self.assertFalse(r["ok"])


def make_zotero_fixture(root: Path):
    """Một thư viện Zotero thu nhỏ đúng các bảng app đọc."""
    (root / "storage" / "ATT1").mkdir(parents=True)
    (root / "storage" / "ATT1" / "attention.pdf").write_bytes(b"%PDF-1.4\n% test\n")
    con = sqlite3.connect(root / "zotero.sqlite")
    con.executescript("""
    CREATE TABLE libraries (libraryID INTEGER PRIMARY KEY);
    CREATE TABLE itemTypes (itemTypeID INTEGER PRIMARY KEY, typeName TEXT);
    CREATE TABLE items (itemID INTEGER PRIMARY KEY, itemTypeID INT, libraryID INT, key TEXT, dateAdded TEXT);
    CREATE TABLE fields (fieldID INTEGER PRIMARY KEY, fieldName TEXT);
    CREATE TABLE itemDataValues (valueID INTEGER PRIMARY KEY, value TEXT);
    CREATE TABLE itemData (itemID INT, fieldID INT, valueID INT);
    CREATE TABLE creators (creatorID INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
    CREATE TABLE creatorTypes (creatorTypeID INTEGER PRIMARY KEY, creatorType TEXT);
    CREATE TABLE itemCreators (itemID INT, creatorID INT, creatorTypeID INT, orderIndex INT);
    CREATE TABLE tags (tagID INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE itemTags (itemID INT, tagID INT);
    CREATE TABLE collections (collectionID INTEGER PRIMARY KEY, collectionName TEXT, parentCollectionID INT, key TEXT);
    CREATE TABLE collectionItems (collectionID INT, itemID INT);
    CREATE TABLE itemNotes (itemID INT, parentItemID INT, note TEXT);
    CREATE TABLE itemAttachments (itemID INT, parentItemID INT, contentType TEXT, path TEXT);
    CREATE TABLE itemAnnotations (itemID INT, parentItemID INT, type INT, text TEXT, comment TEXT, pageLabel TEXT);
    CREATE TABLE deletedItems (itemID INT);
    INSERT INTO libraries VALUES (1), (2);
    INSERT INTO itemTypes VALUES (1, 'journalArticle'), (2, 'attachment'), (3, 'note'), (4, 'book'), (5, 'annotation');
    INSERT INTO items VALUES (1, 1, 1, 'ITEM1', '2024-01-02 10:00:00'), (2, 1, 1, 'GONE1', '2024-01-03 10:00:00'),
      (3, 2, 1, 'ATT1', '2024-01-02 10:00:01'), (4, 3, 1, 'NOTE1', '2024-01-02 10:00:02'), (5, 4, 1, 'BOOK1', '2024-01-01 10:00:00'),
      (6, 1, 2, 'GROUP1', '2024-01-05 10:00:00'), (7, 5, 1, 'ANN1', '2024-01-02 10:00:03');
    INSERT INTO fields VALUES (1, 'title'), (2, 'date'), (3, 'DOI'), (4, 'url'), (5, 'publicationTitle'), (6, 'abstractNote'), (7, 'extra');
    INSERT INTO itemDataValues VALUES (1, 'Attention Is All You Need'), (2, '2017-06-12'), (3, '10.48550/arXiv.1706.03762'),
      (4, 'https://arxiv.org/abs/1706.03762v5'), (5, 'NeurIPS'), (6, 'Transformer abstract'), (7, 'Đã xoá'), (8, 'Sách biên tập'),
      (9, '2020'), (10, 'Nhóm'), (11, 'arXiv: 2101.00001');
    INSERT INTO itemData VALUES (1,1,1),(1,2,2),(1,3,3),(1,4,4),(1,5,5),(1,6,6),(2,1,7),(5,1,8),(5,2,9),(5,7,11),(6,1,10);
    INSERT INTO creators VALUES (1, 'Ashish', 'Vaswani'), (2, 'Noam', 'Shazeer'), (3, 'An', 'Editor');
    INSERT INTO creatorTypes VALUES (1, 'author'), (2, 'editor');
    INSERT INTO itemCreators VALUES (1, 2, 1, 1), (1, 1, 1, 0), (5, 3, 2, 0);
    INSERT INTO tags VALUES (1, 'transformer'), (2, '_tab_hidden');
    INSERT INTO itemTags VALUES (1, 1), (1, 2);
    INSERT INTO collections VALUES (1, 'Research', NULL, 'COLR'), (2, 'NLP', 1, 'COLN');
    INSERT INTO collectionItems VALUES (2, 1), (1, 5);
    INSERT INTO itemNotes VALUES (4, 1, '<h1>Ý chính</h1><p>Dùng <b>self-attention</b> &amp; bỏ RNN.</p><ul><li>một</li><li>hai</li></ul>');
    INSERT INTO itemAttachments VALUES (3, 1, 'application/pdf', 'storage:attention.pdf');
    INSERT INTO itemAnnotations VALUES (7, 3, 1, 'Attention is all you need', 'câu chủ đề', '1');
    INSERT INTO deletedItems VALUES (2);
    """)
    con.commit()
    con.close()


class ZoteroTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = TMP / "Zotero"
        cls.dir.mkdir()
        make_zotero_fixture(cls.dir)

    def test_scan_and_pdf(self):
        st, r = call("GET", "api/zotero/scan?dir=" + urllib.parse.quote(str(self.dir)))
        self.assertEqual(st, 200, r)
        lib = r["data"]
        self.assertTrue(lib["found"])
        items = {x["key"]: x for x in lib["items"]}
        self.assertEqual(set(items), {"ITEM1", "BOOK1"}, "bỏ mục đã xoá, tệp đính kèm, ghi chú lẻ, thư viện nhóm")
        a = items["ITEM1"]
        self.assertEqual(a["authors"], ["Ashish Vaswani", "Noam Shazeer"])
        self.assertEqual([a["year"], a["venue"], a["arxivId"], a["tags"], a["collections"]], ["2017", "NeurIPS", "1706.03762", ["transformer"], ["COLN"]])
        self.assertEqual(len(a["pdfs"]), 1)
        self.assertIn("**self-attention** & bỏ RNN.", a["notes"][0])
        self.assertIn("- một", a["notes"][0])
        self.assertEqual(a["annotations"], [{"quote": "Attention is all you need", "note": "câu chủ đề", "page": "1"}])
        b = items["BOOK1"]
        self.assertEqual([b["authors"], b["arxivId"], b["collections"]], [["An Editor"], "2101.00001", ["COLR"]])
        cols = {c["key"]: c for c in lib["collections"]}
        self.assertEqual(cols["COLN"]["parent"], "COLR")
        # chép PDF: chỉ file có trong lần quét
        st, r = call("POST", "api/zotero/pdf", {"path": a["pdfs"][0]})
        self.assertEqual(st, 200, r)
        self.assertTrue(r["data"]["id"].startswith("f_"))
        st, _ = call("POST", "api/zotero/pdf", {"path": str(APP / "server.py")})
        self.assertEqual(st, 400)

    def test_bad_dir(self):
        st, r = call("GET", "api/zotero/scan?dir=" + urllib.parse.quote(str(TMP)))
        self.assertEqual(st, 400)
        self.assertIn("zotero.sqlite", r["error"])


class JsTest(unittest.TestCase):
    """Các hàm thuần JS (tests/js/tests.js) chạy trong trình duyệt ẩn, gọi API của máy chủ test này."""

    def test_js_suite(self):
        exe = server.find_browser()
        if not exe:
            self.skipTest("Không có Edge / Chrome")
        seed_usage()  # chi phí tháng này cho test ngân sách
        prof = tempfile.mkdtemp(prefix="pv_edge_")
        try:
            res = subprocess.run([exe, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", f"--user-data-dir={prof}",
                                  "--virtual-time-budget=30000", "--dump-dom", URL + "__tests__/run.html"],
                                 capture_output=True, timeout=120, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        finally:
            shutil.rmtree(prof, ignore_errors=True)
        dom = res.stdout.decode("utf-8", errors="replace")
        i = dom.find("RESULT:")
        self.assertGreaterEqual(i, 0, f"trang test không chạy xong:\n{dom[:2000]}\n{res.stderr.decode(errors='replace')[:1000]}")
        import html as _h
        payload = _h.unescape(dom[i + 7:dom.index("</pre>", i)])
        results = json.loads(payload)
        bad = [r for r in results if not r["ok"]]
        for r in results:
            print(("  ✓ " if r["ok"] else "  ✗ ") + r["name"])
        self.assertGreaterEqual(len(results), 10)
        self.assertFalse(bad, "\n\n".join(f"{r['name']}:\n{r.get('error')}" for r in bad))


if __name__ == "__main__":
    unittest.main(verbosity=2)
