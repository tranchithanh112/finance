import crypto from 'node:crypto';
import { checkAuth, noStore } from './_lib.js';

// Proxy CHỈ ĐỌC tới TCBS Open API (https://developers.tcbs.com.vn).
//  - TCBS_API_KEY nằm trong env của Vercel, không bao giờ gửi xuống trình duyệt.
//  - Đổi API key + OTP lấy JWT (tối đa 8 giờ; TCBS chỉ cho 10 lần/ngày). JWT được mã hóa
//    AES-GCM bằng khóa suy ra từ APP_PASSWORD + TCBS_API_KEY rồi mới trả về trình duyệt,
//    nên có lấy được bản mã trong máy cũng không dùng được để đặt lệnh.
//  - Chỉ các GET trong danh sách dưới đây được phép (hồ sơ, danh mục, tiền, sổ lệnh).
const ALLOW = [
  /^\/eros\/v2\/get-profile\/by-username\/[A-Za-z0-9]{4,20}$/,
  /^\/aion\/v1\/accounts\/[A-Za-z0-9]{4,20}\/(se|cashInvestments|orders|matching-details|ppse)$/,
];

const base = () => process.env.TCBS_BASE_URL || 'https://openapi.tcbs.com.vn';

function sealKey() {
  return crypto.createHash('sha256')
    .update(`tcbs-seal|${process.env.APP_PASSWORD}|${process.env.TCBS_API_KEY}`)
    .digest();
}

export function seal(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', sealKey(), iv);
  const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url');
}

export function unseal(s) {
  const buf = Buffer.from(String(s || ''), 'base64url');
  if (buf.length < 29) throw new Error('bad token');
  const d = crypto.createDecipheriv('aes-256-gcm', sealKey(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

/** Hạn của JWT (ms). Không đọc được thì coi như 8 giờ. */
export function jwtExp(token) {
  try {
    const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (p.exp) return p.exp * 1000;
  } catch { /* bỏ qua */ }
  return Date.now() + 8 * 3600e3;
}

async function readJson(r) {
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { message: text.slice(0, 300) }; }
}

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkAuth(req, res)) return;
  if (!process.env.TCBS_API_KEY) return res.status(500).json({ error: 'TCBS_API_KEY chưa được cấu hình trên Vercel' });

  const { action, otp, path, params = {}, sealed } = req.body || {};

  if (action === 'token') {
    if (!/^\d{4,8}$/.test(String(otp || ''))) return res.status(400).json({ error: 'OTP không hợp lệ' });
    let r;
    try {
      r = await fetch(`${base()}/gaia/v1/oauth2/openapi/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: process.env.TCBS_API_KEY, otp: String(otp) }),
      });
    } catch (e) {
      return res.status(502).json({ error: `Không kết nối được TCBS: ${e.message}` });
    }
    const data = await readJson(r);
    if (!r.ok || !data.token) {
      return res.status(r.ok ? 502 : r.status).json({ error: `TCBS từ chối cấp token: ${data.message || data.error || r.status}` });
    }
    return res.status(200).json({ sealed: seal(data.token), exp: jwtExp(data.token) });
  }

  if (action === 'get') {
    if (typeof path !== 'string' || !ALLOW.some((re) => re.test(path))) {
      return res.status(400).json({ error: `Endpoint không được phép: ${path}` });
    }
    let token;
    try { token = unseal(sealed); } catch {
      return res.status(401).json({ error: 'Phiên TCBS không hợp lệ, hãy kết nối lại bằng OTP', expired: true });
    }
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
    let r;
    try {
      r = await fetch(`${base()}${path}${qs.size ? `?${qs}` : ''}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
    } catch (e) {
      return res.status(502).json({ error: `Không kết nối được TCBS: ${e.message}` });
    }
    const data = await readJson(r);
    if (r.status === 401 || r.status === 403) {
      return res.status(401).json({ error: 'Phiên TCBS đã hết hạn, hãy nhập OTP mới', expired: true });
    }
    if (!r.ok) return res.status(r.status).json({ error: `TCBS: ${data.message || data.error || r.status}` });
    return res.status(200).json(data);
  }

  return res.status(400).json({ error: 'action không hợp lệ' });
}
