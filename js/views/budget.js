import { state } from '../store.js';
import { monthSummary, shiftMonth, monthKey, localToday, catMap, spendingBudget, dayLabel, SPEND_JARS } from '../budget.js';
import { esc, fmtVnd } from '../util.js';
import { locale } from '../i18n.js';
import { openEntry } from './budget-entry.js';
import { renderReport } from './budget-report.js';
import { renderBudgetSettings } from './budget-settings.js';

// Tab Thu chi: tháng đang xem + 3 màn (Giao dịch · Báo cáo · Thiết lập). Thu chi luôn tính bằng VND.

const ui = { month: null, view: 'tx', showJars: false };
const VIEWS = [['tx', 'Giao dịch'], ['report', 'Báo cáo'], ['setup', 'Thiết lập']];

const monthLabel = (ym) => { const [y, m] = ym.split('-'); return `Tháng ${Number(m)}/${y}`; };
const accName = (id) => state.cash.find((c) => c.id === id)?.name;

/** Ngày mặc định cho khoản mới: hôm nay, hoặc ngày 1 nếu đang xem tháng cũ. */
const defaultDate = () => (ui.month && ui.month !== monthKey(localToday()) ? ui.month + '-01' : localToday());

/** Lưu / xóa xong: chuyển tới tháng của khoản đó (đang ở Thiết lập thì về danh sách) rồi vẽ lại. */
const afterEntry = (ctx) => ({ date } = {}) => {
  if (date) ui.month = monthKey(date);
  if (ui.view === 'setup') ui.view = 'tx';
  ctx.rerender();
};

/** Nút + nổi (mọi tab trừ Cài đặt): ghi khoản mới ngay trên tab đang mở, không chuyển tab. */
export function openNewEntry(ctx) {
  openEntry({ onDone: afterEntry(ctx) });
}

export function renderBudget(root, ctx) {
  const today = localToday();
  ui.month ||= monthKey(today);
  const setup = ui.view === 'setup';
  root.innerHTML = `
    <div class="bd-head">
      ${setup ? '' : `<div class="month-nav">
        <button class="btn" data-month="-1" aria-label="Tháng trước">‹</button>
        <b>${monthLabel(ui.month)}</b>
        <button class="btn" data-month="1" aria-label="Tháng sau" ${ui.month >= monthKey(today) ? 'disabled' : ''}>›</button>
      </div>`}
      <div class="seg full bd-views">${VIEWS.map(([id, label]) =>
        `<button type="button" data-view="${id}" class="${ui.view === id ? 'on' : ''}" aria-pressed="${ui.view === id}">${label}</button>`).join('')}</div>
      <button type="button" class="btn primary bd-add" data-new="expense">+ Ghi khoản mới</button>
    </div>
    <div class="bd-body"></div>`;
  const body = root.querySelector('.bd-body');
  if (ui.view === 'report') renderReport(body, state.budget, ui.month);
  else if (setup) renderBudgetSettings(body, ctx);
  else renderTx(body, state.budget, ui.month, today);

  root.querySelectorAll('[data-month]').forEach((btn) => {
    btn.onclick = () => { ui.month = shiftMonth(ui.month, Number(btn.dataset.month)); ctx.rerender(); };
  });
  root.querySelectorAll('[data-view]').forEach((btn) => {
    btn.onclick = () => { ui.view = btn.dataset.view; ctx.rerender(); };
  });
  root.querySelectorAll('[data-new]').forEach((btn) => {
    btn.onclick = () => openEntry({ type: btn.dataset.new, date: defaultDate(), onDone: afterEntry(ctx) });
  });
  root.querySelectorAll('[data-tx]').forEach((btn) => {
    btn.onclick = () => {
      const tx = state.budget.txs.find((t) => t.id === btn.dataset.tx);
      if (tx) openEntry({ tx, onDone: afterEntry(ctx) });
    };
  });
  root.querySelector('[data-jars]')?.addEventListener('click', () => { ui.showJars = !ui.showJars; ctx.rerender(); });
}

// ---------- Màn Giao dịch ----------

function renderTx(body, b, ym, today) {
  const S = monthSummary(b, ym);
  const cats = catMap(b);
  const byDay = new Map();
  for (const t of [...S.txs].sort((x, y) => y.date.localeCompare(x.date) || (y.u || 0) - (x.u || 0))) {
    if (!byDay.has(t.date)) byDay.set(t.date, []);
    byDay.get(t.date).push(t);
  }
  body.innerHTML = `
    ${budgetCard(S, spendingBudget(S, ym, today))}
    <div class="bd-sum">
      <span><small>Thu vào</small><b class="pos">${fmtVnd(S.income, { compact: true })}</b></span>
      <span><small>Tiêu</small><b>${fmtVnd(S.spend, { compact: true })}</b></span>
      <span><small>Để dành</small><b>${fmtVnd(S.saved, { compact: true })}</b></span>
    </div>
    ${byDay.size ? [...byDay].map(([d, list]) => `
      <section class="bd-day">
        <h4>${esc(dayLabel(d, today, locale()))}</h4>
        ${list.map((t) => txRow(t, cats)).join('')}
      </section>`).join('') : `
      <div class="card bd-empty">
        <p>Chưa có khoản nào trong ${monthLabel(ym).toLowerCase()}</p>
        <button type="button" class="btn primary" data-new="expense">Ghi khoản đầu tiên</button>
      </div>`}`;
}

function budgetCard(S, sb) {
  if (sb.status === 'noIncome') {
    return `<div class="card bd-budget">
      <p class="bd-budget-label">Còn tiêu được</p>
      <p class="bd-budget-hint">Ghi lương hoặc thu nhập để biết còn tiêu được bao nhiêu.</p>
      <button type="button" class="btn" data-new="income">Ghi khoản thu</button>
    </div>`;
  }
  const over = sb.status === 'over';
  const pct = sb.budget > 0 ? Math.min(100, (sb.spent / sb.budget) * 100) : 100;
  const level = over ? 'over' : pct >= 85 ? 'warn' : '';
  return `<div class="card bd-budget ${level}">
    <p class="bd-budget-label">${over ? 'Đã tiêu quá' : sb.daysLeft ? 'Còn tiêu được tháng này' : 'Còn lại'}</p>
    <p class="bd-budget-num">${fmtVnd(Math.abs(sb.left))}</p>
    <div class="bar" role="img" aria-label="Đã tiêu ${Math.round(pct)}% ngân sách"><i style="width:${pct.toFixed(1)}%"></i></div>
    <div class="bd-budget-foot">
      <span>Đã tiêu ${fmtVnd(sb.spent, { compact: true })} / ${fmtVnd(sb.budget, { compact: true })}</span>
      ${sb.perDay ? `<span>≈ ${fmtVnd(Math.round(sb.perDay / 1000) * 1000, { compact: true })} mỗi ngày</span>` : ''}
    </div>
    <button type="button" class="link bd-jars-btn" data-jars aria-expanded="${ui.showJars}">${ui.showJars ? 'Ẩn 4 hũ' : 'Xem 4 hũ'}</button>
    ${ui.showJars ? jarsList(S) : ''}
  </div>`;
}

function jarsList(S) {
  return `<ul class="bd-jars">${S.jars.map((j) => {
    const spend = SPEND_JARS.has(j.id);
    const over = spend && j.left < 0;
    const note = !spend ? `đã để ${fmtVnd(j.used, { compact: true })} / mục tiêu ${fmtVnd(j.alloc, { compact: true })}`
      : over ? `vượt ${fmtVnd(-j.left, { compact: true })}` : `còn ${fmtVnd(j.left, { compact: true })}`;
    const pct = j.alloc > 0 ? Math.min(100, (j.used / j.alloc) * 100) : 0;
    return `<li>
      <span class="bd-jar-name">${esc(j.name)}</span>
      <span class="bd-jar-note ${over ? 'neg' : ''}">${note}</span>
      <span class="bar"><i style="width:${pct.toFixed(1)}%;background:${over ? 'var(--neg)' : esc(j.color)}"></i></span>
    </li>`;
  }).join('')}</ul>`;
}

function txRow(t, cats) {
  const c = cats[t.cat];
  const sub = [t.note, t.id.startsWith('rec:') ? 'Tự động hằng tháng' : '', t.acc ? accName(t.acc) : ''].filter(Boolean);
  return `<button type="button" class="bd-tx" data-tx="${esc(t.id)}">
    <span class="bd-ic">${esc(c?.icon || '•')}</span>
    <span class="bd-tx-main"><b>${esc(c?.name || t.cat)}</b>${sub.length ? `<small>${sub.map(esc).join(' · ')}</small>` : ''}</span>
    <span class="bd-amt ${t.type === 'income' ? 'pos' : ''}">${t.type === 'income' ? '+' : '−'}${fmtVnd(Number(t.amount))}</span>
  </button>`;
}
