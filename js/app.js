import { state, local, loadState, commit, onCommit, takeSnapshot, authHeaders, hasAuth, migrateAuth, login, wipeDevice } from './store.js';
import { fetchHoldings, syncHistory, getPriceHistory, bn, ensurePriceHistory, fetchTickerPrices, ensureAllPriceHistory } from './binance.js';
import { computeFutures, syncFuturesIncome, csvToIncome, mergeIncome, emptyFutures, detectOffsetHours, shiftRecords, fileNameOffsetHours } from './futures.js';
import { makePriceLookup } from './pnl.js';
import { computePnl, buildEvents } from './pnl.js';
import { cryptoSeries, stockSeries, reconcileWithWallet } from './series.js';
import { totals, fxRate, toUSD, fundPrice } from './calc.js';
import * as sync from './sync.js';
import { captureDrafts, restoreDrafts, isTyping, $, $$, toast, setDisplayCurrency, isStable, esc, isPrivate, setPrivate } from './util.js';
import { icon } from './icons.js';
import { tr, translateDom, setLang, getLang } from './i18n.js';
import { loadPalette, setChartAnimation } from './charts.js';
import { tabOrder, groupOf, lastSub, rememberSub, visibleSubs, BOTTOM_MAX } from './nav.js';
import { renderOverview } from './views/overview.js';
import { renderCrypto } from './views/crypto.js';
import { renderPnl, updateProgress } from './views/pnl.js';
import { renderStocks } from './views/stocks.js';
import { renderSettings } from './views/settings.js';
import { renderFutures } from './views/futures.js';
import { renderBudget } from './views/budget.js';
import { generateRecurring, setAnchor } from './budget.js';

const VIEWS = {
  overview: renderOverview,
  budget: renderBudget,
  crypto: renderCrypto,
  pnl: renderPnl,
  futures: renderFutures,
  stocks: renderStocks,
  settings: renderSettings,
};

let current = 'overview';
let serverCfg = { offline: true };
let priceHist = {};
let pnlCache = null;
let futCache = null;
let futBusy = '';
let syncing = { running: false, pct: 0, msg: '' };
let abort = null;
// Giá đóng cửa lịch sử của mã CK (Yahoo) — chỉ lưu trên máy, không sync: { ticker: { at, rows: [[ms, close]] } }
let histTriedAt = 0;
let stockHist = (() => { try { return JSON.parse(localStorage.getItem('fin.stockHist') || '{}'); } catch { return {}; } })();

// ================= Actions =================

const ctx = {
  rerender: () => render(true), // thao tác của người dùng → vẽ ngay
  serverConfig: () => serverCfg,
  syncState: () => syncing,

  pnl() {
    const hasHistory = Object.keys(state.history.trades).length || state.history.deposits.length;
    if (!hasHistory) return null;
    pnlCache ||= computePnl(state.history, priceHist, state.crypto.holdings, { dustUsd: Number(state.settings.dustUsd) || 1 });
    return pnlCache;
  },
  invalidatePnl() { pnlCache = null; futCache = null; },

  /** Bỏ phần coin mà lịch sử có nhưng ví không có (coi như đã rời ví, không lãi/lỗ). */
  dropGap(asset) {
    const h = state.crypto.holdings.find((x) => x.asset === asset);
    const held = h ? h.total - (h.futures || 0) : 0;
    const { events } = buildEvents(state.history, makePriceLookup(priceHist));
    const fix = reconcileWithWallet(events.filter((e) => e.asset === asset), new Map([[asset, held]]))
      .find((e) => e.ref?.reconcile && e.qty < 0);
    if (!fix) return toast('Không còn phần dư để bỏ', 'info');
    const qty = -fix.qty;
    if (!confirm(`Bỏ ${qty.toPrecision(6)} ${asset} khỏi lịch sử (coi như đã rời ví từ ${new Date(fix.t).toISOString().slice(0, 10)}, không tính lãi/lỗ)?`)) return;
    (state.history.adjust ||= []).push([`adj:${asset}:${Date.now()}`, fix.t, asset, qty]);
    pnlCache = null;
    commit({ edit: true });
    render();
  },

  undoAdjust(id) {
    const r = (state.history.adjust || []).find((x) => x[0] === id);
    if (!r) return;
    r[4] = 'x';
    pnlCache = null;
    commit({ edit: true });
    render();
  },
  /** Giá trị coin & vốn theo ngày, dựng lại từ lịch sử (cache cùng PnL). */
  cryptoSeries() {
    const p = ctx.pnl();
    if (!p) return [];
    // Chưa đối chiếu với ví: coin bị hủy niêm yết / sập khi đang giữ làm việc "bù" cho khớp ví bị sai.
    p.series ||= cryptoSeries(state.history, priceHist);
    return p.series;
  },

  /** Giá USD đóng cửa của coin vào ngày chứa thời điểm t (null nếu chưa có giá lịch sử). */
  priceAt: (asset, t) => makePriceLookup(priceHist)(asset, t),

  futuresBusy: () => futBusy,
  futuresPnl() {
    if (!state.futures.income.length && !state.futures.account?.positions?.length) return null;
    if (!futCache) {
      const prices = Object.fromEntries(state.crypto.holdings.map((h) => [h.asset, h.price]));
      futCache = computeFutures(state.futures, makePriceLookup(priceHist), state.futures.account, (a) => prices[a] || 0);
    }
    return futCache;
  },

  async syncFutures() {
    if (futBusy) return;
    if (!hasAuth()) { toast('Nhập mật khẩu ứng dụng trong tab Cài đặt trước', 'error'); return; }
    futBusy = 'Đang tải lịch sử futures…';
    render();
    try {
      const startT = Date.parse(state.settings.historyStart) || Date.parse('2019-09-01');
      const n = await syncFuturesIncome(bn, state.futures, startT, (m) => { futBusy = m; if (current === 'futures') render(); });
      await ensureFuturesPrices();
      toast(`Futures: ${n} bản ghi mới`, 'ok');
    } catch (e) {
      toast(`Futures: ${e.message}`, 'error', 8000);
    }
    futBusy = '';
    futCache = null;
    commit();
    render();
  },

  async importFuturesCsv(files) {
    let added = 0;
    let rows = 0;
    for (const file of files) {
      try {
        const parsed = csvToIncome(await file.text()).records;
        // Múi giờ: ưu tiên ghi trên tên file (Binance đặt kiểu "...UTC+7..."), không có thì tự dò
        const tz = fileNameOffsetHours(file.name) || detectOffsetHours(state.futures, parsed);
        if (tz) toast(`${file.name}: phát hiện giờ UTC${tz > 0 ? '+' : ''}${tz}, đã quy về UTC`, 'info', 6000);
        const records = shiftRecords(parsed, tz);
        rows += records.length;
        added += mergeIncome(state.futures, records);
      } catch (e) {
        toast(`${file.name}: ${e.message}`, 'error', 8000);
      }
    }
    futBusy = 'Tải giá lịch sử…';
    render();
    await ensureFuturesPrices().catch(() => {});
    futBusy = '';
    futCache = null;
    commit();
    toast(`Đã nhập ${added} bản ghi futures mới (${rows - added} trùng / đã có)`, added ? 'ok' : 'info', 6000);
    render();
  },

  clearFutures() {
    if (!confirm('Xóa toàn bộ lịch sử futures đã tải / nhập?')) return;
    state.futures = { ...emptyFutures(), account: state.futures.account, resetAt: Date.now() };
    futCache = null;
    commit();
    render();
  },

  async loadServerConfig() {
    try {
      const r = await fetch('/api/config', { headers: { ...authHeaders() } });
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error();
      serverCfg = await r.json();
    } catch {
      serverCfg = { offline: true };
    }
    Object.assign(sync.publicConfig, { dropboxAppKey: serverCfg.dropboxAppKey || '', googleClientId: serverCfg.googleClientId || '' });
  },

  async refreshCrypto({ quiet = false } = {}) {
    if (!hasAuth()) {
      if (!quiet) { toast('Nhập mật khẩu ứng dụng trong tab Cài đặt trước', 'error'); go('settings'); }
      return;
    }
    document.body.classList.add('is-refreshing'); // khung mờ nhấp nháy trên các ô số trong lúc tải
    try {
      const { holdings, futures } = await fetchHoldings();
      state.crypto = { holdings, updatedAt: Date.now() };
      if (futures?.ok) state.futures.account = futures;
      pnlCache = null;
      futCache = null;
      snapshot();
      commit();
      if (!quiet) toast('Đã cập nhật số dư Binance', 'ok');
    } catch (e) {
      toast(`Binance: ${e.message}`, 'error', 8000);
    }
    document.body.classList.remove('is-refreshing');
    render();
  },

  /** Giá trị & vốn danh mục CK theo ngày (giao dịch tự nhập + giá lịch sử Yahoo). */
  stockSeries() {
    const hist = Object.fromEntries(Object.entries(stockHist).map(([t, h]) => [t, h.rows]));
    return stockSeries(state.stocks.funds, state.stocks.txs, hist, { toUSD, priceOf: fundPrice });
  },

  async refreshStockHistory() {
    const stale = state.stocks.funds.filter((f) => f.source !== 'manual'
      && state.stocks.txs.some((t) => t.ticker === f.ticker)
      && Date.now() - (stockHist[f.ticker]?.at || 0) > 12 * 3600e3);
    if (!stale.length || !hasAuth() || Date.now() - histTriedAt < 60e3) return;
    histTriedAt = Date.now();
    try {
      const r = await fetch(`/api/quote?history=5y&symbols=${encodeURIComponent(stale.map((f) => f.ticker).join(','))}`, {
        headers: authHeaders(),
      });
      const data = await r.json();
      if (!r.ok) return;
      for (const f of stale) stockHist[f.ticker] = { at: Date.now(), rows: data.history?.[f.ticker] || stockHist[f.ticker]?.rows || [] };
      try { localStorage.setItem('fin.stockHist', JSON.stringify(stockHist)); } catch { /* đầy bộ nhớ thì thôi */ }
      if (current === 'stocks') render();
    } catch { /* bỏ qua, lần sau thử lại */ }
  },

  /** Hỏi Yahoo giá 1 mã. Trả về quote, null nếu Yahoo không có mã này, undefined nếu không hỏi được (mất mạng…). */
  async checkQuote(symbol) {
    if (!hasAuth()) return undefined;
    try {
      const r = await fetch(`/api/quote?symbols=${encodeURIComponent(symbol)}`, { headers: authHeaders() });
      if (!r.ok) return undefined;
      const data = await r.json();
      if (data.quotes?.[symbol]) return data.quotes[symbol];
      // chỉ coi là "không có mã" khi Yahoo nói rõ vậy; lỗi tạm thời (429, 5xx) thì không kết luận
      return /not found|delisted|no data|HTTP 404/i.test(data.errors?.[symbol] || '') ? null : undefined;
    } catch { return undefined; }
  },

  async refreshQuotes(showToast = false) {
    const funds = state.stocks.funds.filter((f) => f.source !== 'manual');
    if (!hasAuth()) return;
    const symbols = [...funds.map((f) => f.ticker), 'VND=X'];
    try {
      const r = await fetch(`/api/quote?symbols=${encodeURIComponent(symbols.join(','))}`, {
        headers: authHeaders(),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.status);
      for (const f of funds) {
        const q = data.quotes[f.ticker];
        if (q) Object.assign(f, { lastPrice: q.price, prevClose: q.prevClose, lastPriceAt: Date.now(), name: f.name || q.name });
      }
      if (data.quotes['VND=X']) state.fx = { USDVND: data.quotes['VND=X'].price, updatedAt: Date.now() };
      const errs = Object.keys(data.errors || {}).filter((s) => s !== 'VND=X');
      snapshot();
      commit();
      ctx.refreshStockHistory();
      if (errs.length) toast(`Không lấy được giá: ${errs.join(', ')}`, 'error', 7000);
      else if (showToast) toast('Đã cập nhật giá', 'ok');
    } catch (e) {
      if (showToast) toast(`Lỗi lấy giá: ${e.message}`, 'error');
    }
    render();
  },

  async syncHistory(fullScan) {
    if (syncing.running) return;
    if (!hasAuth()) { toast('Nhập mật khẩu ứng dụng trong tab Cài đặt trước', 'error'); return; }
    abort = new AbortController();
    syncing = { running: true, pct: 0, msg: 'Bắt đầu…' };
    render();
    try {
      if (!state.crypto.holdings.length) await ctx.refreshCrypto({ quiet: true });
      const { newTrades } = await syncHistory({
        fullScan,
        signal: abort.signal,
        onProgress: (msg, pct) => {
          syncing.msg = msg;
          if (pct != null) syncing.pct = pct;
          if (current === 'pnl') updateProgress($('#tab-pnl'), syncing);
        },
      });
      priceHist = await getPriceHistory();
      toast(`Đồng bộ xong — ${newTrades} lệnh mới`, 'ok');
      syncing = { running: false, pct: 100, msg: 'Hoàn tất' };
    } catch (e) {
      const msg = e.name === 'AbortError' ? 'Đã hủy (dữ liệu đã tải vẫn được giữ)' : `Lỗi: ${e.message}`;
      toast(msg, e.name === 'AbortError' ? 'info' : 'error', 8000);
      syncing = { running: false, pct: 0, msg };
      priceHist = await getPriceHistory();
    }
    pnlCache = null;
    commit();
    render();
  },
  cancelSync() { abort?.abort(); },
  rebuildNav() { buildNav(); render(); },

  // ---- giao diện: bảng màu, chế độ sáng/tối, ngôn ngữ (lưu riêng từng thiết bị)
  palette: () => palette(),
  mode: () => theme(),
  lang: () => getLang(),
  setPalette(p) { setPalette(p); render(); },
  setMode(m) { setTheme(m); render(); },
  setLang(l) { setLang(l); buildNav(); render(); },

  async smartSync() {
    const r = await sync.smartSync();
    if (r === 'pulled' || r === 'merged') {
      ctx.afterStateReplaced();
      refreshPriceHistory();
    }
    updateSyncPill();
    return r;
  },

  afterStateReplaced() {
    runRecurring();
    pnlCache = null;
    futCache = null;
    applyCurrency();
    render();
  },
};

/** Giá lịch sử cho tài sản non-stable trong income futures (COIN-M, phí BNB…). */
async function ensureFuturesPrices() {
  const need = new Map();
  for (const r of state.futures.income) {
    const a = r[4];
    if (!isStable(a) && a !== 'BNFCR') need.set(a, Math.min(need.get(a) ?? Infinity, r[1]));
  }
  if (!need.size) return;
  const tick = await fetchTickerPrices();
  for (const [a, t] of need) await ensurePriceHistory(a, t, tick);
  priceHist = await getPriceHistory();
}

/** Tải giá lịch sử còn thiếu ở nền (vd máy mới vừa nhận lịch sử từ Dropbox), rồi tính lại PnL. */
let priceJob = null;
function refreshPriceHistory() {
  priceJob ||= ensureAllPriceHistory()
    .then(async (n) => {
      if (!n) return;
      priceHist = await getPriceHistory();
      pnlCache = null;
      futCache = null;
      render();
    })
    .catch(() => {})
    .finally(() => { priceJob = null; });
}

/** Thêm các khoản thu/chi định kỳ đến hạn (lương, hóa đơn…). */
function runRecurring() {
  let changed = false;
  // Tài khoản tạo trước khi có tính năng tự cộng/trừ: lấy số dư hiện tại làm mốc chốt
  for (const c of state.cash) if (!c.anchorAt) { setAnchor(c, Number(c.amount) || 0); changed = true; }
  if (state.budget && generateRecurring(state.budget)) changed = true;
  if (changed) commit();
}

function snapshot() {
  const t = totals();
  if (t.total > 0) takeSnapshot(t);
}

// ================= Render =================

function applyCurrency() {
  setDisplayCurrency(state.settings.displayCurrency, fxRate());
  $('#cur-select').value = state.settings.displayCurrency;
}

// ================= Màn hình khóa =================
// Chưa đăng nhập / phiên hết hạn → ẩn toàn bộ số liệu, chỉ hiện form đăng nhập, không đồng bộ.
const isLocked = () => !hasAuth();
let afterUnlock = null;

function renderLock() {
  document.body.classList.add('locked');
  $$('main .tab').forEach((t) => { t.innerHTML = ''; }); // gỡ hẳn số liệu khỏi trang, không chỉ ẩn
  const box = $('#lock');
  box.hidden = false;
  const otp = serverCfg.totpRequired;
  box.innerHTML = `
    <form class="card lock-card" id="lock-form">
      <div class="lock-logo">${document.querySelector('.brand .logo')?.innerHTML || ''}</div>
      <h2>iFinance đang khóa</h2>
      <p class="muted small">Đăng nhập để xem số liệu. Dữ liệu trên máy được ẩn cho tới khi đăng nhập.</p>
      <label>Mật khẩu ứng dụng<input name="pw" type="password" autocomplete="current-password" required autofocus></label>
      ${otp ? `<label>Mã xác thực 2 bước<input name="otp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="6 số" required></label>` : ''}
      <button class="btn primary">Đăng nhập</button>
      ${serverCfg.offline ? '<p class="small neg">Không kết nối được server — kiểm tra mạng rồi thử lại.</p>' : ''}
      <button type="button" class="link danger small" id="lock-wipe">Xóa dữ liệu trên thiết bị này</button>
    </form>`;
  translateDom(box);
  $('#lock-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector('button.primary');
    btn.disabled = true;
    const ok = await login(f.get('pw'), f.get('otp') || '').catch(() => false);
    btn.disabled = false;
    if (!ok) return toast(otp ? 'Sai mật khẩu hoặc mã xác thực 2 bước' : 'Sai mật khẩu ứng dụng', 'error');
    await ctx.loadServerConfig();
    unlock();
  };
  $('#lock-wipe').onclick = async () => {
    if (!confirm('Xóa toàn bộ dữ liệu của app trên thiết bị này? File trên cloud (Dropbox / Drive) không bị ảnh hưởng.')) return;
    await wipeDevice();
    location.reload();
  };
}

function unlock() {
  document.body.classList.remove('locked');
  $('#lock').hidden = true;
  $('#lock').innerHTML = '';
  const next = afterUnlock;
  afterUnlock = null;
  if (next) next();
  else render();
}

// Vẽ lại do tác vụ nền (đồng bộ, làm mới giá…) không được cướp focus khi đang gõ:
// hoãn tới khi rời ô nhập, và giữ nguyên nội dung đang nhập dở. Thao tác của người dùng (ctx.rerender) vẽ ngay.
let pendingRender = false;

function render(force = false) {
  if (!force && !isLocked() && isTyping()) { pendingRender = true; return; }
  pendingRender = false;
  const tab = document.querySelector('main .tab:not([hidden])');
  const drafts = force ? null : captureDrafts(tab);
  draw();
  if (drafts?.size) restoreDrafts(document.querySelector('main .tab:not([hidden])'), drafts);
}

document.addEventListener('focusout', () => {
  // chờ focus chuyển sang ô kế tiếp (vd bấm từ Số tiền sang Ghi chú) rồi mới kiểm tra
  setTimeout(() => { if (pendingRender && !isTyping()) render(); }, 200);
});

// ================= Màn hình chờ =================
// Hiện tối thiểu SPLASH_MIN; trong lúc đó tải xong lịch sử giá, Chart.js và lần đồng bộ đầu
// (tối đa SPLASH_MAX) để khi màn chờ tắt, giao diện đã ở trạng thái hoàn chỉnh — không nhảy, không khựng.
const SPLASH_MIN = 1500;
const SPLASH_MAX = 3500;
const startupGates = [];
let splashPlanned = false;
let splashRevealing = false; // đang mở màn: lần vẽ cuối được chạy hiệu ứng biểu đồ

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const syncGate = deferred();

function hideSplash() {
  const sp = document.getElementById('splash');
  if (!sp || splashPlanned) return;
  splashPlanned = true;
  const elapsed = performance.now();
  const ready = Promise.race([Promise.allSettled(startupGates), new Promise((r) => setTimeout(r, SPLASH_MAX - elapsed))]);
  const minWait = new Promise((r) => setTimeout(r, Math.max(0, SPLASH_MIN - elapsed)));
  Promise.all([ready, minWait]).then(() => {
    splashRevealing = true;
    render(); // vẽ bản cuối (có hiệu ứng biểu đồ) ngay trước khi lộ ra
    splashRevealing = false;
    sp.classList.add('out'); // logo + tên mờ dần
    setTimeout(() => {
      document.body.classList.add('app-enter'); // app phóng vào trong lúc nền màn chờ tan
      sp.classList.add('hide');
      setTimeout(() => { sp.remove(); document.body.classList.remove('app-enter'); }, 700);
    }, 300);
  });
}

let lastDrawn = null;

function draw() {
  hideSplash();
  if (isLocked()) return renderLock();
  // biểu đồ chỉ chạy hiệu ứng khi đổi tab (và lần hiện sau màn chờ), không phải khi dữ liệu cập nhật ngầm
  const splashOn = Boolean(document.getElementById('splash')) && !splashRevealing;
  setChartAnimation(splashRevealing || (!splashOn && current !== lastDrawn));
  lastDrawn = current;
  applyCurrency();
  loadPalette();
  if (current === 'futures' && state.settings.hideFutures) current = 'crypto'; // vd mở link #futures sau khi đã ẩn
  const group = groupOf(current);
  $$('#tabs button, #bottom-nav button, #more-panel button').forEach((b) => {
    b.classList.toggle('on', b.dataset.tab === group.id || (b.dataset.more === '1' && moreIds.includes(group.id)));
  });
  $('#page-title').textContent = tr(group.label);
  $('#fab').hidden = current === 'settings';
  $$('.tab').forEach((s) => { s.hidden = s.id !== `tab-${current}`; });
  try {
    const root = $(`#tab-${current}`);
    VIEWS[current](root, ctx);
    const subs = visibleSubs(group, state.settings);
    if (subs?.length > 1) {
      root.insertAdjacentHTML('afterbegin', `<div class="subnav seg">${subs.map((x) =>
        `<button data-sub="${x.id}" class="${x.id === current ? 'on' : ''}">${esc(x.label)}</button>`).join('')}</div>`);
      root.querySelectorAll('[data-sub]').forEach((b) => { b.onclick = () => go(b.dataset.sub); });
    }
    translateDom(root);
  } catch (e) {
    console.error(e);
    $(`#tab-${current}`).innerHTML = `<div class="alert">Lỗi hiển thị: ${e.message}</div>`;
  }
  updateSyncPill();
}

function go(tab) {
  $('#more-sheet').hidden = true;
  if (tab !== current) window.scrollTo({ top: 0 });
  current = VIEWS[tab] ? tab : 'overview';
  if (current === 'futures' && state.settings.hideFutures) current = 'crypto';
  rememberSub(groupOf(current).id, current);
  if (location.hash !== '#' + current) history.replaceState(null, '', '#' + current);
  render();
}

let moreIds = [];
/** Dựng thanh tab (máy tính), thanh dưới + "Thêm" (điện thoại) theo thứ tự người dùng chọn. */
function buildNav() {
  const order = tabOrder();
  const btn = (n) => `<button data-tab="${n.id}">${icon(n.icon)}<span>${esc(tr(n.short || n.label))}</span></button>`;
  $('#tabs').innerHTML = order.map((n) => `<button data-tab="${n.id}">${icon(n.icon)}<span>${esc(tr(n.label))}</span></button>`).join('');
  const bottom = order.length <= BOTTOM_MAX ? order : order.slice(0, BOTTOM_MAX - 1);
  const more = order.slice(bottom.length);
  moreIds = more.map((n) => n.id);
  $('#bottom-nav').style.gridTemplateColumns = `repeat(${bottom.length + (more.length ? 1 : 0)}, 1fr)`;
  $('#bottom-nav').innerHTML = bottom.map(btn).join('') + (more.length ? `<button data-more="1">${icon('more')}<span>Thêm</span></button>` : '');
  $('#more-panel').innerHTML = more
    .map((n) => `<button class="sheet-item" data-tab="${n.id}"><span class="ico">${icon(n.icon)}</span>${esc(n.label)}</button>`).join('');
  const moreBtn = $('#bottom-nav [data-more]');
  if (moreBtn) moreBtn.onclick = () => { $('#more-sheet').hidden = false; };
  $('#fab').innerHTML = icon('plus');
  $('#btn-refresh').innerHTML = icon('refresh');
  applyPrivacyIcon();
  // chữ tĩnh trong index.html (title, aria-label…)
  for (const el of document.querySelectorAll('.topbar, #fab, #bottom-nav, #more-panel')) translateDom(el);
  if (getLang() === 'vi') {
    // quay về tiếng Việt: khôi phục thuộc tính gốc
    $('#btn-theme').title = 'Giao diện sáng / tối';
    $('#btn-refresh').title = 'Làm mới số dư & giá';
    $('#fab').setAttribute('aria-label', 'Ghi thu chi');
    $('#cur-select').setAttribute('aria-label', 'Tiền tệ hiển thị');
  }
}

function applyPrivacyIcon() {
  const btn = $('#btn-privacy');
  btn.innerHTML = icon(isPrivate() ? 'eyeOff' : 'eye');
  btn.classList.toggle('on', isPrivate());
  btn.title = tr(isPrivate() ? 'Hiện số dư' : 'Ẩn số dư');
}

// ---- Bảng màu (theme màu): bronze | solana | okx | glass
function palette() {
  try { return localStorage.getItem('fin.palette') || 'bronze'; } catch { return 'bronze'; }
}
function setPalette(p) {
  try { localStorage.setItem('fin.palette', p); } catch { /* ignore */ }
  if (p === 'bronze') document.documentElement.removeAttribute('data-palette');
  else document.documentElement.setAttribute('data-palette', p);
  applyThemeIcon();
}

// ---- Theme: auto (theo hệ thống) / light / dark
function theme() {
  try { return localStorage.getItem('fin.theme') || 'auto'; } catch { return 'auto'; }
}
function setTheme(t) {
  try { localStorage.setItem('fin.theme', t); } catch { /* ignore */ }
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  applyThemeIcon();
}
function applyThemeIcon() {
  const t = theme();
  $('#btn-theme').innerHTML = icon(t === 'light' ? 'sun' : t === 'dark' ? 'moon' : 'auto');
  // màu thanh trạng thái điện thoại = màu nền của theme hiện tại
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (bg) document.querySelector('meta[name="theme-color"]').setAttribute('content', bg);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  if (theme() === 'auto') { applyThemeIcon(); render(); }
});

function updateSyncPill() {
  const el = $('#sync-status');
  const name = sync.providerName();
  el.textContent = name ? `☁ ${name}` : tr('☁ Chưa sync');
  el.classList.toggle('off', !name);
  el.title = tr(name ? 'Bấm để đồng bộ ngay' : 'Kết nối Dropbox / Google Drive trong Cài đặt');
}

// ================= Auto sync =================

let pushTimer;
onCommit(() => {
  if (local.autoSync === false || !sync.syncEnabled() || isLocked()) return; // đang khóa → không đồng bộ
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    ctx.smartSync().catch((e) => toast(`Sync: ${e.message}`, 'error'));
  }, 4000);
});

// ================= Init =================

async function init() {
  await loadState();
  // Lịch sử giá khá nặng → đọc sau lần vẽ đầu, xong thì tính lại PnL và vẽ lại
  startupGates.push(getPriceHistory().then((h) => { priceHist = h; pnlCache = null; futCache = null; render(); }).catch(() => {}));
  // Chart.js tải song song (async): tải xong thì vẽ lại để hiện biểu đồ
  if (!window.Chart) {
    startupGates.push(new Promise((resolve) => {
      const tag = document.querySelector('script[src*="chart.js"]');
      if (!tag) return resolve();
      tag.addEventListener('load', () => { render(); resolve(); });
      tag.addEventListener('error', resolve);
    }));
  }
  startupGates.push(syncGate.promise);
  current = location.hash.slice(1) || 'overview';
  runRecurring();

  buildNav();
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#tabs button[data-tab], #bottom-nav button[data-tab], #more-panel button[data-tab]');
    if (b) go(lastSub(b.dataset.tab));
  });
  $('#more-sheet').onclick = (e) => { if (e.target.id === 'more-sheet') $('#more-sheet').hidden = true; };
  $('#fab').onclick = () => {
    go('budget');
    const input = document.getElementById('qa-amount');
    input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    input?.focus();
  };
  $('#btn-theme').onclick = () => {
    const order = ['auto', 'light', 'dark'];
    setTheme(order[(order.indexOf(theme()) + 1) % order.length]);
    toast({ auto: 'Giao diện: theo hệ thống', light: 'Giao diện: sáng', dark: 'Giao diện: tối' }[theme()], 'info', 1500);
    render();
  };
  applyThemeIcon();
  $('#btn-privacy').onclick = () => {
    setPrivate(!isPrivate());
    applyPrivacyIcon();
    render();
  };
  window.onhashchange = () => go(location.hash.slice(1));
  $('#cur-select').onchange = (e) => { state.settings.displayCurrency = e.target.value; commit({ edit: true }); render(); };
  $('#btn-refresh').onclick = async () => {
    const btn = $('#btn-refresh');
    btn.disabled = true;
    btn.classList.add('spin');
    await Promise.all([ctx.refreshCrypto(), ctx.refreshQuotes()]);
    btn.disabled = false;
    btn.classList.remove('spin');
  };
  $('#sync-status').onclick = async () => {
    if (!sync.syncEnabled()) return go('settings');
    try {
      const r = await ctx.smartSync();
      toast({ pulled: 'Đã nhận dữ liệu từ cloud', pushed: 'Đã tải lên cloud', merged: 'Đã gộp dữ liệu 2 bên', same: 'Đã đồng bộ' }[r], 'ok');
    } catch (e) {
      toast(`Sync: ${e.message}`, 'error');
    }
  };

  await migrateAuth(); // thiết bị cũ còn lưu mật khẩu → đổi sang phiên, xóa mật khẩu
  render(); // chưa đăng nhập → chỉ hiện màn hình khóa
  await ctx.loadServerConfig();
  window.addEventListener('fin:locked', () => render());
  if (isLocked()) {
    render(); // vẽ lại form khóa (biết server có bật 2FA chưa)
    afterUnlock = startSession;
    syncGate.resolve(); // đang khóa: không đồng bộ, màn chờ không cần đợi
    return;
  }
  await startSession();
}

/** Phần khởi động chỉ chạy khi đã đăng nhập: xử lý OAuth, đồng bộ cloud, làm mới số dư. */
async function startSession() {
  try {
    if (await sync.handleOAuthCallback()) {
      toast('Đã kết nối Dropbox', 'ok');
      await ctx.smartSync();
      go('settings');
    }
  } catch (e) {
    toast(e.message, 'error');
  }

  if (sync.syncEnabled() && local.autoSync !== false) {
    await ctx.smartSync().catch((e) => toast(`Sync: ${e.message}`, 'error'));
  }
  syncGate.resolve();

  render();
  refreshPriceHistory();
  // Tự làm mới nếu dữ liệu cũ hơn 5 phút
  if (serverCfg.authOk) {
    const stale = Date.now() - (state.crypto.updatedAt || 0) > 5 * 60000;
    if (stale) ctx.refreshCrypto({ quiet: true });
    if (state.stocks.funds.length) ctx.refreshQuotes(false);
  }
}

init();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  // App mở từ bản đã lưu; khi có bản mới thì báo để tải lại
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data !== 'update-ready') return;
    const el = toast('Đã có bản mới — chạm để cập nhật', 'info', 15000);
    el.style.cursor = 'pointer';
    el.onclick = () => location.reload();
  });
}
