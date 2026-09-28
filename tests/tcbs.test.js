import test from 'node:test';
import assert from 'node:assert/strict';
import { normPrice, pickSubAccounts, parseHoldings, parseCash, tcbsHoldings, tcbsCash } from '../js/tcbs.js';
import { seal, unseal, jwtExp } from '../api/tcbs.js';
import { setLang, tr } from '../js/i18n.js';

test('normPrice đổi đơn vị nghìn đồng', () => {
  assert.equal(normPrice(30.5), 30500);
  assert.equal(normPrice(30500), 30500);
  assert.equal(normPrice(null), 0);
});

test('pickSubAccounts bỏ phái sinh', () => {
  const subs = pickSubAccounts({ bankSubAccounts: [
    { accountNo: '0001F1', accountType: 'NORMAL', status: 'A' },
    { accountNo: '0001M1', accountType: 'MARGIN', status: 'A' },
    { accountNo: '0001D1', accountType: 'DERIVATIVE', status: 'A' },
  ] });
  assert.deepEqual(subs.map((s) => s.accountNo), ['0001F1', '0001M1']);
  assert.deepEqual(pickSubAccounts({}), []);
});

test('parse danh mục + tiền, gộp mã trùng giữa tiểu khoản', () => {
  const a = parseHoldings({ stock: [
    { symbol: 'fpt', secType: '001', totalQtty: 100, availableTrading: 100, costPrice: 100000, currentPrice: 110000 },
    { symbol: 'E1VFVN30', secType: '008', totalQtty: 0, costPrice: 20000, currentPrice: 21000 },
  ] });
  assert.equal(a.length, 1);
  assert.equal(a[0].symbol, 'FPT');
  const b = parseHoldings({ stock: [{ symbol: 'FPT', totalQtty: 100, costPrice: 120, currentPrice: 110 }] });
  const t = { accounts: [{ holdings: a, cash: parseCash({ data: [{ balance: 500000, cashDevident: 20000 }] }) }, { holdings: b, cash: 0 }] };
  const [fpt] = tcbsHoldings(t);
  assert.equal(fpt.qty, 200);
  assert.equal(fpt.cost, 110000);
  assert.equal(fpt.value, 22000000);
  assert.equal(tcbsCash(t), 520000);
  assert.deepEqual(parseHoldings(null), []);
  assert.equal(parseCash({ data: [] }), 0);
});

test('seal/unseal token và đọc hạn JWT', () => {
  process.env.APP_PASSWORD = 'pw';
  process.env.TCBS_API_KEY = 'key';
  const jwt = `x.${Buffer.from(JSON.stringify({ exp: 2000000000 })).toString('base64url')}.y`;
  const s = seal(jwt);
  assert.notEqual(s, jwt);
  assert.equal(unseal(s), jwt);
  assert.equal(jwtExp(jwt), 2000000000 * 1000);
  process.env.APP_PASSWORD = 'other';
  assert.throws(() => unseal(s));
});

test('dịch chuỗi TCBS', () => {
  setLang('en');
  assert.equal(tr('Cập nhật 5 phút trước · 1 tiểu khoản · 0 mã · tiền 0 ₫'), 'Updated 5 min ago · 1 sub-accounts · 0 symbols · cash 0 ₫');
  assert.equal(tr('Đã kết nối đến 18:30'), 'Connected until 18:30');
  setLang('vi');
});
