import { state, local, loadState, commit, onCommit, takeSnapshot } from './store.js';
import { fetchHoldings, syncHistory, getPriceHistory, bn, ensurePriceHistory, fetchTickerPrices, ensureAllPriceHistory } from './binance.js';
import { computeFutures, syncFuturesIncome, csvToIncome, mergeIncome, emptyFutures, detectOffsetHours, shiftRecords, fileNameOffsetHours } from './futures.js';
import { makePriceLookup } from './pnl.js';
import { computePnl } from './pnl.js';
import { cryptoSeries, stockSeries } from './series.js';
import { totals, fxRate, toUSD, fundPrice } from './calc.js';
import * as sync from './sync.js';
import { $, $$, toast, setDisplayCurrency, isStable, esc, isPrivate, setPrivate } from './util.js';
import { icon } from './icons.js';
import { tr, translateDom, setLang, getLang } from './i18n.js';
import { loadPalette } from './charts.js';
import { tabOrder, groupOf, lastSub, rememberSub, BOTTOM_MAX } from './nav.js';
import { renderOverview } from './views/overview.js';
import { renderCrypto } from './views/crypto.js';
import { renderPnl, updateProgress } from './views/pnl.js';
import { renderStocks } from './views/stocks.js';
import { renderSettings } from './views/settings.js';
import { renderFutures } from './views/futures.js';
import { renderBudget } from './views/budget.js';
import { generateRecurring, setAnchor } from './budget.js';
import { fetchTcbs, tcbsLogin, tcbsSession } from './tcbs.js';

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
let tcbsBusy = false;
// Giá đóng cửa lịch sử của mã CK (Yahoo) — chỉ lưu trên máy, không sync: { ticker: { at, rows: [[ms, close]] } }
let histTriedAt = 0;
let stockHist = (() => { try { return JSON.parse(localStorage.getItem('fin.stockHist') || '{}'); } catch { return {}; } })();

// ================= Actions =================

const ctx = {
  rerender: render,
  serverConfig: () => serverCfg,
  syncState: () => syncing,

  pnl() {
    const hasHistory = Object.keys(state.history.trades).length || state.history.deposits.length;
    if (!hasHistory) return null;
    pnlCache ||= computePnl(state.history, priceHist, state.crypto.holdings, { dustUsd: Number(state.settings.dustUsd) || 1 });
    return pnlCache;
  },
  invalidatePnl() { pnlCache = null; futCache = null; },
  /** Giá trị coin & vốn theo ngày, dựng lại từ lịch sử (cache cùng PnL). */
  cryptoSeries() {
    const p = ctx.pnl();
    if (!p) return [];
    // đối chiếu với số coin thật trong ví (không gồm ví futures) để khớp với các ô số liệu
    const held = new Map(state.crypto.holdings.map((h) => [h.asset, h.total - (h.futures || 0)]));
    p.series ||= cryptoSeries(state.history, priceHist, { held: state.crypto.holdings.length ? held : null });
    return p.series;
  },

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
    if (!local.appPassword) { toast('Nhập mật khẩu ứng dụng trong tab Cài đặt trước', 'error'); return; }
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
      const r = await fetch('/api/config', { headers: { 'x-app-password': local.appPassword || '' } });
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error();
      serverCfg = await r.json();
    } catch {
      serverCfg = { offline: true };
    }
    Object.assign(sync.publicConfig, { dropboxAppKey: serverCfg.dropboxAppKey || '', googleClientId: serverCfg.googleClientId || '' });
  },

  async refreshCrypto({ quiet = false } = {}) {
    if (!local.appPassword) {
      if (!quiet) { toast('Nhập mật khẩu ứng dụng trong tab Cài đặt trước', 'error'); go('settings'); }
      return;
    }
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
    render();
  },

  tcbsBusy: () => tcbsBusy,

  async tcbsLogin(otp) {
    try {
      await tcbsLogin(otp);
      toast('Đã kết nối TCBS', 'ok');
    } catch (e) {
      toast(`TCBS: ${e.message}`, 'error', 8000);
      return render();
    }
    return ctx.syncTcbs();
  },

  async syncTcbs({ quiet = false } = {}) {
    if (tcbsBusy || !tcbsSession() || !state.settings.tcbsCustody) return;
    tcbsBusy = true;
    render();
    try {
      state.broker = { tcbs: await fetchTcbs(state.settings.tcbsCustody), updatedAt: Date.now() };
      snapshot();
      commit();
      if (!quiet) toast('Đã cập nhật danh mục TCBS', 'ok');
    } catch (e) {
      if (!quiet || !e.expired) toast(`TCBS: ${e.message}`, 'error', 8000);
    }
    tcbsBusy = false;
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
    if (!stale.length || !local.appPassword || Date.now() - histTriedAt < 60e3) return;
    histTriedAt = Date.now();
    try {
      const r = await fetch(`/api/quote?history=5y&symbols=${encodeURIComponent(stale.map((f) => f.ticker).join(','))}`, {
        headers: { 'x-app-password': local.appPassword },
      });
      const data = await r.json();
      if (!r.ok) return;
      for (const f of stale) stockHist[f.ticker] = { at: Date.now(), rows: data.history?.[f.ticker] || stockHist[f.ticker]?.rows || [] };
      try { localStorage.setItem('fin.stockHist', JSON.stringify(stockHist)); } catch { /* đầy bộ nhớ thì thôi */ }
      if (current === 'stocks') render();
    } catch { /* bỏ qua, lần sau thử lại */ }
  },

  async refreshQuotes(showToast = false) {
    const funds = state.stocks.funds.filter((f) => f.source !== 'manual');
    if (!local.appPassword) return;
    const symbols = [...funds.map((f) => f.ticker), 'VND=X'];
    try {
      const r = await fetch(`/api/quote?symbols=${encodeURIComponent(symbols.join(','))}`, {
        headers: { 'x-app-password': local.appPassword },
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
    if (!local.appPassword) { toast('Nhập mật khẩu ứng dụng trong tab Cài đặt trước', 'error'); return; }
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

function render() {
  applyCurrency();
  loadPalette();
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
    if (group.subs) {
      root.insertAdjacentHTML('afterbegin', `<div class="subnav seg">${group.subs.map((x) =>
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
  if (local.autoSync === false || !sync.syncEnabled()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    ctx.smartSync().catch((e) => toast(`Sync: ${e.message}`, 'error'));
  }, 4000);
});

// ================= Init =================

async function init() {
  await loadState();
  priceHist = await getPriceHistory();
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
    await Promise.all([ctx.refreshCrypto(), ctx.refreshQuotes(), ctx.syncTcbs({ quiet: true })]);
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

  render();
  await ctx.loadServerConfig();

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

  render();
  refreshPriceHistory();
  // Tự làm mới nếu dữ liệu cũ hơn 5 phút
  if (serverCfg.authOk) {
    const stale = Date.now() - (state.crypto.updatedAt || 0) > 5 * 60000;
    if (stale) ctx.refreshCrypto({ quiet: true });
    if (state.stocks.funds.length) ctx.refreshQuotes(false);
    if (Date.now() - (state.broker?.updatedAt || 0) > 5 * 60000) ctx.syncTcbs({ quiet: true });
  }
}

init();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
