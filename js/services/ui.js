import { takeSnapshot } from '../store.js';
import { totals } from '../calc.js';

// Chỗ nối service ↔ giao diện: app.js gắn hàm thật vào `ui` lúc khởi động,
// để service (crypto / futures / stocks) gọi vẽ lại mà không import ngược app.js.
export const ui = {
  render() {},
  go() {},
  current: () => 'overview',
};

/** Lưu ảnh chụp tài sản hôm nay (sau mỗi lần làm mới số dư / giá). */
export function snapshot() {
  const t = totals();
  if (t.total > 0) takeSnapshot(t);
}
