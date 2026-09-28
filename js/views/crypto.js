import { state } from '../store.js';
import { cryptoTotal } from '../calc.js';
import { donut, PALETTE } from '../charts.js';
import { snapshotSeries } from '../series.js';
import { historyCard, bindHistory, histMode } from './history-card.js';
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
  const recon = ctx.cryptoSeries().some((r) => r.value > 0) ? ctx.cryptoSeries() : [];
  const hmode = recon.length > 1 ? histMode('crypto', 'coins') : 'wallet';
  const hist = hmode === 'coins'
    ? {
      id: 'crypto', title: 'Coin đang nắm theo thời gian', rows: recon, key: 'value',
      modes: [['coins', 'Giá trị vs vốn'], ['wallet', 'Tổng ví']], mode: hmode,
      note: 'Dựng lại từ lịch sử giao dịch Binance và giá đóng cửa từng ngày; không gồm stablecoin và ví futures. Khoảng cách giữa hai đường là lãi/lỗ chưa chốt.',
      series: [
        { key: 'value', label: 'Giá trị coin', color: PALETTE[0], area: 'gradient' },
        { key: 'cost', label: 'Vốn đang nắm', color: PALETTE[4], dash: true },
      ],
    }
    : {
      id: 'crypto', title: 'Tổng ví crypto theo thời gian', rows: snapshotSeries(state.snapshots), key: 'crypto',
      modes: recon.length > 1 ? [['coins', 'Giá trị vs vốn'], ['wallet', 'Tổng ví']] : null, mode: hmode,
      note: 'Số dư thực tế của ví (gồm stablecoin), mỗi ngày lưu 1 điểm khi bạn mở app.'
        + (recon.length > 1 ? '' : ' Đồng bộ lịch sử ở tab Lãi/lỗ để xem được từ ngày đầu tiên.'),
      series: [
        { key: 'coins', label: 'Coin', color: PALETTE[0], area: 'stack' },
        { key: 'stable', label: 'Stablecoin', color: PALETTE[2], area: 'stack' },
      ],
    };

  root.innerHTML = `
    <div class="kpis">
      <div class="kpi hero"><span>Tổng giá trị crypto</span><b>${fmtMoney(total)}</b><small>Cập nhật ${timeAgo(state.crypto.updatedAt)}</small></div>
      <div class="kpi"><span>Spot</span><b>${fmtMoney(wallets.spot)}</b></div>
      <div class="kpi"><span>Funding</span><b>${fmtMoney(wallets.funding)}</b></div>
      <div class="kpi"><span>Earn</span><b>${fmtMoney(wallets.earn)}</b></div>
      ${wallets.futures ? `<div class="kpi"><span>Futures (ký quỹ)</span><b>${fmtMoney(wallets.futures)}</b></div>` : ''}
      <div class="kpi"><span>Stablecoin</span><b>${fmtMoney(stable)}</b><small>${total ? fmtPct(stable / total, { sign: false }) : ''}</small></div>
    </div>
    ${historyCard(hist)}
    <div class="grid2 wide-right">
      <div class="card"><h3>Phân bổ danh mục</h3><div class="chart"><canvas id="cr-donut"></canvas></div></div>
      <div class="card">
        <div class="card-head"><h3>Tỷ trọng</h3>
          <label class="check"><input type="checkbox" id="cr-dust" ${showDust ? 'checked' : ''}> Hiện coin bụi (&lt; ${fmtMoney(dust)})</label>
        </div>
        <div class="bars">
          ${list.slice(0, 12).map((h) => `
            <div class="bar-row"><span class="bar-label">${esc(h.asset)}</span>
              <div class="bar"><i style="width:${total ? (h.value / total) * 100 : 0}%"></i></div>
              <span class="bar-val">${total ? fmtPct(h.value / total, { sign: false }) : ''}</span></div>`).join('')}
        </div>
      </div>
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

  donut(root.querySelector('#cr-donut'), list.map((h) => ({ label: h.asset, value: h.value })));
  bindHistory(root, hist, ctx);
  root.querySelector('#cr-dust').onchange = (e) => { showDust = e.target.checked; ctx.rerender(); };
}
