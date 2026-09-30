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
  // Ảnh chụp cũ (trước khi app ghi riêng stablecoin) không có `stable` → lấy theo ảnh gần nhất sau đó
  // (stablecoin ít thay đổi), để không bị trông như crypto "chuyển" hết sang stablecoin.
  const sorted = [...(snapshots || [])].sort((a, b) => a.date.localeCompare(b.date));
  let next = null;
  const snaps = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const x = sorted[i];
    if (x.stable != null) next = x.stable;
    snaps[i] = x.stable != null || next == null ? x : { ...x, stable: Math.min(next, Number(x.crypto) || 0) };
  }
  const rows = fillDaily(snaps, ['crypto', 'stable', 'stocks', 'cash', 'debt', 'total']);
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
export function cryptoSeries(history, priceHist, { now = Date.now(), held = null } = {}) {
  const usdAt = makePriceLookup(priceHist);
  let { events } = buildEvents(history, usdAt);
  if (!events.length) return [];
  if (held) events = reconcileWithWallet(events, held);
  const pos = new Map(); // asset -> { qty, cost }
  const out = [];
  let i = 0;
  let realized = 0;
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
        const q = -e.qty;
        const matched = Math.min(q, Math.max(s.qty, 0));
        const avg = s.qty > EPS ? s.cost / s.qty : 0;
        if (e.kind !== 'withdraw') realized += (e.value || 0) * (matched / q) - avg * matched;
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
    out.push({ date: dayKey(d), value, cost, pnl: value - cost + realized });
  }
  return out;
}

/**
 * Lịch sử có nhiều coin hơn ví thật (coin rời ví qua kênh không có trong lịch sử: cặp đã hủy niêm yết,
 * Binance Pay, P2P…) → thêm 1 sự kiện "rút" (không lãi/lỗ) cho phần dư, đặt ở thời điểm SỚM NHẤT mà từ đó
 * trở đi sổ sách luôn còn đủ phần dư. Nhờ vậy điểm cuối biểu đồ khớp với số coin thật trong ví,
 * giống cách tab Lãi/lỗ tính. `held`: Map asset → số lượng thật (không gồm ví futures).
 */
export function reconcileWithWallet(events, held) {
  const byAsset = new Map();
  events.forEach((e, i) => (byAsset.get(e.asset) || byAsset.set(e.asset, []).get(e.asset)).push(i));
  const extra = [];
  for (const [asset, idx] of byAsset) {
    const qtyAfter = [];
    let q = 0;
    for (const i of idx) {
      const e = events[i];
      q = e.qty > 0 ? q + e.qty : Math.max(0, q - Math.min(-e.qty, Math.max(q, 0)));
      if (q < EPS) q = 0;
      qtyAfter.push(q);
    }
    const gap = q - (held.get(asset) || 0);
    if (gap < -1e-8) {
      // Ví nhiều hơn lịch sử (lãi Earn, airdrop…): giá vốn 0, rải đều theo tháng — chỉ SAU lần bán/rút cuối
      // của coin, để không làm đổi giá vốn các lệnh bán (lãi/lỗ đã chốt giữ nguyên như tab Lãi/lỗ).
      const outs = idx.filter((i) => events[i].qty < 0);
      const t0 = events[outs.length ? outs[outs.length - 1] : idx[0]].t;
      const last = Math.max(t0, events[events.length - 1].t);
      const n = Math.max(1, Math.round((last - t0) / (30 * DAY)));
      for (let j = 1; j <= n; j++) {
        extra.push({ asset, t: t0 + ((last - t0) * j) / n, qty: -gap / n, value: 0, kind: 'reward', ref: { reconcile: true } });
      }
      continue;
    }
    if (gap <= 1e-8) continue;
    let k = qtyAfter.length - 1; // lùi tới khi sổ sách không còn đủ phần dư
    while (k > 0 && qtyAfter[k - 1] >= gap - EPS) k--;
    extra.push({ asset, t: events[idx[k]].t, qty: -gap, value: null, kind: 'withdraw', ref: { reconcile: true } });
  }
  if (!extra.length) return events;
  // cùng thời điểm: nhận vào trước, trả ra sau (giữ quy ước của buildEvents)
  return [...events, ...extra].sort((a, b) => a.t - b.t || b.qty - a.qty);
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
  let realizedUSD = 0;
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
        const f = byFund.get(tx.ticker);
        if (f) realizedUSD += toUSD(q * price - fee - avg * q, f.currency);
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
    out.push({ date: key, value, cost, pnl: value - cost + realizedUSD });
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

/**
 * Lãi/lỗ trong kỳ, KHÔNG tính tiền mua thêm / nạp vào: Δ(giá trị − vốn + đã chốt).
 * % tính trên (giá trị đầu kỳ + vốn bỏ thêm trong kỳ).
 */
export function periodPnl(rows) {
  if (rows.length < 2) return null;
  const a = rows[0];
  const b = rows[rows.length - 1];
  const abs = b.pnl - a.pnl;
  const base = a.value + Math.max(0, b.cost - a.cost);
  return { abs, pct: base > 0 ? abs / base : null };
}

/** Thay đổi giữa điểm đầu và cuối của khoảng đang xem. */
export function rangeChange(rows, key) {
  if (rows.length < 2) return null;
  const a = rows[0][key];
  const b = rows[rows.length - 1][key];
  return { abs: b - a, pct: a > 0 ? (b - a) / a : null };
}
