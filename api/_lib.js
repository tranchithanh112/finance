import crypto from 'node:crypto';

// Mọi API route (trừ /api/config) yêu cầu header x-app-password khớp với env APP_PASSWORD,
// để người lạ biết URL cũng không đọc được tài khoản Binance của bạn.
export function checkAuth(req, res) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    res.status(500).json({ error: 'APP_PASSWORD chưa được cấu hình trong Environment Variables của Vercel' });
    return false;
  }
  const got = Buffer.from(String(req.headers['x-app-password'] || ''));
  const want = Buffer.from(expected);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
    res.status(401).json({ error: 'Sai mật khẩu ứng dụng (APP_PASSWORD)' });
    return false;
  }
  return true;
}

export function noStore(res) {
  res.setHeader('Cache-Control', 'no-store');
}
