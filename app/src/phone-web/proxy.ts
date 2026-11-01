// 서비스 워커의 '대신 받기' 부탁에 답한다 (ADR 0013) — iframe·<audio>·내려받기처럼 fetch 를 못 거치는 요청을 워커가 넘기면 이 창의 터널로 받아 준다
import type { HubTunnel } from './hub';

type Ask = { chammoProxy?: { method: string; path: string; headers: Record<string, string>; body: ArrayBuffer | null } };

let installed = false;

/** 시안 칸 길(/api/html)의 답은 응답 CSP 에 sandbox(같은 출처 허용 없이)가 있어야만 넘긴다 — 중계 길 시안 칸엔 sandbox 속성이 없어서(htmlFrame) 이 CSP 가 유일한 담이다 */
export function frameSafe(path: string, headers: Record<string, string>): boolean {
  const p = path.split('?')[0]!;
  if (p !== '/api/html' && !p.startsWith('/api/html/')) return true;
  const csp = Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-security-policy')?.[1] ?? '';
  return csp.split(/[;,]/).some((d) => /^sandbox(\s|$)/i.test(d.trim())) && !/allow-same-origin/i.test(csp);
}

export function installProxy(tunnel: () => HubTunnel) {
  if (installed || typeof navigator === 'undefined' || !navigator.serviceWorker) return;
  installed = true;
  navigator.serviceWorker.addEventListener('message', (ev: MessageEvent<Ask>) => {
    const a = ev.data?.chammoProxy;
    const port = ev.ports[0];
    if (!a || !port || !(a.path.startsWith('/api/') || a.path === '/' || a.path.startsWith('/assets/'))) return;
    void tunnel()
      .fetch(a.path, { method: a.method, headers: a.headers, body: a.body ?? undefined })
      .then(async (r) => {
        const headers: Record<string, string> = {};
        r.headers.forEach((v, k) => { headers[k] = v; });
        if (!frameSafe(a.path, headers)) { port.postMessage({ status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: null }); return; }
        const body = await r.arrayBuffer();
        port.postMessage({ status: r.status, headers, body }, [body]);
      })
      .catch(() => port.postMessage({ status: 504, headers: {}, body: null }));
  });
}
