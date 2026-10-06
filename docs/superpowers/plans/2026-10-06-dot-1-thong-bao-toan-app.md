# Đợt 1 — Thông báo toàn app: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every user action that writes/deletes data or calls the network shows a clear success or failure toast; no more false "success" messages.

**Architecture:** Upgrade the shared `toast()` (icons, role, longer errors, tap-to-dismiss, optional action button for "Hoàn tác"), then fix each call site. Library functions that used to swallow partial failures now *return* them (`syncFuturesIncome` → `{ added, skipped }`, `fetchHoldings` → `missing`) and the app decides what to show. Spec: `docs/superpowers/specs/2026-10-06-thu-chi-va-thong-bao-design.md` (Đợt 1).

**Tech Stack:** Vanilla JS ES modules (no build), `node --test`, Vercel static + serverless. UI strings are Vietnamese; every new string needs an English entry in `js/i18n.js` (Task 8).

**Rules for implementers:** match surrounding style (2-space indent, single quotes, semicolons, Vietnamese comments). Do not touch `js/views/budget.js` (rewritten in Đợt 2). Do not commit — the coordinator commits.

---

### Task 1: Toast component

**Files:**
- Modify: `js/util.js` (function `toast`, near the end of the file; add import)
- Modify: `js/icons.js` (object `P`)
- Modify: `css/style.css` (block `/* ================= Toasts ================= */`)

- [ ] **Step 1: Add icons.** In `js/icons.js`, inside `const P = { ... }`, after the `auto:` entry add:

```js
  check: '<path d="M20 6 9 17l-5-5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><circle cx="12" cy="16.4" r=".6" fill="currentColor"/>',
```

- [ ] **Step 2: Replace `toast` in `js/util.js`.** Add `import { icon } from './icons.js';` after the existing i18n import on line 1. Replace:

```js
export function toast(msg, type = 'info', ms = 4000) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = tr(msg);
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
  return el;
}
```

with:

```js
const TOAST_ICON = { ok: 'check', error: 'alert', info: 'info' };

/**
 * Thông báo nhỏ. Tham số 3: số ms, hoặc { ms, action: { label, run } } — vd nút "Hoàn tác".
 * Lỗi hiện lâu hơn và được đọc ngay (role="alert"). Chạm để tắt; tối đa 3 cái cùng lúc.
 */
export function toast(msg, type = 'info', opts = {}) {
  const { ms, action } = typeof opts === 'number' ? { ms: opts } : opts;
  const box = document.getElementById('toasts');
  while (box.children.length >= 3) box.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = icon(TOAST_ICON[type] || 'info');
  const text = document.createElement('span');
  text.className = 'toast-msg';
  text.textContent = tr(msg);
  el.append(text);
  let timer;
  const close = () => { clearTimeout(timer); el.remove(); };
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = tr(action.label);
    btn.onclick = (e) => { e.stopPropagation(); close(); action.run(); };
    el.append(btn);
  }
  el.onclick = close;
  box.appendChild(el);
  timer = setTimeout(close, ms ?? (action ? 6000 : type === 'error' ? 7000 : 4000));
  return el;
}

/** Thao tác kết thúc bằng tải lại trang: lưu thông báo tạm, hiện sau khi trang mở lại (showFlash). */
export function flashAfterReload(msg, type = 'ok') {
  try { sessionStorage.setItem('fin.flash', JSON.stringify([msg, type])); } catch { /* bỏ qua */ }
}
export function showFlash() {
  let f = null;
  try { f = JSON.parse(sessionStorage.getItem('fin.flash') || 'null'); sessionStorage.removeItem('fin.flash'); } catch { /* bỏ qua */ }
  if (f) toast(f[0], f[1]);
}
```

- [ ] **Step 3: CSS.** In `css/style.css` replace:

```css
.toast {
  background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--accent);
  padding: 11px 14px; border-radius: 12px; box-shadow: var(--shadow-lg); font-size: 13px; font-weight: 500;
  animation: in .22s ease-out;
}
.toast.ok { border-left-color: var(--pos); }
.toast.error { border-left-color: var(--neg); }
```

with:

```css
.toast {
  display: flex; align-items: center; gap: 10px; cursor: pointer;
  background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--accent);
  padding: 11px 14px; border-radius: 12px; box-shadow: var(--shadow-lg); font-size: 14px; font-weight: 500; line-height: 1.35;
  animation: in .22s ease-out;
}
.toast > svg.i { width: 18px; height: 18px; flex: none; color: var(--accent); }
.toast.ok { border-left-color: var(--pos); }
.toast.ok > svg.i { color: var(--pos); }
.toast.error { border-left-color: var(--neg); }
.toast.error > svg.i { color: var(--neg); }
.toast-msg { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.toast-action {
  flex: none; border: 0; background: none; color: var(--accent); font: inherit; font-weight: 700;
  padding: 6px 8px; margin: -6px -8px -6px 0; border-radius: 8px; cursor: pointer;
}
.pill.busy { opacity: .6; cursor: progress; }
```

- [ ] **Step 4: Run `npm test`** — expect the same result as before this task (all pass).

---

### Task 2: `login()` tells wrong password apart from server/network errors; storage write failure is reported

**Files:**
- Modify: `js/store.js` (functions `persist`, `login`)
- Create: `tests/login.test.js`

- [ ] **Step 1: Write the failing test** `tests/login.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

// store.js đọc localStorage khi import → stub trước
globalThis.localStorage = { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = v; } };
const { login, local } = await import('../js/store.js');

const reply = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('login: 401 → false (sai mật khẩu), không lưu phiên', async () => {
  globalThis.fetch = reply(401, { error: 'Sai mật khẩu ứng dụng' });
  assert.equal(await login('x'), false);
  assert.equal(local.session, undefined);
});

test('login: server lỗi → throw kèm lời của server, không coi là sai mật khẩu', async () => {
  globalThis.fetch = reply(500, { error: 'APP_PASSWORD chưa được cấu hình' });
  await assert.rejects(login('x'), /APP_PASSWORD chưa được cấu hình/);
  globalThis.fetch = reply(502, {});
  await assert.rejects(login('x'), /HTTP 502/);
});

test('login: mất mạng → throw "Không kết nối được server"', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(login('x'), /Không kết nối được server/);
});

test('login: đúng → lưu phiên', async () => {
  globalThis.fetch = reply(200, { token: 't', exp: 123 });
  assert.equal(await login('x'), true);
  assert.deepEqual(local.session, { token: 't', exp: 123 });
});
```

- [ ] **Step 2: Run** `node --test tests/login.test.js` — expect FAIL (500 resolves `false` instead of rejecting; network error message differs).

- [ ] **Step 3: Implement.** In `js/store.js` replace:

```js
/** Đổi mật khẩu (+ mã 2FA nếu server bật) lấy phiên. Trả về true nếu đúng. Mật khẩu không được lưu lại. */
export async function login(password, otp = '') {
  const headers = { 'x-app-password': password };
  if (otp) headers['x-app-otp'] = String(otp).replace(/\s/g, '');
  const r = await fetch('/api/session', { method: 'POST', headers });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.token) return false;
```

with:

```js
/**
 * Đổi mật khẩu (+ mã 2FA nếu server bật) lấy phiên. Mật khẩu không được lưu lại.
 * true = đúng; false = sai mật khẩu / mã (HTTP 401); mất mạng / server lỗi → throw với lời dễ hiểu.
 */
export async function login(password, otp = '') {
  const headers = { 'x-app-password': password };
  if (otp) headers['x-app-otp'] = String(otp).replace(/\s/g, '');
  let r;
  try {
    r = await fetch('/api/session', { method: 'POST', headers });
  } catch {
    throw new Error('Không kết nối được server — kiểm tra mạng rồi thử lại.');
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) return false;
  if (!r.ok || !data.token) throw new Error(data.error || `Server lỗi (HTTP ${r.status})`);
```

(`migrateAuth()` already wraps `login` in try/catch, so a server error there is retried next launch — no change needed.)

And replace:

```js
    idbSet('state', state).catch(() => {
      try { localStorage.setItem('fin.state', JSON.stringify(state)); } catch { /* quota */ }
    });
```

with:

```js
    idbSet('state', state).catch(() => {
      try {
        localStorage.setItem('fin.state', JSON.stringify(state));
      } catch {
        // cả IndexedDB lẫn localStorage đều không ghi được (thường do đầy bộ nhớ) → app hiện lỗi
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('fin:save-failed'));
      }
    });
```

- [ ] **Step 4: Run** `node --test tests/login.test.js tests/store-cleanup.test.js` — expect PASS.

---

### Task 3: Library functions report partial failures instead of swallowing them

**Files:**
- Modify: `js/futures.js` (`syncOne`, `syncFuturesIncome`)
- Modify: `js/binance.js` (`fetchHoldings`)
- Modify: `tests/futures.test.js` (add import + test)

- [ ] **Step 1: Failing test.** In `tests/futures.test.js` add `syncFuturesIncome` to the existing import on line 3 (`import { csvToIncome, ..., fileNameOffsetHours, syncFuturesIncome } from '../js/futures.js';`) and append:

```js
test('syncFuturesIncome: trả về nguồn bị bỏ qua thay vì im lặng báo 0 bản ghi', async () => {
  const store = emptyFutures();
  const bn = async (path) => {
    if (path === '/dapi/v1/income') throw Object.assign(new Error('Unauthorized'), { status: 401 });
    return [];
  };
  const r = await syncFuturesIncome(bn, store, Date.now());
  assert.equal(r.added, 0);
  assert.deepEqual(r.skipped, [{ src: 'cm', status: 401, message: 'Unauthorized' }]);
});
```

- [ ] **Step 2: Run** `node --test tests/futures.test.js` — expect FAIL (`r.added` undefined: function returns a number).

- [ ] **Step 3: Implement in `js/futures.js`.** Change the signature `async function syncOne(bn, store, src, path, startT, log) {` to `async function syncOne(bn, store, src, path, startT, log, skipped) {` and inside the 400/401/403/404 branch add the push:

```js
      if (e.status === 400 || e.status === 401 || e.status === 403 || e.status === 404) {
        log(`${src.toUpperCase()}: bỏ qua (${e.message})`);
        skipped.push({ src, status: e.status, message: e.message });
        return total;
      }
```

Replace `syncFuturesIncome` with:

```js
/** Tải income futures mới. Trả về { added, skipped: [{ src, status, message }] } — nguồn bị bỏ qua (chưa mở tài khoản / key thiếu quyền). */
export async function syncFuturesIncome(bn, store, startT, log = () => {}) {
  const skipped = [];
  const um = await syncOne(bn, store, 'um', '/fapi/v1/income', startT, log, skipped);
  const cm = await syncOne(bn, store, 'cm', '/dapi/v1/income', startT, log, skipped);
  store.updatedAt = Date.now();
  return { added: um + cm, skipped };
}
```

- [ ] **Step 4: Implement in `js/binance.js`.** In `fetchHoldings`, replace:

```js
  const [tick, account, funding, flex, locked, futures] = await Promise.all([
    fetchTickerPrices(),
    bn('/api/v3/account', { omitZeroBalances: true }),
    bn('/sapi/v1/asset/get-funding-asset', {}).catch(() => null),
    bn('/sapi/v1/simple-earn/flexible/position', { size: 100 }).catch(() => null),
    bn('/sapi/v1/simple-earn/locked/position', { size: 100 }).catch(() => null),
    fetchFuturesAccount(bn).catch(() => null),
  ]);
```

with:

```js
  const missing = []; // phần không tải được (vd key thiếu quyền) → app báo cho người dùng thay vì im lặng
  const optional = (label, p) => p.catch(() => { if (!missing.includes(label)) missing.push(label); return null; });
  const [tick, account, funding, flex, locked, futures] = await Promise.all([
    fetchTickerPrices(),
    bn('/api/v3/account', { omitZeroBalances: true }),
    optional('Funding', bn('/sapi/v1/asset/get-funding-asset', {})),
    optional('Earn', bn('/sapi/v1/simple-earn/flexible/position', { size: 100 })),
    optional('Earn', bn('/sapi/v1/simple-earn/locked/position', { size: 100 })),
    fetchFuturesAccount(bn).catch(() => null),
  ]);
```

and change the last line `return { holdings, tick, futures };` to `return { holdings, tick, futures, missing };`.

- [ ] **Step 5: Run** `node --test tests/futures.test.js` — expect PASS.

---

### Task 4: `js/app.js` call sites

**Files:** Modify `js/app.js` only.

- [ ] **Step 1: Import.** Line 9: add `flashAfterReload, showFlash` to the `./util.js` import list.

- [ ] **Step 2: `dropGap` / `undoAdjust`.** In `dropGap`, after the final `render();` add ``toast(`Đã bỏ ${qty.toPrecision(6)} ${asset} khỏi lịch sử`, 'ok');``. In `undoAdjust` replace `if (!r) return;` with `if (!r) return toast('Không tìm thấy điều chỉnh này — có thể đã được hoàn tác', 'info');` and after its final `render();` add `toast('Đã hoàn tác', 'ok');`.

- [ ] **Step 3: `syncFutures`.** Replace:

```js
      const n = await syncFuturesIncome(bn, state.futures, startT, (m) => { futBusy = m; if (current === 'futures') render(); });
      await ensureFuturesPrices();
      toast(`Futures: ${n} bản ghi mới`, 'ok');
```

with:

```js
      const { added, skipped } = await syncFuturesIncome(bn, state.futures, startT, (m) => { futBusy = m; if (current === 'futures') render(); });
      await ensureFuturesPrices();
      const names = skipped.map((s) => (s.src === 'um' ? 'USDⓈ-M' : 'COIN-M')).join(', ');
      if (skipped.length === 2 && skipped.every((s) => s.status === 401 || s.status === 403)) {
        toast('Không đọc được Futures: API key chưa bật quyền đọc Futures', 'error', 8000);
      } else if (skipped.length) {
        toast(`Futures: ${added} bản ghi mới · bỏ qua ${names} (chưa mở tài khoản hoặc key thiếu quyền)`, 'info', 8000);
      } else {
        toast(`Futures: ${added} bản ghi mới`, 'ok');
      }
```

- [ ] **Step 4: `importFuturesCsv`.** Add `let failed = 0;` next to `let rows = 0;`; in the per-file `catch` add `failed++;` before the toast. Right after the `for` loop add:

```js
    if (failed === files.length) return; // mọi file đều lỗi: đã báo từng file, không báo tổng kiểu thành công
```

Replace `await ensureFuturesPrices().catch(() => {});` with:

```js
    await ensureFuturesPrices().catch(() => toast('Chưa tải được giá lịch sử — lãi/lỗ COIN-M có thể chưa đúng, thử lại sau', 'info', 7000));
```

- [ ] **Step 5: `clearFutures`.** After its final `render();` add `toast('Đã xóa lịch sử futures', 'ok');`.

- [ ] **Step 6: `refreshCrypto`.** Replace `const { holdings, futures } = await fetchHoldings();` with `const { holdings, futures, missing } = await fetchHoldings();` and replace `if (!quiet) toast('Đã cập nhật số dư Binance', 'ok');` with:

```js
      if (!quiet && missing.length) toast(`Đã cập nhật số dư Binance — chưa lấy được: ${missing.join(', ')}`, 'info', 8000);
      else if (!quiet) toast('Đã cập nhật số dư Binance', 'ok');
```

- [ ] **Step 7: `refreshQuotes`.** Replace `if (!hasAuth()) return;` (inside `refreshQuotes`) with:

```js
    if (!hasAuth()) { if (showToast) toast('Nhập mật khẩu ứng dụng trong tab Cài đặt trước', 'error'); return; }
```

- [ ] **Step 8: Lock screen.** Replace:

```js
    btn.disabled = true;
    const ok = await login(f.get('pw'), f.get('otp') || '').catch(() => false);
    btn.disabled = false;
    if (!ok) return toast(otp ? 'Sai mật khẩu hoặc mã xác thực 2 bước' : 'Sai mật khẩu ứng dụng', 'error');
    await ctx.loadServerConfig();
    unlock();
  };
```

with:

```js
    btn.disabled = true;
    let ok;
    try {
      ok = await login(f.get('pw'), f.get('otp') || '');
    } catch (err) {
      btn.disabled = false;
      return toast(err.message, 'error'); // mất mạng / server lỗi — không phải sai mật khẩu
    }
    btn.disabled = false;
    if (!ok) return toast(otp ? 'Sai mật khẩu hoặc mã xác thực 2 bước' : 'Sai mật khẩu ứng dụng', 'error');
    await ctx.loadServerConfig();
    unlock();
    toast('Đã đăng nhập', 'ok');
  };
```

and in the `#lock-wipe` handler replace the two lines `await wipeDevice();` / `location.reload();` with:

```js
    await wipeDevice();
    flashAfterReload('Đã xóa dữ liệu trên thiết bị này'); // sau wipeDevice (hàm này xóa sessionStorage)
    location.reload();
```

- [ ] **Step 9: Flash after splash.** In `hideSplash`, replace `setTimeout(() => { sp.remove(); document.body.classList.remove('app-enter'); }, 700);` with `setTimeout(() => { sp.remove(); document.body.classList.remove('app-enter'); showFlash(); }, 700);`.

- [ ] **Step 10: Storage-full warning.** At the very start of `async function init() {` (before `await loadState();`) add:

```js
  let saveWarned = false; // báo 1 lần mỗi phiên
  window.addEventListener('fin:save-failed', () => {
    if (saveWarned) return;
    saveWarned = true;
    toast('Không lưu được vào máy (bộ nhớ trình duyệt đầy). Hãy Xuất JSON để sao lưu.', 'error', 12000);
  });
```

- [ ] **Step 11: Sync pill busy state.** Replace:

```js
  $('#sync-status').onclick = async () => {
    if (!sync.syncEnabled()) return go('settings');
    try {
      const r = await ctx.smartSync();
      toast({ pulled: 'Đã nhận dữ liệu từ cloud', pushed: 'Đã tải lên cloud', merged: 'Đã gộp dữ liệu 2 bên', same: 'Đã đồng bộ' }[r], 'ok');
    } catch (e) {
      toast(`Sync: ${e.message}`, 'error');
    }
  };
```

with:

```js
  $('#sync-status').onclick = async () => {
    if (!sync.syncEnabled()) return go('settings');
    const pill = $('#sync-status');
    if (pill.disabled) return;
    pill.disabled = true;
    pill.classList.add('busy'); // đang đồng bộ: mờ nút, không cho bấm lần nữa
    try {
      const r = await ctx.smartSync();
      toast({ pulled: 'Đã nhận dữ liệu từ cloud', pushed: 'Đã tải lên cloud', merged: 'Đã gộp dữ liệu 2 bên', same: 'Đã đồng bộ' }[r], 'ok');
    } catch (e) {
      toast(`Sync: ${e.message}`, 'error');
    }
    pill.disabled = false;
    pill.classList.remove('busy');
  };
```

- [ ] **Step 12:** `node --check js/app.js` — expect no output.

---

### Task 5: `js/views/settings.js`

**Files:** Modify `js/views/settings.js` only.

- [ ] **Step 1: Login form.** Replace:

```js
    const ok = await login(f.get('pw'), f.get('otp') || '').catch(() => false);
    await ctx.loadServerConfig();
    toast(ok ? 'Đã đăng nhập' : ctx.serverConfig().totpRequired ? 'Sai mật khẩu hoặc mã xác thực 2 bước' : 'Mật khẩu sai hoặc server chưa cấu hình', ok ? 'ok' : 'error');
```

with:

```js
    let ok;
    try {
      ok = await login(f.get('pw'), f.get('otp') || '');
    } catch (err) {
      return toast(err.message, 'error'); // mất mạng / server lỗi — không phải sai mật khẩu
    }
    await ctx.loadServerConfig();
    toast(ok ? 'Đã đăng nhập' : ctx.serverConfig().totpRequired ? 'Sai mật khẩu hoặc mã xác thực 2 bước' : 'Sai mật khẩu ứng dụng', ok ? 'ok' : 'error');
```

- [ ] **Step 2: Logout.** In the `#pw-logout` listener, after `ctx.rerender();` add `toast('Đã đăng xuất', 'ok');`.

- [ ] **Step 3: `run` wrapper.** Replace:

```js
  const run = (fn, ok) => async () => {
    try {
      const r = await fn();
      if (ok) toast(typeof ok === 'function' ? ok(r) : ok, 'ok');
    } catch (err) {
      toast(err.message, 'error', 7000);
    }
    ctx.rerender();
  };
```

with:

```js
  // fn trả về false = người dùng đã hủy (bấm Hủy ở hộp xác nhận) → không báo gì
  const run = (fn, ok) => async (e) => {
    const btn = e?.currentTarget;
    if (btn) btn.disabled = true; // khóa nút trong lúc chạy, tránh bấm 2 lần
    try {
      const r = await fn();
      if (ok && r !== false) toast(typeof ok === 'function' ? ok(r) : ok, 'ok');
    } catch (err) {
      toast(err.message, 'error', 7000);
    }
    if (btn) btn.disabled = false;
    ctx.rerender();
  };
```

- [ ] **Step 4: Confirm before overwriting.** Replace `bind('#sy-push', run(() => sync.push(), 'Đã ghi đè lên cloud'));` with:

```js
  bind('#sy-push', run(() => (confirm('Dữ liệu trên cloud sẽ bị thay bằng dữ liệu trên máy này. Tiếp tục?') ? sync.push() : false), 'Đã ghi đè lên cloud'));
```

In `#sy-pull` change `if (!confirm('Dữ liệu trên máy này sẽ bị thay bằng dữ liệu trên cloud. Tiếp tục?')) return;` so that it ends with `return false;`.

- [ ] **Step 5: Auto-sync checkbox.** Replace `if (auto) auto.onchange = () => { local.autoSync = auto.checked; saveLocal(); };` with:

```js
  if (auto) auto.onchange = () => {
    local.autoSync = auto.checked;
    saveLocal();
    toast(auto.checked ? 'Đã bật tự động đồng bộ' : 'Đã tắt tự động đồng bộ', 'ok');
  };
```

- [ ] **Step 6: Export / import / clear.** Replace the `#bk-export` handler body with:

```js
    const name = `finance-portfolio-${todayKey()}.json`;
    downloadFile(name, JSON.stringify({ app: 'finance-dashboard', exportedAt: Date.now(), state }));
    toast(`Đã xuất file ${name}`, 'ok');
```

Replace the whole `#bk-import` handler with:

```js
  root.querySelector('#bk-import').onchange = async (e) => {
    const input = e.target;
    const file = input.files[0];
    if (!file) return;
    if (!confirm('Dữ liệu trên máy này sẽ bị thay bằng dữ liệu trong file. Tiếp tục?')) { input.value = ''; return; }
    try {
      replaceState(sync.parsePayload(await file.text()));
      commit({ edit: true });
      ctx.afterStateReplaced();
      toast('Đã nhập dữ liệu', 'ok');
    } catch (err) {
      toast(err instanceof SyntaxError ? 'File không phải JSON hợp lệ' : err.message, 'error');
    }
    input.value = ''; // chọn lại đúng file đó lần sau vẫn chạy
  };
```

In `#bk-clear-history` after `ctx.afterStateReplaced();` add `toast('Đã xóa lịch sử Binance', 'ok');`. In `#bk-reset` after `ctx.afterStateReplaced();` add `toast('Đã xóa toàn bộ dữ liệu trên máy này', 'ok');`.

- [ ] **Step 7:** `node --check js/views/settings.js` — expect no output.

---

### Task 6: `js/views/overview.js` (goal, cash, debts)

**Files:** Modify `js/views/overview.js` only (bind section near the end).

- [ ] **Step 1: Goal.** In `#goal-del` after `ctx.rerender();` add `toast('Đã xóa mục tiêu', 'ok');`. In `goalForm.onsubmit` after `ctx.rerender();` add `toast('Đã lưu mục tiêu', 'ok');`.

- [ ] **Step 2: Add cash account.** Replace:

```js
    const c = { id: uid(), name: f.get('name'), currency: f.get('currency') };
```

with:

```js
    const name = String(f.get('name') || '').trim();
    if (!name) return toast('Nhập tên', 'error');
    const c = { id: uid(), name, currency: f.get('currency') };
```

and after that handler's `ctx.rerender();` add ``toast(`Đã thêm ${name}`, 'ok');``.

- [ ] **Step 3: Edit cash balance.** In `[data-edit-cash]` replace `if (v == null) return;` with `if (v == null || !String(v).trim()) return; // Hủy hoặc để trống → không đổi` and after its `ctx.rerender();` add ``toast(`Đã cập nhật số dư ${c.name}`, 'ok');``.

- [ ] **Step 4: Delete cash with undo.** Replace the `[data-del-cash]` handler body:

```js
    btn.onclick = () => {
      state.cash = state.cash.filter((c) => c.id !== btn.dataset.delCash);
      commit({ edit: true });
      ctx.rerender();
    };
```

with:

```js
    btn.onclick = () => {
      const i = state.cash.findIndex((c) => c.id === btn.dataset.delCash);
      if (i < 0) return;
      const [c] = state.cash.splice(i, 1);
      commit({ edit: true });
      ctx.rerender();
      toast(`Đã xóa ${c.name}`, 'ok', {
        action: {
          label: 'Hoàn tác',
          run: () => {
            state.cash.splice(Math.min(i, state.cash.length), 0, c);
            commit({ edit: true });
            ctx.rerender();
            toast(`Đã khôi phục ${c.name}`, 'ok');
          },
        },
      });
    };
```

- [ ] **Step 5: Debts.** In `#debt-form` replace:

```js
    b.debts.push({
      id: uid(), name: f.name.trim(), balance: Number(f.balance) || 0, monthly: Number(f.monthly) || 0,
      rate: Number(f.rate) || 0, currency: f.currency,
    });
    saveDebts();
```

with:

```js
    const name = String(f.name || '').trim();
    if (!name) return toast('Nhập tên', 'error');
    b.debts.push({
      id: uid(), name, balance: Number(f.balance) || 0, monthly: Number(f.monthly) || 0,
      rate: Number(f.rate) || 0, currency: f.currency,
    });
    saveDebts();
    toast(`Đã thêm khoản nợ ${name}`, 'ok');
```

In `[data-edit-debt]` replace:

```js
      if (v == null) return;
      if (!Number.isFinite(Number(v))) return toast('Số không hợp lệ', 'error');
      d.balance = Number(v);
      saveDebts();
```

with:

```js
      if (v == null || !String(v).trim()) return; // Hủy hoặc để trống → không đổi
      const n = d.currency === 'VND' ? parseAmount(v) : Number(String(v).replace(',', '.'));
      if (!Number.isFinite(n)) return toast('Số không hợp lệ', 'error');
      d.balance = n;
      saveDebts();
      toast(`Đã cập nhật dư nợ ${d.name}`, 'ok');
```

In `[data-del-debt]` replace:

```js
      b.debts = b.debts.filter((x) => x.id !== btn.dataset.delDebt);
      saveDebts();
```

with:

```js
      const d = b.debts.find((x) => x.id === btn.dataset.delDebt);
      b.debts = b.debts.filter((x) => x.id !== btn.dataset.delDebt);
      saveDebts();
      if (d) toast(`Đã xóa khoản nợ ${d.name}`, 'ok');
```

- [ ] **Step 6:** `node --check js/views/overview.js` — expect no output.

---

### Task 7: `js/views/stocks.js`

**Files:** Modify `js/views/stocks.js` only.

- [ ] **Step 1: Busy price button.** Replace `root.querySelector('#st-quotes').onclick = () => ctx.refreshQuotes(true);` with:

```js
  root.querySelector('#st-quotes').onclick = (e) => {
    e.currentTarget.disabled = true; // vẽ lại khi xong sẽ mở lại nút
    ctx.refreshQuotes(true);
  };
```

- [ ] **Step 2: Fund form.** Before `if (data.source === 'yahoo' && ex?.source !== 'yahoo') {` add `let told = false; // đã có thông báo riêng (chuyển nguồn) thì không báo thêm`. After `if (q?.currency && ['USD', 'VND'].includes(q.currency)) data.currency = q.currency;` add:

```js
      if (q === undefined) toast(`Chưa kiểm tra được giá của ${ticker} — sẽ thử lại khi làm mới giá`, 'info', 7000);
```

Inside `if (q === null) {` add `told = true;` as its first line. After `ctx.rerender();` in this handler (before the `if (needNav)` line) add:

```js
    if (!told) toast(ex ? `Đã lưu mã ${ticker}` : `Đã thêm mã ${ticker}`, 'ok');
```

- [ ] **Step 3: Transaction form validation + success.** Replace:

```js
    const units = Number(f.units) * (f.side === 'sell' ? -1 : 1);
    state.stocks.txs.push({ id: uid(), ticker: f.ticker, date: f.date, units, price: Number(f.price), fee: Number(f.fee) || 0 });
    commit({ edit: true });
    ctx.rerender();
```

with:

```js
    const qty = Number(f.units);
    const price = Number(f.price);
    if (!(qty > 0)) return toast('Số lượng phải lớn hơn 0', 'error');
    if (!(price > 0)) return toast('Giá phải lớn hơn 0', 'error');
    if (f.side === 'sell') {
      const held = state.stocks.txs.filter((t) => t.ticker === f.ticker).reduce((a, t) => a + t.units, 0);
      if (qty > held + 1e-9) return toast(`Chỉ đang giữ ${fmtQty(held)} ${f.ticker}`, 'error');
    }
    const units = qty * (f.side === 'sell' ? -1 : 1);
    state.stocks.txs.push({ id: uid(), ticker: f.ticker, date: f.date, units, price, fee: Number(f.fee) || 0 });
    commit({ edit: true });
    ctx.rerender();
    toast(`Đã thêm giao dịch ${f.side === 'sell' ? 'bán' : 'mua'} ${f.ticker}`, 'ok');
```

- [ ] **Step 4: Delete fund.** In `[data-del]` after `ctx.rerender();` add ``toast(`Đã xóa ${t}`, 'ok');``.

- [ ] **Step 5: Delete transaction with undo.** Replace the `[data-del-tx]` handler body:

```js
    b.onclick = () => {
      state.stocks.txs = state.stocks.txs.filter((x) => x.id !== b.dataset.delTx);
      commit({ edit: true });
      ctx.rerender();
    };
```

with:

```js
    b.onclick = () => {
      const i = state.stocks.txs.findIndex((x) => x.id === b.dataset.delTx);
      if (i < 0) return;
      const [tx] = state.stocks.txs.splice(i, 1);
      commit({ edit: true });
      ctx.rerender();
      toast(`Đã xóa giao dịch ${tx.ticker}`, 'ok', {
        action: {
          label: 'Hoàn tác',
          run: () => {
            state.stocks.txs.splice(Math.min(i, state.stocks.txs.length), 0, tx);
            commit({ edit: true });
            ctx.rerender();
            toast('Đã khôi phục giao dịch', 'ok');
          },
        },
      });
    };
```

- [ ] **Step 6:** `node --check js/views/stocks.js` — expect no output.

---

### Task 8: English translations

**Files:** Modify `js/i18n.js`, `tests/i18n.test.js`.

- [ ] **Step 1: Failing test.** Append inside the first test in `tests/i18n.test.js` (`'dịch câu cố định, câu có số và tên danh mục'`):

```js
  assert.equal(tr('Hoàn tác'), 'Undo');
  assert.equal(tr('Đã xóa giao dịch VOO'), 'Deleted VOO transaction');
  assert.equal(tr('Đã thêm giao dịch bán VOO'), 'Added sell transaction for VOO');
  assert.equal(tr('Futures: 3 bản ghi mới · bỏ qua COIN-M (chưa mở tài khoản hoặc key thiếu quyền)'), 'Futures: 3 new records · skipped COIN-M (account not opened or key lacks permission)');
  assert.equal(tr('Đã xóa Vietcombank'), 'Deleted Vietcombank');
  assert.equal(tr('Server lỗi (HTTP 502)'), 'Server error (HTTP 502)');
```

Run `node --test tests/i18n.test.js` — expect FAIL.

- [ ] **Step 2: EXACT entries.** Add to the `EXACT` object (before its closing `};`):

```js
  // thông báo thao tác
  'Hoàn tác': 'Undo', 'Đã hoàn tác': 'Undone', 'Nhập tên': 'Enter a name',
  'Không lưu được vào máy (bộ nhớ trình duyệt đầy). Hãy Xuất JSON để sao lưu.': "Couldn't save on this device (browser storage is full). Export JSON to back up.",
  'Đã xóa dữ liệu trên thiết bị này': 'Data on this device deleted',
  'Không tìm thấy điều chỉnh này — có thể đã được hoàn tác': 'Adjustment not found — it may already be undone',
  'Không đọc được Futures: API key chưa bật quyền đọc Futures': "Can't read Futures: the API key doesn't have Futures read permission",
  'Chưa tải được giá lịch sử — lãi/lỗ COIN-M có thể chưa đúng, thử lại sau': "Couldn't load price history — COIN-M P&L may be off, try again later",
  'Đã xóa lịch sử futures': 'Futures history deleted',
  'Dữ liệu trên cloud sẽ bị thay bằng dữ liệu trên máy này. Tiếp tục?': 'Cloud data will be replaced with the data on this device. Continue?',
  'Dữ liệu trên máy này sẽ bị thay bằng dữ liệu trong file. Tiếp tục?': "This device's data will be replaced with the file's data. Continue?",
  'Đã bật tự động đồng bộ': 'Auto sync on', 'Đã tắt tự động đồng bộ': 'Auto sync off', 'Đã đăng xuất': 'Signed out',
  'File không phải JSON hợp lệ': 'The file is not valid JSON',
  'Đã xóa lịch sử Binance': 'Binance history deleted', 'Đã xóa toàn bộ dữ liệu trên máy này': 'All data on this device deleted',
  'Đã xóa mục tiêu': 'Goal deleted', 'Đã lưu mục tiêu': 'Goal saved',
  'Số lượng phải lớn hơn 0': 'Quantity must be greater than 0', 'Giá phải lớn hơn 0': 'Price must be greater than 0',
  'Đã khôi phục giao dịch': 'Transaction restored',
```

- [ ] **Step 3: RULES.** Append at the end of the `RULES` array (after the `// lỗi` entries, before `];`). Specific rules must stay above the generic `Đã thêm` / `Đã xóa` / `Đã khôi phục` ones (rules apply in order):

```js
  // thông báo thao tác (cụ thể trước, chung sau)
  [/^Server lỗi \(HTTP (\d+)\)$/, 'Server error (HTTP $1)'],
  [/^Đã bỏ (\S+) (\S+) khỏi lịch sử$/, 'Removed $1 $2 from history'],
  [/^Futures: (\d+) bản ghi mới · bỏ qua (.+) \(chưa mở tài khoản hoặc key thiếu quyền\)$/, 'Futures: $1 new records · skipped $2 (account not opened or key lacks permission)'],
  [/^Đã cập nhật số dư Binance — chưa lấy được: (.+)$/, "Binance balances updated — couldn't load: $1"],
  [/^Đã xuất file (.+)$/, 'Exported $1'],
  [/^Đã cập nhật số dư (.+)$/, 'Updated balance of $1'],
  [/^Đã cập nhật dư nợ (.+)$/, 'Updated debt balance of $1'],
  [/^Đã thêm khoản nợ (.+)$/, 'Added debt $1'],
  [/^Đã xóa khoản nợ (.+)$/, 'Deleted debt $1'],
  [/^Đã thêm mã (.+)$/, 'Added $1'],
  [/^Đã lưu mã (.+)$/, 'Saved $1'],
  [/^Chưa kiểm tra được giá của (.+) — sẽ thử lại khi làm mới giá$/, "Couldn't check the price of $1 — will retry on the next price refresh"],
  [/^Chỉ đang giữ (.+)$/, 'You only hold $1'],
  [/^Đã thêm giao dịch (mua|bán) (.+)$/, (m, s, t) => `Added ${s === 'mua' ? 'buy' : 'sell'} transaction for ${t}`],
  [/^Đã xóa giao dịch (.+)$/, 'Deleted $1 transaction'],
  [/^Đã khôi phục (.+)$/, 'Restored $1'],
  [/^Đã thêm (.+)$/, 'Added $1'],
  [/^Đã xóa (.+)$/, 'Deleted $1'],
```

- [ ] **Step 4: Run** `node --test tests/i18n.test.js` — expect PASS.

---

### Task 9: Verify, commit, push

- [ ] **Step 1:** `npm test` — all pass (existing + new).
- [ ] **Step 2: Browser check** (dev server, phone width 375px): toast look (icon, colours, tap to close, max 3); Cài đặt → bật/tắt tự động đồng bộ, Xuất JSON, Nhập JSON → Hủy (no change, no toast); Tổng quan → thêm tài khoản tiền mặt, sửa số dư (để trống = không đổi), xóa → Hoàn tác khôi phục; Chứng khoán → bán quá số đang giữ → lỗi; xóa giao dịch → Hoàn tác; English spot-check of 2–3 toasts.
- [ ] **Step 3: Commit** (coordinator):

```bash
git add js css tests
git commit -m "Report success or failure for every data and network action"
```

- [ ] **Step 4: Push** `git push origin main`.
