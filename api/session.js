import { issueSession, passwordOk, noStore } from './_lib.js';

// Đổi mật khẩu ứng dụng lấy phiên đăng nhập (30 ngày) để trình duyệt không phải lưu mật khẩu.
// POST với header x-app-password → { token, exp }
export default async function handler(req, res) {
  noStore(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.APP_PASSWORD) {
    return res.status(500).json({ error: 'APP_PASSWORD chưa được cấu hình trong Environment Variables của Vercel' });
  }
  if (!passwordOk(req)) {
    // làm chậm việc dò mật khẩu
    await new Promise((r) => setTimeout(r, 800));
    return res.status(401).json({ error: 'Sai mật khẩu ứng dụng' });
  }
  return res.status(200).json(issueSession());
}
