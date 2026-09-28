import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePnl } from '../js/pnl.js';

const DAY = 86400000;
const t0 = Date.UTC(2024, 0, 1);
const empty = () => ({ trades: {}, meta: {}, deposits: [], withdrawals: [], dust: [], converts: [] });
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
// [id,time,price,qty,quoteQty,commission,commissionAsset,isBuyer]

test('mua 2 lần, bán 1 phần: giá vốn bình quân + realized/unrealized', () => {
  const h = empty();
  h.meta.BTCUSDT = ['BTC', 'USDT'];
  h.trades.BTCUSDT = { lastId: 3, rows: [
    [1, t0, 100, 1, 100, 0, 'USDT', 1],
    [2, t0 + DAY, 200, 1, 200, 0, 'USDT', 1],
    [3, t0 + 2 * DAY, 300, 1, 300, 0, 'USDT', 0],
  ] };
  const r = computePnl(h, {}, [{ asset: 'BTC', total: 1, price: 400, value: 400 }]);
  const btc = r.rows.find((x) => x.asset === 'BTC');
  close(btc.avg, 150);
  close(btc.realized, 150);
  close(btc.unrealized, 250);
  close(btc.total, 400);
  close(btc.invested, 300);
  assert.equal(btc.status, 'holding');
});

test('coin đã bán hết được đánh dấu closed', () => {
  const h = empty();
  h.meta.SOLUSDT = ['SOL', 'USDT'];
  h.trades.SOLUSDT = { lastId: 2, rows: [[1, t0, 10, 5, 50, 0, 'USDT', 1], [2, t0 + DAY, 8, 5, 40, 0, 'USDT', 0]] };
  const r = computePnl(h, {}, []);
  const sol = r.rows.find((x) => x.asset === 'SOL');
  close(sol.realized, -10);
  assert.equal(sol.status, 'closed');
  close(r.totals.total, -10);
});

test('phí BNB tính vào giá vốn coin giao dịch, cặp quote BTC sinh 2 chân', () => {
  const h = empty();
  const hist = { BTC: { days: { [Math.floor(t0 / DAY)]: 20000 } }, BNB: { days: { [Math.floor(t0 / DAY)]: 300 } } };
  h.meta.BTCUSDT = ['BTC', 'USDT'];
  h.meta.ETHBTC = ['ETH', 'BTC'];
  h.meta.BNBUSDT = ['BNB', 'USDT'];
  h.trades.BTCUSDT = { lastId: 1, rows: [[1, t0, 20000, 1, 20000, 0, 'USDT', 1]] };
  h.trades.BNBUSDT = { lastId: 1, rows: [[1, t0, 300, 1, 300, 0, 'USDT', 1]] };
  // mua 10 ETH bằng 0.5 BTC, phí 0.01 BNB
  h.trades.ETHBTC = { lastId: 1, rows: [[1, t0 + 1000, 0.05, 10, 0.5, 0.01, 'BNB', 1]] };
  const r = computePnl(h, hist, []);
  const eth = r.rows.find((x) => x.asset === 'ETH');
  const btc = r.rows.find((x) => x.asset === 'BTC');
  const bnb = r.rows.find((x) => x.asset === 'BNB');
  close(eth.ledgerQty, 10);
  close(eth.avg, (10000 + 3) / 10);
  close(btc.ledgerQty, 0.5);
  close(btc.realized, 0);
  close(bnb.ledgerQty, 0.99);
});

test('nạp coin lấy giá thị trường làm giá vốn, rút coin không phát sinh lãi/lỗ', () => {
  const h = empty();
  const d0 = Math.floor(t0 / DAY);
  const hist = { ETH: { days: { [d0]: 1000, [d0 + 10]: 2000 } } };
  h.deposits.push([1, t0, 'ETH', 2]);
  h.withdrawals.push([1, t0 + 10 * DAY, 'ETH', 1, 0]);
  const r = computePnl(h, hist, [{ asset: 'ETH', total: 1, price: 3000, value: 3000 }]);
  const eth = r.rows.find((x) => x.asset === 'ETH');
  close(eth.realized, 0);
  close(eth.costBasis, 1000);
  close(eth.unrealized, 2000);
});

test('bán nhiều hơn số đã ghi nhận -> untracked, không tạo lãi ảo', () => {
  const h = empty();
  h.meta.XRPUSDT = ['XRP', 'USDT'];
  h.trades.XRPUSDT = { lastId: 1, rows: [[1, t0, 1, 100, 100, 0, 'USDT', 0]] };
  const r = computePnl(h, {}, []);
  const x = r.rows.find((y) => y.asset === 'XRP');
  close(x.realized, 0);
  close(x.untrackedQty, 100);
});

test('số dư thực lớn hơn sổ sách (lãi Earn) -> phần dư giá vốn 0', () => {
  const h = empty();
  h.meta.ADAUSDT = ['ADA', 'USDT'];
  h.trades.ADAUSDT = { lastId: 1, rows: [[1, t0, 1, 100, 100, 0, 'USDT', 1]] };
  const r = computePnl(h, {}, [{ asset: 'ADA', total: 110, price: 1, value: 110 }]);
  close(r.rows[0].unrealized, 10);
});

test('DCA Auto-Invest + stake SOL→BNSOL: giá vốn BNSOL đầy đủ, không còn thiếu dữ liệu', () => {
  const h = empty();
  const d0 = Math.floor(t0 / DAY);
  const hist = { SOL: { days: { [d0 + 30]: 150 } } };
  // 30 ngày DCA: mỗi ngày 10 USDT mua 0.1 SOL (giá 100)
  for (let i = 0; i < 30; i++) h.converts.push([`ai:${i}`, t0 + i * DAY, 'USDT', 10, 'SOL', 0.1, 'autoinvest']);
  // stake 3 SOL -> 2.9 BNSOL khi SOL = 150
  h.converts.push(['sol-stake:1', t0 + 30 * DAY, 'SOL', 3, 'BNSOL', 2.9, 'stake']);
  const r = computePnl(h, hist, [{ asset: 'BNSOL', total: 2.9, price: 200, value: 580 }]);
  const sol = r.rows.find((x) => x.asset === 'SOL');
  const bnsol = r.rows.find((x) => x.asset === 'BNSOL');
  close(sol.invested, 300);
  close(sol.realized, 150); // 3 SOL vốn 300, "bán" 450
  assert.equal(sol.trades, 30);
  close(bnsol.costBasis, 450);
  close(bnsol.unrealized, 130);
  close(bnsol.untrackedQty, 0);
  close(r.totals.total, 280);
});

test('mua bằng fiat VND: không coi VND là coin', () => {
  const h = empty();
  const d0 = Math.floor(t0 / DAY);
  h.converts.push(['fiat:1', t0, 'VND', 25000000, 'BTC', 0.02, 'fiat']);
  const r = computePnl(h, { BTC: { days: { [d0]: 50000 } } }, []);
  assert.equal(r.rows.find((x) => x.asset === 'VND'), undefined);
  close(r.rows.find((x) => x.asset === 'BTC').invested, 1000);
  assert.deepEqual(r.missing, []);
});

test('airdrop / lãi Earn: bán coin nhận miễn phí không bị tag thiếu dữ liệu, lãi = toàn bộ tiền bán', () => {
  const h = empty();
  h.rewards = [['div:1', t0, 'ARB', 50, 'Airdrop']];
  h.meta.ARBUSDT = ['ARB', 'USDT'];
  h.trades.ARBUSDT = { lastId: 1, rows: [[1, t0 + DAY, 2, 50, 100, 0, 'USDT', 0]] };
  const r = computePnl(h, {}, []);
  const arb = r.rows.find((x) => x.asset === 'ARB');
  close(arb.untrackedQty, 0);
  close(arb.realized, 100);
  close(arb.invested, 0);
  close(arb.rewardQty, 50);
});

test('bán không rõ nguồn: ghi nhận giá trị USD để quyết định gắn tag', () => {
  const h = empty();
  h.meta.DOGEUSDT = ['DOGE', 'USDT'];
  h.trades.DOGEUSDT = { lastId: 1, rows: [[1, t0, 0.1, 30, 3, 0, 'USDT', 0]] };
  const r = computePnl(h, {}, []);
  const d = r.rows.find((x) => x.asset === 'DOGE');
  close(d.untrackedUsd, 3);
  assert.deepEqual(Object.keys(d.untrackedBy), ['sell']);
});
