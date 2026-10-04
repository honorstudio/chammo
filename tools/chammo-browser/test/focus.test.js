const { test } = require('node:test');
const assert = require('node:assert');
const { parseBundleId, createFocusGuard, BROWSER_IDS } = require('../src/focus');

test('lsappinfo 출력에서 번들 id 를 읽는다', () => {
  assert.strictEqual(parseBundleId('"CFBundleIdentifier"="com.honorstudio.chammo"\n'), 'com.honorstudio.chammo');
  // macOS 27(아이맥 2026-10-03)은 -only 를 줘도 이 모양으로 준다
  assert.strictEqual(parseBundleId('[ NULL ]  ASN:0x0-0x708708: (in front) \n    bundleID="app.chammo.desktop"\n    bundle path=[ NULL ] '), 'app.chammo.desktop');
  assert.strictEqual(parseBundleId(''), null);
  assert.strictEqual(parseBundleId('"CFBundleIdentifier"=[ NULL ]'), null);
});

function guard(fronts) {
  const seq = [...fronts];
  const activated = [];
  const g = createFocusGuard({ front: () => seq.shift() ?? null, activate: (id) => activated.push(id) });
  return { g, activated };
}

test('브라우저가 뜨면서 크롬이 앞으로 오면 원래 앞 앱으로 되돌린다', () => {
  const { g, activated } = guard(['com.honorstudio.chammo', BROWSER_IDS[0]]);
  g.start();
  g.end();
  assert.deepStrictEqual(activated, ['com.honorstudio.chammo']);
});

test('사용자가 원래 크롬을 보고 있었으면(앞 앱이 크롬) 건드리지 않는다', () => {
  const { g, activated } = guard([BROWSER_IDS[0], BROWSER_IDS[0]]);
  g.start();
  g.end();
  assert.deepStrictEqual(activated, []);
});

test('그 사이 사용자가 크롬 말고 다른 앱으로 옮겼으면 그대로 둔다', () => {
  const { g, activated } = guard(['com.honorstudio.chammo', 'com.apple.Terminal']);
  g.start();
  g.end();
  assert.deepStrictEqual(activated, []);
});

test('겹친 호출은 처음 시작 때 앞 앱을 기억하고 마지막 끝에서 한 번만 본다', () => {
  const { g, activated } = guard(['com.honorstudio.chammo', BROWSER_IDS[0]]);
  g.start();
  g.start();
  g.end();
  assert.deepStrictEqual(activated, []);
  g.end();
  assert.deepStrictEqual(activated, ['com.honorstudio.chammo']);
});

test('앞 앱을 못 읽으면(권한·명령 없음) 아무것도 안 한다', () => {
  const { g, activated } = guard([null, BROWSER_IDS[0]]);
  g.start();
  g.end();
  assert.deepStrictEqual(activated, []);
});
