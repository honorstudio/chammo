// 앱이 붙기 전에 뜬 대화상자 — 앱 CDP 는 못 답하니(새 세션엔 다시 안 알림) 래퍼가 처음부터 붙은 playwright 로 대신 답한다(roadmap 부채 browser-dialog ①)
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRelay } = require('../src/relay');
const { createDialogAnswer } = require('../src/dialogs');

const rpc = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, params });
const call = (id, name) => rpc(id, 'tools/call', { name, arguments: {} });
const ok = (id, text = 'ok') => JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });

function relayWith() {
  const toChild = [];
  const toClient = [];
  const relay = createRelay({ profile: 'p', acquire: () => ({ ok: true }), release: () => {}, sendToChild: (l) => toChild.push(l), sendToClient: (l) => toClient.push(l) });
  return { relay, toChild, toClient };
}

test('relay.callInternal — 브라우저가 떠 있으면 내부 호출로 보내고 답은 세션에 안 보인다', async () => {
  const { relay, toChild, toClient } = relayWith();
  relay.onClientLine(call(1, 'browser_navigate'));
  relay.onChildLine(ok(1));
  const p = relay.callInternal('browser_handle_dialog', { accept: true });
  const sent = JSON.parse(toChild.at(-1));
  assert.deepStrictEqual(sent.params, { name: 'browser_handle_dialog', arguments: { accept: true } });
  relay.onChildLine(ok(sent.id, 'closed'));
  const r = await p;
  assert.strictEqual(r.content[0].text, 'closed');
  assert.strictEqual(toClient.length, 1, '세션엔 처음 답만');
});

test('relay.callInternal — 브라우저가 없으면(락 없음) 안 보내고 실패로', async () => {
  const { relay, toChild } = relayWith();
  const r = await relay.callInternal('browser_handle_dialog', { accept: true });
  assert.strictEqual(r.isError, true);
  assert.strictEqual(toChild.length, 0);
});

function setup(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-dialogs-'));
  const calls = [];
  let now = 1_000_000;
  const d = createDialogAnswer({
    liveDir: dir, profile: 'shop', pid: 77,
    call: (name, args) => { calls.push({ name, args }); return Promise.resolve(over.result || { content: [{ type: 'text', text: 'ok' }] }); },
    now: () => now,
  });
  const ask = (o) => fs.writeFileSync(path.join(dir, 'shop.dialog'), JSON.stringify(o));
  const done = () => JSON.parse(fs.readFileSync(path.join(dir, 'shop.dialog-done'), 'utf8'));
  return { d, dir, calls, ask, done, setNow: (n) => { now = n; } };
}

test('앱이 남긴 답 요청(내 pid·1분 안)을 browser_handle_dialog 로 — 요청은 지우고 결과를 남긴다', async () => {
  const s = setup();
  s.ask({ pid: 77, accept: false, at: 1_000_000 - 500 });
  await s.d.tick();
  assert.deepStrictEqual(s.calls, [{ name: 'browser_handle_dialog', args: { accept: false } }]);
  assert.ok(!fs.existsSync(path.join(s.dir, 'shop.dialog')));
  const r = s.done();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.pid, 77);
});

test('남의 래퍼(pid 다름)·오래된 요청·요청 없음은 안 보낸다', async () => {
  const s = setup();
  await s.d.tick();
  s.ask({ pid: 78, accept: true, at: 1_000_000 });
  await s.d.tick();
  assert.ok(fs.existsSync(path.join(s.dir, 'shop.dialog')), '남의 요청은 그대로 둔다');
  s.ask({ pid: 77, accept: true, at: 1_000_000 - 120_000 });
  await s.d.tick();
  assert.deepStrictEqual(s.calls, []);
});

test('playwright 가 못 풀면(지금 탭이 아님 등) 실패와 한 줄을 남긴다', async () => {
  const s = setup({ result: { content: [{ type: 'text', text: '### Error\nNo dialog visible\nmore' }], isError: true } });
  s.ask({ pid: 77, accept: true, at: 1_000_000 });
  await s.d.tick();
  const r = s.done();
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /No dialog visible/);
  assert.ok(!r.error.includes('\n'));
});
