// Service worker chỉ chạy trên https nên khi test trên máy (http://localhost) không bao giờ được kích hoạt —
// lỗi của nó (vd biểu đồ trống vì CSP chặn tải Chart.js) chỉ lộ ra trên bản deploy. Các test này chạy sw.js
// trong môi trường giả lập để bắt sớm những lỗi đó.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const csp = vercel.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
const directive = (name) => (csp.split(';').map((d) => d.trim().split(/\s+/)).find(([n]) => n === name) || []).slice(1);

test('CSP connect-src cho phép mọi domain mà service worker tự tải (SW cũng chịu CSP)', () => {
  const cdn = JSON.parse(src.match(/const CDN = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  const connect = directive('connect-src');
  for (const prefix of cdn) {
    const origin = new URL(prefix).origin;
    assert.ok(connect.includes(origin), `connect-src thiếu ${origin} → SW không tải được tài nguyên từ đó`);
  }
  // mọi script ngoài trong index.html phải nằm trong danh sách SW xử lý được, và được script-src cho phép
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const [, url] of html.matchAll(/<script[^>]+src="(https:[^"]+)"/g)) {
    assert.ok(directive('script-src').includes(new URL(url).origin), `script-src thiếu ${url}`);
  }
});

/** Chạy sw.js với cache / mạng giả. */
function loadSw({ online, cached = {} }) {
  const listeners = {};
  const store = new Map(Object.entries(cached).map(([u, body]) => [u, new Response(body, { headers: { 'content-type': 'text/html' } })]));
  const cache = {
    async match(req, opts = {}) {
      const url = new URL(req.url);
      if (opts.ignoreSearch) url.search = '';
      const hit = store.get(url.href) || store.get(new URL('./', 'https://app.test/').href === url.href ? url.href : '');
      return hit ? hit.clone() : undefined;
    },
    async put(req, res) { store.set(req.url, res); },
  };
  const ctx = {
    self: {
      addEventListener: (t, fn) => { listeners[t] = fn; },
      skipWaiting() {}, clients: { claim: async () => {}, matchAll: async () => [] },
    },
    location: new URL('https://app.test/'),
    caches: { open: async () => cache, keys: async () => [], delete: async () => true, match: (r, o) => cache.match(r, o) },
    fetch: async (req) => {
      if (!online) throw new TypeError('Failed to fetch');
      return new Response(`network:${req.url}`, { status: 200 });
    },
    Request, Response, URL, Promise, console,
  };
  vm.runInNewContext(src, ctx);
  return async (request) => {
    let p = null;
    const waits = [];
    listeners.fetch({ request, respondWith: (x) => { p = x; }, waitUntil: (x) => waits.push(x) });
    const res = p ? await p : null;
    await Promise.all(waits);
    return res;
  };
}

const PAGE = 'https://app.test/';
const CHART = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js';

test('SW mất mạng: trang chính dùng bản đã lưu', async () => {
  const handle = loadSw({ online: false, cached: { [PAGE]: '<html>cached</html>' } });
  const res = await handle({ url: PAGE + '?code=x', method: 'GET', mode: 'navigate' });
  assert.equal(await res.text(), '<html>cached</html>');
});

test('SW mất mạng: script không bao giờ nhận HTML thay thế (lỗi biểu đồ trống)', async () => {
  const handle = loadSw({ online: false, cached: { [PAGE]: '<html>cached</html>' } });
  const res = await handle({ url: CHART, method: 'GET', mode: 'cors' });
  assert.equal(res.type, 'error');
});

test('SW có mạng: thư viện CDN được tải và lưu lại; /api không đi qua SW', async () => {
  const handle = loadSw({ online: true });
  const res = await handle({ url: CHART, method: 'GET', mode: 'cors' });
  assert.equal(await res.text(), `network:${CHART}`);
  assert.equal(await handle({ url: 'https://app.test/api/config', method: 'GET', mode: 'cors' }), null);
  assert.equal(await handle({ url: 'https://evil.example/x.js', method: 'GET', mode: 'cors' }), null);
});
