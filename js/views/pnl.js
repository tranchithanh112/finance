import { state } from '../store.js';
import { line, PALETTE } from '../charts.js';
import { esc, fmtMoney, fmtQty, fmtPrice, fmtPct, fmtDate, pnlClass, timeAgo } from '../util.js';

const ui = { filter: 'all', q: '', open: null, sort: 'total' };

const KIND = {
  buy: 'Mua', sell: 'Bán', fee: 'Phí', deposit: 'Nạp', withdraw: 'Rút', dust: 'Dust→BNB', convert: 'Convert',
  autoinvest: 'DCA (Auto-Invest)', reward: 'Thưởng / airdrop / lãi Earn', stake: 'Stake', unstake: 'Unstake', fiat: 'Mua bằng fiat',
};

export function renderPnl(root, ctx) {
  const pnl = ctx.pnl();
  const h = state.history;
  const syncing = ctx.syncState();
  const tradeCount = Object.values(h.trades).reduce((a, e) => a + e.rows.length, 0);

  const controls = `
    <div class="card">
      <div class="card-head">
        <h3>Đồng bộ lịch sử Binance</h3>
        <small class="muted">Lần cuối: ${timeAgo(h.updatedAt)} · ${tradeCount.toLocaleString()} lệnh · ${Object.keys(h.trades).length} cặp ·
          ${h.deposits.length} nạp · ${h.withdrawals.length} rút · ${countKind(h, 'autoinvest')} DCA · ${countKind(h, 'convert')} convert · ${countKind(h, 'stake') + countKind(h, 'unstake')} staking · ${(h.rewards || []).length} thưởng/airdrop</small>
      </div>
      <p class="muted small">"Đồng bộ nhanh" quét các coin bạn đang giữ / từng nạp / rút / convert + các cặp đã có lệnh.
        "Quét toàn bộ" thử mọi cặp có quote ${esc(state.settings.scanQuotes.join(', '))} để tìm cả coin đã mua rồi bán hết (chậm, vài phút — chỉ cần chạy lần đầu).</p>
      <div class="row gap">
        <button class="btn primary" id="pnl-sync" ${syncing.running ? 'disabled' : ''}>Đồng bộ nhanh</button>
        <button class="btn" id="pnl-full" ${syncing.running ? 'disabled' : ''}>Quét toàn bộ</button>
        ${syncing.running ? '<button class="btn danger" id="pnl-cancel">Hủy</button>' : ''}
      </div>
      ${syncing.running || syncing.msg ? `
        <div class="progress"><i style="width:${syncing.pct || 0}%"></i></div>
        <p class="small muted" id="pnl-msg">${esc(syncing.msg || '')}</p>` : ''}
    </div>`;

  if (!pnl || !pnl.rows.length) {
    root.innerHTML = controls + '<div class="card center"><p class="empty">Chưa có dữ liệu lịch sử. Bấm "Đồng bộ nhanh" hoặc "Quét toàn bộ".</p></div>';
    bind(root, ctx);
    return;
  }

  const T = pnl.totals;
  let rows = pnl.rows.filter((r) => r.hasBasis || r.value > 0);
  if (ui.filter === 'holding') rows = rows.filter((r) => r.status === 'holding');
  if (ui.filter === 'closed') rows = rows.filter((r) => r.status === 'closed');
  if (ui.q) rows = rows.filter((r) => r.asset.includes(ui.q.toUpperCase()));
  const sorters = {
    total: (a, b) => (b.total ?? -Infinity) - (a.total ?? -Infinity),
    realized: (a, b) => b.realized - a.realized,
    value: (a, b) => b.value - a.value,
    invested: (a, b) => b.invested - a.invested,
    roi: (a, b) => (b.roi ?? -Infinity) - (a.roi ?? -Infinity),
    last: (a, b) => (b.last || 0) - (a.last || 0),
  };
  rows.sort(sorters[ui.sort]);
  const winners = pnl.rows.filter((r) => (r.total || 0) > 0).length;
  const losers = pnl.rows.filter((r) => (r.total || 0) < 0).length;

  const th = (k, label, cls = 'r') => `<th class="${cls} sortable ${ui.sort === k ? 'active' : ''}" data-sort="${k}">${label}</th>`;

  root.innerHTML = controls + `
    <div class="kpis">
      <div class="kpi hero"><span>Tổng PnL từ trước tới nay</span><b class="${pnlClass(T.total)}">${fmtMoney(T.total, { sign: true })}</b>
        <small>${T.invested ? fmtPct(T.total / T.invested) + ' trên tổng vốn đã mua' : ''}</small></div>
      <div class="kpi"><span>Đã chốt (realized)</span><b class="${pnlClass(T.realized)}">${fmtMoney(T.realized, { sign: true })}</b></div>
      <div class="kpi"><span>Chưa chốt (unrealized)</span><b class="${pnlClass(T.unrealized)}">${fmtMoney(T.unrealized, { sign: true })}</b></div>
      <div class="kpi"><span>Tổng tiền đã mua</span><b>${fmtMoney(T.invested)}</b><small>Phí (coin non-stable): ${fmtMoney(T.fees)}</small></div>
      <div class="kpi"><span>Coin lãi / lỗ</span><b><span class="pos">${winners}</span> / <span class="neg">${losers}</span></b></div>
    </div>

    ${missingSummary(pnl.rows)}
    ${pnl.missing.length ? `<div class="alert">Không tìm được giá lịch sử cho: <b>${esc(pnl.missing.join(', '))}</b> — giao dịch liên quan được định giá 0, PnL các coin này có thể sai.</div>` : ''}

    <div class="card">
      <h3>Lãi/lỗ đã chốt cộng dồn</h3>
      <div class="chart tall"><canvas id="pnl-line"></canvas></div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="seg">
          ${[['all', 'Tất cả'], ['holding', 'Đang giữ'], ['closed', 'Đã thoát']].map(([k, l]) =>
            `<button data-filter="${k}" class="${ui.filter === k ? 'on' : ''}">${l}</button>`).join('')}
        </div>
        <input class="search" id="pnl-q" placeholder="Tìm coin…" value="${esc(ui.q)}">
      </div>
      <div class="table-wrap"><table class="tbl clickable">
        <thead><tr>
          <th>Coin</th><th>Trạng thái</th>${th('invested', 'Đã mua')}<th class="r hide-sm">Giá vốn TB</th><th class="r hide-sm">Giá hiện tại</th>
          ${th('value', 'Đang giữ')}${th('realized', 'Đã chốt')}<th class="r">Chưa chốt</th>${th('total', 'Tổng PnL')}${th('roi', 'ROI')}${th('last', 'GD cuối', 'r hide-sm')}
        </tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr data-asset="${esc(r.asset)}" class="${ui.open === r.asset ? 'open' : ''}">
              <td><b>${esc(r.asset)}</b>${isMissing(r) ? ` <span class="tag warn" title="${fmtQty(r.untrackedQty)} ${esc(r.asset)} (≈${fmtMoney(r.untrackedUsd)}) bị bán/rút nhưng không tìm thấy nguồn mua/nạp — bấm để xem chi tiết">thiếu dữ liệu</span>` : ''}</td>
              <td><span class="tag ${r.status === 'holding' ? 'ok' : ''}">${r.status === 'holding' ? 'Đang giữ' : 'Đã thoát'}</span></td>
              <td class="r">${fmtMoney(r.invested)}</td>
              <td class="r hide-sm">${r.avg ? fmtPrice(r.avg) : '—'}</td>
              <td class="r hide-sm">${fmtPrice(r.price)}</td>
              <td class="r">${r.value ? fmtMoney(r.value) : '—'}<div class="sub">${r.heldQty ? fmtQty(r.heldQty) : ''}</div></td>
              <td class="r ${pnlClass(r.realized)}">${fmtMoney(r.realized, { sign: true })}</td>
              <td class="r ${pnlClass(r.unrealized)}">${r.unrealized != null && r.value ? fmtMoney(r.unrealized, { sign: true }) : '—'}</td>
              <td class="r ${pnlClass(r.total)}"><b>${r.total != null ? fmtMoney(r.total, { sign: true }) : '—'}</b></td>
              <td class="r ${pnlClass(r.roi)}">${fmtPct(r.roi)}</td>
              <td class="r hide-sm muted">${fmtDate(r.last)}</td>
            </tr>
            ${ui.open === r.asset ? `<tr class="detail"><td colspan="11">${detail(r)}</td></tr>` : ''}`).join('')}
        </tbody>
      </table></div>
      <p class="muted small">Phương pháp: giá vốn bình quân gia quyền, quy đổi USD theo giá ngày giao dịch. Phí trả bằng BNB tính vào giá vốn coin giao dịch.
        Nạp coin được tính giá vốn theo giá thị trường lúc nạp; rút coin không phát sinh lãi/lỗ. Coin nhận từ Earn/airdrop có giá vốn 0.</p>
    </div>`;

  const tl = pnl.timeline;
  if (tl.length) {
    // gộp theo ngày để biểu đồ nhẹ
    const byDay = new Map();
    for (const [t, v] of tl) byDay.set(new Date(t).toISOString().slice(0, 10), v);
    line(root.querySelector('#pnl-line'), [...byDay.keys()], [
      { label: 'Đã chốt cộng dồn', data: [...byDay.values()], fill: true, color: PALETTE[0] },
    ]);
  }
  bind(root, ctx);
}

const isMissing = (r) => r.untrackedUsd >= Math.max(1, Number(state.settings.dustUsd) || 0);

const countKind = (h, k) => h.converts.filter((c) => (c[6] || 'convert') === k).length;

function missingSummary(rows) {
  const miss = rows.filter(isMissing);
  if (!miss.length) return '';
  const usd = miss.reduce((a, r) => a + r.untrackedUsd, 0);
  return `<div class="alert"><b>${miss.length} coin</b> có lượng bán/rút không rõ nguồn (tổng ≈ ${fmtMoney(usd)}):
    ${miss.sort((a, b) => b.untrackedUsd - a.untrackedUsd).slice(0, 8).map((r) => `${esc(r.asset)} ${fmtMoney(r.untrackedUsd)}`).join(' · ')}.
    Bấm vào từng coin để xem chi tiết. Nếu vừa cập nhật app, hãy bấm "Đồng bộ nhanh" để tải thêm lịch sử airdrop / lãi Earn / Binance Pay.</div>`;
}

function detail(r) {
  const ev = [...r.events].reverse().slice(0, 300);
  return `
    <div class="detail-box">
      <div class="kpis small">
        <div class="kpi"><span>Đang giữ</span><b>${fmtQty(r.heldQty)}</b><small>Sổ sách: ${fmtQty(r.ledgerQty)}</small></div>
        <div class="kpi"><span>Giá vốn còn lại</span><b>${fmtMoney(r.costBasis)}</b></div>
        <div class="kpi"><span>Tiền đã mua / bán</span><b>${fmtMoney(r.invested)} / ${fmtMoney(r.proceeds)}</b></div>
        ${r.rewardQty ? `<div class="kpi"><span>Nhận miễn phí</span><b>${fmtQty(r.rewardQty)}</b><small>airdrop / lãi Earn</small></div>` : ''}
        <div class="kpi"><span>Số lệnh</span><b>${r.trades}</b><small>${fmtDate(r.first)} → ${fmtDate(r.last)}</small></div>
      </div>
      ${isMissing(r) ? `<div class="alert">Có <b>${fmtQty(r.untrackedQty)} ${esc(r.asset)}</b> (≈${fmtMoney(r.untrackedUsd)}) bị
        ${Object.entries(r.untrackedBy).map(([k, q]) => `${(KIND[k] || k).toLowerCase()} ${fmtQty(q)}`).join(', ')}
        nhưng app không thấy nguồn vào. Phần này được tính lãi/lỗ = 0. Nguyên nhân thường gặp: mua qua cặp đã bị Binance xoá khỏi sàn,
        nhận từ sàn/ví khác trước ${esc(state.settings.historyStart)}, quà/red packet, hoặc giao dịch trên sub-account / Margin.</div>` : ''}
      <div class="table-wrap"><table class="tbl mini">
        <thead><tr><th>Thời gian</th><th>Loại</th><th>Cặp</th><th class="r">Số lượng</th><th class="r">Giá</th>
          <th class="r">Giá trị (USD)</th><th class="r">Lãi/lỗ chốt</th><th class="r">Giá vốn TB sau</th><th class="r">Số dư sau</th></tr></thead>
        <tbody>${ev.map((e) => `
          <tr><td>${fmtDate(e.t, true)}</td><td>${KIND[e.kind] || e.kind}</td>
          <td class="muted">${esc(e.ref?.symbol || e.ref?.other || '')}</td>
          <td class="r ${e.qty > 0 ? 'pos' : 'neg'}">${e.qty > 0 ? '+' : ''}${fmtQty(e.qty)}</td>
          <td class="r">${e.value != null && e.qty ? fmtPrice(Math.abs(e.value / e.qty)) : '—'}</td>
          <td class="r">${e.value != null ? fmtMoney(e.value) : '—'}</td>
          <td class="r ${pnlClass(e.realized)}">${e.realized ? fmtMoney(e.realized, { sign: true }) : ''}</td>
          <td class="r">${fmtPrice(e.avgAfter)}</td><td class="r">${fmtQty(e.qtyAfter)}</td></tr>`).join('')}
        </tbody>
      </table></div>
      ${r.events.length > 300 ? `<p class="muted small">Hiển thị 300 / ${r.events.length} sự kiện gần nhất.</p>` : ''}
    </div>`;
}

function bind(root, ctx) {
  const on = (sel, fn) => { const el = root.querySelector(sel); if (el) el.onclick = fn; };
  on('#pnl-sync', () => ctx.syncHistory(false));
  on('#pnl-full', () => ctx.syncHistory(true));
  on('#pnl-cancel', () => ctx.cancelSync());
  root.querySelectorAll('[data-filter]').forEach((b) => { b.onclick = () => { ui.filter = b.dataset.filter; ctx.rerender(); }; });
  root.querySelectorAll('[data-sort]').forEach((b) => { b.onclick = () => { ui.sort = b.dataset.sort; ctx.rerender(); }; });
  root.querySelectorAll('tr[data-asset]').forEach((tr) => {
    tr.onclick = () => { ui.open = ui.open === tr.dataset.asset ? null : tr.dataset.asset; ctx.rerender(); };
  });
  const q = root.querySelector('#pnl-q');
  if (q) {
    q.oninput = () => {
      ui.q = q.value;
      ctx.rerender();
      const el = document.getElementById('pnl-q');
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    };
  }
}

/** Cập nhật tiến trình mà không render lại cả trang. */
export function updateProgress(root, { pct, msg }) {
  const bar = root.querySelector('.progress i');
  const m = root.querySelector('#pnl-msg');
  if (bar) bar.style.width = `${pct || 0}%`;
  if (m) m.textContent = msg || '';
}
