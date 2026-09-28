import test from 'node:test';
import assert from 'node:assert/strict';
import { fillDaily, snapshotSeries, cryptoSeries, stockSeries, sliceRange, rangeChange, periodPnl } from '../js/series.js';

const DAY = 864e5;
const d0 = Date.UTC(2025, 0, 1);

test('fillDaily lấp ngày trống bằng giá trị trước đó', () => {
  const rows = fillDaily([{ date: '2025-01-01', v: 1 }, { date: '2025-01-04', v: 4 }], ['v']);
  assert.deepEqual(rows.map((r) => r.v), [1, 1, 1, 4]);
  assert.equal(rows[2].date, '2025-01-03');
});

test('snapshotSeries tách coin / stablecoin, snapshot cũ không có stable', () => {
  const [a, b] = snapshotSeries([
    { date: '2025-01-01', crypto: 100, stocks: 5, cash: 10, total: 115 },
    { date: '2025-01-02', crypto: 120, stable: 20, stocks: 5, cash: 10, total: 135 },
  ]);
  assert.equal(a.coins, 100); assert.equal(a.stable, 0);
  assert.equal(b.coins, 100); assert.equal(b.stable, 20); assert.equal(b.crypto, 120);
});

test('cryptoSeries: giá trị theo giá ngày, vốn theo giá vốn bình quân', () => {
  const history = {
    trades: { BTCUSDT: { lastId: 2, rows: [
      [1, d0, 100, 2, 200, 0, 'USDT', true],
      [2, d0 + 2 * DAY, 150, 1, 150, 0, 'USDT', false],
    ] } },
    meta: { BTCUSDT: ['BTC', 'USDT'] }, deposits: [], withdrawals: [], dust: [], converts: [],
  };
  const days = {};
  for (let k = 0; k < 4; k++) days[d0 / DAY + k] = 100 + k * 50; // 100,150,200,250
  const s = cryptoSeries(history, { BTC: { days } }, { now: d0 + 3 * DAY + 1000 });
  assert.equal(s.length, 4);
  assert.deepEqual(s.map((r) => r.value), [200, 300, 200, 250]);
  assert.deepEqual(s.map((r) => r.cost), [200, 200, 100, 100]);
  // bán 1 BTC giá 150 (vốn 100) → đã chốt +50; lãi/lỗ cộng dồn = giá trị − vốn + đã chốt
  assert.deepEqual(s.map((r) => r.pnl), [0, 100, 150, 200]);
  assert.deepEqual(cryptoSeries({ ...history, trades: {} }, {}), []);
});

test('stockSeries dùng giá lịch sử, ngày cuối dùng giá hiện tại', () => {
  const funds = [{ ticker: 'E1VFVN30.VN', currency: 'VND', source: 'yahoo', lastPrice: 40000 }];
  const txs = [
    { id: 'a', ticker: 'E1VFVN30.VN', date: '2025-01-01', units: 100, price: 30000, fee: 0 },
    { id: 'b', ticker: 'E1VFVN30.VN', date: '2025-01-03', units: 100, price: 32000, fee: 0 },
  ];
  const hist = { 'E1VFVN30.VN': [[d0 + 2 * 3600e3, 31000], [d0 + DAY + 2 * 3600e3, 33000]] };
  const s = stockSeries(funds, txs, hist, { toUSD: (v) => v, priceOf: (f) => f.lastPrice, now: d0 + 3 * DAY + 1000 });
  assert.deepEqual(s.map((r) => r.value), [3100000, 3300000, 6400000, 8000000]);
  assert.deepEqual(s.map((r) => r.cost), [3000000, 3000000, 6200000, 6200000]);
});

test('sliceRange / rangeChange', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ date: new Date(d0 + i * DAY).toISOString().slice(0, 10), v: i + 1 }));
  assert.equal(sliceRange(rows, '1m').length, 31);
  assert.equal(sliceRange(rows, 'all').length, 100);
  const ch = rangeChange(sliceRange(rows, '1m'), 'v');
  assert.equal(ch.abs, 30);
  assert.equal(rangeChange([rows[0]], 'v'), null);
});

test('periodPnl không tính tiền mua thêm là lãi', () => {
  // đầu kỳ giữ 100$, mua thêm 900$, giá không đổi → lãi 0 dù giá trị tăng 10 lần
  assert.deepEqual(periodPnl([{ value: 100, cost: 100, pnl: 0 }, { value: 1000, cost: 1000, pnl: 0 }]), { abs: 0, pct: 0 });
  const r = periodPnl([{ value: 100, cost: 80, pnl: 20 }, { value: 1100, cost: 980, pnl: 120 }]);
  assert.equal(r.abs, 100);
  assert.equal(r.pct, 100 / 1000);
  assert.equal(periodPnl([{ value: 1, cost: 1, pnl: 0 }]), null);
});
