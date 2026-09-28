import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeStates } from '../js/merge.js';

const base = (o = {}) => ({
  version: 1, updatedAt: 0, editedAt: 0,
  settings: { displayCurrency: 'USD', scanQuotes: ['USDT'] },
  crypto: { holdings: [], updatedAt: 0 },
  history: { trades: {}, meta: {}, checked: {}, deposits: [], withdrawals: [], dust: [], converts: [], cursors: {}, updatedAt: 0 },
  futures: { income: [], cursors: {}, account: null, updatedAt: 0 },
  stocks: { funds: [], txs: [] }, fx: { USDVND: 25500, updatedAt: 0 }, cash: [], snapshots: [],
  ...o,
});

test('máy mới (trống nhưng số dư mới hơn) không xóa lịch sử & dữ liệu nhập tay trên cloud', () => {
  const cloud = base({
    updatedAt: 100, editedAt: 50,
    settings: { displayCurrency: 'VND', scanQuotes: ['USDT', 'FDUSD'] },
    history: { ...base().history, trades: { BTCUSDT: { lastId: 2, rows: [[1, 1], [2, 2]] } }, meta: { BTCUSDT: ['BTC', 'USDT'] }, deposits: [['d1', 5, 'ETH', 1]], cursors: { deposits: 10 } },
    stocks: { funds: [{ ticker: 'VOO' }], txs: [{ id: 't1', ticker: 'VOO' }] },
    cash: [{ id: 'c1', name: 'VCB' }],
  });
  const fresh = base({ updatedAt: 999, crypto: { holdings: [{ asset: 'BTC' }], updatedAt: 999 } });
  const m = mergeStates(fresh, cloud);
  assert.equal(m.history.trades.BTCUSDT.rows.length, 2);
  assert.equal(m.history.deposits.length, 1);
  assert.equal(m.settings.displayCurrency, 'VND');
  assert.equal(m.stocks.txs.length, 1);
  assert.equal(m.cash.length, 1);
  assert.equal(m.crypto.updatedAt, 999); // số dư mới nhất của máy mới
});

test('hai máy cùng đồng bộ lịch sử: gộp lệnh không trùng, cursor lấy mốc cũ hơn', () => {
  const a = base({ history: { ...base().history, trades: { SOLUSDT: { lastId: 3, rows: [[1, 1], [3, 3]] } }, converts: [['ai:1', 1], ['ai:2', 2]], cursors: { autoInvest: 200 } } });
  const b = base({ history: { ...base().history, trades: { SOLUSDT: { lastId: 2, rows: [[1, 1], [2, 2]] }, ETHUSDT: { lastId: 9, rows: [[9, 9]] } }, converts: [['ai:2', 2], ['ai:3', 3]], cursors: { autoInvest: 100, pay: 5 } } });
  const m = mergeStates(a, b);
  assert.deepEqual(m.history.trades.SOLUSDT.rows.map((r) => r[0]), [1, 2, 3]);
  assert.equal(m.history.trades.SOLUSDT.lastId, 3);
  assert.ok(m.history.trades.ETHUSDT);
  assert.deepEqual(m.history.converts.map((c) => c[0]), ['ai:1', 'ai:2', 'ai:3']);
  assert.deepEqual(m.history.cursors, { autoInvest: 100, pay: 5 });
});

test('dữ liệu nhập tay: bên sửa sau cùng thắng', () => {
  const a = base({ editedAt: 300, cash: [{ id: 'x', name: 'mới' }] });
  const b = base({ editedAt: 200, cash: [{ id: 'y', name: 'cũ' }] });
  assert.equal(mergeStates(a, b).cash[0].name, 'mới');
  assert.equal(mergeStates(b, a).cash[0].name, 'mới');
});

test('xóa dữ liệu futures không bị đồng bộ kéo về lại', () => {
  const rec = ['csv:1', 1, 'REALIZED_PNL', -5, 'USDT', 'BTCUSDT', 'csv'];
  const cloud = { futures: { income: [rec], cursors: {}, account: null, updatedAt: 1 } };
  const cleared = { futures: { income: [], cursors: {}, account: null, updatedAt: 1, resetAt: 100 } };
  assert.deepEqual(mergeStates(cleared, cloud).futures.income, []);
  assert.deepEqual(mergeStates(cloud, cleared).futures.income, []);
  // nhập lại sau khi xóa thì vẫn giữ
  const reimported = { futures: { income: [rec], cursors: {}, account: null, updatedAt: 2, resetAt: 100 } };
  assert.equal(mergeStates(reimported, cloud).futures.income.length, 1);
});
