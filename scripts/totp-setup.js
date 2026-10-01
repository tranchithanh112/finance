// Tạo khóa 2FA (TOTP) cho app — chạy trên máy của bạn: node scripts/totp-setup.js
// 1) Thêm khóa vào Google Authenticator: "+" → "Nhập khóa thiết lập" (Enter a setup key) → loại "Theo thời gian".
// 2) Thêm biến TOTP_SECRET = <khóa> vào Environment Variables của Vercel rồi Redeploy.
// Kiểm tra lại 1 khóa có sẵn: node scripts/totp-setup.js <KHÓA>
import crypto from 'node:crypto';
import { base32Decode, totpCode } from '../api/_lib.js';

const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0;
  let val = 0;
  let out = '';
  for (const b of buf) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) { out += A[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += A[(val << (5 - bits)) & 31];
  return out;
}

const secret = process.argv[2] ? process.argv[2].toUpperCase().replace(/\s/g, '') : base32Encode(crypto.randomBytes(20));
const uri = `otpauth://totp/iFinance?secret=${secret}&issuer=iFinance&algorithm=SHA1&digits=6&period=30`;
const now = totpCode(base32Decode(secret), Math.floor(Date.now() / 30000));

console.log(`
Khóa (TOTP_SECRET):  ${secret}
Nhập vào app:         ${secret.match(/.{1,4}/g).join(' ')}
otpauth URI:          ${uri}

Mã hiện tại để đối chiếu với Google Authenticator: ${now}
Giữ kín khóa này — ai có nó đều tạo được mã 6 số.
`);
