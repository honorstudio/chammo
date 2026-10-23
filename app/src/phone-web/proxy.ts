// 서비스 워커의 '대신 받기' 부탁에 답한다 (ADR 0013) — iframe·<audio>·내려받기처럼 fetch 를 못 거치는 요청을 워커가 넘기면 이 창의 터널로 받아 준다
import type { HubTunnel } from './hub';

type Ask = { chammoProxy?: { method: string; path: string; headers: Record<string, string>; body: ArrayBuffer | null } };

let installed = false;

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
        const body = await r.arrayBuffer();
        port.postMessage({ status: r.status, headers, body }, [body]);
      })
      .catch(() => port.postMessage({ status: 504, headers: {}, body: null }));
  });
}
