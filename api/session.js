import { issueSession, passwordOk, noStore, totpEnabled, verifyTotp } from './_lib.js';

// Đổi mật khẩu ứng dụng lấy phiên đăng nhập (30 ngày) để trình duyệt không phải lưu mật khẩu.
// POST với header x-app-password (+ x-app-otp nếu đã bật 2FA bằng TOTP_SECRET) → { token, exp }
export default async function handler(req, res) {
  noStore(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.APP_PASSWORD) {
    return res.status(500).json({ error: 'APP_PASSWORD chưa được cấu hình trong Environment Variables của Vercel' });
  }
  const otpNeeded = totpEnabled();
  let ok = passwordOk(req);
  try { if (ok && otpNeeded) ok = verifyTotp(req.headers['x-app-otp']); } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  if (!ok) {
    // làm chậm việc dò mật khẩu / mã
    await new Promise((r) => setTimeout(r, 800));
    return res.status(401).json({ error: otpNeeded ? 'Sai mật khẩu hoặc mã xác thực 2 bước' : 'Sai mật khẩu ứng dụng', otp: otpNeeded });
  }
  return res.status(200).json(issueSession());
}
