import crypto from 'node:crypto';
import { checkAuth, noStore } from './_lib.js';

// Proxy CHỈ ĐỌC tới Binance. Chỉ các endpoint trong danh sách này được phép gọi,
// key/secret nằm trong env của Vercel và không bao giờ gửi xuống trình duyệt.
const ENDPOINTS = {
  '/api/v3/account': { signed: true },
  '/api/v3/myTrades': { signed: true },
  '/api/v3/ticker/price': {},
  '/api/v3/exchangeInfo': { slim: true },
  '/api/v3/klines': {},
  '/sapi/v1/capital/deposit/hisrec': { signed: true },
  '/sapi/v1/capital/withdraw/history': { signed: true },
  '/sapi/v1/asset/get-funding-asset': { signed: true, method: 'POST' },
  '/sapi/v1/simple-earn/flexible/position': { signed: true },
  '/sapi/v1/simple-earn/locked/position': { signed: true },
  '/sapi/v1/asset/dribblet': { signed: true },
  '/sapi/v1/convert/tradeFlow': { signed: true },
};

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkAuth(req, res)) return;

  const { path, params = {} } = req.body || {};
  const ep = ENDPOINTS[path];
  if (!ep) return res.status(400).json({ error: `Endpoint không được phép: ${path}` });

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
  }

  const headers = {};
  if (ep.signed) {
    const key = process.env.BINANCE_API_KEY;
    const secret = process.env.BINANCE_API_SECRET;
    if (!key || !secret) {
      return res.status(500).json({ error: 'BINANCE_API_KEY / BINANCE_API_SECRET chưa được cấu hình trên Vercel' });
    }
    qs.append('recvWindow', '10000');
    qs.append('timestamp', String(Date.now()));
    qs.append('signature', crypto.createHmac('sha256', secret).update(qs.toString()).digest('hex'));
    headers['X-MBX-APIKEY'] = key;
  }

  const base = process.env.BINANCE_BASE_URL || 'https://api.binance.com';
  let r;
  try {
    r = await fetch(`${base}${path}?${qs}`, { method: ep.method || 'GET', headers });
  } catch (e) {
    return res.status(502).json({ error: `Không kết nối được Binance: ${e.message}` });
  }

  res.setHeader('x-used-weight', r.headers.get('x-mbx-used-weight-1m') || '');
  res.setHeader('x-retry-after', r.headers.get('retry-after') || '');

  if (ep.slim && r.ok) {
    // exchangeInfo đầy đủ nặng vài MB, chỉ giữ lại những gì cần.
    const data = await r.json();
    const symbols = data.symbols.map((s) => [s.symbol, s.baseAsset, s.quoteAsset, s.status]);
    return res.status(200).json({ symbols });
  }

  const text = await r.text();
  res.status(r.status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (r.status === 451) {
    return res.send(JSON.stringify({
      error: 'Binance chặn khu vực của server Vercel (HTTP 451). Đổi "regions" trong vercel.json (vd: hnd1, sin1, fra1) rồi deploy lại.',
    }));
  }
  return res.send(text);
}
