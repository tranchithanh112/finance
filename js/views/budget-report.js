import { monthSummary, shiftMonth, catMap, SPEND_JARS } from '../budget.js';
import { bars, PALETTE } from '../charts.js';
import { esc, fmtVnd } from '../util.js';

// Màn "Báo cáo" của tab Thu chi: tiêu vào đâu, để dành bao nhiêu, 6 tháng gần nhất. Luôn VND.

export function renderReport(body, b, ym) {
  const S = monthSummary(b, ym);
  const cats = catMap(b);
  const rows = Object.entries(S.byCat)
    .map(([id, v]) => ({ id, v, c: cats[id] }))
    .sort((x, y) => y.v - x.v);
  const isSpend = (r) => SPEND_JARS.has(r.c?.jar || 'nec');
  const spendRows = rows.filter(isSpend);
  const saveRows = rows.filter((r) => !isSpend(r));
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(ym, i - 5));
  const trend = months.map((m) => monthSummary(b, m));

  body.innerHTML = `
    ${summaryLine(S)}
    <div class="card">
      <h3>Tiêu vào đâu</h3>
      ${spendRows.length ? barList(spendRows, S.spend) : '<p class="empty">Chưa có khoản tiêu nào trong tháng.</p>'}
    </div>
    <div class="card">
      <h3>Để dành & đầu tư</h3>
      ${saveRows.length ? barList(saveRows, S.saved) : '<p class="empty">Chưa có khoản để dành nào trong tháng.</p>'}
    </div>
    <div class="card">
      <h3>6 tháng gần nhất</h3>
      <div class="chart"><canvas id="bd-trend"></canvas></div>
    </div>`;

  bars(body.querySelector('#bd-trend'), months.map((m) => m.slice(5) + '/' + m.slice(2, 4)), [
    { label: 'Thu vào', data: trend.map((m) => m.income), color: PALETTE[2] },
    { label: 'Tiêu', data: trend.map((m) => m.spend), color: PALETTE[3] },
    { label: 'Để dành', data: trend.map((m) => m.saved), color: PALETTE[1] },
  ], { fmt: fmtVnd });
}

/** Một câu dễ hiểu thay cho công thức "tỷ lệ tiết kiệm". */
function summaryLine(S) {
  if (!(S.income > 0)) return '';
  if (S.spend > S.income) return `<p class="bd-insight neg">Tháng này bạn tiêu nhiều hơn thu nhập ${fmtVnd(S.spend - S.income)}.</p>`;
  return `<p class="bd-insight">Tháng này bạn giữ lại được ${Math.round(S.savingsRate * 100)}% thu nhập.</p>`;
}

function barList(rows, total) {
  return `<ul class="bd-bars">${rows.map(({ id, v, c }) => {
    const pct = total > 0 ? (v / total) * 100 : 0;
    return `<li>
      <span class="bd-bars-name">${esc(c?.icon || '•')} ${esc(c?.name || id)}</span>
      <span class="bd-bars-val">${fmtVnd(v)} <small class="muted">${Math.round(pct)}%</small></span>
      <span class="bar"><i style="width:${pct.toFixed(1)}%"></i></span>
    </li>`;
  }).join('')}</ul>`;
}
