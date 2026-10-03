import test from 'node:test';
import assert from 'node:assert/strict';
import { fmarketQuote, fundCode, parseHistory } from '../api/_fmarket.js';
import { quoteSymbol } from '../js/calc.js';

test('fundCode / quoteSymbol: dcds.vn → DCDS, quỹ mở hỏi FMARKET:, còn lại hỏi Yahoo', () => {
  assert.equal(fundCode(' dcds.vn '), 'DCDS');
  assert.equal(quoteSymbol({ ticker: 'DCDS.VN', source: 'fmarket' }), 'FMARKET:DCDS');
  assert.equal(quoteSymbol({ ticker: 'E1VFVN30.VN', source: 'yahoo' }), 'E1VFVN30.VN');
});

test('fmarketQuote: NAV, giá phiên trước suy từ % thay đổi, mã không có → not found', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { rows: [
    { id: 28, shortName: 'DCDS', code: 'VFMVF1', name: 'Quỹ DC', nav: 93391.37, productNavChange: { navToPrevious: -0.57, updateAt: 1791001326166 } },
  ] } }));
  try {
    const q = await fmarketQuote('dcds.vn');
    assert.equal(q.price, 93391.37);
    assert.equal(q.currency, 'VND');
    assert.ok(Math.abs(q.prevClose - 93926.77) < 0.05);
    await assert.rejects(fmarketQuote('XYZ'), /not found/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('parseHistory: navDate → ms UTC, bỏ dòng hỏng, sắp xếp tăng dần', () => {
  const h = parseHistory([{ navDate: '2026-10-02', nav: 2 }, { navDate: '2026-10-01', nav: 1 }, { navDate: 'x', nav: 3 }, { navDate: '2026-09-30', nav: 0 }]);
  assert.deepEqual(h, [[Date.UTC(2026, 9, 1), 1], [Date.UTC(2026, 9, 2), 2]]);
});
