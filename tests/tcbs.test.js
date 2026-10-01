import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pickSubAccounts, parseHoldings, parseCash, tcbsHoldings, tcbsCash } from '../js/tcbs.js';
import { seal, unseal, jwtExp } from '../api/tcbs.js';
import { setLang, tr } from '../js/i18n.js';

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
  // dạng trong tài liệu chính thức
  const b = parseHoldings({ assets: [{ symbol: 'FPT', quantity: 100, avgPrice: 120000, marketValue: 11000000 }] });
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
  process.env.APP_PASSWORD = crypto.randomUUID(); // giá trị test sinh lúc chạy
  process.env.TCBS_API_KEY = crypto.randomUUID();
  const jwt = `x.${Buffer.from(JSON.stringify({ exp: 2000000000 })).toString('base64url')}.y`;
  const s = seal(jwt);
  assert.notEqual(s, jwt);
  assert.equal(unseal(s), jwt);
  assert.equal(jwtExp(jwt), 2000000000 * 1000);
  process.env.APP_PASSWORD = crypto.randomUUID();
  assert.throws(() => unseal(s));
});

test('dịch chuỗi TCBS', () => {
  setLang('en');
  assert.equal(tr('Cập nhật 5 phút trước · 1 tiểu khoản · 0 mã · tiền 0 ₫'), 'Updated 5 min ago · 1 sub-accounts · 0 symbols · cash 0 ₫');
  assert.equal(tr('Đã kết nối đến 18:30'), 'Connected until 18:30');
  setLang('vi');
});
