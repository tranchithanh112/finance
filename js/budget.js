// Quản lý thu chi cá nhân theo phương pháp "hũ" (JARS rút gọn còn 4 hũ).
// Mọi số tiền lưu bằng VND.

export const DEFAULT_JARS = [
  { id: 'nec', name: 'Thiết yếu', pct: 30, color: '#4f7cff' },
  { id: 'save', name: 'Tiết kiệm', pct: 20, color: '#17c3a5' },
  { id: 'invest', name: 'Đầu tư', pct: 35, color: '#a162f7' },
  { id: 'play', name: 'Hưởng thụ', pct: 15, color: '#f5a524' },
];

// Hũ "tiêu dùng" (tiền thực sự mất đi). Tiết kiệm & Đầu tư là tiền để dành → tính vào tỷ lệ tiết kiệm.
export const SPEND_JARS = new Set(['nec', 'play']);

export const DEFAULT_CATEGORIES = [
  { id: 'food', name: 'Ăn uống', icon: '🍜', type: 'expense', jar: 'nec' },
  { id: 'transport', name: 'Di chuyển', icon: '🛵', type: 'expense', jar: 'nec' },
  { id: 'bills', name: 'Hóa đơn & điện thoại', icon: '📱', type: 'expense', jar: 'nec' },
  { id: 'health', name: 'Sức khỏe', icon: '💊', type: 'expense', jar: 'nec' },
  { id: 'family', name: 'Gửi gia đình', icon: '🏠', type: 'expense', jar: 'nec' },
  { id: 'debtpay', name: 'Trả nợ', icon: '💳', type: 'expense', jar: 'nec' },
  { id: 'cafe', name: 'Cafe & đi chơi', icon: '☕', type: 'expense', jar: 'play' },
  { id: 'shopping', name: 'Mua sắm', icon: '🛍️', type: 'expense', jar: 'play' },
  { id: 'travel', name: 'Du lịch', icon: '✈️', type: 'expense', jar: 'play' },
  { id: 'fun', name: 'Giải trí', icon: '🎮', type: 'expense', jar: 'play' },
  { id: 'gift', name: 'Quà tặng', icon: '🎁', type: 'expense', jar: 'play' },
  { id: 'saving', name: 'Gửi tiết kiệm', icon: '🏦', type: 'expense', jar: 'save' },
  { id: 'emergency', name: 'Quỹ dự phòng', icon: '🛟', type: 'expense', jar: 'save' },
  { id: 'crypto', name: 'Nạp crypto', icon: '🪙', type: 'expense', jar: 'invest' },
  { id: 'stock', name: 'Mua CK / quỹ', icon: '📈', type: 'expense', jar: 'invest' },
  { id: 'salary', name: 'Lương', icon: '💼', type: 'income' },
  { id: 'bonus', name: 'Thưởng', icon: '🎉', type: 'income' },
  { id: 'side', name: 'Thu nhập phụ', icon: '💡', type: 'income' },
  { id: 'invincome', name: 'Lãi đầu tư', icon: '📊', type: 'income' },
  { id: 'otherin', name: 'Thu khác', icon: '➕', type: 'income' },
];

export function defaultBudget() {
  return {
    jars: DEFAULT_JARS.map((j) => ({ ...j })),
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    txs: [], // { id, date:'YYYY-MM-DD', type:'expense'|'income', amount, cat, note, u (sửa lúc) }
    deleted: {}, // id -> thời điểm xóa (để đồng bộ nhiều máy không "hồi sinh" giao dịch đã xóa)
    recurring: [], // { id, type, amount, cat, note, day, startMonth:'YYYY-MM', active }
    debts: [], // { id, name, balance, rate, monthly, currency }
    emergencyTarget: 6,
    configAt: 0, // lần sửa cấu hình (hũ, danh mục, định kỳ, nợ) gần nhất
  };
}

/** "50k" → 50000, "1.5tr" / "1,5tr" / "2m" → triệu, "150.000" → 150000. */
export function parseAmount(input) {
  let s = String(input ?? '').trim().toLowerCase().replace(/\s+/g, '').replace(/đ|vnd|₫/g, '');
  if (!s) return NaN;
  const m = s.match(/^([\d.,]+)(k|n|nghìn|ngàn|tr|triệu|m|tỷ|ty|b)?$/);
  if (!m) return NaN;
  const [, num, unit] = m;
  if (unit) {
    const v = Number(num.replace(',', '.'));
    const mult = { k: 1e3, n: 1e3, nghìn: 1e3, ngàn: 1e3, tr: 1e6, triệu: 1e6, m: 1e6, tỷ: 1e9, ty: 1e9, b: 1e9 }[unit];
    return Math.round(v * mult);
  }
  return Number(num.replace(/[.,]/g, ''));
}

export const monthKey = (d) => String(d).slice(0, 7);
export function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Sinh giao dịch định kỳ còn thiếu tới hôm nay. id cố định → nhiều máy cùng sinh cũng không bị trùng. */
export function generateRecurring(b, today = localToday()) {
  const have = new Set(b.txs.map((t) => t.id));
  let n = 0;
  for (const r of b.recurring) {
    if (r.active === false) continue;
    for (let ym = r.startMonth; ym <= monthKey(today); ym = shiftMonth(ym, 1)) {
      const day = String(Math.min(Math.max(Number(r.day) || 1, 1), 28)).padStart(2, '0');
      const date = `${ym}-${day}`;
      if (date > today) break;
      const id = `rec:${r.id}:${ym}`;
      if (have.has(id) || b.deleted[id]) continue;
      b.txs.push({ id, date, type: r.type, amount: Number(r.amount), cat: r.cat, note: r.note || '', u: Date.now() });
      have.add(id);
      n++;
    }
  }
  return n;
}

export function catMap(b) {
  return Object.fromEntries(b.categories.map((c) => [c.id, c]));
}

/** Tổng hợp 1 tháng. */
export function monthSummary(b, ym) {
  const cats = catMap(b);
  const txs = b.txs.filter((t) => monthKey(t.date) === ym);
  let income = 0;
  let spend = 0; // tiêu dùng (Thiết yếu + Hưởng thụ)
  let saved = 0; // chuyển vào Tiết kiệm / Đầu tư
  const byJar = Object.fromEntries(b.jars.map((j) => [j.id, 0]));
  const byCat = {};
  for (const t of txs) {
    const a = Number(t.amount) || 0;
    if (t.type === 'income') { income += a; continue; }
    const jar = cats[t.cat]?.jar || 'nec';
    byJar[jar] = (byJar[jar] || 0) + a;
    byCat[t.cat] = (byCat[t.cat] || 0) + a;
    if (SPEND_JARS.has(jar)) spend += a; else saved += a;
  }
  const jars = b.jars.map((j) => {
    const alloc = (income * (Number(j.pct) || 0)) / 100;
    const used = byJar[j.id] || 0;
    return { ...j, alloc, used, left: alloc - used, ratio: alloc ? used / alloc : used ? Infinity : 0 };
  });
  const keep = income - spend; // phần không tiêu dùng (để dành + đầu tư + còn dư)
  return {
    ym, txs, income, spend, saved,
    left: income - spend - saved,
    savingsRate: income > 0 ? keep / income : null,
    jars, byCat,
  };
}

/** Trung bình các tháng đầy đủ gần nhất (bỏ tháng hiện tại nếu còn dang dở). */
export function recentAverage(b, months = 3, today = localToday()) {
  const cur = monthKey(today);
  const list = [];
  for (let i = 1; i <= months; i++) list.push(monthSummary(b, shiftMonth(cur, -i)));
  const withData = list.filter((m) => m.txs.length);
  if (!withData.length) return null;
  const avg = (k) => withData.reduce((a, m) => a + m[k], 0) / withData.length;
  const income = avg('income');
  const spend = avg('spend');
  return { months: withData.length, income, spend, saved: avg('saved'), savingsRate: income > 0 ? (income - spend) / income : null };
}

export const debtTotalVnd = (b, usdVnd) => b.debts.reduce((a, d) => a + (Number(d.balance) || 0) * (d.currency === 'USD' ? usdVnd : 1), 0);
export const debtMonthlyVnd = (b, usdVnd) => b.debts.reduce((a, d) => a + (Number(d.monthly) || 0) * (d.currency === 'USD' ? usdVnd : 1), 0);

/**
 * Điểm sức khỏe tài chính 0–100. Mỗi tiêu chí thiếu dữ liệu sẽ bị bỏ qua và điểm được quy đổi theo phần còn lại.
 * input: { savingsRate, emergencyMonths, emergencyTarget, debtToIncome, riskShare, jarsOver }
 */
export function healthScore(x) {
  const parts = [];
  const clamp = (v) => Math.max(0, Math.min(1, v));
  if (x.savingsRate != null) {
    parts.push({
      key: 'savings', label: 'Tỷ lệ tiết kiệm', weight: 25, score: clamp(x.savingsRate / 0.3),
      tip: x.savingsRate < 0.1 ? 'Tỷ lệ tiết kiệm dưới 10% — thử giảm hũ Hưởng thụ hoặc tăng thu nhập.'
        : x.savingsRate < 0.3 ? 'Nên nâng tỷ lệ tiết kiệm lên ≥ 30% khi còn sống cùng gia đình.' : null,
    });
  }
  if (x.emergencyMonths != null) {
    const target = x.emergencyTarget || 6;
    parts.push({
      key: 'emergency', label: 'Quỹ dự phòng', weight: 25, score: clamp(x.emergencyMonths / target),
      tip: x.emergencyMonths < target ? `Quỹ dự phòng mới đủ ${x.emergencyMonths.toFixed(1)} tháng chi tiêu, mục tiêu ${target} tháng (tiền mặt + stablecoin).` : null,
    });
  }
  if (x.debtToIncome != null) {
    parts.push({
      key: 'debt', label: 'Nợ / thu nhập', weight: 20, score: clamp(1 - (x.debtToIncome - 0.1) / 0.3),
      tip: x.debtToIncome > 0.3 ? `Tiền trả nợ chiếm ${(x.debtToIncome * 100).toFixed(0)}% thu nhập — nên dưới 30%.` : null,
    });
  }
  if (x.riskShare != null) {
    parts.push({
      key: 'risk', label: 'Mức rủi ro danh mục', weight: 15, score: clamp(1 - (x.riskShare - 0.4) / 0.4),
      tip: x.riskShare > 0.6 ? `${(x.riskShare * 100).toFixed(0)}% tài sản nằm ở crypto (không tính stablecoin) — cân nhắc đa dạng hóa sang quỹ chỉ số / tiết kiệm.` : null,
    });
  }
  if (x.jarsOver != null) {
    parts.push({
      key: 'jars', label: 'Giữ đúng ngân sách hũ', weight: 15, score: x.jarsOver ? clamp(1 - x.jarsOver * 0.5) : 1,
      tip: x.jarsOver ? `${x.jarsOver} hũ tiêu dùng (Thiết yếu / Hưởng thụ) đang vượt hạn mức tháng này.` : null,
    });
  }
  const totalW = parts.reduce((a, p) => a + p.weight, 0);
  const score = totalW ? Math.round((parts.reduce((a, p) => a + p.score * p.weight, 0) / totalW) * 100) : null;
  const label = score == null ? 'Chưa đủ dữ liệu' : score >= 80 ? 'Rất tốt' : score >= 60 ? 'Khá' : score >= 40 ? 'Trung bình' : 'Cần cải thiện';
  return { score, label, parts, tips: parts.map((p) => p.tip).filter(Boolean) };
}

/** Gộp dữ liệu thu chi của 2 thiết bị: giao dịch hợp nhất (tôn trọng xóa), cấu hình theo lần sửa sau cùng. */
export function mergeBudget(a, b) {
  if (!a) return b;
  if (!b) return a;
  const cfg = (a.configAt || 0) >= (b.configAt || 0) ? a : b;
  const deleted = { ...b.deleted, ...a.deleted };
  const txs = new Map();
  for (const t of [...(b.txs || []), ...(a.txs || [])]) {
    const cur = txs.get(t.id);
    if (!cur || (t.u || 0) > (cur.u || 0)) txs.set(t.id, t);
  }
  return {
    ...cfg,
    txs: [...txs.values()].filter((t) => !deleted[t.id]).sort((x, y) => x.date.localeCompare(y.date)),
    deleted,
    configAt: Math.max(a.configAt || 0, b.configAt || 0),
  };
}
