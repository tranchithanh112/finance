import { mergeBudget } from './budget.js';

// Gộp dữ liệu của 2 thiết bị (máy này + file trên Dropbox/Drive).
//  - Lịch sử Binance / futures: chỉ thêm, không sửa → HỢP NHẤT, không bao giờ mất bản ghi.
//  - Dữ liệu người dùng tự nhập (cài đặt, chứng khoán, tiền mặt): lấy bên có `editedAt` mới hơn.
//  - Số dư, tỷ giá: lấy bên được cập nhật gần hơn.

const byKey = (lists, key) => {
  const m = new Map();
  for (const list of lists) for (const r of list || []) if (!m.has(key(r))) m.set(key(r), r);
  return [...m.values()];
};

function mergeCursors(a = {}, b = {}) {
  const out = { ...a, ...b };
  for (const k of Object.keys(out)) {
    if (a[k] != null && b[k] != null) out[k] = Math.min(a[k], b[k]); // lấy mốc cũ hơn → lần sau tải lại phần chồng lấn
  }
  return out;
}

function mergeHistory(a = {}, b = {}) {
  const trades = {};
  for (const sym of new Set([...Object.keys(a.trades || {}), ...Object.keys(b.trades || {})])) {
    const x = a.trades?.[sym];
    const y = b.trades?.[sym];
    if (!x || !y) { trades[sym] = x || y; continue; }
    const rows = byKey([x.rows, y.rows], (r) => r[0]).sort((p, q) => p[0] - q[0]);
    trades[sym] = { lastId: Math.max(x.lastId, y.lastId), rows };
  }
  const checked = { ...b.checked };
  for (const [k, v] of Object.entries(a.checked || {})) checked[k] = Math.max(v, checked[k] || 0);
  const byTime = (list) => list.sort((p, q) => p[1] - q[1]);
  return {
    ...b,
    ...a,
    trades,
    meta: { ...b.meta, ...a.meta },
    checked,
    deposits: byTime(byKey([a.deposits, b.deposits], (r) => String(r[0]))),
    withdrawals: byTime(byKey([a.withdrawals, b.withdrawals], (r) => String(r[0]))),
    dust: byTime(byKey([a.dust, b.dust], (r) => `${r[0]}:${r[2]}`)),
    converts: byTime(byKey([a.converts, b.converts], (r) => String(r[0]))),
    cursors: mergeCursors(a.cursors, b.cursors),
    updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0),
  };
}

function mergeFutures(a = {}, b = {}) {
  const newerAcc = (a.account?.updatedAt || 0) >= (b.account?.updatedAt || 0) ? a.account : b.account;
  // Người dùng bấm "Xóa dữ liệu futures" ở 1 máy → bỏ dữ liệu của bên chưa biết lần xóa đó
  const resetAt = Math.max(a.resetAt || 0, b.resetAt || 0);
  const alive = (x) => (x.resetAt || 0) >= resetAt;
  return {
    ...b,
    ...a,
    resetAt,
    income: byKey([alive(a) ? a.income : [], alive(b) ? b.income : []], (r) => r[0]).sort((p, q) => p[1] - q[1]),
    cursors: alive(a) && alive(b) ? mergeCursors(a.cursors, b.cursors) : (alive(a) ? a.cursors : b.cursors) || {},
    account: newerAcc ?? null,
    updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0),
  };
}

export function mergeStates(local, remote) {
  // Hòa (vd máy mới chưa sửa gì, hoặc dữ liệu cũ chưa có editedAt) → ưu tiên bản trên cloud
  const edited = (local.editedAt || 0) > (remote.editedAt || 0) ? local : remote;
  const newer = (k) => ((local[k]?.updatedAt || 0) >= (remote[k]?.updatedAt || 0) ? local[k] : remote[k]);
  const snaps = new Map();
  for (const s of [...(remote.snapshots || []), ...(local.snapshots || [])]) snaps.set(s.date, s);
  return {
    ...remote,
    ...local,
    settings: edited.settings,
    stocks: { ...edited.stocks, funds: mergeFundPrices(edited.stocks?.funds, local, remote) },
    cash: edited.cash,
    editedAt: Math.max(local.editedAt || 0, remote.editedAt || 0),
    updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0),
    crypto: newer('crypto'),
    fx: newer('fx'),
    broker: newer('broker'),
    history: mergeHistory(local.history, remote.history),
    futures: mergeFutures(local.futures, remote.futures),
    budget: mergeBudget(local.budget, remote.budget),
    snapshots: [...snaps.values()].sort((p, q) => p.date.localeCompare(q.date)),
  };
}

/** Giữ danh sách mã theo bên sửa sau cùng, nhưng lấy giá mới nhất từ bất kỳ bên nào. */
function mergeFundPrices(funds = [], local, remote) {
  const latest = new Map();
  for (const f of [...(remote.stocks?.funds || []), ...(local.stocks?.funds || [])]) {
    const cur = latest.get(f.ticker);
    if (!cur || (f.lastPriceAt || 0) > (cur.lastPriceAt || 0)) latest.set(f.ticker, f);
  }
  return funds.map((f) => {
    const p = latest.get(f.ticker);
    return p && (p.lastPriceAt || 0) > (f.lastPriceAt || 0)
      ? { ...f, lastPrice: p.lastPrice, prevClose: p.prevClose, lastPriceAt: p.lastPriceAt }
      : f;
  });
}
