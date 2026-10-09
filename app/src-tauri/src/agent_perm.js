// 세션 브라우저 권한 감시(앱 agent_browser.rs 가 일꾼이 붙은 탭에만 넣는다) — 숨긴 크롬의 위치·알림 말풍선은 모달 그림에 안 찍혀
// 사람이 못 본다. 그 권한이 '물어봄'이면 크롬에 넘기기 전에 앱에 알리고(바인딩), 앱이 허용·거부(Browser.setPermission)하면 바뀐 상태로 원래 함수를 부른다.
// 앱이 없으면(바인딩 없음)·이미 정해졌으면 바로 원래대로. 60초 안 정하면 크롬에 넘긴다(크롬 말풍선 — 크롬에서 보기)
(() => {
  if (window.__chammoPermWrapped) return;
  window.__chammoPermWrapped = true;
  const B = '__chammoPerm';
  const ask = (kind) => new Promise((res) => {
    if (typeof window[B] !== 'function' || !navigator.permissions) return res();
    navigator.permissions.query({ name: kind }).then((st) => {
      if (st.state !== 'prompt') return res();
      try { window[B](JSON.stringify({ kind })); } catch (e) { return res(); }
      const until = Date.now() + 60000;
      const t = setInterval(() => {
        navigator.permissions.query({ name: kind }).then((s) => { if (s.state !== 'prompt' || Date.now() > until) { clearInterval(t); res(); } }, () => { clearInterval(t); res(); });
      }, 300);
    }, () => res());
  });
  const g = navigator.geolocation;
  if (g && typeof g.getCurrentPosition === 'function') {
    const get = g.getCurrentPosition.bind(g);
    const watch = g.watchPosition.bind(g);
    const clear = g.clearWatch.bind(g);
    const ids = new Map();
    let seq = 0;
    g.getCurrentPosition = function (...a) { ask('geolocation').then(() => get(...a)); };
    // watchPosition 은 번호를 바로 돌려줘야 한다 — 우리 번호를 주고 진짜 번호와 잇는다
    g.watchPosition = function (...a) {
      const mine = 1e6 + ++seq;
      ids.set(mine, null);
      ask('geolocation').then(() => { if (ids.has(mine)) ids.set(mine, watch(...a)); });
      return mine;
    };
    g.clearWatch = function (id) {
      if (!ids.has(id)) return clear(id);
      const real = ids.get(id);
      ids.delete(id);
      if (real != null) clear(real);
    };
  }
  if (window.Notification && typeof Notification.requestPermission === 'function') {
    const o = Notification.requestPermission.bind(Notification);
    Notification.requestPermission = function (cb) {
      const p = ask('notifications').then(() => o());
      if (typeof cb === 'function') p.then(cb);
      return p;
    };
  }
})();
