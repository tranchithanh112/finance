import { state, commit, hasAuth } from '../store.js';
import { fetchHoldings, syncHistory as syncBinanceHistory, getPriceHistory, ensureAllPriceHistory } from '../binance.js';
import { computePnl, buildEvents, makePriceLookup } from '../pnl.js';
import { cryptoSeries, reconcileWithWallet } from '../series.js';
import { $, toast } from '../util.js';
import { updateProgress } from '../views/pnl.js';
import { ui, snapshot } from './ui.js';

// Crypto: số dư Binance, lịch sử lệnh, giá lịch sử, PnL (cache tới khi dữ liệu / giá đổi).

let priceHist = {};
let pnlCache = null;
let syncing = { running: false, pct: 0, msg: '' };
let abort = null;
const listeners = new Set(); // futures cũng dựa vào giá lịch sử → được báo khi giá đổi

export const getPriceHist = () => priceHist;
export const onPricesChanged = (fn) => listeners.add(fn);

/** Đọc lại giá lịch sử đã lưu; báo các cache phụ thuộc (PnL, futures). */
export async function reloadPriceHist() {
  priceHist = await getPriceHistory();
  invalidate();
}

/** Dữ liệu crypto đổi (đồng bộ, nhập, sửa) → tính lại PnL & futures ở lần xem sau. */
export function invalidate() {
  pnlCache = null;
  listeners.forEach((fn) => fn());
}

let priceJob = null;
/** Tải giá lịch sử còn thiếu ở nền (vd máy mới vừa nhận lịch sử từ Dropbox), rồi tính lại PnL. */
export function refreshPriceHistory() {
  priceJob ||= ensureAllPriceHistory()
    .then(async (n) => {
      if (!n) return;
      await reloadPriceHist();
      ui.render();
    })
    .catch(() => {})
    .finally(() => { priceJob = null; });
}

export const cryptoService = {
  syncState: () => syncing,

  pnl() {
    const hasHistory = Object.keys(state.history.trades).length || state.history.deposits.length;
    if (!hasHistory) return null;
    pnlCache ||= computePnl(state.history, priceHist, state.crypto.holdings, { dustUsd: Number(state.settings.dustUsd) || 1 });
    return pnlCache;
  },
  invalidatePnl: () => invalidate(),

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
    invalidate();
    commit({ edit: true });
    ui.render();
    toast(`Đã bỏ ${qty.toPrecision(6)} ${asset} khỏi lịch sử`, 'ok');
  },

  undoAdjust(id) {
    const r = (state.history.adjust || []).find((x) => x[0] === id);
    if (!r) return toast('Không tìm thấy điều chỉnh này — có thể đã được hoàn tác', 'info');
    r[4] = 'x';
    invalidate();
    commit({ edit: true });
    ui.render();
    toast('Đã hoàn tác', 'ok');
  },

  /** Giá trị coin & vốn theo ngày, dựng lại từ lịch sử (cache cùng PnL). */
  cryptoSeries() {
    const p = cryptoService.pnl();
    if (!p) return [];
    // Chưa đối chiếu với ví: coin bị hủy niêm yết / sập khi đang giữ làm việc "bù" cho khớp ví bị sai.
    p.series ||= cryptoSeries(state.history, priceHist);
    return p.series;
  },

  /** Giá USD đóng cửa của coin vào ngày chứa thời điểm t (null nếu chưa có giá lịch sử). */
  priceAt: (asset, t) => makePriceLookup(priceHist)(asset, t),

  async refreshCrypto({ quiet = false } = {}) {
    if (!hasAuth()) {
      if (!quiet) { toast('Nhập mật khẩu ứng dụng trong tab Cài đặt trước', 'error'); ui.go('settings'); }
      return;
    }
    document.body.classList.add('is-refreshing'); // khung mờ nhấp nháy trên các ô số trong lúc tải
    try {
      const { holdings, futures, missing } = await fetchHoldings();
      state.crypto = { holdings, updatedAt: Date.now() };
      if (futures?.ok) state.futures.account = futures;
      invalidate();
      snapshot();
      commit();
      if (!quiet && missing.length) toast(`Đã cập nhật số dư Binance — chưa lấy được: ${missing.join(', ')}`, 'info', 8000);
      else if (!quiet) toast('Đã cập nhật số dư Binance', 'ok');
    } catch (e) {
      toast(`Binance: ${e.message}`, 'error', 8000);
    }
    document.body.classList.remove('is-refreshing');
    ui.render();
  },

  async syncHistory(fullScan) {
    if (syncing.running) return;
    if (!hasAuth()) { toast('Nhập mật khẩu ứng dụng trong tab Cài đặt trước', 'error'); return; }
    abort = new AbortController();
    syncing = { running: true, pct: 0, msg: 'Bắt đầu…' };
    ui.render();
    try {
      if (!state.crypto.holdings.length) await cryptoService.refreshCrypto({ quiet: true });
      const { newTrades } = await syncBinanceHistory({
        fullScan,
        signal: abort.signal,
        onProgress: (msg, pct) => {
          syncing.msg = msg;
          if (pct != null) syncing.pct = pct;
          if (ui.current() === 'pnl') updateProgress($('#tab-pnl'), syncing);
        },
      });
      toast(`Đồng bộ xong — ${newTrades} lệnh mới`, 'ok');
      syncing = { running: false, pct: 100, msg: 'Hoàn tất' };
    } catch (e) {
      const msg = e.name === 'AbortError' ? 'Đã hủy (dữ liệu đã tải vẫn được giữ)' : `Lỗi: ${e.message}`;
      toast(msg, e.name === 'AbortError' ? 'info' : 'error', 8000);
      syncing = { running: false, pct: 0, msg };
    }
    await reloadPriceHist();
    commit();
    ui.render();
  },
  cancelSync() { abort?.abort(); },
};
