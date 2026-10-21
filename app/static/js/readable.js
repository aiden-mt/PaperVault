// Trình bày văn bản do mô hình viết cho dễ đọc: một khối chữ dài liền mạch được tách thành đoạn ngắn (2–3 câu, mỗi
// đoạn một ý), các ý liệt kê viết liền ("First, … Second, … Third, …", "Thứ nhất… Thứ hai…") thành danh sách, và phần
// trỏ về nguồn "(Sec. 3.1, Table 2)" in mờ để không chen vào mạch đọc. Chỉ đổi cách hiển thị, không đổi chữ.

// Số thứ tự / gạch đầu dòng mô hình tự viết ở đầu một phần tử danh sách ("1) …", "2. …", "(3) …", "Step 4: …", "• …").
// Danh sách của app đã tự đánh số, giữ lại thì thành "1. 1) …".
const MARKER = /^\s*(?:(?:Step|Bước|Stage|Giai đoạn)\s*\d{1,2}\s*[:.)\-–—]\s*|\(\d{1,2}\)\s*|\d{1,2}[.)](?!\d)\s*|(?:i{1,3}|iv|vi{0,3}|ix|x)[.)]\s+|[-*•·▪◦]\s+)/i;
/** Bỏ số thứ tự / gạch đầu dòng thừa ở đầu một phần tử danh sách. */
export const stripMarker = (s) => {
  const t = String(s ?? '');
  const out = t.replace(MARKER, '');
  return out.trim() ? out : t;
};

// Từ viết tắt có dấu chấm không kết thúc câu.
const ABBR = /(?:\b(?:e\.g|i\.e|et al|etc|vs|cf|approx|Fig|Figs|Sec|Secs|Sect|Eq|Eqs|Tab|Tbl|No|Nos|Ref|Refs|Ch|Vol|pp|resp|Dr|Mr|Mrs|Ms|St|Inc|Ltd|Jr|Prof|al|ca|viz|Alg|Thm|Def|Prop|Lem|Appx|App|tr|Tr|vd|VD)\.|\b[A-Z]\.|\.\.\.)$/;
// Câu mở một ý liệt kê: tiếng Anh, tiếng Việt và dạng (1) / 1) / (i).
const ENUM_HEAD = /^(?:(?:First(?:ly)?|Second(?:ly)?|Third(?:ly)?|Fourth(?:ly)?|Fifth(?:ly)?|Sixth|Finally|Lastly)\b(?!-)[,:]?|(?:Thứ (?:nhất|hai|ba|tư|năm|sáu)|Một là|Hai là|Ba là|Bốn là|Cuối cùng)\b[,:]?|\(?(?:[1-9]|i{1,3}|iv|v|vi)\)\s)/i;
const ENUM_FIRST = /^(?:First(?:ly)?\b(?!-)|Thứ nhất\b|Một là\b|\(?(?:1|i)\)\s)/i;
const ENUM_LAST = /^(?:Finally|Lastly|Cuối cùng)\b/i;
// Câu tổng kết sau danh sách: không thuộc ý liệt kê cuối.
const CLOSING = /^(?:Because of (?:this|these|that|those)|Overall|In (?:short|summary|sum)|Taken together|Together|Thus|Therefore|Hence|As a result|Consequently|These (?:gaps|issues|problems|limitations|failures|reasons|three|two|factors)|This (?:is why|means|explains|combination)|All (?:three|of these|these)|Vì (?:vậy|thế|những|các)|Do (?:đó|vậy)|Tóm lại|Nhìn chung|Như vậy|Kết quả là|Gộp lại|Những (?:điều|lý do|hạn chế|thiếu sót|khoảng trống) (?:này|trên)|Các (?:lý do|hạn chế|khoảng trống) (?:này|trên)|Cả (?:ba|hai) )/i;
// Câu chuyển ý: nên mở đoạn mới.
const TURN = /^(?:However|But|In contrast|By contrast|Instead|Meanwhile|Moreover|Furthermore|In addition|Additionally|Alternatively|Unlike|Notably|Importantly|Crucially|In practice|The (?:practical|key|main|core|central|real|net|result|cost|catch|trick|idea|insight)|This (?:matters|is important|is where)|Tuy nhiên|Nhưng|Ngược lại|Trong khi đó|Ngoài ra|Hơn nữa|Bên cạnh đó|Mặt khác|Đáng chú ý|Điểm (?:mấu chốt|quan trọng|then chốt)|Khác với|Thay vào đó|Trên thực tế|Cái giá|Hệ quả)/i;

const PARA_MAX = 420; // ký tự tối đa của một đoạn trước khi tách
const MIN_LEN = 260;  // khối ngắn hơn thì để nguyên

/** Tách một khối chữ thành câu, không cắt ở "Sec. 3", "Fig. 2", "e.g.", "et al.", số thập phân, công thức $…$. */
export function splitSentences(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return [];
  // Giữ công thức nguyên khối để dấu chấm trong $…$ không bị coi là hết câu.
  const keep = [];
  const masked = s.replace(/\$\$[\s\S]+?\$\$|\$[^$]+\$|\\\([\s\S]+?\\\)/g, (m) => { keep.push(m); return `\u0000${keep.length - 1}\u0000`; });
  const parts = masked.split(/(?<=[.!?…])["”’)]?\s+(?=["“'(\[]?[\p{Lu}\d$\\\u0000])/u);
  const out = [];
  for (const p of parts) {
    if (out.length && ABBR.test(out[out.length - 1])) out[out.length - 1] += ` ${p}`;
    else out.push(p);
  }
  return out.map((x) => x.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[Number(i)]));
}

/** Gom câu thành đoạn: tối đa 3 câu / PARA_MAX ký tự, mở đoạn mới ở câu chuyển ý. */
function groupParagraphs(sents) {
  const paras = [];
  let cur = [];
  let len = 0;
  for (const s of sents) {
    const turn = TURN.test(s) && len > 120;
    if (cur.length && (len + s.length > PARA_MAX || cur.length >= 3 || turn)) { paras.push(cur.join(' ')); cur = []; len = 0; }
    cur.push(s);
    len += s.length + 1;
  }
  if (cur.length) paras.push(cur.join(' '));
  // Đoạn cuối chỉ một câu ngắn thì nhập vào đoạn trước.
  if (paras.length > 1 && paras[paras.length - 1].length < 90 && !TURN.test(paras[paras.length - 1])) paras.splice(-2, 2, `${paras[paras.length - 2]} ${paras[paras.length - 1]}`);
  return paras;
}

/** Bỏ chữ "First," / "Thứ nhất," ở đầu ý (số thứ tự của danh sách đã nói điều đó), viết hoa chữ đầu. */
function stripEnumHead(s) {
  const t = s.replace(/^(?:First(?:ly)?|Second(?:ly)?|Third(?:ly)?|Fourth(?:ly)?|Fifth(?:ly)?|Sixth|Finally|Lastly|Thứ (?:nhất|hai|ba|tư|năm|sáu)|Một là|Hai là|Ba là|Bốn là|Cuối cùng)\s*[,:]?\s+/i, '')
    .replace(/^\(?(?:[1-9]|i{1,3}|iv|v|vi)\)\s+/i, '');
  return t ? t[0].toUpperCase() + t.slice(1) : s;
}


/**
 * Chia khối chữ thành các khối hiển thị: { type: 'p', text } hoặc { type: 'ol', items: [text] }.
 * Khối ngắn hoặc đã có xuống dòng thì giữ như mô hình viết (mỗi dòng một khối).
 */
export function readableBlocks(text) {
  const raw = String(text ?? '').replace(/\r/g, '').trim();
  if (!raw) return [];
  if (/\n/.test(raw)) return raw.split(/\n+/).map((x) => x.trim()).filter(Boolean).flatMap((line) => (line.length > PARA_MAX * 1.4 ? readableBlocks(line) : [{ type: 'p', text: line }]));
  if (raw.length < MIN_LEN) return [{ type: 'p', text: raw }];
  const sents = splitSentences(raw);
  if (sents.length < 3) return [{ type: 'p', text: raw }];
  // Liệt kê: có câu "First…"/"Thứ nhất…" và ít nhất một câu liệt kê sau nó.
  const first = sents.findIndex((s) => ENUM_FIRST.test(s));
  const heads = first >= 0 ? sents.map((s, i) => (i >= first && ENUM_HEAD.test(s) ? i : -1)).filter((i) => i >= 0) : [];
  if (heads.length >= 2) {
    const blocks = [];
    if (first > 0) blocks.push(...groupParagraphs(sents.slice(0, first)).map((t) => ({ type: 'p', text: t })));
    const items = [];
    let rest = [];
    for (let i = first; i < sents.length; i++) {
      const s = sents[i];
      if (heads.includes(i)) { items.push(stripEnumHead(s)); continue; }
      // Câu sau ý cuối: câu tổng kết (hoặc từ câu thứ hai trở đi) thì ra ngoài danh sách.
      const afterLast = i > heads[heads.length - 1];
      if (afterLast && (CLOSING.test(s) || rest.length || i - heads[heads.length - 1] > (ENUM_LAST.test(sents[heads[heads.length - 1]]) ? 1 : 2))) { rest.push(s); continue; }
      items[items.length - 1] += ` ${s}`;
    }
    blocks.push({ type: 'ol', items });
    if (rest.length) blocks.push(...groupParagraphs(rest).map((t) => ({ type: 'p', text: t })));
    return blocks;
  }
  return groupParagraphs(sents).map((t) => ({ type: 'p', text: t }));
}

/** Markdown dễ đọc (cho mdToHtml): đoạn cách nhau bằng dòng trống, liệt kê thành "1. …". */
export function readableMd(text) {
  return readableBlocks(text).map((b) => (b.type === 'ol' ? b.items.map((x, i) => `${i + 1}. ${x}`).join('\n') : b.text)).join('\n\n');
}

/**
 * Markdown dài của Chat / Hỏi đáp: chỉ tách những dòng văn xuôi quá dài (không đụng danh sách, bảng, tiêu đề, code).
 */
export function readableChatMd(md) {
  let code = false;
  return String(md || '').split('\n').map((line) => {
    if (line.trimStart().startsWith('```')) { code = !code; return line; }
    if (code || line.length < PARA_MAX * 1.3 || /^\s*(?:[-*•>#|]|\d+[.)]\s)/.test(line)) return line;
    return `${readableMd(line)}\n`;
  }).join('\n');
}

// "(Sec. 3.1 and Table 2)", "(see Fig. 2)", "(Mục 4, Bảng 3)": phần trỏ về nguồn, in mờ.
const CITE_REF = /\((?:see |xem |cf\. |e\.g\. )?(?:Sec\.|Secs\.|Section|Sections|Fig\.|Figs\.|Figure|Figures|Table|Tables|Tab\.|Eq\.|Eqs\.|Equation|Appendix|App\.|Alg\.|Algorithm|Mục|Bảng|Hình|Phụ lục|Công thức|Thuật toán)[^()<>]{0,160}\)/g;
/** Bọc phần trỏ nguồn trong HTML đã dựng bằng <span class="cite-ref">. Ngoặc dài kiểu "(Fig. 2 shows …)" là nội dung, giữ nguyên. */
export const muteRefs = (html) => String(html).replace(CITE_REF, (m) => (/^\((?:see|xem|cf\.)\s/i.test(m) || m.split(/\s+/).length <= 10 ? `<span class="cite-ref">${m}</span>` : m));
