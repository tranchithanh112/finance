import { test } from 'node:test';
import assert from 'node:assert/strict';

// store.js đọc localStorage khi import → stub trước
globalThis.localStorage = { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = v; } };
const { login, local } = await import('../js/store.js');

const reply = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('login: 401 → false (sai mật khẩu), không lưu phiên', async () => {
  globalThis.fetch = reply(401, { error: 'Sai mật khẩu ứng dụng' });
  assert.equal(await login('x'), false);
  assert.equal(local.session, undefined);
});

test('login: server lỗi → throw kèm lời của server, không coi là sai mật khẩu', async () => {
  globalThis.fetch = reply(500, { error: 'APP_PASSWORD chưa được cấu hình' });
  await assert.rejects(login('x'), /APP_PASSWORD chưa được cấu hình/);
  globalThis.fetch = reply(502, {});
  await assert.rejects(login('x'), /HTTP 502/);
});

test('login: mất mạng → throw "Không kết nối được server"', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(login('x'), /Không kết nối được server/);
});

test('login: đúng → lưu phiên', async () => {
  globalThis.fetch = reply(200, { token: 't', exp: 123 });
  assert.equal(await login('x'), true);
  assert.deepEqual(local.session, { token: 't', exp: 123 });
});
