import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmount, defaultBudget, generateRecurring, monthSummary, recentAverage, healthScore, mergeBudget, shiftMonth,
  spendingBudget, dayLabel, formatAmountInput, applyAmountKey, restoreTx,
  spendForecast, upcomingBills, quickPicks, searchTxs, parseQuickEntry, unusualAmount,
} from '../js/budget.js';

test('parseQuickEntry: gõ nhanh tách số tiền, danh mục, ghi chú', () => {
  const b = defaultBudget();
  const p = (s) => { const r = parseQuickEntry(s, b); return [r.amount, r.cat, r.type, r.note]; };
  assert.deepEqual(p('cà phê 35k'), [35000, 'cafe', 'expense', 'cà phê']);
  assert.deepEqual(p('Lương 25tr'), [25e6, 'salary', 'income', 'Lương']);
  assert.deepEqual(p('60k ăn trưa với team'), [60000, 'food', 'expense', 'ăn trưa với team']);
  assert.deepEqual(p('grab về nhà 45.000'), [45000, 'transport', 'expense', 'grab về nhà']);
  assert.deepEqual(p('tiền điện 1,2tr'), [1.2e6, 'bills', 'expense', 'tiền điện']);
  assert.deepEqual(p('linh tinh'), [null, null, 'expense', 'linh tinh']);
});

test('unusualAmount: cao gấp > 3 lần trung vị 90 ngày thì cảnh báo', () => {
  const b = defaultBudget();
  for (let i = 1; i <= 6; i++) b.txs.push({ id: `c${i}`, date: `2026-11-${String(i).padStart(2, '0')}`, type: 'expense', cat: 'cafe', amount: 35000 + i * 1000 });
  assert.equal(unusualAmount(b, 'cafe', 350000, '2026-11-25').typical, 39000);
  assert.equal(unusualAmount(b, 'cafe', 90000, '2026-11-25'), null);
  assert.equal(unusualAmount(b, 'food', 5e6, '2026-11-25'), null); // chưa đủ dữ liệu
});

test('spendForecast: theo tốc độ tiêu tới ngày 10 của tháng 30 ngày', () => {
  const sb = { status: 'ok', spent: 3e6, budget: 8e6 };
  assert.deepEqual(spendForecast(sb, '2026-11', '2026-11-10'), { projected: 9e6, over: 1e6 });
  assert.equal(spendForecast(sb, '2026-11', '2026-11-02'), null); // quá sớm
  assert.equal(spendForecast(sb, '2026-10', '2026-11-10'), null); // tháng cũ
});

test('upcomingBills: khoản chi định kỳ trong 7 ngày tới, kể cả sang tháng sau', () => {
  const b = defaultBudget();
  b.recurring.push(
    { id: 'rent', type: 'expense', amount: 5e6, cat: 'bills', day: 2, startMonth: '2026-01', active: true },
    { id: 'net', type: 'expense', amount: 2e5, cat: 'bills', day: 15, startMonth: '2026-01', active: true },
    { id: 'sal', type: 'income', amount: 2e7, cat: 'salary', day: 28, startMonth: '2026-01', active: true },
    { id: 'q', type: 'expense', amount: 1e6, cat: 'bills', day: 1, every: 3, startMonth: '2026-01', active: true },
  );
  assert.deepEqual(upcomingBills(b, '2026-11-28').map((r) => [r.id, r.date]), [['rent', '2026-12-02']]);
  assert.deepEqual(upcomingBills(b, '2026-09-28').map((r) => r.id), ['q', 'rent']); // quý: 01, 04, 07, 10
});

test('quickPicks: cặp danh mục + số tiền ghi ≥ 2 lần, nhiều nhất trước', () => {
  const b = defaultBudget();
  const tx = (id, date, cat, amount) => ({ id, date, type: 'expense', cat, amount });
  b.txs.push(tx('1', '2026-11-20', 'cafe', 35000), tx('2', '2026-11-21', 'cafe', 35000), tx('3', '2026-11-22', 'cafe', 35000),
    tx('4', '2026-11-20', 'food', 60000), tx('5', '2026-11-24', 'food', 60000), tx('6', '2026-11-24', 'shopping', 1e6),
    tx('7', '2026-08-01', 'fun', 1), tx('8', '2026-08-02', 'fun', 1));
  assert.deepEqual(quickPicks(b, '2026-11-25').map((p) => [p.cat, p.amount, p.count]), [['cafe', 35000, 3], ['food', 60000, 2]]);
});

test('searchTxs: tìm không dấu theo ghi chú, danh mục, tài khoản ở mọi tháng', () => {
  const b = defaultBudget();
  b.txs.push({ id: 'a', date: '2026-01-05', type: 'expense', cat: 'food', note: 'Phở bò', acc: 'v' },
    { id: 'b', date: '2026-11-05', type: 'expense', cat: 'cafe', note: '', acc: null });
  const acc = (id) => (id === 'v' ? 'Vietcombank' : '');
  assert.deepEqual(searchTxs(b, 'pho', acc).map((t) => t.id), ['a']);
  assert.deepEqual(searchTxs(b, 'cafe', acc).map((t) => t.id), ['b']);
  assert.deepEqual(searchTxs(b, 'vietcom', acc).map((t) => t.id), ['a']);
  assert.deepEqual(searchTxs(b, '  ', acc), []);
});

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

test('ô số tiền kiểu tiếng Anh: nhóm nghìn bằng dấu phẩy, dấu chấm là thập phân', () => {
  assert.equal(formatAmountInput('45000', ','), '45,000');
  assert.equal(formatAmountInput('45,0001', ','), '450,001');
  assert.equal(formatAmountInput('1.5', ','), '1.5'); // số thập phân đang gõ: giữ nguyên
  assert.equal(applyAmountKey('45', '000', ','), '45,000');
  assert.equal(applyAmountKey('4,500', 'k', ','), '4,500,000');
  assert.equal(applyAmountKey('1.5', 'tr', ','), '1,500,000');
  assert.equal(parseAmount(applyAmountKey('1.5', 'tr', ',')), 1_500_000);
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
  assert.equal(parseAmount('1.5'), 1.5);
  assert.equal(parseAmount('2,25'), 2.25);
  assert.equal(parseAmount('1,500'), 1500);
  assert.equal(parseAmount('1.234.567'), 1234567);
  assert.ok(Number.isNaN(parseAmount('1.2.3')));
});

test('khoản định kỳ do máy khác tự sinh không đè số tiền người dùng đã sửa', () => {
  const rec = () => { const b = defaultBudget(); b.recurring.push({ id: 'r1', type: 'expense', amount: 5e6, cat: 'housing', day: 5, startMonth: '2026-09', active: true }); return b; };
  const edited = rec();
  generateRecurring(edited, '2026-09-10');
  Object.assign(edited.txs[0], { amount: 5.5e6, u: 1000 });
  const stale = rec();
  generateRecurring(stale, '2026-09-10');
  for (const m of [mergeBudget(edited, stale), mergeBudget(stale, edited)]) assert.equal(m.txs[0].amount, 5.5e6);
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
