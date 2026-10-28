const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const windesk = require('../src/windesk');

// 2026-10-28 인앱 브라우저 윈도우판 — 세션 크롬을 숨은 데스크톱에 띄운다(spike: 작업 표시줄·Alt+Tab 0, 새 창 뒤에도).
// 플레이라이트는 크롬을 파이프(fd 3·4)로 붙여 띄우니 크롬 대신 실행기를 띄우고, 실행기가 그 파이프를 그대로 크롬에 넘긴다
test('크롬 대신 실행기를 띄운다 — 첫 인자 데스크톱 이름, 그다음 크롬과 원래 인자 그대로', () => {
  const s = windesk.deskSpawn('C:\\Chrome\\chrome.exe', ['--remote-debugging-pipe', '--user-data-dir=C:\\p q'], 'C:\\d\\ChammoDesk-ab.exe');
  assert.strictEqual(s.cmd, 'C:\\d\\ChammoDesk-ab.exe');
  assert.deepStrictEqual(s.args, [windesk.DESKTOP, 'C:\\Chrome\\chrome.exe', '--remote-debugging-pipe', '--user-data-dir=C:\\p q']);
});

test('실행기는 한 번만 빌드한다 — 소스가 같으면 캐시, 바뀌면 이름(해시)이 바뀌어 새로', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-desk-'));
  const calls = [];
  const spawnSync = (cmd, args) => {
    calls.push([cmd, args]);
    // 빌드 흉내 — PowerShell 이 -OutputAssembly 에 exe 를 쓴다
    const out = args.join(' ').match(/OutputAssembly '([^']+)'/)[1];
    fs.writeFileSync(out, 'MZ');
    return { status: 0, stdout: '', stderr: '' };
  };
  const exe = windesk.ensureLauncher({ root, spawnSync });
  assert.ok(exe && fs.existsSync(exe), '빌드했다');
  assert.match(path.basename(exe), /^ChammoDesk-[0-9a-f]{8}\.exe$/);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], 'powershell.exe');
  assert.strictEqual(windesk.ensureLauncher({ root, spawnSync }), exe, '두 번째는 캐시');
  assert.strictEqual(calls.length, 1);
  // 소스(C#)를 임시 파일로 넘겼고 남지 않았다
  assert.deepStrictEqual(fs.readdirSync(path.dirname(exe)).filter((f) => !f.endsWith('.exe')), []);
});

test('빌드가 실패하면 null — 그때는 헤드리스로 띄운다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-desk-'));
  const exe = windesk.ensureLauncher({ root, spawnSync: () => ({ status: 1, stdout: '', stderr: 'Add-Type 실패' }), log: () => {} });
  assert.strictEqual(exe, null);
  // 시간 초과(오류 객체)도
  assert.strictEqual(windesk.ensureLauncher({ root, spawnSync: () => ({ error: new Error('ETIMEDOUT') }), log: () => {} }), null);
});

test('실행기 소스 — 파이프(lpReserved2)·표준 핸들을 그대로 넘기는 상속 CreateProcess, 데스크톱을 못 만들면 헤드리스 2배', () => {
  const cs = windesk.SOURCE;
  assert.match(cs, /GetStartupInfoW/);
  assert.match(cs, /CreateDesktopW/);
  assert.match(cs, /lpDesktop/);
  assert.match(cs, /CreateProcessW\([^;]*true/, '핸들 상속 켬 — 안 켜면 파이프가 안 넘어가 플레이라이트가 영영 기다린다');
  assert.match(cs, /--headless=new/);
  assert.match(cs, /--force-device-scale-factor=2/);
  assert.match(cs, /GetExitCodeProcess/, '크롬 종료 코드를 그대로 — 플레이라이트가 닫힘을 안다');
});

// 맥 '가짜 화면 없음'과 같은 꼴 — 실행기가 없으면(빌드 실패) 숨은 데스크톱 대신 헤드리스
test('윈도우 spawn 바꾸기 — 우리가 자리를 넣은 크롬만, 실행기가 없으면 헤드리스', () => {
  const chrome = 'C:\\Chrome\\chrome.exe';
  const args = ['--test-type', '--window-position=0,0', '--window-size=1280,800', '--remote-debugging-pipe'];
  assert.deepStrictEqual(windesk.rewrite(chrome, args, { exe: 'C:\\d\\D.exe' }), { cmd: 'C:\\d\\D.exe', args: [windesk.DESKTOP, chrome, ...args] });
  const h = windesk.rewrite(chrome, args, { exe: null });
  assert.strictEqual(h.cmd, chrome);
  assert.ok(h.args.includes('--headless=new') && !h.args.some((a) => a.startsWith('--window-position')));
  // 보이는 창으로 다시 띄우는 중(사람 차례 OS 창)이면 그대로 — 보이는 자리에
  const v = windesk.rewrite(chrome, args, { exe: 'C:\\d\\D.exe', visible: true });
  assert.strictEqual(v.cmd, chrome);
  assert.ok(v.args.includes('--window-position=80,60'), '보이는 화면 안쪽');
  // 자리 인자가 없는 띄우기(설치 등)는 손대지 않는다
  assert.strictEqual(windesk.rewrite('C:\\x\\setup.exe', ['--install'], { exe: 'C:\\d\\D.exe' }), null);
});

test('보이는 창 표시 파일 — 있으면 보이는 데스크톱에(사람 차례), 지우면 다시 숨은 데스크톱', () => {
  const live = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-live-'));
  assert.strictEqual(windesk.visibleWanted(live, 'shop'), false);
  fs.writeFileSync(windesk.visibleFile(live, 'shop'), '{}');
  assert.strictEqual(windesk.visibleWanted(live, 'shop'), true);
  assert.strictEqual(windesk.visibleWanted(live, 'other'), false);
});

// 세션 시작 때 자리 — 윈도우는 앱이 있고 앱에서 보기가 켜졌을 때만 숨은 데스크톱(자리 인자가 spawn 바꾸기 표시). 앱이 없는 기계는 그대로 보이는 크롬
test('윈도우 자리 — 앱에서 보기면 숨은 데스크톱 표시, 아니면 예전 그대로', () => {
  const { placement } = require('../src/window');
  assert.deepStrictEqual(placement({ profile: 'p', watchable: true, appHere: true, vdFile: 'x', mac: false, win: true }), { pos: [0, 0], size: [1280, 800], offPos: null, desk: true });
  assert.deepStrictEqual(placement({ profile: 'p', watchable: true, appHere: false, vdFile: 'x', mac: false, win: true }), { pos: null, size: null, offPos: null });
  assert.deepStrictEqual(placement({ profile: 'p', watchable: false, appHere: true, vdFile: 'x', mac: false, win: true }), { pos: null, size: null, offPos: null });
});
