import { checkAuth } from './_lib.js';

// Lấy giá chứng khoán / quỹ ETF / tỷ giá từ Yahoo Finance (không cần API key).
// GET /api/quote?symbols=VOO,E1VFVN30.VN,VND=X
// GET /api/quote?symbols=E1VFVN30.VN&history=5y → thêm giá đóng cửa ngày: history[sym] = [[ms, close], ...]
export default async function handler(req, res) {
  if (!checkAuth(req, res)) return;
  const symbols = String(req.query.symbols || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);
  if (!symbols.length) return res.status(400).json({ error: 'Thiếu tham số symbols' });

  const range = ['1y', '2y', '5y', '10y', 'max'].includes(req.query.history) ? req.query.history : null;
  const quotes = {};
  const errors = {};
  const history = {};
  await Promise.all(symbols.map(async (sym) => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range || '5d'}&interval=1d`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (finance-dashboard)' } });
      const data = await r.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (!meta || meta.regularMarketPrice == null) {
        errors[sym] = data?.chart?.error?.description || `HTTP ${r.status}`;
        return;
      }
      quotes[sym] = {
        price: meta.regularMarketPrice,
        prevClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
        currency: meta.currency,
        name: meta.longName || meta.shortName || sym,
        time: (meta.regularMarketTime || 0) * 1000,
      };
      if (range) {
        const res0 = data.chart.result[0];
        const close = res0.indicators?.quote?.[0]?.close || [];
        history[sym] = (res0.timestamp || [])
          .map((t, i) => [t * 1000, close[i]])
          .filter((r) => r[1] != null)
          .map(([t, c]) => [t, Math.round(c * 1e4) / 1e4]);
      }
    } catch (e) {
      errors[sym] = e.message;
    }
  }));

  res.setHeader('Cache-Control', 'private, max-age=60');
  return res.status(200).json(range ? { quotes, errors, history } : { quotes, errors });
}
