import { state, commit, authHeaders, hasAuth } from '../store.js';
import { stockSeries } from '../series.js';
import { toUSD, fundPrice, quoteSymbol } from '../calc.js';
import { toast } from '../util.js';
import { ui, snapshot } from './ui.js';

// Chứng khoán / quỹ: giá Yahoo + NAV Fmarket qua /api/quote, giá đóng cửa lịch sử cho biểu đồ.

// Giá đóng cửa lịch sử của mã CK — chỉ lưu trên máy, không sync: { ticker: { at, rows: [[ms, close]] } }
let histTriedAt = 0;
const stockHist = (() => { try { return JSON.parse(localStorage.getItem('fin.stockHist') || '{}'); } catch { return {}; } })();

export const stocksService = {
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
      const r = await fetch(`/api/quote?history=5y&symbols=${encodeURIComponent(stale.map(quoteSymbol).join(','))}`, {
        headers: authHeaders(),
      });
      const data = await r.json();
      if (!r.ok) return;
      for (const f of stale) stockHist[f.ticker] = { at: Date.now(), rows: data.history?.[quoteSymbol(f)] || stockHist[f.ticker]?.rows || [] };
      try { localStorage.setItem('fin.stockHist', JSON.stringify(stockHist)); } catch { /* đầy bộ nhớ thì thôi */ }
      if (ui.current() === 'stocks') ui.render();
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
    if (!hasAuth()) { if (showToast) toast('Nhập mật khẩu ứng dụng trong tab Cài đặt trước', 'error'); ui.render(); return; } // vẽ lại → mở khóa nút vừa bấm
    // Mã .VN chưa từng có giá Yahoo: thử luôn Fmarket (quỹ mở) để tự chuyển nguồn
    const probe = funds.filter((f) => f.source === 'yahoo' && /\.VN$/i.test(f.ticker) && !f.lastPrice);
    const fmSym = (f) => quoteSymbol({ ...f, source: 'fmarket' });
    const symbols = [...funds.map(quoteSymbol), ...probe.map(fmSym), 'VND=X'];
    try {
      const r = await fetch(`/api/quote?symbols=${encodeURIComponent(symbols.join(','))}`, {
        headers: authHeaders(),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.status);
      const moved = [];
      for (const f of probe) {
        if (data.quotes[f.ticker] || !data.quotes[fmSym(f)]) continue;
        Object.assign(f, { source: 'fmarket', currency: 'VND' });
        delete data.errors?.[f.ticker];
        moved.push(f.ticker);
      }
      for (const f of funds) {
        const q = data.quotes[quoteSymbol(f)];
        if (q) Object.assign(f, { lastPrice: q.price, prevClose: q.prevClose, lastPriceAt: Date.now(), priceTime: q.time || null, name: f.name || q.name });
      }
      if (moved.length) {
        toast(`${moved.join(', ')}: Yahoo không có, đã chuyển sang lấy NAV từ Fmarket`, 'ok', 7000);
      }
      if (data.quotes['VND=X']) state.fx = { USDVND: data.quotes['VND=X'].price, updatedAt: Date.now() };
      const errs = Object.keys(data.errors || {}).filter((s) => s !== 'VND=X' && !probe.some((f) => fmSym(f) === s)).map((s) => s.replace(/^FMARKET:/, ''));
      snapshot();
      commit({ edit: moved.length > 0 }); // đổi nguồn giá là thay đổi của người dùng → đồng bộ sang máy khác
      stocksService.refreshStockHistory();
      if (errs.length) toast(`Không lấy được giá: ${errs.join(', ')}`, 'error', 7000);
      else if (showToast) toast('Đã cập nhật giá', 'ok');
    } catch (e) {
      if (showToast) toast(`Lỗi lấy giá: ${e.message}`, 'error');
    }
    ui.render();
  },
};
