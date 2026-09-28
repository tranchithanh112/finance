import { state, local, loadState, commit, onCommit, takeSnapshot } from './store.js';
import { fetchHoldings, syncHistory, getPriceHistory, bn, ensurePriceHistory, fetchTickerPrices } from './binance.js';
import { computeFutures, syncFuturesIncome, csvToIncome, mergeIncome, emptyFutures } from './futures.js';
import { makePriceLookup } from './pnl.js';
import { computePnl } from './pnl.js';
import { totals, fxRate } from './calc.js';
import * as sync from './sync.js';
import { $, $$, toast, setDisplayCurrency, isStable } from './util.js';
import { renderOverview } from './views/overview.js';
import { renderCrypto } from './views/crypto.js';
import { renderPnl, updateProgress } from './views/pnl.js';
import { renderStocks } from './views/stocks.js';
import { renderSettings } from './views/settings.js';
import { renderFutures } from './views/futures.js';

const VIEWS = {
  overview: renderOverview,
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
    if (r === 'pulled') ctx.afterStateReplaced();
    updateSyncPill();
    return r;
  },

  afterStateReplaced() {
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
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === current));
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
  current = VIEWS[tab] ? tab : 'overview';
  if (location.hash !== '#' + current) history.replaceState(null, '', '#' + current);
  render();
}

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
    sync.push().then(updateSyncPill).catch((e) => toast(`Sync: ${e.message}`, 'error'));
  }, 4000);
});

// ================= Init =================

async function init() {
  await loadState();
  priceHist = await getPriceHistory();
  current = location.hash.slice(1) || 'overview';

  $('#tabs').onclick = (e) => { const b = e.target.closest('button[data-tab]'); if (b) go(b.dataset.tab); };
  window.onhashchange = () => go(location.hash.slice(1));
  $('#cur-select').onchange = (e) => { state.settings.displayCurrency = e.target.value; commit(); render(); };
  $('#btn-refresh').onclick = async (e) => {
    e.currentTarget.disabled = true;
    await Promise.all([ctx.refreshCrypto(), ctx.refreshQuotes()]);
    $('#btn-refresh').disabled = false;
  };
  $('#sync-status').onclick = async () => {
    if (!sync.syncEnabled()) return go('settings');
    try {
      const r = await ctx.smartSync();
      toast({ pulled: 'Đã tải dữ liệu mới hơn từ cloud', pushed: 'Đã tải lên cloud', same: 'Đã đồng bộ' }[r], 'ok');
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
