// 핸드폰 앱(PWA)용 서비스 워커.
// 화면 파일은 "네트워크 먼저, 안 되면 저장본" — PC가 꺼져 있어도 앱이 열리게 한다.
// 브리핑 데이터(/api)는 여기서 저장하지 않는다. 마지막 브리핑은 app.js 가 기기에 따로 보관한다.
const CACHE = 'briefing-shell-v1';
const SHELL = ['./', 'index.html', 'app.js', 'style.css', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // PIN 화면으로 돌려보낸 응답은 저장하지 않는다
        if (res.ok && !res.redirected) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('index.html'))),
  );
});
