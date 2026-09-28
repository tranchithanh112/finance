import { test } from 'node:test';
import assert from 'node:assert/strict';

// store.js dùng IndexedDB/localStorage; chỉ cần stub tối thiểu để import được.
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const { state, replaceState } = await import('../js/store.js');

test('gỡ bản ghi Binance Pay và airdrop còn sót trong dữ liệu đã lưu', () => {
  replaceState({
    history: {
      deposits: [[1, 1, 'ETH', 1], ['pay:9:0', 2, 'SOL', 5]],
      withdrawals: [['pay:8:0', 3, 'BNB', 1]],
      rewards: [['div:1', 1, 'ARB', 50, '']],
      cursors: { rewards: 1, pay: 1, deposits: 5 },
    },
  });
  assert.deepEqual(state.history.deposits, [[1, 1, 'ETH', 1]]);
  assert.deepEqual(state.history.withdrawals, []);
  assert.equal(state.history.rewards, undefined);
  assert.deepEqual(state.history.cursors, { deposits: 5 });
});
