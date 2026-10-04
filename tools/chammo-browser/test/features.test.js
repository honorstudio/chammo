const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PLAYWRIGHT_DISABLED, featureArgs } = require('../src/features');
const { chromeArgs } = require('../src/window');

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
  const a = featureArgs('darwin');
  assert.strictEqual(a.length, 1);
  assert.ok(a[0].startsWith('--disable-features='));
  const list = a[0].slice('--disable-features='.length).split(',');
  for (const f of installedList()) assert.ok(list.includes(f), `${f} 가 빠지면 플레이라이트가 끈 기능이 다시 켜진다`);
  assert.ok(list.includes('MacAppCodeSignClone'));
});

test('맥이 아니면 아무것도 안 붙인다(code sign clone 은 맥 전용)', () => {
  assert.deepStrictEqual(featureArgs('win32'), []);
  assert.deepStrictEqual(featureArgs('linux'), []);
});

test('세션 크롬 인자에도 맥이면 붙는다', () => {
  assert.deepStrictEqual(chromeArgs(null, false, null, 'darwin'), ['--test-type', ...featureArgs('darwin')]);
  assert.deepStrictEqual(chromeArgs(null, false, null, 'linux'), ['--test-type']);
});
