// 참모 폰 서비스 워커 — 웹 푸시 + 화면 껍데기 캐시(2026-10-04 LTE 첫 켜기에 화면 파일 565KB 를 매번 맥에서 받았다)
// 담는 것은 둘만: 이름에 해시가 붙은 화면 파일(/assets/이름-해시.js·css — 내용이 바뀌면 이름이 바뀌니 낡을 일 없음)과 껍데기 html('/').
// /api(데이터·대화·파일·비밀)는 가로채지도 담지도 않는다 — 늘 맥에서. 열쇠엔 쿼리를 안 남긴다(짝짓기 코드 ?pair= 가 캐시에 안 남게)
// html 은 늘 망 먼저(새 판이 바로 보이게) — 3초 안에 안 오거나 실패·502 면 지난 껍데기. 새 판 html 이 오면 두 판 전 화면 파일을 지운다
const SHELL = 'chammo-shell-v1';
const ASSETS = 'chammo-assets-'; // + 그 판 입구 파일 이름 — 판마다 따로 담고 바로 전 판 하나만 남긴다
const HTML_WAIT_MS = 3000;
/** 깔릴 때 미리 담기를 이만큼 늦춘다 — 첫 켜기의 썸네일·대화와 같은 망을 나눠 써서 '다 참'이 2.5초 늦어졌다(나쁜 LTE 실측) */
const PRECACHE_DELAY_MS = 5000;
const HASHED = /^\/assets\/[A-Za-z0-9._-]+-[A-Za-z0-9_-]{8}\.(?:js|css)$/;
const ENTRY = /src="\/assets\/(mobile-[A-Za-z0-9_-]{8}\.js)"/;
const LINKED = /(?:src|href)="(\/assets\/[A-Za-z0-9._-]+\.(?:js|css))"/g;

const entryOf = (html) => (ENTRY.exec(html) || [])[1] || '';
const linked = (html) => [...new Set([...html.matchAll(LINKED)].map((m) => m[1]))].filter((p) => HASHED.test(p));
const nowEntry = async () => { const r = await (await caches.open(SHELL)).match('/__entry'); return r ? r.text() : ''; };

/** 받은 껍데기를 담는다 — 맥이 준 머리(CSP·틀 금지 등)를 그대로. 입구가 바뀌었으면(새 판) 두 판 전 화면 파일을 지운다 */
async function keepShell(res) {
  const html = await res.text();
  const shell = await caches.open(SHELL);
  const was = await nowEntry();
  const entry = entryOf(html);
  if (entry !== was) {
    // 새 판 html 이 가리키는 파일 중 이미 담아 둔 것(이름이 안 바뀐 라이브러리 등)은 새 판 칸으로 옮긴다 — 옛 칸과 같이 지워져 다시 받지 않게
    const fresh = await caches.open(ASSETS + entry);
    for (const p of linked(html)) {
      if (await fresh.match(p)) continue;
      const hit = await caches.match(p);
      if (hit) await fresh.put(p, hit);
    }
    const keep = [ASSETS + entry, ASSETS + was];
    for (const k of await caches.keys()) if (k.startsWith(ASSETS) && !keep.includes(k)) await caches.delete(k);
    await shell.put('/__entry', new Response(entry));
  }
  const headers = new Headers(res.headers);
  headers.delete('Content-Length');
  await shell.put('/', new Response(html, { status: 200, headers }));
  return html;
}

const isShell = (res) => res.ok && (res.headers.get('Content-Type') || '').startsWith('text/html');

/** 껍데기 — 망 먼저. 담아 둔 게 있으면 3초·실패·502 에 그걸로, 새 것은 뒤에서 담는다. 처음이면 망 그대로 */
function shellResponse(e) {
  const net = fetch(e.request).then(async (res) => {
    if (isShell(res)) await keepShell(res.clone());
    return res;
  });
  e.waitUntil(net.catch(() => {}));
  return (async () => {
    const old = await (await caches.open(SHELL)).match('/');
    if (!old) return net;
    const fresh = net.then((r) => (r.ok ? r : Promise.reject(new Error(`HTTP ${r.status}`))));
    const late = new Promise((r) => setTimeout(() => r(old), HTML_WAIT_MS));
    return Promise.race([fresh, late]).catch(() => old);
  })();
}

/** 해시 붙은 화면 파일 — 담아 둔 게 있으면 그것, 없으면 받아서 지금 판 칸에(성공한 것만) */
async function asset(req, path) {
  const hit = await caches.match(path);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await (await caches.open(ASSETS + (await nowEntry()))).put(path, res.clone());
  return res;
}

// 깔릴 때 — 껍데기와 그 화면 파일을 미리 담는다(첫 켜기에 페이지가 받은 것은 아직 서비스 워커 밖이라 못 담았다). 실패해도 설치는 된다(푸시가 끊기지 않게)
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    try {
      await new Promise((r) => setTimeout(r, PRECACHE_DELAY_MS));
      const res = await fetch('/', { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(10_000) });
      if (!isShell(res)) return;
      const html = await keepShell(res);
      const cache = await caches.open(ASSETS + entryOf(html));
      await Promise.all(linked(html).map(async (p) => { if (await cache.match(p)) return; const r = await fetch(p, { credentials: 'omit' }); if (r.ok) await cache.put(p, r); }));
    } catch { /* 맥에 못 닿음 — 다음 켜기에 담는다 */ }
  })().then(() => self.skipWaiting()));
});
// 활성화 — 이름 모르는 옛 참모 캐시만 지운다(남의 캐시는 안 건드림)
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('chammo-') && k !== SHELL && !k.startsWith(ASSETS)) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/' || url.pathname === '/index.html') {
    if (req.mode === 'navigate') e.respondWith(shellResponse(e));
    return;
  }
  if (HASHED.test(url.pathname)) e.respondWith(asset(req, url.pathname));
});

// 웹 푸시 — 맥 앱이 RFC 8291 로 암호화해 보낸 {title, body, target}
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { /* 빈 몸통이면 제목만 */ }
  const target = typeof d.target === 'string' ? d.target : '';
  e.waitUntil(self.registration.showNotification(d.title || '참모', { body: d.body || '', icon: '/assets/icon-192.png', tag: target || undefined, data: { target } }));
});

// 알림을 누르면 — 열려 있는 화면이 있으면 그리로(그 참모로 옮기라고 알린다), 없으면 새로 연다(?go=)
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.target) || '';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      w.postMessage({ go: target });
      return w.focus();
    }
    return self.clients.openWindow(target ? `/?go=${encodeURIComponent(target)}` : '/');
  })());
});
