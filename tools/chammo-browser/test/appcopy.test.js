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

test('재서명 옆 사본(-adhoc)도 같은 판 묶음 — 지금 쓰는 것만 남기고 안 도는 옛 것은 정리', () => {
  const root = '/d/browser/app';
  const names = ['com.google.Chrome.beta-157.0.8103.15', 'com.google.Chrome.beta-157.0.8103.15-adhoc', 'com.google.Chrome.beta-156.0.8078.4-adhoc'];
  const running = [`${root}/com.google.Chrome.beta-157.0.8103.15/${APP_NAME}.app/Contents/MacOS/Google Chrome Beta --user-data-dir=/x`];
  // 옆 사본을 쓰는 동안 — 도는 구글 서명 사본은 그대로, 옛 판 옆 사본은 지운다
  assert.deepStrictEqual(staleEntries(names, { root, current: 'com.google.Chrome.beta-157.0.8103.15-adhoc', running, alive: () => false }), ['com.google.Chrome.beta-156.0.8078.4-adhoc']);
  // 구글 서명 사본이 꺼지면 그것도
  assert.deepStrictEqual(staleEntries(names, { root, current: 'com.google.Chrome.beta-157.0.8103.15-adhoc', running: [], alive: () => false }).sort(), ['com.google.Chrome.beta-156.0.8078.4-adhoc', 'com.google.Chrome.beta-157.0.8103.15'].sort());
});

test('구글 서명 사본을 쓰는 동안 같은 판 재서명 사본(-adhoc)은 지우지 않는다 — 끄는 스위치(=0)를 다시 풀면 바로 쓴다', () => {
  const root = '/d/browser/app';
  const names = ['com.google.Chrome.beta-157.0.8103.15', 'com.google.Chrome.beta-157.0.8103.15-adhoc', 'com.google.Chrome.beta-156.0.8078.4-adhoc'];
  assert.deepStrictEqual(staleEntries(names, { root, current: 'com.google.Chrome.beta-157.0.8103.15', running: [], alive: () => false }), ['com.google.Chrome.beta-156.0.8078.4-adhoc']);
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
    version: (app) => (fs.existsSync(app) ? (fs.existsSync(path.join(app, 'ver')) ? fs.readFileSync(path.join(app, 'ver'), 'utf8') : path.basename(path.dirname(app)).replace(/-adhoc$/, '').split('-').pop()) : null),
    updaterPrefs: () => null,
    reRegister: (fix) => { log.push(['reRegister', fix.productId]); return true; },
    clone: (src, dest) => { log.push(['clone', src, path.basename(dest)]); fs.mkdirSync(path.join(dest, 'Contents/MacOS'), { recursive: true }); fs.writeFileSync(path.join(dest, 'Contents/MacOS/Google Chrome Beta'), ''); return true; },
    setIcon: (app) => { log.push(['icon', path.basename(app)]); return true; },
    warm: (exe) => log.push(['warm', path.basename(exe)]),
    running: () => [],
    alive: () => false,
    say: (m) => log.push(['say', m]),
    // 이 맥 진짜 데이터 폴더의 dylib 를 읽지 않게 — 있으면 진짜 codesign 이 가짜 사본에 돈다
    dylib: () => null,
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

// ---- Dock·⌘Tab 빼기(2026-10-27 인앱 브라우저 A): 앱이 깐 accessory dylib 가 있으면 사본을 ad-hoc 재서명하고 띄울 때 주입한다
const DYLIB = '/d/tools/chammo-accessory.dylib';
function signed(over = {}) {
  const sig = new Map(); // 앱 → 'adhoc' | 'google'
  const env = fakeEnv({
    dylib: () => DYLIB,
    adhoc: (app) => sig.get(app) === 'adhoc',
    resign: (app) => { env.log.push(['resign', path.basename(app)]); sig.set(app, 'adhoc'); return true; },
    // 이름·아이콘(번들 안) — 표시 파일로 남겨 rename 뒤에도 따라온다
    brand: (app) => { env.log.push(['brand', path.basename(app)]); fs.writeFileSync(path.join(app, 'branded'), ''); return true; },
    branded: (app) => fs.existsSync(path.join(app, 'branded')),
    ...over,
  });
  return { ...env, sig };
}
const appOf = (exe) => path.dirname(path.dirname(path.dirname(exe)));

test('dylib 가 있으면 새 사본을 아이콘·예열 전에 재서명하고 주입할 dylib 를 같이 돌려준다', () => {
  const { log, deps, sig } = signed();
  const r = sessionChrome(PICK, deps);
  // 이름·아이콘(번들 안)은 서명 전에, Finder 아이콘(번들 루트 FinderInfo)이 먼저 있으면 codesign 이 거절한다(실측) — 바꾸기 → 서명 → 아이콘 → 예열
  assert.deepStrictEqual(log.map((l) => l[0]).filter((k) => k !== 'say'), ['clone', 'brand', 'resign', 'icon', 'warm']);
  sig.set(appOf(r.executablePath), 'adhoc'); // 임시 자리에서 서명한 것이 rename 으로 넘어온다
  assert.strictEqual(r.inject, DYLIB);
  assert.strictEqual(r.copy, true);
});

test('이미 ad-hoc 인 사본은 서명 없이 바로 주입', () => {
  const { log, deps, sig } = signed();
  const first = sessionChrome(PICK, deps);
  sig.set(appOf(first.executablePath), 'adhoc');
  log.length = 0;
  const again = sessionChrome(PICK, deps);
  assert.strictEqual(again.inject, DYLIB);
  assert.deepStrictEqual(log.filter((l) => l[0] !== 'say'), []);
});

// 0.4.4 리뷰 2 — 있는 사본을 제자리에서 고치고 재서명했다. 앱 재시작 뒤 래퍼 여럿이 같은 번들을 동시에 codesign 하고,
// 실패한 쪽이 폴더를 지우는 사이 다른 쪽이 받은 경로로 크롬을 띄웠다. 이미 건넨 경로는 고치지 않는다 — 옆 사본을 임시 자리에서 만들어 rename
test('옛 구글 서명 사본은 제자리에서 고치지 않는다 — 안 돌아도 옆 -adhoc 사본을 임시 자리에서 만들어 그걸로', () => {
  const plain = fakeEnv();
  const first = sessionChrome(PICK, plain.deps); // dylib 가 없던 때 만든 사본
  const app = appOf(first.executablePath);
  const s = signed({ root: plain.root });
  const signedAt = [];
  s.deps.resign = (a) => { signedAt.push(a); s.sig.set(a, 'adhoc'); return true; };
  const r = sessionChrome(PICK, s.deps);
  assert.ok(signedAt.every((a) => a.includes('/.tmp-')), `임시 자리에서만 서명: ${signedAt}`);
  assert.strictEqual(r.executablePath, path.join(plain.root, 'app/com.google.Chrome.beta-156.0.8078.4-adhoc', `${APP_NAME}.app`, 'Contents/MacOS/Google Chrome Beta'));
  assert.strictEqual(r.inject, DYLIB);
  assert.notStrictEqual(s.sig.get(app), 'adhoc', '건넨 경로는 그대로');
  assert.ok(!fs.existsSync(path.join(app, 'branded')));
});

test('업데이터가 사본을 구글 서명으로 되돌려 놓았으면 — 그 사본은 두고 옆 재서명 사본으로', () => {
  const { deps, sig, root } = signed();
  const first = sessionChrome(PICK, deps);
  const app = appOf(first.executablePath);
  sig.set(app, 'google');
  const r = sessionChrome(PICK, deps);
  assert.strictEqual(r.inject, DYLIB);
  assert.strictEqual(r.executablePath, path.join(root, 'app/com.google.Chrome.beta-156.0.8078.4-adhoc', `${APP_NAME}.app`, 'Contents/MacOS/Google Chrome Beta'));
  assert.strictEqual(sig.get(app), 'google');
});

// 10-28 naver-demo: 구글 서명 사본을 세션 크롬들이 늘 쓰고 있어 '안 돌 때 재서명'이 영영 안 됐다 → Dock 에 떠 있고 지킴이가 가려 칸이 까맸다
test('구글 서명 사본이 돌고 있으면 판 이름 옆 -adhoc 사본을 새로 만들어 그걸로 주입 — 돌던 크롬·사본은 건드리지 않는다', () => {
  const plain = fakeEnv();
  const first = sessionChrome(PICK, plain.deps); // dylib 가 없던 때 만든 사본(구글 서명)
  const app = appOf(first.executablePath);
  const s = signed({ root: plain.root, running: () => [`${first.executablePath} --user-data-dir=/p1`] });
  const r = sessionChrome(PICK, s.deps);
  const sib = path.join(plain.root, 'app/com.google.Chrome.beta-156.0.8078.4-adhoc', `${APP_NAME}.app`);
  assert.strictEqual(r.executablePath, path.join(sib, 'Contents/MacOS/Google Chrome Beta'));
  assert.strictEqual(r.inject, DYLIB);
  assert.strictEqual(r.channel, 'chrome-beta', '채널 기억(ChammoChannel)은 그대로');
  assert.ok(fs.existsSync(r.executablePath));
  // 원본에서 새로 복제 → 임시 자리에서 서명 → 아이콘 → 예열. 도는 사본은 서명하지 않는다
  assert.deepStrictEqual(s.log.map((l) => l[0]).filter((k) => k !== 'say'), ['clone', 'brand', 'resign', 'icon', 'warm']);
  assert.strictEqual(s.log.find((l) => l[0] === 'clone')[1], BETA);
  assert.ok(fs.existsSync(first.executablePath), '돌던 사본은 그대로');
  assert.notStrictEqual(s.sig.get(app), 'adhoc');
});

test('-adhoc 옆 사본이 있으면 다음에도 바로 그걸 — 옛 구글 서명 사본은 꺼진 뒤 정리', () => {
  const plain = fakeEnv();
  const first = sessionChrome(PICK, plain.deps);
  const s = signed({ root: plain.root, running: () => [`${first.executablePath} --x`] });
  const r = sessionChrome(PICK, s.deps);
  s.sig.set(appOf(r.executablePath), 'adhoc'); // 임시 자리에서 서명한 것이 rename 으로 넘어온다
  s.log.length = 0;
  // 아직 돈다 — 옆 사본을 바로 쓰고 아무것도 안 만든다
  assert.strictEqual(sessionChrome(PICK, s.deps).executablePath, r.executablePath);
  assert.deepStrictEqual(s.log.filter((l) => l[0] !== 'say'), []);
  assert.ok(fs.existsSync(first.executablePath));
  // 다 꺼졌다 — 옆 사본 그대로, 구글 서명 사본은 지운다(다시 서명하지 않는다)
  const again = sessionChrome(PICK, { ...s.deps, running: () => [] });
  assert.strictEqual(again.executablePath, r.executablePath);
  assert.strictEqual(again.inject, DYLIB);
  assert.ok(!fs.existsSync(first.executablePath));
  assert.deepStrictEqual(s.log.filter((l) => l[0] === 'resign'), []);
});

test('옆 사본을 못 만들면(서명 실패) 지금처럼 구글 서명 사본 그대로 — 세션 브라우저는 뜬다', () => {
  const plain = fakeEnv();
  const first = sessionChrome(PICK, plain.deps);
  const s = signed({ root: plain.root, running: () => [`${first.executablePath} --x`], resign: () => false });
  const r = sessionChrome(PICK, s.deps);
  assert.strictEqual(r.executablePath, first.executablePath);
  assert.strictEqual(r.inject, undefined);
  assert.ok(!fs.existsSync(path.join(plain.root, 'app/com.google.Chrome.beta-156.0.8078.4-adhoc')), '반쯤 된 옆 사본은 안 남긴다');
});

test('재서명이 실패하면 주입하지 않는다 — 새 사본은 원본으로, 옛 사본은 지우지 않고 그대로(누가 그 경로로 띄울 수 있다)', () => {
  const fresh = signed({ resign: () => false });
  const r = sessionChrome(PICK, fresh.deps);
  assert.deepStrictEqual(r, PICK);
  assert.deepStrictEqual(fs.readdirSync(path.join(fresh.root, 'app')).filter((n) => !n.startsWith('.tmp-') && !n.endsWith('.lock')), []);

  const plain = fakeEnv();
  const first = sessionChrome(PICK, plain.deps);
  const old = signed({ root: plain.root, resign: () => false });
  const again = sessionChrome(PICK, old.deps);
  assert.strictEqual(again.executablePath, first.executablePath, '구글 서명 사본 그대로');
  assert.strictEqual(again.inject, undefined);
  assert.ok(fs.existsSync(first.executablePath));
});

// 10-29 밤 되돌림(ADR 0019 정정) — 구글 거절은 재서명 탓이 아니라 webdriver 였다. 기본은 다시 Dock 숨김 재서명 사본, 패스키만 서명 크롬으로(passkey-auto).
// 41128f2d 가 기본을 서명 사본으로 바꿨던 것 — 스위치를 안 줘도 재서명·주입한다
test('기본은 Dock 숨김 재서명 사본 — 스위치를 안 줘도(빈 값·1·모르는 값) 재서명하고 주입한다', () => {
  for (const v of [undefined, '', ' ', '1', 'yes']) {
    const r = signed(v === undefined ? {} : { env: { CHAMMO_BROWSER_ACCESSORY: v } });
    const got = sessionChrome(PICK, r.deps);
    assert.strictEqual(got.inject, DYLIB, `스위치 ${JSON.stringify(v)}`);
    assert.strictEqual(got.copy, true);
    assert.ok(r.log.some((l) => l[0] === 'resign'), `재서명 ${JSON.stringify(v)}`);
  }
});

test('dylib 가 없거나 끄는 스위치(CHAMMO_BROWSER_ACCESSORY=0)면 서명·주입 없이 지금처럼', () => {
  const none = signed({ dylib: () => null });
  assert.strictEqual(sessionChrome(PICK, none.deps).inject, undefined);
  assert.deepStrictEqual(none.log.filter((l) => l[0] === 'resign'), []);
  for (const v of ['0', ' 0 ']) {
    const off = signed({ env: { CHAMMO_BROWSER_ACCESSORY: v } });
    const got = sessionChrome(PICK, off.deps);
    assert.strictEqual(got.inject, undefined);
    assert.strictEqual(got.copy, true, '끄면 구글 서명 사본(Dock 에 보임, 맥 패스키 됨)');
    assert.deepStrictEqual(off.log.filter((l) => l[0] === 'resign' || l[0] === 'brand'), []);
  }
});

// 10-28 사용자 "참모브라우저 앱아이콘도 정상화" — 실행 중 이름·아이콘(활동 모니터·권한 창·알림)은 번들 안 Info.plist·app.icns 를 읽어 크롬 베타로 보였다
test('재서명 사본은 이름·아이콘을 참모 브라우저로 — 구글 서명 사본은 손대지 않는다(서명이 깨진다)', () => {
  const plain = fakeEnv({ brand: () => { throw new Error('구글 서명 사본에 brand'); } });
  sessionChrome(PICK, plain.deps);
  assert.ok(!plain.log.some((l) => l[0] === 'brand'));
});

test('이름·아이콘 전에 만든 ad-hoc 사본 — 제자리에서 안 바꾸고 이름 붙은 옆 사본을 새로 만든다, 다음엔 그걸 바로', () => {
  const s = signed({ brand: () => true, branded: () => false });
  const first = sessionChrome(PICK, s.deps);
  const app = appOf(first.executablePath);
  s.sig.set(app, 'adhoc');
  const idle = signed({ root: s.root });
  idle.sig.set(app, 'adhoc');
  const signedAt = [];
  idle.deps.resign = (a) => { signedAt.push(a); idle.sig.set(a, 'adhoc'); return true; };
  const r = sessionChrome(PICK, idle.deps);
  assert.strictEqual(r.inject, DYLIB);
  assert.ok(r.executablePath.includes('-adhoc/'), r.executablePath);
  assert.ok(signedAt.length === 1 && signedAt[0].includes('/.tmp-'), '임시 자리에서만 서명');
  assert.ok(!fs.existsSync(path.join(app, 'branded')), '건넨 사본은 그대로');
  idle.sig.set(appOf(r.executablePath), 'adhoc');
  idle.log.length = 0;
  assert.strictEqual(sessionChrome(PICK, idle.deps).executablePath, r.executablePath);
  assert.deepStrictEqual(idle.log.filter((l) => l[0] !== 'say'), [], '다음엔 바로');
});

test('옆 -adhoc 사본이 이름·아이콘 전 것이어도 제자리에서 안 바꾼다 — 그대로 쓴다(다음 판에서 이름 붙은 새 사본)', () => {
  const plain = fakeEnv();
  const first = sessionChrome(PICK, plain.deps);
  const s = signed({ root: plain.root, running: () => [`${first.executablePath} --x`], brand: () => true, branded: () => false });
  const sibExe = sessionChrome(PICK, s.deps).executablePath;
  const sib = appOf(sibExe);
  const t = signed({ root: plain.root, branded: () => false });
  t.sig.set(sib, 'adhoc');
  const r = sessionChrome(PICK, t.deps);
  assert.strictEqual(r.executablePath, sibExe);
  assert.strictEqual(r.inject, DYLIB);
  assert.deepStrictEqual(t.log.filter((l) => l[0] === 'brand' || l[0] === 'resign'), []);
});

test('사본 만들기·고르기는 자물쇠 안에서 — 다른 래퍼가 쥐고 있으면 기다리고, 끝내 못 잡으면 원본 그대로(아무것도 안 건드린다)', () => {
  const s = signed({ lockWaitMs: 0 });
  fs.mkdirSync(path.join(s.root, 'app'), { recursive: true });
  require('../src/lock').acquire('appcopy', { lockDir: path.join(s.root, 'app'), pid: process.ppid });
  assert.deepStrictEqual(sessionChrome(PICK, s.deps), PICK);
  assert.deepStrictEqual(s.log.filter((l) => l[0] === 'clone' || l[0] === 'resign'), []);
  require('../src/lock').release('appcopy', { lockDir: path.join(s.root, 'app'), pid: process.ppid });
  const r = sessionChrome(PICK, s.deps);
  assert.strictEqual(r.inject, DYLIB);
  assert.ok(!fs.existsSync(path.join(s.root, 'app', 'appcopy.lock')), '끝나면 푼다');
});

test('이름·아이콘 바꾸기가 안 되면 서명은 그대로 — 브라우저는 뜬다(크롬 베타로 보일 뿐)', () => {
  const s = signed({ brand: () => false });
  const r = sessionChrome(PICK, s.deps);
  assert.strictEqual(r.inject, DYLIB);
  assert.deepStrictEqual(s.log.map((l) => l[0]).filter((k) => k !== 'say'), ['clone', 'resign', 'icon', 'warm']);
});

// 2026-10-28 패스키 탈출구 — ad-hoc 사본엔 맥 플랫폼 패스키가 없다(isUVPAA false). 사람이 '이번만 구글 크롬으로 열기'를 누르면
// 같은 프로필을 구글 서명 원본으로 다시 띄운다 — 주입할 때만 그 원본 실행 파일을 같이 넘긴다(판이 같아 프로필을 그대로 연다)
test('주입하는 ad-hoc 사본이면 구글 서명 원본 실행 파일도 같이 — 주입 없으면 안 넘긴다', () => {
  const s = signed();
  const r = sessionChrome(PICK, s.deps);
  assert.strictEqual(r.inject, DYLIB);
  assert.strictEqual(r.signed, path.join(BETA, 'Contents/MacOS/Google Chrome Beta'));
  assert.strictEqual(sessionChrome(PICK, fakeEnv().deps).signed, undefined);
});
