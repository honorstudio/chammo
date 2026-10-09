// 스크립트 지킴이가 쥔 프로필 — 세션 도구가 '사용 중' 오류 대신 그 크롬에 CDP 로 붙는다(roadmap 부채 browser-scripts ①)
const { test } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { createRelay } = require('../src/relay');
const { createShare, scriptHolder } = require('../src/share');

const rpc = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, params });
const call = (id, name) => rpc(id, 'tools/call', { name, arguments: {} });
const ok = (id) => JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'ok' }] } });

// ───────── relay: 같이 쓰는 동안 ─────────

function sharedRelay({ still = () => true, idleMs = 0 } = {}) {
  const toChild = [];
  const toClient = [];
  const log = { release: 0, acquire: 0, canClose: 0 };
  let timer = null;
  let next = { ok: true, shared: true };
  const relay = createRelay({
    profile: 'p',
    acquire: () => { log.acquire += 1; return next; },
    release: () => { log.release += 1; },
    stillShared: still,
    canClose: () => { log.canClose += 1; return true; },
    sendToChild: (l) => toChild.push(l),
    sendToClient: (l) => toClient.push(l),
    idleMs,
    setTimer: (fn) => { timer = fn; return 1; },
    clearTimer: () => { timer = null; },
  });
  return { relay, toChild, toClient, log, fire: () => { const f = timer; timer = null; if (f) f(); }, setNext: (v) => { next = v; } };
}

test('같이 쓰기로 붙으면 호출은 그대로 child 로 간다', () => {
  const { relay, toChild } = sharedRelay();
  relay.onClientLine(call(1, 'browser_navigate'));
  assert.strictEqual(toChild.length, 1);
  assert.strictEqual(relay.holdsLock(), true);
  assert.strictEqual(relay.sharing(), true);
});

test('같이 쓰는 중 browser_close 는 스크립트 크롬을 안 닫고 연결만 놓는다(child 로 안 감)', () => {
  const { relay, toChild, toClient, log } = sharedRelay();
  relay.onClientLine(call(1, 'browser_navigate'));
  relay.onChildLine(ok(1));
  relay.onClientLine(call(2, 'browser_close'));
  assert.strictEqual(toChild.length, 1, 'close 는 child 로 안 보낸다');
  assert.strictEqual(log.release, 1);
  const r = JSON.parse(toClient.at(-1));
  assert.strictEqual(r.id, 2);
  assert.ok(!r.result.isError);
  assert.match(r.result.content[0].text, /스크립트/);
  assert.strictEqual(relay.holdsLock(), false);
  assert.strictEqual(relay.sharing(), false);
});

test('같이 쓰는 중 유휴면 close 를 안 보내고 놓기만(명부 닫기 판단 canClose 도 안 부른다)', () => {
  const s = sharedRelay({ idleMs: 1000 });
  s.relay.onClientLine(call(1, 'browser_navigate'));
  s.relay.onChildLine(ok(1));
  s.fire();
  assert.strictEqual(s.toChild.length, 1);
  assert.strictEqual(s.log.release, 1);
  assert.strictEqual(s.log.canClose, 0);
  assert.strictEqual(s.relay.holdsLock(), false);
});

test('스크립트 크롬이 끝났으면 다음 호출 때 놓고 다시 잡는다(이번엔 내 크롬)', () => {
  let alive = true;
  const s = sharedRelay({ still: () => alive });
  s.relay.onClientLine(call(1, 'browser_navigate'));
  s.relay.onChildLine(ok(1));
  alive = false;
  s.setNext({ ok: true });
  s.relay.onClientLine(call(2, 'browser_snapshot'));
  assert.strictEqual(s.log.release, 1);
  assert.strictEqual(s.log.acquire, 2);
  assert.strictEqual(s.relay.sharing(), false);
  assert.strictEqual(s.relay.holdsLock(), true);
  assert.strictEqual(s.toChild.length, 2);
});

// ───────── 누구와 같이 쓰나 ─────────

test('같이 쓸 상대는 스크립트 지킴이(by=script)뿐 — 다른 세션의 브라우저 도구와는 안 섞는다', () => {
  assert.ok(scriptHolder({ ok: false, reason: 'locked', holder: { pid: 5, by: 'script' } }));
  assert.ok(!scriptHolder({ ok: false, reason: 'locked', holder: { pid: 5 } }));
  assert.ok(!scriptHolder({ ok: false, reason: 'race' }));
});

// ───────── share: CDP child 띄우고 인사 다시 하기 ─────────

function fakeChild() {
  const c = new EventEmitter();
  c.stdin = { lines: [], write(l) { this.lines.push(l.trimEnd()); return true; }, end() {}, on() {} };
  c.stdout = new EventEmitter();
  c.killed = 0;
  c.kill = () => { c.killed += 1; };
  return c;
}

function makeShare(over = {}) {
  const spawned = [];
  const out = [];
  const users = { joined: [], left: [] };
  const d = {
    profile: 'p',
    pid: 100,
    readPort: () => ({ port: 9333, wsPath: '/devtools/browser/x' }),
    holderAlive: () => true,
    join: (holder) => { users.joined.push(holder); return true; },
    leave: () => { users.left.push(1); },
    spawnChild: (args) => { const c = fakeChild(); spawned.push({ args, c }); return c; },
    onLine: (l) => out.push(l),
    ...over,
  };
  return { share: createShare(d), spawned, out, users };
}

test('붙기 — 명부에 오르고 --cdp-endpoint child 를 띄워 세션이 했던 인사(initialize)를 다시 한 뒤 줄을 보낸다', () => {
  const { share, spawned, out, users } = makeShare();
  share.remember(rpc(0, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude' } }));
  share.remember(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  assert.ok(share.start({ pid: 7, by: 'script' }));
  assert.deepStrictEqual(users.joined, [7]);
  assert.strictEqual(spawned.length, 1);
  const { args, c } = spawned[0];
  assert.deepStrictEqual(args.slice(args.indexOf('--cdp-endpoint'), args.indexOf('--cdp-endpoint') + 2), ['--cdp-endpoint', 'ws://127.0.0.1:9333/devtools/browser/x']);
  assert.ok(!args.includes('--user-data-dir'));
  share.send(call(1, 'browser_navigate'));
  // 인사 답 전엔 세션 줄을 쥐고 있는다
  assert.strictEqual(c.stdin.lines.length, 1);
  const init = JSON.parse(c.stdin.lines[0]);
  assert.strictEqual(init.method, 'initialize');
  assert.notStrictEqual(init.id, 0);
  c.stdout.emit('data', Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: init.id, result: { protocolVersion: '2025-06-18' } })}\n`));
  // 스크립트가 쓰던 탭을 세션이 옮기지 않게 — 세션 몫 새 탭부터 연다(답 올 때까지 세션 줄은 쥔다)
  assert.deepStrictEqual(c.stdin.lines.slice(1).map((l) => JSON.parse(l).method), ['notifications/initialized', 'tools/call']);
  const tab = JSON.parse(c.stdin.lines[2]);
  assert.deepStrictEqual(tab.params, { name: 'browser_tabs', arguments: { action: 'new' } });
  assert.notStrictEqual(tab.id, 1);
  c.stdout.emit('data', Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: tab.id, result: { content: [{ type: 'text', text: '- 1: (current) [](about:blank)' }] } })}\n`));
  assert.deepStrictEqual(JSON.parse(c.stdin.lines[3]).id, 1);
  assert.deepStrictEqual(out, [], '인사·새 탭 답은 세션에 안 보인다');
  c.stdout.emit('data', Buffer.from(`${ok(1)}\n`));
  assert.deepStrictEqual(out, [ok(1)]);
  assert.ok(share.active());
});

test('명부에 못 오르면(닫는 중) 안 붙는다 — 원래 사용 중 오류로', () => {
  const { share, spawned } = makeShare({ join: () => false });
  assert.ok(!share.start({ pid: 7, by: 'script' }));
  assert.strictEqual(spawned.length, 0);
  assert.ok(!share.active());
});

test('포트가 없으면(앱에서 보기 끔) 안 붙는다', () => {
  const { share, users } = makeShare({ readPort: () => null });
  assert.ok(!share.start({ pid: 7, by: 'script' }));
  assert.deepStrictEqual(users.joined, []);
});

test('놓기 — child 를 끄고 명부에서 빠진다. 지킴이가 죽었으면 still() 이 false', () => {
  let alive = true;
  const { share, spawned, users } = makeShare({ holderAlive: () => alive });
  share.start({ pid: 7, by: 'script' });
  assert.ok(share.still());
  alive = false;
  assert.ok(!share.still());
  share.stop();
  assert.strictEqual(spawned[0].c.killed, 1);
  assert.strictEqual(users.left.length, 1);
  assert.ok(!share.active());
});

test('CDP child 가 먼저 죽으면 still() 이 false — 다음 호출 때 놓고 다시 잡게', () => {
  const { share, spawned } = makeShare();
  share.start({ pid: 7, by: 'script' });
  spawned[0].c.emit('exit', 1);
  assert.ok(!share.still());
});
