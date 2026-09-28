import { DAY, todayKey } from './util.js';
import { buildEvents, makePriceLookup } from './pnl.js';

// Chuỗi dữ liệu theo ngày cho các biểu đồ "tài sản theo thời gian".

const EPS = 1e-9;
const dayKey = (d) => todayKey(d * DAY);

/** Lấp ngày trống bằng giá trị gần nhất trước đó → trục thời gian đều nhau. */
export function fillDaily(rows, keys) {
  if (!rows.length) return [];
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  let i = 0;
  let prev = null;
  const start = Math.floor(Date.parse(sorted[0].date) / DAY);
  const end = Math.floor(Date.parse(sorted[sorted.length - 1].date) / DAY);
  for (let d = start; d <= end; d++) {
    const key = dayKey(d);
    while (i < sorted.length && sorted[i].date <= key) prev = sorted[i++];
    const row = { date: key };
    for (const k of keys) row[k] = Number(prev?.[k]) || 0;
    out.push(row);
  }
  return out;
}

/** Ảnh chụp tài sản hằng ngày → chuỗi theo loại (crypto rủi ro, stablecoin, CK, tiền mặt, ròng). */
export function snapshotSeries(snapshots) {
  const rows = fillDaily(snapshots || [], ['crypto', 'stable', 'stocks', 'cash', 'debt', 'total']);
  return rows.map((r) => ({
    date: r.date,
    crypto: r.crypto,
    coins: Math.max(0, r.crypto - r.stable),
    stable: r.stable,
    stocks: r.stocks,
    cash: r.cash,
    total: r.total,
  }));
}

/**
 * Dựng lại giá trị coin (không gồm stablecoin, không gồm ví futures) và vốn đang nắm theo ngày
 * từ lịch sử giao dịch Binance + giá đóng cửa ngày. Cùng phương pháp giá vốn bình quân với tab Lãi/lỗ.
 */
export function cryptoSeries(history, priceHist, { now = Date.now() } = {}) {
  const usdAt = makePriceLookup(priceHist);
  const { events } = buildEvents(history, usdAt);
  if (!events.length) return [];
  const pos = new Map(); // asset -> { qty, cost }
  const out = [];
  let i = 0;
  const start = Math.floor(events[0].t / DAY);
  const end = Math.floor(now / DAY);
  for (let d = start; d <= end; d++) {
    const until = (d + 1) * DAY;
    while (i < events.length && events[i].t < until) {
      const e = events[i++];
      const s = pos.get(e.asset) || { qty: 0, cost: 0 };
      if (e.qty > 0) {
        s.qty += e.qty;
        s.cost += e.value || 0;
      } else {
        const matched = Math.min(-e.qty, Math.max(s.qty, 0));
        const avg = s.qty > EPS ? s.cost / s.qty : 0;
        s.cost -= avg * matched;
        s.qty -= matched;
        if (s.qty < EPS) { s.qty = 0; s.cost = 0; }
      }
      pos.set(e.asset, s);
    }
    let value = 0;
    let cost = 0;
    for (const [asset, s] of pos) {
      if (s.qty <= EPS) continue;
      cost += s.cost;
      value += s.qty * (usdAt(asset, Math.min(d * DAY + DAY / 2, now)) ?? 0);
    }
    out.push({ date: dayKey(d), value, cost });
  }
  return out;
}

/**
 * Giá trị & vốn danh mục chứng khoán theo ngày, từ giao dịch tự nhập và giá lịch sử (Yahoo).
 * `hist[ticker]` = [[ms, close], ...]. Thiếu giá lịch sử thì dùng giá giao dịch gần nhất,
 * ngày cuối dùng giá hiện tại. Trả về giá trị theo tiền tệ gốc, quy USD bằng `toUSD`.
 */
export function stockSeries(funds, txs, hist, { toUSD, priceOf, now = Date.now() }) {
  if (!txs.length) return [];
  const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
  const byFund = new Map(funds.map((f) => [f.ticker, f]));
  const pos = new Map(); // ticker -> { units, cost, px, hi }
  const closes = new Map(
    Object.entries(hist || {}).map(([t, rows]) => [t, [...rows].sort((a, b) => a[0] - b[0])]),
  );
  const out = [];
  let i = 0;
  const start = Math.floor(Date.parse(sorted[0].date) / DAY);
  const end = Math.floor(now / DAY);
  for (let d = start; d <= end; d++) {
    const key = dayKey(d);
    while (i < sorted.length && sorted[i].date <= key) {
      const tx = sorted[i++];
      const s = pos.get(tx.ticker) || { units: 0, cost: 0, px: 0, hi: 0 };
      const units = Number(tx.units);
      const price = Number(tx.price);
      const fee = Number(tx.fee) || 0;
      if (units > 0) {
        s.units += units;
        s.cost += units * price + fee;
      } else if (units < 0) {
        const q = Math.min(-units, s.units);
        const avg = s.units ? s.cost / s.units : 0;
        s.cost -= avg * q;
        s.units -= q;
      }
      s.px = price;
      pos.set(tx.ticker, s);
    }
    let value = 0;
    let cost = 0;
    const until = (d + 1) * DAY;
    for (const [ticker, s] of pos) {
      if (s.units <= EPS) continue;
      const f = byFund.get(ticker);
      if (!f) continue;
      const rows = closes.get(ticker) || [];
      while (s.hi < rows.length && rows[s.hi][0] < until) s.px = rows[s.hi++][1];
      const px = d === end ? priceOf(f) || s.px : s.px;
      value += toUSD(s.units * px, f.currency);
      cost += toUSD(s.cost, f.currency);
    }
    out.push({ date: key, value, cost });
  }
  return out;
}

export const RANGES = [['1m', '1T', 30], ['3m', '3T', 91], ['6m', '6T', 182], ['1y', '1N', 365], ['all', 'Tất cả', Infinity]];

/** Cắt chuỗi theo khoảng thời gian (tính lùi từ điểm cuối). */
export function sliceRange(rows, range) {
  const days = RANGES.find((r) => r[0] === range)?.[2] ?? Infinity;
  if (!rows.length || days === Infinity) return rows;
  const last = Date.parse(rows[rows.length - 1].date);
  const from = todayKey(last - days * DAY);
  return rows.filter((r) => r.date >= from);
}

/** Thay đổi giữa điểm đầu và cuối của khoảng đang xem. */
export function rangeChange(rows, key) {
  if (rows.length < 2) return null;
  const a = rows[0][key];
  const b = rows[rows.length - 1][key];
  return { abs: b - a, pct: a > 0 ? (b - a) / a : null };
}
