// 폰 서비스 워커(public/sw.js)를 가짜 self·caches·fetch 위에서 그대로 돌린다 — 화면 껍데기만 캐시하고 /api(데이터·대화·비밀)는 절대 안 담는지,
// 새 판이 나오면 옛 화면 파일이 안 남는지, 맥에 못 닿을 때 지난 껍데기로 뜨는지, 웹 푸시는 그대로인지(2026-10-04 폰 첫 켜기)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import swRaw from '../../../public/sw.js?raw';

const ORIGIN = 'https://mac.tail.ts.net';
type Handler = (e: unknown) => void;

/** 열쇠는 주소의 경로+쿼리로 — 진짜 Cache API 처럼 쿼리까지 가린다 */
const keyOf = (k: string | Request) => { const u = new URL(typeof k === 'string' ? k : k.url, ORIGIN); return u.pathname + u.search; };
function fakeCaches() {
  const store = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name)!;
    return {
      match: async (k: string | Request) => m.get(keyOf(k))?.clone(),
      put: async (k: string | Request, r: Response) => { m.set(keyOf(k), r); },
      keys: async () => [...m.keys()],
    };
  };
  return {
    store,
    api: {
      open,
      keys: async () => [...store.keys()],
      delete: async (name: string) => store.delete(name),
      match: async (k: string | Request) => { for (const m of store.values()) { const r = m.get(keyOf(k)); if (r) return r.clone(); } return undefined; },
    },
  };
}

function boot(net: (url: string) => Promise<Response>) {
  const handlers = new Map<string, Handler[]>();
  const caches = fakeCaches();
  const calls: string[] = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (t: string, f: Handler) => handlers.set(t, [...(handlers.get(t) ?? []), f]),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve(), matchAll: async () => [], openWindow: async () => null },
    registration: { showNotification: async () => {} },
  };
  const fetchFn = (r: string | Request) => { const url = typeof r === 'string' ? new URL(r, ORIGIN).href : r.url; calls.push(keyOf(url)); return net(url); };
  new Function('self', 'caches', 'fetch', swRaw)(self, caches.api, fetchFn);
  const fire = async (type: string, extra: object) => {
    const waits: Promise<unknown>[] = [];
    let resp: Promise<Response> | undefined;
    const ev = { ...extra, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (p: Promise<Response>) => { resp = p; } };
    for (const h of handlers.get(type) ?? []) h(ev);
    const r = resp ? await resp : undefined;
    await Promise.all(waits);
    return r;
  };
  const get = (path: string, mode: RequestMode = 'cors', method = 'GET') =>
    fire('fetch', { request: { url: new URL(path, ORIGIN).href, method, mode, headers: new Headers() } as unknown as Request });
  return { caches, calls, fire, get, handlers };
}

const html = (entry: string, extra = '') =>
  `<!doctype html><html><head><script type="module" crossorigin src="/assets/${entry}"></script><link rel="modulepreload" crossorigin href="/assets/client-AAAAAAAA.js"><link rel="stylesheet" crossorigin href="/assets/mobile-CCCCCCCC.css">${extra}</head><body><div id="boot-splash"></div><div id="root"></div></body></html>`;
const HEAD = { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'", 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store' };
const ok = (body: string, ct = 'text/javascript') => new Response(body, { status: 200, headers: { 'Content-Type': ct } });

describe('폰 서비스 워커 — 화면 껍데기 캐시', () => {
  let page = html('mobile-11111111.js');
  let down = false;
  let slow = 0;
  const net = async (url: string) => {
    if (down) throw new TypeError('Load failed');
    if (slow) await new Promise((r) => setTimeout(r, slow));
    const p = new URL(url).pathname;
    if (p === '/' || p === '/index.html') return new Response(page, { status: 200, headers: HEAD });
    if (p.startsWith('/api/')) return ok('{"secret":"대화 내용"}', 'application/json');
    if (p.startsWith('/assets/')) return ok(`/* ${p} */`, p.endsWith('.css') ? 'text/css' : 'text/javascript');
    return new Response('not found', { status: 404 });
  };
  beforeEach(() => { page = html('mobile-11111111.js'); down = false; slow = 0; });

  it('/api 는 손대지 않는다 — 응답을 가로채지도 담지도 않는다(늘 맥에서)', async () => {
    const sw = boot(net);
    for (const p of ['/api/env', '/api/sessions', '/api/transcript?id=x', '/api/file?path=%2Fa.png&thumb=1']) expect(await sw.get(p)).toBeUndefined();
    expect(sw.calls).toEqual([]);
    const all = [...sw.caches.store.values()].flatMap((m) => [...m.keys()]);
    expect(all.some((k) => k.startsWith('/api'))).toBe(false);
  });

  it('쓰기·남의 출처·해시 없는 파일은 그냥 둔다', async () => {
    const sw = boot(net);
    expect(await sw.get('/assets/mobile-11111111.js', 'cors', 'POST')).toBeUndefined();
    expect(await sw.get('https://cdn.example.com/assets/x-AAAAAAAA.js')).toBeUndefined();
    expect(await sw.get('/assets/icon-192.png')).toBeUndefined();
    expect(await sw.get('/manifest.webmanifest')).toBeUndefined();
    expect(await sw.get('/sw.js')).toBeUndefined();
  });

  it('해시 붙은 화면 파일은 한 번 받으면 다음부턴 맥에 안 묻는다', async () => {
    const sw = boot(net);
    const a = await sw.get('/assets/client-AAAAAAAA.js');
    expect(await a!.text()).toContain('client-AAAAAAAA');
    const b = await sw.get('/assets/client-AAAAAAAA.js');
    expect(await b!.text()).toContain('client-AAAAAAAA');
    expect(sw.calls.filter((c) => c === '/assets/client-AAAAAAAA.js')).toHaveLength(1);
  });

  it('실패한 응답(404·502)은 담지 않는다 — 다음에 다시 받는다', async () => {
    const bad = async (url: string) => new URL(url).pathname.startsWith('/assets/') ? new Response('bad gateway', { status: 502 }) : net(url);
    const sw = boot(bad);
    expect((await sw.get('/assets/client-AAAAAAAA.js'))!.status).toBe(502);
    await sw.get('/assets/client-AAAAAAAA.js');
    expect(sw.calls.filter((c) => c === '/assets/client-AAAAAAAA.js')).toHaveLength(2);
  });

  it('껍데기 html 은 늘 망 먼저 — 쿼리(짝짓기 코드·알림 대상)는 열쇠에 안 남긴다', async () => {
    const sw = boot(net);
    const r = await sw.get('/?pair=SECRETCODE', 'navigate');
    expect(await r!.text()).toContain('mobile-11111111.js');
    const keys = [...sw.caches.store.values()].flatMap((m) => [...m.keys()]);
    expect(keys).toContain('/');
    expect(keys.some((k) => k.includes('SECRETCODE') || k.includes('?'))).toBe(false);
    // 두 번째에도 망에 묻는다(새 판이 바로 보이게)
    await sw.get('/', 'navigate');
    expect(sw.calls.filter((c) => c.startsWith('/')).filter((c) => !c.startsWith('/assets')).length).toBe(2);
  });

  it('담아 둔 껍데기도 맥이 준 보안 머리(CSP·틀 금지)를 그대로 단다', async () => {
    const sw = boot(net);
    await sw.get('/', 'navigate');
    down = true;
    const r = await sw.get('/', 'navigate');
    expect(r!.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
    expect(r!.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('맥에 못 닿으면 지난 껍데기로 뜬다(그 뒤 앱이 이유와 다시 시도를 보인다)', async () => {
    const sw = boot(net);
    await sw.get('/', 'navigate');
    down = true;
    const r = await sw.get('/', 'navigate');
    expect(r!.status).toBe(200);
    expect(await r!.text()).toContain('boot-splash');
  });

  it('맥이 502(앱 꺼짐)를 주면 지난 껍데기로', async () => {
    let gateway = false;
    const sw = boot(async (u) => (gateway ? new Response('bad gateway', { status: 502 }) : net(u)));
    await sw.get('/', 'navigate');
    gateway = true;
    const r = await sw.get('/', 'navigate');
    expect(r!.status).toBe(200);
  });

  it('처음(담아 둔 게 없음)이면 망이 실패한 그대로 — 지어낸 화면을 안 준다', async () => {
    const sw = boot(net);
    down = true;
    await expect(sw.get('/', 'navigate')).rejects.toThrow();
  });

  it('망이 느리면(3초 넘게) 지난 껍데기를 먼저 주고 새 것은 뒤에서 담는다', async () => {
    const sw = boot(net);
    await sw.get('/', 'navigate');
    page = html('mobile-22222222.js');
    slow = 3300;
    const t0 = Date.now();
    const r = await sw.get('/', 'navigate'); // waitUntil 까지 기다리므로 뒤 담기도 끝난다
    expect(Date.now() - t0).toBeGreaterThanOrEqual(3200);
    expect(await r!.text()).toContain('mobile-11111111.js'); // 받은 건 지난 것
    slow = 0;
    down = true;
    expect(await (await sw.get('/', 'navigate'))!.text()).toContain('mobile-22222222.js'); // 다음엔 새 것
  }, 10_000);

  it('새 판 html 이 오면 두 판 전 화면 파일 캐시는 지운다 — 지난 판은 느린 망 대비로 하나만 남긴다', async () => {
    const sw = boot(net);
    await sw.get('/', 'navigate');
    await sw.get('/assets/mobile-11111111.js');
    page = html('mobile-22222222.js');
    await sw.get('/', 'navigate');
    await sw.get('/assets/mobile-22222222.js');
    const names1 = [...sw.caches.store.keys()].filter((k) => k.startsWith('chammo-assets'));
    expect(names1.length).toBeLessThanOrEqual(2);
    page = html('mobile-33333333.js');
    await sw.get('/', 'navigate');
    const all = [...sw.caches.store.values()].flatMap((m) => [...m.keys()]);
    expect(all).not.toContain('/assets/mobile-11111111.js'); // 두 판 전 — 지움
    expect(all).toContain('/assets/mobile-22222222.js'); // 바로 전 판 — 남김
    expect([...sw.caches.store.keys()].filter((k) => k.startsWith('chammo-assets')).length).toBeLessThanOrEqual(2);
  });

  it('판이 바뀌어도 이름이 같은 화면 파일(안 바뀐 라이브러리)은 지우지 않고 새 판 칸으로 옮긴다 — 다시 안 받는다', async () => {
    const sw = boot(net);
    await sw.get('/', 'navigate');
    await sw.get('/assets/client-AAAAAAAA.js'); // 1판 칸에 담김
    for (const v of ['22222222', '33333333', '44444444']) {
      page = html(`mobile-${v}.js`);
      await sw.get('/', 'navigate');
    }
    const before = sw.calls.filter((c) => c === '/assets/client-AAAAAAAA.js').length;
    await sw.get('/assets/client-AAAAAAAA.js');
    expect(sw.calls.filter((c) => c === '/assets/client-AAAAAAAA.js').length).toBe(before);
  });

  it('깔릴 때 껍데기와 그 화면 파일을 미리 담는다 — 다음 켜기부터 맥에 안 묻게. 첫 켜기 받기와 겹치지 않게 5초 뒤에', async () => {
    vi.useFakeTimers();
    const sw = boot(net);
    const done = sw.fire('install', {});
    await vi.advanceTimersByTimeAsync(4900);
    expect(sw.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    vi.useRealTimers();
    await done;
    const all = [...sw.caches.store.values()].flatMap((m) => [...m.keys()]);
    expect(all).toEqual(expect.arrayContaining(['/', '/assets/mobile-11111111.js', '/assets/client-AAAAAAAA.js', '/assets/mobile-CCCCCCCC.css']));
  });

  it('깔릴 때 맥에 못 닿아도 설치는 실패하지 않는다(푸시가 끊기지 않게)', async () => {
    vi.useFakeTimers();
    const sw = boot(net);
    down = true;
    const done = sw.fire('install', {});
    await vi.advanceTimersByTimeAsync(5100);
    vi.useRealTimers();
    await expect(done).resolves.toBeUndefined();
  });

  it('활성화 때 이름 모르는 옛 캐시(chammo- 로 시작하는 것)만 지운다', async () => {
    const sw = boot(net);
    await sw.caches.api.open('chammo-old-v0');
    await sw.caches.api.open('someone-else');
    await sw.get('/', 'navigate');
    await sw.fire('activate', {});
    const names = [...sw.caches.store.keys()];
    expect(names).not.toContain('chammo-old-v0');
    expect(names).toContain('someone-else');
    expect(names).toContain('chammo-shell-v1');
  });

  it('웹 푸시 처리는 그대로 있다', () => {
    const sw = boot(net);
    expect(sw.handlers.get('push')).toHaveLength(1);
    expect(sw.handlers.get('notificationclick')).toHaveLength(1);
  });
});
