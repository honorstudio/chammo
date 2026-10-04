const { test } = require('node:test');
const assert = require('node:assert');
const { windowPosition, offsetFor, chromeArgs } = require('../src/window');

// 코코아 좌표(왼쪽 아래 원점, y 위로). screens[0] = 주 화면
const MAIN = [0, 0, 1920, 1080];
const LEFT = [-1470, 124, 1470, 956]; // 맥북 내장 화면이 왼쪽 아래에 붙은 모양

test('프로필마다 비키는 거리는 늘 같고 0~5칸', () => {
  assert.strictEqual(offsetFor('acme-shop'), offsetFor('acme-shop'));
  const all = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'acme', 'project-x'].map(offsetFor));
  for (const o of all) assert.ok(o >= 0 && o <= 5 * 36 && o % 36 === 0);
  assert.ok(all.size > 1);
});

test('사용자가 일하는 화면 말고 다른 화면에 — 크롬 좌표(왼쪽 위 원점)로', () => {
  const p = windowPosition({ screens: [MAIN, LEFT], main: MAIN, profile: 'x' });
  const off = offsetFor('x');
  // LEFT 의 위쪽 = 1080 - (124 + 956) = 0
  assert.deepStrictEqual(p, [-1470 + 24 + off, 0 + 48 + off]);
});

test('일하는 화면이 두 번째 화면이면 주 화면으로', () => {
  const p = windowPosition({ screens: [MAIN, LEFT], main: LEFT, profile: 'x' });
  assert.deepStrictEqual(p, [24 + offsetFor('x'), 48 + offsetFor('x')]);
});

test('화면이 하나면 그 화면 지금 자리 근처에서 프로필마다 비켜 놓는다', () => {
  const a = windowPosition({ screens: [MAIN], main: MAIN, profile: 'a' });
  assert.deepStrictEqual(a, [24 + offsetFor('a'), 48 + offsetFor('a')]);
});

test('화면 정보가 없으면 null', () => {
  assert.strictEqual(windowPosition({ screens: [], main: null, profile: 'a' }), null);
  assert.strictEqual(windowPosition(null), null);
});

test('크롬 인자: 경고 띠를 숨기는 --test-type, 자리가 있으면 --window-position', () => {
  assert.deepStrictEqual(chromeArgs([10, -20], false, null, 'linux'), ['--test-type', '--window-position=10,-20']);
  assert.deepStrictEqual(chromeArgs(null, false, null, 'linux'), ['--test-type']);
});

const { windowSize } = require('../src/window');

test('크롬 창 크기 — 그 화면 안에 들어오게(오른쪽·아래 16px 남기고), 최대 1400x880', () => {
  // 맥북 내장 화면(왼쪽, 1470x956): 위치 -1446,48 → 남은 폭 1470-24-16=1430 → 1400, 남은 높이 956-48-16=892 → 880
  const info = { screens: [MAIN, LEFT], main: MAIN, profile: 'x' };
  const pos = [-1470 + 24, 48];
  assert.deepStrictEqual(windowSize(info, pos), [1400, 880]);
  // 작은 화면(1280x800)이면 화면에 맞춰 줄인다
  const small = [0, 0, 1280, 800];
  assert.deepStrictEqual(windowSize({ screens: [small], main: small, profile: 'x' }, [24 + 180, 48 + 180]), [1280 - 204 - 16, 800 - 228 - 16]);
  // 화면을 모르면 크기를 안 정한다
  assert.strictEqual(windowSize(null, pos), null);
});

test('크롬 인자 — 크기도 같이', () => {
  assert.deepStrictEqual(chromeArgs([1, 2], false, [1400, 880], 'linux'), ['--test-type', '--window-position=1,2', '--window-size=1400,880']);
});

const { virtualDisplay } = require('../src/window');
const fsx = require('fs');
const osx = require('os');
const pathx = require('path');

test('가상 모니터 — 앱이 적은 자리가 있고 그 도우미가 살아 있으면 거기에 크롬 창(크기는 그 화면 안)', () => {
  const d = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'chammo-vd-'));
  const f = pathx.join(d, 'vdisplay.json');
  assert.strictEqual(virtualDisplay(f, () => true), null, '파일 없으면 null');
  fsx.writeFileSync(f, JSON.stringify({ pid: 4242, bounds: [3390, 1080, 1440, 900] }));
  assert.deepStrictEqual(virtualDisplay(f, (p) => p === 4242), { pos: [3390 + 24, 1080 + 24], size: [1394, 852] });
  assert.strictEqual(virtualDisplay(f, () => false), null, '도우미가 죽었으면 null(보이는 창으로)');
  fsx.writeFileSync(f, '{깨짐');
  assert.strictEqual(virtualDisplay(f, () => true), null);
  fsx.writeFileSync(f, JSON.stringify({ pid: 1, bounds: [0, 0, 100, 100] }));
  assert.strictEqual(virtualDisplay(f, () => true), null, '너무 작은 화면은 안 쓴다');
});

const { chromeChannel } = require('../src/window');

test('세션 크롬 채널 — 크롬 베타가 깔려 있으면 베타(사용자 크롬과 Dock·앞으로 가져오기가 안 섞이게), 없으면 기본(일반 크롬)', () => {
  const has = (paths) => (p) => paths.includes(p);
  assert.strictEqual(chromeChannel({ platform: 'darwin', exists: has(['/Applications/Google Chrome Beta.app']), env: {} }), 'chrome-beta');
  assert.strictEqual(chromeChannel({ platform: 'darwin', exists: has([]), env: {} }), null);
  // 윈도우 — 베타는 Chrome Beta 폴더
  const winEnv = { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', ProgramFiles: 'C:\\Program Files' };
  assert.strictEqual(chromeChannel({ platform: 'win32', exists: has(['C:\\Program Files\\Google\\Chrome Beta\\Application\\chrome.exe']), env: winEnv }), 'chrome-beta');
  assert.strictEqual(chromeChannel({ platform: 'win32', exists: has([]), env: winEnv }), null);
  // 손으로 고정(CHAMMO_BROWSER_CHANNEL=chrome 이면 베타가 있어도 일반 크롬)
  assert.strictEqual(chromeChannel({ platform: 'darwin', exists: has(['/Applications/Google Chrome Beta.app']), env: { CHAMMO_BROWSER_CHANNEL: 'chrome' } }), null);
  assert.strictEqual(chromeChannel({ platform: 'darwin', exists: has([]), env: { CHAMMO_BROWSER_CHANNEL: 'chrome-beta' } }), 'chrome-beta');
  // Chrome for Testing 같은 다른 이름은 받지 않는다
  assert.strictEqual(chromeChannel({ platform: 'darwin', exists: has([]), env: { CHAMMO_BROWSER_CHANNEL: 'chromium' } }), null);
});

const { waitVirtualDisplay, offscreenPosition } = require('../src/window');

test('가짜 화면 기다리기 — 앱이 다시 켜지는 사이면 자리 파일이 곧 생긴다(몇 초까지)', () => {
  let n = 0;
  const vd = { pos: [1, 2], size: [3, 4] };
  const got = waitVirtualDisplay(() => (++n >= 3 ? vd : null), { ms: 1000, step: 1, sleep: () => {} });
  assert.deepStrictEqual(got, vd);
  assert.strictEqual(n, 3);
});

test('가짜 화면 기다리기 — 끝내 없으면 null(기다린 만큼만)', () => {
  let t = 0;
  const got = waitVirtualDisplay(() => null, { ms: 300, step: 100, sleep: (ms) => { t += ms; } });
  assert.strictEqual(got, null);
  assert.strictEqual(t, 300);
});

test('화면 밖 자리 — 모든 화면 오른쪽 바깥(크롬 좌표)', () => {
  // 코코아 좌표: 맥북 0,0 1470x956 + 가짜 화면 왼쪽 아래
  const p = offscreenPosition({ screens: [[0, 0, 1470, 956], [-1440, -900, 1440, 900]] });
  assert.ok(p[0] >= 1470 + 1000, `오른쪽 바깥 ${p}`);
  assert.strictEqual(offscreenPosition(null), null);
});

const { chromeLaunch } = require('../src/window');

test('크롬 고르기 — 베타가 ~/Applications 에 있으면(관리자 아닌 계정) 실행 파일 경로를 같이 준다(플레이라이트는 /Applications 만 본다)', () => {
  const has = (paths) => (p) => paths.includes(p);
  const home = '/Users/u';
  const userBeta = '/Users/u/Applications/Google Chrome Beta.app';
  assert.deepStrictEqual(chromeLaunch({ platform: 'darwin', exists: has(['/Applications/Google Chrome Beta.app']), env: {}, home }), { channel: 'chrome-beta', executablePath: null, found: true });
  assert.deepStrictEqual(chromeLaunch({ platform: 'darwin', exists: has([userBeta]), env: {}, home }),
    { channel: 'chrome-beta', executablePath: `${userBeta}/Contents/MacOS/Google Chrome Beta`, found: true });
  // 베타 없고 일반 크롬만 — 기본 채널
  assert.deepStrictEqual(chromeLaunch({ platform: 'darwin', exists: has(['/Applications/Google Chrome.app']), env: {}, home }), { channel: null, executablePath: null, found: true });
  assert.deepStrictEqual(chromeLaunch({ platform: 'darwin', exists: has(['/Users/u/Applications/Google Chrome.app']), env: {}, home }),
    { channel: null, executablePath: '/Users/u/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', found: true });
  // 아무 크롬도 없음 — found false(래퍼가 '설치' 안내로 막는다)
  assert.deepStrictEqual(chromeLaunch({ platform: 'darwin', exists: has([]), env: {}, home }), { channel: null, executablePath: null, found: false });
  // 윈도우 — 일반 크롬만 있어도 found
  const winEnv = { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' };
  assert.strictEqual(chromeLaunch({ platform: 'win32', exists: has(['C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe']), env: winEnv, home }).found, true);
  assert.strictEqual(chromeLaunch({ platform: 'win32', exists: has([]), env: winEnv, home }).found, false);
});
