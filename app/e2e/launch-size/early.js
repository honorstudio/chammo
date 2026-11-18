// launch-size 계측 — 시험 dist 의 index.html <head> 맨 앞에만 끼운다(원본 코드 아님).
// 켠 뒤 15초: 창 안 크기(innerWidth/innerHeight)가 바뀐 때, resize 사건, rAF 틈(50ms 넘게 못 그린 동안), 앱이 처음 그린 때 → debug_dump('launch')
(function () {
  if (window.__ls) return;
  const now = () => Date.now();
  const L = (window.__ls = { origin: Math.round(performance.timeOrigin), start: now(), sizes: [], resizes: [], gaps: [], firstApp: 0, frames: 0 });
  let last = '', prev = 0;
  const root = () => { const r = document.getElementById('root'); return r ? r.childElementCount : 0; };
  window.addEventListener('resize', () => L.resizes.push([now(), innerWidth, innerHeight]));
  const f = () => {
    const t = now();
    L.frames++;
    if (prev && t - prev > 50) L.gaps.push([prev, t - prev]);
    prev = t;
    const key = innerWidth + 'x' + innerHeight + ':' + document.documentElement.clientWidth;
    if (key !== last) { last = key; L.sizes.push([t, innerWidth, innerHeight, document.documentElement.clientWidth]); }
    if (!L.firstApp && root() > 0) L.firstApp = t;
    const ms = window.__lsMs || 15000;
    // __lsRafMs — rAF 를 이 시간까지만 돌린다(조용한 화면 판: 계속 그리게 깨우지 않고 크기 바뀜을 resize 사건만으로 본다)
    if (t - L.start < Math.min(ms, window.__lsRafMs || ms)) requestAnimationFrame(f);
    else if (t - L.start >= ms) window.__TAURI_INTERNALS__.invoke('debug_dump', { name: 'launch', text: JSON.stringify(L) });
    else setTimeout(() => window.__TAURI_INTERNALS__.invoke('debug_dump', { name: 'launch', text: JSON.stringify(L) }), ms - (t - L.start));
  };
  requestAnimationFrame(f);
})();
