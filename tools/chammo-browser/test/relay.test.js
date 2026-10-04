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
function makeRelay(lockDir, pid, profile = 'acme-shop', extra = {}) {
  const toChild = [];
  const toClient = [];
  const relay = createRelay({
    profile,
    acquire: () => lock.acquire(profile, { lockDir, pid }),
    release: () => lock.release(profile, { lockDir, pid }),
    sendToChild: (line) => toChild.push(line),
    sendToClient: (line) => toClient.push(line),
    ...extra,
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
  // 공개판엔 chammo-browser 가 PATH 에 없다(npm link 안 함) — 그대로 쳐서 되는 node 명령으로 안내
  const cli = require('path').join(__dirname, '..', 'bin', 'chammo-browser.js');
  assert.ok(text.includes(`node "${cli}" unlock acme-shop`), text);
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

test('도구 호출 시작·끝을 알린다(앞 앱 되돌리기용) — 락에 막힌 호출과 래퍼 내부 호출은 빼고', () => {
  const dir = tmpLockDir();
  const seen = [];
  const { relay } = makeRelay(dir, process.pid, 'acme-shop', { onCallStart: (n) => seen.push(`start:${n}`), onCallEnd: (n) => seen.push(`end:${n}`) });
  relay.onClientLine(call(1, 'browser_navigate'));
  relay.onChildLine(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [] } }));
  assert.deepStrictEqual(seen, ['start:browser_navigate', 'end:browser_navigate']);
  const other = makeRelay(dir, process.pid + 1, 'acme-shop', { onCallStart: (n) => seen.push(`blocked:${n}`) });
  other.relay.onClientLine(call(2, 'browser_navigate')); // 락이 남의 것 → 막힘
  assert.deepStrictEqual(seen, ['start:browser_navigate', 'end:browser_navigate']);
});

test('도구 호출 시작·끝에 인자와 결과를 같이 넘긴다(세션 브라우저 상태 파일용)', () => {
  const dir = tmpLockDir();
  const seen = [];
  const { relay } = makeRelay(dir, process.pid, 'acme-shop', { onCallStart: (n, a) => seen.push(['start', n, a]), onCallEnd: (n, r) => seen.push(['end', n, r]) });
  relay.onClientLine(rpc(7, 'tools/call', { name: 'browser_navigate', arguments: { url: 'https://a.com' } }));
  relay.onChildLine(ok(7));
  assert.deepStrictEqual(seen, [['start', 'browser_navigate', { url: 'https://a.com' }], ['end', 'browser_navigate', { content: [{ type: 'text', text: 'ok' }] }]]);
});

test('래퍼 도구 — 도구 목록 응답에 더하고, 그 도구 호출은 playwright 로 안 보내고 래퍼가 답한다(락도 안 잡음)', async () => {
  const dir = tmpLockDir();
  const extra = { name: 'browser_ask_human', description: 'x', inputSchema: { type: 'object', properties: {} } };
  let asked = null;
  const { relay, toChild, toClient } = makeRelay(dir, process.pid, 'acme-shop', {
    extraTools: [extra],
    onLocalTool: (name, args) => (name === 'browser_ask_human' ? (asked = args, Promise.resolve({ content: [{ type: 'text', text: 'done' }] })) : null),
  });
  relay.onClientLine(rpc(1, 'tools/list', {}));
  relay.onChildLine(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'browser_navigate' }] } }));
  assert.deepStrictEqual(JSON.parse(toClient[0]).result.tools.map((t) => t.name), ['browser_navigate', 'browser_ask_human']);
  relay.onClientLine(rpc(2, 'tools/call', { name: 'browser_ask_human', arguments: { reason: '네이버 로그인' } }));
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(toChild.length, 1, 'tools/list 만 child 로');
  assert.deepStrictEqual(asked, { reason: '네이버 로그인' });
  assert.deepStrictEqual(JSON.parse(toClient[1]), { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'done' }] } });
  assert.strictEqual(relay.holdsLock(), false);
});

test('먼저 보낼 내부 호출(beforeCall) — 그게 다 답할 때까지 세션 호출을 잡아 두고, 순서를 지키고, 그 답은 세션에 안 보인다', () => {
  const dir = tmpLockDir();
  let pre = [];
  const ends = [];
  const { relay, toChild, toClient } = makeRelay(dir, process.pid, 'acme-shop', { beforeCall: () => { const p = pre; pre = []; return p; }, onCallEnd: (n) => ends.push(n) });
  relay.onClientLine(call(1, 'browser_navigate')); // 락을 잡는다(아직 브라우저 없음 — 미리 할 것 없음)
  relay.onChildLine(ok(1));
  // 사람이 앱에서 파일 창을 두 번 열었다 — 다음 호출 전에 플레이라이트 파일 창 상태 둘을 지운다
  pre = [{ name: 'browser_file_upload', arguments: {} }, { name: 'browser_file_upload', arguments: {} }];
  relay.onClientLine(call(2, 'browser_snapshot'));
  relay.onClientLine(call(3, 'browser_click'));
  const sent = toChild.slice(1).map((l) => JSON.parse(l));
  assert.deepStrictEqual(sent.map((m) => m.params.name), ['browser_file_upload', 'browser_file_upload'], '세션 호출은 아직');
  assert.deepStrictEqual(sent[0].params.arguments, {}, '파일 없음 = 파일 창 취소(올리지 않는다)');
  relay.onChildLine(toolErr(sent[0].id)); // 실패해도(상태가 없었음) 계속
  assert.strictEqual(toChild.length, 3);
  relay.onChildLine(ok(sent[1].id));
  assert.deepStrictEqual(toChild.slice(3).map((l) => JSON.parse(l).id), [2, 3], '잡아 둔 호출을 순서대로');
  assert.strictEqual(toClient.length, 1, '내부 호출 답은 세션에 안 간다');
  assert.deepStrictEqual(ends, ['browser_navigate']);
  relay.onChildLine(ok(2));
  assert.strictEqual(JSON.parse(toClient[1]).id, 2);
});

test('먼저 보낼 내부 호출 — 락이 없으면(브라우저 없음) 묻지도 않는다', () => {
  const dir = tmpLockDir();
  let asked = 0;
  const { relay, toChild } = makeRelay(dir, process.pid, 'acme-shop', { beforeCall: () => { asked += 1; return []; } });
  relay.onClientLine(call(1, 'browser_close')); // 락 없이 통과
  assert.strictEqual(asked, 0);
  assert.strictEqual(toChild.length, 1);
});
