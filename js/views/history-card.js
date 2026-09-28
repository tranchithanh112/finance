import { timeline } from '../charts.js';
import { RANGES, sliceRange, rangeChange, periodPnl } from '../series.js';
import { fmtMoney, fmtPct, pnlClass } from '../util.js';

// Thẻ "tài sản theo thời gian" dùng chung: chọn khoảng 1T/3T/6T/1N/Tất cả, (tùy chọn) chế độ xem,
// hiển thị giá trị cuối + thay đổi trong khoảng, biểu đồ có tooltip khi rê/chạm.

const pref = (k, def) => { try { return localStorage.getItem(k) || def; } catch { return def; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* bỏ qua */ } };

export const histRange = (id) => pref(`fin.range.${id}`, '3m');
export const histMode = (id, def) => pref(`fin.mode.${id}`, def);

/**
 * opts: { id, title, rows, key (chuỗi chính để tính thay đổi), pnl? (rows có value/cost/pnl → hiện lãi/lỗ trong kỳ),
 *         modes?: [[id,label]], mode?, note?, empty? }
 */
export function historyCard(opts) {
  const { id, title, rows, key, modes, mode, note, empty, pnl, noPct } = opts;
  const range = histRange(id);
  const view = sliceRange(rows, range);
  const last = view[view.length - 1];
  // pnl: true → hiển thị lãi/lỗ trong kỳ (loại trừ tiền mua thêm) thay vì mức tăng giá trị
  const ch = pnl ? periodPnl(view) : rangeChange(view, key);
  if (ch && noPct) ch.pct = null;
  const label = RANGES.find((r) => r[0] === range)?.[1] || '';
  const rangeText = range === 'all' ? 'từ đầu' : label;
  let head = '';
  if (last && pnl) {
    // Số chính = lãi/lỗ chưa chốt hiện tại (đúng bằng khoảng cách giữa 2 đường);
    // dòng phụ = lãi/lỗ trong kỳ, tách thành phần chưa chốt thay đổi + đã chốt.
    const unreal = last.value - last.cost;
    const first = view[0];
    const dUnreal = unreal - (first.value - first.cost);
    head = `<div class="hist-value"><b>${fmtMoney(last[key])}</b>
        <span class="hist-delta ${pnlClass(unreal)}">${fmtMoney(unreal, { sign: true })}${last.cost > 0 ? ` (${fmtPct(unreal / last.cost)})` : ''}</span>
        <small class="muted">chưa chốt</small></div>
      ${ch ? `<div class="hist-sub muted small">Lãi/lỗ ${rangeText}: <b class="${pnlClass(ch.abs)}">${fmtMoney(ch.abs, { sign: true })}</b>
        = chưa chốt ${fmtMoney(dUnreal, { sign: true, compact: true })} · đã chốt ${fmtMoney(ch.abs - dUnreal, { sign: true, compact: true })}</div>` : ''}`;
  }
  return `
    <div class="card hist-card" data-hist="${id}">
      <div class="hist-head">
        <div class="hist-title">
          <h3>${title}</h3>
          ${pnl ? head : last ? `<div class="hist-value"><b>${fmtMoney(last[key])}</b>${ch ? `
            <span class="hist-delta ${pnlClass(ch.abs)}">${fmtMoney(ch.abs, { sign: true })}${ch.pct != null ? ` (${fmtPct(ch.pct)})` : ''}</span>
            <small class="muted">${pnl ? (range === 'all' ? 'lãi/lỗ từ đầu' : `lãi/lỗ ${label}`) : (range === 'all' ? 'từ đầu' : label)}</small>` : ''}</div>` : ''}
        </div>
        <div class="hist-controls">
          ${modes ? `<div class="seg">${modes.map(([k, l]) => `<button data-hmode="${k}" class="${mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
          <div class="seg">${RANGES.map(([k, l]) => `<button data-hrange="${k}" class="${range === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        </div>
      </div>
      ${view.length > 1 ? `<div class="chart tall"><canvas id="hc-${id}"></canvas></div>` : `<p class="empty">${empty || 'Chưa đủ dữ liệu — cần ít nhất 2 ngày.'}</p>`}
      ${note ? `<p class="muted small">${note}</p>` : ''}
    </div>`;
}

/** Vẽ biểu đồ + gắn sự kiện cho thẻ đã render. */
export function bindHistory(root, opts, ctx) {
  const { id, rows, series } = opts;
  const card = root.querySelector(`[data-hist="${id}"]`);
  if (!card) return;
  const view = sliceRange(rows, histRange(id));
  if (view.length > 1) timeline(card.querySelector(`#hc-${id}`), view, series);
  card.querySelectorAll('[data-hrange]').forEach((b) => {
    b.onclick = () => { setPref(`fin.range.${id}`, b.dataset.hrange); ctx.rerender(); };
  });
  card.querySelectorAll('[data-hmode]').forEach((b) => {
    b.onclick = () => { setPref(`fin.mode.${id}`, b.dataset.hmode); ctx.rerender(); };
  });
}
