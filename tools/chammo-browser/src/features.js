// 크롬 기능 끄기(맥) — 크롬은 켤 때 자기 앱을 임시 폴더로 복제하고 본체 실행 파일에 하드 링크를 건다(code sign clone, 업데이트 대비).
// 그 link() 가 /Applications 의 크롬 번들을 고치는 걸로 잡혀, 크롬을 띄운 앱(Chammo) 이름으로 '앱 관리' 차단 알림이 떴다
// (2026-10-05 아이맥 QA — tccd: accessing=Google Chrome Beta 본체, responsible=app.chammo.desktop, EPERM 이 5초씩 두 번 = 시작도 늦음).
// 공식 기능 스위치 MacAppCodeSignClone 을 끄면 link 가 0번(아이맥 fs_usage 실측). 업데이트는 구글 업데이터가 자기 이름으로 따로 한다.
//
// 크롬은 --disable-features 를 두 번 받으면 마지막 것만 쓴다(중복 합치기는 크로미움 시험 런처에만 있다) — 플레이라이트가 먼저 넣는
// 자기 끄기 목록이 지워지지 않게 그 목록을 그대로 앞에 둔다. 플레이라이트를 올려 목록이 바뀌면 test/features.test.js 가 깨진다
const PLAYWRIGHT_DISABLED = [
  'AvoidUnnecessaryBeforeUnloadCheckSync', 'DestroyProfileOnBrowserClose', 'DialMediaRouteProvider', 'GlobalMediaControls',
  'HttpsUpgrades', 'LensOverlay', 'MediaRouter', 'PaintHolding', 'ThirdPartyStoragePartitioning',
  'BlockOriginHeaderModificationOnRedirect', 'Translate', 'AutoDeElevate', 'OptimizationHints',
  'msForceBrowserSignIn', 'msEdgeUpdateLaunchServicesPreferredVersion',
];

// 가짜 키체인 — 쿠키 암호 열쇠를 맥 로그인 키체인에서 안 꺼낸다. 플레이라이트도 기본으로 넣지만 거기에만 기대지 않는다:
// ad-hoc 재서명 사본(Dock·⌘Tab 빼기, src/appcopy.js)을 이것 없이 띄우면 'Chrome Safe Storage' 키체인 창이 사람 화면에 떴다(2026-10-27 시험)
const KEYCHAIN_ARGS = ['--use-mock-keychain', '--password-store=basic'];

/** 맥이면 [--disable-features=플레이라이트 목록,MacAppCodeSignClone, 가짜 키체인], 아니면 [] — 플레이라이트가 사용자 인자를 자기 것 뒤에 붙이니 이게 이긴다 */
function featureArgs(platform = process.platform) {
  return platform === 'darwin' ? [`--disable-features=${[...PLAYWRIGHT_DISABLED, 'MacAppCodeSignClone'].join(',')}`, ...KEYCHAIN_ARGS] : [];
}

// 크롬 로그인 권유 버블 끄기 — 구글 계정으로 사이트에 로그인하면 크롬이 '나만의 Chrome 만들기 — <계정>으로 계속 / 계정 없이 Chrome 사용'을
// 띄웠다(2026-11-02 project-x). 크롬 자체 화면이라 앱 칸(CDP 그림)에선 안 눌린다. 크로미움 DiceWebSigninInterceptor 는 프로필 설정
// signin.interception_enabled 가 false 면 이 버블·프로필 전환 버블을 다 그만둔다(기능 스위치·명령줄 인자는 없다 — 설정 파일뿐).
// signin.allowed·--allow-browser-signin=false 는 쓰지 않는다: 크롬에 로그인돼 있던 프로필(이 맥 11개)을 켤 때 로그아웃시킨다.
// 크롬은 끌 때 자기 값으로 Preferences 를 덮으니 그 프로필 크롬이 꺼져 있을 때(띄우기 직전)만 쓴다
//
// 같은 자리에서 알림 권한 기본값도 '차단'(2) — 세션 크롬은 알림을 쓸 일이 없는데 거래소 같은 사이트가 열자마자 알림을 물어
// 크롬 자체 권한 풍선(320x178)이 떴다. 칸 입력은 CDP 로 페이지에만 가서 그 풍선은 안 눌렸다(2026-11-08 실측 — 풍선 '차단' 자리를 눌러도 prompt 그대로).
// 기본값 차단이면 requestPermission 이 바로 denied, 풍선 없음(크롬·크롬 베타, 새 프로필·쓰던 프로필 다 실측). --deny-permission-prompts 는 위치·카메라까지 다 막아 안 쓴다.
// 사람이 크롬 설정에서 고른 기본값(허용 1·차단 2)과 사이트별 예외는 그대로 둔다
//
// 또 https 균형 모드('항상 보안 연결 사용') 끄기 — 크롬 베타 158 은 이게 기본으로 켜져, http 주소를 https 로 올려 보다 안 되면
// 경고 화면을 띄우고 페이지 이동은 net::ERR_BLOCKED_BY_CLIENT 로 끝난다(2026-11-09 윈도우 PC 홈페이지 수집 10건 연속 실패, 맥 베타 158 재현).
// 플레이라이트가 끄는 HttpsUpgrades 와는 다른 길이고, 158 에선 기능 스위치(HttpsFirstBalancedModeAutoEnable)가 바이너리에서 빠져 실행 인자로는 못 끈다.
// 설정 칸 https_first_balanced_mode_enabled=false 하나로 풀린다(맥 베타 158 실측 — 정식 156 은 원래 안 막음). 정식도 158 이 되면 같은 일이라 채널과 상관없이 넣는다.
// 사람이 크롬 설정에서 켠 것(균형 true·엄격 https_only_mode_enabled true)은 그대로
//
// 또 크롬 자체 제안 풍선 끄기(2026-11-09 사용자 번역 풍선) — 칸 그림(SCK)엔 브라우저 창에 붙은 풍선까지 보이는데 칸 누름은 CDP 로 페이지에만 가서
// 'Google 번역 · 영어/한국어 · ⋮ · X' 풍선을 못 닫았다. 플레이라이트가 넣는 --disable-features=Translate 는 크롬 베타 158 에서 안 먹는다(실측 — 영어 페이지에 '이 페이지를 번역하시겠습니까?' 창 237x87).
// 설정 칸 translate.enabled=false 면 안 뜬다(실측). 같은 부류로 비밀번호 저장 제안(로그인은 CLAUDE.local.md 칸으로 한다)과 다운로드 풍선도 끈다 — OFFERS 목록.
// 비밀번호는 저장 제안만 끈다: 이미 저장된 것 채우기·사이트 로그인 유지(쿠키)는 그대로. 주소·카드 자동 완성은 끄지 않는다(사용자 11-10 — 끄면 자동 완성 목록도 사라진다,
// 카드 저장 풍선은 칸의 '크롬에서 보기' 길로). 사람이 크롬 설정에서 켠 것(칸이 true)은 안 건드린다
const fs = require('fs');
const path = require('path');

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

const BLOCK = 2;
const ALLOW = 1;

/** 알림 기본값을 차단으로 둘 자리인가 — 비었거나 물어봄(3)이면. 사람이 고른 허용·차단은 그대로 */
const notifyUnset = (prefs) => {
  const v = isObj(prefs.profile) && isObj(prefs.profile.default_content_setting_values) ? prefs.profile.default_content_setting_values.notifications : undefined;
  return v !== BLOCK && v !== ALLOW;
};

/** 끄는 제안 풍선 — [설정 칸 경로, 무엇]. 칸이 비었을 때만 false 를 넣는다(사람이 켠 true·이미 끈 false 는 그대로) */
const OFFERS = [
  [['translate', 'enabled'], '번역 제안(이 페이지를 번역하시겠습니까?)'],
  [['credentials_enable_service'], '비밀번호 저장 제안'],
  [['download_bubble', 'partial_view_enabled'], '다운로드가 끝나면 뜨는 풍선'],
];

/** 아직 사람이 안 고른(칸이 boolean 이 아닌) 제안들 */
const offersUnset = (prefs) => OFFERS.filter(([keys]) => {
  let v = prefs;
  for (const k of keys) v = isObj(v) ? v[k] : undefined;
  return typeof v !== 'boolean';
});

/** 그 제안 칸에 false — 가는 길의 칸이 객체가 아니면 객체로 바꾼다 */
function offerOff(prefs, keys) {
  let o = prefs;
  for (const k of keys.slice(0, -1)) {
    if (!isObj(o[k])) o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = false;
}

/** https 균형 모드를 끌 자리인가 — 사람이 아직 안 고른 프로필(칸 없음)이고 엄격 모드도 안 켰으면 */
const httpsUnset = (prefs) => typeof prefs.https_first_balanced_mode_enabled !== 'boolean' && prefs.https_only_mode_enabled !== true;

/** profileDir/Default/Preferences 에 signin.interception_enabled=false + 알림 기본 차단 + https 균형 모드 끔 + 제안 풍선(OFFERS) 끔 — 'set'·'already'·'running'(안 씀)·'bad'(깨진 파일, 안 씀)·'error'. 던지지 않는다 */
function quietSignin(profileDir, { running = false } = {}) {
  if (running) return 'running';
  const file = path.join(profileDir, 'Default', 'Preferences');
  try {
    let prefs = {};
    let text = null;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') return 'error'; }
    if (text !== null) {
      try { prefs = JSON.parse(text); } catch { return 'bad'; }
      if (!isObj(prefs)) return 'bad';
    }
    const signinOff = isObj(prefs.signin) && prefs.signin.interception_enabled === false;
    const offers = offersUnset(prefs);
    if (signinOff && !notifyUnset(prefs) && !httpsUnset(prefs) && !offers.length) return 'already';
    if (httpsUnset(prefs)) prefs.https_first_balanced_mode_enabled = false;
    for (const [keys] of offers) offerOff(prefs, keys);
    prefs.signin = { ...(isObj(prefs.signin) ? prefs.signin : {}), interception_enabled: false };
    if (notifyUnset(prefs)) {
      const prof = isObj(prefs.profile) ? prefs.profile : {};
      const defs = isObj(prof.default_content_setting_values) ? prof.default_content_setting_values : {};
      prefs.profile = { ...prof, default_content_setting_values: { ...defs, notifications: BLOCK } };
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.chammo-${process.pid}`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(prefs));
      fs.renameSync(tmp, file);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    return 'set';
  } catch {
    return 'error';
  }
}

// 이미 떠 있는 버블(설정을 넣기 전에 뜬 크롬) 닫기 — 버블 속은 크롬 내부 웹 화면이라 CDP 대상(browser_ui)으로 보인다.
// '계정 없이 Chrome 사용'(#cancel-button)을 누르고, 그 버튼이 없는 버블(프로필 전환 등)은 Esc — 크롬이 닫기(kDismissed)로 받는다.
// 계속(accept)은 누르지 않는다 — 사람 계정을 세션 크롬에 묶지 않는다
const BUBBLE_URL = 'chrome://signin-dice-web-intercept.top-chrome/';
const CANCEL_JS = `(() => { const a = document.querySelector('chrome-signin-app'); const b = a && a.shadowRoot && a.shadowRoot.querySelector('#cancel-button'); if (!b) return 'none'; b.click(); return 'cancel'; })()`;

/** port = { port, wsPath }(DevToolsActivePort). 닫은 버블 수, 못 하면 0 — 던지지 않는다 */
async function dismissSigninBubble(port, WS = globalThis.WebSocket, limitMs = 5000) {
  if (!WS || !port) return 0;
  let ws;
  let timer;
  const late = new Promise((r) => { timer = setTimeout(() => r(null), limitMs); });
  try {
    ws = new WS(`ws://127.0.0.1:${port.port}${port.wsPath}`);
    const opened = await Promise.race([new Promise((res, rej) => { ws.onopen = () => res(true); ws.onerror = rej; }), late]);
    if (!opened) return 0;
    let id = 0;
    const pend = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m.result || null); pend.delete(m.id); } };
    const send = (method, params = {}, sessionId) => Promise.race([new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); }), late]);
    const got = await send('Target.getTargets');
    const bubbles = ((got && got.targetInfos) || []).filter((t) => t.type === 'browser_ui' && String(t.url).startsWith(BUBBLE_URL));
    let n = 0;
    for (const t of bubbles) {
      const a = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
      const s = a && a.sessionId;
      if (!s) continue;
      const r = await send('Runtime.evaluate', { expression: CANCEL_JS, returnByValue: true }, s);
      if (!(r && r.result && r.result.value === 'cancel')) {
        const key = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 };
        await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key }, s);
        await send('Input.dispatchKeyEvent', { type: 'keyUp', ...key }, s);
      }
      n += 1;
    }
    return n;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
    try { if (ws) ws.close(); } catch { /* 닫힘 */ }
  }
}

module.exports = { PLAYWRIGHT_DISABLED, KEYCHAIN_ARGS, featureArgs, quietSignin, dismissSigninBubble, BUBBLE_URL, OFFERS };
