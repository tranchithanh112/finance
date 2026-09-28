import { state } from '../store.js';
import { TYPES } from '../futures.js';
import { line, PALETTE } from '../charts.js';
import { esc, fmtMoney, fmtQty, fmtPrice, fmtDate, pnlClass, timeAgo } from '../util.js';

const ui = { sort: 'net', q: '' };

export function renderFutures(root, ctx) {
  const f = state.futures;
  const r = ctx.futuresPnl();
  const busy = ctx.futuresBusy();
  const pos = f.account?.positions || [];

  const controls = `
    <div class="card">
      <div class="card-head">
        <h3>Lịch sử Futures</h3>
        <small class="muted">Lần cuối: ${timeAgo(f.updatedAt)} · ${f.income.length.toLocaleString()} bản ghi
          ${r?.first ? ' · từ ' + fmtDate(r.first) : ''}</small>
      </div>
      <p class="muted small">API Binance chỉ trả lịch sử futures gần đây (~3 tháng). Để có lỗ/lãi từ trước tới nay, tải file CSV từ Binance rồi bấm "Nhập CSV":
        <b>Binance → Orders → Transaction History → Export</b> (hoặc <b>Futures → Transaction History → Export</b>), chọn định dạng CSV, mỗi file tối đa 1 năm — nhập lần lượt từng năm.
        Bản ghi trùng giữa CSV và API tự được bỏ qua. File lịch sử khớp lệnh (Trade History) cũng nhập được — có lãi/lỗ và phí, nhưng không có funding.</p>
      <div class="row gap wrap">
        <button class="btn primary" id="fu-sync" ${busy ? 'disabled' : ''}>Đồng bộ qua API</button>
        <label class="btn ${busy ? 'disabled' : ''}">Nhập CSV<input type="file" id="fu-csv" accept=".csv,text/csv" multiple hidden></label>
        ${f.income.length ? '<button class="btn danger" id="fu-clear">Xóa dữ liệu futures</button>' : ''}
      </div>
      ${busy ? `<p class="small muted">${esc(busy)}</p>` : ''}
    </div>`;

  if (!r || !f.income.length) {
    root.innerHTML = controls + (pos.length ? positionsCard(pos) : '') +
      '<div class="card center"><p class="empty">Chưa có dữ liệu futures. Bấm "Đồng bộ qua API" và/hoặc "Nhập CSV".</p></div>';
    bind(root, ctx);
    return;
  }

  let syms = r.symbols;
  if (ui.q) syms = syms.filter((s) => s.symbol.includes(ui.q.toUpperCase()));
  const sorters = {
    net: (a, b) => a.net - b.net,
    REALIZED_PNL: (a, b) => a.REALIZED_PNL - b.REALIZED_PNL,
    FUNDING_FEE: (a, b) => a.FUNDING_FEE - b.FUNDING_FEE,
    COMMISSION: (a, b) => a.COMMISSION - b.COMMISSION,
    count: (a, b) => b.count - a.count,
    last: (a, b) => b.last - a.last,
  };
  syms = [...syms].sort(sorters[ui.sort]);
  const th = (k, label, cls = 'r') => `<th class="${cls} sortable ${ui.sort === k ? 'active' : ''}" data-sort="${k}">${label}</th>`;
  const t = r.byType;
  const total = r.net + r.unrealized;

  root.innerHTML = controls + `
    <div class="kpis">
      <div class="kpi hero"><span>Tổng lãi/lỗ futures (đã chốt, sau phí)</span><b class="${pnlClass(r.net)}">${fmtMoney(r.net, { sign: true })}</b>
        <small>${r.first ? 'Từ ' + fmtDate(r.first) : ''}${r.unrealized ? ` · tính cả vị thế mở: ${fmtMoney(total, { sign: true })}` : ''}</small></div>
      <div class="kpi"><span>${TYPES.REALIZED_PNL}</span><b class="${pnlClass(t.REALIZED_PNL)}">${fmtMoney(t.REALIZED_PNL, { sign: true })}</b></div>
      <div class="kpi"><span>Phí giao dịch</span><b class="${pnlClass(t.COMMISSION)}">${fmtMoney(t.COMMISSION, { sign: true })}</b>
        ${t.REBATE ? `<small>Hoàn phí ${fmtMoney(t.REBATE, { sign: true })}</small>` : ''}</div>
      <div class="kpi"><span>Funding</span><b class="${pnlClass(t.FUNDING_FEE)}">${fmtMoney(t.FUNDING_FEE, { sign: true })}</b></div>
      <div class="kpi"><span>Thanh lý</span><b class="${pnlClass(t.LIQUIDATION)}">${fmtMoney(t.LIQUIDATION, { sign: true })}</b></div>
      <div class="kpi"><span>Vị thế đang mở</span><b class="${pnlClass(r.unrealized)}">${pos.length ? fmtMoney(r.unrealized, { sign: true }) : '—'}</b><small>${pos.length} vị thế</small></div>
    </div>

    ${!t.FUNDING_FEE ? `<div class="alert">Chưa có phí funding (và có thể thiếu phí thanh lý). File lịch sử khớp lệnh (Trade History) không chứa các khoản này —
      hãy nhập thêm file Lịch sử giao dịch ví (Transaction History) của cùng các năm; phần trùng được tự bỏ qua.</div>` : ''}

    ${r.missing.length ? `<div class="alert">Không có giá lịch sử cho: <b>${esc(r.missing.join(', '))}</b> (được tính 0).</div>` : ''}

    <div class="grid2">
      <div class="card"><h3>Lãi/lỗ cộng dồn</h3><div class="chart"><canvas id="fu-line"></canvas></div></div>
      <div class="card"><h3>Theo tháng</h3><div class="chart"><canvas id="fu-month"></canvas></div></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Theo năm</h3><small class="muted">Đối chiếu với báo cáo PnL của Binance</small></div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Năm</th><th class="r">Đóng lệnh</th><th class="r">Phí</th><th class="r">Funding</th><th class="r">Thanh lý</th><th class="r">Tổng</th></tr></thead>
        <tbody>${r.yearly.map((y) => `<tr><td><b>${y.year}</b></td>
          <td class="r ${pnlClass(y.REALIZED_PNL)}">${fmtMoney(y.REALIZED_PNL, { sign: true })}</td>
          <td class="r ${pnlClass(y.COMMISSION + y.REBATE)}">${fmtMoney(y.COMMISSION + y.REBATE, { sign: true })}</td>
          <td class="r ${pnlClass(y.FUNDING_FEE)}">${fmtMoney(y.FUNDING_FEE, { sign: true })}</td>
          <td class="r ${pnlClass(y.LIQUIDATION)}">${fmtMoney(y.LIQUIDATION, { sign: true })}</td>
          <td class="r ${pnlClass(y.net)}"><b>${fmtMoney(y.net, { sign: true })}</b></td></tr>`).join('')}</tbody>
      </table></div>
    </div>

    ${pos.length ? positionsCard(pos) : ''}

    <div class="card">
      <div class="card-head"><h3>Theo cặp giao dịch</h3>
        <small class="muted"><span class="pos">${r.wins} lãi</span> · <span class="neg">${r.losses} lỗ</span></small>
        <input class="search" id="fu-q" placeholder="Tìm cặp…" value="${esc(ui.q)}"></div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Cặp</th>${th('REALIZED_PNL', 'Đóng lệnh')}${th('COMMISSION', 'Phí')}${th('FUNDING_FEE', 'Funding')}
          <th class="r hide-sm">Thanh lý</th>${th('net', 'Tổng')}${th('count', 'Số lần chốt', 'r hide-sm')}${th('last', 'Lần cuối', 'r hide-sm')}</tr></thead>
        <tbody>${syms.map((s) => `
          <tr><td><b>${s.symbol === '?' ? '<span class="muted">Không rõ cặp (CSV)</span>' : esc(s.symbol)}</b></td>
            <td class="r ${pnlClass(s.REALIZED_PNL)}">${fmtMoney(s.REALIZED_PNL, { sign: true })}</td>
            <td class="r ${pnlClass(s.COMMISSION + s.REBATE)}">${fmtMoney(s.COMMISSION + s.REBATE, { sign: true })}</td>
            <td class="r ${pnlClass(s.FUNDING_FEE)}">${fmtMoney(s.FUNDING_FEE, { sign: true })}</td>
            <td class="r hide-sm ${pnlClass(s.LIQUIDATION)}">${s.LIQUIDATION ? fmtMoney(s.LIQUIDATION, { sign: true }) : '—'}</td>
            <td class="r ${pnlClass(s.net)}"><b>${fmtMoney(s.net, { sign: true })}</b></td>
            <td class="r hide-sm">${s.count}</td>
            <td class="r hide-sm muted">${fmtDate(s.last)}</td></tr>`).join('')}
        </tbody>
      </table></div>
      <p class="muted small">Tổng = lãi/lỗ đóng lệnh + phí + funding + thanh lý + hoàn phí, quy đổi USD theo giá ngày phát sinh.
        Gồm cả USDⓈ-M và COIN-M. Không tính tiền chuyển vào/ra ví futures.</p>
    </div>`;

  line(root.querySelector('#fu-line'), ...(() => {
    const byDay = new Map();
    for (const [ts, v] of r.timeline) byDay.set(new Date(ts).toISOString().slice(0, 10), v);
    return [[...byDay.keys()], [{ label: 'Cộng dồn', data: [...byDay.values()], fill: true, color: r.net >= 0 ? PALETTE[2] : PALETTE[3] }]];
  })());
  monthBars(root.querySelector('#fu-month'), r.monthly);
  bind(root, ctx);
}

function positionsCard(pos) {
  return `<div class="card"><h3>Vị thế đang mở</h3><div class="table-wrap"><table class="tbl">
    <thead><tr><th>Cặp</th><th>Chiều</th><th class="r">Khối lượng</th><th class="r">Giá vào</th><th class="r">Giá mark</th>
      <th class="r hide-sm">Thanh lý</th><th class="r">Lãi/lỗ</th></tr></thead>
    <tbody>${pos.map((p) => `<tr><td><b>${esc(p.symbol)}</b>${p.leverage ? ` <span class="tag">${p.leverage}x</span>` : ''}</td>
      <td><span class="tag ${p.side === 'LONG' ? 'ok' : 'warn'}">${p.side}</span></td>
      <td class="r">${fmtQty(Math.abs(p.amt))}</td><td class="r">${fmtPrice(p.entry)}</td><td class="r">${fmtPrice(p.mark)}</td>
      <td class="r hide-sm">${p.liq ? fmtPrice(p.liq) : '—'}</td>
      <td class="r ${pnlClass(p.unrealized)}">${fmtQty(p.unrealized)} ${esc(p.marginAsset)}</td></tr>`).join('')}</tbody>
  </table></div></div>`;
}

function monthBars(canvas, monthly) {
  if (!window.Chart || !canvas) return;
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  canvas._chart?.destroy();
  canvas._chart = new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels: monthly.map((m) => m[0]),
      datasets: [{ data: monthly.map((m) => m[1]), backgroundColor: monthly.map((m) => (m[1] >= 0 ? css('--pos') : css('--neg'))), borderRadius: 3 }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + fmtMoney(c.raw, { sign: true }) } } },
      scales: {
        x: { ticks: { color: css('--muted'), maxTicksLimit: 12 }, grid: { display: false } },
        y: { ticks: { color: css('--muted'), callback: (v) => fmtMoney(v, { compact: true }) }, grid: { color: css('--grid') } },
      },
    },
  });
}

function bind(root, ctx) {
  const sync = root.querySelector('#fu-sync');
  if (sync) sync.onclick = () => ctx.syncFutures();
  const file = root.querySelector('#fu-csv');
  if (file) file.onchange = (e) => ctx.importFuturesCsv([...e.target.files]);
  const clear = root.querySelector('#fu-clear');
  if (clear) clear.onclick = () => ctx.clearFutures();
  root.querySelectorAll('[data-sort]').forEach((b) => { b.onclick = () => { ui.sort = b.dataset.sort; ctx.rerender(); }; });
  const q = root.querySelector('#fu-q');
  if (q) {
    q.oninput = () => {
      ui.q = q.value;
      ctx.rerender();
      const el = document.getElementById('fu-q');
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    };
  }
}
