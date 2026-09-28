import { state, commit } from '../store.js';
import { stockPositions, fxRate, brokerCashUSD } from '../calc.js';
import { tcbsSession, tcbsLogout, tcbsCash } from '../tcbs.js';
import { donut, PALETTE } from '../charts.js';
import { historyCard, bindHistory } from './history-card.js';
import { locale as getLocale } from '../i18n.js';
import { esc, fmtMoney, fmtNative, fmtQty, fmtPct, fmtDate, pnlClass, uid, timeAgo, todayKey, toast } from '../util.js';

let editing = null; // ticker đang sửa

export function renderStocks(root, ctx) {
  const pos = stockPositions();
  const value = pos.reduce((a, p) => a + p.valueUSD, 0);
  const bCash = brokerCashUSD();
  const cost = pos.reduce((a, p) => a + p.costUSD, 0);
  const unreal = pos.reduce((a, p) => a + p.unrealizedUSD, 0);
  const real = pos.reduce((a, p) => a + p.realizedUSD, 0);
  const day = pos.reduce((a, p) => a + (p.dayChangeUSD || 0), 0);
  const lastQuote = Math.max(0, ...state.stocks.funds.map((f) => f.lastPriceAt || 0));
  const txs = [...state.stocks.txs].sort((a, b) => b.date.localeCompare(a.date));
  const ed = editing && state.stocks.funds.find((f) => f.ticker === editing);

  const hist = {
    id: 'stocks', title: 'Danh mục chứng khoán theo thời gian', rows: ctx.stockSeries(), key: 'value',
    note: 'Tính từ các giao dịch bạn nhập và giá đóng cửa từng ngày (Yahoo Finance; mã nhập tay dùng giá giao dịch gần nhất). Khoảng cách giữa hai đường là lãi/lỗ chưa chốt.',
    empty: 'Thêm giao dịch mua để xem biểu đồ.',
    series: [
      { key: 'value', label: 'Giá trị', color: PALETTE[1], area: 'gradient' },
      { key: 'cost', label: 'Vốn đang nắm', color: PALETTE[4], dash: true },
    ],
  };

  root.innerHTML = `
    <div class="kpis">
      <div class="kpi hero"><span>Giá trị chứng khoán / quỹ</span><b>${fmtMoney(value + bCash)}</b><small>${bCash ? `Gồm ${fmtMoney(bCash)} tiền trong TK CK · ` : ''}Giá cập nhật ${timeAgo(Math.max(lastQuote, state.broker?.updatedAt || 0))}</small></div>
      <div class="kpi"><span>Vốn đang nắm</span><b>${fmtMoney(cost)}</b></div>
      <div class="kpi"><span>Lãi/lỗ chưa chốt</span><b class="${pnlClass(unreal)}">${fmtMoney(unreal, { sign: true })}</b><small>${cost ? fmtPct(unreal / cost) : ''}</small></div>
      <div class="kpi"><span>Đã chốt</span><b class="${pnlClass(real)}">${fmtMoney(real, { sign: true })}</b></div>
      <div class="kpi"><span>Hôm nay</span><b class="${pnlClass(day)}">${fmtMoney(day, { sign: true })}</b><small>USD/VND ${Math.round(fxRate()).toLocaleString('vi-VN')}</small></div>
    </div>

    ${tcbsCard(ctx)}

    ${historyCard(hist)}

    <div class="grid2 wide-right">
      <div class="card"><h3>Phân bổ</h3>${pos.some((p) => p.valueUSD > 0) ? '<div class="chart"><canvas id="st-donut"></canvas></div>' : '<p class="empty">Chưa có vị thế.</p>'}</div>
      <div class="card">
        <div class="card-head"><h3>${ed ? 'Sửa mã ' + esc(ed.ticker) : 'Thêm quỹ / mã chứng khoán'}</h3></div>
        <form id="fund-form" class="form-grid">
          <label>Mã<input name="ticker" required placeholder="VOO, E1VFVN30.VN, FUEVFVND.VN" value="${esc(ed?.ticker || '')}" ${ed ? 'readonly' : ''}></label>
          <label>Tên<input name="name" placeholder="Vanguard S&P 500" value="${esc(ed?.name || '')}"></label>
          <label>Tiền tệ<select name="currency">${['USD', 'VND'].map((c) => `<option ${ed?.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label>Nguồn giá<select name="source">
            <option value="yahoo" ${ed?.source !== 'manual' ? 'selected' : ''}>Yahoo Finance (tự động)</option>
            <option value="manual" ${ed?.source === 'manual' ? 'selected' : ''}>Nhập tay (NAV quỹ mở)</option></select></label>
          <label>Giá nhập tay<input name="manualPrice" type="number" step="any" value="${esc(ed?.manualPrice ?? '')}" placeholder="NAV / giá hiện tại"></label>
          <div class="form-actions">
            <button class="btn primary">${ed ? 'Lưu' : 'Thêm mã'}</button>
            ${ed ? '<button type="button" class="btn" id="fund-cancel">Hủy</button>' : ''}
          </div>
        </form>
        <p class="muted small">Mã Yahoo: cổ phiếu/ETF Mỹ để nguyên (VOO, VTI, QQQ); sàn Việt Nam thêm <code>.VN</code> (vd E1VFVN30.VN).
          Quỹ mở (VESAF, DCDS, VFMVSF…) chọn "Nhập tay" và cập nhật NAV định kỳ.</p>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Danh mục</h3><button class="btn" id="st-quotes">↻ Cập nhật giá</button></div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Mã</th><th class="r">Số CCQ/CP</th><th class="r">Giá vốn TB</th><th class="r">Giá hiện tại</th>
          <th class="r">Giá trị</th><th class="r">Tỷ trọng</th><th class="r">Lãi/lỗ</th><th class="r">%</th><th></th></tr></thead>
        <tbody>${pos.map((p) => `
          <tr>
            <td><b>${esc(p.ticker)}</b>${p.broker ? ' <span class="tag ok">TCBS</span>' : ''}<div class="sub">${esc(p.name || '')}</div></td>
            <td class="r">${fmtQty(p.units)}</td>
            <td class="r">${fmtNative(p.avg, p.currency)}</td>
            <td class="r">${fmtNative(p.price, p.currency)}${p.source === 'manual' ? '<div class="sub">nhập tay</div>' : ''}</td>
            <td class="r"><b>${fmtMoney(p.valueUSD)}</b></td>
            <td class="r">${value ? fmtPct(p.valueUSD / value, { sign: false }) : ''}</td>
            <td class="r ${pnlClass(p.totalUSD)}">${fmtMoney(p.totalUSD, { sign: true })}</td>
            <td class="r ${pnlClass(p.unrealized)}">${p.cost ? fmtPct(p.unrealized / p.cost) : '—'}</td>
            <td class="r nowrap">${p.broker ? '' : `<button class="link" data-edit="${esc(p.ticker)}">Sửa</button>
              <button class="link danger" data-del="${esc(p.ticker)}">Xóa</button>`}</td>
          </tr>`).join('') || '<tr><td colspan="9" class="empty">Chưa có mã nào — thêm ở form phía trên.</td></tr>'}
        </tbody>
      </table></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Giao dịch</h3></div>
      <form id="tx-form" class="inline-form">
        <select name="ticker" required>${state.stocks.funds.map((f) => `<option>${esc(f.ticker)}</option>`).join('')}</select>
        <select name="side"><option value="buy">Mua</option><option value="sell">Bán</option></select>
        <input name="date" type="date" value="${todayKey()}" required>
        <input name="units" type="number" step="any" min="0" placeholder="Số lượng" required>
        <input name="price" type="number" step="any" min="0" placeholder="Giá / đơn vị" required>
        <input name="fee" type="number" step="any" min="0" placeholder="Phí">
        <button class="btn primary" ${state.stocks.funds.length ? '' : 'disabled'}>Thêm</button>
      </form>
      <div class="table-wrap"><table class="tbl mini">
        <thead><tr><th>Ngày</th><th>Mã</th><th>Loại</th><th class="r">Số lượng</th><th class="r">Giá</th><th class="r">Phí</th><th class="r">Thành tiền</th><th></th></tr></thead>
        <tbody>${txs.map((t) => {
          const f = state.stocks.funds.find((x) => x.ticker === t.ticker);
          const cur = f?.currency || 'USD';
          return `<tr><td>${fmtDate(Date.parse(t.date))}</td><td>${esc(t.ticker)}</td>
            <td><span class="tag ${t.units > 0 ? 'ok' : ''}">${t.units > 0 ? 'Mua' : 'Bán'}</span></td>
            <td class="r">${fmtQty(Math.abs(t.units))}</td><td class="r">${fmtNative(Number(t.price), cur)}</td>
            <td class="r">${t.fee ? fmtNative(Number(t.fee), cur) : ''}</td>
            <td class="r">${fmtNative(Math.abs(t.units) * t.price, cur)}</td>
            <td class="r"><button class="link danger" data-del-tx="${t.id}">Xóa</button></td></tr>`;
        }).join('') || '<tr><td colspan="8" class="empty">Chưa có giao dịch.</td></tr>'}</tbody>
      </table></div>
    </div>`;

  if (pos.some((p) => p.valueUSD > 0)) donut(root.querySelector('#st-donut'), pos.map((p) => ({ label: p.ticker, value: p.valueUSD })));

  bindHistory(root, hist, ctx);
  ctx.refreshStockHistory();
  root.querySelector('#st-quotes').onclick = () => { ctx.refreshQuotes(true); ctx.syncTcbs({ quiet: true }); };
  bindTcbs(root, ctx);
  root.querySelector('#fund-cancel')?.addEventListener('click', () => { editing = null; ctx.rerender(); });

  root.querySelector('#fund-form').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const ticker = f.ticker.trim().toUpperCase();
    const data = {
      ticker, name: f.name.trim(), currency: f.currency, source: f.source,
      manualPrice: f.manualPrice === '' ? null : Number(f.manualPrice),
    };
    const ex = state.stocks.funds.find((x) => x.ticker === ticker);
    if (ex && !editing) return toast('Mã đã tồn tại', 'error');
    if (ex) Object.assign(ex, data);
    else state.stocks.funds.push(data);
    editing = null;
    commit({ edit: true });
    ctx.rerender();
    if (data.source === 'yahoo') ctx.refreshQuotes(false);
  };

  root.querySelector('#tx-form').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const units = Number(f.units) * (f.side === 'sell' ? -1 : 1);
    state.stocks.txs.push({ id: uid(), ticker: f.ticker, date: f.date, units, price: Number(f.price), fee: Number(f.fee) || 0 });
    commit({ edit: true });
    ctx.rerender();
  };

  root.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => { editing = b.dataset.edit; ctx.rerender(); }; });
  root.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = () => {
      const t = b.dataset.del;
      if (!confirm(`Xóa ${t} và toàn bộ giao dịch của mã này?`)) return;
      state.stocks.funds = state.stocks.funds.filter((f) => f.ticker !== t);
      state.stocks.txs = state.stocks.txs.filter((x) => x.ticker !== t);
      commit({ edit: true });
      ctx.rerender();
    };
  });
  root.querySelectorAll('[data-del-tx]').forEach((b) => {
    b.onclick = () => {
      state.stocks.txs = state.stocks.txs.filter((x) => x.id !== b.dataset.delTx);
      commit({ edit: true });
      ctx.rerender();
    };
  });
}

function tcbsCard(ctx) {
  const cfg = ctx.serverConfig();
  const t = state.broker?.tcbs;
  // Chỉ hiện khi đã cấu hình TCBS_API_KEY trên Vercel (hoặc đã có dữ liệu TCBS cũ)
  if (!cfg.tcbsConfigured && !t) return '';
  const sess = tcbsSession();
  const busy = ctx.tcbsBusy();
  const custody = state.settings.tcbsCustody || '';
  const holdings = (t?.accounts || []).reduce((a, x) => a + x.holdings.length, 0);
  const until = sess ? new Date(sess.exp).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }) : '';
  return `
    <div class="card" id="tcbs-card">
      <div class="card-head"><h3>TCBS</h3>
        ${sess ? `<span class="tag ok">Đã kết nối đến ${until}</span>` : '<span class="tag">Chưa kết nối</span>'}</div>
      <form id="tcbs-form" class="inline-form">
        <input name="custody" placeholder="Số TK lưu ký (105C…)" value="${esc(custody)}" autocomplete="off" required>
        ${sess ? `<button class="btn primary" ${busy ? 'disabled' : ''}>${busy ? 'Đang tải…' : '↻ Cập nhật'}</button>
          <button type="button" class="btn" id="tcbs-logout">Ngắt kết nối</button>`
          : `<input name="otp" inputmode="numeric" pattern="[0-9]*" maxlength="8" placeholder="Mã OTP (iOTP)" autocomplete="one-time-code" required>
          <button class="btn primary" ${busy ? 'disabled' : ''}>Kết nối</button>`}
      </form>
      ${t ? `<p class="muted small">Cập nhật ${timeAgo(t.syncedAt)} · ${t.accounts.length} tiểu khoản · ${holdings} mã · tiền ${fmtNative(tcbsCash(t), 'VND')}</p>
        ${holdings ? '' : '<p class="muted small">Tài khoản chưa có cổ phiếu — mua xong bấm Cập nhật là số liệu tự hiện.</p>'}` : ''}
      <p class="muted small">Chỉ đọc danh mục và tiền, không đặt lệnh. Mỗi phiên TCBS kéo dài tối đa 8 giờ; hết hạn thì nhập OTP mới
        (Smart OTP trong app TCInvest). Số liệu đã tải vẫn được giữ và đồng bộ lên cloud.</p>
    </div>`;
}

function bindTcbs(root, ctx) {
  const form = root.querySelector('#tcbs-form');
  if (!form) return;
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const code = f.custody.trim().toUpperCase();
    if (code !== state.settings.tcbsCustody) {
      state.settings.tcbsCustody = code;
      commit({ edit: true });
    }
    if (f.otp !== undefined) ctx.tcbsLogin(f.otp);
    else ctx.syncTcbs();
  };
  root.querySelector('#tcbs-logout')?.addEventListener('click', () => {
    tcbsLogout();
    ctx.rerender();
  });
}
