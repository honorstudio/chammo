const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sourceApp, copyDir, cloneable, mountType, staleEntries, updaterFixes, sessionChrome, APP_NAME } = require('../src/appcopy');

const HOME = '/Users/u';
const has = (list) => (p) => list.includes(p);
const BETA = '/Applications/Google Chrome Beta.app';
const STABLE = '/Applications/Google Chrome.app';

test('원본 앱 고르기 — 채널·실행 파일 경로에서 .app 을 찾는다', () => {
  assert.strictEqual(sourceApp({ channel: 'chrome-beta', executablePath: null, found: true }, { home: HOME, exists: has([BETA]) }), BETA);
  const userBeta = `${HOME}/Applications/Google Chrome Beta.app`;
  assert.strictEqual(sourceApp({ channel: 'chrome-beta', executablePath: `${userBeta}/Contents/MacOS/Google Chrome Beta`, found: true }, { home: HOME, exists: has([userBeta]) }), userBeta);
  assert.strictEqual(sourceApp({ channel: null, executablePath: null, found: true }, { home: HOME, exists: has([STABLE]) }), STABLE);
});

test('정품 크롬은 /Applications 것만 — ~/Applications 정품 사본은 사용자 링크를 가로챌 수 있다', () => {
  const userStable = `${HOME}/Applications/Google Chrome.app`;
  assert.strictEqual(sourceApp({ channel: null, executablePath: `${userStable}/Contents/MacOS/Google Chrome`, found: true }, { home: HOME, exists: has([userStable]) }), null);
});

test('크롬이 없거나 모양이 이상하면 null', () => {
  assert.strictEqual(sourceApp({ channel: 'chrome-beta', executablePath: null, found: false }, { home: HOME, exists: has([BETA]) }), null);
  assert.strictEqual(sourceApp({ channel: 'chrome-beta', executablePath: null, found: true }, { home: HOME, exists: has([]) }), null);
  assert.strictEqual(sourceApp({ channel: 'chrome-beta', executablePath: '/x/chrome', found: true }, { home: HOME, exists: () => true }), null);
  assert.strictEqual(sourceApp({ channel: 'msedge', executablePath: null, found: true }, { home: HOME, exists: () => true }), null);
});

test('사본 폴더 — 번들 id·판마다 따로, 경로를 벗어나는 값은 거부', () => {
  assert.strictEqual(copyDir('/d/browser', 'com.google.Chrome.beta', '156.0.8078.4'), '/d/browser/app/com.google.Chrome.beta-156.0.8078.4');
  assert.strictEqual(copyDir('/d/browser', 'com.google.Chrome', '154.0.8037.98'), '/d/browser/app/com.google.Chrome-154.0.8037.98');
  for (const [id, v] of [['com.google.Chrome.beta', '../1'], ['com.google.Chrome.beta', ''], ['../x', '1.0'], ['com.other.App', '1.0'], ['com.google.Chrome.beta', '1.0/2']]) {
    assert.strictEqual(copyDir('/d/browser', id, v), null, `${id} ${v}`);
  }
});

test('복제 가능 = 같은 볼륨 + apfs — cp -c 는 안 되면 조용히 730MB 통째 복사로 넘어간다', () => {
  assert.strictEqual(cloneable('/a', '/b', { dev: () => 1, fsType: () => 'apfs' }), true);
  assert.strictEqual(cloneable('/a', '/b', { dev: (p) => (p === '/a' ? 1 : 2), fsType: () => 'apfs' }), false); // 다른 볼륨(외장·다른 APFS 볼륨)
  assert.strictEqual(cloneable('/a', '/b', { dev: () => 1, fsType: () => 'hfs' }), false);
  assert.strictEqual(cloneable('/a', '/b', { dev: () => { throw new Error('ENOENT'); }, fsType: () => 'apfs' }), false);
});

test('mount 이름 읽기(맥) — 홈은 apfs', { skip: process.platform !== 'darwin' }, () => {
  assert.strictEqual(mountType(os.tmpdir()), 'apfs');
});

test('정리할 옛 사본 — 같은 크롬의 옛 판 중 안 도는 것만, 죽은 임시 폴더도', () => {
  const root = '/d/browser/app';
  const names = ['com.google.Chrome.beta-155.0.1.1', 'com.google.Chrome.beta-156.0.8078.4', 'com.google.Chrome.beta-154.0.1.1', 'com.google.Chrome-154.0.8037.98', 'notes', '.tmp-com.google.Chrome.beta-156.0.8078.4-111', '.tmp-com.google.Chrome.beta-156.0.8078.4-222'];
  const running = [`${root}/com.google.Chrome.beta-154.0.1.1/${APP_NAME}.app/Contents/MacOS/Google Chrome Beta --user-data-dir=/x`];
  const alive = (pid) => pid === 222;
  const gone = staleEntries(names, { root, current: 'com.google.Chrome.beta-156.0.8078.4', running, alive });
  assert.deepStrictEqual(gone.sort(), ['.tmp-com.google.Chrome.beta-156.0.8078.4-111', 'com.google.Chrome.beta-155.0.1.1'].sort());
});

test('다른 채널 사본은 안 돌아도 남긴다 — 프로필마다 정품/베타를 섞어 쓴다(실측: 정품 시험 열기가 베타 사본을 지웠다)', () => {
  const names = ['com.google.Chrome-154.0.8037.98', 'com.google.Chrome-153.0.1.1', 'com.google.Chrome.beta-156.0.8078.4'];
  assert.deepStrictEqual(staleEntries(names, { root: '/r', current: 'com.google.Chrome.beta-156.0.8078.4', running: [], alive: () => false }), []);
  assert.deepStrictEqual(staleEntries(names, { root: '/r', current: 'com.google.Chrome-154.0.8037.98', running: [], alive: () => false }), ['com.google.Chrome-153.0.1.1']);
});

test('업데이터가 사본을 크롬 자리로 등록했으면 원본으로 되돌릴 목록 — 사본에서 chrome://settings/help 를 열면 그렇게 된다(실측)', () => {
  const prefs = { updateclientdata: { apps: {
    'com.google.chrome.beta': { ap: 'beta', ecp: '/Users/u/.chammo/browser/app/com.google.Chrome.beta-156.0.8078.4/Chammo Browser.app' },
    'com.google.chrome': { ap: 'universal', ecp: '/Applications/Google Chrome.app' },
    '{44fc7fe2-65ce-487c-93f4-edee46eeaaab}': { pv: '1' },
  } } };
  assert.deepStrictEqual(updaterFixes(prefs, { home: HOME, exists: has([BETA]) }), [{ productId: 'com.google.Chrome.beta', app: BETA, tag: 'beta' }]);
  const userBeta = `${HOME}/Applications/Google Chrome Beta.app`;
  assert.deepStrictEqual(updaterFixes(prefs, { home: HOME, exists: has([userBeta]) }), [{ productId: 'com.google.Chrome.beta', app: userBeta, tag: 'beta' }]);
  assert.deepStrictEqual(updaterFixes(prefs, { home: HOME, exists: has([]) }), []); // 원본이 없으면 손대지 않는다
  const stable = { updateclientdata: { apps: { 'com.google.chrome': { ecp: '/x/Chammo Browser.app' } } } };
  assert.deepStrictEqual(updaterFixes(stable, { home: HOME, exists: has([STABLE]) }), [{ productId: 'com.google.Chrome', app: STABLE, tag: null }]);
  for (const bad of [null, {}, { updateclientdata: null }, { updateclientdata: { apps: 3 } }]) assert.deepStrictEqual(updaterFixes(bad, { home: HOME, exists: () => true }), []);
});

// ---- sessionChrome: 바깥 일(복제·아이콘·plist)은 가짜로 갈아 끼운다
function fakeEnv(over = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'appcopy-'));
  const log = [];
  const deps = {
    platform: 'darwin',
    root,
    home: HOME,
    env: {},
    exists: (p) => p === BETA || fs.existsSync(p),
    readInfo: (app) => (app === BETA ? { id: 'com.google.Chrome.beta', version: '156.0.8078.4', exe: 'Google Chrome Beta' } : null),
    version: (app) => (fs.existsSync(app) ? (fs.existsSync(path.join(app, 'ver')) ? fs.readFileSync(path.join(app, 'ver'), 'utf8') : path.dirname(app).split('-').pop()) : null),
    updaterPrefs: () => null,
    reRegister: (fix) => { log.push(['reRegister', fix.productId]); return true; },
    clone: (src, dest) => { log.push(['clone', src, path.basename(dest)]); fs.mkdirSync(path.join(dest, 'Contents/MacOS'), { recursive: true }); fs.writeFileSync(path.join(dest, 'Contents/MacOS/Google Chrome Beta'), ''); return true; },
    setIcon: (app) => { log.push(['icon', path.basename(app)]); return true; },
    warm: (exe) => log.push(['warm', path.basename(exe)]),
    running: () => [],
    alive: () => false,
    say: (m) => log.push(['say', m]),
    ...over,
  };
  return { root, log, deps };
}
const PICK = { channel: 'chrome-beta', executablePath: null, found: true };

test('처음엔 복제→아이콘→예열, 채널은 그대로 두고 실행 파일만 사본으로', () => {
  const { root, log, deps } = fakeEnv();
  const r = sessionChrome(PICK, deps);
  const app = path.join(root, 'app/com.google.Chrome.beta-156.0.8078.4', `${APP_NAME}.app`);
  assert.deepStrictEqual(r, { channel: 'chrome-beta', executablePath: path.join(app, 'Contents/MacOS/Google Chrome Beta'), found: true, copy: true });
  assert.deepStrictEqual(log.map((l) => l[0]).filter((k) => k !== 'say'), ['clone', 'icon', 'warm']);
  assert.strictEqual(log[0][2], `${APP_NAME}.app`); // 복제는 임시 폴더 안 같은 이름으로 → 다 된 뒤 rename
  assert.ok(fs.existsSync(path.join(r.executablePath)));
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'app')), ['com.google.Chrome.beta-156.0.8078.4']); // 임시 폴더는 남지 않는다
});

test('이미 있으면 바깥 일 없이 바로(래퍼가 켤 때마다 부른다)', () => {
  const { log, deps } = fakeEnv();
  const first = sessionChrome(PICK, deps);
  log.length = 0;
  const again = sessionChrome(PICK, deps);
  assert.deepStrictEqual(again, first);
  assert.deepStrictEqual(log.filter((l) => l[0] !== 'say'), []);
});

test('원본이 올라가면 새 판 사본을 만들고, 안 도는 옛 판은 지운다', () => {
  const { root, deps } = fakeEnv();
  sessionChrome(PICK, deps);
  const newer = { ...deps, readInfo: () => ({ id: 'com.google.Chrome.beta', version: '157.0.1.0', exe: 'Google Chrome Beta' }) };
  const r = sessionChrome(PICK, newer);
  assert.match(r.executablePath, /com\.google\.Chrome\.beta-157\.0\.1\.0\//);
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'app')), ['com.google.Chrome.beta-157.0.1.0']);
});

test('옛 판이 아직 돌면 남긴다', () => {
  const { root, deps } = fakeEnv();
  const old = sessionChrome(PICK, deps);
  const newer = { ...deps, readInfo: () => ({ id: 'com.google.Chrome.beta', version: '157.0.1.0', exe: 'Google Chrome Beta' }), running: () => [`${old.executablePath} --user-data-dir=/p`] };
  sessionChrome(PICK, newer);
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'app')).sort(), ['com.google.Chrome.beta-156.0.8078.4', 'com.google.Chrome.beta-157.0.1.0']);
});

test('복제가 안 되면(APFS 아님 등) 원본 그대로 — 730MB 통째 복사로 번지지 않는다', () => {
  const { root, deps } = fakeEnv({ clone: () => false });
  assert.deepStrictEqual(sessionChrome(PICK, deps), PICK);
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'app')), []); // 임시 폴더도 치운다
});

test('아이콘이 실패해도 사본은 쓴다(이름은 바뀌니까)', () => {
  const { deps } = fakeEnv({ setIcon: () => false });
  assert.strictEqual(sessionChrome(PICK, deps).copy, true);
});

test('다른 래퍼가 먼저 끝냈으면(rename 충돌) 내 임시 사본은 버리고 그쪽 것을 쓴다', () => {
  const { root, deps } = fakeEnv();
  const dir = path.join(root, 'app/com.google.Chrome.beta-156.0.8078.4');
  const clone = (src, dest) => {
    deps.clone(src, dest);
    // 내가 복제하는 사이 남이 먼저 끝냄
    fs.mkdirSync(path.join(dir, `${APP_NAME}.app/Contents/MacOS`), { recursive: true });
    fs.writeFileSync(path.join(dir, `${APP_NAME}.app/Contents/MacOS/Google Chrome Beta`), 'theirs');
    return true;
  };
  const r = sessionChrome(PICK, { ...deps, clone });
  assert.strictEqual(fs.readFileSync(r.executablePath, 'utf8'), 'theirs');
  assert.deepStrictEqual(fs.readdirSync(dir), [`${APP_NAME}.app`]);
});

test('맥이 아니거나 끄는 스위치(CHAMMO_BROWSER_COPY=0)·원본 정보가 없으면 그대로', () => {
  const { log, deps } = fakeEnv();
  assert.deepStrictEqual(sessionChrome(PICK, { ...deps, platform: 'win32' }), PICK);
  assert.deepStrictEqual(sessionChrome(PICK, { ...deps, env: { CHAMMO_BROWSER_COPY: '0' } }), PICK);
  assert.deepStrictEqual(sessionChrome(PICK, { ...deps, readInfo: () => null }), PICK);
  assert.deepStrictEqual(sessionChrome({ channel: null, executablePath: null, found: false }, deps), { channel: null, executablePath: null, found: false });
  assert.deepStrictEqual(log.filter((l) => l[0] === 'clone'), []);
});

test('바깥 일이 예외를 던져도 원본으로 — 사본 때문에 세션 브라우저가 못 뜨면 안 된다', () => {
  const { deps } = fakeEnv({ clone: () => { throw new Error('EACCES'); } });
  assert.deepStrictEqual(sessionChrome(PICK, deps), PICK);
});

test('업데이터 등록이 사본을 가리키면 켤 때마다 원본으로 되돌린다(사본 스위치를 꺼도)', () => {
  const prefs = { updateclientdata: { apps: { 'com.google.chrome.beta': { ap: 'beta', ecp: '/old/Chammo Browser.app' } } } };
  const { log, deps } = fakeEnv({ updaterPrefs: () => prefs });
  sessionChrome(PICK, deps);
  assert.deepStrictEqual(log.filter((l) => l[0] === 'reRegister'), [['reRegister', 'com.google.Chrome.beta']]);
  log.length = 0;
  sessionChrome(PICK, { ...deps, env: { CHAMMO_BROWSER_COPY: '0' } });
  assert.deepStrictEqual(log.filter((l) => l[0] === 'reRegister'), [['reRegister', 'com.google.Chrome.beta']]);
  log.length = 0;
  sessionChrome(PICK, { ...deps, updaterPrefs: () => ({ updateclientdata: { apps: { 'com.google.chrome.beta': { ecp: BETA } } } }) });
  assert.deepStrictEqual(log.filter((l) => l[0] === 'reRegister'), []);
});

test('업데이터가 사본을 올려 버렸으면(판이 폴더와 다름) 안 돌 때 새로 복제, 돌고 있으면 그대로', () => {
  const { root, log, deps } = fakeEnv();
  const first = sessionChrome(PICK, deps);
  const app = path.dirname(path.dirname(path.dirname(first.executablePath)));
  fs.writeFileSync(path.join(app, 'ver'), '157.0.0.1');
  sessionChrome(PICK, { ...deps, running: () => [`${first.executablePath} --x`] });
  assert.strictEqual(fs.readFileSync(path.join(app, 'ver'), 'utf8'), '157.0.0.1'); // 돌고 있으면 안 건드림
  log.length = 0;
  const r = sessionChrome(PICK, deps);
  assert.strictEqual(r.copy, true);
  assert.ok(!fs.existsSync(path.join(app, 'ver'))); // 새로 복제됨
  assert.deepStrictEqual(log.filter((l) => l[0] === 'clone').length, 1);
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'app')), ['com.google.Chrome.beta-156.0.8078.4']);
});

test('아이콘 씌우기가 예외를 던져도 사본은 쓴다', () => {
  const { deps } = fakeEnv({ setIcon: () => { throw new Error('spawn ENOENT'); } });
  assert.strictEqual(sessionChrome(PICK, deps).copy, true);
});

test('만들 때 돌고 있어 남긴 옛 판은 그 판이 꺼진 뒤 다음 켤 때 지운다', () => {
  const { root, deps } = fakeEnv();
  const old = sessionChrome(PICK, deps);
  const newer = { ...deps, readInfo: () => ({ id: 'com.google.Chrome.beta', version: '157.0.1.0', exe: 'Google Chrome Beta' }) };
  sessionChrome(PICK, { ...newer, running: () => [`${old.executablePath} --x`] });
  assert.strictEqual(fs.readdirSync(path.join(root, 'app')).length, 2);
  sessionChrome(PICK, newer); // 옛 판이 꺼진 뒤
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'app')), ['com.google.Chrome.beta-157.0.1.0']);
});

test('지울 게 없으면 켤 때마다 프로세스 목록을 안 읽는다', () => {
  let ps = 0;
  const { deps } = fakeEnv({ running: () => { ps++; return []; } });
  sessionChrome(PICK, deps);
  ps = 0;
  sessionChrome(PICK, deps);
  assert.strictEqual(ps, 0);
});
