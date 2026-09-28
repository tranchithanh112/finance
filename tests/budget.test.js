import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmount, defaultBudget, generateRecurring, monthSummary, recentAverage, healthScore, mergeBudget, shiftMonth,
} from '../js/budget.js';

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
