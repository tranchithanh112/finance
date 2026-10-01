import { local, saveLocal, authHeaders, hasAuth } from './store.js';

// Kết nối TCBS (chỉ đọc) qua /api/tcbs. Phiên (JWT đã mã hóa) chỉ lưu trên máy này, không sync.

async function call(body) {
  const r = await fetch('/api/tcbs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (data.expired) { delete local.tcbs; saveLocal(); }
    const err = new Error(data.error || `HTTP ${r.status}`);
    err.expired = Boolean(data.expired);
    throw err;
  }
  return data;
}

export const tcbsSession = () => (local.tcbs && local.tcbs.exp > Date.now() + 60e3 ? local.tcbs : null);

export async function tcbsLogin(otp) {
  const { sealed, exp } = await call({ action: 'token', otp: String(otp).trim() });
  local.tcbs = { sealed, exp };
  saveLocal();
  return exp;
}

export function tcbsLogout() {
  delete local.tcbs;
  saveLocal();
}

const get = (path, params) => {
  const s = tcbsSession();
  if (!s) {
    const err = new Error('Phiên TCBS đã hết hạn, hãy nhập OTP mới');
    err.expired = true;
    return Promise.reject(err);
  }
  return call({ action: 'get', path, params, sealed: s.sealed });
};

const num = (v) => Number(v) || 0;

/** Tiểu khoản cổ phiếu (bỏ phái sinh / tiểu khoản đóng). */
export function pickSubAccounts(profile) {
  return (profile?.bankSubAccounts || [])
    .filter((a) => a.accountNo && a.accountType !== 'DERIVATIVE' && !/^(C|CLOSED)$/i.test(a.status || ''))
    .map((a) => ({ accountNo: a.accountNo, type: a.accountType || '', name: a.accountTypeName || a.accountType || '' }));
}

/**
 * Danh mục của 1 tiểu khoản. Tài liệu TCBS mô tả `assets[{symbol, quantity, avgPrice, marketValue}]`,
 * còn API thật trả `stock[{symbol, totalQtty, costPrice, currentPrice, ...}]` → đọc được cả hai.
 * Giá luôn là VND nguyên (25500 = 25.500đ).
 */
export function parseHoldings(se) {
  return (se?.stock || se?.assets || [])
    .map((s) => {
      const qty = num(s.totalQtty ?? s.quantity);
      return {
        symbol: String(s.symbol || '').toUpperCase(),
        etf: s.secType === '008',
        qty,
        cost: num(s.costPrice ?? s.avgPrice),
        price: num(s.currentPrice) || (qty ? num(s.marketValue) / qty : 0),
      };
    })
    .filter((h) => h.symbol && h.qty > 0);
}

/** Tiền trong tài khoản CK: số dư + cổ tức tiền chờ về (đã gồm tiền đang phong tỏa mua). */
export function parseCash(ci) {
  const row = (ci?.data || [])[0];
  if (!row) return 0;
  return num(row.balance ?? row.cashBalance) + num(row.cashDevident);
}

/** Đọc toàn bộ danh mục + tiền của mọi tiểu khoản. */
export async function fetchTcbs(custody) {
  const code = String(custody || '').trim().toUpperCase();
  if (!code) throw new Error('Nhập số tài khoản lưu ký TCBS trước');
  const profile = await get(`/eros/v2/get-profile/by-username/${encodeURIComponent(code)}`, { fields: 'bankSubAccounts' });
  const subs = pickSubAccounts(profile);
  const accounts = [];
  for (const s of subs) {
    const [se, ci] = await Promise.all([
      get(`/aion/v1/accounts/${encodeURIComponent(s.accountNo)}/se`),
      get(`/aion/v1/accounts/${encodeURIComponent(s.accountNo)}/cashInvestments`).catch(() => null),
    ]);
    accounts.push({ ...s, holdings: parseHoldings(se), cash: parseCash(ci) });
  }
  return { custody: code, accounts, syncedAt: Date.now() };
}

/** Gộp các mã trùng giữa tiểu khoản thường/margin → vị thế theo mã (VND). */
export function tcbsHoldings(tcbs) {
  const by = new Map();
  for (const a of tcbs?.accounts || []) {
    for (const h of a.holdings || []) {
      const p = by.get(h.symbol) || { symbol: h.symbol, etf: h.etf, qty: 0, costValue: 0, price: h.price };
      p.qty += h.qty;
      p.costValue += h.qty * h.cost;
      if (h.price) p.price = h.price;
      by.set(h.symbol, p);
    }
  }
  return [...by.values()].map((p) => ({ ...p, cost: p.qty ? p.costValue / p.qty : 0, value: p.qty * p.price }));
}

export const tcbsCash = (tcbs) => (tcbs?.accounts || []).reduce((a, x) => a + (x.cash || 0), 0);
