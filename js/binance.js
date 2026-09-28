import { state, local } from './store.js';
import { idbGet, idbSet } from './idb.js';
import { sleep, isStable, DAY } from './util.js';

// ================= Gọi API =================

export class ApiError extends Error {
  constructor(msg, status) {
    super(msg);
    this.status = status;
  }
}

/** Gọi Binance qua proxy /api/binance (ký HMAC ở server). */
export async function bn(path, params = {}, { signal } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch('/api/binance', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-app-password': local.appPassword || '' },
      body: JSON.stringify({ path, params }),
      signal,
    });
    if (r.status === 429 || r.status === 418) {
      const wait = (Number(r.headers.get('x-retry-after')) || 60) * 1000;
      await sleep(Math.min(wait, 120000));
      continue;
    }
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      throw new ApiError(data?.msg || data?.error || `HTTP ${r.status}`, r.status);
    }
    const used = Number(r.headers.get('x-used-weight')) || 0;
    if (used > 4500) await sleep(61000 - (Date.now() % 60000)); // chờ sang phút mới
    return data;
  }
  throw new ApiError('Bị giới hạn tốc độ (rate limit) quá nhiều lần', 429);
}

/** Endpoint public: gọi thẳng data-api.binance.vision (có CORS), lỗi thì fallback qua proxy. */
export async function pub(path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null));
  try {
    const r = await fetch(`https://data-api.binance.vision${path}?${qs}`);
    if (r.ok) return await r.json();
    if (r.status === 400) throw new ApiError((await r.json().catch(() => ({}))).msg || 'Bad request', 400);
  } catch (e) {
    if (e instanceof ApiError) throw e;
  }
  return bn(path, params);
}

// ================= Giá hiện tại =================

export async function fetchTickerPrices() {
  const arr = await pub('/api/v3/ticker/price');
  const m = {};
  for (const t of arr) m[t.symbol] = Number(t.price);
  return m;
}

export function usdPrice(asset, tick) {
  if (isStable(asset)) return 1;
  for (const q of ['USDT', 'FDUSD', 'USDC']) if (tick[asset + q]) return tick[asset + q];
  if (tick[asset + 'BTC'] && tick.BTCUSDT) return tick[asset + 'BTC'] * tick.BTCUSDT;
  if (tick[asset + 'BNB'] && tick.BNBUSDT) return tick[asset + 'BNB'] * tick.BNBUSDT;
  if (tick['USDT' + asset]) return 1 / tick['USDT' + asset]; // fiat như TRY, BRL
  return 0;
}

// ================= Số dư (Spot + Funding + Earn) =================

export async function fetchHoldings() {
  const [tick, account, funding, flex, locked] = await Promise.all([
    fetchTickerPrices(),
    bn('/api/v3/account', { omitZeroBalances: true }),
    bn('/sapi/v1/asset/get-funding-asset', {}).catch(() => null),
    bn('/sapi/v1/simple-earn/flexible/position', { size: 100 }).catch(() => null),
    bn('/sapi/v1/simple-earn/locked/position', { size: 100 }).catch(() => null),
  ]);

  const map = {};
  const add = (asset, key, amt) => {
    if (!amt) return;
    map[asset] ||= { asset, spot: 0, funding: 0, earn: 0 };
    map[asset][key] += amt;
  };

  for (const b of account.balances) {
    let asset = b.asset;
    const amt = Number(b.free) + Number(b.locked);
    // Tài sản dạng LDxxx là "bóng" của Simple Earn trong ví spot.
    if (asset.startsWith('LD') && asset !== 'LDO' && asset.length > 2) {
      if (flex) continue; // đã tính trong earn
      asset = asset.slice(2);
      add(asset, 'earn', amt);
      continue;
    }
    add(asset, 'spot', amt);
  }
  for (const f of funding || []) add(f.asset, 'funding', Number(f.free) + Number(f.locked) + Number(f.freeze || 0));
  for (const p of flex?.rows || []) add(p.asset, 'earn', Number(p.totalAmount));
  for (const p of locked?.rows || []) add(p.asset, 'earn', Number(p.amount));

  const holdings = Object.values(map).map((h) => {
    const total = h.spot + h.funding + h.earn;
    const price = usdPrice(h.asset, tick);
    return { ...h, total, price, value: total * price };
  });
  holdings.sort((a, b) => b.value - a.value);
  return { holdings, tick };
}

// ================= Lịch sử giá (nến ngày) để định giá giao dịch cũ =================

let priceCache = null; // asset -> { days: {dayIndex: close}, from, to, symbol }
async function loadPriceCache() {
  if (!priceCache) priceCache = (await idbGet('priceHist').catch(() => null)) || {};
  return priceCache;
}
export async function getPriceHistory() {
  return loadPriceCache();
}

/** Đảm bảo có giá ngày của `asset` từ `fromT` tới hiện tại. */
export async function ensurePriceHistory(asset, fromT, tick) {
  if (isStable(asset)) return;
  const cache = await loadPriceCache();
  const today = Math.floor(Date.now() / DAY);
  const fromDay = Math.floor(fromT / DAY);
  const entry = cache[asset];
  if (entry && entry.from <= fromDay && entry.to >= today - 1) return;
  if (entry?.missing && entry.checked > Date.now() - 7 * DAY) return;

  let symbol = null;
  let invert = false;
  for (const q of ['USDT', 'BUSD', 'FDUSD', 'USDC']) if (tick[asset + q]) { symbol = asset + q; break; }
  if (!symbol && tick['USDT' + asset]) { symbol = 'USDT' + asset; invert = true; }
  if (!symbol) symbol = asset + 'USDT'; // có thể đã hủy niêm yết nhưng vẫn còn nến cũ

  const days = entry?.days || {};
  let start = entry && entry.from <= fromDay ? (entry.to + 1) * DAY : fromDay * DAY;
  let got = 0;
  try {
    while (start < Date.now()) {
      const k = await pub('/api/v3/klines', { symbol, interval: '1d', startTime: start, limit: 1000 });
      if (!k.length) break;
      for (const c of k) {
        const v = (Number(c[1]) + Number(c[4])) / 2; // trung bình mở/đóng cửa trong ngày
        days[Math.floor(c[0] / DAY)] = invert ? 1 / v : v;
      }
      got += k.length;
      start = k[k.length - 1][0] + DAY;
      if (k.length < 1000) break;
    }
  } catch {
    /* symbol không tồn tại */
  }
  if (!got && !entry) {
    cache[asset] = { missing: true, checked: Date.now(), days: {} };
  } else {
    const keys = Object.keys(days).map(Number);
    cache[asset] = { symbol, days, from: Math.min(fromDay, ...keys), to: Math.max(...keys) };
  }
  await idbSet('priceHist', cache).catch(() => {});
}

// ================= Đồng bộ lịch sử giao dịch =================

const ROW = (t) => [t.id, t.time, Number(t.price), Number(t.qty), Number(t.quoteQty), Number(t.commission), t.commissionAsset, t.isBuyer ? 1 : 0];

async function fetchSymbolTrades(symbol, signal) {
  const h = state.history;
  const entry = (h.trades[symbol] ||= { lastId: -1, rows: [] });
  let fromId = entry.lastId + 1;
  let n = 0;
  for (;;) {
    const batch = await bn('/api/v3/myTrades', { symbol, fromId, limit: 1000 }, { signal });
    for (const t of batch) {
      if (t.id > entry.lastId) {
        entry.rows.push(ROW(t));
        entry.lastId = t.id;
        n++;
      }
    }
    if (batch.length < 1000) break;
    fromId = entry.lastId + 1;
  }
  if (!entry.rows.length) delete h.trades[symbol];
  h.checked[symbol] = Date.now();
  return n;
}

/** Duyệt theo cửa sổ thời gian [start, now) với độ dài `span`. */
async function windows(fromT, span, fn) {
  for (let s = fromT; s < Date.now(); s += span) await fn(s, Math.min(s + span - 1, Date.now()));
}

async function syncDepositsWithdrawals(startT, log) {
  const h = state.history;
  const span = 89 * DAY;

  const depFrom = h.cursors.deposits || startT;
  const depIds = new Set(h.deposits.map((d) => d[0]));
  await windows(depFrom, span, async (s, e) => {
    const list = await bn('/sapi/v1/capital/deposit/hisrec', { startTime: s, endTime: e, limit: 1000 });
    for (const d of list) {
      if ((d.status === 1 || d.status === 6) && !depIds.has(d.id)) {
        h.deposits.push([d.id, d.insertTime, d.coin, Number(d.amount)]);
        depIds.add(d.id);
      }
    }
  });
  h.cursors.deposits = Date.now() - 2 * DAY; // chồng lấn để bắt nạp đang chờ
  log(`Nạp: ${h.deposits.length} bản ghi`);

  const wFrom = h.cursors.withdrawals || startT;
  const wIds = new Set(h.withdrawals.map((d) => d[0]));
  await windows(wFrom, span, async (s, e) => {
    const list = await bn('/sapi/v1/capital/withdraw/history', { startTime: s, endTime: e, limit: 1000 });
    for (const w of list) {
      if (w.status === 6 && !wIds.has(w.id)) {
        const t = Date.parse(String(w.applyTime).replace(' ', 'T') + 'Z');
        h.withdrawals.push([w.id, t, w.coin, Number(w.amount), Number(w.transactionFee || 0)]);
        wIds.add(w.id);
      }
    }
  });
  h.cursors.withdrawals = Date.now() - 2 * DAY;
  log(`Rút: ${h.withdrawals.length} bản ghi`);
}

async function syncDust(startT, log) {
  const h = state.history;
  const seen = new Set(h.dust.map((d) => d[0] + ':' + d[2]));
  await windows(h.cursors.dust || startT, 89 * DAY, async (s, e) => {
    const r = await bn('/sapi/v1/asset/dribblet', { startTime: s, endTime: e }).catch(() => null);
    for (const g of r?.userAssetDribblets || []) {
      for (const d of g.userAssetDribbletDetails || []) {
        const key = d.transId + ':' + d.fromAsset;
        if (seen.has(key)) continue;
        seen.add(key);
        h.dust.push([d.transId, d.operateTime || g.operateTime, d.fromAsset, Number(d.amount), Number(d.transferedAmount)]);
      }
    }
  });
  h.cursors.dust = Date.now() - DAY;
  log(`Đổi dust sang BNB: ${h.dust.length} bản ghi`);
}

async function syncConverts(startT, log, signal) {
  const h = state.history;
  const seen = new Set(h.converts.map((c) => c[0]));
  // Convert history bị giới hạn 30 ngày/lần & weight cao → giãn nhịp ~1.1s/lần
  const from = Math.max(h.cursors.converts || startT, Date.parse('2020-06-01'));
  await windows(from, 30 * DAY, async (s, e) => {
    if (signal?.aborted) throw new DOMException('Đã hủy', 'AbortError');
    const r = await bn('/sapi/v1/convert/tradeFlow', { startTime: s, endTime: e, limit: 1000 }, { signal });
    for (const c of r?.list || []) {
      if (c.orderStatus !== 'SUCCESS' || seen.has(c.orderId)) continue;
      seen.add(c.orderId);
      h.converts.push([c.orderId, c.createTime, c.fromAsset, Number(c.fromAmount), c.toAsset, Number(c.toAmount)]);
    }
    log(`Convert: đã quét tới ${new Date(e).toISOString().slice(0, 10)}`);
    await sleep(1100);
  });
  h.cursors.converts = Date.now() - DAY;
}

/**
 * Đồng bộ toàn bộ lịch sử. `fullScan` = quét mọi cặp giao dịch có quote trong scanQuotes
 * (chậm, chỉ cần làm 1 lần), ngược lại chỉ quét các coin đã biết.
 */
export async function syncHistory({ fullScan = false, onProgress = () => {}, signal } = {}) {
  const h = state.history;
  const st = state.settings;
  const startT = Date.parse(st.historyStart || '2018-01-01') || Date.parse('2018-01-01');
  const log = (msg, pct) => onProgress(msg, pct);

  log('Tải danh sách cặp giao dịch…', 0);
  const [info, tick] = await Promise.all([bn('/api/v3/exchangeInfo', {}), fetchTickerPrices()]);
  const allSymbols = info.symbols; // [symbol, base, quote, status]

  log('Tải lịch sử nạp / rút…', 2);
  await syncDepositsWithdrawals(startT, log);
  await syncDust(startT, log);
  if (st.includeConvert) await syncConverts(startT, log, signal);

  // Tập coin ứng viên
  const cand = new Set(st.extraAssets.map((a) => a.toUpperCase()));
  state.crypto.holdings.forEach((x) => cand.add(x.asset));
  h.deposits.forEach((d) => cand.add(d[2]));
  h.withdrawals.forEach((d) => cand.add(d[2]));
  h.dust.forEach((d) => cand.add(d[2]));
  h.converts.forEach((c) => { cand.add(c[2]); cand.add(c[4]); });
  Object.values(h.meta).forEach(([b, q]) => { if (h.trades[b + q]) cand.add(b); });

  const quotes = new Set(st.scanQuotes);
  const symbols = allSymbols.filter(([s, b, q]) =>
    quotes.has(q) && (fullScan || cand.has(b) || h.trades[s]) && !(isStable(b) && isStable(q)));
  for (const [s, b, q] of symbols) h.meta[s] = [b, q];
  // Cặp đã có giao dịch nhưng không còn trong exchangeInfo (đã hủy niêm yết) thì bỏ qua — API không trả nữa.

  let done = 0;
  let newTrades = 0;
  for (const [s] of symbols) {
    if (signal?.aborted) throw new DOMException('Đã hủy', 'AbortError');
    try {
      newTrades += await fetchSymbolTrades(s, signal);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      if (e.status !== 400) throw e; // 400 = symbol không hợp lệ, bỏ qua
    }
    done++;
    if (done % 5 === 0 || done === symbols.length) {
      log(`Quét giao dịch ${done}/${symbols.length} cặp (${newTrades} lệnh mới)`, 10 + (done / symbols.length) * 75);
    }
  }

  // Giá lịch sử cho mọi tài sản non-stable xuất hiện trong lịch sử
  const need = new Map();
  const want = (a, t) => { if (!isStable(a)) need.set(a, Math.min(need.get(a) ?? Infinity, t)); };
  for (const [s, e] of Object.entries(h.trades)) {
    const [b, q] = h.meta[s] || [];
    if (!e.rows.length) continue;
    const t0 = e.rows[0][1];
    want(b, t0); want(q, t0);
    for (const r of e.rows) if (r[5] > 0) want(r[6], r[1]);
  }
  h.deposits.forEach((d) => want(d[2], d[1]));
  h.withdrawals.forEach((d) => want(d[2], d[1]));
  h.dust.forEach((d) => { want(d[2], d[1]); want('BNB', d[1]); });
  h.converts.forEach((c) => { want(c[2], c[1]); want(c[4], c[1]); });

  let i = 0;
  for (const [asset, t] of need) {
    if (signal?.aborted) throw new DOMException('Đã hủy', 'AbortError');
    await ensurePriceHistory(asset, t, tick);
    i++;
    if (i % 5 === 0 || i === need.size) log(`Tải giá lịch sử ${i}/${need.size} tài sản`, 85 + (i / need.size) * 15);
  }

  h.updatedAt = Date.now();
  log(`Xong: ${newTrades} lệnh mới`, 100);
  return { newTrades };
}
