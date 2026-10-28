const { test } = require('node:test');
const assert = require('node:assert');
const { canSwitchHold, createHoldCall } = require('../src/hold-passkey');
const { parseResult } = require('../src/live');

// 서랍 '참모 브라우저'(지킴이)는 바꾸면 크롬이 다시 떠 붙어 있던 CDP 손님이 끊긴다 — 주인이 앱이고 명부에 다른 사용자가 없을 때만
test('바꿔도 되는 때 — 주인이 앱(app-alive pid)이고 명부엔 주인 하나', () => {
  assert.strictEqual(canSwitchHold({ owner: 42, appPid: 42, users: [42] }), true);
});

test('안 바꾸는 때 — 스크립트가 주인·같이 쓰는 스크립트나 세션이 붙음·앱 표식 없음·주인 빠짐', () => {
  assert.strictEqual(canSwitchHold({ owner: 7, appPid: 42, users: [7] }), false, '스크립트가 주인 — 그 스크립트가 CDP 로 붙어 있다');
  assert.strictEqual(canSwitchHold({ owner: 42, appPid: 42, users: [42, 9] }), false, '같이 쓰는 손님(스크립트·MCP 래퍼)');
  assert.strictEqual(canSwitchHold({ owner: 42, appPid: null, users: [42] }), false, '앱이 안 떠 있음');
  assert.strictEqual(canSwitchHold({ owner: 42, appPid: 42, users: [] }), false, '주인이 죽음 — 곧 닫힌다');
  assert.strictEqual(canSwitchHold({ owner: null, appPid: null, users: [] }), false);
});

// winshow(src/winshow.js)가 부르는 세 도구를 지킴이 크롬 위에서
test('세 도구 흉내 — 탭 목록은 live.parseResult 가 읽는 모양, 닫기·열기는 지킴이가 준 함수로', async () => {
  const log = [];
  const call = createHoldCall({
    tabs: () => '- 0: (current) [로그인](https://accounts.example/pk)\n- 1: [다른](https://x.example/)',
    close: async () => { log.push('close'); },
    open: async (url) => { log.push(['open', url]); },
  });
  const t = await call('browser_tabs', { action: 'list' });
  const cur = parseResult(t.content[0].text).tabs.find((x) => x.current);
  assert.strictEqual(cur.url, 'https://accounts.example/pk');
  await call('browser_close', {}, { keep: true });
  await call('browser_navigate', { url: 'https://accounts.example/pk' });
  assert.deepStrictEqual(log, ['close', ['open', 'https://accounts.example/pk']]);
});

test('열기·닫기가 실패하면 isError 로 돌려준다(winshow 가 기록) — 모르는 도구도', async () => {
  const call = createHoldCall({ tabs: () => '', close: async () => { throw new Error('닫기 안 됨'); }, open: async () => { throw new Error('열기 안 됨'); } });
  const c = await call('browser_close', {});
  assert.strictEqual(c.isError, true);
  assert.match(c.content[0].text, /닫기 안 됨/);
  assert.strictEqual((await call('browser_navigate', { url: 'about:blank' })).isError, true);
  assert.strictEqual((await call('browser_click', {})).isError, true);
});

// 0.4.4 리뷰 1 — 손님이 붙은 동안 서랍 지킴이가 '다 했어'를 안 읽어 표를 잃었다(1초 tick 이 can() 일 때만 winshow.tick)
test('지킴이 — 손님이 있어도 다 했어 표는 남기고, 손님이 떠나면 참모 브라우저로 돌아온다', async () => {
  const fsx = require('fs');
  const os = require('os');
  const path = require('path');
  const users = require('../src/users');
  const lock = require('../src/lock');
  const { startHoldPasskey } = require('../src/hold-passkey');
  const base = fsx.mkdtempSync(path.join(os.tmpdir(), 'chammo-hold-'));
  const [liveDir, lockDir, dataDir, profileDir] = ['live', 'locks', 'data', 'prof'].map((n) => { const d = path.join(base, n); fsx.mkdirSync(d); return d; });
  const owner = process.pid;
  fsx.writeFileSync(path.join(dataDir, 'app-alive.json'), JSON.stringify({ pid: owner }));
  lock.acquire('p', { lockDir, pid: owner });
  users.add(lockDir, 'p', owner);
  const calls = [];
  const call = createHoldCall({ tabs: () => '- 0: (current) [x](https://idp.example/pk)', close: async () => { calls.push('close'); }, open: async (u) => { calls.push(['open', u]); } });
  const h = startHoldPasskey({ profile: 'p', profileDir, owner, lockDir, dataDir, liveDir, live: { signable: () => {}, switching: () => {}, refresh: () => {} }, call, log: () => {}, every: 30 });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    await h.winshow.request(true, { auto: true });
    assert.strictEqual(h.winshow.shown(), true);
    users.add(lockDir, 'p', process.ppid); // 스크립트가 붙었다
    calls.length = 0;
    fsx.writeFileSync(path.join(liveDir, 'p.signed'), JSON.stringify({ pid: process.pid, at: Date.now(), on: false, done: '다 했어' }));
    await wait(1300);
    assert.strictEqual(fsx.existsSync(path.join(liveDir, 'p.done')), true, '다 했어 표');
    assert.deepStrictEqual(calls, [], '손님이 있는 동안은 안 바꾼다');
    users.remove(lockDir, 'p', process.ppid); // 떠났다
    await wait(1300);
    assert.strictEqual(h.winshow.shown(), false, '손님이 떠나면 돌아온다');
    assert.deepStrictEqual(calls, ['close', ['open', 'https://idp.example/pk']]);
  } finally {
    h.stop();
  }
});

// 0.4.4 리뷰 7 — 닫은 크롬이 10초 넘게 프로필 잠금(SingletonLock)을 쥐면 그냥 열어서 새 크롬이 '기존 세션에 넘김'으로 꺼지고
// 지킴이(서랍 브라우저)가 통째로 끝났다. 쥔 크롬이 살아 있으면 더 기다리고, 끝내 안 놓으면 그 크롬(크롬일 때만)을 끈다
function lockRig({ until = Infinity, pidAlive = true, chrome = true, dieOnKill = true } = {}) {
  const { waitProfileFree } = require('../src/hold-passkey');
  let t = 0;
  let gone = false;
  const killed = [];
  const o = {
    readLink: () => { if (gone || t >= until) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return 'mac.local-4321'; },
    alive: (pid) => pid === 4321 && pidAlive && !gone,
    isChrome: () => chrome,
    kill: (pid) => { killed.push(pid); if (dieOnKill) gone = true; },
    sleep: async (ms) => { t += ms; },
    now: () => t,
    log: () => {},
  };
  return { run: () => waitProfileFree('/p', o), killed, at: () => t };
}

test('프로필 풀림 — 10초를 넘겨도 산 크롬이 쥐고 있으면 기다린다', async () => {
  const r = lockRig({ until: 15_000 });
  assert.strictEqual(await r.run(), true);
  assert.ok(r.at() >= 15_000, `15초에 풀린 걸 보고 연다(${r.at()})`);
  assert.deepStrictEqual(r.killed, []);
});

test('프로필 풀림 — 죽은 pid 의 잠금은 크롬이 스스로 치운다(기다리지 않음), 끝내 안 놓는 크롬은 끈다, 크롬이 아니면 안 끈다', async () => {
  const dead = lockRig({ pidAlive: false });
  assert.strictEqual(await dead.run(), true);
  assert.strictEqual(dead.at(), 0);
  const stuck = lockRig();
  assert.strictEqual(await stuck.run(), true);
  assert.deepStrictEqual(stuck.killed, [4321]);
  assert.ok(stuck.at() >= 30_000);
  const other = lockRig({ chrome: false });
  assert.strictEqual(await other.run(), false);
  assert.deepStrictEqual(other.killed, []);
});
