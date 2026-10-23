// Ngân sách AI mỗi tháng (Cài đặt → Sử dụng API & chi phí). Trước mỗi lượt gọi model (llm.js: complete, streamChat):
// tới ngưỡng cảnh báo (mặc định 80%) thì báo một lần; vượt ngân sách thì tuỳ chế độ: chỉ cảnh báo, chuyển sang model rẻ
// cùng nhà cung cấp (cùng API key), hoặc chặn gọi. Chi phí tháng do máy chủ tính (/api/usage/cost), giữ tạm 60 giây.
import { api } from './api.js';
import { store } from './store.js';
import { notice } from './notice.js';

export const CHEAP_MODELS = { anthropic: 'claude-haiku-4-5', openai: 'gpt-4o-mini', gemini: 'gemini-2.0-flash' };
const EXEMPT = new Set(['test']); // nút "Thử" kết nối vẫn chạy khi đã vượt ngân sách

let cache = null; // { at, month, data }
const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export const monthStartIso = () => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.toISOString(); };
export const budgetOf = (settings = store.settings) => ({ limit: 0, mode: 'warn', warnAt: 0.8, ...(settings?.aiBudget || {}) });

/** Gọi sau mỗi lượt ghi nhận token: lần kiểm tra sau đọc chi phí mới. */
export function invalidateCost() { cache = null; }

/** Chi phí tháng này: { cost, byModel, missingPrice }. */
export async function monthCost({ fresh = false } = {}) {
  const m = monthKey();
  if (!fresh && cache && cache.month === m && Date.now() - cache.at < 60000) return cache.data;
  const data = await api.usageCost(monthStartIso());
  cache = { at: Date.now(), month: m, data };
  return data;
}

const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (_) { /* bỏ qua */ } return null; };
const usd = (n) => `$${Number(n || 0).toFixed(2)}`;
const goSettings = () => { location.hash = '#/settings?s=usage'; };

/**
 * Kiểm tra ngân sách trước một lượt gọi. Trả về settings dùng cho lượt này (có thể đã đổi sang model rẻ),
 * hoặc ném lỗi khi chế độ "chặn" và đã vượt ngân sách. Không đọc được chi phí (mất mạng…) thì cho chạy bình thường.
 */
export async function budgetGate(settings, task = '') {
  const b = budgetOf(settings);
  if (!(b.limit > 0) || EXEMPT.has(task)) return settings;
  let c;
  try { c = await monthCost(); } catch (_) { return settings; }
  const ratio = c.cost / b.limit;
  const m = monthKey();
  if (ratio >= (b.warnAt || 0.8) && ratio < 1 && LS('pv.budgetWarn') !== `${m}:warn`) {
    LS('pv.budgetWarn', `${m}:warn`);
    notice({ key: 'budget', icon: '💸', title: `Đã dùng ${Math.round(ratio * 100)}% ngân sách AI tháng này`, body: `${usd(c.cost)} / ${usd(b.limit)}.`, actions: [{ label: 'Xem chi phí', primary: true, onClick: goSettings }, { label: 'Đóng' }] });
  }
  if (ratio < 1) return settings;
  const over = `Đã dùng ${usd(c.cost)} / ${usd(b.limit)} ngân sách AI tháng này.`;
  if (b.mode === 'block') {
    const err = new Error(`${over} App đang chặn gọi AI (đổi ở Cài đặt → Sử dụng API & chi phí).`);
    err.budget = true;
    throw err;
  }
  const today = new Date().toISOString().slice(0, 10);
  if (b.mode === 'cheap') {
    const cheap = CHEAP_MODELS[settings.provider];
    if (cheap && settings.models?.[settings.provider] !== cheap) {
      if (LS('pv.budgetCheap') !== today) {
        LS('pv.budgetCheap', today);
        notice({ key: 'budget', icon: '💸', title: 'Đã vượt ngân sách AI: đang dùng model rẻ', body: `${over} Các lượt gọi chuyển sang ${cheap} tới hết tháng.`, actions: [{ label: 'Đổi cài đặt', primary: true, onClick: goSettings }, { label: 'Đóng' }] });
      }
      return { ...settings, models: { ...settings.models, [settings.provider]: cheap } };
    }
    return settings;
  }
  if (LS('pv.budgetWarn') !== `${today}:over`) {
    LS('pv.budgetWarn', `${today}:over`);
    notice({ key: 'budget', icon: '💸', kind: 'remind', title: 'Đã vượt ngân sách AI tháng này', body: over, actions: [{ label: 'Xem chi phí', primary: true, onClick: goSettings }, { label: 'Đóng' }] });
  }
  return settings;
}
