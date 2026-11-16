const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const m = require('../src/memcap');

const P = '/u/.x/browser/profiles';
const GB = 1024 ** 3;
// ps -axo pid=,ppid=,rss=,args= 모양(rss 는 KB)
const PS = [
  `  100     1  204800 /A/Chammo Browser.app/Contents/MacOS/Google Chrome --no-first-run --user-data-dir=${P}/store-shop --remote-debugging-port=0`,
  `  101   100 5242880 /A/Helpers/Google Chrome Helper (Renderer).app/x --type=renderer --renderer-client-id=7`,
  `  102   100 1048576 /A/Helpers/Google Chrome Helper (Renderer).app/x --type=renderer --extension-process`,
  `  103   100  102400 /A/Helpers/Google Chrome Helper (GPU).app/x --type=gpu-process`,
  `  104   101    1024 /A/Helpers/crashpad --type=crashpad`,
  `  200     1  102400 /A/Chammo Browser.app/Contents/MacOS/Google Chrome --user-data-dir=${P}/phone-e2e --headless`,
  `  201   200 1048576 /A/Helpers/Google Chrome Helper (Renderer).app/x --type=renderer`,
  // 사람 크롬·다른 폴더 크롬·node 는 안 센다
  `  300     1 9999999 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
  `  400     1 9999999 /x/chrome --user-data-dir=/tmp/other-profile`,
  `  500     1 9999999 node jest-worker`,
].join('\n');

test('ps 줄 읽기 — pid·ppid·rss(바이트)·args, 깨진 줄은 버린다', () => {
  const rows = m.parsePs(`${PS}\n  garbage line\n`);
  assert.equal(rows.length, 10);
  assert.deepEqual(rows[1], { pid: 101, ppid: 100, bytes: 5242880 * 1024, args: rows[1].args });
});

test('프로필별 크롬 묶음 — 우리 프로필 폴더 크롬과 그 자식만, 제일 큰 렌더러(확장 빼고)', () => {
  const g = m.chromeGroups(m.parsePs(PS), P);
  assert.deepEqual([...g.keys()].sort(), ['phone-e2e', 'store-shop']);
  const s = g.get('store-shop');
  assert.equal(s.root, 100);
  assert.deepEqual(s.pids.sort(), [100, 101, 102, 103, 104]);
  assert.equal(s.bytes, (204800 + 5242880 + 1048576 + 102400 + 1024) * 1024);
  assert.deepEqual(s.biggest, { pid: 101, bytes: 5242880 * 1024 });
  // 공백 있는 프로필 경로·끝에 붙은 인자 없는 모양도
  const g2 = m.chromeGroups(m.parsePs(`9 1 10 /c --user-data-dir=${P}/a b`), P);
  assert.equal(g2.has('a b'), false, '프로필 이름은 공백 앞까지');
  assert.equal(m.chromeGroups(m.parsePs(`9 1 10 /c --user-data-dir=${P}/project-x`), P).get('project-x').root, 9);
});

test('상한 판단 — 프로필 상한·전체 상한(제일 큰 프로필만)·3분 안 두 번째면 끄기', () => {
  const g = m.chromeGroups(m.parsePs(PS), P);
  const caps = { profileBytes: 7 * GB, totalBytes: 12 * GB }; // store-shop 묶음 ≈ 6.3GB
  assert.equal(m.decide({ groups: g, me: 'store-shop', caps, now: 0 }).act, 'none');
  const low = { profileBytes: 5 * GB, totalBytes: 12 * GB };
  assert.deepEqual(m.decide({ groups: g, me: 'store-shop', caps: low, now: 0 }), { act: 'trim', why: 'profile', bytes: g.get('store-shop').bytes, total: m.total(g), pid: 101 });
  assert.equal(m.decide({ groups: g, me: 'phone-e2e', caps: low, now: 0 }).act, 'none', '내 프로필은 안 넘음');
  // 전체만 넘으면 제일 큰 프로필 감시만 움직인다(둘이 같이 자르지 않게)
  const tot = { profileBytes: 20 * GB, totalBytes: 6 * GB };
  assert.equal(m.decide({ groups: g, me: 'store-shop', caps: tot, now: 0 }).why, 'total');
  assert.equal(m.decide({ groups: g, me: 'phone-e2e', caps: tot, now: 0 }).act, 'none');
  // 잘랐는데 3분 안에 또 넘음 → 그 프로필 크롬 끄기
  assert.equal(m.decide({ groups: g, me: 'store-shop', caps: low, now: 100_000, lastTrimAt: 0 }).act, 'kill');
  assert.equal(m.decide({ groups: g, me: 'store-shop', caps: low, now: 200_000, lastTrimAt: 0 }).act, 'trim');
  // 자를 렌더러가 없으면 바로 끄기
  const only = m.chromeGroups(m.parsePs(`9 1 8000000 /c --user-data-dir=${P}/project-x`), P);
  assert.equal(m.decide({ groups: only, me: 'project-x', caps: low, now: 0 }).act, 'kill');
});

test('상한 값 — 설정 파일(GB)에서, 없거나 이상하면 기본 6·12, 전체는 프로필보다 작지 않게', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'memcap-'));
  assert.deepEqual(m.readCaps(d), { profileGb: 6, totalGb: 12 });
  fs.mkdirSync(path.dirname(m.capsFile(d)), { recursive: true });
  fs.writeFileSync(m.capsFile(d), JSON.stringify({ profileGb: 0.5, totalGb: 3 }));
  assert.deepEqual(m.readCaps(d), { profileGb: 0.5, totalGb: 3 });
  fs.writeFileSync(m.capsFile(d), JSON.stringify({ profileGb: 8, totalGb: 4 }));
  assert.deepEqual(m.readCaps(d), { profileGb: 8, totalGb: 8 });
  fs.writeFileSync(m.capsFile(d), JSON.stringify({ profileGb: 'x', totalGb: -1 }));
  assert.deepEqual(m.readCaps(d), { profileGb: 6, totalGb: 12 });
  fs.writeFileSync(m.capsFile(d), '{깨짐');
  assert.deepEqual(m.readCaps(d), { profileGb: 6, totalGb: 12 });
});

test('기록 — 한 줄 JSON 을 덧붙이고 200줄 넘으면 앞을 버린다', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'memcap-')), 'run', 'memcap.jsonl');
  for (let i = 0; i < 205; i++) m.appendEvent(f, { at: i, profile: 'p' });
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
  assert.equal(lines.length, 200);
  assert.equal(JSON.parse(lines[0]).at, 5);
});

test('세션에 줄 한 줄 — 무엇을·크기·탭 주소(쿼리 없이)', () => {
  const t = m.noteText({ profile: 'store-shop', action: 'trim', bytes: 7.4 * GB, capGb: 6, why: 'profile', tabs: ['https://x.com/p/1'] });
  assert.match(t, /store-shop/);
  assert.match(t, /7\.4GB/);
  assert.match(t, /https:\/\/x\.com\/p\/1/);
  assert.equal(t.includes('\n'), false);
  assert.match(m.noteText({ profile: 'a', action: 'kill', bytes: 9 * GB, capGb: 12, why: 'total', tabs: [] }), /껐어/);
});

test('감시 한 바퀴 — 넘으면 자르고 기록·꼬리, 다시 넘으면 끈다, 크롬이 없으면 ps 를 안 돈다', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memcap-'));
  const calls = [];
  let now = 0;
  let running = true;
  const w = m.createWatch({
    profile: 'store-shop', profilesDir: P, dataDir: root, eventsFile: path.join(root, 'memcap.jsonl'), sessionPid: 42, via: 'script',
    running: () => running,
    ps: async () => { calls.push('ps'); return PS; },
    caps: () => ({ profileGb: 5, totalGb: 12 }),
    trim: async (pid) => { calls.push(`trim ${pid}`); return ['https://shop.example/p/1']; },
    tabs: async () => ['https://shop.example/p/2'],
    kill: async (pid) => { calls.push(`kill ${pid}`); calls.push(`기록 ${fs.readFileSync(path.join(root, 'memcap.jsonl'), 'utf8').trim().split('\n').length}`); },
    now: () => now,
    log: () => {},
  });
  await w.tick();
  assert.deepEqual(calls, ['ps', 'trim 101']);
  const ev = JSON.parse(fs.readFileSync(path.join(root, 'memcap.jsonl'), 'utf8').trim());
  assert.equal(ev.action, 'trim');
  assert.equal(ev.sessionPid, 42);
  assert.equal(ev.via, 'script');
  assert.deepEqual(ev.tabs, ['https://shop.example/p/1']);
  assert.match(w.takeNote(), /shop\.example\/p\/1/);
  assert.equal(w.takeNote(), '', '꼬리는 한 번만');
  now = 60_000;
  await w.tick();
  assert.deepEqual(calls.slice(2), ['ps', 'kill 100', '기록 2'], '끄기 전에 기록이 먼저 남는다(크롬이 꺼지면 지킴이가 바로 끝난다)');
  running = false;
  await w.tick();
  assert.equal(calls.length, 5, '크롬이 없으면 ps 도 안 돈다');
});

test('자르기 — CDP 에 못 붙거나 늦어도 렌더러는 바로 끊는다(11-16 부하 30+ 에서 1분 넘게 못 자름)', async () => {
  const { trimRenderer } = require('../src/memcap-run');
  const { spawn } = require('child_process');
  const run = async (connect) => {
    const c = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
    const t0 = Date.now();
    const urls = await trimRenderer({ port: 1, wsPath: '/x' }, c.pid, { connect, connectMs: 300 });
    const dead = await new Promise((r) => { c.once('exit', () => r(true)); setTimeout(() => r(false), 2000); });
    return { urls, dead, ms: Date.now() - t0 };
  };
  const failed = await run(() => Promise.reject(new Error('연결 거부')));
  assert.deepEqual(failed.urls, []);
  assert.equal(failed.dead, true, '연결 실패여도 끊는다');
  const slow = await run(() => new Promise(() => {}));
  assert.equal(slow.dead, true, '안 붙고 매달려도 끊는다');
  assert.ok(slow.ms < 1500, `시간 제한 안에(${slow.ms}ms)`);
});
