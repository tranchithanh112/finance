import crypto from 'node:crypto';

// Xác thực mọi API route (trừ /api/config, /api/session):
//  - Ưu tiên header x-app-session: phiên do /api/session cấp, ký HMAC bằng APP_PASSWORD, có hạn.
//    Trình duyệt chỉ giữ phiên này, không giữ mật khẩu; đổi APP_PASSWORD trên Vercel → mọi phiên cũ mất hiệu lực.
//  - x-app-password (cách cũ) vẫn được chấp nhận để thiết bị cũ tự đổi sang phiên.

export const SESSION_DAYS = 30;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const sign = (secret, exp) => b64url(crypto.createHmac('sha256', secret).update(`session|${exp}`).digest());

export function issueSession(secret = process.env.APP_PASSWORD, now = Date.now()) {
  const exp = now + SESSION_DAYS * 86400e3;
  return { token: `${exp}.${sign(secret, exp)}`, exp };
}

export function verifySession(token, secret = process.env.APP_PASSWORD, now = Date.now()) {
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
  return verifySession(req.headers['x-app-session']) || passwordOk(req);
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
