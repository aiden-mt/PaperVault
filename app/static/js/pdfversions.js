// Thay file PDF của paper: xoá hoặc giữ bản cũ (paper.pdfVersions, chuyển lại được), nét tô đi theo từng bản.
// Hàm thuần, trả về phần cần lưu vào paper và danh sách file PDF cần xoá khỏi máy chủ.

export const MAX_PDF_VERSIONS = 5;

const asVersion = (p, at) => ({ pdfId: p.pdfId, pdfName: p.pdfName || 'paper.pdf', at, pdfMarks: p.pdfMarks || [] });

/**
 * Gắn file mới `up` ({ id, name }) thay cho PDF hiện tại.
 * deleteOld: xoá file cũ, ngược lại cất vào pdfVersions (kèm nét tô của nó). keepMarks: chép nét tô sang bản mới.
 */
export function replacePdfPatch(p, up, { deleteOld = true, keepMarks = false, at = new Date().toISOString() } = {}) {
  const versions = [...(p.pdfVersions || [])].filter((v) => v.pdfId !== up.id);
  const drop = [];
  if (p.pdfId && p.pdfId !== up.id) {
    if (deleteOld) drop.push(p.pdfId);
    else versions.unshift(asVersion(p, at));
  }
  while (versions.length > MAX_PDF_VERSIONS) drop.push(versions.pop().pdfId);
  return {
    patch: { pdfId: up.id, pdfName: up.name || 'paper.pdf', pdfMarks: keepMarks ? (p.pdfMarks || []) : [], pdfVersions: versions },
    drop,
  };
}

/** Dùng lại bản thứ `index` trong pdfVersions. Bản đang dùng (nếu có) được cất vào đầu danh sách. */
export function restorePdfPatch(p, index, { at = new Date().toISOString() } = {}) {
  const list = p.pdfVersions || [];
  const v = list[index];
  if (!v) return null;
  const rest = list.filter((_, i) => i !== index);
  if (p.pdfId) rest.unshift(asVersion(p, at));
  return { pdfId: v.pdfId, pdfName: v.pdfName || 'paper.pdf', pdfMarks: v.pdfMarks || [], pdfVersions: rest.slice(0, MAX_PDF_VERSIONS) };
}

/** Xoá bản cũ thứ `index`, hoặc mọi bản cũ khi index là null. */
export function dropPdfVersions(p, index = null) {
  const list = p.pdfVersions || [];
  const drop = list.filter((_, i) => index === null || i === index).map((v) => v.pdfId);
  return { patch: { pdfVersions: index === null ? [] : list.filter((_, i) => i !== index) }, drop };
}
