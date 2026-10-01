import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { issueSession, verifySession, isAuthed } from '../api/_lib.js';

test('phiên đăng nhập: ký HMAC, hết hạn, đổi mật khẩu là mất hiệu lực', () => {
  const now = Date.UTC(2026, 0, 1);
  const { token, exp } = issueSession('secret-1', now);
  assert.ok(exp > now);
  assert.equal(verifySession(token, 'secret-1', now + 1000), true);
  assert.equal(verifySession(token, 'secret-2', now + 1000), false); // đổi APP_PASSWORD
  assert.equal(verifySession(token, 'secret-1', exp + 1), false); // hết hạn
  const [e, sig] = token.split('.');
  assert.equal(verifySession(`${Number(e) + 86400e3}.${sig}`, 'secret-1', now), false); // sửa hạn
  assert.equal(verifySession('', 'secret-1', now), false);
  assert.equal(verifySession(undefined, 'secret-1', now), false);
});

test('isAuthed nhận phiên hoặc mật khẩu (thiết bị cũ)', () => {
  process.env.APP_PASSWORD = 'pw-test';
  const { token } = issueSession();
  assert.equal(isAuthed({ headers: { 'x-app-session': token } }), true);
  assert.equal(isAuthed({ headers: { 'x-app-password': 'pw-test' } }), true);
  assert.equal(isAuthed({ headers: { 'x-app-password': 'wrong' } }), false);
  assert.equal(isAuthed({ headers: {} }), false);
});

test('CSP khớp với script inline trong index.html', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const csp = vercel.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  for (const code of inline) {
    const h = crypto.createHash('sha256').update(code).digest('base64');
    assert.ok(csp.includes(`'sha256-${h}'`), `thiếu hash cho script inline: sha256-${h}`);
  }
  // script ngoài phải có SRI
  for (const m of html.matchAll(/<script[^>]+src="https:[^"]+"[^>]*>/g)) assert.match(m[0], /integrity="sha384-/);
});

test('TOTP theo RFC 6238 (vector chuẩn) và cửa sổ ±30 giây', async () => {
  const { totpCode, verifyTotp, base32Decode } = await import('../api/_lib.js');
  // RFC 6238, SHA1, secret "12345678901234567890", T=59 → 94287082 (8 số)
  assert.equal(totpCode(Buffer.from('12345678901234567890'), Math.floor(59 / 30), 8), '94287082');
  assert.equal(totpCode(Buffer.from('12345678901234567890'), Math.floor(1111111109 / 30), 8), '07081804');
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // base32 của "12345678901234567890"
  assert.deepEqual(base32Decode(secret), Buffer.from('12345678901234567890'));
  const t = 1111111109 * 1000;
  const code = totpCode(base32Decode(secret), Math.floor(t / 30000));
  assert.equal(verifyTotp(code, secret, t), true);
  assert.equal(verifyTotp(code, secret, t + 30000), true); // lệch 1 bước
  assert.equal(verifyTotp(code, secret, t + 90000), false); // quá xa
  assert.equal(verifyTotp('000000', secret, t), code === '000000');
  assert.equal(verifyTotp('abc', secret, t), false);
});

test('bật 2FA: mật khẩu trần không đủ, phiên cũ mất hiệu lực', async () => {
  const { issueSession, isAuthed } = await import('../api/_lib.js');
  process.env.APP_PASSWORD = 'pw-test';
  delete process.env.TOTP_SECRET;
  const old = issueSession().token;
  assert.equal(isAuthed({ headers: { 'x-app-password': 'pw-test' } }), true);
  process.env.TOTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(isAuthed({ headers: { 'x-app-password': 'pw-test' } }), false);
  assert.equal(isAuthed({ headers: { 'x-app-session': old } }), false);
  assert.equal(isAuthed({ headers: { 'x-app-session': issueSession().token } }), true);
  delete process.env.TOTP_SECRET;
});
