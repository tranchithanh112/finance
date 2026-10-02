// Service worker: mở app tức thì từ bản đã lưu (stale-while-revalidate), đồng thời tải bản mới ở nền
// cho lần mở sau. Không bao giờ cache /api (dữ liệu tài khoản).
const CACHE = 'finance-shell-v2';
// Thư viện / font bên ngoài cũng được lưu để mở app không phải chờ mạng
const CDN = ['https://cdn.jsdelivr.net/', 'https://fonts.googleapis.com/', 'https://fonts.gstatic.com/'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k); // dọn cache bản cũ
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;
  const sameOrigin = url.origin === location.origin;
  if (sameOrigin && url.pathname.startsWith('/api/')) return;
  if (!sameOrigin && !CDN.some((p) => req.url.startsWith(p))) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Trang chính: bỏ query (?code=… khi Dropbox chuyển về) để luôn dùng chung 1 bản đã lưu
    const key = req.mode === 'navigate' ? new Request(new URL('./', location).href) : req;
    const cached = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
    const before = req.mode === 'navigate' && cached ? cached.clone() : null; // để so sánh, vì `cached` sẽ trả cho trang
    const network = fetch(req)
      .then(async (res) => {
        if (res.ok || res.type === 'opaque') {
          // Trang chính đổi nội dung → báo app có bản mới (hiện nút tải lại)
          if (before && res.ok) {
            const [a, b] = await Promise.all([before.text(), res.clone().text()]);
            if (a !== b) (await self.clients.matchAll()).forEach((c) => c.postMessage('update-ready'));
          }
          await cache.put(key, res.clone());
        }
        return res;
      })
      .catch(() => null);
    if (cached) {
      e.waitUntil(network); // cập nhật nền
      return cached;
    }
    return (await network) || (await cache.match('./')) || Response.error();
  })());
});
