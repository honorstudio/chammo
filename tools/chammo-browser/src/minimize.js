// 가짜 화면이 없을 때 화면 밖에 띄운 세션 크롬 — 크롬·맥이 화면 안으로 끌어온 창만 최소화한다(2026-10-03, 맥북 하나일 때 사용자 화면에 보였다).
// 127.0.0.1 CDP 로만. 노드에 WebSocket 이 없으면(22 미만) 아무것도 안 한다
const LIMIT_MS = 5000;

/** port = { port, wsPath }(DevToolsActivePort), off = 띄운 화면 밖 자리 [왼쪽, 위]. 돌려주는 값 = 최소화한 창 수 */
async function minimizePulledIn(port, off, WS = globalThis.WebSocket) {
  if (!WS || !port || !off) return 0;
  const ws = new WS(`ws://127.0.0.1:${port.port}${port.wsPath}`);
  const timer = new Promise((r) => setTimeout(() => r('timeout'), LIMIT_MS).unref?.());
  try {
    const opened = await Promise.race([new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }), timer]);
    if (opened === 'timeout') return 0;
    let id = 0;
    const pend = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m.result || null); pend.delete(m.id); } };
    const send = (method, params = {}) => Promise.race([new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }), timer.then(() => null)]);
    const got = await send('Target.getTargets');
    const pages = ((got && got.targetInfos) || []).filter((t) => t.type === 'page');
    const seen = new Set();
    let n = 0;
    for (const t of pages) {
      const w = await send('Browser.getWindowForTarget', { targetId: t.targetId });
      if (!w || seen.has(w.windowId)) continue;
      seen.add(w.windowId);
      const b = w.bounds || {};
      const pulled = b.windowState !== 'minimized' && Math.abs((b.left ?? off[0]) - off[0]) > 100;
      if (pulled) {
        await send('Browser.setWindowBounds', { windowId: w.windowId, bounds: { windowState: 'minimized' } });
        n += 1;
      }
    }
    return n;
  } catch {
    return 0;
  } finally {
    try { ws.close(); } catch { /* 닫힘 */ }
  }
}

module.exports = { minimizePulledIn };
