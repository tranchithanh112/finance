import { state, commit } from '../store.js';
import { toUSD } from '../calc.js';
import { donut, bars, PALETTE } from '../charts.js';
import {
  parseAmount, monthSummary, shiftMonth, monthKey, localToday, catMap, generateRecurring, SPEND_JARS,
} from '../budget.js';
import { esc, fmtMoney, fmtPct, uid, toast } from '../util.js';
import { locale } from '../i18n.js';

const ui = { month: null, type: 'expense', cat: null, showConfig: false, date: null };

/** Ngày mặc định: ngày vừa dùng nếu thuộc tháng đang xem, không thì hôm nay / ngày 1 của tháng. */
function defaultDate() {
  if (ui.date && monthKey(ui.date) === ui.month) return ui.date;
  return ui.month === monthKey(localToday()) ? localToday() : ui.month + '-01';
}

const EVERY = { 1: 'Hằng tháng', 2: '2 tháng/lần', 3: '3 tháng/lần', 6: '6 tháng/lần', 12: 'Hằng năm' };

/** Tài khoản VND có thể gắn với thu chi; lựa chọn được nhớ trên máy này. */
const accounts = () => state.cash.filter((c) => c.currency === 'VND');
function currentAcc() {
  const list = accounts();
  let id;
  try { id = localStorage.getItem('fin.acc'); } catch { /* ignore */ }
  if (id === 'none') return 'none';
  return list.some((c) => c.id === id) ? id : list[0]?.id || 'none';
}
function accSelect(name, sel) {
  const list = accounts();
  if (!list.length) return '';
  return `<select name="${name}" title="Tự cộng/trừ vào tài khoản">
    ${list.map((c) => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>🏦 ${esc(c.name)}</option>`).join('')}
    <option value="none" ${sel === 'none' ? 'selected' : ''}>Không trừ vào tài khoản</option></select>`;
}

const vnd = (v, opt) => fmtMoney(toUSD(v, 'VND'), opt);
const monthLabel = (ym) => { const [y, m] = ym.split('-'); return `Tháng ${Number(m)}/${y}`; };

function saveConfig(b) {
  b.configAt = Date.now();
  commit({ edit: true });
}

export function renderBudget(root, ctx) {
  const b = state.budget;
  ui.month ||= monthKey(localToday());
  const cats = catMap(b);
  const S = monthSummary(b, ui.month);
  const typeCats = b.categories.filter((c) => c.type === ui.type);
  if (!typeCats.some((c) => c.id === ui.cat)) ui.cat = typeCats[0]?.id;
  const pctSum = b.jars.reduce((a, j) => a + (Number(j.pct) || 0), 0);

  // 6 tháng gần nhất cho biểu đồ
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(ui.month, i - 5));
  const trend = months.map((m) => monthSummary(b, m));

  // Giao dịch nhóm theo ngày
  const byDay = new Map();
  for (const t of [...S.txs].sort((x, y) => y.date.localeCompare(x.date) || (y.u || 0) - (x.u || 0))) {
    if (!byDay.has(t.date)) byDay.set(t.date, []);
    byDay.get(t.date).push(t);
  }

  root.innerHTML = `
    <div class="month-nav">
      <button class="btn" data-month="-1" aria-label="Tháng trước">‹</button>
      <b>${monthLabel(ui.month)}</b>
      <button class="btn" data-month="1" aria-label="Tháng sau" ${ui.month >= monthKey(localToday()) ? 'disabled' : ''}>›</button>
    </div>

    <div class="card quick-add">
      <form id="tx-add">
        <div class="seg full">
          <button type="button" data-type="expense" class="${ui.type === 'expense' ? 'on' : ''}">Chi</button>
          <button type="button" data-type="income" class="${ui.type === 'income' ? 'on' : ''}">Thu</button>
        </div>
        <div class="amount-row">
          <input name="amount" id="qa-amount" inputmode="decimal" autocomplete="off" placeholder="Số tiền — vd 45k, 1.2tr" required>
          <span class="muted small" id="qa-preview"></span>
        </div>
        <div class="chips">
          ${typeCats.map((c) => `<button type="button" class="chip ${ui.cat === c.id ? 'on' : ''}" data-cat="${esc(c.id)}">${esc(c.icon || '')} ${esc(c.name)}</button>`).join('')}
        </div>
        <div class="row gap wrap">
          <input name="note" placeholder="Ghi chú (tuỳ chọn)" class="grow">
          <input name="date" type="date" value="${defaultDate()}" required>
          ${accSelect('acc', currentAcc())}
          <button class="btn primary">Lưu</button>
        </div>
      </form>
    </div>

    <div class="kpis">
      <div class="kpi"><span>Thu nhập</span><b class="pos">${vnd(S.income)}</b></div>
      <div class="kpi"><span>Tiêu dùng</span><b class="neg">${vnd(S.spend)}</b><small>Thiết yếu + Hưởng thụ</small></div>
      <div class="kpi"><span>Để dành & đầu tư</span><b>${vnd(S.saved)}</b></div>
      <div class="kpi"><span>Chưa phân bổ</span><b class="${S.left < 0 ? 'neg' : ''}">${vnd(S.left)}</b><small>Thu − tiêu − để dành</small></div>
      <div class="kpi hero"><span>Tỷ lệ tiết kiệm</span><b>${S.savingsRate == null ? '—' : fmtPct(S.savingsRate, { sign: false })}</b>
        <small>(Thu − tiêu dùng) / thu</small></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Các hũ tháng này</h3><small class="muted">Chia thu nhập ${vnd(S.income)} theo tỷ lệ</small></div>
      <div class="jars">
        ${S.jars.map((j) => {
          const spendJar = SPEND_JARS.has(j.id);
          const over = j.left < 0;
          const color = over ? (spendJar ? 'var(--neg)' : 'var(--pos)') : j.color;
          const note = spendJar
            ? (over ? `<span class="neg">vượt ${vnd(-j.left)}</span>` : `<span class="muted">còn ${vnd(j.left)}</span>`)
            : (over ? `<span class="pos">vượt mục tiêu ${vnd(-j.left)}</span>` : `<span class="muted">cần thêm ${vnd(j.left)}</span>`);
          return `
          <div class="jar">
            <div class="jar-head"><b>${esc(j.name)}</b><span class="muted small">${j.pct}%${spendJar ? ' · hạn mức' : ' · mục tiêu'}</span></div>
            <div class="bar"><i style="width:${Math.min(100, (j.ratio === Infinity ? 1 : j.ratio) * 100)}%;background:${color}"></i></div>
            <div class="jar-foot small"><span>${vnd(j.used)} / ${vnd(j.alloc)}</span>${note}</div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="grid2">
      <div class="card"><h3>Chi theo danh mục</h3>
        ${Object.keys(S.byCat).length ? '<div class="chart"><canvas id="bd-cat"></canvas></div>' : '<p class="empty">Chưa có khoản chi.</p>'}</div>
      <div class="card"><h3>6 tháng gần nhất</h3><div class="chart"><canvas id="bd-trend"></canvas></div></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Giao dịch</h3><small class="muted">${S.txs.length} khoản</small></div>
      ${byDay.size ? [...byDay].map(([d, list]) => `
        <div class="day"><div class="day-head muted small">${new Date(d + 'T00:00').toLocaleDateString(locale(), { weekday: 'short', day: '2-digit', month: '2-digit' })}</div>
          ${list.map((t) => {
            const c = cats[t.cat];
            return `<div class="tx"><span class="tx-icon">${esc(c?.icon || '•')}</span>
              <span class="tx-main"><b>${esc(c?.name || t.cat)}</b>${t.note ? `<span class="muted small"> · ${esc(t.note)}</span>` : ''}
                ${t.id.startsWith('rec:') ? '<span class="tag">định kỳ</span>' : ''}
                ${t.acc && accName(t.acc) ? `<span class="tag">🏦 ${esc(accName(t.acc))}</span>` : ''}</span>
              <span class="tx-amt ${t.type === 'income' ? 'pos' : ''}">${t.type === 'income' ? '+' : '−'}${vnd(t.amount)}</span>
              <button class="link danger" data-del="${esc(t.id)}" aria-label="Xóa">✕</button></div>`;
          }).join('')}</div>`).join('') : '<p class="empty">Chưa có giao dịch trong tháng.</p>'}
    </div>

    <div class="card">
      <div class="card-head"><h3>Thiết lập hũ, khoản định kỳ & danh mục</h3>
        <button class="btn" id="bd-cfg">${ui.showConfig ? 'Thu gọn' : 'Mở'}</button></div>
      ${ui.showConfig ? configHtml(b, pctSum) : ''}
    </div>`;

  // ---- biểu đồ
  if (Object.keys(S.byCat).length) {
    donut(root.querySelector('#bd-cat'), Object.entries(S.byCat).map(([id, v]) => ({
      label: `${cats[id]?.icon || ''} ${cats[id]?.name || id}`, value: toUSD(v, 'VND'),
    })));
  }
  bars(root.querySelector('#bd-trend'), months.map((m) => m.slice(5) + '/' + m.slice(2, 4)), [
    { label: 'Thu', data: trend.map((m) => toUSD(m.income, 'VND')), color: PALETTE[2] },
    { label: 'Tiêu dùng', data: trend.map((m) => toUSD(m.spend, 'VND')), color: PALETTE[3] },
    { label: 'Để dành & đầu tư', data: trend.map((m) => toUSD(m.saved, 'VND')), color: PALETTE[1] },
  ]);

  bind(root, ctx, b);
}

const accName = (id) => state.cash.find((c) => c.id === id)?.name;

function configHtml(b, pctSum) {
  const catOpts = (type, sel) => b.categories.filter((c) => c.type === type)
    .map((c) => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.icon || '')} ${esc(c.name)}</option>`).join('');
  return `
    <h4>Tỷ lệ các hũ <small class="${pctSum === 100 ? 'muted' : 'neg'}">(tổng ${pctSum}%${pctSum === 100 ? '' : ' — cần bằng 100%'})</small></h4>
    <form id="jar-form" class="jar-form">
      ${b.jars.map((j) => `<label>${esc(j.name)}<input name="${esc(j.id)}" type="number" min="0" max="100" step="1" value="${j.pct}"></label>`).join('')}
      <label>Quỹ dự phòng mục tiêu (tháng)<input name="emergencyTarget" type="number" min="1" max="24" value="${b.emergencyTarget}"></label>
      <button class="btn primary">Lưu tỷ lệ</button>
    </form>

    <h4>Khoản định kỳ (tự thêm mỗi tháng)</h4>
    <div class="table-wrap"><table class="tbl mini">
      <thead><tr><th>Khoản</th><th class="r">Số tiền</th><th class="r">Ngày</th><th>Chu kỳ</th><th>Từ tháng</th><th></th></tr></thead>
      <tbody>${b.recurring.map((r) => `<tr>
        <td>${esc(b.categories.find((c) => c.id === r.cat)?.icon || '')} ${esc(b.categories.find((c) => c.id === r.cat)?.name || r.cat)}${r.note ? ` · ${esc(r.note)}` : ''}${r.acc && accName(r.acc) ? ` <span class="tag">🏦 ${esc(accName(r.acc))}</span>` : ''}</td>
        <td class="r ${r.type === 'income' ? 'pos' : ''}">${r.type === 'income' ? '+' : '−'}${vnd(r.amount)}</td>
        <td class="r">${r.day}</td><td>${EVERY[r.every || 1] || `${r.every} tháng`}</td><td>${esc(r.startMonth)}</td>
        <td class="r"><button class="link danger" data-del-rec="${esc(r.id)}">Xóa</button></td></tr>`).join('') ||
        '<tr><td colspan="6" class="empty">Chưa có — vd Lương ngày 5, Netflix 3 tháng/lần.</td></tr>'}</tbody>
    </table></div>
    <form id="rec-form" class="inline-form">
      <select name="cat"><optgroup label="Thu">${catOpts('income')}</optgroup><optgroup label="Chi">${catOpts('expense')}</optgroup></select>
      <input name="amount" inputmode="decimal" placeholder="Số tiền (vd 15tr)" required>
      <input name="day" type="number" min="1" max="28" value="5" title="Ngày trong tháng (1–28)">
      <select name="every" title="Chu kỳ">${Object.entries(EVERY).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <input name="startMonth" type="month" value="${monthKey(localToday())}" title="Tháng trả lần đầu (tính từ đó theo chu kỳ)">
      <input name="note" placeholder="Ghi chú">
      ${accSelect('acc', currentAcc())}
      <button class="btn">Thêm</button>
    </form>

    <h4>Thêm danh mục</h4>
    <form id="cat-form" class="inline-form">
      <input name="icon" placeholder="Emoji" maxlength="4" style="max-width:80px">
      <input name="name" placeholder="Tên danh mục" required>
      <select name="type"><option value="expense">Chi</option><option value="income">Thu</option></select>
      <select name="jar">${b.jars.map((j) => `<option value="${esc(j.id)}">Hũ ${esc(j.name)}</option>`).join('')}</select>
      <button class="btn">Thêm</button>
    </form>
    <div class="chips">${b.categories.map((c) => `<span class="chip static">${esc(c.icon || '')} ${esc(c.name)}
      <small class="muted">${c.type === 'income' ? 'thu' : esc(b.jars.find((j) => j.id === c.jar)?.name || '')}</small>
      ${b.txs.some((t) => t.cat === c.id) || b.recurring.some((r) => r.cat === c.id) ? '' : `<button class="link danger" data-del-cat="${esc(c.id)}">✕</button>`}</span>`).join('')}</div>`;
}

function bind(root, ctx, b) {
  const $ = (s) => root.querySelector(s);
  root.querySelectorAll('[data-month]').forEach((btn) => {
    btn.onclick = () => { ui.month = shiftMonth(ui.month, Number(btn.dataset.month)); ctx.rerender(); };
  });
  root.querySelectorAll('[data-type]').forEach((btn) => {
    btn.onclick = () => { ui.type = btn.dataset.type; ui.cat = null; ctx.rerender(); };
  });
  root.querySelectorAll('[data-cat]').forEach((btn) => {
    btn.onclick = () => {
      ui.cat = btn.dataset.cat;
      root.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('on', x === btn));
    };
  });
  const amount = $('#qa-amount');
  amount.oninput = () => {
    const v = parseAmount(amount.value);
    $('#qa-preview').textContent = Number.isFinite(v) && v > 0 ? `= ${v.toLocaleString('vi-VN')} ₫` : '';
  };

  $('#tx-add').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const v = parseAmount(f.get('amount'));
    if (!(v > 0)) return toast('Số tiền không hợp lệ (vd 45k, 1.2tr, 150000)', 'error');
    if (!ui.cat) return toast('Chọn danh mục', 'error');
    const acc = f.get('acc') || 'none';
    try { localStorage.setItem('fin.acc', acc); } catch { /* ignore */ }
    b.txs.push({
      id: uid(), date: f.get('date'), type: ui.type, amount: v, cat: ui.cat,
      note: String(f.get('note') || '').trim(), acc: acc === 'none' ? null : acc, u: Date.now(),
    });
    ui.month = monthKey(f.get('date'));
    ui.date = f.get('date');
    commit({ edit: true });
    toast(`Đã lưu ${ui.type === 'income' ? 'khoản thu' : 'khoản chi'} ${v.toLocaleString('vi-VN')} ₫`, 'ok', 2000);
    ctx.rerender();
    document.getElementById('qa-amount')?.focus();
  };

  root.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.del;
      b.txs = b.txs.filter((t) => t.id !== id);
      b.deleted[id] = Date.now();
      commit({ edit: true });
      ctx.rerender();
    };
  });

  $('#bd-cfg').onclick = () => { ui.showConfig = !ui.showConfig; ctx.rerender(); };
  if (!ui.showConfig) return;

  $('#jar-form').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const next = b.jars.map((j) => ({ ...j, pct: Number(f.get(j.id)) || 0 }));
    const sum = next.reduce((a, j) => a + j.pct, 0);
    if (sum !== 100) return toast(`Tổng tỷ lệ đang là ${sum}%, cần bằng 100%`, 'error');
    b.jars = next;
    b.emergencyTarget = Number(f.get('emergencyTarget')) || 6;
    saveConfig(b);
    toast('Đã lưu tỷ lệ hũ', 'ok');
    ctx.rerender();
  };

  $('#rec-form').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const v = parseAmount(f.amount);
    if (!(v > 0)) return toast('Số tiền không hợp lệ', 'error');
    const cat = b.categories.find((c) => c.id === f.cat);
    b.recurring.push({
      id: uid(), type: cat?.type || 'expense', amount: v, cat: f.cat, note: f.note.trim(),
      day: Math.min(28, Math.max(1, Number(f.day) || 1)), every: Number(f.every) || 1, acc: f.acc && f.acc !== 'none' ? f.acc : null, startMonth: f.startMonth || monthKey(localToday()), active: true,
    });
    generateRecurring(b);
    saveConfig(b);
    ctx.rerender();
  };
  root.querySelectorAll('[data-del-rec]').forEach((btn) => {
    btn.onclick = () => {
      if (!confirm('Xóa khoản định kỳ này? (Các giao dịch đã sinh vẫn được giữ)')) return;
      b.recurring = b.recurring.filter((r) => r.id !== btn.dataset.delRec);
      saveConfig(b);
      ctx.rerender();
    };
  });

  $('#cat-form').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    b.categories.push({ id: uid(), name: f.name.trim(), icon: f.icon.trim(), type: f.type, jar: f.type === 'expense' ? f.jar : undefined });
    saveConfig(b);
    ctx.rerender();
  };
  root.querySelectorAll('[data-del-cat]').forEach((btn) => {
    btn.onclick = () => {
      b.categories = b.categories.filter((c) => c.id !== btn.dataset.delCat);
      saveConfig(b);
      ctx.rerender();
    };
  });
}
