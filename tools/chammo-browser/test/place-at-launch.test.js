const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { swapPlace, askApp } = require('../src/place-at-launch');

// 2026-10-20: 가짜 화면을 필요할 때만 띄우니 세션 시작 때 정한 자리가 크롬이 뜰 때쯤 낡는다 — 뜰 때 자리를 다시 넣는다
test('크롬이 뜰 때 창 자리·크기 인자만 새 값으로 바꾼다', () => {
  const args = ['--test-type', '--window-position=9000,0', '--window-size=1280,800', '--remote-debugging-port=0', '--user-data-dir=/p'];
  assert.deepStrictEqual(swapPlace(args, { pos: [-2886, 980], size: [1394, 852] }),
    ['--test-type', '--window-position=-2886,980', '--window-size=1394,852', '--remote-debugging-port=0', '--user-data-dir=/p']);
  // 새 자리에 크기가 없으면 크기 인자는 뺀다(크롬이 정하게)
  assert.deepStrictEqual(swapPlace(['--window-position=1,2', '--window-size=3,4', '--x'], { pos: [5, 6], size: null }), ['--window-position=5,6', '--x']);
  // 자리를 못 정했으면 그대로
  assert.deepStrictEqual(swapPlace(['--window-position=1,2'], { pos: null, size: null }), ['--window-position=1,2']);
});

test('앱에 가짜 화면 부탁 — 데이터 폴더 app.jsonl 에 한 줄', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-ask-'));
  askApp(d);
  const line = JSON.parse(fs.readFileSync(path.join(d, 'app.jsonl'), 'utf8').trim());
  assert.strictEqual(line.action, 'vdisplay');
  assert.deepStrictEqual(line.arg, { verb: 'want' });
  assert.match(line.id, /^[0-9a-f]{12}$/);
  assert.doesNotThrow(() => askApp(path.join(d, 'no', 'such')), '못 써도 크롬은 뜬다');
});

// 2026-10-27 인앱 브라우저 A: Dock·⌘Tab 빼기 dylib 는 세션 크롬(그 실행 파일)에만 — MCP(node) 자신이나 다른 띄우기엔 안 넣는다
test('주입은 그 크롬 실행 파일을 띄울 때만, 플레이라이트가 준 env 위에 더한다', () => {
  const { withInject } = require('../src/place-at-launch');
  const inject = { exe: '/b/app/Chammo Browser.app/Contents/MacOS/Google Chrome Beta', dylib: '/d/tools/chammo-accessory.dylib' };
  const opts = withInject(inject.exe, { env: { A: '1' }, stdio: 'pipe' }, inject);
  assert.deepStrictEqual(opts, { env: { A: '1', DYLD_INSERT_LIBRARIES: inject.dylib }, stdio: 'pipe' });
  assert.deepStrictEqual(withInject('/usr/bin/open', { env: { A: '1' } }, inject), { env: { A: '1' } });
  assert.deepStrictEqual(withInject(inject.exe, { env: { A: '1' } }, null), { env: { A: '1' } });
  // env 를 안 줬으면 지금 프로세스 env 위에
  assert.strictEqual(withInject(inject.exe, undefined, inject).env.DYLD_INSERT_LIBRARIES, inject.dylib);
});

// 2026-10-27 인앱 브라우저 A 6단계 — 가짜 화면을 끝내 못 받은 맥(옛 macOS·도우미 실패)은 화면 밖 창 대신 헤드리스 2배로.
// 화면 밖 창은 맥·크롬이 화면 안으로 끌어와 사용자 화면에 보였고(minimize.js), 칸은 그 창을 못 비춘다. 헤드리스는 앱이 CDP 그림으로 칸에 그린다
test('가짜 화면이 없으면 창 자리 대신 헤드리스(new) + 2배 그림', () => {
  const { headlessArgs } = require('../src/place-at-launch');
  const args = ['--test-type', '--window-position=9000,0', '--window-size=1280,800', '--remote-debugging-port=0', '--use-mock-keychain'];
  assert.deepStrictEqual(headlessArgs(args), ['--test-type', '--remote-debugging-port=0', '--use-mock-keychain', '--headless=new', '--force-device-scale-factor=2']);
  // 이미 헤드리스면 그대로(두 번 안 붙인다)
  const twice = headlessArgs(headlessArgs(args));
  assert.strictEqual(twice.filter((a) => a.startsWith('--headless')).length, 1);
  assert.strictEqual(twice.filter((a) => a.startsWith('--force-device-scale-factor')).length, 1);
});

// 2026-10-28 패스키 탈출구 — 사람이 '이번만 구글 크롬으로 열기'를 누른 동안(<live>/<프로필>.signed-want) 띄우는 크롬은 구글 서명 원본, 주입 없이
test('구글 크롬 표가 있으면 ad-hoc 사본 대신 서명 원본을 주입 없이, 없으면 사본 + 주입', () => {
  const { launchExe } = require('../src/place-at-launch');
  const inject = { exe: '/b/app/x-adhoc/Chammo Browser.app/Contents/MacOS/Google Chrome Beta', dylib: '/d/a.dylib', signed: '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta' };
  assert.deepStrictEqual(launchExe(inject.exe, { env: { A: '1' } }, inject, true), { cmd: inject.signed, opts: { env: { A: '1' } } });
  assert.deepStrictEqual(launchExe(inject.exe, { env: { A: '1' } }, inject, false), { cmd: inject.exe, opts: { env: { A: '1', DYLD_INSERT_LIBRARIES: inject.dylib } } });
  // 원본을 모르면(옛 래퍼 설정) 표가 있어도 사본 그대로
  const old = { exe: inject.exe, dylib: inject.dylib };
  assert.strictEqual(launchExe(inject.exe, {}, old, true).cmd, inject.exe);
  // 다른 띄우기는 손대지 않는다
  assert.deepStrictEqual(launchExe('/usr/bin/open', { env: {} }, inject, true), { cmd: '/usr/bin/open', opts: { env: {} } });
});

// 0.4.4 리뷰 3 — 가짜 화면이 없으면 패스키 전환(구글 서명 크롬)도 헤드리스로 떠서 맥 패스키·Touch ID 창이 절대 안 떴다(두 번 다시 띄우기만).
// 패스키 갈래는 사람이 그 창을 눌러야 하니 보이는 창으로(자리 인자를 빼 크롬 기본 자리), 사본은 그대로 헤드리스
test('가짜 화면이 없을 때 — 사본은 헤드리스, 구글 크롬(패스키) 갈래는 보이는 창', () => {
  const { launchArgs } = require('../src/place-at-launch');
  const args = ['--test-type', '--window-position=9000,0', '--window-size=1280,800', '--remote-debugging-port=0'];
  const off = { pos: [9000, 0], size: [1280, 800], offPos: [9000, 0] };
  assert.ok(launchArgs(args, off, false).includes('--headless=new'));
  const vis = launchArgs(args, off, true);
  assert.deepStrictEqual(vis, ['--test-type', '--remote-debugging-port=0']);
  // 가짜 화면이 있으면 두 갈래 다 그 자리로
  const vd = { pos: [3000, 100], size: [1200, 900], offPos: null };
  assert.deepStrictEqual(launchArgs(args, vd, true), ['--test-type', '--window-position=3000,100', '--window-size=1200,900', '--remote-debugging-port=0']);
});
