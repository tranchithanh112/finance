// Giá vốn bình quân gia quyền cho 1 vị thế `pos = { qty, cost }` — dùng chung cho crypto và chứng khoán.

const EPS = 1e-9;

export function buy(pos, qty, cost) {
  pos.qty += qty;
  pos.cost += cost;
}

/**
 * Giảm `qty` khỏi vị thế. Chỉ khớp tối đa số đang giữ; `proceeds` (đã trừ phí) chia theo phần khớp.
 * `proceeds == null` = chuyển ra ngoài: giảm theo giá vốn, không lãi/lỗ.
 * Trả về { matched, costOut, realized, short } — `short` = phần bán vượt số đã ghi nhận (thiếu dữ liệu).
 */
export function sell(pos, qty, proceeds) {
  const avg = pos.qty > EPS ? pos.cost / pos.qty : 0;
  const matched = Math.min(qty, Math.max(pos.qty, 0));
  const costOut = avg * matched;
  const realized = proceeds == null ? 0 : (qty > 0 ? proceeds * (matched / qty) : 0) - costOut;
  pos.cost -= costOut;
  pos.qty -= matched;
  if (pos.qty < EPS) { pos.qty = 0; pos.cost = 0; }
  return { matched, costOut, realized, short: qty - matched };
}

/** Giao dịch CK theo ngày; cùng ngày thì mua trước bán sau, giữ thứ tự nhập. */
export const sortTxs = (txs) => [...txs].sort((a, b) => a.date.localeCompare(b.date) || (Number(b.units) > 0) - (Number(a.units) > 0));
