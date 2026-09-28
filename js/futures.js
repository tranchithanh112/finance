import { isStable, DAY } from './util.js';

/**
 * Lãi/lỗ Futures (USDⓈ-M + COIN-M) dựa trên "income history" của Binance:
 * REALIZED_PNL, FUNDING_FEE, COMMISSION, phí thanh lý… Mỗi bản ghi lưu dạng
 * [key, time, type, amount, asset, symbol, source('um'|'cm'|'csv')].
 *
 * API chỉ trả dữ liệu gần đây (Binance giới hạn khoảng 3 tháng), nên lịch sử cũ
 * được nhập từ file CSV export trên web Binance. Hai nguồn được khử trùng lặp.
 */

export const TYPES = {
  REALIZED_PNL: 'Lãi/lỗ đóng lệnh',
  FUNDING_FEE: 'Funding',
  COMMISSION: 'Phí giao dịch',
  LIQUIDATION: 'Thanh lý / quỹ bảo hiểm',
  REBATE: 'Hoàn phí',
  SETTLEMENT: 'Tất toán HĐ quý',
};

// Chuẩn hóa incomeType của API về các nhóm trên; loại khác (chuyển tiền, thưởng…) bị bỏ qua.
const API_TYPE = {
  REALIZED_PNL: 'REALIZED_PNL',
  FUNDING_FEE: 'FUNDING_FEE',
  COMMISSION: 'COMMISSION',
  INSURANCE_CLEAR: 'LIQUIDATION',
  LIQUIDATION_FEE: 'LIQUIDATION',
  COMMISSION_REBATE: 'REBATE',
  REFERRAL_KICKBACK: 'REBATE',
  API_REBATE: 'REBATE',
  FEE_RETURN: 'REBATE',
  DELIVERED_SETTELMENT: 'SETTLEMENT',
  DELIVERED_SETTLEMENT: 'SETTLEMENT',
};

/** Phân loại dòng "Operation/Type" trong file CSV của Binance. */
export function csvType(s) {
  const t = String(s || '').toLowerCase();
  if (API_TYPE[s?.toUpperCase?.()]) return API_TYPE[s.toUpperCase()];
  if (/realized|profit and loss|realised/.test(t)) return 'REALIZED_PNL';
  if (/funding/.test(t)) return 'FUNDING_FEE';
  if (/insurance|liquidation/.test(t)) return 'LIQUIDATION';
  if (/rebate|kickback|referral|fee return/.test(t)) return 'REBATE';
  if (/settle/.test(t)) return 'SETTLEMENT';
  if (/fee|commission/.test(t)) return 'COMMISSION';
  return null;
}

const looseKey = (t, type, amount, asset) => `${Math.floor(t / 1000)}|${type}|${Number(amount).toFixed(8)}|${asset}`;

export function emptyFutures() {
  return { income: [], cursors: {}, account: null, updatedAt: 0 };
}

/** Thêm bản ghi vào kho, bỏ bản trùng. Trả về số bản ghi mới. */
export function mergeIncome(store, records) {
  const keys = new Set(store.income.map((r) => r[0]));
  const loose = new Map(store.income.map((r, i) => [looseKey(r[1], r[2], r[3], r[4]), i]));
  let added = 0;
  for (const r of records) {
    if (keys.has(r[0])) continue;
    const lk = looseKey(r[1], r[2], r[3], r[4]);
    if (loose.has(lk)) {
      // Cùng giao dịch từ nguồn khác (CSV ↔ API): bổ sung symbol nếu thiếu
      const ex = store.income[loose.get(lk)];
      if (!ex[5] && r[5]) ex[5] = r[5];
      continue;
    }
    store.income.push(r);
    keys.add(r[0]);
    loose.set(lk, store.income.length - 1);
    added++;
  }
  store.income.sort((a, b) => a[1] - b[1]);
  return added;
}

// ================= Đồng bộ qua API =================

async function syncOne(bn, store, src, path, startT, log) {
  const recent = Date.now() - 89 * DAY;
  let start = store.cursors[src] ?? startT;
  let total = 0;
  let firstCall = true;
  for (;;) {
    let batch;
    try {
      batch = await bn(path, { startTime: start, limit: 1000 });
    } catch (e) {
      // Chưa mở tài khoản futures loại này, hoặc startTime quá xa -> thử lại với mốc gần đây
      if (firstCall && start < recent) { start = recent; firstCall = false; continue; }
      if (e.status === 400 || e.status === 401 || e.status === 403 || e.status === 404) {
        log(`${src.toUpperCase()}: bỏ qua (${e.message})`);
        return total;
      }
      throw e;
    }
    if (!batch.length && firstCall && start < recent) { start = recent; firstCall = false; continue; }
    firstCall = false;
    const recs = [];
    for (const r of batch) {
      const type = API_TYPE[r.incomeType];
      if (!type) continue;
      recs.push([`${src}:${r.tranId}:${r.incomeType}:${r.symbol}`, r.time, type, Number(r.income), r.asset, r.symbol || '', src]);
    }
    total += mergeIncome(store, recs);
    if (batch.length) start = batch[batch.length - 1].time + 1;
    if (batch.length < 1000) break;
    log(`${src.toUpperCase()}: ${total} bản ghi mới…`);
  }
  store.cursors[src] = Math.max(start, Date.now() - DAY); // lần sau chồng lấn 1 ngày
  return total;
}

export async function syncFuturesIncome(bn, store, startT, log = () => {}) {
  const um = await syncOne(bn, store, 'um', '/fapi/v1/income', startT, log);
  const cm = await syncOne(bn, store, 'cm', '/dapi/v1/income', startT, log);
  store.updatedAt = Date.now();
  return um + cm;
}

/** Số dư ví futures + vị thế đang mở. */
export async function fetchFuturesAccount(bn) {
  const tryPaths = async (paths, params = {}) => {
    for (const p of paths) {
      try { return await bn(p, params); } catch (e) { if (e.status !== 404 && e.status !== 400) throw e; }
    }
    return null;
  };
  const [um, umPos, cm, cmPos] = await Promise.all([
    tryPaths(['/fapi/v3/account', '/fapi/v2/account']).catch(() => null),
    tryPaths(['/fapi/v3/positionRisk', '/fapi/v2/positionRisk']).catch(() => null),
    bn('/dapi/v1/account').catch(() => null),
    bn('/dapi/v1/positionRisk').catch(() => null),
  ]);
  const assets = [];
  for (const [src, acc] of [['um', um], ['cm', cm]]) {
    for (const a of acc?.assets || []) {
      const wallet = Number(a.walletBalance);
      const unreal = Number(a.unrealizedProfit);
      if (wallet || unreal) assets.push({ src, asset: a.asset, wallet, unrealized: unreal, margin: wallet + unreal });
    }
  }
  const positions = [];
  for (const [src, list] of [['um', umPos], ['cm', cmPos]]) {
    for (const p of list || []) {
      const amt = Number(p.positionAmt);
      if (!amt) continue;
      positions.push({
        src, symbol: p.symbol, side: p.positionSide !== 'BOTH' ? p.positionSide : amt > 0 ? 'LONG' : 'SHORT',
        amt, entry: Number(p.entryPrice), mark: Number(p.markPrice), liq: Number(p.liquidationPrice) || null,
        leverage: Number(p.leverage) || null, unrealized: Number(p.unRealizedProfit ?? p.unrealizedProfit),
        marginAsset: src === 'cm' ? p.symbol.replace(/USD_.*$/, '') : (p.marginAsset || 'USDT'),
      });
    }
  }
  return { assets, positions, ok: Boolean(um || cm), updatedAt: Date.now() };
}

// ================= Nhập CSV =================

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

function parseTime(s) {
  s = String(s).trim();
  if (/^\d{12,}$/.test(s)) return Number(s);
  if (/^\d{2}-\d{2}-\d{2} /.test(s)) s = '20' + s; // "23-05-01 12:00:00"
  const iso = s.replace(' ', 'T');
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
  return Number.isFinite(t) ? t : null;
}

/**
 * Hỗ trợ:
 *  - Sao kê giao dịch ví (User_ID, UTC_Time, Account, Operation, Coin, Change, Remark) — chỉ lấy dòng Account chứa "Futures"
 *  - Lịch sử giao dịch Futures (Time, Type/Income Type, Amount/Income, Asset, Symbol)
 */
export function csvToIncome(text) {
  const rows = parseCsv(text);
  const hi = rows.findIndex((r) => r.some((c) => /time|date/i.test(c)) && r.some((c) => /change|amount|income|realized/i.test(c)));
  if (hi < 0) throw new Error('Không nhận ra cột thời gian / số tiền trong file CSV');
  const head = rows[hi].map((h) => h.trim().toLowerCase());
  const col = (re, not) => head.findIndex((h) => re.test(h) && !(not && not.test(h)));
  const iTime = col(/time|date/);
  const iType = col(/operation|income ?type|^type$|type/);
  const iAmt = col(/^change$|amount|^income$|realized|change/);
  const iAsset = col(/coin|asset/);
  const iSym = col(/symbol|pair/);
  const iAcc = col(/account/);
  if (iTime < 0 || iType < 0 || iAmt < 0) throw new Error('Thiếu cột Time / Operation(Type) / Change(Amount)');

  const out = [];
  let skipped = 0;
  for (const r of rows.slice(hi + 1)) {
    if (iAcc >= 0 && !/futures|\bum\b|\bcm\b|coin-m|usd.?-?m/i.test(r[iAcc] || '')) { skipped++; continue; }
    const type = csvType(r[iType]);
    const t = parseTime(r[iTime]);
    const amt = Number(String(r[iAmt]).replace(/[^\d.eE+-]/g, ''));
    if (!type || t == null || !Number.isFinite(amt) || amt === 0) { skipped++; continue; }
    const asset = (iAsset >= 0 ? r[iAsset] : 'USDT').trim().toUpperCase() || 'USDT';
    const symbol = iSym >= 0 ? (r[iSym] || '').trim().toUpperCase() : '';
    const src = /coin/i.test(r[iAcc] || '') ? 'cm' : 'csv';
    out.push([`csv:${looseKey(t, type, amt, asset)}|${symbol}`, t, type, amt, asset, symbol, src]);
  }
  return { records: out, skipped };
}

// ================= Tính toán =================

export function computeFutures(store, usdAt, account, priceNow = () => 0) {
  const byType = Object.fromEntries(Object.keys(TYPES).map((k) => [k, 0]));
  const bySym = {};
  const monthly = new Map();
  const timeline = [];
  const missing = new Set();
  let net = 0;
  for (const [, t, type, amt, asset, symbol] of store.income) {
    let p = isStable(asset) || asset === 'BNFCR' ? 1 : usdAt(asset, t);
    if (p == null) { missing.add(asset); p = 0; }
    const usd = amt * p;
    byType[type] += usd;
    net += usd;
    const s = (bySym[symbol || '?'] ||= { symbol: symbol || '?', net: 0, count: 0, first: t, last: t, ...Object.fromEntries(Object.keys(TYPES).map((k) => [k, 0])) });
    s[type] += usd;
    s.net += usd;
    if (type === 'REALIZED_PNL') s.count++;
    s.last = t;
    const m = new Date(t).toISOString().slice(0, 7);
    monthly.set(m, (monthly.get(m) || 0) + usd);
    timeline.push([t, net]);
  }
  const unrealized = (account?.positions || []).reduce((a, p) => {
    const price = isStable(p.marginAsset) || p.marginAsset === 'BNFCR' ? 1 : priceNow(p.marginAsset);
    return a + p.unrealized * price;
  }, 0);
  const symbols = Object.values(bySym).sort((a, b) => a.net - b.net);
  return {
    net, byType, symbols, unrealized,
    monthly: [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    timeline,
    missing: [...missing],
    first: store.income[0]?.[1] || null,
    count: store.income.length,
    wins: symbols.filter((s) => s.net > 0).length,
    losses: symbols.filter((s) => s.net < 0).length,
  };
}
