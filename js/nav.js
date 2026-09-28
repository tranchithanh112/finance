// Cấu trúc điều hướng. Mỗi nhóm là 1 tab chính; nhóm có `subs` hiển thị thanh chuyển con ở đầu trang.
export const NAV = [
  { id: 'overview', label: 'Tổng quan', icon: 'home' },
  { id: 'budget', label: 'Thu chi', icon: 'wallet' },
  {
    id: 'crypto', label: 'Crypto', icon: 'coins',
    subs: [
      { id: 'crypto', label: 'Danh mục' },
      { id: 'pnl', label: 'Lãi/lỗ' },
      { id: 'futures', label: 'Futures' },
    ],
  },
  { id: 'stocks', label: 'Chứng khoán', short: 'Chứng khoán', icon: 'trend' },
  { id: 'settings', label: 'Cài đặt', icon: 'gear' },
];

/** Số mục tối đa trên thanh dưới (điện thoại); dư ra thì gom vào "Thêm". */
export const BOTTOM_MAX = 5;

const KEY = 'fin.tabOrder';

/** Thứ tự nhóm tab (riêng từng thiết bị). Tab mới / thiếu được thêm vào cuối. */
export function tabOrder() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { /* ignore */ }
  const ids = NAV.map((n) => n.id);
  const order = saved.filter((id) => ids.includes(id));
  for (const id of ids) if (!order.includes(id)) order.push(id);
  return order.map((id) => NAV.find((n) => n.id === id));
}

export function setTabOrder(ids) {
  try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* ignore */ }
}

export function resetTabOrder() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Nhóm chứa tab (vd 'pnl' thuộc nhóm 'crypto'). */
export function groupOf(tab) {
  return NAV.find((n) => n.id === tab || n.subs?.some((s) => s.id === tab)) || NAV[0];
}

/** Tab con xem gần nhất của một nhóm. */
export function lastSub(group) {
  try { return localStorage.getItem('fin.sub.' + group) || group; } catch { return group; }
}
export function rememberSub(group, tab) {
  try { localStorage.setItem('fin.sub.' + group, tab); } catch { /* ignore */ }
}
