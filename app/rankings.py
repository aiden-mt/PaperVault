"""Nhận diện loại venue và xếp hạng.

- Hội nghị: bảng CORE/ICORE (portal.core.edu.au) -> A*, A, B, C, National, Unranked...
- Tạp chí / book series / kỷ yếu: Scimago Journal Rank (scimagojr.com) -> Q1..Q4, SJR, H-index.

Dữ liệu đóng gói sẵn trong thư mục rankings/ cạnh mã nguồn; bản cập nhật trực tuyến được ghi vào
<thư mục dữ liệu>/rankings/ và được ưu tiên khi nạp.
"""
import csv
import gzip
import io
import json
import re
import threading
import time
from pathlib import Path

CORE_PORTAL = "https://portal.core.edu.au/conf-ranks/"
SJR_EXPORT = "https://www.scimagojr.com/journalrank.php?out=xls"
BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.scimagojr.com/journalrank.php",
}

# Từ không mang nghĩa phân biệt khi so tên hội nghị.
CONF_STOP = {
    "the", "of", "on", "and", "in", "for", "a", "an", "at", "to", "with", "ieee", "acm", "cvf", "international",
    "annual", "proceedings", "proc", "conference", "conf", "symposium", "joint", "meeting", "usenix", "siam",
    "iapr", "ifip", "isca", "springer", "lncs", "volume", "vol", "part", "workshop", "workshops", "forum",
    "congress", "edition", "papers", "main", "track", "long", "short", "companion", "rsj", "iee", "eurographics",
}
ORDINAL_WORDS = {
    "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh",
    "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth",
    "twentieth", "thirtieth", "fortieth", "fiftieth", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
}
JOURNAL_STOP = {"the", "of", "and", "on", "in", "for", "a", "an", "&"}
JOURNAL_WORDS = re.compile(r"\b(journal|transactions|trans\.|letters|magazine|review|reviews|reports|bulletin|annals|quarterly)\b", re.I)
CONF_WORDS = re.compile(r"\b(conference|proceedings|symposium|congress|meeting|colloquium|summit)\b", re.I)
WORKSHOP_RE = re.compile(r"\bworkshops?\b|\bwksp\b|\bw\d{1,2}\b|\bwkshp\b", re.I)
FINDINGS_RE = re.compile(r"\bfindings\b", re.I)
PREPRINT_RE = re.compile(r"\b(arxiv|biorxiv|medrxiv|preprint|ssrn|techrxiv|openreview preprint|corr)\b", re.I)
THESIS_RE = re.compile(r"\b(thesis|dissertation|ph\.?d|master'?s)\b", re.I)
BOOK_RE = re.compile(r"\b(book|handbook|encyclopedia|chapter)\b", re.I)

# Tên viết tắt dễ trùng từ chung hoặc là tên tổ chức, không dùng để nhận diện hội nghị.
GENERIC_ACRONYMS = {"IEEE", "ACM", "CVF", "IAPR", "IFIP", "ISCA", "SPIE", "SIAM", "USA", "AI", "ML", "NLP", "CV",
                    "LNCS", "LNAI", "CCIS", "PMLR", "JMLR", "PROC", "IET", "IOS", "AAAS", "PLOS", "BMC", "MDPI", "II", "III", "IV"}
# Cách viết khác -> acronym trong CORE.
ACRONYM_ALIASES = {"NIPS": "NeurIPS", "NEURIPS": "NeurIPS", "ACM MM": "ACMMM", "ACMMM": "ACMMM", "THEWEBCONF": "WWW",
                   "INTERSPEECH": "Interspeech", "SIGKDD": "KDD", "ECML-PKDD": "ECML PKDD", "ECMLPKDD": "ECML PKDD",
                   "ICCVW": "ICCV", "CVPRW": "CVPR", "ECCVW": "ECCV", "WACVW": "WACV"}
# Cụm tên đặc trưng -> acronym (dùng khi tên đầy đủ khác nhiều so với tên trong CORE).
TITLE_PATTERNS = [
    (re.compile(r"acm (international )?(conference on )?multimedia\b|\bmm '\d\d", re.I), "ACMMM"),
    (re.compile(r"\bthe web conference\b|\bworld wide web\b", re.I), "WWW"),
    (re.compile(r"neural information processing systems", re.I), "NeurIPS"),
    (re.compile(r"\binterspeech\b", re.I), "Interspeech"),
]
WORKSHOP_SUFFIX_ACR = {"CVPRW": "CVPR", "ICCVW": "ICCV", "ECCVW": "ECCV", "WACVW": "WACV"}
# Viết tắt tạp chí phổ biến trong AI/CV/NLP -> tên đầy đủ trong SJR.
JOURNAL_ABBR = {
    "TPAMI": "IEEE Transactions on Pattern Analysis and Machine Intelligence",
    "PAMI": "IEEE Transactions on Pattern Analysis and Machine Intelligence",
    "IJCV": "International Journal of Computer Vision",
    "TIP": "IEEE Transactions on Image Processing",
    "TNNLS": "IEEE Transactions on Neural Networks and Learning Systems",
    "TMM": "IEEE Transactions on Multimedia",
    "TCSVT": "IEEE Transactions on Circuits and Systems for Video Technology",
    "TKDE": "IEEE Transactions on Knowledge and Data Engineering",
    "TVCG": "IEEE Transactions on Visualization and Computer Graphics",
    "TOG": "ACM Transactions on Graphics",
    "TASLP": "IEEE/ACM Transactions on Audio Speech and Language Processing",
    "TMI": "IEEE Transactions on Medical Imaging",
    "JBHI": "IEEE Journal of Biomedical and Health Informatics",
    "TACL": "Transactions of the Association for Computational Linguistics",
    "JMLR": "Journal of Machine Learning Research",
    "TMLR": "Transactions on Machine Learning Research",
    "CVIU": "Computer Vision and Image Understanding",
    "MEDIA": "Medical Image Analysis",
    "TIST": "ACM Transactions on Intelligent Systems and Technology",
    "TOIS": "ACM Transactions on Information Systems",
    "JAIR": "Journal of Artificial Intelligence Research",
    "AIJ": "Artificial Intelligence",
    "TCYB": "IEEE Transactions on Cybernetics",
    "TITS": "IEEE Transactions on Intelligent Transportation Systems",
    "TRO": "IEEE Transactions on Robotics",
    "RAL": "IEEE Robotics and Automation Letters",
    "RA-L": "IEEE Robotics and Automation Letters",
    "PRL": "Pattern Recognition Letters",
    "NCA": "Neural Computing and Applications",
}

RANK_ORDER = {"A*": 0, "A": 1, "B": 2, "C": 3, "Australasian A": 4, "Australasian B": 5, "Australasian C": 6}
QUARTILE_ORDER = {"Q1": 0, "Q2": 1, "Q3": 2, "Q4": 3}


def _strip_paren(s):
    return re.sub(r"\([^)]*\)", " ", s or "")


def _tokens(s, stop):
    s = (s or "").lower().replace("&", " and ")
    toks = re.findall(r"[a-z][a-z0-9\-]*", s)
    out = set()
    for t in toks:
        t = t.strip("-")
        if not t or t in stop or t in ORDINAL_WORDS:
            continue
        if re.fullmatch(r"\d+(st|nd|rd|th)?", t):
            continue
        out.add(t)
    return out


def norm_title(s):
    s = (s or "").lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return re.sub(r"^the ", "", s)


def norm_issn(s):
    d = re.sub(r"[^0-9xX]", "", s or "").upper()
    return d if len(d) == 8 else ""


def _num(s):
    try:
        return float(str(s).replace(",", "."))
    except (TypeError, ValueError):
        return None


class Rankings:
    def __init__(self, bundled_dir, data_dir, http_get=None):
        self.bundled_dir = Path(bundled_dir)
        self.data_dir = Path(data_dir)
        self.http_get = http_get
        self._lock = threading.RLock()
        self.loaded = False
        self.core = []
        self.core_by_acr = {}
        self.sjr = []
        self.sjr_by_title = {}
        self.sjr_by_issn = {}
        self.info = {"core": None, "sjr": None}

    # ------------------------------------------------------------------ nạp dữ liệu

    def _pick(self, pattern):
        """Tệp mới nhất: ưu tiên bản cập nhật trong data_dir, sau đó bản đóng gói."""
        for base in (self.data_dir, self.bundled_dir):
            if base.exists():
                files = sorted(base.glob(pattern), key=lambda p: p.name, reverse=True)
                if files:
                    return files[0]
        return None

    def ensure(self):
        if self.loaded:
            return
        with self._lock:
            if self.loaded:
                return
            self._load_core()
            self._load_sjr()
            self.loaded = True

    def reload(self):
        with self._lock:
            self.loaded = False
            self.core, self.core_by_acr, self.sjr, self.sjr_by_title, self.sjr_by_issn = [], {}, [], {}, {}
        self.ensure()

    def version(self):
        self.ensure()
        c = self.info.get("core") or {}
        j = self.info.get("sjr") or {}
        return f"{c.get('source', '-')}/{j.get('year', '-')}/v3"

    def _load_core(self):
        f = self._pick("core_*.csv")
        if not f:
            self.info["core"] = None
            return
        rows = [r for r in csv.reader(io.StringIO(f.read_text(encoding="utf-8"))) if len(r) >= 5]
        for r in rows:
            item = {"id": r[0], "title": r[1].strip(), "acronym": r[2].strip(), "source": r[3].strip(), "rank": r[4].strip()}
            item["tokens"] = _tokens(_strip_paren(item["title"]), CONF_STOP)
            self.core.append(item)
            self.core_by_acr.setdefault(item["acronym"].upper(), []).append(item)
        src = rows[0][3] if rows else f.stem.replace("core_", "")
        self.info["core"] = {"source": src, "count": len(self.core), "file": f.name,
                             "updated": time.strftime("%Y-%m-%d", time.localtime(f.stat().st_mtime))}

    def _load_sjr(self):
        f = self._pick("sjr_*.csv.gz")
        if not f:
            self.info["sjr"] = None
            return
        text = gzip.decompress(f.read_bytes()).decode("utf-8", errors="replace")
        reader = csv.reader(io.StringIO(text), delimiter=";")
        head = next(reader)
        ix = {k: i for i, k in enumerate(head)}
        for r in reader:
            if len(r) < len(head):
                continue
            item = {
                "title": r[ix["Title"]], "type": r[ix["Type"]], "issn": [norm_issn(x) for x in r[ix["Issn"]].split(",") if norm_issn(x)],
                "sjr": _num(r[ix["SJR"]]), "quartile": r[ix["SJR Best Quartile"]] if r[ix["SJR Best Quartile"]] in QUARTILE_ORDER else "",
                "h": int(r[ix["H index"]]) if r[ix["H index"]].isdigit() else None, "publisher": r[ix["Publisher"]],
                "categories": r[ix["Categories"]],
            }
            item["norm"] = norm_title(item["title"])
            item["tokens"] = _tokens(item["title"], JOURNAL_STOP)
            self.sjr.append(item)
            prev = self.sjr_by_title.get(item["norm"])
            if not prev or (item["sjr"] or 0) > (prev["sjr"] or 0):
                self.sjr_by_title[item["norm"]] = item
            for i in item["issn"]:
                self.sjr_by_issn.setdefault(i, item)
        m = re.search(r"sjr_(\d{4})", f.name)
        self.info["sjr"] = {"year": m.group(1) if m else "?", "count": len(self.sjr), "file": f.name,
                            "updated": time.strftime("%Y-%m-%d", time.localtime(f.stat().st_mtime))}

    # ------------------------------------------------------------------ so khớp

    def _core_by_acronym(self, v):
        """Tìm acronym CORE xuất hiện trong chuỗi venue. Trả về (item, token) hoặc (None, None)."""
        text = v or ""
        for rx, acr in TITLE_PATTERNS:
            if rx.search(text):
                items = self.core_by_acr.get(acr.upper())
                if items:
                    return items[0], acr
        # acronym nhiều từ / có ký tự đặc biệt (ECML PKDD, IEEE VIS, EuroS&P...)
        low = text.lower()
        for key, items in self.core_by_acr.items():
            if (" " in key or not key.replace("-", "").isalnum()) and len(key) >= 4:
                if re.search(r"(?<![a-z0-9])" + re.escape(key.lower()) + r"(?![a-z0-9])", low):
                    return items[0], items[0]["acronym"]
        candidates = []
        for tok in re.findall(r"[A-Za-z][A-Za-z0-9\-]*[A-Za-z0-9*]|[A-Z]{2,}", text):
            up = tok.upper()
            alias = ACRONYM_ALIASES.get(up)
            if alias:
                up = alias.upper()
            elif up in GENERIC_ACRONYMS:
                continue
            elif sum(1 for ch in tok if ch.isupper()) < 2:
                continue
            if up in self.core_by_acr:
                candidates.append((up, tok))
        if not candidates:
            return None, None
        # ưu tiên acronym nằm trong ngoặc, rồi acronym đầu tiên
        paren = set(re.findall(r"\(([^)]*)\)", text))
        candidates.sort(key=lambda c: (0 if any(c[1] in p for p in paren) else 1))
        up, tok = candidates[0]
        items = self.core_by_acr[up]
        if len(items) > 1:  # acronym trùng: chọn theo độ giống tên
            vt = _tokens(_strip_paren(text), CONF_STOP)
            items = sorted(items, key=lambda it: -len(it["tokens"] & vt))
        return items[0], tok

    def _core_by_title(self, v):
        vt = _tokens(_strip_paren(v), CONF_STOP)
        if len(vt) < 2:
            return None
        best, best_key = None, None
        for it in self.core:
            t = it["tokens"]
            if len(t) < 2:
                continue
            inter = len(t & vt)
            if not inter:
                continue
            recall, precision = inter / len(t), inter / len(vt)
            if not ((recall == 1 and precision >= 0.6) or (recall >= 0.8 and precision >= 0.8)):
                continue
            key = (recall, precision, len(t))
            if best_key is None or key > best_key:
                best, best_key = it, key
        return best

    def _sjr_match(self, v, issns=()):
        for i in issns or ():
            it = self.sjr_by_issn.get(norm_issn(i))
            if it:
                return it, "issn"
        n = norm_title(v)
        if n and n in self.sjr_by_title:
            return self.sjr_by_title[n], "title"
        vt = _tokens(v, JOURNAL_STOP)
        if len(vt) < 2:
            return None, None
        best, best_score = None, 0
        for it in self.sjr:
            t = it["tokens"]
            if abs(len(t) - len(vt)) > 1:
                continue
            inter = len(t & vt)
            if not inter:
                continue
            score = inter / len(t | vt)
            if score > best_score:
                best, best_score = it, score
        if best and best_score >= 0.85:
            return best, "fuzzy"
        return None, None

    # ------------------------------------------------------------------ phân loại

    def _core_result(self, item, typ, note="", parent=False):
        res = {"type": typ, "system": item["source"], "acronym": item["acronym"], "name": item["title"],
               "matchedBy": "core"}
        if parent:
            res["parent"] = {"acronym": item["acronym"], "name": item["title"], "rank": item["rank"], "system": item["source"]}
            res["rank"] = ""
        else:
            res["rank"] = item["rank"]
        if note:
            res["note"] = note
        return res

    def _sjr_result(self, item, how, typ=None):
        t = {"journal": "journal", "trade journal": "journal", "book series": "book-series",
             "conference and proceedings": "conference"}.get(item["type"], "journal")
        return {"type": typ or t, "name": item["title"], "system": f"SJR {self.info['sjr']['year']}",
                "quartile": item["quartile"], "sjr": item["sjr"], "hIndex": item["h"], "publisher": item["publisher"],
                "categories": item["categories"][:300], "sjrType": item["type"], "matchedBy": f"sjr-{how}"}

    def classify(self, candidates, hints=None, has_arxiv=False):
        """candidates: danh sách chuỗi venue (ưu tiên từ trước ra sau). hints: gợi ý từ S2/Crossref/BibTeX."""
        self.ensure()
        hints = hints or {}
        cands = [c.strip() for c in candidates if c and c.strip()]
        best = None
        for v in cands:
            res = self._classify_one(v, hints, has_arxiv)
            if res["type"] not in ("unknown", "preprint", "other"):
                return res
            best = best or res
        if best:
            return best
        typ = self._type_from_hints(hints)
        if typ:
            return {"type": typ, "name": hints.get("journalName") or "", "matchedBy": "hint"}
        if has_arxiv:
            return {"type": "preprint", "name": "arXiv", "matchedBy": "arxiv"}
        return {"type": "unknown", "name": "", "matchedBy": "none"}

    @staticmethod
    def _type_from_hints(h):
        pt = [x.lower() for x in (h.get("pubTypes") or [])]
        ct = (h.get("crossrefType") or "").lower()
        bt = (h.get("bibType") or "").lower()
        st = (h.get("s2Type") or "").lower()
        if "journalarticle" in pt or ct == "journal-article" or bt in ("article", "jour") or st == "journal":
            return "journal"
        if "booksection" in pt or ct == "book-chapter" or bt in ("incollection", "inbook", "chap"):
            return "book-chapter"
        if ct in ("book", "monograph", "edited-book") or bt == "book":
            return "book"
        if ct == "dissertation" or bt in ("phdthesis", "mastersthesis", "thes"):
            return "thesis"
        if "conference" in pt or ct == "proceedings-article" or bt in ("inproceedings", "conference", "conf", "cpaper") or st == "conference":
            return "conference"
        if ct == "posted-content":
            return "preprint"
        return ""

    def _classify_one(self, v, hints, has_arxiv):
        low = v.lower()
        # 1) arXiv + comment "Accepted to CVPR 2024" -> xét phần comment
        if PREPRINT_RE.search(low):
            inner = " ".join(re.findall(r"\(([^)]*)\)", v))
            if inner:
                sub = self._classify_one(inner, {}, False)
                if sub["type"] not in ("unknown", "other", "preprint"):
                    sub["note"] = (sub.get("note", "") + " Theo ghi chú trên arXiv, cần kiểm tra lại.").strip()
                    return sub
            return {"type": "preprint", "name": "arXiv" if "arxiv" in low else v, "matchedBy": "regex"}
        if THESIS_RE.search(low):
            return {"type": "thesis", "name": v, "matchedBy": "regex"}
        is_workshop = bool(WORKSHOP_RE.search(v)) or any(k in v.upper() for k in WORKSHOP_SUFFIX_ACR)
        is_findings = bool(FINDINGS_RE.search(v))
        journalish = bool(JOURNAL_WORDS.search(v)) or (hints.get("s2Type") == "journal")

        # 1b) viết tắt tạp chí phổ biến (TPAMI 2024, IJCV...)
        for tok in re.findall(r"[A-Za-z][A-Za-z\-]+", v):
            full = JOURNAL_ABBR.get(tok.upper())
            if full and tok.upper() == tok.upper() and sum(1 for ch in tok if ch.isupper()) >= 2:
                sj = self.sjr_by_title.get(norm_title(full))
                if sj:
                    return self._sjr_result(sj, "abbr")
        # 2) tên khớp đúng một tạp chí trong SJR -> tạp chí (trước khi đoán hội nghị theo tên)
        if not is_workshop and not is_findings:
            sj, how = self._sjr_match(v, hints.get("issn") or [])
            if sj and sj["type"] in ("journal", "trade journal") and how in ("issn", "title"):
                acr_item, _ = self._core_by_acronym(v)
                if not acr_item or journalish:
                    return self._sjr_result(sj, how)

        # 3) acronym CORE trong chuỗi
        item, tok = self._core_by_acronym(v)
        # 4) tên đầy đủ khớp CORE (bỏ qua nếu chuỗi có dạng tạp chí)
        if not item and not journalish:
            item = self._core_by_title(v)
        if item:
            if is_findings:
                m = re.search(r"findings of (?:the )?[^:]*:\s*([A-Za-z\-]+)", v, re.I)
                parent = self.core_by_acr.get((m.group(1) if m else "").upper(), [item])[0]
                return self._core_result(parent, "findings", "Findings không được CORE xếp hạng riêng; hạng hiển thị là của hội nghị chủ.", parent=True)
            if is_workshop:
                return self._core_result(item, "workshop", "Workshop không được CORE xếp hạng riêng; hạng hiển thị là của hội nghị chủ.", parent=True)
            if item["rank"] == "Journal Published":
                return self._core_result(item, "conference", "CORE ghi nhận hội nghị này xuất bản dưới dạng tạp chí.")
            return self._core_result(item, "conference")

        # 5) tạp chí / book series / kỷ yếu theo SJR (kể cả so gần đúng)
        sj, how = self._sjr_match(v, hints.get("issn") or [])
        if sj:
            if is_workshop:
                res = self._sjr_result(sj, how, "workshop")
                res["note"] = "Workshop in trong kỷ yếu/book series; SJR là của ấn phẩm chứa bài."
                return res
            res = self._sjr_result(sj, how)
            if res["type"] == "book-series":
                res["type"] = "book-chapter" if self._type_from_hints(hints) in ("book-chapter", "conference") else "book-series"
            return res

        # 6) đoán theo từ khoá và gợi ý
        if is_workshop:
            return {"type": "workshop", "name": v, "matchedBy": "regex", "note": "Không tìm thấy hội nghị chủ trong bảng CORE."}
        hint_type = self._type_from_hints(hints)
        if journalish:
            return {"type": "journal", "name": v, "matchedBy": "regex", "note": "Không có trong bảng SJR, chưa rõ hạng."}
        if BOOK_RE.search(v) or hint_type in ("book-chapter", "book"):
            return {"type": hint_type or "book-chapter", "name": v, "matchedBy": "regex"}
        if CONF_WORDS.search(v) or hint_type == "conference":
            return {"type": "conference", "name": v, "matchedBy": "regex", "note": "Không có trong bảng CORE, chưa rõ hạng."}
        if hint_type:
            return {"type": hint_type, "name": v, "matchedBy": "hint"}
        return {"type": "other" if v else "unknown", "name": v, "matchedBy": "none"}

    # ------------------------------------------------------------------ tra cứu thủ công

    def search(self, q, limit=12):
        self.ensure()
        q = (q or "").strip()
        if not q:
            return []
        out = []
        up = q.upper()
        if up in JOURNAL_ABBR:
            q = JOURNAL_ABBR[up]
        qt = _tokens(q, JOURNAL_STOP)
        for it in self.core:
            score = 3 if it["acronym"].upper() == up else (2 if up in it["acronym"].upper() else 0)
            if qt:
                score += len(qt & _tokens(it["title"], JOURNAL_STOP)) / len(qt)
            if score >= 0.99:
                out.append((score + 0.5, {"kind": "core", "type": "conference", "acronym": it["acronym"], "name": it["title"], "rank": it["rank"], "system": it["source"]}))
        n = norm_title(q)
        for it in self.sjr:
            score = 3 if it["norm"] == n else (len(qt & it["tokens"]) / len(qt) if qt else 0)
            if score >= 0.99:
                out.append((score + (it["sjr"] or 0) / 100, {"kind": "sjr", "type": it["type"], "name": it["title"], "quartile": it["quartile"], "sjr": it["sjr"], "hIndex": it["h"], "system": f"SJR {self.info['sjr']['year']}"}))
        out.sort(key=lambda x: -x[0])
        return [o[1] for o in out[:limit]]

    # ------------------------------------------------------------------ cập nhật trực tuyến

    def update_online(self):
        if not self.http_get:
            raise RuntimeError("Không có hàm tải mạng.")
        self.data_dir.mkdir(parents=True, exist_ok=True)
        report = {}
        # CORE: lấy nguồn mới nhất trong dropdown của portal
        _, ctype, raw, _ = self.http_get(CORE_PORTAL, timeout=40)
        page = raw.decode("utf-8", errors="replace")
        sources = re.findall(r'<option[^>]*value="((?:ICORE|CORE)\d{4})"', page)
        if not sources:
            raise ValueError("Không đọc được danh sách nguồn trên CORE portal.")
        src = sources[0]
        _, ctype, raw, _ = self.http_get(f"{CORE_PORTAL}?search=&by=all&source={src}&sort=arank&page=1&do=Export", timeout=90)
        txt = raw.decode("utf-8", errors="replace")
        rows = [r for r in csv.reader(io.StringIO(txt)) if len(r) >= 5]
        if len(rows) < 300:
            raise ValueError(f"Bảng CORE {src} tải về quá ít dòng ({len(rows)}).")
        (self.data_dir / f"core_{src}.csv").write_text(txt, encoding="utf-8")
        report["core"] = {"source": src, "count": len(rows)}
        # SJR
        _, ctype, raw, _ = self.http_get(SJR_EXPORT, timeout=120, headers=BROWSER_HEADERS, max_bytes=60 * 1024 * 1024)
        text = raw.decode("utf-8", errors="replace")
        reader = csv.reader(io.StringIO(text), delimiter=";")
        head = next(reader)
        m = re.search(r"Total Docs\. \((\d{4})\)", ";".join(head))
        year = m.group(1) if m else time.strftime("%Y")
        keep = ["Title", "Type", "Issn", "SJR", "SJR Best Quartile", "H index", "Publisher", "Categories"]
        idx = [head.index(k) for k in keep]
        out = io.StringIO()
        w = csv.writer(out, delimiter=";")
        w.writerow(keep)
        n = 0
        for r in reader:
            if len(r) >= len(head):
                w.writerow([r[i] for i in idx])
                n += 1
        if n < 10000:
            raise ValueError(f"Bảng SJR tải về quá ít dòng ({n}).")
        (self.data_dir / f"sjr_{year}.csv.gz").write_bytes(gzip.compress(out.getvalue().encode("utf-8"), 9))
        report["sjr"] = {"year": year, "count": n}
        self.reload()
        return report


def rank_sort_key(info):
    """Khoá sắp xếp: A* < A < B < C < Q1 < Q2 ... < không rõ."""
    if not info:
        return 99
    r = info.get("rank") or (info.get("parent") or {}).get("rank")
    if r in RANK_ORDER and not info.get("parent"):
        return RANK_ORDER[r]
    q = info.get("quartile")
    if q in QUARTILE_ORDER:
        return 10 + QUARTILE_ORDER[q]
    if info.get("parent") and r in RANK_ORDER:
        return 20 + RANK_ORDER[r]
    return 50
