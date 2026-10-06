import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { store: { 'fin.lang': 'en' }, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = v; } };
const { tr, setLang } = await import('../js/i18n.js');

test('dịch câu cố định, câu có số và tên danh mục', () => {
  assert.equal(tr('Tổng quan'), 'Overview');
  assert.equal(tr('  Lưu  '), '  Save  ');
  assert.equal(tr('856.1 tháng'), '856.1 months');
  assert.equal(tr('Tháng 9/2026'), 'Sep 2026');
  assert.equal(tr('🍜 Ăn uống'), '🍜 Food');
  assert.equal(tr('Hũ Thiết yếu'), 'Jar Essentials');
  assert.equal(tr('Quét giao dịch 5/20 cặp (3 lệnh mới)'), 'Scanning trades 5/20 pairs (3 new)');
  assert.equal(tr('Spot $1 · Futures — · CK —'), 'Spot $1 · Futures — · Stocks —');
  assert.equal(tr('BTC'), 'BTC');
  assert.equal(tr('Hoàn tác'), 'Undo');
  assert.equal(tr('Sửa số dư · Vietcombank'), 'Edit balance · Vietcombank');
  assert.equal(tr('Số tiền (USD)'), 'Amount (USD)');
  assert.equal(tr('Đã xóa giao dịch VOO'), 'Deleted VOO transaction');
  assert.equal(tr('Đã thêm giao dịch bán VOO'), 'Added sell transaction for VOO');
  assert.equal(tr('Futures: 3 bản ghi mới · bỏ qua COIN-M (chưa mở tài khoản hoặc key thiếu quyền)'), 'Futures: 3 new records · skipped COIN-M (account not opened or key lacks permission)');
  assert.equal(tr('Đã xóa Vietcombank'), 'Deleted Vietcombank');
  assert.equal(tr('Server lỗi (HTTP 502)'), 'Server error (HTTP 502)');
  // tab Thu chi (giao diện mới)
  assert.equal(tr('Giao dịch'), 'Transactions');
  assert.equal(tr('Còn tiêu được tháng này'), 'Left to spend this month');
  assert.equal(tr('Đã xóa khoản chi 45.000 ₫'), 'Expense deleted: 45.000 ₫');
  assert.equal(tr('Đã khôi phục khoản thu'), 'Income restored');
  assert.equal(tr('Đã xóa danh mục Ăn uống'), 'Category deleted: Food');
  assert.equal(tr('Sửa khoản thu'), 'Edit income');
  assert.equal(tr('Ngày 5 · Hằng tháng · Vietcombank'), 'Day 5 · Monthly · Vietcombank');
  assert.equal(tr('Chưa có khoản nào trong tháng 10/2026'), 'No entries in Oct 2026');
  assert.equal(tr('Tổng 95% — cần đúng 100%'), 'Total 95% — must be exactly 100%');
  // "Danh mục" / "Tháng 10/2026" nghĩa khác nhau tùy tab: ở Thu chi dịch riêng, chỗ khác giữ nguyên
  assert.equal(tr('Danh mục'), 'Portfolio');
  assert.equal(tr('Danh mục', 'budget'), 'Categories');
  assert.equal(tr('Tháng 10/2026', 'budget'), 'Oct 2026');
});

test('tiếng Việt: giữ nguyên', () => {
  setLang('vi');
  assert.equal(tr('Tổng quan'), 'Tổng quan');
  setLang('en');
});
