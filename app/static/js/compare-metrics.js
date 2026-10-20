// Nhận diện dataset / benchmark dùng chung giữa các paper và gom metric so được với nhau, chịu được cách viết khác nhau:
//   "OK-VQA (test)", "OKVQA", "VQAv2-sampled (val) in Appendix", "A-OKVQA, ArtVQA / AQUA", "Accuracy (%)" vs "Acc"...
// Không cần khớp hoàn toàn: chỉ cần hai paper cùng dùng một dataset là hiện ra.

const NOISE_WORDS = /\b(test|testing|val|valid|validation|dev|train|training|split|splits|set|subset|sampled|sample|benchmark|dataset|datasets|in appendix|appendix|full|official|public|private|leaderboard|std|standard)\b/gi;
const NOT_DATASET = /^(various|several|multiple|many|others?|etc|see|tables?|all|n\/?a|none|na|unknown|same|above|below|main|results?|experiments?|benchmarks?|datasets?)$/i;

// Tên khác nhau của cùng một dataset (sau khi chuẩn hoá thành chữ thường, bỏ ký tự đặc biệt).
const ALIASES = {
  vqa2: 'vqav2', vqa20: 'vqav2', vqav20: 'vqav2',
  mscoco: 'coco', coco2014: 'coco', coco2017: 'coco', mscococaptions: 'cococaptions',
  imagenet1k: 'imagenet', ilsvrc2012: 'imagenet', ilsvrc: 'imagenet', in1k: 'imagenet',
  gqabalanced: 'gqa', textvqa05: 'textvqa', vizwizvqa: 'vizwiz', scienceqaimg: 'scienceqa', sqaimg: 'scienceqa',
  cifar10dataset: 'cifar10', cifar100dataset: 'cifar100', squad11: 'squad', squadv11: 'squad', squadv2: 'squad2', squad20: 'squad2',
  ade20k150: 'ade20k', cityscapesval: 'cityscapes', pascalvoc2012: 'voc2012', voc12: 'voc2012', pascalvoc: 'voc',
  librispeechtestclean: 'librispeech', librispeechclean: 'librispeech',
};

/** Khoá so khớp cho một tên dataset (null nếu không giống tên dataset). */
export function datasetKey(name) {
  if (/\b(see|various|several|multiple|tables?|figures?|etc|e\.g)\b/i.test(String(name || '').replace(/\([^)]*\)/g, ''))) return null;
  let t = String(name || '')
    .replace(/\([^)]*\)/g, ' ')        // "(test)", "(primary target)"
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[“”"'`]/g, '')
    .replace(NOISE_WORDS, ' ');
  t = t.replace(/[-_\s.]+(v\d+(\.\d+)?)\b/gi, '$1');  // "VQA v2" -> "VQAv2"
  const key = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
  if (key.length < 2 || !/[a-z]/.test(key) || key.length > 40 || NOT_DATASET.test(key)) return null;
  return ALIASES[key] || key;
}

/** Tên hiển thị gọn cho một dataset. */
function datasetLabel(name) {
  return String(name || '').replace(/\([^)]*\)/g, '').replace(/\b(in appendix|appendix)\b/gi, '').replace(/\s+/g, ' ').replace(/[\s,;:.-]+$/, '').trim();
}

/** Tách một chuỗi có thể chứa nhiều dataset: "A-OKVQA, ArtVQA / AQUA; PathVQA and RSVQA". */
export function splitDatasets(text) {
  const out = [];
  const src = Array.isArray(text) ? text : [text];
  for (const item of src) {
    // Bỏ phần ghi chú trong ngoặc trước khi tách để dấu phẩy bên trong ngoặc không cắt sai.
    const flat = String(item || '').replace(/\([^)]*\)/g, ' ');
    for (const part of flat.split(/\s*(?:,|;|\/|\+|&|\band\b|\bvà\b|\n)\s*/i)) {
      const key = datasetKey(part);
      if (key) out.push({ key, label: datasetLabel(part) });
    }
  }
  return out;
}

/** Khoá so khớp cho tên metric: "Accuracy (%)", "Acc.", "VQA accuracy" -> "acc". */
export function metricKey(name) {
  let t = String(name || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/%/g, ' ');
  t = t.replace(/\b(vqa|overall|average|avg|mean|top-?1)\s+(accuracy|acc)\b/g, 'accuracy');
  t = t.replace(/\baccuracy\b|\bacc\b\.?/g, 'acc').replace(/\bexact match\b/g, 'em').replace(/\bf1[- ]?score\b/g, 'f1')
    .replace(/\bmean average precision\b/g, 'map').replace(/\bword error rate\b/g, 'wer');
  const key = t.replace(/[^a-z0-9@]+/g, '');
  return key || null;
}

const NUM = /(-?\d+(?:[.,]\d+)?)\s*(%)?/;
const toNum = (s) => parseFloat(String(s).replace(',', '.'));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Tìm con số gắn với một dataset trong chuỗi kết quả: "56.47% on OK-VQA", "OK-VQA: 56.5", "A-OKVQA 61.2". */
function numberFor(text, label) {
  const t = String(text || '');
  const name = esc(label).replace(/\\-|-/g, '[-\\s]?');
  const before = new RegExp(`(-?\\d+(?:[.,]\\d+)?)\\s*%?\\s*(?:on|@|at|for|trên)\\s+(?:the\\s+)?${name}(?![\\w-])`, 'i').exec(t);
  if (before) return { value: toNum(before[1]), raw: before[0].match(NUM)[0].trim() };
  // Tên dataset đứng trước số; không khớp "OK-VQA" bên trong "A-OKVQA", không lấy số của "Table 1", "Fig. 3".
  const after = new RegExp(`(?<![\\w-])${name}(?![\\w-])([^\\d\\n]{0,24}?)(-?\\d+(?:[.,]\\d+)?)\\s*(%)?`, 'i').exec(t);
  if (after && !/(table|tab\.|fig|figure|sec|section|eq|appendix|top-?$|v$)\s*$/i.test(after[1]) && !/(gain|improv|increase|decrease|drop|boost|delta|\+|\bby\b|\bvs\.?|baseline)/i.test(after[1])) return { value: toNum(after[2]), raw: `${after[2]}${after[3] || ''}` };
  return null;
}

/** Số đầu tiên trong chuỗi kết quả, bỏ qua số của "Table 2", "Fig. 3", "Sec 4", năm. */
function firstNumber(text) {
  const re = /(-?\d+(?:[.,]\d+)?)\s*(%)?/g;
  const t = String(text || '');
  let m;
  while ((m = re.exec(t))) {
    const before = t.slice(Math.max(0, m.index - 12), m.index);
    if (/(table|tab\.|fig\.?|figure|sec\.?|section|eq\.?|appendix|top-|v)\s*$/i.test(before)) continue;
    if (/^(19|20)\d\d$/.test(m[1])) continue;
    return { value: toNum(m[1]), raw: `${m[1]}${m[2] || ''}` };
  }
  return null;
}

/**
 * Phân tích các paper đang so sánh.
 * Trả về { shared: [{ key, label, papers: Map(paperId -> [{ metric, raw }]) }], charts: [{ name, dataset, rows }] }
 *   shared: dataset / benchmark được ≥ 2 paper dùng (kể cả khi không có con số so được).
 *   charts: metric cùng loại trên cùng dataset có số ở ≥ 2 paper, để vẽ biểu đồ.
 */
export function analyzeMetrics(papers) {
  const ds = new Map();      // key -> { key, label, papers: Map }
  const groups = new Map();  // metricKey|datasetKey -> { name, dataset, rows }
  const use = (key, label, pid) => {
    if (!ds.has(key)) ds.set(key, { key, label, papers: new Map() });
    const d = ds.get(key);
    if (!d.label) d.label = label;
    if (!d.papers.has(pid)) d.papers.set(pid, []);
    return d;
  };
  for (const p of papers) {
    const e = p.extraction || {};
    const v = e.validation || {};
    const names = [...splitDatasets(v.benchmarks || []), ...splitDatasets(v.datasets || []), ...splitDatasets((e.dataset_details || []).map((d) => d?.name))];
    for (const n of names) use(n.key, n.label, p.id);
    for (const m of v.metrics || []) {
      if (!m) continue;
      const list = splitDatasets(m.dataset || '');
      const mk = metricKey(m.name);
      // Chỉ lấy số từ kết quả của phương pháp đề xuất (không lấy mức tăng ở delta hay số của baseline).
      const text = String(m.proposed || '');
      for (const n of list) {
        const d = use(n.key, n.label, p.id);
        // Một dataset: lấy số đầu tiên. Nhiều dataset trong một dòng: chỉ lấy số ghi rõ cho dataset đó.
        let hit = numberFor(text, n.label);
        if (!hit && list.length === 1) hit = firstNumber(m.proposed);
        const entry = { metric: String(m.name || '').replace(/\s*\(%\)\s*/, '').trim() || 'Metric', raw: hit ? hit.raw : '' };
        const arr = d.papers.get(p.id);
        if (!arr.some((x) => x.metric === entry.metric && x.raw === entry.raw)) arr.push(entry);
        if (hit && mk && Number.isFinite(hit.value)) {
          const gk = `${mk}|${n.key}`;
          if (!groups.has(gk)) groups.set(gk, { key: gk, name: entry.metric, dataset: d.label, rows: [] });
          const g = groups.get(gk);
          if (!g.rows.some((r) => r.paper.id === p.id)) g.rows.push({ paper: p, value: hit.value, raw: hit.raw, baseline: m.baseline });
        }
      }
    }
  }
  const shared = [...ds.values()].filter((d) => d.papers.size >= 2)
    .sort((a, b) => b.papers.size - a.papers.size || a.label.localeCompare(b.label));
  for (const d of ds.values()) d.label = d.label || d.key;
  const charts = [...groups.values()].filter((g) => g.rows.length >= 2);
  return { shared, charts };
}
