import { state } from '../store.js';
import { cryptoTotal } from '../calc.js';
import { donut } from '../charts.js';
import { esc, fmtMoney, fmtQty, fmtPrice, fmtPct, pnlClass, timeAgo, isStable } from '../util.js';

let showDust = false;

export function renderCrypto(root, ctx) {
  const total = cryptoTotal();
  const dust = Number(state.settings.dustUsd) || 0;
  const all = state.crypto.holdings;
  const list = showDust ? all : all.filter((h) => h.value >= dust);
  const stable = all.filter((h) => isStable(h.asset)).reduce((a, h) => a + h.value, 0);
  const pnl = ctx.pnl();
  const pnlBy = Object.fromEntries((pnl?.rows || []).map((r) => [r.asset, r]));
  const wallets = all.reduce((a, h) => {
    a.spot += h.spot * h.price; a.funding += h.funding * h.price; a.earn += h.earn * h.price; a.futures += (h.futures || 0) * h.price; return a;
  }, { spot: 0, funding: 0, earn: 0, futures: 0 });

  if (!all.length) {
    root.innerHTML = `<div class="card center">
      <h3>Chưa có dữ liệu Binance</h3>
      <p class="muted">Cấu hình <code>BINANCE_API_KEY</code>, <code>BINANCE_API_SECRET</code>, <code>APP_PASSWORD</code> trên Vercel,
      nhập mật khẩu ứng dụng trong tab Cài đặt rồi bấm làm mới.</p>
      <button class="btn primary" id="cr-load">Tải số dư Binance</button></div>`;
    root.querySelector('#cr-load').onclick = () => ctx.refreshCrypto();
    return;
  }

  // bỏ qua nếu thiếu giá lịch sử (toàn bộ = 0)
  root.innerHTML = `
    <div class="kpis">
      <div class="kpi hero"><span>Tổng giá trị crypto</span><b>${fmtMoney(total)}</b><small>Cập nhật ${timeAgo(state.crypto.updatedAt)}</small></div>
      ${[['Spot', wallets.spot], ['Funding', wallets.funding], ['Earn', wallets.earn], ['Futures (ký quỹ)', wallets.futures]]
        .filter(([, v]) => v >= 1) // bỏ ví gần như trống
        .map(([l, v]) => `<div class="kpi"><span>${l}</span><b>${fmtMoney(v)}</b><small>${total ? fmtPct(v / total, { sign: false }) : ''}</small></div>`).join('')}
      <div class="kpi"><span>Stablecoin</span><b>${fmtMoney(stable)}</b><small>${total ? fmtPct(stable / total, { sign: false }) : ''}</small></div>
    </div>
    <div class="card">
      <h3>Phân bổ theo coin</h3>
      <div class="chart"><canvas id="cr-alloc"></canvas></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Tỷ trọng & lãi/lỗ</h3>
        <label class="check"><input type="checkbox" id="cr-dust" ${showDust ? 'checked' : ''}> Hiện coin bụi (&lt; ${fmtMoney(dust)})</label>
      </div>
      <div class="bars alloc">
        ${list.slice(0, 15).map((h) => {
          const p = pnlBy[h.asset];
          const pct = p?.unrealized != null && p.costBasis > 0 ? p.unrealized / p.costBasis : null;
          return `
          <div class="bar-row"><span class="bar-label">${esc(h.asset)}</span>
            <div class="bar"><i style="width:${total ? (h.value / total) * 100 : 0}%"></i></div>
            <span class="bar-val">${total ? fmtPct(h.value / total, { sign: false }) : ''}</span>
            <span class="bar-money">${fmtMoney(h.value, { compact: true })}</span>
            <span class="bar-pnl ${pnlClass(pct)}">${pct != null ? fmtPct(pct) : isStable(h.asset) ? '' : '—'}</span></div>`;
        }).join('')}
      </div>
      ${pnl ? '<p class="muted small">Cột cuối: lãi/lỗ chưa chốt so với giá vốn của số coin đang giữ.</p>' : ''}
    </div>
    <div class="card">
      <div class="table-wrap"><table class="tbl">
        <thead><tr>
          <th>Coin</th><th class="r">Số lượng</th><th class="r hide-sm">Spot / Funding / Earn${wallets.futures ? ' / Futures' : ''}</th><th class="r">Giá</th>
          <th class="r">Giá trị</th><th class="r">Tỷ trọng</th><th class="r hide-sm">Giá vốn TB</th><th class="r">Lãi/lỗ chưa chốt</th><th class="r">Tổng PnL</th>
        </tr></thead>
        <tbody>
          ${list.map((h) => {
            const p = pnlBy[h.asset];
            return `<tr>
              <td><b>${esc(h.asset)}</b></td>
              <td class="r">${fmtQty(h.total)}</td>
              <td class="r hide-sm muted">${fmtQty(h.spot)} / ${fmtQty(h.funding)} / ${fmtQty(h.earn)}${wallets.futures ? ' / ' + fmtQty(h.futures || 0) : ''}</td>
              <td class="r">${fmtPrice(h.price)}</td>
              <td class="r"><b>${fmtMoney(h.value)}</b></td>
              <td class="r">${total ? fmtPct(h.value / total, { sign: false }) : ''}</td>
              <td class="r hide-sm">${p?.avg ? fmtPrice(p.avg) : '—'}</td>
              <td class="r ${pnlClass(p?.unrealized)}">${p?.unrealized != null ? fmtMoney(p.unrealized, { sign: true }) : '—'}</td>
              <td class="r ${pnlClass(p?.total)}">${p?.total != null ? fmtMoney(p.total, { sign: true }) : '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
      ${pnl ? '' : '<p class="muted small">Cột giá vốn / PnL cần đồng bộ lịch sử ở tab "Lịch sử & PnL".</p>'}
    </div>`;

  donut(root.querySelector('#cr-alloc'), all.map((h) => ({ label: h.asset, value: h.value })), { legendPct: true });
  root.querySelector('#cr-dust').onchange = (e) => { showDust = e.target.checked; ctx.rerender(); };
}
