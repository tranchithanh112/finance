import { state, commit } from '../store.js';
import { totals, stockPositions, cryptoHoldings, toUSD } from '../calc.js';
import { donut, line, PALETTE } from '../charts.js';
import { esc, fmtMoney, fmtPct, pnlClass, uid, fmtNative, timeAgo } from '../util.js';

export function renderOverview(root, ctx) {
  const t = totals();
  const pnl = ctx.pnl();
  const fut = ctx.futuresPnl();
  const stocks = stockPositions();
  const stockPnl = stocks.reduce((a, p) => a + p.totalUSD, 0);
  const pct = (v) => (t.total ? fmtPct(v / t.total, { sign: false }) : '—');

  root.innerHTML = `
    <div class="kpis">
      <div class="kpi hero"><span>Tổng tài sản</span><b>${fmtMoney(t.total)}</b>
        <small>Crypto cập nhật ${timeAgo(state.crypto.updatedAt)}</small></div>
      <div class="kpi"><span>Crypto</span><b>${fmtMoney(t.crypto)}</b><small>${pct(t.crypto)} danh mục</small></div>
      <div class="kpi"><span>Chứng khoán / quỹ</span><b>${fmtMoney(t.stocks)}</b><small>${pct(t.stocks)} danh mục</small></div>
      <div class="kpi"><span>Tiền mặt & khác</span><b>${fmtMoney(t.cash)}</b><small>${pct(t.cash)} danh mục</small></div>
      <div class="kpi"><span>PnL futures (từ trước tới nay)</span>
        <b class="${pnlClass(fut ? fut.net + fut.unrealized : 0)}">${fut ? fmtMoney(fut.net + fut.unrealized, { sign: true }) : '—'}</b>
        <small>${fut ? 'Phí + funding ' + fmtMoney(fut.byType.COMMISSION + fut.byType.FUNDING_FEE, { sign: true }) : 'Chưa có dữ liệu futures'}</small></div>
      <div class="kpi"><span>PnL crypto spot (từ trước tới nay)</span>
        <b class="${pnlClass(pnl?.totals.total)}">${pnl ? fmtMoney(pnl.totals.total, { sign: true }) : '—'}</b>
        <small>${pnl ? 'Đã chốt ' + fmtMoney(pnl.totals.realized, { sign: true }) : 'Chưa đồng bộ lịch sử'}</small></div>
      <div class="kpi"><span>PnL chứng khoán</span>
        <b class="${pnlClass(stockPnl)}">${stocks.length ? fmtMoney(stockPnl, { sign: true }) : '—'}</b>
        <small>${stocks.length} mã</small></div>
    </div>

    <div class="grid2">
      <div class="card"><h3>Phân bổ theo loại tài sản</h3><div class="chart"><canvas id="ov-class"></canvas></div></div>
      <div class="card"><h3>Top tài sản</h3><div class="chart"><canvas id="ov-top"></canvas></div></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Lịch sử tổng tài sản</h3><small class="muted">Mỗi ngày lưu 1 điểm khi bạn làm mới dữ liệu</small></div>
      ${state.snapshots.length > 1 ? '<div class="chart tall"><canvas id="ov-hist"></canvas></div>' : '<p class="empty">Cần ít nhất 2 ngày dữ liệu để vẽ biểu đồ.</p>'}
    </div>

    <div class="card">
      <div class="card-head"><h3>Tiền mặt & tài sản khác</h3></div>
      <table class="tbl">
        <thead><tr><th>Tên</th><th class="r">Số tiền</th><th class="r">Quy đổi</th><th></th></tr></thead>
        <tbody>
          ${state.cash.map((c) => `
            <tr><td>${esc(c.name)}</td><td class="r">${fmtNative(Number(c.amount), c.currency)}</td>
            <td class="r">${fmtMoney(toUSD(Number(c.amount), c.currency))}</td>
            <td class="r"><button class="link danger" data-del-cash="${c.id}">Xóa</button></td></tr>`).join('') ||
            '<tr><td colspan="4" class="empty">Chưa có — thêm tiền gửi ngân hàng, tiền mặt, vàng…</td></tr>'}
        </tbody>
      </table>
      <form class="inline-form" id="cash-form">
        <input name="name" placeholder="Tên (vd: Tiết kiệm VCB)" required>
        <input name="amount" type="number" step="any" placeholder="Số tiền" required>
        <select name="currency"><option>VND</option><option>USD</option></select>
        <button class="btn">Thêm</button>
      </form>
    </div>`;

  // Biểu đồ phân bổ theo loại
  const cryptoNonStable = t.crypto - t.stable;
  donut(root.querySelector('#ov-class'), [
    { label: 'Crypto', value: cryptoNonStable, color: PALETTE[0] },
    { label: 'Stablecoin', value: t.stable, color: PALETTE[2] },
    { label: 'Chứng khoán', value: t.stocks, color: PALETTE[1] },
    { label: 'Tiền mặt & khác', value: t.cash, color: PALETTE[9] },
  ]);

  const items = [
    ...cryptoHoldings().map((h) => ({ label: h.asset, value: h.value })),
    ...stocks.map((p) => ({ label: p.ticker, value: p.valueUSD })),
    ...state.cash.map((c) => ({ label: c.name, value: toUSD(Number(c.amount), c.currency) })),
  ];
  donut(root.querySelector('#ov-top'), items);

  if (state.snapshots.length > 1) {
    const s = state.snapshots;
    line(root.querySelector('#ov-hist'), s.map((x) => x.date), [
      { label: 'Tổng', data: s.map((x) => x.total), fill: true, color: PALETTE[0] },
      { label: 'Crypto', data: s.map((x) => x.crypto), color: PALETTE[2] },
      { label: 'Chứng khoán', data: s.map((x) => x.stocks), color: PALETTE[1] },
    ]);
  }

  root.querySelector('#cash-form').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    state.cash.push({ id: uid(), name: f.get('name'), amount: Number(f.get('amount')), currency: f.get('currency') });
    commit();
    ctx.rerender();
  };
  root.querySelectorAll('[data-del-cash]').forEach((b) => {
    b.onclick = () => {
      state.cash = state.cash.filter((c) => c.id !== b.dataset.delCash);
      commit();
      ctx.rerender();
    };
  });
}
