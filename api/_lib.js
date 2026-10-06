import crypto from 'node:crypto';

// Xác thực mọi API route (trừ /api/config, /api/session):
//  - Header x-app-session: phiên do /api/session cấp, ký HMAC bằng APP_PASSWORD, có hạn.
//    Trình duyệt chỉ giữ phiên này, không giữ mật khẩu; đổi APP_PASSWORD trên Vercel → mọi phiên cũ mất hiệu lực.
//  - x-app-password chỉ được nhận ở /api/session (thiết bị cũ còn lưu mật khẩu tự đổi sang phiên qua migrateAuth).

export const SESSION_DAYS = 30;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const sign = (secret, exp) => b64url(crypto.createHmac('sha256', secret).update(`session|${exp}`).digest());

// Khóa ký phiên gồm cả TOTP_SECRET → bật / đổi 2FA là mọi phiên cũ mất hiệu lực.
const sessionKey = () => `${process.env.APP_PASSWORD}|${process.env.TOTP_SECRET || ''}`;

// ================= 2FA: TOTP (RFC 6238) — tương thích Google Authenticator =================

export function base32Decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(s).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let val = 0;
  const out = [];
  for (const c of clean) {
    const i = A.indexOf(c);
    if (i < 0) throw new Error('TOTP_SECRET không phải base32');
    val = (val << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function totpCode(key, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** Kiểm tra mã 6 số, chấp nhận lệch ±1 bước 30 giây (đồng hồ điện thoại hơi lệch). */
export function verifyTotp(code, secret = process.env.TOTP_SECRET, now = Date.now()) {
  if (!secret || !/^\d{6}$/.test(String(code || ''))) return false;
  const key = base32Decode(secret);
  const step = Math.floor(now / 30000);
  return [-1, 0, 1].some((d) => safeEqual(totpCode(key, step + d), String(code)));
}

export const totpEnabled = () => Boolean(process.env.TOTP_SECRET);

export function issueSession(secret = sessionKey(), now = Date.now()) {
  const exp = now + SESSION_DAYS * 86400e3;
  return { token: `${exp}.${sign(secret, exp)}`, exp };
}

export function verifySession(token, secret = sessionKey(), now = Date.now()) {
  if (!process.env.APP_PASSWORD && secret === sessionKey()) return false;
  if (!secret || typeof token !== 'string') return false;
  const [expStr, sig] = token.split('.');
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < now || !sig) return false;
  return safeEqual(sig, sign(secret, exp));
}

export function passwordOk(req) {
  const expected = process.env.APP_PASSWORD;
  return Boolean(expected) && safeEqual(req.headers['x-app-password'] || '', expected);
}

export function isAuthed(req) {
  // Chỉ chấp nhận phiên. Mật khẩu chỉ dùng ở /api/session (có làm chậm khi sai) —
  // nếu API khác cũng nhận mật khẩu thì có thể dò mật khẩu qua đó mà không bị làm chậm.
  return verifySession(req.headers['x-app-session']);
}

export function checkAuth(req, res) {
  if (!process.env.APP_PASSWORD) {
    res.status(500).json({ error: 'APP_PASSWORD chưa được cấu hình trong Environment Variables của Vercel' });
    return false;
  }
  if (!isAuthed(req)) {
    res.status(401).json({ error: 'Phiên đăng nhập hết hạn hoặc sai mật khẩu — nhập lại mật khẩu ứng dụng ở tab Cài đặt', auth: true });
    return false;
  }
  return true;
}

export function noStore(res) {
  res.setHeader('Cache-Control', 'no-store');
}
