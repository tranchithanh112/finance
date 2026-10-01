// TOTP (RFC 6238) phía trình duyệt — chỉ dùng để TẠO khóa 2FA và thử mã ngay trên máy,
// khóa không được gửi đi đâu (người dùng tự dán vào Vercel).

const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes) {
  let bits = 0;
  let val = 0;
  let out = '';
  for (const b of bytes) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) { out += A[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += A[(val << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s) {
  let bits = 0;
  let val = 0;
  const out = [];
  for (const c of String(s).toUpperCase().replace(/[\s=-]/g, '')) {
    const i = A.indexOf(c);
    if (i < 0) throw new Error('Khóa không hợp lệ');
    val = (val << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

export const newSecret = () => base32Encode(crypto.getRandomValues(new Uint8Array(20)));

export async function totpCode(secret, counter) {
  const key = await crypto.subtle.importKey('raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new ArrayBuffer(8);
  new DataView(msg).setUint32(4, counter >>> 0); // đủ cho bộ đếm 30 giây tới năm 2106
  new DataView(msg).setUint32(0, Math.floor(counter / 2 ** 32));
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 1e6).padStart(6, '0');
}

export async function checkCode(secret, code, now = Date.now()) {
  const step = Math.floor(now / 30000);
  for (const d of [-1, 0, 1]) if ((await totpCode(secret, step + d)) === String(code).trim()) return true;
  return false;
}

export const otpauthUri = (secret) =>
  `otpauth://totp/iFinance?secret=${secret}&issuer=iFinance&algorithm=SHA1&digits=6&period=30`;
