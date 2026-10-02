import { state, commit } from '../store.js';
import { totals, stockPositions, cryptoHoldings, toUSD, fxRate, cashBalance } from '../calc.js';
import { donut, bars, PALETTE } from '../charts.js';
import { snapshotSeries } from '../series.js';
import { goalProgress, snapshotTrend, monthRecap, dcaDue } from '../insights.js';
import { historyCard, bindHistory, histMode } from './history-card.js';
import {
  monthSummary, recentAverage, healthScore, debtMonthlyVnd, parseAmount, setAnchor, monthKey, localToday, shiftMonth, SPEND_JARS,
} from '../budget.js';
import { esc, fmtMoney, fmtPct, pnlClass, uid, fmtNative, timeAgo, toast, fmtDate, isStable as isStableAsset } from '../util.js';

const vnd = (v, o) => fmtMoney(toUSD(v, 'VND'), o);
const mmyy = (ym) => `${ym.slice(5)}/${ym.slice(0, 4)}`;

let editingGoal = false;
let recapWhich = 'prev'; // 'prev' = tháng trước (đã trọn tháng), 'cur' = tháng này đến hôm nay

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

  const histRows = snapshotSeries(state.snapshots);
  const hmode = histMode('overview', 'total');
  const hist = {
    id: 'overview', title: 'Tài sản ròng theo thời gian', rows: histRows, key: 'total',
    modes: [['total', 'Tổng'], ['mix', 'Theo loại']], mode: hmode,
    note: 'Mỗi ngày lưu 1 điểm khi bạn mở app / làm mới số dư.',
    series: hmode === 'mix'
      ? [
        { key: 'coins', label: 'Crypto', color: PALETTE[0], area: 'stack' },
        { key: 'stable', label: 'Stablecoin', color: PALETTE[2], area: 'stack' },
        { key: 'stocks', label: 'Chứng khoán', color: PALETTE[1], area: 'stack' },
        { key: 'cash', label: 'Tiền mặt & khác', color: PALETTE[9], area: 'stack' },
      ]
      : [{ key: 'total', label: 'Tài sản ròng', color: PALETTE[0], area: 'gradient' }],
  };

  // ---- mục tiêu tài sản ròng: tốc độ tăng lấy từ thu chi (thu − tiêu TB 3 tháng), chưa có thì theo xu hướng tài sản
  const goal = state.settings.goal?.amount > 0 ? state.settings.goal : null;
  const saveVnd = H.avg ? H.avg.income - H.avg.spend : null;
  const trendUsd = snapshotTrend(state.snapshots);
  const monthly = saveVnd > 0 ? { usd: toUSD(saveVnd, 'VND'), from: 'budget' } : trendUsd > 0 ? { usd: trendUsd, from: 'trend' } : null;
  const g = goal && goalProgress({ totalUsd: t.total, goalUsd: toUSD(goal.amount, goal.currency), monthlyUsd: monthly?.usd });

  // ---- tóm tắt tháng
  const thisYm = monthKey(localToday());
  const recap = monthRecap({
    budget: b, ym: recapWhich === 'cur' ? thisYm : shiftMonth(thisYm, -1), snapshots: state.snapshots,
    holdings: cryptoHoldings().filter((h) => !isStableAsset(h.asset)), priceAt: ctx.priceAt,
  });
  const due = dcaDue(state.stocks.txs, localToday());

  const alloc = (() => { try { return localStorage.getItem('fin.alloc') || 'class'; } catch { return 'class'; } })();

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
        <small>Spot ${pnl ? fmtMoney(pnl.totals.total, { sign: true, compact: true }) : '—'}${fut ? ` · Futures ${fmtMoney(fut.net + fut.unrealized, { sign: true, compact: true })}` : ''} · CK ${stocks.length ? fmtMoney(stockPnl, { sign: true, compact: true }) : '—'}</small></div>
    </div>

    ${due.map((tk) => `<a class="nudge" href="#stocks" data-buy="${esc(tk)}">Tháng này chưa mua <b>${esc(tk.replace(/\.VN$/, ''))}</b><span>Mua thêm →</span></a>`).join('')}

    ${historyCard(hist)}

    <div class="grid2">
      <div class="card goal">
        <div class="card-head"><h3>Mục tiêu tài sản</h3>${goal && !editingGoal ? '<button class="link" id="goal-edit">Sửa</button>' : ''}</div>
        ${goal && !editingGoal ? `
          <div class="goal-top"><b>${fmtPct(Math.min(g.pct, 9.99), { sign: false })}</b><span class="muted">của ${fmtNative(goal.amount, goal.currency)}</span></div>
          <div class="progress"><i style="width:${Math.min(100, g.pct * 100)}%"></i></div>
          <p class="muted small">${g.done ? 'Đã đạt mục tiêu.' : `Còn ${fmtMoney(g.remaining)}`}${g.eta
            ? ` · dự kiến đạt khoảng <b>${mmyy(g.eta)}</b> (~${g.months} tháng), với mức tăng ~${fmtMoney(monthly.usd, { compact: true })}/tháng ${monthly.from === 'budget' ? 'từ thu chi' : 'theo xu hướng tài sản'}`
            : g.done ? '' : ' · nhập thu chi vài tháng để ước tính ngày đạt'}</p>`
        : `<form id="goal-form" class="inline-form">
            <input name="amount" placeholder="vd 1 tỷ, 500tr, 50000" value="${goal ? esc(goal.amount) : ''}" required>
            <select name="currency">${['VND', 'USD'].map((c) => `<option ${(goal?.currency || 'VND') === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
            <button class="btn primary">Lưu</button>
            ${goal ? '<button type="button" class="btn" id="goal-cancel">Hủy</button><button type="button" class="link danger" id="goal-del">Xóa</button>' : ''}
          </form>
          <p class="muted small">Tài sản ròng bạn muốn đạt. App hiện tiến độ và ước tính khi nào đạt dựa trên mức để dành hằng tháng.</p>`}
      </div>
      <div class="card recap">
        <div class="card-head"><h3>Tháng ${mmyy(recap.ym)}</h3>
          <div class="seg">${[['prev', 'Tháng trước'], ['cur', 'Tháng này']].map(([k, l]) => `<button data-recap="${k}" class="${recapWhich === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="recap-grid">
          <div><span>Chi tiêu</span><b>${recap.hasBudget ? vnd(recap.spend) : '—'}</b>
            <small class="${recap.spendDelta > 0 ? 'neg' : recap.spendDelta < 0 ? 'pos' : ''}">${recap.spendDelta != null ? `${fmtPct(recap.spendDelta)} so với tháng trước` : recap.hasBudget ? '' : 'Chưa nhập thu chi'}</small></div>
          <div><span>Thu nhập</span><b>${recap.hasBudget ? vnd(recap.income) : '—'}</b>
            <small>${recap.saved ? `Để dành & đầu tư ${vnd(recap.saved, { compact: true })}` : ''}</small></div>
          <div><span>Tài sản ròng</span><b class="${pnlClass(recap.net?.change)}">${recap.net ? fmtMoney(recap.net.change, { sign: true }) : '—'}</b>
            <small>${recap.net ? `${recap.net.pct != null ? fmtPct(recap.net.pct) + ' · ' : ''}${fmtMoney(recap.net.start, { compact: true })} → ${fmtMoney(recap.net.end, { compact: true })}` : 'Chưa đủ dữ liệu'}</small></div>
          <div><span>Crypto</span>
            ${recap.up ? `<small>Kéo lên: <b>${esc(recap.up.asset)}</b> <span class="pos">${fmtMoney(recap.up.change, { sign: true, compact: true })}</span> (${fmtPct(recap.up.pct)})</small>` : ''}
            ${recap.down ? `<small>Kéo xuống: <b>${esc(recap.down.asset)}</b> <span class="neg">${fmtMoney(recap.down.change, { sign: true, compact: true })}</span> (${fmtPct(recap.down.pct)})</small>` : ''}
            ${recap.up || recap.down ? '' : '<small>—</small>'}</div>
        </div>
      </div>
    </div>

    <div class="grid2">
      <div class="card">
        <div class="card-head"><h3>Phân bổ tài sản</h3>
          <div class="seg">${[['class', 'Theo loại'], ['asset', 'Theo tài sản']].map(([k, l]) => `<button data-alloc="${k}" class="${alloc === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="chart"><canvas id="ov-class"></canvas></div></div>
      <div class="card"><h3>Thu chi 6 tháng</h3>${hasBudget ? '<div class="chart"><canvas id="ov-flow"></canvas></div>' : '<p class="empty">Chưa có dữ liệu thu chi.</p>'}</div>
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
              <td class="r nowrap"><button class="link" data-edit-cash="${esc(c.id)}">Sửa số dư</button>
                <button class="link danger" data-del-cash="${esc(c.id)}">Xóa</button></td></tr>`;
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
        <div class="card-head"><h3>Nợ</h3><small class="muted">${b.debts.length ? 'Trả hằng tháng ' + vnd(H.debtMonthly) : 'Không có nợ'}</small></div>
        <table class="tbl">
          <tbody>
            ${b.debts.map((d) => `
              <tr><td>${esc(d.name)}${d.rate ? ` <span class="muted small">${d.rate}%/năm</span>` : ''}</td>
              <td class="r neg">${fmtNative(Number(d.balance), d.currency)}</td>
              <td class="r muted small">${d.monthly ? fmtNative(Number(d.monthly), d.currency) + '/th' : ''}</td>
              <td class="r nowrap"><button class="link" data-edit-debt="${esc(d.id)}">Sửa dư nợ</button>
                <button class="link danger" data-del-debt="${esc(d.id)}">Xóa</button></td></tr>`).join('') ||
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

  donut(root.querySelector('#ov-class'), alloc === 'asset'
    ? [
      ...cryptoHoldings().map((h) => ({ label: h.asset, value: h.value })),
      ...stocks.map((p) => ({ label: p.ticker, value: p.valueUSD })),
      ...state.cash.map((c) => ({ label: c.name, value: toUSD(cashBalance(c).balance, c.currency) })),
    ]
    : [
      { label: 'Crypto', value: t.crypto - t.stable, color: PALETTE[0] },
      { label: 'Stablecoin', value: t.stable, color: PALETTE[2] },
      { label: 'Chứng khoán', value: t.stocks, color: PALETTE[1] },
      { label: 'Tiền mặt & khác', value: t.cash, color: PALETTE[9] },
    ]);
  root.querySelectorAll('[data-alloc]').forEach((b) => {
    b.onclick = () => { try { localStorage.setItem('fin.alloc', b.dataset.alloc); } catch { /* bỏ qua */ } ctx.rerender(); };
  });
  if (hasBudget) {
    bars(root.querySelector('#ov-flow'), months.map((m) => m.slice(5) + '/' + m.slice(2, 4)), [
      { label: 'Thu', data: trend.map((m) => toUSD(m.income, 'VND')), color: PALETTE[2] },
      { label: 'Tiêu dùng', data: trend.map((m) => toUSD(m.spend, 'VND')), color: PALETTE[3] },
      { label: 'Để dành & đầu tư', data: trend.map((m) => toUSD(m.saved, 'VND')), color: PALETTE[1] },
    ]);
  }
  bindHistory(root, hist, ctx);

  // ---- mục tiêu & tóm tắt tháng
  root.querySelector('#goal-edit')?.addEventListener('click', () => { editingGoal = true; ctx.rerender(); });
  root.querySelector('#goal-cancel')?.addEventListener('click', () => { editingGoal = false; ctx.rerender(); });
  root.querySelector('#goal-del')?.addEventListener('click', () => {
    if (!confirm('Xóa mục tiêu tài sản?')) return;
    state.settings.goal = null;
    editingGoal = false;
    commit({ edit: true });
    ctx.rerender();
  });
  const goalForm = root.querySelector('#goal-form');
  if (goalForm) goalForm.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(goalForm);
    const amount = parseAmount(f.get('amount'));
    if (!(amount > 0)) return toast('Số tiền không hợp lệ', 'error');
    state.settings.goal = { amount, currency: f.get('currency') };
    editingGoal = false;
    commit({ edit: true });
    ctx.rerender();
  };
  root.querySelectorAll('[data-recap]').forEach((btn) => { btn.onclick = () => { recapWhich = btn.dataset.recap; ctx.rerender(); }; });
  root.querySelectorAll('.nudge[data-buy]').forEach((a) => {
    a.onclick = () => { try { sessionStorage.setItem('fin.buy', a.dataset.buy); } catch { /* bỏ qua */ } };
  });

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
