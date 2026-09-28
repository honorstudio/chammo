const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lock = require('../src/lock');
const { createRelay, createLineSplitter } = require('../src/relay');

function tmpLockDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-relay-'));
}

// 실제 lock 모듈로 relay 를 만든다. pid 를 달리 주면 "다른 세션"이 된다.
function makeRelay(lockDir, pid, profile = 'acme-shop') {
  const toChild = [];
  const toClient = [];
  const relay = createRelay({
    profile,
    acquire: () => lock.acquire(profile, { lockDir, pid }),
    release: () => lock.release(profile, { lockDir, pid }),
    sendToChild: (line) => toChild.push(line),
    sendToClient: (line) => toClient.push(line),
  });
  return { relay, toChild, toClient };
}

const rpc = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, params });
const call = (id, name) => rpc(id, 'tools/call', { name, arguments: {} });
const ok = (id) => JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'ok' }] } });
const toolErr = (id) => JSON.stringify({ jsonrpc: '2.0', id, result: { content: [], isError: true } });
const lockFile = (dir) => path.join(dir, 'acme-shop.lock');

test('initialize·tools/list 는 락 없이 그대로 통과', () => {
  const dir = tmpLockDir();
  const { relay, toChild } = makeRelay(dir, process.pid);
  relay.onClientLine(rpc(1, 'initialize', {}));
  relay.onClientLine(rpc(2, 'tools/list', {}));
  assert.strictEqual(toChild.length, 2);
  assert.strictEqual(relay.holdsLock(), false);
  assert.ok(!fs.existsSync(lockFile(dir)));
});

test('다른 세션이 락을 쥐고 있어도 initialize 는 통과 (MCP 연결은 항상 성공)', () => {
  const dir = tmpLockDir();
  lock.acquire('acme-shop', { lockDir: dir, pid: process.pid }); // 선점 세션
  const { relay, toChild, toClient } = makeRelay(dir, process.pid + 1);
  relay.onClientLine(rpc(1, 'initialize', {}));
  assert.strictEqual(toChild.length, 1);
  assert.strictEqual(toClient.length, 0);
});

test('첫 tools/call 에서 락 획득 후 child 로 전달', () => {
  const dir = tmpLockDir();
  const { relay, toChild } = makeRelay(dir, process.pid);
  relay.onClientLine(call(3, 'browser_navigate'));
  assert.strictEqual(relay.holdsLock(), true);
  assert.ok(fs.existsSync(lockFile(dir)));
  assert.strictEqual(toChild.length, 1);
});

test('락 획득 실패 시 도구 에러(isError)로 응답하고 child 엔 안 보낸다', () => {
  const dir = tmpLockDir();
  lock.acquire('acme-shop', { lockDir: dir, pid: process.pid });
  const { relay, toChild, toClient } = makeRelay(dir, process.pid + 1);
  relay.onClientLine(call(7, 'browser_navigate'));
  assert.strictEqual(toChild.length, 0);
  assert.strictEqual(toClient.length, 1);
  const res = JSON.parse(toClient[0]);
  assert.strictEqual(res.id, 7);
  assert.strictEqual(res.result.isError, true);
  const text = res.result.content[0].text;
  assert.match(text, /acme-shop/);
  assert.match(text, new RegExp(`pid ${process.pid}`));
  assert.match(text, /chammo-browser unlock acme-shop/);
});

test('실패 후 다음 호출에서 다시 시도 → 락이 풀렸으면 획득', () => {
  const dir = tmpLockDir();
  lock.acquire('acme-shop', { lockDir: dir, pid: process.pid });
  const { relay, toChild } = makeRelay(dir, process.pid + 1);
  relay.onClientLine(call(1, 'browser_navigate'));
  assert.strictEqual(relay.holdsLock(), false);
  lock.release('acme-shop', { lockDir: dir, pid: process.pid });
  relay.onClientLine(call(2, 'browser_navigate'));
  assert.strictEqual(relay.holdsLock(), true);
  assert.strictEqual(toChild.length, 1);
});

test('browser_close 성공 응답 후 락 해제 → 다른 인스턴스가 이어서 획득', () => {
  const dir = tmpLockDir();
  const a = makeRelay(dir, process.pid);
  const b = makeRelay(dir, process.pid + 1);
  a.relay.onClientLine(call(1, 'browser_navigate'));
  a.relay.onChildLine(ok(1));
  b.relay.onClientLine(call(1, 'browser_navigate'));
  assert.strictEqual(b.relay.holdsLock(), false); // 아직 A 가 사용 중

  a.relay.onClientLine(call(2, 'browser_close'));
  assert.strictEqual(a.relay.holdsLock(), true); // 응답 전엔 유지
  a.relay.onChildLine(ok(2));
  assert.strictEqual(a.relay.holdsLock(), false);
  assert.ok(!fs.existsSync(lockFile(dir)));

  b.relay.onClientLine(call(2, 'browser_navigate'));
  assert.strictEqual(b.relay.holdsLock(), true);
});

test('browser_close 가 에러로 끝나면 락 유지', () => {
  const dir = tmpLockDir();
  const { relay } = makeRelay(dir, process.pid);
  relay.onClientLine(call(1, 'browser_navigate'));
  relay.onClientLine(call(2, 'browser_close'));
  relay.onChildLine(toolErr(2));
  assert.strictEqual(relay.holdsLock(), true);
});

test('browser_close 완료 시점에 다른 도구 호출이 진행 중이면 락 유지 (브라우저를 다시 띄웠을 수 있음)', () => {
  const dir = tmpLockDir();
  const { relay } = makeRelay(dir, process.pid);
  relay.onClientLine(call(1, 'browser_navigate'));
  relay.onClientLine(call(2, 'browser_close'));
  relay.onClientLine(call(3, 'browser_snapshot'));
  relay.onChildLine(ok(2));
  assert.strictEqual(relay.holdsLock(), true);
});

test('락 없이 온 browser_close 는 락을 잡지 않고 그대로 통과', () => {
  const dir = tmpLockDir();
  lock.acquire('acme-shop', { lockDir: dir, pid: process.pid }); // 다른 세션이 사용 중이어도
  const { relay, toChild, toClient } = makeRelay(dir, process.pid + 1);
  relay.onClientLine(call(1, 'browser_close'));
  assert.strictEqual(toChild.length, 1);
  assert.strictEqual(toClient.length, 0);
  assert.strictEqual(relay.holdsLock(), false);
});

test('child 출력과 클라이언트 응답(result 없는 줄)·깨진 줄은 원문 그대로 중계', () => {
  const dir = tmpLockDir();
  const { relay, toChild, toClient } = makeRelay(dir, process.pid);
  relay.onClientLine('not json');
  relay.onChildLine('{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}');
  assert.deepStrictEqual(toChild, ['not json']);
  assert.deepStrictEqual(toClient, ['{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}']);
});

test('createLineSplitter: 청크 경계와 무관하게 줄 단위로 끊는다', () => {
  const lines = [];
  const push = createLineSplitter((l) => lines.push(l));
  push(Buffer.from('{"a":1}\n{"b"'));
  push(Buffer.from(':2}\r\n\n{"c":'));
  assert.deepStrictEqual(lines, ['{"a":1}', '{"b":2}']);
  push(Buffer.from('3}\n'));
  assert.deepStrictEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
});

test('createLineSplitter: 한글 바이트가 청크 경계에서 잘려도 복원', () => {
  const lines = [];
  const push = createLineSplitter((l) => lines.push(l));
  const bytes = Buffer.from('{"t":"프로필"}\n');
  push(bytes.subarray(0, 8)); // '프' 중간에서 자름
  push(bytes.subarray(8));
  assert.deepStrictEqual(lines, ['{"t":"프로필"}']);
});
