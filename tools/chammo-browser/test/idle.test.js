const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lock = require('../src/lock');
const { createRelay, parseIdleMs } = require('../src/relay');

// 가짜 타이머: fire() 로 대기 중인 콜백을 즉시 실행한다
function fakeTimers() {
  let seq = 0;
  const live = new Map();
  return {
    setTimer: (fn, ms) => { const h = ++seq; live.set(h, { fn, ms }); return h; },
    clearTimer: (h) => live.delete(h),
    armed: () => live.size,
    lastMs: () => [...live.values()].pop()?.ms,
    callbacks: () => [...live.values()].map((t) => t.fn), // 만료 직전 콜백 붙잡기(경합 재현용)
    fire: () => { const all = [...live.values()]; live.clear(); all.forEach((t) => t.fn()); },
  };
}

function setup(idleMs = 600000, pid = process.pid) {
  const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-idle-'));
  const timers = fakeTimers();
  const toChild = [];
  const toClient = [];
  const relay = createRelay({
    profile: 'acme-shop',
    acquire: () => lock.acquire('acme-shop', { lockDir, pid }),
    release: () => lock.release('acme-shop', { lockDir, pid }),
    sendToChild: (line) => toChild.push(line),
    sendToClient: (line) => toClient.push(line),
    idleMs,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return { relay, timers, toChild, toClient, lockDir };
}

const call = (id, name) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: {} } });
const ok = (id) => JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'ok' }] } });
const lastChild = (arr) => JSON.parse(arr[arr.length - 1]);

// 브라우저를 띄운 상태(락 보유 + 호출 완료)까지 진행
function openBrowser(s) {
  s.relay.onClientLine(call(1, 'browser_navigate'));
  s.relay.onChildLine(ok(1));
}

test('호출이 끝나고 락을 쥐고 있으면 유휴 타이머가 걸린다', () => {
  const s = setup(600000);
  openBrowser(s);
  assert.strictEqual(s.timers.armed(), 1);
  assert.strictEqual(s.timers.lastMs(), 600000);
});

test('락이 없으면(브라우저 없음) 유휴 타이머를 걸지 않는다', () => {
  const s = setup();
  s.relay.onClientLine(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
  s.relay.onChildLine(ok(1));
  assert.strictEqual(s.timers.armed(), 0);
});

test('유휴 만료 → 래퍼가 browser_close 를 대신 보내고, 성공하면 락 해제 (클라이언트엔 안 보임)', () => {
  const s = setup();
  openBrowser(s);
  const clientBefore = s.toClient.length;
  s.timers.fire();
  const sent = lastChild(s.toChild);
  assert.strictEqual(sent.method, 'tools/call');
  assert.strictEqual(sent.params.name, 'browser_close');
  assert.strictEqual(s.relay.holdsLock(), true); // 응답 전엔 유지
  s.relay.onChildLine(ok(sent.id));
  assert.strictEqual(s.relay.holdsLock(), false);
  assert.ok(!fs.existsSync(path.join(s.lockDir, 'acme-shop.lock')));
  assert.strictEqual(s.toClient.length, clientBefore); // 내부 응답은 Claude 로 안 흘린다
});

test('새 tools/call 이 오면 타이머를 끄고, 끝나면 다시 건다', () => {
  const s = setup();
  openBrowser(s);
  s.relay.onClientLine(call(2, 'browser_snapshot'));
  assert.strictEqual(s.timers.armed(), 0); // 진행 중엔 타이머 없음 → 안 닫힘
  s.relay.onChildLine(ok(2));
  assert.strictEqual(s.timers.armed(), 1);
});

test('진행 중 호출이 있으면 만료돼도 닫지 않는다', () => {
  const s = setup();
  openBrowser(s);
  const n = s.toChild.length;
  // 타이머 콜백이 이미 이벤트 루프에 올라간 뒤 호출이 먼저 처리된 경합을 재현
  const stale = s.timers.callbacks();
  s.relay.onClientLine(call(2, 'browser_snapshot'));
  stale.forEach((fn) => fn());
  assert.strictEqual(s.toChild.length, n + 1); // browser_snapshot 만 전달, close 없음
  assert.strictEqual(s.relay.holdsLock(), true);
});

test('유휴 닫기 후 다음 호출에서 다시 락을 잡고 child 로 전달', () => {
  const s = setup();
  openBrowser(s);
  s.timers.fire();
  s.relay.onChildLine(ok(lastChild(s.toChild).id));
  s.relay.onClientLine(call(5, 'browser_navigate'));
  assert.strictEqual(s.relay.holdsLock(), true);
  assert.strictEqual(lastChild(s.toChild).id, 5);
});

test('유휴 close 가 나간 사이 호출이 들어오면 close 완료 후에도 락 유지', () => {
  const s = setup();
  openBrowser(s);
  s.timers.fire();
  const closeId = lastChild(s.toChild).id;
  s.relay.onClientLine(call(6, 'browser_navigate'));
  s.relay.onChildLine(ok(closeId));
  assert.strictEqual(s.relay.holdsLock(), true);
});

test('idleMs=0 이면 유휴 닫기 끔', () => {
  const s = setup(0);
  openBrowser(s);
  assert.strictEqual(s.timers.armed(), 0);
});

test('parseIdleMs: 기본 10분, 인자 우선, 환경변수, 0=끔, 인자는 playwright 로 안 넘긴다', () => {
  assert.deepStrictEqual(parseIdleMs([], {}), { idleMs: 600000, rest: [] });
  assert.deepStrictEqual(parseIdleMs(['--headless'], { CHAMMO_BROWSER_IDLE_MINUTES: '3' }), { idleMs: 180000, rest: ['--headless'] });
  assert.deepStrictEqual(
    parseIdleMs(['--idle-minutes=0.5', '--headless'], { CHAMMO_BROWSER_IDLE_MINUTES: '3' }),
    { idleMs: 30000, rest: ['--headless'] },
  );
  assert.deepStrictEqual(parseIdleMs(['--idle-minutes=0'], {}), { idleMs: 0, rest: [] });
  assert.deepStrictEqual(parseIdleMs([], { CHAMMO_BROWSER_IDLE_MINUTES: 'abc' }), { idleMs: 600000, rest: [] });
});
