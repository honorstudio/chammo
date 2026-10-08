const { test } = require('node:test');
const assert = require('node:assert');
const s = require('../src/script');

test('launch 인자 — 프로필·주인·채널·헤드리스·화면 끄기·기다림', () => {
  assert.deepEqual(s.parseArgs(['project-x']), { profile: 'project-x', owner: null, channel: null, headless: false, view: true, waitMs: 120_000 });
  const a = s.parseArgs(['project-x', '--owner', '123', '--channel=chrome', '--headless', '--no-view', '--wait', '5']);
  assert.deepEqual(a, { profile: 'project-x', owner: 123, channel: 'chrome', headless: true, view: false, waitMs: 5000 });
  assert.throws(() => s.parseArgs(['project-x', '--owner', 'abc']), /--owner/);
  assert.throws(() => s.parseArgs(['project-x', '--channel', 'chromium']), /chrome/);
  assert.throws(() => s.parseArgs(['project-x', '--what']), /--what/);
  assert.throws(() => s.parseArgs([]), /프로필/);
});

test('세션 pid — CLAUDE_PID 가 먼저, 없으면 조상 중 claude', () => {
  assert.equal(s.sessionPid({ env: { CLAUDE_PID: '28753' }, start: 1 }), 28753);
  const tree = { 10: [9, 'node'], 9: [8, '/bin/zsh'], 8: [7, 'claude bg-spare'], 7: [1, 'claude bg-pty-host'] };
  const ps = (pid) => tree[pid] || null;
  assert.equal(s.sessionPid({ env: {}, start: 10, ps }), 8);
  assert.equal(s.sessionPid({ env: { CLAUDE_PID: 'x' }, start: 10, ps }), 8);
  assert.equal(s.sessionPid({ env: {}, start: 10, ps: (pid) => (pid === 10 ? [1, 'node'] : null) }), 0);
  // /Users/x/.local/bin/claude 처럼 경로째 찍히는 모양도
  assert.equal(s.sessionPid({ env: {}, start: 5, ps: (pid) => ({ 5: [4, 'python3'], 4: [1, '/Users/x/.local/bin/claude'] })[pid] }), 4);
});

function deps(over = {}) {
  const calls = { spawn: 0, join: [], sleeps: 0 };
  let t = 0;
  const d = {
    readLock: () => null,
    isAlive: () => true,
    foreign: () => null,
    readPort: () => null,
    portOpen: async () => true,
    join: (owner, holder) => { calls.join.push([owner, holder]); return true; },
    spawnHolder: async () => { calls.spawn++; return { ok: true, wsEndpoint: 'ws://127.0.0.1:9/devtools/browser/a', shared: false, holder: 77 }; },
    sleep: async (ms) => { calls.sleeps++; t += ms; },
    now: () => t,
    ...over,
  };
  return { d, calls };
}
const opts = { profile: 'p', owner: 50, waitMs: 2000 };

test('잠금이 비었으면 지킴이를 띄워 그 주소를 준다', async () => {
  const { d, calls } = deps();
  const r = await s.launchClient(opts, d);
  assert.equal(r.ok, true);
  assert.equal(calls.spawn, 1);
});

test('누가 쓰고 있고 크롬 포트가 살아 있으면 같은 크롬을 같이 쓴다(사용자로 이름 올림)', async () => {
  const { d, calls } = deps({ readLock: () => ({ pid: 99 }), readPort: () => ({ port: 4567, wsPath: '/devtools/browser/x-1' }) });
  const r = await s.launchClient(opts, d);
  assert.deepEqual(r, { ok: true, wsEndpoint: 'ws://127.0.0.1:4567/devtools/browser/x-1', shared: true, holder: 99, profile: 'p' });
  assert.deepEqual(calls.join, [[50, 99]]);
  assert.equal(calls.spawn, 0);
});

test('쓰는 중인데 붙을 포트가 없으면 기다리다 시간이 다 되면 바쁨(code 2)', async () => {
  const { d, calls } = deps({ readLock: () => ({ pid: 99, startedAt: 't' }) });
  const r = await s.launchClient(opts, d);
  assert.equal(r.ok, false);
  assert.equal(r.code, 2);
  assert.match(r.error, /99/);
  assert.ok(calls.sleeps >= 3);
  assert.equal(calls.spawn, 0);
});

test('닫는 중이라 같이 쓰기가 막히면(join false) 기다렸다가 비면 새로 띄운다', async () => {
  let n = 0;
  const { d, calls } = deps({
    readLock: () => (n++ < 2 ? { pid: 99 } : null),
    readPort: () => ({ port: 4567, wsPath: '/devtools/browser/x' }),
    join: () => false,
  });
  const r = await s.launchClient(opts, d);
  assert.equal(r.ok, true);
  assert.equal(r.shared, false);
  assert.equal(calls.spawn, 1);
});

test('포트 파일은 있는데 아무도 안 들으면(죽은 크롬) 같이 쓰지 않는다', async () => {
  const { d, calls } = deps({ readLock: () => ({ pid: 99 }), readPort: () => ({ port: 4567, wsPath: '/devtools/browser/x' }), portOpen: async () => false });
  const r = await s.launchClient(opts, d);
  assert.equal(r.ok, false);
  assert.equal(calls.join.length, 0);
});

test('잠금 주인이 죽었으면(남은 잠금) 지킴이가 치우고 띄운다', async () => {
  const { d, calls } = deps({ readLock: () => ({ pid: 99 }), isAlive: () => false });
  const r = await s.launchClient(opts, d);
  assert.equal(r.ok, true);
  assert.equal(calls.spawn, 1);
});

test('지킴이가 띄우는 사이 남이 잠금을 잡았으면(locked) 처음부터 다시', async () => {
  let k = 0;
  const { d, calls } = deps({
    spawnHolder: async () => (++k === 1 ? { ok: false, reason: 'locked' } : { ok: true, wsEndpoint: 'ws://x', shared: false, holder: 1 }),
  });
  const r = await s.launchClient(opts, d);
  assert.equal(r.ok, true);
  assert.equal(k, 2);
});

test('지킴이가 실패하면(크롬 없음 등) 그 이유 그대로, 다시 안 돈다', async () => {
  let k = 0;
  const { d } = deps({ spawnHolder: async () => { k++; return { ok: false, error: '크롬이 없어' }; } });
  const r = await s.launchClient(opts, d);
  assert.deepEqual([r.ok, r.error, r.code, k], [false, '크롬이 없어', 1, 1]);
});

test('탭 글은 live.parseResult 가 그대로 읽는 모양 — 제목의 [ ] 줄바꿈은 빈칸', () => {
  const { parseResult, toolLine } = require('../src/live');
  const pg = (u) => ({ url: () => u });
  const a = pg('https://a.com/x'); const b = pg('https://b.com/');
  const t = new Map([[a, 'A [1]\nz'], [b, 'B']]);
  const r = parseResult(`- Page URL: https://b.com/\n- Page Title: B\n${s.tabsText([a, b], b, t)}`);
  assert.deepEqual(r.tabs, [{ index: 0, title: 'A  1  z', url: 'https://a.com/x', current: false }, { index: 1, title: 'B', url: 'https://b.com/', current: true }]);
  assert.equal(toolLine('script', { url: 'https://blog.naver.com/x?token=abc#f' }), '스크립트 https://blog.naver.com/x');
});

test('node 도우미가 패키지 main 으로 잡힌다(require 한 줄)', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.main, 'src/connect.js');
  assert.equal(typeof require('..').launch, 'function');
});

test('잠금 없이 직접 띄운 크롬(옛 스크립트)이 프로필을 쥐고 있으면 기다리고, 끝나면 띄운다', async () => {
  let n = 0;
  const { d, calls } = deps({ foreign: () => (n++ < 2 ? 555 : null) });
  const r = await s.launchClient(opts, d);
  assert.equal(r.ok, true);
  assert.equal(calls.spawn, 1);
  assert.ok(calls.sleeps >= 2);
});

test('잠금 없는 크롬이 끝까지 안 비키면 바쁨(code 2) — 그 pid 와 이유를 한 줄로', async () => {
  const { d, calls } = deps({ foreign: () => 555 });
  const r = await s.launchClient(opts, d);
  assert.equal(r.code, 2);
  assert.match(r.error, /555/);
  assert.match(r.error, /잠금 없이/);
  assert.equal(calls.spawn, 0);
});

test('크롬 SingletonLock(호스트-pid 링크)에서 살아 있는 pid — 다른 기계·죽은 pid·없음은 null', () => {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-single-'));
  assert.equal(s.singletonPid(dir), null);
  fs.symlinkSync(`${os.hostname()}-${process.pid}`, path.join(dir, 'SingletonLock'));
  assert.equal(s.singletonPid(dir), process.pid);
  fs.unlinkSync(path.join(dir, 'SingletonLock'));
  fs.symlinkSync(`other-host-${process.pid}`, path.join(dir, 'SingletonLock'));
  assert.equal(s.singletonPid(dir), null);
  fs.unlinkSync(path.join(dir, 'SingletonLock'));
  fs.symlinkSync(`${os.hostname()}-${2 ** 22 + 7}`, path.join(dir, 'SingletonLock'));
  assert.equal(s.singletonPid(dir), null);
});
