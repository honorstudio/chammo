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
