import { state, commit, hasAuth } from '../store.js';
import { bn, ensurePriceHistory, fetchTickerPrices } from '../binance.js';
import { computeFutures, syncFuturesIncome, csvToIncome, mergeIncome, emptyFutures, detectOffsetHours, shiftRecords, fileNameOffsetHours } from '../futures.js';
import { makePriceLookup } from '../pnl.js';
import { isStable, toast } from '../util.js';
import { getPriceHist, reloadPriceHist, onPricesChanged } from './crypto.js';
import { ui } from './ui.js';

// Futures: lãi/lỗ USDⓈ-M + COIN-M từ income (API + CSV), cache tới khi dữ liệu / giá đổi.

let futCache = null;
let busy = '';
export const invalidateFutures = () => { futCache = null; };
onPricesChanged(invalidateFutures);

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
  await reloadPriceHist();
}

export const futuresService = {
  futuresBusy: () => busy,

  futuresPnl() {
    if (!state.futures.income.length && !state.futures.account?.positions?.length) return null;
    if (!futCache) {
      const prices = Object.fromEntries(state.crypto.holdings.map((h) => [h.asset, h.price]));
      futCache = computeFutures(state.futures, makePriceLookup(getPriceHist()), state.futures.account, (a) => prices[a] || 0);
    }
    return futCache;
  },

  async syncFutures() {
    if (busy) return;
    if (!hasAuth()) { toast('Nhập mật khẩu ứng dụng trong tab Cài đặt trước', 'error'); return; }
    busy = 'Đang tải lịch sử futures…';
    ui.render();
    try {
      const startT = Date.parse(state.settings.historyStart) || Date.parse('2019-09-01');
      const { added, skipped } = await syncFuturesIncome(bn, state.futures, startT, (m) => { busy = m; if (ui.current() === 'futures') ui.render(); });
      await ensureFuturesPrices();
      const names = skipped.map((s) => (s.src === 'um' ? 'USDⓈ-M' : 'COIN-M')).join(', ');
      if (skipped.length === 2 && skipped.every((s) => s.status === 401 || s.status === 403)) {
        toast('Không đọc được Futures: API key chưa bật quyền đọc Futures', 'error', 8000);
      } else if (skipped.length) {
        toast(`Futures: ${added} bản ghi mới · bỏ qua ${names} (chưa mở tài khoản hoặc key thiếu quyền)`, 'info', 8000);
      } else {
        toast(`Futures: ${added} bản ghi mới`, 'ok');
      }
    } catch (e) {
      toast(`Futures: ${e.message}`, 'error', 8000);
    }
    busy = '';
    futCache = null;
    commit();
    ui.render();
  },

  async importFuturesCsv(files) {
    let added = 0;
    let rows = 0;
    let failed = 0;
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
        failed++;
        toast(`${file.name}: ${e.message}`, 'error', 8000);
      }
    }
    if (failed === files.length) return; // mọi file đều lỗi: đã báo từng file, không báo tổng kiểu thành công
    busy = 'Tải giá lịch sử…';
    ui.render();
    await ensureFuturesPrices().catch(() => toast('Chưa tải được giá lịch sử — lãi/lỗ COIN-M có thể chưa đúng, thử lại sau', 'info', 7000));
    busy = '';
    futCache = null;
    commit();
    toast(`Đã nhập ${added} bản ghi futures mới (${rows - added} trùng / đã có)`, added ? 'ok' : 'info', 6000);
    ui.render();
  },

  clearFutures() {
    if (!confirm('Xóa toàn bộ lịch sử futures đã tải / nhập?')) return;
    state.futures = { ...emptyFutures(), account: state.futures.account, resetAt: Date.now() };
    futCache = null;
    commit();
    ui.render();
    toast('Đã xóa lịch sử futures', 'ok');
  },
};
