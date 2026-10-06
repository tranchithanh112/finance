import { state, commit } from '../store.js';
import { openSheet } from '../sheet.js';
import { parseAmount, generateRecurring, catMap, monthKey, localToday, shiftMonth } from '../budget.js';
import { esc, uid, toast, fmtVnd } from '../util.js';
import { tr } from '../i18n.js';
import { amountField, amountText, bindAmount, typeSwitch, bindTypeAndCats, accountField, lastAccount } from './budget-entry.js';

// Màn "Thiết lập" của tab Thu chi: khoản tự động hằng tháng, danh mục, chia thu nhập (tỷ lệ hũ).
// Mỗi mục là danh sách; bấm để sửa trong bảng có nhãn rõ ràng.

const EVERY = { 1: 'Hằng tháng', 2: '2 tháng/lần', 3: '3 tháng/lần', 6: '6 tháng/lần', 12: 'Hằng năm' };
const JAR_DESC = { nec: 'chi tiêu cần thiết', play: 'chi cho bản thân', save: 'tiền để dành', invest: 'tiền đầu tư' };
const ICONS = ['🍜', '🍱', '☕', '🧋', '🛒', '🛵', '🚗', '⛽', '🚌', '📱', '💡', '💧', '🏠', '👪', '💊', '🏥', '🎓', '📚', '👕', '🛍️',
  '💄', '✈️', '🎮', '🎬', '🎁', '🐶', '👶', '💳', '🏦', '🛟', '🪙', '📈', '💼', '🎉', '📊', '➕', '💰', '🧾', '🔧', '❤️'];

const monthLabel = (ym) => { const [y, m] = ym.split('-'); return `Tháng ${Number(m)}/${y}`; };
const accName = (id) => state.cash.find((c) => c.id === id)?.name;
const usage = (b, catId) => b.txs.filter((t) => t.cat === catId).length + b.recurring.filter((r) => r.cat === catId).length;

function saveConfig(b) {
  b.configAt = Date.now(); // cấu hình gộp giữa các máy theo lần sửa sau cùng
  commit({ edit: true });
}

export function renderBudgetSettings(body, ctx) {
  const b = state.budget;
  const cats = catMap(b);
  body.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>Khoản tự động hằng tháng</h3><button type="button" class="btn" data-add-rec>+ Thêm</button></div>
      <p class="muted small">Lương, tiền nhà, hóa đơn… tự ghi vào đúng ngày, không cần nhập tay mỗi tháng.</p>
      ${b.recurring.length ? `<div class="set-list">${b.recurring.map((r) => recRow(r, cats)).join('')}</div>`
        : '<p class="empty">Chưa có khoản tự động nào.</p>'}
    </div>

    <div class="card">
      <div class="card-head"><h3>Danh mục</h3><button type="button" class="btn" data-add-cat>+ Thêm</button></div>
      ${['expense', 'income'].map((type) => `
        <h4 class="set-group">${type === 'expense' ? 'Chi' : 'Thu'}</h4>
        <div class="set-list">${b.categories.filter((c) => c.type === type).map((c) => catRow(b, c)).join('')}</div>`).join('')}
    </div>

    <div class="card">
      <h3>Chia thu nhập</h3>
      <p class="muted small">Mỗi khi có thu nhập, app chia theo tỷ lệ này để tính "Còn tiêu được" và mục tiêu để dành.</p>
      <form id="jar-form" class="set-jars" novalidate>
        ${b.jars.map((j) => `<label class="jar-pct"><span><b>${esc(j.name)}</b> <small class="muted">${JAR_DESC[j.id] || ''}</small></span>
          <span class="pct-input"><input name="${esc(j.id)}" type="number" inputmode="numeric" min="0" max="100" step="1" value="${j.pct}"><span>%</span></span></label>`).join('')}
        <p class="jar-total" aria-live="polite"></p>
        <label class="field"><span>Quỹ dự phòng nên đủ mấy tháng chi tiêu</span>
          <input name="emergencyTarget" type="number" inputmode="numeric" min="1" max="24" step="1" value="${b.emergencyTarget}"></label>
        <button class="btn primary">Lưu tỷ lệ</button>
      </form>
    </div>`;

  body.querySelector('[data-add-rec]').onclick = () => openRec(null, ctx);
  body.querySelectorAll('[data-rec]').forEach((x) => {
    x.onclick = () => { const r = state.budget.recurring.find((y) => y.id === x.dataset.rec); if (r) openRec(r, ctx); };
  });
  body.querySelector('[data-add-cat]').onclick = () => openCat(null, ctx);
  body.querySelectorAll('[data-cat-edit]').forEach((x) => {
    x.onclick = () => { const c = state.budget.categories.find((y) => y.id === x.dataset.catEdit); if (c) openCat(c, ctx); };
  });
  bindJars(body.querySelector('#jar-form'), ctx);
}

function recRow(r, cats) {
  const c = cats[r.cat];
  const acc = r.acc && accName(r.acc);
  return `<button type="button" class="set-row" data-rec="${esc(r.id)}">
    <span class="bd-ic">${esc(c?.icon || '•')}</span>
    <span class="set-main"><b>${esc(c?.name || r.cat)}${r.note ? ` · ${esc(r.note)}` : ''}</b>
      <small>Ngày ${Number(r.day) || 1} · ${EVERY[r.every || 1] || `${r.every} tháng/lần`}${acc ? ` · ${esc(acc)}` : ''}</small></span>
    <span class="bd-amt ${r.type === 'income' ? 'pos' : ''}">${r.type === 'income' ? '+' : '−'}${fmtVnd(Number(r.amount))}</span>
  </button>`;
}

function catRow(b, c) {
  const jar = c.type === 'expense' ? b.jars.find((j) => j.id === (c.jar || 'nec'))?.name : '';
  return `<button type="button" class="set-row" data-cat-edit="${esc(c.id)}">
    <span class="bd-ic">${esc(c.icon || '•')}</span>
    <span class="set-main"><b>${esc(c.name)}</b>${jar ? `<small>Hũ ${esc(jar)}</small>` : ''}</span>
    <span class="chev" aria-hidden="true">›</span>
  </button>`;
}

// ---------- Khoản tự động ----------

function openRec(r, ctx) {
  const editing = Boolean(r);
  const ui = { type: r?.type || 'expense', cat: r?.cat || null };
  const nowYm = monthKey(localToday());
  const start = r?.startMonth || nowYm;
  const months = Array.from({ length: 25 }, (_, i) => shiftMonth(nowYm, i - 12));
  if (!months.includes(start)) months.unshift(start); // khoản cũ bắt đầu xa hơn 12 tháng
  openSheet({
    title: editing ? 'Sửa khoản tự động' : 'Thêm khoản tự động',
    body: `<form class="entry" novalidate>
      ${typeSwitch()}
      ${amountField(r ? amountText(r.amount) : '', !editing)}
      <div class="entry-cats"></div>
      <div class="field-row">
        <label class="field"><span>Vào ngày</span><select name="day">
          ${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}" ${(Number(r?.day) || 5) === i + 1 ? 'selected' : ''}>Ngày ${i + 1}</option>`).join('')}
        </select></label>
        <label class="field"><span>Lặp lại</span><select name="every">
          ${Object.entries(EVERY).map(([k, v]) => `<option value="${k}" ${String(r?.every || 1) === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Bắt đầu từ</span><select name="startMonth">
          ${months.map((m) => `<option value="${m}" ${m === start ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}
        </select></label>
        ${accountField(r ? r.acc || 'none' : lastAccount())}
      </div>
      <label class="field"><span>Ghi chú</span>
        <input name="note" placeholder="Không bắt buộc" autocomplete="off" maxlength="120" value="${esc(r?.note || '')}"></label>
      ${editing ? '<p class="muted small">Thay đổi áp dụng cho các lần sau; các khoản đã ghi giữ nguyên.</p>' : ''}
      <button class="btn primary big">${editing ? 'Lưu thay đổi' : 'Thêm khoản tự động'}</button>
      ${editing ? '<button type="button" class="link danger entry-del">Xóa khoản tự động</button>' : ''}
    </form>`,
    onMount: (el, close) => {
      const form = el.querySelector('form');
      const amount = bindAmount(el);
      const cats = bindTypeAndCats(el, state.budget, ui);
      form.onsubmit = (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(form));
        const value = parseAmount(f.amount);
        if (!(value > 0)) { amount.classList.add('invalid'); amount.focus(); return toast('Nhập số tiền lớn hơn 0', 'error'); }
        if (!ui.cat) { cats.classList.add('invalid'); return toast('Chọn danh mục', 'error'); }
        const b = state.budget;
        const data = {
          type: ui.type, amount: value, cat: ui.cat, note: String(f.note || '').trim(),
          day: Math.min(28, Math.max(1, Number(f.day) || 1)), every: Number(f.every) || 1,
          startMonth: f.startMonth || nowYm, acc: f.acc && f.acc !== 'none' ? f.acc : null, active: true,
        };
        if (editing) {
          const cur = b.recurring.find((x) => x.id === r.id);
          if (!cur) return toast('Không tìm thấy khoản này — có thể vừa bị xóa trên máy khác', 'error');
          Object.assign(cur, data);
        } else {
          b.recurring.push({ id: uid(), ...data });
        }
        const added = generateRecurring(b); // ghi luôn các lần đã đến hạn (tính từ "Bắt đầu từ")
        saveConfig(b);
        close();
        ctx.rerender();
        const name = catMap(b)[ui.cat]?.name || '';
        toast(added ? `Đã lưu khoản tự động ${name} · đã ghi ${added} khoản đến hôm nay` : `Đã lưu khoản tự động ${name}`, 'ok', added ? 7000 : undefined);
      };
      el.querySelector('.entry-del')?.addEventListener('click', () => {
        const b = state.budget;
        const i = b.recurring.findIndex((x) => x.id === r.id);
        if (i < 0) return close();
        const [gone] = b.recurring.splice(i, 1);
        saveConfig(b);
        close();
        ctx.rerender();
        toast('Đã xóa khoản tự động (các khoản đã ghi vẫn giữ)', 'ok', {
          action: {
            label: 'Hoàn tác',
            run: () => {
              const b2 = state.budget;
              b2.recurring.splice(Math.min(i, b2.recurring.length), 0, gone);
              saveConfig(b2);
              ctx.rerender();
              toast('Đã khôi phục khoản tự động', 'ok');
            },
          },
        });
      });
    },
  });
}

// ---------- Danh mục ----------

function openCat(c, ctx) {
  const editing = Boolean(c);
  const ui = { type: c?.type || 'expense', icon: c?.icon || ICONS[0] };
  const icons = c?.icon && !ICONS.includes(c.icon) ? [c.icon, ...ICONS] : ICONS; // giữ biểu tượng tự gõ trước đây
  const jars = state.budget.jars;
  openSheet({
    title: editing ? 'Sửa danh mục' : 'Thêm danh mục',
    body: `<form class="entry" novalidate>
      ${editing ? `<p class="muted small">Danh mục ${c.type === 'income' ? 'thu' : 'chi'}</p>` : typeSwitch()}
      <label class="field"><span>Tên danh mục</span>
        <input name="name" placeholder="Ví dụ: Tiền nhà" autocomplete="off" maxlength="40" value="${esc(c?.name || '')}" ${editing ? '' : 'autofocus'}></label>
      <div class="field"><span>Biểu tượng</span>
        <div class="icon-grid" role="radiogroup" aria-label="Biểu tượng">${icons.map((i) => `
          <button type="button" data-icon="${esc(i)}" role="radio" aria-checked="${i === ui.icon}" class="${i === ui.icon ? 'on' : ''}">${esc(i)}</button>`).join('')}</div></div>
      <fieldset class="field jar-field">
        <legend>Thuộc hũ</legend>
        ${jars.map((j) => `<label class="radio-row"><input type="radio" name="jar" value="${esc(j.id)}" ${(c?.jar || 'nec') === j.id ? 'checked' : ''}>
          <span><b>${esc(j.name)}</b> <small class="muted">${JAR_DESC[j.id] || ''}</small></span></label>`).join('')}
      </fieldset>
      <button class="btn primary big">${editing ? 'Lưu thay đổi' : 'Thêm danh mục'}</button>
      ${editing ? '<button type="button" class="link danger entry-del">Xóa danh mục</button>' : ''}
    </form>`,
    onMount: (el, close) => {
      const form = el.querySelector('form');
      const name = form.elements.name;
      const jarField = el.querySelector('.jar-field');
      const showJar = () => { jarField.hidden = ui.type !== 'expense'; }; // danh mục thu không thuộc hũ nào
      const types = el.querySelectorAll('[data-type]');
      const markType = () => types.forEach((y) => {
        y.classList.toggle('on', y.dataset.type === ui.type);
        y.setAttribute('aria-pressed', String(y.dataset.type === ui.type));
      });
      types.forEach((x) => { x.onclick = () => { ui.type = x.dataset.type; markType(); showJar(); }; });
      markType();
      showJar();
      el.querySelectorAll('[data-icon]').forEach((x) => {
        x.onclick = () => {
          ui.icon = x.dataset.icon;
          el.querySelectorAll('[data-icon]').forEach((y) => {
            y.classList.toggle('on', y === x);
            y.setAttribute('aria-checked', String(y === x));
          });
        };
      });
      name.addEventListener('input', () => name.classList.remove('invalid'));

      form.onsubmit = (e) => {
        e.preventDefault();
        const b = state.budget;
        const n = name.value.trim();
        if (!n) { name.classList.add('invalid'); name.focus(); return toast('Nhập tên danh mục', 'error'); }
        const type = editing ? c.type : ui.type;
        if (b.categories.some((x) => x.type === type && x.id !== c?.id && x.name.trim().toLowerCase() === n.toLowerCase())) {
          name.classList.add('invalid');
          return toast('Đã có danh mục tên này', 'error');
        }
        const jar = type === 'expense' ? new FormData(form).get('jar') || 'nec' : undefined;
        if (editing) {
          const cur = b.categories.find((x) => x.id === c.id);
          if (!cur) return toast('Không tìm thấy danh mục này — có thể vừa bị xóa trên máy khác', 'error');
          Object.assign(cur, { name: n, icon: ui.icon, jar });
        } else {
          b.categories.push({ id: uid(), name: n, icon: ui.icon, type, jar });
        }
        saveConfig(b);
        close();
        ctx.rerender();
        toast(editing ? `Đã lưu danh mục ${n}` : `Đã thêm danh mục ${n}`, 'ok');
      };

      el.querySelector('.entry-del')?.addEventListener('click', () => {
        const b = state.budget;
        const used = usage(b, c.id);
        if (used) return toast(`Không xóa được: còn ${used} khoản dùng danh mục này`, 'error');
        const i = b.categories.findIndex((x) => x.id === c.id);
        if (i < 0) return close();
        const [gone] = b.categories.splice(i, 1);
        saveConfig(b);
        close();
        ctx.rerender();
        toast(`Đã xóa danh mục ${gone.name}`, 'ok', {
          action: {
            label: 'Hoàn tác',
            run: () => {
              const b2 = state.budget;
              b2.categories.splice(Math.min(i, b2.categories.length), 0, gone);
              saveConfig(b2);
              ctx.rerender();
              toast(`Đã khôi phục danh mục ${gone.name}`, 'ok');
            },
          },
        });
      });
    },
  });
}

// ---------- Chia thu nhập ----------

function bindJars(form, ctx) {
  const ids = state.budget.jars.map((j) => j.id);
  const total = () => ids.reduce((a, id) => a + (Number(form.elements[id].value) || 0), 0);
  const out = form.querySelector('.jar-total');
  const paint = () => {
    const t = total();
    out.textContent = tr(t === 100 ? 'Tổng 100% ✓' : `Tổng ${t}% — cần đúng 100%`);
    out.classList.toggle('neg', t !== 100);
  };
  form.addEventListener('input', paint);
  paint();
  form.onsubmit = (e) => {
    e.preventDefault();
    const t = total();
    if (t !== 100) return toast(`Tổng tỷ lệ đang là ${t}%, cần bằng 100%`, 'error');
    const months = Number(form.elements.emergencyTarget.value);
    if (!(months >= 1 && months <= 24)) return toast('Số tháng quỹ dự phòng phải từ 1 đến 24', 'error');
    const b = state.budget;
    b.jars = b.jars.map((j) => ({ ...j, pct: Number(form.elements[j.id].value) || 0 }));
    b.emergencyTarget = months;
    saveConfig(b);
    ctx.rerender();
    toast('Đã lưu cách chia thu nhập', 'ok');
  };
}
