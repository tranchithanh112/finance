export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const DAY = 86400000;
export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

export const STABLES = new Set(['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'DAI', 'USDP', 'PAX', 'USD', 'USD1', 'USDS', 'U']);
export const isStable = (a) => STABLES.has(a);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- Tiền tệ hiển thị ----
const money = { cur: 'USD', rate: 25500 };
export function setDisplayCurrency(cur, usdVnd) {
  money.cur = cur;
  money.rate = usdVnd;
}
export const displayCurrency = () => money.cur;

export function fmtMoney(usd, { sign = false, compact = false } = {}) {
  if (usd == null || !Number.isFinite(usd)) return '—';
  const v = money.cur === 'VND' ? usd * money.rate : usd;
  const abs = Math.abs(v);
  let s;
  if (money.cur === 'VND') {
    if (compact && abs >= 1e9) s = (abs / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' tỷ';
    else if (compact && abs >= 1e6) s = (abs / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tr';
    else s = abs.toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + ' ₫';
  } else {
    const d = abs !== 0 && abs < 1 ? 4 : 2;
    if (compact && abs >= 1e6) s = '$' + (abs / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'M';
    else if (compact && abs >= 1e4) s = '$' + (abs / 1e3).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'K';
    else s = '$' + abs.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  const pre = v < 0 ? '−' : sign && v > 0 ? '+' : '';
  return pre + s;
}

export function fmtNative(v, cur) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (cur === 'VND') return Math.round(v).toLocaleString('vi-VN') + ' ₫';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + (cur && cur !== 'USD' ? ' ' + cur : ' $');
}

export function fmtQty(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const d = a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 6 : 8;
  return n.toLocaleString('en-US', { maximumFractionDigits: d });
}

export function fmtPrice(n) {
  if (n == null || !Number.isFinite(n) || n === 0) return '—';
  const a = Math.abs(n);
  const d = a >= 100 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 6 : 8;
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
}

export function fmtPct(n, { sign = true } = {}) {
  if (n == null || !Number.isFinite(n)) return '—';
  return (sign && n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n * 100).toFixed(2) + '%';
}

export const pnlClass = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');

export function fmtDate(t, withTime = false) {
  if (!t) return '—';
  const d = new Date(t);
  const s = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return withTime ? s + ' ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : s;
}

export function timeAgo(t) {
  if (!t) return 'chưa bao giờ';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.round(s / 60)} phút trước`;
  if (s < 86400) return `${Math.round(s / 3600)} giờ trước`;
  return `${Math.round(s / 86400)} ngày trước`;
}

export const todayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

export function toast(msg, type = 'info', ms = 4000) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function downloadFile(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
