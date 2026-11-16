// 공개 이슈 #28 — 윈도우 process.env 는 대소문자를 안 가리지만 {...process.env} 사본은 평범한 객체다.
// 키가 PROGRAMFILES 로 들어 있으면 사본['ProgramFiles'] 가 undefined 라 C:\Program Files 의 정식 크롬을 못 찾았다.
// 그리고 기본 고르기가 정식(chrome)을 강제로 넘겨 베타로도 못 넘어가 found:false → 모든 browser_* 가 막혔다
const { test } = require('node:test');
const assert = require('node:assert');
const { envGet } = require('../src/winenv');
const { chromeLaunch } = require('../src/window');
const ch = require('../src/channel');

const has = (paths) => (p) => paths.includes(p);
const STABLE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BETA = 'C:\\Users\\u\\AppData\\Local\\Google\\Chrome Beta\\Application\\chrome.exe';
// Git Bash(MSYS)·일부 실행기는 env 이름을 대문자로 바꿔 넘긴다 — 사본엔 그 모양 그대로 남는다
const UPPER = { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)' };

test('envGet — 같은 이름이 먼저, 없으면 대소문자 무시로 찾는다', () => {
  assert.strictEqual(envGet({ ProgramFiles: 'A', PROGRAMFILES: 'B' }, 'ProgramFiles'), 'A');
  assert.strictEqual(envGet({ PROGRAMFILES: 'B' }, 'ProgramFiles'), 'B');
  assert.strictEqual(envGet({ programfiles: 'C' }, 'ProgramFiles'), 'C');
  assert.strictEqual(envGet(UPPER, 'ProgramFiles(x86)'), 'C:\\Program Files (x86)');
  assert.strictEqual(envGet({}, 'ProgramFiles'), undefined);
  assert.strictEqual(envGet(null, 'ProgramFiles'), undefined);
});

test('#28 재현 — 대문자 사본 env 로도 C:\\Program Files 정식 크롬을 찾는다', () => {
  const r = chromeLaunch({ platform: 'win32', exists: has([STABLE, BETA]), env: { ...UPPER, CHAMMO_BROWSER_CHANNEL: 'chrome' } });
  assert.deepStrictEqual(r, { channel: null, executablePath: null, found: true });
});

test('#28 — 채널을 env 사본 대신 인자로 넘겨도 같은 결과(사본 없이 process.env 를 읽는 길)', () => {
  const r = chromeLaunch({ platform: 'win32', exists: has([STABLE]), env: UPPER, channel: 'chrome' });
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.channel, null);
});

test('#28 (c) — 기본으로 고른 정식이 없으면(soft) 베타로 넘어간다, 직접 고른 것(strict)은 그대로 없음', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' };
  assert.deepStrictEqual(chromeLaunch({ platform: 'win32', exists: has([BETA]), env, channel: 'chrome', soft: true }), { channel: 'chrome-beta', executablePath: null, found: true });
  assert.strictEqual(chromeLaunch({ platform: 'win32', exists: has([BETA]), env, channel: 'chrome' }).found, false);
  // 맥도 같은 규칙 — 정식을 기본으로 골랐는데 베타만 있으면 베타
  assert.strictEqual(chromeLaunch({ platform: 'darwin', exists: has(['/Applications/Google Chrome Beta.app']), env: {}, home: '/Users/u', channel: 'chrome', soft: true }).channel, 'chrome-beta');
  // 아무 것도 없으면 soft 라도 없음
  assert.strictEqual(chromeLaunch({ platform: 'win32', exists: has([]), env, channel: 'chrome', soft: true }).found, false);
});

test('#28 — 인자 채널이 env 의 CHAMMO_BROWSER_CHANNEL 보다 먼저', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', PROGRAMFILES: 'C:\\Program Files', CHAMMO_BROWSER_CHANNEL: 'chrome-beta' };
  assert.strictEqual(chromeLaunch({ platform: 'win32', exists: has([STABLE, BETA]), env, channel: 'chrome' }).channel, null);
  assert.strictEqual(chromeLaunch({ platform: 'win32', exists: has([STABLE, BETA]), env }).channel, 'chrome-beta');
});

test('#28 — 채널 기억(installedVersions)도 대문자 env 로 C:\\Program Files 판을 읽는다', () => {
  const app = 'C:\\Program Files\\Google\\Chrome\\Application';
  const v = ch.installedVersions({
    platform: 'win32',
    env: UPPER,
    exists: (p) => p === `${app}\\chrome.exe`,
    readdir: (p) => { if (p !== app) throw new Error('ENOENT'); return ['156.0.8078.81']; },
  });
  assert.deepStrictEqual(v, { chrome: '156.0.8078.81' });
});
