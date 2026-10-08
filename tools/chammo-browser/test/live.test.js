const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseResult, toolLine, readPort, enabled, createLive, liveFile } = require('../src/live');
const { chromeArgs } = require('../src/window');
const { portOpen } = require('../src/live');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-live-'));

test('MCP 응답에서 지금 탭 주소·제목·탭 목록(current)', () => {
  const text = [
    '### Ran Playwright code', '```js', "await page.goto('https://a.com');", '```',
    '### Open tabs', '- 0: [홈](https://a.com/)', '- 1: (current) [로그인 — A](https://a.com/login?next=%2F)', '- 2: [](about:blank)',
    '### Page', '- Page URL: https://a.com/login?next=%2F', '- Page Title: 로그인 — A',
  ].join('\n');
  assert.deepStrictEqual(parseResult(text), {
    url: 'https://a.com/login?next=%2F', title: '로그인 — A',
    tabs: [
      { index: 0, title: '홈', url: 'https://a.com/', current: false },
      { index: 1, title: '로그인 — A', url: 'https://a.com/login?next=%2F', current: true },
      { index: 2, title: '', url: 'about:blank', current: false },
    ],
  });
  assert.deepStrictEqual(parseResult('### Result\nok'), {});
});

test('하는 일 한 줄 — 친 글·파일·코드 값은 남기지 않는다(비밀번호가 앱 화면·파일에 남지 않게)', () => {
  assert.strictEqual(toolLine('browser_navigate', { url: 'https://a.com/x?token=abc#h' }), '이동 https://a.com/x');
  assert.strictEqual(toolLine('browser_click', { element: '로그인 버튼', ref: 'e12' }), '누름 로그인 버튼');
  assert.strictEqual(toolLine('browser_type', { element: '비밀번호 칸', ref: 'e3', text: 'hunter2' }), '입력 비밀번호 칸');
  assert.ok(!toolLine('browser_fill_form', { fields: [{ name: '비번', value: 'hunter2' }] }).includes('hunter2'));
  assert.ok(!toolLine('browser_evaluate', { function: '() => localStorage.token' }).includes('token'));
  assert.ok(!toolLine('browser_press_key', { key: 'Enter' }).includes('undefined'));
  assert.strictEqual(toolLine('browser_snapshot', {}), '화면 읽기');
  assert.ok(toolLine('browser_click', { element: 'x'.repeat(500) }).length <= 120);
});

test('포트 파일 — 숫자 포트와 /devtools/browser/ 경로만', () => {
  const d = tmp();
  assert.strictEqual(readPort(d), null);
  fs.writeFileSync(path.join(d, 'DevToolsActivePort'), '59660\n/devtools/browser/ef37-9671\n');
  assert.deepStrictEqual(readPort(d), { port: 59660, wsPath: '/devtools/browser/ef37-9671' });
  for (const bad of ['0\n/devtools/browser/a', '70000\n/devtools/browser/a', 'x\n/devtools/browser/a', '9222\n/json/../x', '9222\n//evil.com/devtools/browser/a']) {
    fs.writeFileSync(path.join(d, 'DevToolsActivePort'), bad);
    assert.strictEqual(readPort(d), null, bad);
  }
});

test('기능 스위치 — 설정에 없으면 켬, agentView:false 면 끔, 설정이 깨져도 켬', () => {
  const d = tmp();
  assert.strictEqual(enabled(d), true);
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ features: { agentView: false } }));
  assert.strictEqual(enabled(d), false);
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ features: { agentView: true } }));
  assert.strictEqual(enabled(d), true);
  fs.writeFileSync(path.join(d, 'config.json'), '{깨짐');
  assert.strictEqual(enabled(d), true);
});

test('크롬 인자 — 켜면 빈 포트(0). 창 있는 크롬은 127.0.0.1 에만 연다(실측은 lsof)', () => {
  assert.deepStrictEqual(chromeArgs(null, true, null, 'linux'), ['--test-type', '--remote-debugging-port=0']);
  assert.deepStrictEqual(chromeArgs(null, false, null, 'linux'), ['--test-type']);
  assert.deepStrictEqual(chromeArgs([1, 2], false, null, 'linux'), ['--test-type', '--window-position=1,2']);
});

test('상태 파일 — 도구 호출·응답마다 600 권한으로, 포트를 알 때만, 닫으면 지운다', () => {
  const root = tmp();
  const prof = path.join(root, 'profiles', 'acme');
  fs.mkdirSync(prof, { recursive: true });
  let t = 1000;
  const live = createLive({ profile: 'acme', root, profileDir: prof, pid: 11, ppid: 22, now: () => t });
  const file = liveFile(root, 'acme');
  live.onCall('browser_navigate', { url: 'https://a.com/' });
  assert.ok(!fs.existsSync(file), '포트 모르면 안 쓴다');
  fs.writeFileSync(path.join(prof, 'DevToolsActivePort'), '5000\n/devtools/browser/abc\n');
  t = 2000;
  live.onResult('browser_navigate', { content: [{ type: 'text', text: '### Page\n- Page URL: https://a.com/\n- Page Title: A' }] });
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual({ ...s }, {
    profile: 'acme', pid: 11, sessionPid: 22, port: 5000, wsPath: '/devtools/browser/abc',
    url: 'https://a.com/', title: 'A', tabs: [], tool: '이동 https://a.com/', toolAt: 1000, busy: false, ask: null, gate: false, held: 0, ts: 2000,
  });
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  assert.strictEqual(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  live.onCall('browser_click', { element: '다음' });
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).busy, true);
  live.closed();
  assert.ok(!fs.existsSync(file));
  live.closed(); // 두 번 불러도 괜찮다
});

test('시작할 때 낡은 포트 파일을 지운다(지난 크롬 것)', () => {
  const root = tmp();
  const prof = path.join(root, 'profiles', 'acme');
  fs.mkdirSync(prof, { recursive: true });
  fs.writeFileSync(path.join(prof, 'DevToolsActivePort'), '5000\n/devtools/browser/old\n');
  createLive({ profile: 'acme', root, profileDir: prof, pid: 1, ppid: 2 }).reset();
  assert.ok(!fs.existsSync(path.join(prof, 'DevToolsActivePort')));
});

test('사람 부르기 — 상태 파일에 ask 를 적고, 앱이 .done 을 만들면 지우고 돌아온다', async () => {
  const root = tmp();
  const prof = path.join(root, 'profiles', 'acme');
  fs.mkdirSync(prof, { recursive: true });
  fs.writeFileSync(path.join(prof, 'DevToolsActivePort'), '5000\n/devtools/browser/abc\n');
  const live = createLive({ profile: 'acme', root, profileDir: prof, pid: 1, ppid: 2, now: () => 7, probe: async () => true });
  live.onCall('browser_navigate', { url: 'https://a.com/' });
  const done = path.join(root, 'live', 'acme.done');
  const p = live.askHuman('네이버 로그인 — 2FA'.repeat(30), { pollMs: 5, timeoutMs: 2000 });
  await new Promise((r) => setTimeout(r, 20));
  const s = JSON.parse(fs.readFileSync(liveFile(root, 'acme'), 'utf8'));
  assert.ok(s.ask && s.ask.reason.length <= 200 && s.ask.at === 7);
  fs.writeFileSync(done, '');
  const r = await p;
  assert.strictEqual(r.ok, true);
  assert.ok(!fs.existsSync(done));
  assert.strictEqual(JSON.parse(fs.readFileSync(liveFile(root, 'acme'), 'utf8')).ask, null);
});

test('사람 부르기 — 브라우저가 안 떠 있으면 바로 실패, 시간이 다 되면 아직이라고', async () => {
  const root = tmp();
  const prof = path.join(root, 'profiles', 'acme');
  fs.mkdirSync(prof, { recursive: true });
  const live = createLive({ profile: 'acme', root, profileDir: prof, pid: 1, ppid: 2, probe: async () => true });
  live.onCall('browser_navigate', {});
  assert.strictEqual((await live.askHuman('x', { pollMs: 5, timeoutMs: 50 })).ok, false);
  fs.writeFileSync(path.join(prof, 'DevToolsActivePort'), '5000\n/devtools/browser/abc\n');
  const r = await live.askHuman('x', { pollMs: 5, timeoutMs: 40 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.timeout, true);
  assert.strictEqual(JSON.parse(fs.readFileSync(liveFile(root, 'acme'), 'utf8')).ask, null, '시간이 다 되면 표시를 지운다');
});

test('사람 파일 창 수 — 앱이 <live>/<프로필>.choosers 에 적은 수 중 아직 안 치운 만큼만, 닫으면 처음부터', () => {
  const root = tmp();
  const prof = path.join(root, 'profiles', 'acme');
  fs.mkdirSync(prof, { recursive: true });
  const live = createLive({ profile: 'acme', root, profileDir: prof, pid: 1, ppid: 2 });
  const f = path.join(root, 'live', 'acme.choosers');
  assert.strictEqual(live.takeHumanChoosers(), 0, '파일 없음');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '3');
  assert.strictEqual(live.takeHumanChoosers(), 3);
  assert.strictEqual(live.takeHumanChoosers(), 0, '한 번 치운 건 다시 안');
  fs.writeFileSync(f, '4');
  assert.strictEqual(live.takeHumanChoosers(), 1);
  fs.writeFileSync(f, 'abc');
  assert.strictEqual(live.takeHumanChoosers(), 0, '모양이 이상하면 0');
  fs.writeFileSync(f, '999999');
  assert.strictEqual(live.takeHumanChoosers(), 10, '한 번에 너무 많이는 안(상한)');
  live.closed();
  assert.ok(!fs.existsSync(f), '브라우저가 닫히면 수 파일도 지운다');
  fs.writeFileSync(f, '2');
  assert.strictEqual(live.takeHumanChoosers(), 2, '닫은 뒤엔 처음부터 센다');
  live.reset();
  assert.ok(!fs.existsSync(f));
});

const PORT_FILE = '5000\n/devtools/browser/abc\n';

test('닫힌 뒤엔 낡은 포트 파일로 상태 파일을 다시 쓰지 않는다 — 유휴 닫기 뒤 사람 부르기가 죽은 포트를 앱에 알렸다(2026-10-05 QA 5)', async () => {
  const root = tmp();
  const prof = path.join(root, 'profiles', 'acme');
  fs.mkdirSync(prof, { recursive: true });
  const live = createLive({ profile: 'acme', root, profileDir: prof, pid: 1, ppid: 2, probe: async () => true });
  live.onCall('browser_navigate', {});
  fs.writeFileSync(path.join(prof, 'DevToolsActivePort'), PORT_FILE);
  live.onResult('browser_navigate', {});
  assert.ok(fs.existsSync(liveFile(root, 'acme')));
  live.closed(); // 유휴 10분 닫기·browser_close
  assert.ok(!fs.existsSync(path.join(prof, 'DevToolsActivePort')), '크롬이 남긴 포트 파일도 지운다');
  fs.writeFileSync(path.join(prof, 'DevToolsActivePort'), PORT_FILE); // 지우기 전에 크롬이 다시 썼다 쳐도
  const r = await live.askHuman('로그인', { pollMs: 5, timeoutMs: 50 });
  assert.strictEqual(r.ok, false);
  assert.match(r.text, /browser_navigate/);
  assert.ok(!fs.existsSync(liveFile(root, 'acme')), '닫힌 브라우저로는 상태 파일을 안 쓴다');
});

test('사람 부르기 — 포트가 응답 안 하면(크롬이 죽음) 앱에 안 띄우고 바로 실패, 상태 파일도 치운다', async () => {
  const root = tmp();
  const prof = path.join(root, 'profiles', 'acme');
  fs.mkdirSync(prof, { recursive: true });
  const probed = [];
  const live = createLive({ profile: 'acme', root, profileDir: prof, pid: 1, ppid: 2, probe: async (p) => { probed.push(p); return false; } });
  live.onCall('browser_navigate', {});
  fs.writeFileSync(path.join(prof, 'DevToolsActivePort'), PORT_FILE);
  live.onResult('browser_navigate', {});
  const r = await live.askHuman('로그인', { pollMs: 5, timeoutMs: 50 });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(probed, [5000, 5000], '한 번 늦은 걸 죽음으로 안 보게 한 번 더 묻는다');
  assert.ok(!fs.existsSync(liveFile(root, 'acme')));
  assert.ok(fs.existsSync(path.join(prof, 'DevToolsActivePort')), '확인 실패만으론 포트 파일을 안 지운다(살아 있는 크롬이면 다시 안 써 준다)');
  live.onCall('browser_snapshot', {}); // 다음 호출 — 다시 쓸 수 있다
  live.onResult('browser_snapshot', {});
  assert.ok(fs.existsSync(liveFile(root, 'acme')));
});

test('사람 부르기 — 기다리는 중에 크롬이 죽거나 닫히면 그만 기다린다', async () => {
  const root = tmp();
  const prof = path.join(root, 'profiles', 'acme');
  fs.mkdirSync(prof, { recursive: true });
  let alive = true;
  const live = createLive({ profile: 'acme', root, profileDir: prof, pid: 1, ppid: 2, probe: async () => alive });
  live.onCall('browser_navigate', {});
  fs.writeFileSync(path.join(prof, 'DevToolsActivePort'), PORT_FILE);
  const p = live.askHuman('로그인', { pollMs: 5, timeoutMs: 5000, probeMs: 20 });
  await new Promise((r) => setTimeout(r, 15));
  alive = false;
  const t = Date.now();
  const r = await p;
  assert.strictEqual(r.ok, false);
  assert.ok(Date.now() - t < 1000, '10분을 다 기다리지 않는다');
  assert.ok(!fs.existsSync(liveFile(root, 'acme')));

  const live2 = createLive({ profile: 'acme', root, profileDir: prof, pid: 1, ppid: 2, probe: async () => true });
  live2.onCall('browser_navigate', {});
  fs.writeFileSync(path.join(prof, 'DevToolsActivePort'), PORT_FILE);
  const p2 = live2.askHuman('로그인', { pollMs: 5, timeoutMs: 5000 });
  await new Promise((r) => setTimeout(r, 15));
  live2.closed();
  assert.strictEqual((await p2).ok, false);
});

test('포트 확인 — 127.0.0.1 에 듣는 곳이 있으면 true, 없으면 false', async () => {
  const net = require('net');
  const srv = net.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const { port } = srv.address();
  assert.strictEqual(await portOpen(port), true);
  srv.close();
  await new Promise((r) => srv.once('close', r));
  assert.strictEqual(await portOpen(port), false);
});

test('개입 문지기 — gate 를 켜고 만든 래퍼는 상태에 gate:true, 세션이 기다리는 동안 held 시각', () => {
  const root = tmp();
  const prof = path.join(root, 'profiles', 'acme');
  fs.mkdirSync(prof, { recursive: true });
  fs.writeFileSync(path.join(prof, 'DevToolsActivePort'), '5000\n/devtools/browser/abc\n');
  let t = 1000;
  const live = createLive({ profile: 'acme', root, profileDir: prof, pid: 11, ppid: 22, now: () => t, gate: true });
  live.onCall('browser_navigate', { url: 'https://a.com/' });
  const read = () => JSON.parse(fs.readFileSync(liveFile(root, 'acme'), 'utf8'));
  assert.strictEqual(read().gate, true);
  t = 5000;
  live.held(true);
  assert.strictEqual(read().held, 5000);
  live.held(false);
  assert.strictEqual(read().held, 0);
});
