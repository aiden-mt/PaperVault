"""Đọc thư viện Zotero trên máy (zotero.sqlite + thư mục storage/) để nhập vào PaperVault.

Zotero giữ khoá cơ sở dữ liệu khi đang chạy, nên app chép file ra thư mục tạm rồi đọc bản chép.
Chép không được thì thử bản sao lưu zotero.sqlite.bak mà Zotero tự tạo. Không ghi gì vào thư viện Zotero.
"""
import html
import os
import re
import shutil
import sqlite3
import tempfile
from pathlib import Path

SKIP_TYPES = ("attachment", "note", "annotation")


def candidate_dirs():
    """Các thư mục dữ liệu Zotero có thể có: mặc định ~/Zotero và thư mục tự chọn ghi trong prefs.js của Zotero."""
    out = []
    home = Path.home()
    out.append(home / "Zotero")
    roots = [Path(os.environ.get("APPDATA", home / "AppData" / "Roaming")) / "Zotero" / "Zotero" / "Profiles",
             home / "Library" / "Application Support" / "Zotero" / "Profiles", home / ".zotero" / "zotero"]
    for r in roots:
        try:
            for prefs in r.glob("*/prefs.js"):
                txt = prefs.read_text(encoding="utf-8", errors="replace")
                m = re.search(r'user_pref\("extensions\.zotero\.dataDir",\s*"((?:[^"\\]|\\.)*)"\);', txt)
                if m:
                    out.append(Path(m.group(1).encode().decode("unicode_escape")))
        except OSError:
            continue
    seen, res = set(), []
    for d in out:
        k = str(d).lower()
        if k not in seen and (d / "zotero.sqlite").exists():
            seen.add(k)
            res.append(d)
    return res


def _open_copy(data_dir):
    """Chép zotero.sqlite (hoặc .bak) ra thư mục tạm rồi mở chỉ đọc. Trả về (kết nối, thư mục tạm, dùng bản .bak?)."""
    tmp = tempfile.mkdtemp(prefix="pv_zotero_")
    last = None
    for name, is_bak in (("zotero.sqlite", False), ("zotero.sqlite.bak", True)):
        src = Path(data_dir) / name
        if not src.exists():
            continue
        dst = Path(tmp) / "z.sqlite"
        try:
            shutil.copyfile(src, dst)
            for ext in ("-wal", "-shm"):  # chế độ WAL: chép kèm để không thiếu dữ liệu mới ghi
                side = Path(str(src) + ext)
                if not is_bak and side.exists():
                    shutil.copyfile(side, Path(str(dst) + ext))
            con = sqlite3.connect(str(dst))  # bản chép tạm: mở thường để SQLite tự gộp WAL nếu có
            con.execute("SELECT 1 FROM items LIMIT 1")
            return con, tmp, is_bak
        except (OSError, sqlite3.Error) as e:
            last = e
            continue
    shutil.rmtree(tmp, ignore_errors=True)
    raise ValueError(f"Không đọc được thư viện Zotero ({last or 'không thấy zotero.sqlite'}). Đóng Zotero rồi thử lại.")


def _strip_note(h):
    """Ghi chú HTML của Zotero -> văn bản Markdown đơn giản."""
    s = str(h or "")
    s = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", "", s)
    s = re.sub(r"(?i)<h[1-3][^>]*>", "\n### ", s)
    s = re.sub(r"(?i)<li[^>]*>", "\n- ", s)
    s = re.sub(r"(?i)<br\s*/?>|</p>|</h[1-6]>|</div>|</li>|</blockquote>", "\n", s)
    s = re.sub(r"(?i)<(b|strong)>(.*?)</\1>", r"**\2**", s)
    s = re.sub(r"(?i)<(i|em)>(.*?)</\1>", r"*\2*", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    s = re.sub(r"[ \t]+\n", "\n", s)
    return re.sub(r"\n{3,}", "\n\n", s).strip()


def _year(s):
    m = re.search(r"(19|20)\d{2}", str(s or ""))
    return m.group(0) if m else ""


def _arxiv(fields):
    for k in ("extra", "url", "archiveID", "DOI", "publicationTitle"):
        m = re.search(r"(?:arxiv[:./\s]*(?:abs/)?)(\d{4}\.\d{4,5}(?:v\d+)?)", str(fields.get(k) or ""), re.I)
        if m:
            return re.sub(r"v\d+$", "", m.group(1))
    return ""


def read_library(data_dir):
    """Đọc toàn bộ mục (không gồm tệp đính kèm / ghi chú lẻ / mục trong thùng rác) của thư viện Zotero."""
    data_dir = Path(data_dir)
    con, tmp, is_bak = _open_copy(data_dir)
    try:
        q = lambda sql, a=(): con.execute(sql, a).fetchall()  # noqa: E731
        tables = {r[0] for r in q("SELECT name FROM sqlite_master WHERE type='table'")}
        fields_tbl = "fieldsCombined" if "fieldsCombined" in tables else "fields"
        deleted = {r[0] for r in q("SELECT itemID FROM deletedItems")} if "deletedItems" in tables else set()
        lib_filter = "AND i.libraryID = 1" if "libraries" in tables else ""  # chỉ thư viện cá nhân, bỏ nhóm
        rows = q(f"""SELECT i.itemID, i.key, t.typeName, i.dateAdded FROM items i JOIN itemTypes t ON t.itemTypeID = i.itemTypeID
                    WHERE t.typeName NOT IN ({','.join('?' * len(SKIP_TYPES))}) {lib_filter}""", SKIP_TYPES)
        items = {}
        for iid, key, typ, added in rows:
            if iid in deleted:
                continue
            items[iid] = {"key": key, "type": typ, "dateAdded": added or "", "fields": {}, "authors": [], "tags": [],
                          "collections": [], "notes": [], "pdfs": [], "annotations": []}
        for iid, name, val in q(f"""SELECT d.itemID, f.fieldName, v.value FROM itemData d JOIN {fields_tbl} f ON f.fieldID = d.fieldID
                                   JOIN itemDataValues v ON v.valueID = d.valueID"""):
            if iid in items:
                items[iid]["fields"][name] = val
        ctype = {r[0]: r[1] for r in q("SELECT creatorTypeID, creatorType FROM creatorTypes")} if "creatorTypes" in tables else {}
        editors = {}
        for iid, first, last, tid in q("""SELECT ic.itemID, c.firstName, c.lastName, ic.creatorTypeID FROM itemCreators ic
                                         JOIN creators c ON c.creatorID = ic.creatorID ORDER BY ic.itemID, ic.orderIndex"""):
            if iid not in items:
                continue
            name = " ".join(x for x in (first, last) if x).strip()
            if not name:
                continue
            if ctype.get(tid, "author") in ("author", "inventor", "presenter", "programmer", "artist", "director"):
                items[iid]["authors"].append(name)
            else:
                editors.setdefault(iid, []).append(name)
        for iid, names in editors.items():
            if not items[iid]["authors"]:
                items[iid]["authors"] = names
        for iid, name in q("SELECT it.itemID, t.name FROM itemTags it JOIN tags t ON t.tagID = it.tagID"):
            if iid in items and name and not name.startswith("_"):
                items[iid]["tags"].append(name)
        cols = {}
        if "collections" in tables:
            for cid, name, parent, key in q("SELECT collectionID, collectionName, parentCollectionID, key FROM collections"):
                cols[cid] = {"id": cid, "key": key, "name": name, "parent": parent, "count": 0}
            for cid, iid in q("SELECT collectionID, itemID FROM collectionItems"):
                if iid in items and cid in cols:
                    items[iid]["collections"].append(cols[cid]["key"])
                    cols[cid]["count"] += 1
        for parent, note in q("SELECT parentItemID, note FROM itemNotes WHERE parentItemID IS NOT NULL"):
            if parent in items:
                t = _strip_note(note)
                if t:
                    items[parent]["notes"].append(t)
        att_parent = {}
        for parent, aid, ct, path, akey in q("""SELECT a.parentItemID, a.itemID, a.contentType, a.path, i.key FROM itemAttachments a
                                              JOIN items i ON i.itemID = a.itemID WHERE a.parentItemID IS NOT NULL"""):
            if parent not in items or aid in deleted:
                continue
            is_pdf = (ct or "").lower() == "application/pdf" or str(path or "").lower().endswith(".pdf")
            if not is_pdf or not path:
                continue
            p = str(path)
            if p.startswith("storage:"):
                f = data_dir / "storage" / akey / p[len("storage:"):]
            elif p.startswith("attachments:"):
                f = None  # đường dẫn tương đối theo "thư mục gốc tệp đính kèm" của Zotero: không biết chắc thư mục đó
            else:
                f = Path(p)
            if f is not None and f.exists():
                items[parent]["pdfs"].append(str(f))
                att_parent[aid] = parent
        if "itemAnnotations" in tables:
            for aid, typ, text, comment, page in q("""SELECT parentItemID, type, text, comment, pageLabel FROM itemAnnotations"""):
                parent = att_parent.get(aid)
                if parent and (text or comment):
                    items[parent]["annotations"].append({"quote": (text or "").strip(), "note": (comment or "").strip(), "page": str(page or "")})
        out = []
        for iid, it in items.items():
            f = it["fields"]
            title = (f.get("title") or "").strip()
            if not title:
                continue
            venue = f.get("publicationTitle") or f.get("proceedingsTitle") or f.get("conferenceName") or f.get("bookTitle") \
                or f.get("websiteTitle") or f.get("repository") or f.get("university") or f.get("publisher") or ""
            doi = (f.get("DOI") or "").strip()
            if not doi:
                m = re.search(r"\bDOI:\s*(10\.\d{4,9}/\S+)", f.get("extra") or "", re.I)
                doi = m.group(1) if m else ""
            out.append({
                "key": it["key"], "type": it["type"], "title": title, "authors": it["authors"][:12], "year": _year(f.get("date")),
                "venue": venue.strip(), "doi": doi, "arxivId": _arxiv(f), "url": (f.get("url") or "").strip(),
                "abstract": (f.get("abstractNote") or "").strip(), "tags": it["tags"][:20], "collections": it["collections"],
                "notes": it["notes"], "pdfs": it["pdfs"][:3], "annotations": it["annotations"][:300], "dateAdded": it["dateAdded"],
            })
        out.sort(key=lambda x: x["dateAdded"], reverse=True)
        collections = [{"key": c["key"], "name": c["name"], "parent": cols[c["parent"]]["key"] if c["parent"] in cols else None,
                        "count": c["count"]} for c in cols.values()]
        return {"dir": str(data_dir), "items": out, "collections": collections, "fromBackup": is_bak}
    finally:
        con.close()
        shutil.rmtree(tmp, ignore_errors=True)
