import { state, commit } from '../store.js';
import { openSheet } from '../sheet.js';
import { parseAmount, formatAmountInput, applyAmountKey, localToday, dayLabel, restoreTx, catMap } from '../budget.js';
import { esc, uid, toast, fmtVnd } from '../util.js';
import { tr, translateDom, locale, getLang } from '../i18n.js';

// Bảng ghi / sửa 1 khoản thu chi + các phần dùng chung với bảng "khoản tự động" (Thiết lập).

const KIND = { expense: 'chi', income: 'thu' };

/** Dấu nhóm nghìn trong ô số tiền theo ngôn ngữ: 45.000 (tiếng Việt) / 45,000 (tiếng Anh). */
const amountSep = () => (getLang() === 'en' ? ',' : '.');
/** Số tiền có sẵn (khi sửa) → chữ hiện trong ô số tiền. */
export const amountText = (n) => formatAmountInput(String(n), amountSep());

/** Tài khoản VND có thể gắn với thu chi (tự cộng / trừ số dư). */
const vndAccounts = () => state.cash.filter((c) => c.currency === 'VND');

/** Tài khoản dùng lần trước trên máy này. */
export function lastAccount() {
  const list = vndAccounts();
  let id;
  try { id = localStorage.getItem('fin.acc'); } catch { /* bỏ qua */ }
  if (id === 'none') return 'none';
  return list.some((c) => c.id === id) ? id : list[0]?.id || 'none';
}

/** Ô chọn tài khoản — chỉ hiện khi đã có tài khoản VND (mục Tiền mặt ở Tổng quan). */
export function accountField(sel) {
  const list = vndAccounts();
  if (!list.length) return '';
  if (!list.some((c) => c.id === sel)) sel = 'none'; // tài khoản đã bị xóa → không tự gắn sang tài khoản khác
  return `<label class="field"><span>Tài khoản</span><select name="acc">
    ${list.map((c) => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
    <option value="none" ${sel === 'none' ? 'selected' : ''}>Không trừ vào tài khoản</option></select></label>`;
}

/** Ô số tiền chữ to + nút nhanh 000 / nghìn / triệu. */
export function amountField(value = '', autofocus = false) {
  return `<div class="amt">
    <div class="amt-row"><input name="amount" class="amt-input" inputmode="decimal" autocomplete="off" placeholder="0"
      aria-label="Số tiền" value="${esc(value)}" ${autofocus ? 'autofocus' : ''}><span class="amt-cur">₫</span></div>
    <div class="amt-preview small muted" aria-live="polite"></div>
    <div class="amt-keys">
      <button type="button" data-key="000">000</button>
      <button type="button" data-key="k">nghìn</button>
      <button type="button" data-key="tr">triệu</button>
    </div>
  </div>`;
}

export function bindAmount(root) {
  const input = root.querySelector('.amt-input');
  const preview = root.querySelector('.amt-preview');
  const update = () => {
    const sep = amountSep();
    const shown = formatAmountInput(input.value, sep);
    if (shown !== input.value) {
      // giữ con trỏ sau đúng số chữ số bên trái nó (dấu chấm tự thêm / bớt không làm con trỏ nhảy về cuối)
      const digits = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/\D/g, '').length;
      input.value = shown;
      let i = 0;
      for (let n = 0; i < shown.length && n < digits; i++) if (/\d/.test(shown[i])) n++;
      input.setSelectionRange(i, i);
    }
    const v = parseAmount(input.value);
    // "= 45.000 ₫" chỉ cần khi gõ kiểu tắt (45k, 1,5tr) — gõ số thường thì ô đã tự nhóm nghìn
    preview.textContent = /\D/.test(input.value.split(sep).join('')) && v > 0 ? `= ${v.toLocaleString(locale())} ₫` : '';
    input.classList.remove('invalid');
  };
  input.addEventListener('input', update);
  root.querySelectorAll('[data-key]').forEach((b) => {
    b.onclick = () => { input.value = applyAmountKey(input.value, b.dataset.key, amountSep()); update(); input.focus(); };
  });
  update();
  return input;
}

/** Lưới danh mục (thấy hết, không cuộn ngang). */
export function catGrid(b, type, sel) {
  return `<div class="cat-grid" role="radiogroup" aria-label="Danh mục">${b.categories.filter((c) => c.type === type).map((c) => `
    <button type="button" class="cat-btn ${c.id === sel ? 'on' : ''}" data-cat="${esc(c.id)}" role="radio" aria-checked="${c.id === sel}">
      <span class="cat-ic">${esc(c.icon || '•')}</span><span class="cat-name">${esc(c.name)}</span></button>`).join('')}</div>`;
}

/**
 * Nút Chi | Thu + lưới danh mục, vẽ lại khi đổi lựa chọn. ui = { type, cat } (sửa tại chỗ).
 * onChange() sau mỗi lần vẽ (vd đổi chữ trên nút Lưu).
 */
export function bindTypeAndCats(el, b, ui, onChange = () => {}) {
  const box = el.querySelector('.entry-cats');
  const paint = () => {
    el.querySelectorAll('[data-type]').forEach((x) => {
      x.classList.toggle('on', x.dataset.type === ui.type);
      x.setAttribute('aria-pressed', String(x.dataset.type === ui.type));
    });
    box.innerHTML = catGrid(b, ui.type, ui.cat);
    box.classList.remove('invalid');
    translateDom(box);
    box.querySelectorAll('[data-cat]').forEach((x) => {
      // đổi trạng thái tại chỗ (không vẽ lại lưới) để giữ focus bàn phím và để trình đọc màn hình đọc được lựa chọn
      x.onclick = () => {
        ui.cat = x.dataset.cat;
        box.classList.remove('invalid');
        box.querySelectorAll('[data-cat]').forEach((y) => {
          y.classList.toggle('on', y === x);
          y.setAttribute('aria-checked', String(y === x));
        });
      };
    });
    onChange();
  };
  el.querySelectorAll('[data-type]').forEach((x) => {
    x.onclick = () => {
      if (ui.type === x.dataset.type) return;
      ui.type = x.dataset.type;
      ui.cat = null; // danh mục chi và thu khác nhau → chọn lại
      paint();
    };
  });
  paint();
  return box;
}

export const typeSwitch = () => `<div class="seg full entry-type">
  <button type="button" data-type="expense">Chi</button><button type="button" data-type="income">Thu</button></div>`;

/**
 * Bảng ghi / sửa 1 khoản. tx có sẵn = sửa. type / date: mặc định cho khoản mới.
 * onDone({ date }) sau khi lưu / xóa / hoàn tác — thường là vẽ lại tab.
 */
export function openEntry({ tx = null, type = 'expense', date = null, onDone = () => {} } = {}) {
  const editing = Boolean(tx);
  const ui = { type: tx?.type || type, cat: tx?.cat || null };
  const title = () => (editing ? `Sửa khoản ${KIND[ui.type]}` : 'Ghi khoản mới');
  openSheet({
    title: title(),
    body: `<form class="entry" novalidate>
      ${typeSwitch()}
      ${amountField(tx ? amountText(tx.amount) : '', !editing)}
      <div class="entry-cats"></div>
      <label class="field"><span>Ghi chú</span>
        <input name="note" placeholder="Không bắt buộc" autocomplete="off" maxlength="120" value="${esc(tx?.note || '')}"></label>
      <div class="field-row">
        <label class="field"><span>Ngày <small class="day-hint muted"></small></span>
          <input name="date" type="date" required value="${esc(tx?.date || date || localToday())}"></label>
        ${accountField(tx ? tx.acc || 'none' : lastAccount())}
      </div>
      <button class="btn primary big entry-save"></button>
      ${editing ? '<button type="button" class="link danger entry-del">Xóa khoản này</button>' : ''}
    </form>`,
    onMount: (el, close) => {
      const form = el.querySelector('form');
      const amount = bindAmount(el);
      const save = el.querySelector('.entry-save');
      const cats = bindTypeAndCats(el, state.budget, ui, () => {
        save.textContent = tr(editing ? 'Lưu thay đổi' : `Lưu khoản ${KIND[ui.type]}`);
        el.querySelector('#sheet-title').textContent = tr(title());
      });
      const dateInput = form.elements.date;
      const hint = el.querySelector('.day-hint');
      const showHint = () => {
        const l = dayLabel(dateInput.value, localToday(), locale());
        hint.textContent = l === 'Hôm nay' || l === 'Hôm qua' ? `(${tr(l)})` : '';
      };
      dateInput.addEventListener('input', showHint);
      showHint();

      form.onsubmit = (e) => {
        e.preventDefault();
        const f = new FormData(form);
        const value = parseAmount(f.get('amount'));
        if (!(value > 0)) {
          amount.classList.add('invalid');
          amount.focus();
          return toast('Nhập số tiền lớn hơn 0', 'error');
        }
        if (!ui.cat) {
          cats.classList.add('invalid');
          return toast('Chọn danh mục', 'error');
        }
        const d = f.get('date');
        if (!d) return toast('Chọn ngày', 'error');
        const acc = f.get('acc') || 'none';
        // nhớ tài khoản cho lần ghi sau — chỉ khi ghi mới, sửa khoản cũ không đổi mặc định
        if (!editing) try { localStorage.setItem('fin.acc', acc); } catch { /* bỏ qua */ }
        const b = state.budget; // đọc lại lúc lưu: đồng bộ nền có thể đã thay state.budget
        const now = Date.now();
        const data = {
          date: d, type: ui.type, amount: value, cat: ui.cat, note: String(f.get('note') || '').trim(),
          acc: acc === 'none' ? null : acc, u: now,
        };
        if (editing) {
          const cur = b.txs.find((t) => t.id === tx.id);
          if (!cur) return toast('Không tìm thấy khoản này — có thể vừa bị xóa trên máy khác', 'error');
          cur.at ??= cur.u; // lúc ghi gốc (khoản cũ chưa có at) — giữ nguyên để số dư tài khoản không trừ lại
          Object.assign(cur, data);
        } else {
          b.txs.push({ id: uid(), ...data, at: now });
        }
        commit({ edit: true });
        close();
        onDone({ date: d });
        const name = catMap(b)[ui.cat]?.name || '';
        toast(editing ? `Đã cập nhật khoản ${KIND[ui.type]}` : `Đã lưu khoản ${KIND[ui.type]} ${fmtVnd(value)} · ${name}`, 'ok');
      };

      el.querySelector('.entry-del')?.addEventListener('click', () => {
        const b = state.budget;
        const cur = b.txs.find((t) => t.id === tx.id) || tx;
        b.txs = b.txs.filter((t) => t.id !== cur.id);
        b.deleted[cur.id] = Date.now(); // dấu xóa: máy khác đồng bộ về cũng không "hồi sinh"
        commit({ edit: true });
        close();
        onDone({ date: cur.date });
        toast(`Đã xóa khoản ${KIND[cur.type]} ${fmtVnd(cur.amount)}`, 'ok', {
          action: {
            label: 'Hoàn tác',
            run: () => {
              restoreTx(state.budget, cur, uid());
              commit({ edit: true });
              onDone({ date: cur.date });
              toast(`Đã khôi phục khoản ${KIND[cur.type]}`, 'ok');
            },
          },
        });
      });
    },
  });
}
