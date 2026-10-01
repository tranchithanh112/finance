import { idbGet, idbSet } from './idb.js';
import { todayKey } from './util.js';
import { defaultBudget } from './budget.js';

// `state` là dữ liệu được đồng bộ (Dropbox / Google Drive / export JSON).
// `local` là cấu hình riêng của thiết bị (mật khẩu, token OAuth) — KHÔNG bao giờ sync.

export function defaultState() {
  return {
    version: 1,
    updatedAt: 0,
    editedAt: 0,
    settings: {
      displayCurrency: 'USD',
      dustUsd: 1,
      historyStart: '2018-01-01',
      scanQuotes: ['USDT'],
      extraAssets: ['BTC', 'ETH', 'BNSOL', 'USDC', 'SUI', 'LINK', 'TAO', 'OP', 'U', 'USD1', 'HYPE', 'BNB'],
      includeConvert: true,
      fxManual: null,
      tcbsCustody: '', // số tài khoản lưu ký TCBS (105C…)
    },
    crypto: { holdings: [], updatedAt: 0 },
    history: {
      trades: {}, // SYMBOL -> { lastId, rows: [[id,time,price,qty,quoteQty,commission,commissionAsset,isBuyer]] }
      meta: {}, // SYMBOL -> [base, quote]
      checked: {}, // SYMBOL -> lần quét cuối
      deposits: [], // [id, time, asset, amount]
      withdrawals: [], // [id, time, asset, amount, fee]
      adjust: [], // [id, time, asset, amount] — người dùng bỏ phần coin dư so với ví
      dust: [], // [transId, time, fromAsset, amount, bnbAmount]
      converts: [], // [orderId, time, fromAsset, fromAmount, toAsset, toAmount]
      cursors: {},
      updatedAt: 0,
    },
    futures: { income: [], cursors: {}, account: null, updatedAt: 0 },
    stocks: {
      funds: [], // { ticker, name, currency, source: 'yahoo'|'manual', manualPrice, lastPrice, prevClose, lastPriceAt }
      txs: [], // { id, ticker, date, units (âm = bán), price, fee }
    },
    broker: { tcbs: null, updatedAt: 0 }, // danh mục + tiền đọc từ TCBS (chỉ đọc)
    fx: { USDVND: 25500, updatedAt: 0 },
    cash: [], // { id, name, amount, currency }
    budget: defaultBudget(), // thu chi cá nhân (VND)
    snapshots: [], // { date, crypto, stocks, cash, total }
  };
}

export const state = defaultState();
const listeners = new Set();

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}
function deepMerge(base, over) {
  for (const [k, v] of Object.entries(over || {})) {
    if (isObj(v) && isObj(base[k])) deepMerge(base[k], v);
    else base[k] = v;
  }
  return base;
}

export async function loadState() {
  let saved = null;
  try {
    saved = await idbGet('state');
  } catch {
    try { saved = JSON.parse(localStorage.getItem('fin.state') || 'null'); } catch { /* ignore */ }
  }
  replaceInPlace(deepMerge(defaultState(), saved || {}));
}

/** Dọn dữ liệu do bản thử nghiệm (airdrop / Binance Pay) đã ghi vào lịch sử — bản đó đã bị gỡ. */
export function cleanupState(obj) {
  const h = obj.history;
  if (!h) return obj;
  const notPay = (r) => !String(r[0]).startsWith('pay:');
  h.deposits = (h.deposits || []).filter(notPay);
  h.withdrawals = (h.withdrawals || []).filter(notPay);
  delete h.rewards;
  if (h.cursors) { delete h.cursors.rewards; delete h.cursors.pay; }
  return obj;
}

function replaceInPlace(obj) {
  cleanupState(obj);
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, obj);
}

let persistTimer;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    idbSet('state', state).catch(() => {
      try { localStorage.setItem('fin.state', JSON.stringify(state)); } catch { /* quota */ }
    });
  }, 300);
}

/** Gọi sau mỗi thay đổi dữ liệu người dùng. */
export function commit({ edit = false } = {}) {
  state.updatedAt = Date.now();
  if (edit) state.editedAt = state.updatedAt; // người dùng tự sửa (cài đặt, chứng khoán, tiền mặt)
  persist();
  listeners.forEach((fn) => fn());
}

/** Ghi đè toàn bộ state (dùng khi import / tải từ cloud). */
export function replaceState(obj) {
  replaceInPlace(deepMerge(defaultState(), obj));
  persist();
}

export const onCommit = (fn) => listeners.add(fn);

export function takeSnapshot(t) {
  const date = todayKey();
  const snap = { date, crypto: t.crypto, stable: t.stable || 0, stocks: t.stocks, cash: t.cash, debt: t.debt || 0, total: t.total };
  const i = state.snapshots.findIndex((s) => s.date === date);
  if (i >= 0) state.snapshots[i] = snap;
  else state.snapshots.push(snap);
  state.snapshots.sort((a, b) => a.date.localeCompare(b.date));
}

// ---- cấu hình cục bộ ----
export const local = (() => {
  try { return JSON.parse(localStorage.getItem('fin.local') || '{}'); } catch { return {}; }
})();
export function saveLocal() {
  localStorage.setItem('fin.local', JSON.stringify(local));
}

// ---- đăng nhập server (Vercel) ----
// Trình duyệt chỉ giữ phiên do /api/session cấp (ký HMAC, hết hạn sau 30 ngày), KHÔNG giữ mật khẩu.

export const hasAuth = () => Boolean((local.session && local.session.exp > Date.now()) || local.appPassword);

/** Header xác thực cho mọi request /api. */
export function authHeaders() {
  if (local.session && local.session.exp > Date.now()) return { 'x-app-session': local.session.token };
  if (local.appPassword) return { 'x-app-password': local.appPassword }; // thiết bị cũ, sẽ tự đổi sang phiên
  return {};
}

/** Đổi mật khẩu (+ mã 2FA nếu server bật) lấy phiên. Trả về true nếu đúng. Mật khẩu không được lưu lại. */
export async function login(password, otp = '') {
  const headers = { 'x-app-password': password };
  if (otp) headers['x-app-otp'] = String(otp).replace(/\s/g, '');
  const r = await fetch('/api/session', { method: 'POST', headers });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.token) return false;
  local.session = { token: data.token, exp: data.exp };
  delete local.appPassword;
  saveLocal();
  return true;
}

export function logout() {
  delete local.session;
  delete local.appPassword;
  saveLocal();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('fin:locked'));
}

/** Thiết bị đã lưu mật khẩu (bản cũ) → đổi sang phiên rồi xóa mật khẩu. */
export async function migrateAuth() {
  if (local.appPassword && !(local.session && local.session.exp > Date.now())) {
    try {
      // Nếu server đã bật 2FA thì mật khẩu thôi không đủ → xóa mật khẩu đã lưu, đăng nhập lại có mã 6 số
      if (!(await login(local.appPassword))) dropSession();
    } catch { /* offline: thử lại lần sau */ }
  }
}

/** Server báo hết phiên → xóa để giao diện yêu cầu đăng nhập lại. */
export function dropSession() {
  if (!local.session && !local.appPassword) return;
  delete local.session;
  delete local.appPassword;
  saveLocal();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('fin:locked')); // app hiện màn hình khóa
}

/** Xóa sạch dữ liệu trên thiết bị này (không đụng tới file trên cloud). */
export async function wipeDevice() {
  for (const k of Object.keys(localStorage)) if (k.startsWith('fin.')) localStorage.removeItem(k);
  sessionStorage.clear();
  await new Promise((resolve) => {
    const r = indexedDB.deleteDatabase('finance-dashboard');
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}
