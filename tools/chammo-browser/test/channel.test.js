const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ch = require('../src/channel');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-ch-'));
// 정품 154 · 베타 156 둘 다 깔린 맥(2026-10 이 맥·아이맥 모양)
const both = { chrome: '154.0.8037.98', 'chrome-beta': '156.0.8078.4' };

test('버전 비교 — 자리마다 숫자로', () => {
  assert.equal(ch.cmpVersion('154.0.8037.98', '156.0.1.1'), -1);
  assert.equal(ch.cmpVersion('156.0.8078.4', '156.0.8078.4'), 0);
  assert.equal(ch.cmpVersion('156.0.10.0', '156.0.9.0'), 1);
  assert.equal(ch.cmpVersion('', '1.0'), null);
});

test('새 프로필은 기본(맥은 베타가 있으면 베타)으로 고르고 기억한다', () => {
  const d = tmp();
  const r = ch.pickChannel({ profileDir: d, versions: both, platform: 'darwin' });
  assert.deepEqual([r.channel, r.why], ['chrome-beta', 'default']);
  ch.remember(d, r.channel);
  assert.equal(ch.readMarker(d), 'chrome-beta');
  assert.equal(ch.pickChannel({ profileDir: d, versions: both, platform: 'darwin' }).why, 'remembered');
});

test('기억이 없는 옛 프로필은 Last Version 의 큰 번호가 같은 채널로 — 정품 154 로 만든 프로필을 베타로 열지 않는다(아이맥 project-x)', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'Last Version'), '154.0.8037.98');
  const r = ch.pickChannel({ profileDir: d, versions: both });
  assert.deepEqual([r.channel, r.why], ['chrome', 'last-version']);
  fs.writeFileSync(path.join(d, 'Last Version'), '156.0.8078.4');
  assert.equal(ch.pickChannel({ profileDir: d, versions: both }).channel, 'chrome-beta');
});

test('두 채널보다 오래된 프로필은 기본으로(둘 다 올려 열 수 있다)', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'Last Version'), '149.0.7827.201');
  assert.deepEqual(ch.pickChannel({ profileDir: d, versions: both, platform: 'darwin' }).channel, 'chrome-beta');
  assert.deepEqual(ch.pickChannel({ profileDir: d, versions: { chrome: both.chrome } }).channel, 'chrome');
});

test('기억한 채널이 프로필보다 낮은 판이면 열 수 있는 채널로 바꾸고 알린다(낮은 판은 새 프로필을 못 연다)', () => {
  const d = tmp();
  ch.remember(d, 'chrome');
  fs.writeFileSync(path.join(d, 'Last Version'), '156.0.8078.4'); // 누가 베타로 열어 올려 버림
  const r = ch.pickChannel({ profileDir: d, versions: both });
  assert.equal(r.channel, 'chrome-beta');
  assert.match(r.warn, /156/);
});

test('직접 고른 채널(--channel·CHAMMO_BROWSER_CHANNEL)이 이긴다 — 낮은 판이면 알리기만', () => {
  const d = tmp();
  ch.remember(d, 'chrome-beta');
  assert.deepEqual(ch.pickChannel({ profileDir: d, want: 'chrome', versions: both }).why, 'asked');
  assert.equal(ch.pickChannel({ profileDir: d, env: { CHAMMO_BROWSER_CHANNEL: 'chrome' }, versions: both }).channel, 'chrome');
  fs.writeFileSync(path.join(d, 'Last Version'), '156.0.8078.4');
  assert.match(ch.pickChannel({ profileDir: d, want: 'chrome', versions: both }).warn, /156/);
});

test('채널 이름 — chrome·chrome-beta(beta·stable 도 받음), 그 밖은 null', () => {
  assert.equal(ch.normalize('beta'), 'chrome-beta');
  assert.equal(ch.normalize('stable'), 'chrome');
  assert.equal(ch.normalize('Chrome'), 'chrome');
  assert.equal(ch.normalize('chromium'), null);
  assert.equal(ch.normalize(''), null);
});

test('기억 파일이 이상하면 없는 걸로 본다', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, ch.MARKER), 'msedge');
  assert.equal(ch.readMarker(d), null);
});

test('깔린 채널만 — 기억한 채널이 지워졌으면 깔린 쪽으로', () => {
  const d = tmp();
  ch.remember(d, 'chrome-beta');
  const r = ch.pickChannel({ profileDir: d, versions: { chrome: both.chrome } });
  assert.equal(r.channel, 'chrome');
});

// 윈도우(2026-11-09 윈도우 PC 수집 스크립트) — 베타를 고르던 이유(Dock·번들 id 가 사용자 크롬과 섞임)는 맥 것이다.
// 윈도우 세션 크롬은 숨은 데스크톱에 뜨고 프로필 폴더마다 따로 묶여, 베타로 열 까닭 없이 베타 판(158)만 따라가다 http 수집이 막혔다
const win = { chrome: '156.0.8078.81', 'chrome-beta': '158.0.8127.18' };

test('윈도우 새 프로필은 베타가 깔려 있어도 정식으로', () => {
  const d = tmp();
  const r = ch.pickChannel({ profileDir: d, versions: win, platform: 'win32' });
  assert.deepEqual([r.channel, r.why], ['chrome', 'default']);
  assert.equal(r.note, undefined);
  assert.equal(ch.pickChannel({ profileDir: d, versions: { 'chrome-beta': win['chrome-beta'] }, platform: 'win32' }).channel, 'chrome-beta', '정식이 없으면 베타');
});

test('윈도우 — 이미 베타로 기억된 프로필은 못 내리니 베타 그대로, 한 줄 알림(note)', () => {
  const d = tmp();
  ch.remember(d, 'chrome-beta');
  fs.writeFileSync(path.join(d, 'Last Version'), win['chrome-beta']);
  const r = ch.pickChannel({ profileDir: d, versions: win, platform: 'win32' });
  assert.deepEqual([r.channel, r.why], ['chrome-beta', 'remembered']);
  assert.match(r.note, /베타/);
  assert.equal(r.warn, undefined);
  assert.equal(ch.readMarker(d), 'chrome-beta', '기억은 지우지 않는다');
  // 기억이 없어도 베타 판이 쓴 프로필(Last Version 158)이면 베타 — 정식 156 은 못 연다
  const e = tmp();
  fs.writeFileSync(path.join(e, 'Last Version'), win['chrome-beta']);
  const r2 = ch.pickChannel({ profileDir: e, versions: win, platform: 'win32' });
  assert.deepEqual([r2.channel, r2.why], ['chrome-beta', 'last-version']);
  assert.match(r2.note, /베타/);
  // 직접 고른 베타엔 알림 없음
  assert.equal(ch.pickChannel({ profileDir: d, want: 'chrome-beta', versions: win, platform: 'win32' }).note, undefined);
});

test('맥은 베타가 기본이라 베타 기억에 알림 없음', () => {
  const d = tmp();
  ch.remember(d, 'chrome-beta');
  assert.equal(ch.pickChannel({ profileDir: d, versions: both, platform: 'darwin' }).note, undefined);
});

test('윈도우 깔린 판 — Application 아래 판 이름 폴더 중 가장 높은 것, chrome.exe 가 없으면 없는 것', () => {
  const L = 'C:\\Users\\u\\AppData\\Local';
  const files = {
    [`${L}\\Google\\Chrome\\Application\\chrome.exe`]: 1,
    [`${L}\\Google\\Chrome Beta\\Application\\chrome.exe`]: 1,
  };
  const dirs = {
    [`${L}\\Google\\Chrome\\Application`]: ['155.0.8000.1', '156.0.8078.81', 'SetupMetrics', 'chrome.exe', 'chrome.VisualElementsManifest.xml'],
    [`${L}\\Google\\Chrome Beta\\Application`]: ['158.0.8127.18', '157.0.8100.9'],
    'C:\\Program Files\\Google\\Chrome\\Application': ['160.0.1.1'], // chrome.exe 없는 찌꺼기
  };
  const v = ch.installedVersions({
    platform: 'win32',
    env: { LOCALAPPDATA: L, ProgramFiles: 'C:\\Program Files' },
    exists: (p) => !!files[p],
    readdir: (p) => { if (!dirs[p]) throw new Error('ENOENT'); return dirs[p]; },
  });
  assert.deepEqual(v, { chrome: '156.0.8078.81', 'chrome-beta': '158.0.8127.18' });
  assert.deepEqual(ch.installedVersions({ platform: 'linux' }), {});
});
