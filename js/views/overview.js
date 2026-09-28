import { state, commit } from '../store.js';
import { totals, stockPositions, cryptoHoldings, toUSD, fxRate, cashBalance } from '../calc.js';
import { donut, line, bars, PALETTE } from '../charts.js';
import {
  monthSummary, recentAverage, healthScore, debtMonthlyVnd, parseAmount, setAnchor, monthKey, localToday, shiftMonth, SPEND_JARS,
} from '../budget.js';
import { esc, fmtMoney, fmtPct, pnlClass, uid, fmtNative, timeAgo, toast, fmtDate } from '../util.js';

const vnd = (v, o) => fmtMoney(toUSD(v, 'VND'), o);

/** Các chỉ số sức khỏe tài chính (dùng chung cho tab Tổng quan). */
export function financialHealth() {
  const t = totals();
  const b = state.budget;
  const rate = fxRate();
  const cur = monthSummary(b, monthKey(localToday()));
  const avg = recentAverage(b);
  const income = avg?.income || cur.income || 0;
  const spend = avg?.spend || cur.spend || 0;
  const savingsRate = avg?.savingsRate ?? cur.savingsRate;
  const liquidUsd = t.cash + t.stable;
  const emergencyMonths = spend > 0 ? (liquidUsd * rate) / spend : null;
  const debtMonthly = debtMonthlyVnd(b, rate);
  const debtToIncome = income > 0 ? debtMonthly / income : null;
  const riskShare = t.assets > 0 ? (t.crypto - t.stable) / t.assets : null;
  const jarsOver = cur.income > 0 ? cur.jars.filter((j) => SPEND_JARS.has(j.id) && j.ratio > 1).length : null;
  const health = healthScore({ savingsRate, emergencyMonths, emergencyTarget: b.emergencyTarget, debtToIncome, riskShare, jarsOver });
  return { t, cur, avg, savingsRate, liquidUsd, emergencyMonths, debtMonthly, debtToIncome, riskShare, health };
}

export function renderOverview(root, ctx) {
  const H = financialHealth();
  const { t, cur, health } = H;
  const b = state.budget;
  const pnl = ctx.pnl();
  const fut = ctx.futuresPnl();
  const stocks = stockPositions();
  const stockPnl = stocks.reduce((a, p) => a + p.totalUSD, 0);
  const investPnl = (pnl?.totals.total || 0) + (fut ? fut.net + fut.unrealized : 0) + stockPnl;
  const scoreColor = health.score == null ? 'var(--muted)' : health.score >= 80 ? 'var(--pos)' : health.score >= 60 ? '#17c3a5' : health.score >= 40 ? 'var(--warn)' : 'var(--neg)';
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(monthKey(localToday()), i - 5));
  const trend = months.map((m) => monthSummary(b, m));
  const hasBudget = b.txs.length > 0;

  root.innerHTML = `
    <div class="kpis">
      <div class="kpi hero"><span>Tài sản ròng</span><b>${fmtMoney(t.total)}</b>
        <small>Tài sản ${fmtMoney(t.assets, { compact: true })}${t.debt ? ' − nợ ' + fmtMoney(t.debt, { compact: true }) : ''} · cập nhật ${timeAgo(state.crypto.updatedAt)}</small></div>
      <div class="kpi"><span>Dòng tiền tháng này</span><b class="${pnlClass(cur.income - cur.spend)}">${hasBudget ? vnd(cur.income - cur.spend, { sign: true }) : '—'}</b>
        <small>${hasBudget ? `Thu ${vnd(cur.income, { compact: true })} · tiêu ${vnd(cur.spend, { compact: true })}` : 'Nhập thu chi ở tab Thu chi'}</small></div>
      <div class="kpi"><span>Tỷ lệ tiết kiệm</span><b>${H.savingsRate == null ? '—' : fmtPct(H.savingsRate, { sign: false })}</b>
        <small>${H.avg ? `TB ${H.avg.months} tháng gần nhất` : 'Tháng này'}</small></div>
      <div class="kpi"><span>Quỹ dự phòng</span>${H.emergencyMonths == null
        ? `<b>${fmtMoney(H.liquidUsd)}</b><small>Tiền mặt + stablecoin · nhập chi tiêu ở tab Thu chi để tính số tháng</small>`
        : `<b>${H.emergencyMonths.toFixed(1)} tháng</b><small>Tiền mặt + stablecoin ${fmtMoney(H.liquidUsd, { compact: true })}</small>`}</div>
      <div class="kpi"><span>Lãi/lỗ đầu tư</span><b class="${pnlClass(investPnl)}">${pnl || fut || stocks.length ? fmtMoney(investPnl, { sign: true }) : '—'}</b>
        <small>Spot ${pnl ? fmtMoney(pnl.totals.total, { sign: true, compact: true }) : '—'} · Futures ${fut ? fmtMoney(fut.net + fut.unrealized, { sign: true, compact: true }) : '—'} · CK ${stocks.length ? fmtMoney(stockPnl, { sign: true, compact: true }) : '—'}</small></div>
    </div>

    <div class="card health">
      <div class="score" style="--p:${health.score ?? 0};--c:${scoreColor}">
        <div class="score-ring"><b>${health.score ?? '—'}</b><small>/100</small></div>
        <div><h3>Sức khỏe tài chính: <span style="color:${scoreColor}">${health.label}</span></h3>
          <p class="muted small">Tổng hợp từ tỷ lệ tiết kiệm, quỹ dự phòng, nợ, mức rủi ro danh mục và việc giữ đúng ngân sách hũ.</p></div>
      </div>
      <div class="health-parts">
        ${health.parts.map((p) => `
          <div class="bar-row wide"><span class="bar-label">${p.label}</span>
            <div class="bar"><i style="width:${Math.round(p.score * 100)}%;background:${p.score >= 0.8 ? 'var(--pos)' : p.score >= 0.5 ? 'var(--warn)' : 'var(--neg)'}"></i></div>
            <span class="bar-val">${Math.round(p.score * p.weight)}/${p.weight}</span></div>`).join('') || '<p class="empty">Nhập thu chi và làm mới số dư để tính điểm.</p>'}
      </div>
      ${health.tips.length ? `<ul class="tips">${health.tips.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${!hasBudget ? '<p class="muted small">Chưa có dữ liệu thu chi — vào tab <b>Thu chi</b> để thêm lương (định kỳ) và các khoản chi.</p>' : ''}
    </div>

    <div class="grid2">
      <div class="card"><h3>Phân bổ tài sản</h3><div class="chart"><canvas id="ov-class"></canvas></div></div>
      <div class="card"><h3>Thu chi 6 tháng</h3>${hasBudget ? '<div class="chart"><canvas id="ov-flow"></canvas></div>' : '<p class="empty">Chưa có dữ liệu thu chi.</p>'}</div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Tài sản ròng theo thời gian</h3><small class="muted">Mỗi ngày lưu 1 điểm khi bạn mở app</small></div>
      ${state.snapshots.length > 1 ? '<div class="chart tall"><canvas id="ov-hist"></canvas></div>' : '<p class="empty">Cần ít nhất 2 ngày dữ liệu để vẽ biểu đồ.</p>'}
    </div>

    <div class="card">
      <div class="card-head"><h3>Top tài sản</h3></div>
      <div class="chart"><canvas id="ov-top"></canvas></div>
    </div>

    <div class="grid2">
      <div class="card">
        <div class="card-head"><h3>Tiền mặt & tài sản khác</h3><small class="muted">Tự cộng/trừ theo thu chi · tính vào quỹ dự phòng</small></div>
        <table class="tbl">
          <tbody>
            ${state.cash.map((c) => {
              const B = cashBalance(c);
              return `
              <tr><td>${esc(c.name)}<div class="sub">${c.anchorAt ? `Chốt ${fmtNative(Number(c.amount), c.currency)} lúc ${fmtDate(c.anchorAt, true)}` : ''}
                ${B.count ? ` · ${B.delta >= 0 ? '+' : '−'}${fmtNative(Math.abs(B.delta), c.currency)} từ ${B.count} khoản thu chi` : ''}</div></td>
              <td class="r"><b>${fmtNative(B.balance, c.currency)}</b></td>
              <td class="r nowrap"><button class="link" data-edit-cash="${c.id}">Sửa số dư</button>
                <button class="link danger" data-del-cash="${c.id}">Xóa</button></td></tr>`;
            }).join('') ||
              '<tr><td colspan="3" class="empty">Chưa có — tiền gửi ngân hàng, tiền mặt, vàng…</td></tr>'}
          </tbody>
        </table>
        <form class="inline-form" id="cash-form">
          <input name="name" placeholder="Tên (vd: Tiết kiệm VCB)" required>
          <input name="amount" inputmode="decimal" placeholder="Số dư (vd 52tr)" required>
          <select name="currency"><option>VND</option><option>USD</option></select>
          <button class="btn">Thêm</button>
        </form>
      </div>

      <div class="card">
        <div class="card-head"><h3>Nợ</h3><small class="muted">${b.debts.length ? 'Trả hằng tháng ' + vnd(H.debtMonthly) : 'Không có nợ 👍'}</small></div>
        <table class="tbl">
          <tbody>
            ${b.debts.map((d) => `
              <tr><td>${esc(d.name)}${d.rate ? ` <span class="muted small">${d.rate}%/năm</span>` : ''}</td>
              <td class="r neg">${fmtNative(Number(d.balance), d.currency)}</td>
              <td class="r muted small">${d.monthly ? fmtNative(Number(d.monthly), d.currency) + '/th' : ''}</td>
              <td class="r nowrap"><button class="link" data-edit-debt="${d.id}">Sửa dư nợ</button>
                <button class="link danger" data-del-debt="${d.id}">Xóa</button></td></tr>`).join('') ||
              '<tr><td colspan="4" class="empty">Thẻ tín dụng, vay mua nhà/xe, vay người quen…</td></tr>'}
          </tbody>
        </table>
        <form class="inline-form" id="debt-form">
          <input name="name" placeholder="Tên khoản nợ" required>
          <input name="balance" type="number" step="any" placeholder="Dư nợ" required>
          <input name="monthly" type="number" step="any" placeholder="Trả / tháng">
          <input name="rate" type="number" step="any" placeholder="Lãi %/năm" style="max-width:110px">
          <select name="currency"><option>VND</option><option>USD</option></select>
          <button class="btn">Thêm</button>
        </form>
      </div>
    </div>`;

  donut(root.querySelector('#ov-class'), [
    { label: 'Crypto', value: t.crypto - t.stable, color: PALETTE[0] },
    { label: 'Stablecoin', value: t.stable, color: PALETTE[2] },
    { label: 'Chứng khoán', value: t.stocks, color: PALETTE[1] },
    { label: 'Tiền mặt & khác', value: t.cash, color: PALETTE[9] },
  ]);
  donut(root.querySelector('#ov-top'), [
    ...cryptoHoldings().map((h) => ({ label: h.asset, value: h.value })),
    ...stocks.map((p) => ({ label: p.ticker, value: p.valueUSD })),
    ...state.cash.map((c) => ({ label: c.name, value: toUSD(cashBalance(c).balance, c.currency) })),
  ]);
  if (hasBudget) {
    bars(root.querySelector('#ov-flow'), months.map((m) => m.slice(5) + '/' + m.slice(2, 4)), [
      { label: 'Thu', data: trend.map((m) => toUSD(m.income, 'VND')), color: PALETTE[2] },
      { label: 'Tiêu dùng', data: trend.map((m) => toUSD(m.spend, 'VND')), color: PALETTE[3] },
      { label: 'Để dành & đầu tư', data: trend.map((m) => toUSD(m.saved, 'VND')), color: PALETTE[4] },
    ]);
  }
  if (state.snapshots.length > 1) {
    const s = state.snapshots;
    line(root.querySelector('#ov-hist'), s.map((x) => x.date), [
      { label: 'Tài sản ròng', data: s.map((x) => x.total), fill: true, color: PALETTE[0] },
      { label: 'Crypto', data: s.map((x) => x.crypto), color: PALETTE[2] },
      { label: 'Chứng khoán', data: s.map((x) => x.stocks), color: PALETTE[1] },
    ]);
  }

  // ---- tiền mặt
  root.querySelector('#cash-form').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const c = { id: uid(), name: f.get('name'), currency: f.get('currency') };
    const n = c.currency === 'VND' ? parseAmount(f.get('amount')) : Number(f.get('amount'));
    if (!Number.isFinite(n)) return toast('Số tiền không hợp lệ', 'error');
    setAnchor(c, n);
    state.cash.push(c);
    commit({ edit: true });
    ctx.rerender();
  };
  root.querySelectorAll('[data-edit-cash]').forEach((btn) => {
    btn.onclick = () => {
      const c = state.cash.find((x) => x.id === btn.dataset.editCash);
      const cur = Math.round(cashBalance(c).balance * 100) / 100;
      const v = prompt(`Số dư thực tế hiện tại của "${c.name}" (${c.currency}${c.currency === 'VND' ? ', vd 52tr hoặc 52.000.000' : ''})`, cur);
      if (v == null) return;
      const n = c.currency === 'VND' ? parseAmount(v) : Number(String(v).replace(',', '.'));
      if (!Number.isFinite(n)) return toast('Số không hợp lệ', 'error');
      setAnchor(c, n);
      commit({ edit: true });
      ctx.rerender();
    };
  });
  root.querySelectorAll('[data-del-cash]').forEach((btn) => {
    btn.onclick = () => {
      state.cash = state.cash.filter((c) => c.id !== btn.dataset.delCash);
      commit({ edit: true });
      ctx.rerender();
    };
  });

  // ---- nợ
  const saveDebts = () => { b.configAt = Date.now(); commit({ edit: true }); ctx.rerender(); };
  root.querySelector('#debt-form').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    b.debts.push({
      id: uid(), name: f.name.trim(), balance: Number(f.balance) || 0, monthly: Number(f.monthly) || 0,
      rate: Number(f.rate) || 0, currency: f.currency,
    });
    saveDebts();
  };
  root.querySelectorAll('[data-edit-debt]').forEach((btn) => {
    btn.onclick = () => {
      const d = b.debts.find((x) => x.id === btn.dataset.editDebt);
      const v = prompt(`Dư nợ mới của "${d.name}"`, d.balance);
      if (v == null) return;
      if (!Number.isFinite(Number(v))) return toast('Số không hợp lệ', 'error');
      d.balance = Number(v);
      saveDebts();
    };
  });
  root.querySelectorAll('[data-del-debt]').forEach((btn) => {
    btn.onclick = () => {
      if (!confirm('Xóa khoản nợ này?')) return;
      b.debts = b.debts.filter((x) => x.id !== btn.dataset.delDebt);
      saveDebts();
    };
  });
}
