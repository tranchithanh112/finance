import test from 'node:test';
import assert from 'node:assert/strict';
import { buy, sell, sortTxs } from '../js/lots.js';
import { stockPositions } from '../js/calc.js';
import { stockSeries } from '../js/series.js';

test('lots: giá vốn bình quân, bán vượt → short, rút không lãi/lỗ', () => {
  const p = { qty: 0, cost: 0 };
  buy(p, 2, 200);
  buy(p, 2, 600); // avg 200
  assert.deepEqual(sell(p, 1, 300), { matched: 1, costOut: 200, realized: 100, short: 0 });
  assert.equal(sell(p, 1, null).realized, 0);
  assert.deepEqual(p, { qty: 2, cost: 400 });
  // bán 4 khi chỉ giữ 2: tiền bán chia theo phần khớp
  assert.deepEqual(sell(p, 4, 1000), { matched: 2, costOut: 400, realized: 100, short: 2 });
  assert.deepEqual(p, { qty: 0, cost: 0 });
  assert.equal(sell(p, 0, 5).realized, 0);
});

test('sortTxs: cùng ngày mua trước bán, giữ thứ tự nhập', () => {
  const txs = [
    { id: 1, date: '2025-01-02', units: -1 },
    { id: 2, date: '2025-01-02', units: 5 },
    { id: 3, date: '2025-01-01', units: 1 },
    { id: 4, date: '2025-01-02', units: 3 },
  ];
  assert.deepEqual(sortTxs(txs).map((t) => t.id), [3, 2, 4, 1]);
});

const fundsUSD = [{ ticker: 'A', currency: 'USD', source: 'manual', manualPrice: 10 }];

test('stockPositions: lệnh bán nhập trước lệnh mua cùng ngày vẫn có lãi/lỗ', () => {
  const txs = [
    { ticker: 'A', date: '2025-01-02', units: -5, price: 12, fee: 0 },
    { ticker: 'A', date: '2025-01-02', units: 10, price: 10, fee: 0 },
  ];
  const [p] = stockPositions(txs, fundsUSD, 25000);
  assert.equal(p.units, 5);
  assert.equal(p.realized, 10);
  assert.equal(p.short, 0);
  const s = stockSeries(fundsUSD, txs, {}, { toUSD: (v) => v, priceOf: () => 10, now: Date.UTC(2025, 0, 2, 12) });
  assert.equal(s.at(-1).pnl, 10);
});

test('stockPositions: bán vượt số giữ → giới hạn, phí chia theo phần khớp, gắn cờ short', () => {
  const txs = [
    { ticker: 'A', date: '2025-01-01', units: 10, price: 10, fee: 0 },
    { ticker: 'A', date: '2025-01-02', units: -20, price: 12, fee: 20 },
  ];
  const [p] = stockPositions(txs, fundsUSD, 25000);
  assert.equal(p.units, 0);
  assert.equal(p.short, 10);
  assert.equal(p.realized, 10); // (240 − 20) × 10/20 − 100
});

test('stockPositions: quỹ VND quy đổi theo tỷ giá truyền vào', () => {
  const funds = [{ ticker: 'DCDS', currency: 'VND', source: 'manual', manualPrice: 30000 }];
  const txs = [{ ticker: 'DCDS', date: '2025-01-01', units: 100, price: 25000, fee: 10000 }];
  const [p] = stockPositions(txs, funds, 25000);
  assert.equal(p.cost, 2510000);
  assert.equal(p.valueUSD, 120);
  assert.equal(p.costUSD, 100.4);
  assert.equal(p.unrealizedUSD, 19.6);
});
