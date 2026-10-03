// NAV quỹ mở Việt Nam (DCDS, VESAF, DCBF…) từ Fmarket — sàn phân phối chứng chỉ quỹ.
// Đây là API web của Fmarket, không phải API công bố chính thức: có thể đổi bất cứ lúc nào.
// Hỏng thì app giữ giá đã lấy lần trước và người dùng vẫn chuyển được sang nhập tay.

const BASE = 'https://api.fmarket.vn/res';
const TTL = 10 * 60e3;
let list = { at: 0, rows: [] };

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'User-Agent': 'Mozilla/5.0 (finance-dashboard)' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10e3),
  });
  if (!r.ok) throw new Error(`Fmarket HTTP ${r.status}`);
  const data = await r.json();
  if (data?.data == null) throw new Error('Fmarket: phản hồi không như mong đợi');
  return data.data;
}

/** Danh sách quỹ (cache 10 phút trong 1 lần chạy của serverless). */
async function funds() {
  if (Date.now() - list.at < TTL && list.rows.length) return list.rows;
  const data = await post('/products/filter', {
    types: ['NEW_FUND', 'TRADING_FUND'], issuerIds: [], sortOrder: 'DESC', sortField: 'navTo6Months',
    page: 1, pageSize: 500, isIpo: false, fundAssetTypes: [], bondRemainPeriods: [], searchField: '',
    isBuyByReward: false, thirdAppIds: [],
  });
  list = { at: Date.now(), rows: data.rows || [] };
  return list.rows;
}

/** Mã người dùng nhập (DCDS, dcds.vn) → mã quỹ trên Fmarket. */
export const fundCode = (s) => String(s).trim().toUpperCase().replace(/\.VN$/, '');

async function find(code) {
  const c = fundCode(code);
  const row = (await funds()).find((f) => String(f.shortName).toUpperCase() === c || String(f.code).toUpperCase() === c);
  if (!row) throw new Error(`${c}: not found on Fmarket`);
  return row;
}

/** Giá kiểu Yahoo: { price, prevClose, currency, name, time }. */
export async function fmarketQuote(code) {
  const f = await find(code);
  const nav = Number(f.nav);
  if (!(nav > 0)) throw new Error(`${fundCode(code)}: Fmarket chưa có NAV`);
  const chg = Number(f.productNavChange?.navToPrevious);
  return {
    price: nav,
    prevClose: Number.isFinite(chg) ? Math.round((nav / (1 + chg / 100)) * 100) / 100 : null,
    currency: 'VND',
    name: f.name || f.shortName,
    time: f.productNavChange?.updateAt || Date.now(),
  };
}

/** Lịch sử NAV: [[ms, nav], …] từ `years` năm trước đến nay. */
export async function fmarketHistory(code, years = 5) {
  const f = await find(code);
  const d = new Date();
  const to = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const rows = await post('/product/get-nav-history', { isAllData: 1, productId: f.id, fromDate: null, toDate: to });
  const from = Date.now() - years * 365.25 * 864e5;
  return parseHistory(rows).filter(([t]) => t >= from);
}

export function parseHistory(rows) {
  return (rows || [])
    .map((r) => [Date.parse(`${r.navDate}T00:00:00Z`), Number(r.nav)])
    .filter(([t, v]) => Number.isFinite(t) && v > 0)
    .sort((a, b) => a[0] - b[0]);
}
