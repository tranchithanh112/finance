import { state, local, loadState, commit, onCommit, takeSnapshot } from './store.js';
import { fetchHoldings, syncHistory, getPriceHistory, bn, ensurePriceHistory, fetchTickerPrices, ensureAllPriceHistory } from './binance.js';
import { computeFutures, syncFuturesIncome, csvToIncome, mergeIncome, emptyFutures } from './futures.js';
import { makePriceLookup } from './pnl.js';
import { computePnl } from './pnl.js';
import { totals, fxRate } from './calc.js';
import * as sync from './sync.js';
import { $, $$, toast, setDisplayCurrency, isStable, esc } from './util.js';
import { icon } from './icons.js';
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

// Điều hướng: 4 mục chính trên thanh dưới (điện thoại), phần còn lại nằm trong "Thêm".
const NAV = [
  { id: 'overview', label: 'Tổng quan', short: 'Tổng quan', icon: 'home' },
  { id: 'budget', label: 'Thu chi', short: 'Thu chi', icon: 'wallet' },
  { id: 'crypto', label: 'Crypto', short: 'Crypto', icon: 'coins' },
  { id: 'pnl', label: 'Lịch sử & PnL', short: 'Lãi/lỗ', icon: 'chart' },
  { id: 'futures', label: 'Futures', icon: 'bolt', more: true },
  { id: 'stocks', label: 'Chứng khoán', icon: 'trend', more: true },
  { id: 'settings', label: 'Cài đặt', icon: 'gear', more: true },
];

let current = 'overview';
let serverCfg = { offline: true };
let priceHist = {};
let pnlCache = null;
let futCache = null;
let futBusy = '';
let syncing = { running: false, pct: 0, msg: '' };
let abort = null;

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
        const { records } = csvToIncome(await file.text());
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
    state.futures = { ...emptyFutures(), account: state.futures.account };
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
  const item = NAV.find((n) => n.id === current);
  $$('#tabs button, #more-panel button').forEach((b) => b.classList.toggle('on', b.dataset.tab === current));
  $$('#bottom-nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === current || Boolean(b.dataset.more && item?.more)));
  $('#page-title').textContent = item?.label || '';
  $('#fab').hidden = current === 'settings';
  $$('.tab').forEach((s) => { s.hidden = s.id !== `tab-${current}`; });
  try {
    VIEWS[current]($(`#tab-${current}`), ctx);
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
  if (location.hash !== '#' + current) history.replaceState(null, '', '#' + current);
  render();
}

function buildNav() {
  $('#tabs').innerHTML = NAV.map((n) => `<button data-tab="${n.id}">${icon(n.icon)}<span>${esc(n.label)}</span></button>`).join('');
  $('#bottom-nav').innerHTML = NAV.filter((n) => !n.more)
    .map((n) => `<button data-tab="${n.id}">${icon(n.icon)}<span>${esc(n.short)}</span></button>`).join('') +
    `<button data-more="1">${icon('more')}<span>Thêm</span></button>`;
  $('#more-panel').innerHTML = NAV.filter((n) => n.more)
    .map((n) => `<button class="sheet-item" data-tab="${n.id}"><span class="ico">${icon(n.icon)}</span>${esc(n.label)}</button>`).join('');
  $('#fab').innerHTML = icon('plus');
  $('#btn-refresh').innerHTML = icon('refresh');
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
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#0a0e16' : '#f3f5fa');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  if (theme() === 'auto') { applyThemeIcon(); render(); }
});

function updateSyncPill() {
  const el = $('#sync-status');
  const name = sync.providerName();
  el.textContent = name ? `☁ ${name}` : '☁ Chưa sync';
  el.classList.toggle('off', !name);
  el.title = name ? 'Bấm để đồng bộ ngay' : 'Kết nối Dropbox / Google Drive trong Cài đặt';
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
    if (b) go(b.dataset.tab);
  });
  $('#bottom-nav [data-more]').onclick = () => { $('#more-sheet').hidden = false; };
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
  }
}

init();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
