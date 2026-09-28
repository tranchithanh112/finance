// Cấu hình công khai (không bí mật) để trình duyệt biết client id cho Dropbox / Google Drive.
// Nếu có header x-app-password, trả thêm trạng thái xác thực và key Binance.
import crypto from 'node:crypto';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const expected = process.env.APP_PASSWORD || '';
  const got = String(req.headers['x-app-password'] || '');
  let authOk = false;
  if (expected && got) {
    const a = Buffer.from(got);
    const b = Buffer.from(expected);
    authOk = a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  res.status(200).json({
    dropboxAppKey: process.env.DROPBOX_APP_KEY || '',
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    passwordConfigured: Boolean(expected),
    authOk,
    binanceConfigured: authOk ? Boolean(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET) : undefined,
    tcbsConfigured: authOk ? Boolean(process.env.TCBS_API_KEY) : undefined,
  });
}
