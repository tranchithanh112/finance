import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmount, defaultBudget, generateRecurring, monthSummary, recentAverage, healthScore, mergeBudget, shiftMonth,
  spendingBudget, dayLabel, formatAmountInput, applyAmountKey, restoreTx,
} from '../js/budget.js';

test('spendingBudget: còn tiêu được, mỗi ngày, vượt, tháng cũ, chưa có thu nhập', () => {
  const b = defaultBudget(); // Thiết yếu 30% + Hưởng thụ 15% = 45% thu nhập
  b.txs = [
    { id: 'i', date: '2026-10-05', type: 'income', amount: 20_000_000, cat: 'salary' },
    { id: 'a', date: '2026-10-06', type: 'expense', amount: 3_000_000, cat: 'food' }, // Thiết yếu
    { id: 'b', date: '2026-10-06', type: 'expense', amount: 1_000_000, cat: 'cafe' }, // Hưởng thụ
    { id: 'c', date: '2026-10-06', type: 'expense', amount: 5_000_000, cat: 'saving' }, // để dành: không tính
  ];
  const r = spendingBudget(monthSummary(b, '2026-10'), '2026-10', '2026-10-06');
  assert.equal(r.budget, 9_000_000);
  assert.equal(r.spent, 4_000_000);
  assert.equal(r.left, 5_000_000);
  assert.equal(r.status, 'ok');
  assert.equal(r.daysLeft, 26); // 06 → 31/10, tính cả hôm nay
  assert.equal(Math.round(r.perDay), Math.round(5_000_000 / 26));

  b.txs.push({ id: 'd', date: '2026-10-07', type: 'expense', amount: 6_000_000, cat: 'shopping' });
  const over = spendingBudget(monthSummary(b, '2026-10'), '2026-10', '2026-10-07');
  assert.equal(over.status, 'over');
  assert.equal(over.left, -1_000_000);
  assert.equal(over.perDay, null);

  const past = spendingBudget(monthSummary(b, '2026-10'), '2026-10', '2026-11-02');
  assert.equal(past.daysLeft, null);
  assert.equal(past.perDay, null);

  assert.equal(spendingBudget(monthSummary(b, '2026-09'), '2026-09', '2026-09-03').status, 'noIncome');
});

test('dayLabel: hôm nay, hôm qua (cả qua tháng), ngày khác', () => {
  assert.equal(dayLabel('2026-10-06', '2026-10-06'), 'Hôm nay');
  assert.equal(dayLabel('2026-10-05', '2026-10-06'), 'Hôm qua');
  assert.equal(dayLabel('2026-09-30', '2026-10-01'), 'Hôm qua');
  assert.match(dayLabel('2026-10-03', '2026-10-06'), /03\/10/);
});

test('ô số tiền: tự thêm dấu chấm, nút 000 / nghìn / triệu', () => {
  assert.equal(formatAmountInput('45000'), '45.000');
  assert.equal(formatAmountInput('1234567'), '1.234.567');
  assert.equal(formatAmountInput('45.0001'), '450.001');
  assert.equal(formatAmountInput('007'), '7');
  assert.equal(formatAmountInput('45k'), '45k'); // kiểu tắt: giữ nguyên
  assert.equal(formatAmountInput(''), '');
  assert.equal(applyAmountKey('45', '000'), '45.000');
  assert.equal(applyAmountKey('45', 'k'), '45.000');
  assert.equal(applyAmountKey('4.500', 'k'), '4.500.000');
  assert.equal(applyAmountKey('1,5', 'tr'), '1.500.000');
  assert.equal(applyAmountKey('', 'k'), '');
  assert.equal(parseAmount(applyAmountKey('1,5', 'tr')), 1_500_000);
});

test('restoreTx: hoàn tác xóa vẫn còn sau khi gộp với máy đã biết lần xóa', () => {
  const tx = { id: 'old', date: '2026-10-01', type: 'expense', amount: 1000, cat: 'food', u: 1 };
  const local = { ...defaultBudget(), txs: [], deleted: { old: 5 } };
  const copy = restoreTx(local, tx, 'new');
  assert.equal(copy.id, 'new');
  assert.equal(copy.amount, 1000);
  const remote = { ...defaultBudget(), txs: [tx], deleted: { old: 5 } };
  assert.deepEqual(mergeBudget(local, remote).txs.map((t) => t.id), ['new']);
});

test('parseAmount hiểu cách gõ tiền kiểu Việt', () => {
  assert.equal(parseAmount('45k'), 45000);
  assert.equal(parseAmount('1.2tr'), 1200000);
  assert.equal(parseAmount('1,5tr'), 1500000);
  assert.equal(parseAmount('150.000'), 150000);
  assert.equal(parseAmount('150,000đ'), 150000);
  assert.equal(parseAmount('2 triệu'), 2000000);
  assert.ok(Number.isNaN(parseAmount('abc')));
});

test('shiftMonth qua năm', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2025-12', 1), '2026-01');
});

test('khoản định kỳ: sinh đủ tháng tới hôm nay, không trùng khi chạy lại, tôn trọng đã xóa', () => {
  const b = defaultBudget();
  b.recurring.push({ id: 'r1', type: 'income', amount: 15e6, cat: 'salary', day: 5, startMonth: '2026-07', active: true });
  assert.equal(generateRecurring(b, '2026-09-04'), 2); // 07, 08 (09-05 chưa tới)
  assert.equal(generateRecurring(b, '2026-09-05'), 1);
  assert.equal(generateRecurring(b, '2026-09-30'), 0);
  b.txs = b.txs.filter((t) => t.id !== 'rec:r1:2026-08');
  b.deleted['rec:r1:2026-08'] = 1;
  assert.equal(generateRecurring(b, '2026-09-30'), 0);
});

test('tổng hợp tháng: chia hũ, tỷ lệ tiết kiệm tính cả tiền đem đi đầu tư', () => {
  const b = defaultBudget();
  const add = (type, amount, cat) => b.txs.push({ id: String(b.txs.length), date: '2026-09-10', type, amount, cat });
  add('income', 20e6, 'salary');
  add('expense', 3e6, 'food'); // thiết yếu
  add('expense', 2e6, 'cafe'); // hưởng thụ
  add('expense', 8e6, 'crypto'); // đầu tư
  const s = monthSummary(b, '2026-09');
  assert.equal(s.spend, 5e6);
  assert.equal(s.saved, 8e6);
  assert.equal(s.left, 7e6);
  assert.equal(s.savingsRate, 0.75);
  const nec = s.jars.find((j) => j.id === 'nec');
  assert.equal(nec.alloc, 6e6); // 30%
  assert.equal(nec.used, 3e6);
  const play = s.jars.find((j) => j.id === 'play');
  assert.equal(play.alloc, 3e6); // 15%
});

test('trung bình các tháng đầy đủ bỏ qua tháng hiện tại', () => {
  const b = defaultBudget();
  b.txs.push({ id: 'a', date: '2026-08-05', type: 'income', amount: 10e6, cat: 'salary' });
  b.txs.push({ id: 'b', date: '2026-08-06', type: 'expense', amount: 4e6, cat: 'food' });
  b.txs.push({ id: 'c', date: '2026-09-05', type: 'income', amount: 99e6, cat: 'salary' });
  const avg = recentAverage(b, 3, '2026-09-20');
  assert.equal(avg.months, 1);
  assert.equal(avg.income, 10e6);
  assert.equal(avg.savingsRate, 0.6);
});

test('điểm sức khỏe: bỏ qua tiêu chí thiếu dữ liệu, có gợi ý', () => {
  const good = healthScore({ savingsRate: 0.4, emergencyMonths: 8, emergencyTarget: 6, debtToIncome: 0, riskShare: 0.3, jarsOver: 0 });
  assert.equal(good.score, 100);
  assert.equal(good.tips.length, 0);
  const risky = healthScore({ savingsRate: 0.05, emergencyMonths: 1, riskShare: 0.95 });
  assert.ok(risky.score < 30);
  assert.equal(risky.tips.length, 3);
  assert.equal(healthScore({}).score, null);
});

test('gộp thu chi 2 máy: không mất khoản nhập, khoản đã xóa không quay lại', () => {
  const a = defaultBudget();
  const b = defaultBudget();
  a.txs.push({ id: 'phone', date: '2026-09-01', type: 'expense', amount: 1, cat: 'food', u: 1 });
  b.txs.push({ id: 'pc', date: '2026-09-02', type: 'expense', amount: 2, cat: 'food', u: 1 });
  b.txs.push({ id: 'old', date: '2026-09-03', type: 'expense', amount: 3, cat: 'food', u: 1 });
  a.deleted.old = 5;
  b.jars[0].pct = 40; b.configAt = 10;
  const m = mergeBudget(a, b);
  assert.deepEqual(m.txs.map((t) => t.id), ['phone', 'pc']);
  assert.equal(m.jars[0].pct, 40);
});

test('khoản định kỳ nhiều tháng: Netflix 3 tháng/lần', () => {
  const b = defaultBudget();
  b.recurring.push({ id: 'nf', type: 'expense', amount: 165000, cat: 'fun', day: 15, every: 3, startMonth: '2026-03', active: true });
  generateRecurring(b, '2026-09-28');
  assert.deepEqual(b.txs.map((t) => t.date), ['2026-03-15', '2026-06-15', '2026-09-15']);
});

test('số dư tài khoản: tự cộng lương, trừ chi sau mốc chốt; chốt lại thì không trừ trùng', async () => {
  const { accountBalance, setAnchor } = await import('../js/budget.js');
  const vcb = { id: 'vcb', name: 'VCB', currency: 'VND' };
  setAnchor(vcb, 50e6, 1000, '2026-09-01');
  const txs = [
    { id: 'old', date: '2026-08-05', type: 'income', amount: 20e6, acc: 'vcb', u: 2000 }, // trước mốc (vd lương cũ sinh bù)
    { id: 'sal', date: '2026-09-05', type: 'income', amount: 20e6, acc: 'vcb', u: 3000 },
    { id: 'bn', date: '2026-09-05', type: 'expense', amount: 8e6, acc: 'vcb', u: 3001 },
    { id: 'pho', date: '2026-09-06', type: 'expense', amount: 50e3, acc: 'vcb', u: 4000 },
    { id: 'cash', date: '2026-09-06', type: 'expense', amount: 30e3, acc: null, u: 4001 }, // không gắn tài khoản
  ];
  assert.equal(accountBalance(vcb, txs).balance, 50e6 + 20e6 - 8e6 - 50e3);
  // cuối ngày 06 đối chiếu ngân hàng: 61.9tr
  setAnchor(vcb, 61.9e6, 5000, '2026-09-06');
  assert.equal(accountBalance(vcb, txs).balance, 61.9e6);
  // nhập thêm khoản chi cùng ngày sau khi chốt → vẫn được trừ
  txs.push({ id: 'late', date: '2026-09-06', type: 'expense', amount: 100e3, acc: 'vcb', u: 6000 });
  assert.equal(accountBalance(vcb, txs).balance, 61.8e6);
});

test('sửa / hoàn tác cùng ngày sau khi chốt số dư: không trừ tiền 2 lần', async () => {
  const { accountBalance, setAnchor } = await import('../js/budget.js');
  const vcb = { id: 'vcb', name: 'VCB', currency: 'VND' };
  setAnchor(vcb, 10e6, 2000, '2026-10-06');
  // ghi lúc 1000 (trước khi chốt), sửa ghi chú lúc 3000 → u tăng nhưng thời điểm ghi gốc (at) vẫn trước mốc
  const edited = { id: 't', date: '2026-10-06', type: 'expense', amount: 100e3, acc: 'vcb', at: 1000, u: 3000 };
  assert.equal(accountBalance(vcb, [edited]).balance, 10e6);
  // hoàn tác xóa: bản sao giữ thời điểm ghi gốc (dữ liệu cũ chưa có at → lấy u)
  const copy = restoreTx({ txs: [] }, { id: 'old', date: '2026-10-06', type: 'expense', amount: 100e3, acc: 'vcb', u: 1000 }, 'n');
  assert.equal(copy.at, 1000);
  assert.equal(accountBalance(vcb, [copy]).balance, 10e6);
  // ghi sau mốc chốt thì vẫn trừ
  assert.equal(accountBalance(vcb, [{ ...edited, at: 2500 }]).balance, 9.9e6);
});
