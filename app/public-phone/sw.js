// 참모 폰 입구 서비스 워커 (ADR 0013) — 공개 입구 주소에서만 돈다(컴퓨터가 내보내는 테일넷 폰 화면은 public/sw.js).
// - / 열기: 받아 둔 컴퓨터 화면(터널로 받아 캐시한 껍데기)이 있으면 그것, 없으면 입구(망)
// - /assets/*: 캐시 → 터널을 가진 창에 대신 받기 부탁 → 망(입구 아이콘). /api/*(iframe·소리·내려받기·껍데기 새 판 확인)는 늘 창에 부탁
//   창이 터널로 컴퓨터에서 받아 온다 — 이 워커는 내용을 보관만 하고 중계에 직접 붙지 않는다
// - 웹 푸시: 컴퓨터가 이 구독 열쇠로 봉한 본문(제목·한 줄·갈 곳)을 중계가 그대로 실어 온다 — 브라우저가 풀어 준 것을 띄운다.
//   본문이 없으면(옛 컴퓨터·구독이 바뀜·간격) '새 메시지' 한 줄. 중계도 푸시 서비스도 내용을 모른다(2026-11-01, ADR 0013 결정 7)
const UI = 'chammo-relay-ui';
const SHELL = '/__shell';
const ASK_MS = 20_000;

self.addEventListener('install', () => self.skipWaiting());
// 새 워커가 깔리면 받아 둔 껍데기를 한 번 지워 입구를 거친다 — 껍데기는 터널로만 새 판을 받아서, 터널이 막힌 폰은 옛 화면에 영영 묶인다(2026-11-07 401).
// 입구가 터널을 다시 보고 새 껍데기를 받거나, 풀렸으면 다시 잇기를 보인다. 화면 파일(/assets)은 둔다 — 안 바뀐 건 다시 안 받는다
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  await (await caches.open(UI)).delete(SHELL);
  await self.clients.claim();
})()));

/** 터널을 가진 창(컴퓨터 화면·입구)에 요청을 넘기고 답을 받는다 */
async function viaWindow(req) {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (!wins.length) return new Response('no window', { status: 504 });
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.arrayBuffer();
  const url = new URL(req.url);
  const headers = {};
  for (const k of ['authorization', 'content-type', 'range', 'accept']) { const v = req.headers.get(k); if (v) headers[k] = v; }
  const ask = (w) => new Promise((ok) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => ok(null), ASK_MS);
    ch.port1.onmessage = (ev) => { clearTimeout(t); ok(ev.data); };
    w.postMessage({ chammoProxy: { method: req.method, path: url.pathname + url.search, headers, body } }, [ch.port2]);
  });
  for (const w of wins) {
    const r = await ask(w);
    if (r && typeof r.status === 'number') return new Response(r.status === 204 || r.status === 304 ? null : r.body, { status: r.status, headers: r.headers });
  }
  return new Response('컴퓨터에 못 닿았어요', { status: 504 });
}

// 화면 코드(.js·.css)는 터널로 그 컴퓨터에서 받은 것만 — 캐시에도 터널로 받은 것만 넣는다. 망(입구 호스팅)으로는 그림(아이콘·시작 그림)만(보안 검토 A)
const CODE = /\.(?:m?js|css|html?|wasm)$/i;
async function asset(req) {
  const cache = await caches.open(UI);
  const path = new URL(req.url).pathname;
  const hit = await cache.match(path);
  if (hit) return hit;
  const r = await viaWindow(req);
  if (r.ok) {
    await cache.put(path, r.clone());
    return r;
  }
  return CODE.test(path) ? r : fetch(req);
}

async function home(req) {
  const shell = await (await caches.open(UI)).match(SHELL);
  return shell || fetch(req);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html')) return e.respondWith(home(req));
  if (req.method === 'GET' && url.pathname.startsWith('/assets/')) return e.respondWith(asset(req));
  // 입구가 아닌 / (컴퓨터 화면의 새 판 확인 fetch('/'))와 /api 는 터널로
  if ((url.pathname === '/' && req.mode !== 'navigate') || url.pathname.startsWith('/api/')) return e.respondWith(viaWindow(req));
});

const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { /* 본문 없는 푸시 */ }
  const title = str(d && d.title, 80);
  const body = str(d && d.body, 120);
  const target = typeof d?.target === 'string' && d.target.length <= 200 ? d.target : '';
  if (!title && !body) return e.waitUntil(self.registration.showNotification('참모', { body: '새 메시지', icon: '/assets/icon-192.png', tag: 'chammo' }));
  e.waitUntil(self.registration.showNotification(title || '참모', { body, icon: '/assets/icon-192.png', tag: target || 'chammo', data: { target } }));
});

// 알림을 누르면 — 열린 창이 있으면 앞으로 가져와 갈 곳을 알리고(받았다는 답을 기다린다), 답이 없으면(옛 판·멈춘 페이지) 그 창을 갈 곳 주소로 다시 연다.
// 창이 없으면 새로 연다(?go=). 본문 없는 푸시는 갈 곳이 없어 latest — 앱이 컴퓨터에 마지막 알림 갈 곳을 묻는다(2026-10-23 결정 알림을 눌러도 보던 시트 그대로였다)
const GO_ACK_MS = 2000;
const goUrl = (t) => `/?go=${encodeURIComponent(t)}`;
function tell(w, target) {
  return new Promise((ok) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => ok(false), GO_ACK_MS);
    ch.port1.onmessage = () => { clearTimeout(t); ok(true); };
    w.postMessage({ go: target }, [ch.port2]);
  });
}
async function openTarget(target) {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const w = wins.find((x) => x.focused) || wins[0];
  if (!w) return self.clients.openWindow(goUrl(target));
  try { await w.focus(); } catch { /* 앞으로 못 가져와도 알리기는 한다 */ }
  if (await tell(w, target)) return;
  try { await w.navigate(goUrl(target)); } catch { await self.clients.openWindow(goUrl(target)); }
}
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const t = e.notification.data && e.notification.data.target;
  e.waitUntil(openTarget(typeof t === 'string' && t ? t : 'latest'));
});
