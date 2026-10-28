const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { pageScript, BINDING, createPasskeyWatch, HOLD_MS } = require('../src/passkey');

// 2026-10-29 패스키 자동 — ad-hoc 사본(Dock 숨김·선명한 칸)엔 맥 플랫폼 패스키가 없다(isUserVerifyingPlatformAuthenticatorAvailable=false, 실측).
// 페이지가 패스키를 부르면 래퍼가 묻지 않고 같은 프로필을 구글 서명 크롬으로 다시 열고, 끝나면(로그인 뒤 주소 바뀜·사람 '다 했어') 돌아온다

/** 페이지 흉내 — navigator.credentials 와 바인딩 */
function page({ binding = true, result = { id: 'cred' } } = {}) {
  const sent = [];
  const orig = [];
  const ctx = {
    setTimeout: (f, ms) => { ctx.timers.push([f, ms]); return 1; },
    timers: [],
    navigator: { credentials: {
      get: (o) => { orig.push(['get', o]); return Promise.resolve(result); },
      create: (o) => { orig.push(['create', o]); return Promise.resolve(result); },
    } },
  };
  ctx.window = ctx;
  if (binding) ctx[BINDING] = (p) => sent.push(JSON.parse(p));
  vm.createContext(ctx);
  return { ctx, sent, orig, run: (hold) => vm.runInContext(pageScript(hold), ctx) };
}

test('ad-hoc(hold) — 진짜 패스키 부름이면 알리고 원래 부름은 미뤘다가(그새 크롬이 바뀐다) 안 바뀌면 그대로', async () => {
  const p = page();
  p.run(true);
  const r = p.ctx.navigator.credentials.get({ publicKey: { challenge: 1 } });
  assert.deepStrictEqual(p.sent, [{ phase: 'ask', kind: 'get' }]);
  assert.deepStrictEqual(p.orig, [], '바로 크롬 패스키 창을 안 띄운다');
  assert.strictEqual(p.ctx.timers[0][1], HOLD_MS);
  p.ctx.timers[0][0]();
  assert.deepStrictEqual(await r, { id: 'cred' }, '못 바꿨으면 원래대로 이어 간다');
  p.ctx.navigator.credentials.create({ publicKey: {} });
  assert.deepStrictEqual(p.sent.at(-1), { phase: 'ask', kind: 'create' });
});

test('자동완성용 조건부 부름·패스키 아닌 부름·바인딩 없는 페이지는 건드리지 않는다', () => {
  const p = page();
  p.run(true);
  p.ctx.navigator.credentials.get({ mediation: 'conditional', publicKey: {} });
  p.ctx.navigator.credentials.get({ password: true });
  assert.deepStrictEqual(p.sent, []);
  assert.strictEqual(p.orig.length, 2, '그대로 바로');
  const q = page({ binding: false });
  q.run(true);
  q.ctx.navigator.credentials.get({ publicKey: {} });
  assert.strictEqual(q.orig.length, 1);
});

test('구글 크롬(watch) — 그대로 부르고, 성공하면(조건부 포함) ok 를 알린다. 실패면 안 알린다', async () => {
  const p = page();
  p.run(false);
  await p.ctx.navigator.credentials.get({ publicKey: {} });
  await p.ctx.navigator.credentials.get({ mediation: 'conditional', publicKey: {} });
  assert.deepStrictEqual(p.sent, [{ phase: 'ok', kind: 'get' }, { phase: 'ok', kind: 'get' }]);
  const q = page({ result: null });
  q.run(false);
  await q.ctx.navigator.credentials.get({ publicKey: {} });
  assert.deepStrictEqual(q.sent, []);
});

test('두 번 넣어도 한 번만 감싸고, 나중에 넣은 갈래가 이긴다(바꾼 크롬에 새 세션이 다시 넣는다)', () => {
  const p = page();
  p.run(true);
  p.run(false);
  p.ctx.navigator.credentials.get({ publicKey: {} });
  assert.strictEqual(p.orig.length, 1, '미루지 않는다');
  assert.strictEqual(p.ctx.timers.length, 0);
});

/** CDP 흉내 — 보낸 것을 모으고, 사건을 흘려 넣는다 */
function fakeWS() {
  const all = [];
  class WS {
    constructor(url) { this.url = url; this.sent = []; all.push(this); setImmediate(() => this.onopen && this.onopen()); }
    send(t) { const m = JSON.parse(t); this.sent.push(m); if (m.id) setImmediate(() => this.onmessage && this.onmessage({ data: JSON.stringify({ id: m.id, result: {} }) })); }
    close() { this.closed = true; this.onclose && this.onclose(); }
    emit(m) { this.onmessage({ data: JSON.stringify(m) }); }
  }
  return { WS, all };
}
const tick = () => new Promise((r) => setImmediate(r));

test('감시 — 브라우저에 붙어 모든 탭에 자동으로 붙고, 탭마다 바인딩·스크립트를 넣는다', async () => {
  const { WS, all } = fakeWS();
  const got = [];
  const w = createPasskeyWatch({ readPort: () => ({ port: 9, wsPath: '/devtools/browser/x' }), signed: () => false, onSignal: (...a) => got.push(a), WS });
  w.tick();
  await tick();
  const ws = all[0];
  assert.strictEqual(ws.url, 'ws://127.0.0.1:9/devtools/browser/x');
  const auto = ws.sent.find((m) => m.method === 'Target.setAutoAttach');
  assert.deepStrictEqual({ a: auto.params.autoAttach, w: auto.params.waitForDebuggerOnStart, f: auto.params.flatten }, { a: true, w: false, f: true }, '페이지를 멈춰 세우지 않는다');
  ws.emit({ method: 'Target.attachedToTarget', params: { sessionId: 'S1', targetInfo: { targetId: 'T1', type: 'page', url: 'https://idp.example/login' } } });
  const s1 = ws.sent.filter((m) => m.sessionId === 'S1').map((m) => m.method);
  // Page.enable 이 없으면 새 문서 스크립트가 다른 프로세스로 넘어간 이동(about:blank → 사이트) 뒤 안 들어갔다 — 바인딩만 있고 훅이 없어 바꾸기가 안 됐다(10-29 실측)
  assert.deepStrictEqual(s1, ['Runtime.enable', 'Runtime.addBinding', 'Page.enable', 'Page.addScriptToEvaluateOnNewDocument', 'Runtime.evaluate']);
  assert.match(ws.sent.find((m) => m.method === 'Runtime.evaluate').params.expression, /__chammoPkHold\s*=\s*true/, 'ad-hoc 이면 미루는 갈래');
  assert.strictEqual(w.url('T1'), 'https://idp.example/login');
  const tok = /const token = "([0-9a-f]+)"/.exec(ws.sent.find((m) => m.method === 'Runtime.evaluate').params.expression)[1];
  ws.emit({ method: 'Runtime.bindingCalled', sessionId: 'S1', params: { name: BINDING, payload: JSON.stringify({ phase: 'ask', kind: 'get', t: tok }) } });
  ws.emit({ method: 'Runtime.bindingCalled', sessionId: 'S1', params: { name: 'other', payload: '{}' } });
  ws.emit({ method: 'Runtime.bindingCalled', sessionId: 'S1', params: { name: BINDING, payload: '깨짐' } });
  assert.deepStrictEqual(got, [['ask', 'T1']]);
  ws.emit({ method: 'Target.targetInfoChanged', params: { targetInfo: { targetId: 'T1', type: 'page', url: 'https://idp.example/home' } } });
  assert.strictEqual(w.url('T1'), 'https://idp.example/home');
  ws.emit({ method: 'Target.detachedFromTarget', params: { sessionId: 'S1', targetId: 'T1' } });
  assert.strictEqual(w.url('T1'), undefined, '닫힌 탭');
});

test('감시 — 크롬이 다시 뜨면(포트 바뀜) 새로 붙고, 갈래(ad-hoc↔구글)가 바뀌어도 새로 붙는다, 포트가 없으면 끊는다', async () => {
  const { WS, all } = fakeWS();
  let port = { port: 9, wsPath: '/devtools/browser/a' };
  let signed = false;
  const w = createPasskeyWatch({ readPort: () => port, signed: () => signed, onSignal: () => {}, WS });
  w.tick(); await tick();
  w.tick(); await tick();
  assert.strictEqual(all.length, 1, '같으면 그대로');
  port = { port: 10, wsPath: '/devtools/browser/b' };
  w.tick(); await tick();
  assert.strictEqual(all.length, 2);
  assert.ok(all[0].closed);
  signed = true;
  w.tick(); await tick();
  assert.strictEqual(all.length, 3);
  all[2].emit({ method: 'Target.attachedToTarget', params: { sessionId: 'S', targetInfo: { targetId: 'T', type: 'page', url: 'x' } } });
  assert.match(all[2].sent.find((m) => m.method === 'Runtime.evaluate').params.expression, /__chammoPkHold\s*=\s*false/);
  port = null;
  w.tick(); await tick();
  assert.ok(all[2].closed);
  w.stop();
});

// 10-29 실측 — 앱이 까는 노드(tools/bin/node)는 20 이라 전역 WebSocket 이 없어 감시가 소리 없이 안 붙었다(돌던 래퍼 15개 중 9개)
test('감시 — 노드에 전역 WebSocket 이 없어도 플레이라이트에 든 ws 로 붙는다', () => {
  const { defaultWS } = require('../src/passkey');
  const WS = defaultWS();
  assert.strictEqual(typeof WS, 'function');
  const saved = globalThis.WebSocket;
  try {
    delete globalThis.WebSocket;
    const fallback = defaultWS();
    assert.strictEqual(typeof fallback, 'function', '전역이 없어도 클래스가 있다');
    assert.notStrictEqual(fallback, saved);
  } finally {
    if (saved) globalThis.WebSocket = saved;
  }
});

// 0.4.4 리뷰 4 — 바꿀 수 없을 때도(손님·60초 되풀이 막기) ad-hoc 이면 모든 패스키 부름을 6초 붙잡아 사이트 패스키가 늘 늦었다.
// 바꿀 수 있을 때만 붙잡고, 못 바꾸면 알리기만 하고 바로 부른다
test('못 바꿀 때(wait 0) — 알리기만 하고 원래 부름을 바로', async () => {
  const p = page();
  p.ctx.eval = (s) => vm.runInContext(s, p.ctx);
  vm.runInContext(pageScript(true, { wait: 0, token: 'tok' }), p.ctx);
  const r = p.ctx.navigator.credentials.get({ publicKey: {} });
  assert.strictEqual(p.sent.length, 1);
  assert.strictEqual(p.sent[0].phase, 'ask');
  assert.strictEqual(p.orig.length, 1, '바로 부른다');
  assert.strictEqual(p.ctx.timers.length, 0, '안 붙잡는다');
  assert.deepStrictEqual(await r, { id: 'cred' });
});

test('감시 — 바꿀 수 있나(canHold)가 바뀌면 새로 붙어 붙잡기 갈래를 바꾼다', async () => {
  const { WS, all } = fakeWS();
  let can = false;
  const w = createPasskeyWatch({ readPort: () => ({ port: 9, wsPath: '/x' }), signed: () => false, canHold: () => can, onSignal: () => {}, WS });
  w.tick(); await tick();
  all[0].emit({ method: 'Target.attachedToTarget', params: { sessionId: 'S', targetInfo: { targetId: 'T', type: 'page', url: 'x' } } });
  assert.match(all[0].sent.find((m) => m.method === 'Runtime.evaluate').params.expression, /__chammoPkWait\s*=\s*0\b/);
  w.tick(); await tick();
  assert.strictEqual(all.length, 1, '같으면 그대로');
  can = true;
  w.tick(); await tick();
  assert.strictEqual(all.length, 2);
  all[1].emit({ method: 'Target.attachedToTarget', params: { sessionId: 'S', targetInfo: { targetId: 'T', type: 'page', url: 'x' } } });
  assert.match(all[1].sent.find((m) => m.method === 'Runtime.evaluate').params.expression, new RegExp(`__chammoPkWait\\s*=\\s*${HOLD_MS}\\b`));
  w.stop();
});

// 0.4.4 리뷰 6 — 바인딩은 모든 페이지에 열려 있어 아무 사이트나 __chammoPasskey('{"phase":"ask"}') 로 크롬을 다시 띄우게 했다.
// 감시 스크립트가 클로저에 든 토큰을 같이 보내고, 래퍼는 토큰이 맞을 때만 신호로 본다(페이지는 토큰을 못 읽는다)
test('감시 — 토큰 없는·틀린 바인딩 부름은 버린다, 감시 스크립트의 부름만', async () => {
  const { WS, all } = fakeWS();
  const got = [];
  const w = createPasskeyWatch({ readPort: () => ({ port: 9, wsPath: '/x' }), signed: () => false, onSignal: (...a) => got.push(a), WS });
  w.tick(); await tick();
  const ws = all[0];
  ws.emit({ method: 'Target.attachedToTarget', params: { sessionId: 'S1', targetInfo: { targetId: 'T1', type: 'page', url: 'https://evil.example/' } } });
  ws.emit({ method: 'Runtime.bindingCalled', sessionId: 'S1', params: { name: BINDING, payload: '{"phase":"ask","kind":"get"}' } });
  ws.emit({ method: 'Runtime.bindingCalled', sessionId: 'S1', params: { name: BINDING, payload: '{"phase":"ask","kind":"get","t":"guess"}' } });
  assert.deepStrictEqual(got, [], '사이트가 지어 부른 것');
  // 진짜 감시 스크립트를 페이지 흉내에 넣고 부르면 그 payload 는 통과
  const src = ws.sent.find((m) => m.method === 'Runtime.evaluate').params.expression;
  const p = page();
  vm.runInContext(src, p.ctx);
  p.ctx.navigator.credentials.get({ publicKey: {} });
  assert.strictEqual(p.sent.length, 1);
  assert.ok(!('__chammoPkToken' in p.ctx) && !Object.values(p.ctx).includes(p.sent[0].t), '토큰은 페이지 전역에 없다');
  ws.emit({ method: 'Runtime.bindingCalled', sessionId: 'S1', params: { name: BINDING, payload: JSON.stringify(p.sent[0]) } });
  assert.deepStrictEqual(got, [['ask', 'T1']]);
  w.stop();
});

test('감시 스크립트는 처음 잡은 바인딩·JSON 으로 보낸다 — 나중에 사이트가 바꿔 끼워도 토큰이 새지 않는다', () => {
  const p = page();
  vm.runInContext(pageScript(true, { token: 'secret' }), p.ctx);
  const stolen = [];
  p.ctx[BINDING] = (s) => stolen.push(s);
  p.ctx.JSON = { stringify: (v) => { stolen.push(v); return '{}'; } };
  p.ctx.navigator.credentials.get({ publicKey: {} });
  assert.deepStrictEqual(stolen, []);
  assert.strictEqual(p.sent[0].t, 'secret');
});
