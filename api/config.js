// Cấu hình công khai (không bí mật) để trình duyệt biết client id cho Dropbox / Google Drive.
// Nếu có header x-app-password, trả thêm trạng thái xác thực và key Binance.
import { isAuthed, totpEnabled } from './_lib.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const expected = process.env.APP_PASSWORD || '';
  const authOk = Boolean(expected) && isAuthed(req);
  res.status(200).json({
    dropboxAppKey: process.env.DROPBOX_APP_KEY || '',
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    passwordConfigured: Boolean(expected),
    totpRequired: totpEnabled(), // bật 2FA → form đăng nhập hiện ô mã 6 số
    authOk,
    binanceConfigured: authOk ? Boolean(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET) : undefined,
  });
}
