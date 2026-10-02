import test from 'node:test';
import assert from 'node:assert/strict';
import { goalProgress, snapshotTrend, monthRecap, dcaDue } from '../js/insights.js';
import { defaultBudget } from '../js/budget.js';

test('goalProgress: % và tháng dự kiến đạt', () => {
  const g = goalProgress({ totalUsd: 25000, goalUsd: 40000, monthlyUsd: 1000, now: new Date(2026, 9, 2) });
  assert.equal(g.pct, 0.625);
  assert.equal(g.remaining, 15000);
  assert.equal(g.months, 15);
  assert.equal(g.eta, '2028-01');
  assert.equal(goalProgress({ totalUsd: 1, goalUsd: 10, monthlyUsd: 0 }).eta, null); // không để dành → không ước tính
  assert.equal(goalProgress({ totalUsd: 50, goalUsd: 40, monthlyUsd: 5 }).done, true);
  assert.equal(goalProgress({ totalUsd: 1, goalUsd: 0 }), null);
});

test('snapshotTrend: tăng trung bình mỗi tháng, cần ≥ 30 ngày', () => {
  const snaps = [{ date: '2026-07-04', total: 1000 }, { date: '2026-10-02', total: 1900 }];
  assert.ok(Math.abs(snapshotTrend(snaps, new Date(2026, 9, 2)) - 304.4) < 0.5);
  assert.equal(snapshotTrend([{ date: '2026-09-20', total: 1 }, { date: '2026-10-02', total: 2 }], new Date(2026, 9, 2)), null);
});

test('monthRecap: thu chi so tháng trước, tài sản đầu → cuối tháng, coin kéo lên / xuống', () => {
  const b = defaultBudget();
  const exp = b.categories.find((c) => c.type === 'expense').id;
  b.txs.push({ id: '1', date: '2026-08-10', type: 'expense', amount: 1000, cat: exp });
  b.txs.push({ id: '2', date: '2026-09-10', type: 'expense', amount: 1500, cat: exp });
  b.txs.push({ id: '3', date: '2026-09-01', type: 'income', amount: 5000 });
  const snaps = [
    { date: '2026-08-25', total: 900 }, { date: '2026-08-31', total: 1000 },
    { date: '2026-09-15', total: 1100 }, { date: '2026-09-30', total: 1200 }, { date: '2026-10-01', total: 1300 },
  ];
  const prices = { BTC: { '2026-08-31': 100, '2026-09-30': 120 }, ETH: { '2026-08-31': 10, '2026-09-30': 8 } };
  const priceAt = (a, t) => { const d = new Date(t); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; return prices[a]?.[k] ?? null; };
  const holdings = [{ asset: 'BTC', total: 2, price: 125, value: 250 }, { asset: 'ETH', total: 10, price: 9, value: 90 }];
  const r = monthRecap({ budget: b, ym: '2026-09', snapshots: snaps, holdings, priceAt, now: new Date(2026, 9, 2) });
  assert.equal(r.spend, 1500);
  assert.equal(r.income, 5000);
  assert.equal(r.spendDelta, 0.5);
  assert.deepEqual(r.net && [r.net.start, r.net.end, r.net.change], [1000, 1200, 200]);
  assert.equal(r.up.asset, 'BTC'); assert.equal(r.up.change, 40);
  assert.equal(r.down.asset, 'ETH'); assert.equal(r.down.change, -20);
  // tháng hiện tại: cuối kỳ = hôm nay, giá cuối = giá hiện tại
  const c = monthRecap({ budget: b, ym: '2026-10', snapshots: snaps, holdings, priceAt: (a, t) => priceAt(a, t), now: new Date(2026, 9, 2) });
  assert.equal(c.isCurrent, true);
  assert.equal(c.net.change, 100);
  assert.equal(c.up.asset, 'BTC'); assert.equal(c.up.change, 10);
});

test('dcaDue: mã mua đều các tháng trước mà tháng này chưa mua', () => {
  const txs = [
    { ticker: 'E1VFVN30.VN', date: '2026-08-05', units: 100 },
    { ticker: 'E1VFVN30.VN', date: '2026-09-05', units: 100 },
    { ticker: 'VOO', date: '2026-09-02', units: 1 },
    { ticker: 'VOO', date: '2026-10-01', units: 1 },
    { ticker: 'OLD', date: '2026-09-01', units: 5 }, { ticker: 'OLD', date: '2026-09-20', units: -5 }, // đã bán hết
    { ticker: 'LONG', date: '2026-05-01', units: 5 }, // lâu rồi không mua
  ];
  assert.deepEqual(dcaDue(txs, '2026-10-02'), ['E1VFVN30.VN']);
});
