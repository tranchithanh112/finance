import { tr, getLang, locale } from './i18n.js';

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

// ---- Chế độ riêng tư: ẩn số tiền / số lượng (lưu trên từng thiết bị) ----
let privacy = (() => {
  try { return localStorage.getItem('fin.privacy') === '1'; } catch { return false; }
})();
export const isPrivate = () => privacy;
export function setPrivate(on) {
  privacy = Boolean(on);
  try { localStorage.setItem('fin.privacy', privacy ? '1' : '0'); } catch { /* ignore */ }
}
const MASK = '••••••';

export function fmtMoney(usd, { sign = false, compact = false } = {}) {
  if (usd == null || !Number.isFinite(usd)) return '—';
  if (privacy) return MASK;
  const v = money.cur === 'VND' ? usd * money.rate : usd;
  const abs = Math.abs(v);
  let s;
  if (money.cur === 'VND') {
    const en = getLang() === 'en';
    if (compact && abs >= 1e9) s = (abs / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + (en ? 'B ₫' : ' tỷ');
    else if (compact && abs >= 1e6) s = (abs / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + (en ? 'M ₫' : ' tr');
    else s = abs.toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + ' ₫';
  } else {
    const d = abs !== 0 && abs < 1 ? 4 : 2;
    if (compact && abs >= 1e6) s = '$' + (abs / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'M';
    else if (compact && abs >= 1e3) s = '$' + (abs / 1e3).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'K';
    else if (compact && abs >= 10) s = '$' + abs.toLocaleString('en-US', { maximumFractionDigits: 0 });
    else s = '$' + abs.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  const pre = v < 0 ? '−' : sign && v > 0 ? '+' : '';
  return pre + s;
}

export function fmtNative(v, cur) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (privacy) return MASK;
  if (cur === 'VND') return Math.round(v).toLocaleString('vi-VN') + ' ₫';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + (cur && cur !== 'USD' ? ' ' + cur : ' $');
}

export function fmtQty(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (privacy) return '••••';
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
  const loc = getLang() === 'en' ? 'en-GB' : 'vi-VN';
  const s = d.toLocaleDateString(loc, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return withTime ? s + ' ' + d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }) : s;
}

export function timeAgo(t) {
  const en = getLang() === 'en';
  if (!t) return en ? 'never' : 'chưa bao giờ';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return en ? 'just now' : 'vừa xong';
  if (s < 3600) return `${Math.round(s / 60)} ${en ? 'min ago' : 'phút trước'}`;
  if (s < 86400) return `${Math.round(s / 3600)} ${en ? 'h ago' : 'giờ trước'}`;
  return `${Math.round(s / 86400)} ${en ? 'd ago' : 'ngày trước'}`;
}

export { locale };

export const todayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

export function toast(msg, type = 'info', ms = 4000) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = tr(msg);
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
  return el;
}

export function downloadFile(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- Giữ nội dung đang nhập dở khi giao diện vẽ lại ----
const FIELD = 'input:not([type=password]):not([type=file]):not([type=hidden]):not([type=submit]):not([type=button]), textarea, select';
const fieldKey = (el) => `${el.form?.id || el.closest('[id]')?.id || ''}|${el.name || el.id}`;
const changed = (el) => (el.type === 'checkbox' || el.type === 'radio' ? el.checked !== el.defaultChecked
  : el.tagName === 'SELECT' ? [...el.options].some((o) => o.selected !== o.defaultSelected) : el.value !== el.defaultValue);

/** Lưu các ô người dùng đã sửa (khác giá trị mặc định) trong `root`. */
export function captureDrafts(root) {
  const out = new Map();
  if (!root) return out;
  for (const el of root.querySelectorAll(FIELD)) {
    if ((el.name || el.id) && changed(el)) out.set(fieldKey(el), el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value);
  }
  return out;
}

/** Điền lại nội dung đã lưu vào các ô tương ứng sau khi vẽ lại. */
export function restoreDrafts(root, drafts) {
  if (!root || !drafts?.size) return;
  for (const el of root.querySelectorAll(FIELD)) {
    const k = fieldKey(el);
    if (!drafts.has(k)) continue;
    const v = drafts.get(k);
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = v;
    else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true })); // cập nhật phần xem trước (vd "= 45.000 ₫")
  }
}

/** Đang gõ trong một ô nhập của nội dung chính? */
export function isTyping() {
  const a = document.activeElement;
  return Boolean(a && a.matches?.(`${FIELD}, [contenteditable]`) && a.closest('main'));
}
