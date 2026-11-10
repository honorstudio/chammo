const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PLAYWRIGHT_DISABLED, KEYCHAIN_ARGS, featureArgs } = require('../src/features');
const { chromeArgs, AUTOMATION_ARG } = require('../src/window');

/** 깔린 playwright-core 의 기본 끄기 목록(chromiumSwitches.ts) — 번들 글에서 그 배열만 읽는다 */
function installedList() {
  const dir = path.dirname(require.resolve('playwright-core/package.json'));
  const src = fs.readFileSync(path.join(dir, 'lib', 'coreBundle.js'), 'utf8');
  const m = /disabledFeatures = \[([\s\S]*?)\]\.filter\(Boolean\)/.exec(src);
  assert.ok(m, 'playwright-core 번들에서 disabledFeatures 를 못 찾음 — 모양이 바뀌었으면 features.js 를 다시 맞출 것');
  return [...m[1].replace(/\/\/.*$/gm, '').matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

test('플레이라이트 끄기 목록을 그대로 들고 있다 — 플레이라이트를 올려 목록이 바뀌면 여기서 깨진다', () => {
  assert.deepStrictEqual(PLAYWRIGHT_DISABLED, installedList());
});

test('맥이면 --disable-features 한 줄에 플레이라이트 목록 + MacAppCodeSignClone(크롬은 같은 스위치를 두 번 받으면 마지막만 쓴다)', () => {
  const a = featureArgs('darwin').filter((x) => x.startsWith('--disable-features='));
  assert.strictEqual(a.length, 1);
  const list = a[0].slice('--disable-features='.length).split(',');
  for (const f of installedList()) assert.ok(list.includes(f), `${f} 가 빠지면 플레이라이트가 끈 기능이 다시 켜진다`);
  assert.ok(list.includes('MacAppCodeSignClone'));
});

test('맥이 아니면 아무것도 안 붙인다(code sign clone 은 맥 전용)', () => {
  assert.deepStrictEqual(featureArgs('win32'), []);
  assert.deepStrictEqual(featureArgs('linux'), []);
});

test('세션 크롬 인자에도 맥이면 붙는다', () => {
  assert.deepStrictEqual(chromeArgs(null, false, null, 'darwin'), ['--test-type', AUTOMATION_ARG, ...featureArgs('darwin')]);
  assert.deepStrictEqual(chromeArgs(null, false, null, 'linux'), ['--test-type', AUTOMATION_ARG]);
});

// 2026-10-27 — ad-hoc 재서명 사본(Dock 빼기)을 이 두 인자 없이 띄우면 맥 키체인 'Chrome Safe Storage' 창이 사람 화면에 떴다(시험 크롬, 19:02).
// 플레이라이트 기본 인자에만 기대지 않고 세션 크롬을 띄우는 모든 길(MCP 설정·스크립트 지킴이·설치 시험 열기)에 직접 넣는다
test('맥 세션 크롬은 늘 가짜 키체인 — 사람 키체인 창이 안 뜨게', () => {
  for (const a of [featureArgs('darwin'), chromeArgs(null, false, null, 'darwin'), chromeArgs([1, 2], true, [800, 600], 'darwin')]) {
    for (const k of KEYCHAIN_ARGS) assert.ok(a.includes(k), `${k} 가 빠지면 키체인 창이 뜬다: ${a.join(' ')}`);
  }
  assert.deepStrictEqual(KEYCHAIN_ARGS, ['--use-mock-keychain', '--password-store=basic']);
});

// 2026-10-29 — 앱 서랍 '참모 브라우저'(스크립트 길 launch → launchPersistentContext)엔 이 인자가 없어 navigator.webdriver 가 true 였고
// 구글이 이메일 단계에서 /v3/signin/rejected('브라우저 또는 앱이 안전하지 않을 수 있습니다')로 막았다. MCP 길은 플레이라이트 MCP 가 넣어 줘서 됐다
// (새 프로필 + 실제 계정 실측: 스크립트 길 거절 · 인자 넣으면 패스키 화면 · MCP 길 패스키 화면). 세션 크롬을 띄우는 모든 길에 직접 넣는다
test('세션 크롬은 어느 길·어느 OS 든 자동화 표시(navigator.webdriver)를 끈다 — 구글 로그인 거절 막기', () => {
  for (const p of ['darwin', 'win32', 'linux']) {
    for (const a of [chromeArgs(null, false, null, p), chromeArgs([1, 2], true, [800, 600], p)]) {
      assert.ok(a.includes(AUTOMATION_ARG), `${p}: ${a.join(' ')}`);
      assert.strictEqual(a.filter((x) => x.startsWith('--disable-blink-features')).length, 1, '크롬은 같은 스위치를 두 번 받으면 마지막만 쓴다');
    }
  }
  assert.strictEqual(AUTOMATION_ARG, '--disable-blink-features=AutomationControlled');
});

test('플레이라이트 MCP 는 우리 인자가 있으면 자기 것을 또 안 넣는다 — MCP 길에서 두 번 붙지 않는다', () => {
  const dir = path.dirname(require.resolve('playwright-core/package.json'));
  const src = fs.readFileSync(path.join(dir, 'lib', 'coreBundle.js'), 'utf8');
  assert.match(src, /if \(!browser\.launchOptions\.args\.some\(\(a\) => a\.includes\("--disable-blink-features"\)\)\)\s*browser\.launchOptions\.args\.push\(`--disable-blink-features=AutomationControlled`\)/,
    '플레이라이트 MCP 의 AutomationControlled 넣기가 바뀌었다 — chromeArgs 의 AUTOMATION_ARG 와 겹치지 않나 다시 볼 것');
});

// 2026-11-02 — 세션 크롬에서 구글 계정으로 사이트에 로그인하면 크롬이 '나만의 Chrome 만들기 — <계정>으로 계속 / 계정 없이 Chrome 사용'
// 버블(DiceWebSigninInterceptor kChromeSignin)을 띄웠고, 크롬 자체 화면이라 앱 칸(CDP 그림)에서 안 눌려 안 닫혔다.
// 끄는 길은 프로필 설정 signin.interception_enabled=false(크로미움 GetHeuristicOutcome → kAbortInterceptionDisabled).
// signin.allowed·--allow-browser-signin=false 는 크롬에 로그인된 프로필을 로그아웃시켜(이 맥 세션 프로필 11개) 쓰지 않는다
const os = require('os');
const { quietSignin, dismissSigninBubble, BUBBLE_URL } = require('../src/features');

function tmpProfile(prefs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-signin-'));
  if (prefs !== undefined) {
    fs.mkdirSync(path.join(dir, 'Default'));
    fs.writeFileSync(path.join(dir, 'Default', 'Preferences'), typeof prefs === 'string' ? prefs : JSON.stringify(prefs));
  }
  return dir;
}
const readPrefs = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'Default', 'Preferences'), 'utf8'));

// 알림 권한 기본 차단(2026-11-08 거래소) — 세션 크롬은 알림 쓸 일이 없는데, 크롬 자체 권한 풍선은 앱 칸(CDP 입력)에서 안 눌렸다
// https 균형 모드 끄기(2026-11-09 윈도우 PC 수집 스크립트) — 크롬 베타 158 은 이게 기본으로 켜져, https 가 안 되는 http 사이트를 net::ERR_BLOCKED_BY_CLIENT 로 막았다.
// 158 에선 기능 스위치(HttpsFirstBalancedModeAutoEnable)가 없어져 실행 인자로는 못 끈다 — 설정 칸 하나로 끈다(맥 베타 158 실측)
// 크롬 자체 제안 풍선 끄기(2026-11-09 사용자 번역 풍선) — 칸 그림엔 보이는데 칸 누름은 페이지로만 가서 X 를 못 눌렀다
const OFFERS_OFF = { translate: { enabled: false }, credentials_enable_service: false, download_bubble: { partial_view_enabled: false } };
const QUIET = { signin: { interception_enabled: false }, profile: { default_content_setting_values: { notifications: 2 } }, https_first_balanced_mode_enabled: false, ...OFFERS_OFF };
// 어제(11-09 낮)까지 판이 손본 프로필 — 제안 풍선 칸만 비었다
const YESTERDAY = { signin: { interception_enabled: false }, profile: { default_content_setting_values: { notifications: 2 } }, https_first_balanced_mode_enabled: false };

test('로그인 권유 끄기 — 새 프로필이면 Default/Preferences 를 만들어 interception_enabled=false 와 알림 기본 차단만 넣는다', () => {
  const dir = tmpProfile();
  assert.strictEqual(quietSignin(dir), 'set');
  assert.deepStrictEqual(readPrefs(dir), QUIET);
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'Default')), ['Preferences'], '임시 파일이 남지 않는다');
});

test('로그인 권유 끄기 — 있던 설정(사이트 로그인·다른 signin 값)은 그대로 두고 그 한 칸만', () => {
  const before = { profile: { name: 'project-x' }, account_info: [{ email: 'a@b.c' }], signin: { allowed: true, accounts_metadata_dict: { 1: { x: 1 } } } };
  const dir = tmpProfile(before);
  assert.strictEqual(quietSignin(dir), 'set');
  const after = readPrefs(dir);
  assert.deepStrictEqual(after, { ...before, signin: { ...before.signin, interception_enabled: false }, profile: { name: 'project-x', default_content_setting_values: { notifications: 2 } }, https_first_balanced_mode_enabled: false, ...OFFERS_OFF });
  assert.strictEqual(after.signin.allowed, true, 'signin.allowed 를 끄면 크롬에 로그인된 프로필이 로그아웃된다 — 건드리지 않는다');
});

test('로그인 권유 끄기 — 이미 꺼져 있으면 파일을 다시 쓰지 않는다', () => {
  const dir = tmpProfile({ ...QUIET, z: 1 });
  const f = path.join(dir, 'Default', 'Preferences');
  const t = new Date('2020-01-01');
  fs.utimesSync(f, t, t);
  assert.strictEqual(quietSignin(dir), 'already');
  assert.strictEqual(fs.statSync(f).mtimeMs, t.getTime());
});

test('로그인 권유 끄기 — 크롬이 그 프로필을 쓰는 중이면 안 쓴다(끌 때 크롬이 자기 값으로 덮는다)', () => {
  const dir = tmpProfile({ a: 1 });
  assert.strictEqual(quietSignin(dir, { running: true }), 'running');
  assert.deepStrictEqual(readPrefs(dir), { a: 1 });
});

test('로그인 권유 끄기 — 깨진 파일·객체가 아닌 JSON 은 손대지 않는다(크롬이 알아서 하게)', () => {
  for (const bad of ['{"a":', '[1,2]', 'null', '"x"']) {
    const dir = tmpProfile(bad);
    assert.strictEqual(quietSignin(dir), 'bad', bad);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'Default', 'Preferences'), 'utf8'), bad);
  }
});

test('로그인 권유 끄기 — signin 칸이 객체가 아니면 객체로 바꿔 넣는다', () => {
  const dir = tmpProfile({ signin: 'x', k: 2 });
  assert.strictEqual(quietSignin(dir), 'set');
  assert.deepStrictEqual(readPrefs(dir), { ...QUIET, k: 2 });
});

test('알림 기본 차단 — 로그인 권유만 꺼져 있던 프로필(어제까지 판)에도 넣고, 다른 기본값·사이트별 예외는 그대로', () => {
  const before = { signin: { interception_enabled: false }, profile: { default_content_setting_values: { geolocation: 1 }, content_settings: { exceptions: { notifications: { 'https://a.com:443,*': { setting: 1 } } } } } };
  const dir = tmpProfile(before);
  assert.strictEqual(quietSignin(dir), 'set');
  const after = readPrefs(dir);
  assert.deepStrictEqual(after.profile.default_content_setting_values, { geolocation: 1, notifications: 2 });
  assert.deepStrictEqual(after.profile.content_settings, before.profile.content_settings, '사람이 허용해 둔 사이트는 그대로 받는다');
});

test('알림 기본 차단 — 사람이 크롬 설정에서 고른 기본값(허용 1·차단 2)은 안 바꾼다, 물어봄(3)이면 차단으로', () => {
  for (const [v, want, r] of [[1, 1, 'already'], [2, 2, 'already'], [3, 2, 'set']]) {
    const dir = tmpProfile({ signin: { interception_enabled: false }, profile: { default_content_setting_values: { notifications: v } }, https_first_balanced_mode_enabled: false, ...OFFERS_OFF });
    assert.strictEqual(quietSignin(dir), r, String(v));
    assert.strictEqual(readPrefs(dir).profile.default_content_setting_values.notifications, want, String(v));
  }
});

test('알림 기본 차단 — profile·기본값 칸이 객체가 아니면 객체로 바꿔 넣는다', () => {
  for (const profile of ['x', [1], null]) {
    const dir = tmpProfile({ profile });
    assert.strictEqual(quietSignin(dir), 'set');
    assert.deepStrictEqual(readPrefs(dir), QUIET, JSON.stringify(profile));
  }
  const dir = tmpProfile({ profile: { default_content_setting_values: 7, name: 'n' } });
  assert.strictEqual(quietSignin(dir), 'set');
  assert.deepStrictEqual(readPrefs(dir).profile, { name: 'n', default_content_setting_values: { notifications: 2 } });
});

test('https 균형 모드 끄기 — 어제까지 판으로 손본 프로필(로그인 권유·알림만 꺼짐)에도 넣는다', () => {
  const dir = tmpProfile({ signin: { interception_enabled: false }, profile: { default_content_setting_values: { notifications: 2 } }, k: 1 });
  assert.strictEqual(quietSignin(dir), 'set');
  assert.deepStrictEqual(readPrefs(dir), { ...QUIET, k: 1 });
});

test('제안 풍선 끄기 — 이미 쓰던 프로필(어제까지 판)에도 번역·저장 제안·다운로드 풍선을 끈다', () => {
  const dir = tmpProfile({ ...YESTERDAY, translate_blocked_languages: ['ko'], autofill: { last_version_deduped: 158 } });
  assert.strictEqual(quietSignin(dir), 'set');
  const after = readPrefs(dir);
  assert.deepStrictEqual(after, { ...QUIET, translate_blocked_languages: ['ko'], autofill: { last_version_deduped: 158 } }, '자동 완성(주소·카드)은 안 건드린다');
  assert.strictEqual(quietSignin(dir), 'already', '두 번째 판은 그대로');
});

test('제안 풍선 끄기 — 사람이 크롬 설정에서 켠 것(true)은 그대로, 하나만 비어도 그것만 채운다', () => {
  const dir = tmpProfile({ ...YESTERDAY, translate: { enabled: true }, credentials_enable_service: true, download_bubble: { partial_view_enabled: true } });
  assert.strictEqual(quietSignin(dir), 'already');
  assert.strictEqual(readPrefs(dir).translate.enabled, true);
  const one = tmpProfile({ ...YESTERDAY, translate: { enabled: true, x: 1 }, credentials_enable_service: false });
  assert.strictEqual(quietSignin(one), 'set');
  assert.deepStrictEqual(readPrefs(one).translate, { enabled: true, x: 1 });
  assert.deepStrictEqual(readPrefs(one).download_bubble, { partial_view_enabled: false });
});

test('제안 풍선 끄기 — 가는 길의 칸이 객체가 아니거나 값이 boolean 이 아니면 바꿔 넣는다', () => {
  for (const bad of ['x', [1], null, 0]) {
    const dir = tmpProfile({ ...YESTERDAY, translate: bad, download_bubble: bad, credentials_enable_service: bad });
    assert.strictEqual(quietSignin(dir), 'set', JSON.stringify(bad));
    assert.deepStrictEqual(readPrefs(dir), QUIET, JSON.stringify(bad));
  }
  const dir = tmpProfile({ ...YESTERDAY, ...OFFERS_OFF, translate: { enabled: 'false' } });
  assert.strictEqual(quietSignin(dir), 'set', "글자 'false' 는 크롬이 안 읽는다");
  assert.strictEqual(readPrefs(dir).translate.enabled, false);
});

test('https 균형 모드 끄기 — 사람이 크롬 설정에서 켠 것(균형 true·엄격 https_only_mode_enabled true)은 그대로', () => {
  const base = { signin: { interception_enabled: false }, profile: { default_content_setting_values: { notifications: 2 } }, ...OFFERS_OFF };
  const on = tmpProfile({ ...base, https_first_balanced_mode_enabled: true });
  assert.strictEqual(quietSignin(on), 'already');
  assert.strictEqual(readPrefs(on).https_first_balanced_mode_enabled, true);
  const strict = tmpProfile({ ...base, https_only_mode_enabled: true });
  assert.strictEqual(quietSignin(strict), 'already', '엄격 모드를 켠 사람은 http 를 막길 원한 것');
  assert.strictEqual(readPrefs(strict).https_first_balanced_mode_enabled, undefined);
});

test('로그인 권유 끄기 — 못 써도 던지지 않는다(크롬은 그대로 뜬다)', () => {
  const dir = tmpProfile({ a: 1 });
  fs.chmodSync(path.join(dir, 'Default'), 0o500);
  try {
    assert.strictEqual(quietSignin(dir), 'error');
    assert.deepStrictEqual(readPrefs(dir), { a: 1 });
  } finally {
    fs.chmodSync(path.join(dir, 'Default'), 0o700);
  }
  assert.strictEqual(quietSignin(path.join(dir, 'Default', 'Preferences', 'no')), 'error', '프로필 자리가 파일이면');
});

/** 가짜 CDP 웹소켓 — 보낸 것을 sent 에 쌓고 handle(msg) 의 답을 돌려준다 */
function fakeWS(handle, { fail = false } = {}) {
  const sent = [];
  class WS {
    constructor(url) { this.url = url; WS.last = this; setTimeout(() => (fail ? this.onerror(new Error('x')) : this.onopen()), 0); }
    send(s) { const m = JSON.parse(s); sent.push(m); setTimeout(() => this.onmessage({ data: JSON.stringify({ id: m.id, ...(handle(m) || { result: {} }) }) }), 0); }
    close() { this.closed = true; }
  }
  return { WS, sent };
}
const PORT = { port: 9333, wsPath: '/devtools/browser/abc' };
const targets = (list) => (m) => (m.method === 'Target.getTargets' ? { result: { targetInfos: list } } : m.method === 'Target.attachToTarget' ? { result: { sessionId: `s-${m.params.targetId}` } } : null);

test('뜬 버블 닫기 — 버블이 없으면 0, 다른 크롬 화면(주소창 목록)엔 붙지 않는다', async () => {
  const { WS, sent } = fakeWS(targets([{ targetId: 'o', type: 'browser_ui', url: 'chrome://omnibox-popup.top-chrome/' }, { targetId: 'p', type: 'page', url: `${BUBBLE_URL}chrome-signin` }]));
  assert.strictEqual(await dismissSigninBubble(PORT, WS), 0);
  assert.deepStrictEqual(sent.map((m) => m.method), ['Target.getTargets']);
  assert.strictEqual(WS.last.url, 'ws://127.0.0.1:9333/devtools/browser/abc');
  assert.ok(WS.last.closed);
});

test("뜬 버블 닫기 — '계정 없이 Chrome 사용'(cancel)을 누른다, 계속(accept)은 절대 안 누른다", async () => {
  const base = targets([{ targetId: 'b', type: 'browser_ui', url: `${BUBBLE_URL}chrome-signin` }]);
  const { WS, sent } = fakeWS((m) => base(m) || (m.method === 'Runtime.evaluate' ? { result: { result: { value: 'cancel' } } } : null));
  assert.strictEqual(await dismissSigninBubble(PORT, WS), 1);
  const ev = sent.find((m) => m.method === 'Runtime.evaluate');
  assert.strictEqual(ev.sessionId, 's-b');
  assert.match(ev.params.expression, /#cancel-button/);
  assert.doesNotMatch(ev.params.expression, /accept/);
  assert.ok(!sent.some((m) => m.method === 'Input.dispatchKeyEvent'), '눌렀으면 Esc 는 안 보낸다');
});

test('뜬 버블 닫기 — 버튼을 못 찾는 버블(프로필 전환 등)은 Esc(크롬이 닫기로 받는다)', async () => {
  const base = targets([{ targetId: 'b', type: 'browser_ui', url: BUBBLE_URL }]);
  const { WS, sent } = fakeWS((m) => base(m) || (m.method === 'Runtime.evaluate' ? { result: { result: { value: 'none' } } } : null));
  assert.strictEqual(await dismissSigninBubble(PORT, WS), 1);
  const keys = sent.filter((m) => m.method === 'Input.dispatchKeyEvent');
  assert.deepStrictEqual(keys.map((k) => [k.params.type, k.params.key, k.sessionId]), [['rawKeyDown', 'Escape', 's-b'], ['keyUp', 'Escape', 's-b']]);
});

test('뜬 버블 닫기 — 웹소켓·포트가 없거나 연결 실패면 0(던지지 않는다)', async () => {
  assert.strictEqual(await dismissSigninBubble(null, fakeWS(() => null).WS), 0);
  assert.strictEqual(await dismissSigninBubble(PORT, null), 0);
  assert.strictEqual(await dismissSigninBubble(PORT, fakeWS(() => null, { fail: true }).WS), 0);
});

test('뜬 버블 닫기 — 크롬이 답을 안 주면 시간 안에 0', async () => {
  class Mute { constructor() { setTimeout(() => this.onopen(), 0); } send() {} close() {} }
  const t = Date.now();
  assert.strictEqual(await dismissSigninBubble(PORT, Mute, 200), 0);
  assert.ok(Date.now() - t < 2000);
});
