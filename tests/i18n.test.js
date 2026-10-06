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
  assert.equal(tr('Đã xóa giao dịch VOO'), 'Deleted VOO transaction');
  assert.equal(tr('Đã thêm giao dịch bán VOO'), 'Added sell transaction for VOO');
  assert.equal(tr('Futures: 3 bản ghi mới · bỏ qua COIN-M (chưa mở tài khoản hoặc key thiếu quyền)'), 'Futures: 3 new records · skipped COIN-M (account not opened or key lacks permission)');
  assert.equal(tr('Đã xóa Vietcombank'), 'Deleted Vietcombank');
  assert.equal(tr('Server lỗi (HTTP 502)'), 'Server error (HTTP 502)');
});

test('tiếng Việt: giữ nguyên', () => {
  setLang('vi');
  assert.equal(tr('Tổng quan'), 'Tổng quan');
  setLang('en');
});
