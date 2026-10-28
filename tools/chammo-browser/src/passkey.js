// 패스키 자동(2026-10-29) — 세션 크롬(ad-hoc 사본: Dock 숨김·선명한 칸)엔 맥 플랫폼 패스키가 없다(isUserVerifyingPlatformAuthenticatorAvailable=false,
// 크롬 패스키 창엔 휴대폰 QR·보안 키만 — 실측). 페이지가 패스키를 부르면 묻지 않고 같은 프로필을 구글 서명 크롬으로 다시 열고(src/winshow.js request),
// 패스키가 성공해 주소가 바뀌고 잠잠해지면(또는 사람 '다 했어') ad-hoc 사본으로 돌아온다. 쿠키·로그인은 프로필이 같아 이어진다(실측).
// 신호는 페이지에서 — 래퍼가 브라우저 CDP 에 붙어 모든 탭에 navigator.credentials 감시 스크립트와 바인딩을 넣는다.
// 크롬 자체 창 목록(앱 chrome_popup)은 창 이름을 화면 기록 권한이 있어야 읽어서 공개판에선 패스키라고 못 가른다
const BINDING = '__chammoPasskey';
const HOLD_MS = 6000; // ad-hoc 에서 원래 부름을 미루는 시간 — 그새 크롬이 바뀐다(다시 띄우기 3초 실측). 못 바꾸면 그대로 이어 간다

/** CDP 웹소켓 — 노드 22+ 는 전역, 20(앱이 까는 tools/bin/node)은 없어서 플레이라이트에 든 ws 로(10-29 실측: 없으면 감시가 소리 없이 안 붙었다) */
function defaultWS() {
  if (globalThis.WebSocket) return globalThis.WebSocket;
  try {
    const path = require('path');
    const mcp = path.dirname(require.resolve('@playwright/mcp/package.json'));
    return require(require.resolve('playwright-core/lib/utilsBundle', { paths: [mcp] })).ws;
  } catch {
    return undefined;
  }
}

/**
 * 탭에 넣는 감시 스크립트. hold = ad-hoc 사본(패스키 부름을 알리고 원래 부름은 wait 만큼 미룬다 — 래퍼가 못 바꿀 땐 0, 알리기만), 아니면 구글 크롬(그대로 부르고 성공을 알린다).
 * 한 번만 감싸고 갈래 값(__chammoPkHold·__chammoPkWait)만 새로 — 크롬을 바꾸면 새 세션이 다시 넣는다. 자동완성용 조건부 부름(mediation: conditional)은 로그인 칸마다 불려 바꾸는 신호가 아니다.
 * token 은 클로저에만 두고 알림에 같이 보낸다 — 바인딩은 페이지 누구나 부를 수 있어 래퍼가 토큰으로 이 스크립트 부름만 받는다(0.4.4 리뷰).
 * 바인딩·JSON 은 문서 시작(사이트 스크립트 전)에 잡아 둔다 — 나중에 사이트가 바꿔 끼워 토큰을 훔치지 못하게
 */
function pageScript(hold, { wait = HOLD_MS, token = '' } = {}) {
  return `(() => {
  window.__chammoPkHold = ${hold ? 'true' : 'false'};
  window.__chammoPkWait = ${Math.max(0, Number(wait) || 0)};
  const c = window.navigator && window.navigator.credentials;
  if (!c || window.__chammoPkWrapped) return;
  window.__chammoPkWrapped = true;
  const token = ${JSON.stringify(String(token))};
  const str = JSON.stringify;
  const first = window.${BINDING};
  const tell = (phase, kind) => {
    try {
      const b = typeof first === 'function' ? first : window.${BINDING};
      if (typeof b === 'function') { b(str(token ? { phase, kind, t: token } : { phase, kind })); return true; }
    } catch (e) {}
    return false;
  };
  for (const kind of ['get', 'create']) {
    if (typeof c[kind] !== 'function') continue;
    const o = c[kind].bind(c);
    c[kind] = function (opt) {
      if (!(opt && opt.publicKey)) return o(opt);
      if (window.__chammoPkHold) {
        if (opt.mediation === 'conditional' || !tell('ask', kind)) return o(opt);
        const wait = window.__chammoPkWait;
        if (!(wait > 0)) return o(opt);
        return new Promise((res) => setTimeout(() => res(o(opt)), wait));
      }
      const p = o(opt);
      p.then((r) => { if (r) tell('ok', kind); }, () => {});
      return p;
    };
  }
})()`;
}

/**
 * 브라우저 CDP 감시 — 모든 탭에 자동으로 붙어(Target.setAutoAttach, 페이지를 멈춰 세우지 않음) 감시 스크립트·바인딩을 넣고, 바인딩이 불리면 onSignal(phase, targetId).
 * 크롬이 다시 뜨거나(포트 바뀜) 갈래(signed)·바꿀 수 있나(canHold)가 바뀌면 새로 붙는다. 탭 주소는 url(targetId) — 성공 뒤 주소가 바뀌었나 본다
 * @param {{ readPort: () => ({port:number, wsPath:string}|null), signed: () => boolean, canHold?: () => boolean, onSignal: (phase:string, targetId:string) => void, WS?: any, log?: (m:string) => void }} o
 */
function createPasskeyWatch({ readPort, signed, canHold = () => true, onSignal, WS = defaultWS(), log = () => {} }) {
  const token = require('crypto').randomBytes(16).toString('hex');
  let ws = null;
  let key = '';
  let seq = 0;
  const sessions = new Map(); // sessionId → targetId
  const urls = new Map(); // targetId → url

  const send = (method, params = {}, sessionId) => {
    try { ws.send(JSON.stringify({ id: ++seq, method, params, ...(sessionId ? { sessionId } : {}) })); } catch { /* 닫힘 — 다음 tick 이 다시 붙는다 */ }
  };

  function drop() {
    if (ws) { const w = ws; ws = null; try { w.close(); } catch { /* 닫힘 */ } }
    sessions.clear();
    urls.clear();
  }

  function onMessage(m) {
    const p = m.params || {};
    if (m.method === 'Target.attachedToTarget' && p.targetInfo && p.targetInfo.type === 'page') {
      const sid = p.sessionId;
      sessions.set(sid, p.targetInfo.targetId);
      urls.set(p.targetInfo.targetId, p.targetInfo.url);
      const js = pageScript(hold, { wait: canWait ? HOLD_MS : 0, token });
      // 바인딩은 Runtime 을 켜야 페이지에 보인다(앱 agent_perm 과 같은 실측)
      send('Runtime.enable', {}, sid);
      send('Runtime.addBinding', { name: BINDING }, sid);
      // Page 를 켜야 새 문서 스크립트가 다른 프로세스로 넘어간 이동(about:blank → 사이트) 뒤에도 들어간다 — 없으면 바인딩만 남고 훅이 없었다(10-29 실측)
      send('Page.enable', {}, sid);
      send('Page.addScriptToEvaluateOnNewDocument', { source: js }, sid);
      send('Runtime.evaluate', { expression: js }, sid);
    } else if (m.method === 'Target.targetInfoChanged' && p.targetInfo && urls.has(p.targetInfo.targetId)) {
      urls.set(p.targetInfo.targetId, p.targetInfo.url);
    } else if (m.method === 'Target.detachedFromTarget') {
      const t = p.targetId || sessions.get(p.sessionId);
      sessions.delete(p.sessionId);
      if (t) urls.delete(t);
    } else if (m.method === 'Target.targetDestroyed') {
      urls.delete(p.targetId);
    } else if (m.method === 'Runtime.bindingCalled' && p.name === BINDING) {
      let v = null;
      try { v = JSON.parse(p.payload); } catch { return; }
      const t = sessions.get(m.sessionId);
      if (t && v && v.t === token && (v.phase === 'ask' || v.phase === 'ok')) onSignal(v.phase, t);
    }
  }

  let hold = true;
  let canWait = true;
  function tick() {
    const port = readPort();
    const mode = !!signed();
    const wait = !mode && !!canHold();
    const k = port ? `${port.port}${port.wsPath}|${mode}|${wait}` : '';
    if (k === key && ws) return;
    drop();
    key = k;
    if (!port || !WS) return;
    hold = !mode;
    canWait = wait;
    let w;
    try { w = new WS(`ws://127.0.0.1:${port.port}${port.wsPath}`); } catch (e) { log(`[chammo-browser-mcp] 패스키 감시 연결 실패: ${e.message}`); return; }
    ws = w;
    w.onopen = () => {
      if (ws !== w) return;
      send('Target.setDiscoverTargets', { discover: true });
      send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{ type: 'page', exclude: false }, { exclude: true }] });
    };
    w.onmessage = (e) => {
      if (ws !== w) return;
      let m;
      try { m = JSON.parse(typeof e.data === 'string' ? e.data : String(e.data)); } catch { return; }
      onMessage(m);
    };
    w.onclose = () => { if (ws === w) { ws = null; sessions.clear(); urls.clear(); } };
    w.onerror = () => {};
  }

  return { tick, url: (t) => urls.get(t), stop: () => { drop(); key = ''; } };
}

module.exports = { BINDING, HOLD_MS, pageScript, createPasskeyWatch, defaultWS };
