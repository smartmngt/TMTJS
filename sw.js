/* 새 앱(주소 /TMTJS/, 보이는 이름 TMT) 서비스워커 — 지금 앱 sw.js와 같은 동작, 저장 이름만 새 앱(tmt2)으로 바꿔 두 앱이 서로의 캐시·저장소를 건드리지 않게 함
   ─ 아래는 지금 앱 설명 그대로 ─
   배당·자산관리 셸 서비스워커 — 자동 갱신형(network-first) + 푸시 알림
   · 화면(HTML/JS/CSS)은 항상 최신을 우선으로 받아옴 → 새 버전 올리면 자동 반영(캐시 삭제 불필요)
   · 아이콘 등 정적 자원만 캐시로 빠르게
   · API(JSON) 응답은 SW가 아예 손대지 않음 → 현재가·검색·공시가 항상 실시간
   · 푸시: TMT 알림 서버(수파베이스)가 보낸 알림을 띄우고, 누르면 그 종목 화면으로 연다

   버전 올리는 법: 아래 CACHE 숫자만 tmt2-v1 → tmt2-v2 … 로 올리면, 모든 기기가
   앱 열 때 새 워커로 자동 교체됨(index.html의 자동 새로고침과 함께). */
const CACHE = 'tmt2-v1';

self.addEventListener('install', e => { self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    // 같은 사이트(github.io)에 지금 앱도 있어서, 새 앱 캐시(tmt2-)만 정리한다 — 지금 앱 캐시는 건드리지 않음
    await Promise.all(keys.filter(k => k.startsWith('tmt2-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // 화면 자원: HTML/JS/CSS/manifest + 네비게이션 + 루트
  const isDoc = req.mode === 'navigate' ||
                /\.(html|js|css|json)$/.test(url.pathname) ||
                url.pathname === '/';
  // 정적 자원: 아이콘·이미지·폰트
  const isStatic = /\.(png|ico|webmanifest|svg|jpg|jpeg|webp|gif|woff2?)$/.test(url.pathname);

  if (isDoc) {
    // network-first: 최신 화면 우선, 오프라인이면 캐시로 폴백
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req))
    );
  } else if (isStatic) {
    // cache-first: 잘 안 바뀌는 자원은 캐시로 빠르게
    e.respondWith(
      caches.match(req).then(cached =>
        cached || fetch(req).then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
      )
    );
  }
  // 그 외(/search, /price, /fxrate, /dividends, /addr, /gongsiga, /status, /warm 등 API):
  //   SW가 개입하지 않음 → 브라우저가 곧장 네트워크로 → 항상 최신 데이터
});

// ---------------- 푸시 알림 ----------------
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'TMT';
  const opt = { body: d.body || '', icon: 'icon-192.png', data: { url: d.url || './' }, timestamp: d.ts || Date.now() };
  if (d.tag) { opt.tag = d.tag; opt.renotify = true; }
  e.waitUntil(self.registration.showNotification(title, opt));
});

// 알림을 누르면: 열려 있는 TMT가 있으면 그 창을 앞으로 + 해당 화면으로, 없으면 새로 연다
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope)) {
        try { await c.focus(); } catch (_) {}
        c.postMessage({ type: 'nav', url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

// 브라우저가 푸시 구독을 바꾸면 새 구독을 알림 서버에 다시 등록 (앱이 저장해 둔 연결 정보 사용)
function idbGetSW(key) {
  return new Promise(res => {
    try {
      const r = indexedDB.open('tmt2_data', 1);
      r.onupgradeneeded = () => { try { r.result.createObjectStore('kv'); } catch (_) {} };
      r.onerror = () => res(null);
      r.onsuccess = () => {
        try {
          const t = r.result.transaction('kv', 'readonly');
          const q = t.objectStore('kv').get(key);
          q.onsuccess = () => res(q.result || null);
          q.onerror = () => res(null);
        } catch (_) { res(null); }
      };
    } catch (_) { res(null); }
  });
}
function b64uToU8(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const raw = atob(s);
  return Uint8Array.from(raw, ch => ch.charCodeAt(0));
}
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    try {
      const raw = await idbGetSW('tmt2.al');
      const c = raw ? JSON.parse(raw) : null;
      if (!c || !c.key || !c.api || !c.vapid) return;
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToU8(c.vapid) });
      await fetch(c.api + '/alert/push/sub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-owner-key': c.key },
        body: JSON.stringify({ sub: sub.toJSON(), label: c.label || '기기', detail: c.detail || '' }),
      });
    } catch (_) { /* 다음에 앱을 열면 앱이 다시 등록 */ }
  })());
});
