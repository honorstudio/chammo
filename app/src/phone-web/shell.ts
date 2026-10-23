// 컴퓨터 화면 받아 두기 (ADR 0013 결정 1) — 터널로 컴퓨터 폰 화면(/ 껍데기 + 그 화면 파일)을 받아 서비스 워커 캐시에 넣는다.
// 화면은 늘 그 컴퓨터 판이라 /api 와 어긋나지 않는다. 이름에 해시가 붙은 파일은 이미 있으면 다시 안 받는다
import type { HubTunnel } from './hub';

export const UI_CACHE = 'chammo-relay-ui';
/** 껍데기 캐시 칸 — 서비스 워커가 / 열기(navigate)에 이걸 준다 */
export const SHELL_KEY = '/__shell';
const LINKED = /(?:src|href)="(\/assets\/[A-Za-z0-9._-]+\.(?:js|css))"/g;
const CSS_URL = /url\((\/assets\/[A-Za-z0-9._-]+\.(?:woff2?|png|svg|webp|jpg))\)/g;

/** 껍데기 CSP — 컴퓨터 PHONE_CSP 에서 connect-src 만 넓힌다(중계 wss·https, 테일넷 빠른 길) */
export function shellCsp(relay: string): string {
  const ws = relay.replace(/^http/, 'ws');
  return `default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' ${relay} ${ws} https://*.ts.net; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
}

export const linkedAssets = (html: string) => [...new Set([...html.matchAll(LINKED)].map((m) => m[1]!))];
export const cssAssets = (css: string) => [...new Set([...css.matchAll(CSS_URL)].map((m) => m[1]!))];

/** 받아 둔 껍데기의 입구 파일 이름(새 판 알아채기) */
export async function cachedShell(): Promise<string | null> {
  const r = await (await caches.open(UI_CACHE)).match(SHELL_KEY);
  return r ? r.text() : null;
}

/** 껍데기와 그 화면 파일을 받아 캐시에. 실패하면 오류(반쯤 받은 것은 남아도 껍데기는 끝에 넣어서 쓰이지 않는다) */
export async function fetchShell(t: HubTunnel, relay: string): Promise<void> {
  const cache = await caches.open(UI_CACHE);
  const res = await t.fetch('/', { headers: { accept: 'text/html' } });
  if (!res.ok) throw new Error(`컴퓨터 화면을 못 받았어요 (${res.status})`);
  const html = await res.text();
  const want = linkedAssets(html);
  for (const p of want) {
    if (await cache.match(p)) continue;
    const r = await t.fetch(p);
    if (!r.ok) throw new Error(`화면 파일을 못 받았어요 ${p} (${r.status})`);
    const body = await r.arrayBuffer();
    await cache.put(p, new Response(body, { headers: { 'Content-Type': r.headers.get('Content-Type') ?? 'application/octet-stream' } }));
    if (p.endsWith('.css')) {
      for (const f of cssAssets(new TextDecoder().decode(body))) {
        if (await cache.match(f)) continue;
        const fr = await t.fetch(f);
        if (fr.ok) await cache.put(f, new Response(await fr.arrayBuffer(), { headers: { 'Content-Type': fr.headers.get('Content-Type') ?? 'application/octet-stream' } }));
      }
    }
  }
  await cache.put(SHELL_KEY, new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': shellCsp(relay), 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' } }));
}

/** 짝짓기를 풀 때 — 받아 둔 화면도 지운다 */
export const dropShell = () => caches.delete(UI_CACHE);
