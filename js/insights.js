// Các phép tính cho thẻ "Mục tiêu", "Tóm tắt tháng" và nhắc mua định kỳ — hàm thuần, không đụng DOM / state.
import { monthSummary, monthKey, shiftMonth } from './budget.js';

const DAY = 864e5;
const ymOf = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const endOfMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0); }; // ngày cuối tháng (giờ máy)
const dayKey = (d) => `${ymOf(d)}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Tiến độ mục tiêu tài sản ròng.
 * monthlyUsd: mức tài sản tăng thêm mỗi tháng (để dành / xu hướng) — không có hoặc ≤ 0 thì không ước tính ngày đạt.
 */
export function goalProgress({ totalUsd, goalUsd, monthlyUsd, now = new Date() }) {
  if (!(goalUsd > 0)) return null;
  const pct = Math.max(0, totalUsd / goalUsd);
  const remaining = Math.max(0, goalUsd - totalUsd);
  const done = remaining === 0;
  let months = null;
  let eta = null;
  if (!done && monthlyUsd > 0) {
    months = Math.ceil(remaining / monthlyUsd);
    if (months <= 600) eta = ymOf(new Date(now.getFullYear(), now.getMonth() + months, 1));
    else months = null; // > 50 năm: coi như không ước tính được
  }
  return { pct, remaining, done, months, eta };
}

/**
 * Tài sản ròng tăng trung bình mỗi tháng theo các ảnh chụp hằng ngày (dùng khi chưa nhập thu chi).
 * Cần ít nhất ~30 ngày dữ liệu.
 */
export function snapshotTrend(snapshots, now = new Date(), days = 90) {
  if (!snapshots?.length) return null;
  const last = snapshots.at(-1);
  const from = dayKey(new Date(now.getTime() - days * DAY));
  const first = snapshots.find((s) => s.date >= from) || snapshots[0];
  const span = (Date.parse(last.date) - Date.parse(first.date)) / DAY;
  if (span < 30) return null;
  return ((last.total - first.total) / span) * 30.44;
}

/** Ảnh chụp cuối cùng có ngày ≤ date (yyyy-mm-dd). */
const snapAt = (snapshots, date) => {
  let hit = null;
  for (const s of snapshots || []) if (s.date <= date) hit = s; else break;
  return hit;
};

/**
 * Tóm tắt 1 tháng: thu chi (so với tháng trước), tài sản ròng đầu → cuối tháng,
 * coin kéo lên / kéo xuống nhiều nhất (số coin đang giữ × biến động giá trong tháng).
 * priceAt(asset, ms) → giá USD đóng cửa ngày đó (null nếu không có).
 */
export function monthRecap({ budget, ym, snapshots = [], holdings = [], priceAt, now = new Date() }) {
  const cur = monthSummary(budget, ym);
  const prev = monthSummary(budget, shiftMonth(ym, -1));
  const isCurrent = ym === ymOf(now);
  const endDate = isCurrent ? now : endOfMonth(ym);
  const startDate = endOfMonth(shiftMonth(ym, -1)); // chốt cuối tháng trước

  const s0 = snapAt(snapshots, dayKey(startDate));
  const s1 = snapAt(snapshots, dayKey(endDate));
  const net = s0 && s1 && s1.date > s0.date
    ? { start: s0.total, end: s1.total, change: s1.total - s0.total, pct: s0.total ? (s1.total - s0.total) / Math.abs(s0.total) : null }
    : null;

  const movers = [];
  for (const h of holdings) {
    if (!(h.value > 0) || !priceAt) continue;
    const p0 = priceAt(h.asset, startDate.getTime());
    const p1 = isCurrent ? h.price : priceAt(h.asset, endDate.getTime());
    if (!(p0 > 0) || !(p1 > 0) || p0 === p1) continue;
    movers.push({ asset: h.asset, change: h.total * (p1 - p0), pct: p1 / p0 - 1 });
  }
  movers.sort((a, b) => b.change - a.change);
  const up = movers[0]?.change > 0 ? movers[0] : null;
  const down = movers.at(-1)?.change < 0 ? movers.at(-1) : null;

  return {
    ym, isCurrent,
    income: cur.income, spend: cur.spend, saved: cur.saved, hasBudget: cur.txs.length > 0,
    spendPrev: prev.txs.length ? prev.spend : null,
    spendDelta: prev.txs.length && prev.spend > 0 ? cur.spend / prev.spend - 1 : null,
    net, up, down,
  };
}

/**
 * Mã đang mua định kỳ mà tháng này chưa mua: có lệnh mua trong 1 trong `lookback` tháng trước,
 * vẫn còn nắm giữ, nhưng chưa có lệnh mua nào trong tháng hiện tại.
 */
export function dcaDue(txs = [], today, lookback = 2) {
  const cur = monthKey(today);
  const recent = new Set(Array.from({ length: lookback }, (_, i) => shiftMonth(cur, -(i + 1))));
  const held = new Map();
  for (const t of txs) held.set(t.ticker, (held.get(t.ticker) || 0) + Number(t.units || 0));
  const boughtNow = new Set(txs.filter((t) => t.units > 0 && monthKey(t.date) === cur).map((t) => t.ticker));
  const regular = new Set(txs.filter((t) => t.units > 0 && recent.has(monthKey(t.date))).map((t) => t.ticker));
  return [...regular].filter((tk) => !boughtNow.has(tk) && held.get(tk) > 1e-9).sort();
}
