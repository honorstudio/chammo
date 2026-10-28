const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWinShow } = require('../src/winshow');
const { visibleFile } = require('../src/windesk');

// 2026-10-28 인앱 브라우저 윈도우판 — 숨은 데스크톱의 OS 창(패스키·Windows Hello·OS 파일 창)은 사람이 못 본다.
// 사람 차례에 그런 창이 필요하면 같은 프로필을 보이는 데스크톱에 다시 띄우고(지금 주소 다시 열기), 다 했으면 숨은 데스크톱으로 되돌린다
function rig({ pid = 4242, tabs = '- 0: (current) [로그인](https://shop.example/login?t=1)' } = {}) {
  const liveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-winshow-'));
  const calls = [];
  const state = { switching: [], refreshed: 0 };
  const live = { switching: (on) => state.switching.push(on), refresh: () => { state.refreshed += 1; } };
  const call = async (name, args, opts) => {
    // 보이는 표시가 다시 띄우기(navigate) 때 있어야 spawn 바꾸기가 보이는 자리에 띄운다
    calls.push([name, args, opts, fs.existsSync(visibleFile(liveDir, 'shop'))]);
    if (name === 'browser_tabs') return { content: [{ type: 'text', text: `### Open tabs\n${tabs}` }] };
    return { content: [{ type: 'text', text: 'ok' }] };
  };
  const ws = createWinShow({ liveDir, profile: 'shop', pid, call, live, log: () => {} });
  const ask = (v) => fs.writeFileSync(path.join(liveDir, 'shop.show'), JSON.stringify({ pid, at: Date.now(), ...v }));
  return { liveDir, calls, state, ws, ask };
}

test('보이는 창 요청 — 지금 주소를 읽고, 닫고(놓지 않음), 보이는 표시를 둔 채 그 주소로 다시 띄운다', async () => {
  const r = rig();
  r.ask({ on: true });
  await r.ws.tick();
  assert.deepStrictEqual(r.calls.map((c) => c[0]), ['browser_tabs', 'browser_close', 'browser_navigate']);
  assert.deepStrictEqual(r.calls[1][2], { keep: true }, '락·상태 파일·개입을 놓지 않는 닫기');
  assert.deepStrictEqual(r.calls[2][1], { url: 'https://shop.example/login?t=1' });
  assert.strictEqual(r.calls[2][3], true, '다시 띄울 때 보이는 표시가 있다');
  assert.strictEqual(fs.existsSync(visibleFile(r.liveDir, 'shop')), false, '한 번 쓰고 치운다 — 크롬이 다시 뜨면 숨은 데스크톱');
  assert.strictEqual(r.ws.shown(), true);
  assert.ok(fs.existsSync(path.join(r.liveDir, 'shop.shown')), '앱이 읽는 꺼냄 표시');
  assert.deepStrictEqual(r.state.switching, [true, false], '바꾸는 동안 사람 부름이 브라우저 꺼짐으로 끝나지 않게');
  assert.ok(r.state.refreshed >= 1, '새 포트를 상태 파일에');
  assert.strictEqual(fs.existsSync(path.join(r.liveDir, 'shop.show')), false, '요청은 지운다');
});

test('되돌리기 — 숨은 데스크톱으로 다시 띄우고, 같이 온 다 했어 표는 다 띄운 뒤에 남긴다(세션이 숨은 크롬에서 이어 가게)', async () => {
  const r = rig();
  r.ask({ on: true });
  await r.ws.tick();
  r.calls.length = 0;
  r.ask({ on: false, done: '4242:1700000000000' });
  await r.ws.tick();
  assert.deepStrictEqual(r.calls.map((c) => c[0]), ['browser_tabs', 'browser_close', 'browser_navigate']);
  assert.strictEqual(r.calls[2][3], false, '되돌릴 땐 보이는 표시 없이 — 숨은 데스크톱');
  assert.strictEqual(r.ws.shown(), false);
  assert.strictEqual(fs.existsSync(path.join(r.liveDir, 'shop.shown')), false);
  assert.strictEqual(fs.readFileSync(path.join(r.liveDir, 'shop.done'), 'utf8'), '4242:1700000000000');
});

test('안 꺼낸 채 되돌리기 요청이면 다시 띄우지 않고 다 했어 표만', async () => {
  const r = rig();
  r.ask({ on: false, done: '4242:1' });
  await r.ws.tick();
  assert.deepStrictEqual(r.calls, []);
  assert.strictEqual(fs.readFileSync(path.join(r.liveDir, 'shop.done'), 'utf8'), '4242:1');
});

test('다른 래퍼·오래된 요청은 버린다, 이미 꺼냈으면 또 안 띄운다', async () => {
  const r = rig();
  fs.writeFileSync(path.join(r.liveDir, 'shop.show'), JSON.stringify({ pid: 1, at: Date.now(), on: true }));
  await r.ws.tick();
  assert.deepStrictEqual(r.calls, [], '남의 래퍼');
  fs.writeFileSync(path.join(r.liveDir, 'shop.show'), JSON.stringify({ pid: 4242, at: Date.now() - 120_000, on: true }));
  await r.ws.tick();
  assert.deepStrictEqual(r.calls, [], '앱이 꺼진 사이 남은 요청');
  r.ask({ on: true });
  await r.ws.tick();
  const n = r.calls.length;
  r.ask({ on: true });
  await r.ws.tick();
  assert.strictEqual(r.calls.length, n);
});

test('바꾸는 동안 세션 도구는 기다린다, 주소를 못 읽으면 빈 탭으로', async () => {
  const r = rig({ tabs: '' });
  assert.strictEqual(r.ws.hold(), null);
  r.ask({ on: true });
  const t = r.ws.tick();
  const h = r.ws.hold();
  assert.ok(h, '바꾸는 중');
  await t;
  await h;
  assert.strictEqual(r.ws.hold(), null);
  assert.deepStrictEqual(r.calls[2][1], { url: 'about:blank' });
});

test('브라우저가 닫히면(세션 닫기·유휴) 꺼냄 표시를 치운다', async () => {
  const r = rig();
  r.ask({ on: true });
  await r.ws.tick();
  r.ws.closed();
  assert.strictEqual(r.ws.shown(), false);
  assert.strictEqual(fs.existsSync(path.join(r.liveDir, 'shop.shown')), false);
});

// 2026-10-28 맥 패스키 탈출구 — 같은 틀을 다른 파일 이름으로(<프로필>.signed 요청 · .signed-want 띄울 때 표 · .signed-on 바꿔 둠 표).
// 윈도우 꺼냄 표(.shown)와 안 섞이게. 다시 열기 전에 옛 크롬이 프로필을 놓았는지 기다린다(같은 프로필 둘째 크롬은 조용히 exit 0)
test('구글 크롬 갈래 — 이름만 다르고 같은 순서, 다시 열기 전에 프로필이 풀리길 기다린다', async () => {
  const liveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-signed-'));
  const want = path.join(liveDir, 'shop.signed-want');
  const calls = [];
  const call = async (name) => {
    calls.push([name, fs.existsSync(want)]);
    if (name === 'browser_tabs') return { content: [{ type: 'text', text: '### Open tabs\n- 0: (current) [x](https://idp.example/passkey)' }] };
    return { content: [{ type: 'text', text: 'ok' }] };
  };
  const live = { switching: () => {}, refresh: () => {} };
  const ws = createWinShow({ liveDir, profile: 'shop', pid: 7, call, live, names: { req: 'signed', mark: 'signed-on', want: 'signed-want' }, beforeOpen: async () => { calls.push(['wait']); } });
  fs.writeFileSync(path.join(liveDir, 'shop.signed'), JSON.stringify({ pid: 7, at: Date.now(), on: true }));
  await ws.tick();
  assert.deepStrictEqual(calls.map((c) => c[0]), ['browser_tabs', 'browser_close', 'wait', 'browser_navigate']);
  assert.strictEqual(calls[3][1], true, '다시 띄울 때 구글 크롬 표가 있다');
  assert.ok(fs.existsSync(path.join(liveDir, 'shop.signed-on')));
  assert.strictEqual(fs.existsSync(path.join(liveDir, 'shop.shown')), false, '윈도우 꺼냄 표는 안 쓴다');
  assert.strictEqual(fs.existsSync(want), false);
  // 보이는 창 요청(.show)은 이 갈래가 안 받는다
  fs.writeFileSync(path.join(liveDir, 'shop.show'), JSON.stringify({ pid: 7, at: Date.now(), on: false }));
  calls.length = 0;
  await ws.tick();
  assert.deepStrictEqual(calls, []);
});

// 2026-10-28 — 참모가 손으로 쓴 {"on":true}(pid·at 없음)를 래퍼가 소리 없이 버리고 파일도 남겨 '안 받는다'로만 보였다.
// 버린 요청은 이유를 한 번 남기고, 주인 없는(pid 없는·깨진) 요청은 지운다. 다른 래퍼 pid 는 그 래퍼 몫이라 둔다
test('버린 요청은 이유를 남긴다 — 깨진·pid 없는 건 지우고, 남의 래퍼 것은 두고 한 번만 적는다', async () => {
  const liveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-winshow-why-'));
  const logs = [];
  const live = { switching: () => {}, refresh: () => {} };
  const call = async () => ({ content: [{ type: 'text', text: 'ok' }] });
  const ws = createWinShow({ liveDir, profile: 'shop', pid: 7, call, live, names: { req: 'signed', mark: 'signed-on', want: 'signed-want' }, log: (m) => logs.push(m) });
  const req = path.join(liveDir, 'shop.signed');
  fs.writeFileSync(req, '{"on":true}');
  await ws.tick();
  assert.strictEqual(fs.existsSync(req), false, '주인 없는 요청은 지운다');
  assert.match(logs.join('\n'), /shop\.signed.*pid/);
  fs.writeFileSync(req, '깨짐');
  await ws.tick();
  assert.strictEqual(fs.existsSync(req), false);
  assert.match(logs.at(-1), /읽을 수 없/);
  logs.length = 0;
  fs.writeFileSync(req, JSON.stringify({ pid: 99, at: Date.now(), on: true }));
  await ws.tick();
  await ws.tick();
  assert.ok(fs.existsSync(req), '다른 래퍼 몫');
  assert.strictEqual(logs.length, 1, '700ms 마다 같은 줄을 쌓지 않는다');
  assert.match(logs[0], /pid 99.*7/);
  logs.length = 0;
  fs.writeFileSync(req, JSON.stringify({ pid: 7, at: Date.now() - 120_000, on: true }));
  await ws.tick();
  assert.match(logs.join('\n'), /오래된/);
});

test('다시 띄우기를 시작·끝낸 것도 남긴다(성공도 — 안 남으면 됐는지 몰랐다)', async () => {
  const liveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-winshow-ok-'));
  const logs = [];
  const call = async (name) => (name === 'browser_tabs' ? { content: [{ type: 'text', text: '- 0: (current) [x](https://a.example/)' }] } : { content: [{ type: 'text', text: 'ok' }] });
  const ws = createWinShow({ liveDir, profile: 'shop', pid: 7, call, live: { switching: () => {}, refresh: () => {} }, names: { req: 'signed', mark: 'signed-on', want: 'signed-want' }, log: (m) => logs.push(m) });
  fs.writeFileSync(path.join(liveDir, 'shop.signed'), JSON.stringify({ pid: 7, at: Date.now(), on: true }));
  await ws.tick();
  assert.match(logs.join('\n'), /켬.*https:\/\/a\.example/);
});

// 2026-10-29 패스키 자동 — 페이지가 패스키를 부르면 래퍼가 스스로(요청 파일 없이) 구글 크롬으로 바꾼다. 표에 auto 를 적어 앱 칸이
// '패스키 때문에 크롬 창에서 열었어'를 보이고, 다음 세션 도구 결과에 한 번 '페이지가 새로 열렸어' 꼬리를 붙인다
test('스스로 바꾸기(request) — 자동 표시를 표에 적고 세션 꼬리를 한 번 준다, 되돌리면 지운다', async () => {
  const liveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-winshow-auto-'));
  const calls = [];
  const call = async (name) => { calls.push(name); return name === 'browser_tabs' ? { content: [{ type: 'text', text: '- 0: (current) [x](https://idp.example/login)' }] } : { content: [{ type: 'text', text: 'ok' }] }; };
  const ws = createWinShow({ liveDir, profile: 'shop', pid: 7, call, live: { switching: () => {}, refresh: () => {} }, names: { req: 'signed', mark: 'signed-on', want: 'signed-want' } });
  assert.strictEqual(ws.takeNote(), '');
  await ws.request(true, { auto: true });
  assert.deepStrictEqual(calls, ['browser_tabs', 'browser_close', 'browser_navigate']);
  assert.strictEqual(ws.shown(), true);
  assert.strictEqual(ws.auto(), true);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(liveDir, 'shop.signed-on'), 'utf8')).auto, true, '앱 칸이 읽는 자동 표시');
  assert.match(ws.takeNote(), /패스키.*구글 크롬.*browser_snapshot/s);
  assert.strictEqual(ws.takeNote(), '', '한 번만');
  await ws.request(true, { auto: true });
  assert.strictEqual(calls.length, 3, '이미 바꿨으면 또 안 띄운다');
  await ws.request(false);
  assert.strictEqual(ws.shown(), false);
  assert.strictEqual(ws.auto(), false);
  assert.match(ws.takeNote(), /참모 브라우저로 다시/);
});

test('사람이 고른 바꾸기(요청 파일)는 자동이 아니다 — 꼬리도 없다', async () => {
  const liveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-winshow-man-'));
  const call = async () => ({ content: [{ type: 'text', text: 'ok' }] });
  const ws = createWinShow({ liveDir, profile: 'shop', pid: 7, call, live: { switching: () => {}, refresh: () => {} }, names: { req: 'signed', mark: 'signed-on', want: 'signed-want' } });
  fs.writeFileSync(path.join(liveDir, 'shop.signed'), JSON.stringify({ pid: 7, at: Date.now(), on: true }));
  await ws.tick();
  assert.strictEqual(ws.shown(), true);
  assert.strictEqual(ws.auto(), false);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(liveDir, 'shop.signed-on'), 'utf8')).auto, undefined);
  assert.strictEqual(ws.takeNote(), '');
});

test('바꾸는 중 또 부탁하면 기다렸다 그 결과로 판단한다', async () => {
  const liveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-winshow-race-'));
  let n = 0;
  const call = async (name) => { if (name === 'browser_navigate') n += 1; await new Promise((r) => setTimeout(r, 20)); return { content: [{ type: 'text', text: 'ok' }] }; };
  const ws = createWinShow({ liveDir, profile: 'shop', pid: 7, call, live: { switching: () => {}, refresh: () => {} }, names: { req: 'signed', mark: 'signed-on', want: 'signed-want' } });
  await Promise.all([ws.request(true, { auto: true }), ws.request(true, { auto: true })]);
  assert.strictEqual(n, 1);
});

// 0.4.4 리뷰 1 — 서랍 지킴이는 손님이 붙은 동안 안 바꾼다. 그때 온 '돌아오기'·'다 했어'(.signed {on:false, done})를 읽지도 않아 60초 뒤 버려졌다 →
// '다 했어' 표를 잃고 손님이 떠나도 구글 크롬(Dock)에 남았다. 막힌 되돌리기는 기억했다가 풀리면 하고, 다 했어 표는 바로 남긴다
function gatedRig() {
  const liveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-winshow-gate-'));
  const calls = [];
  const call = async (name) => { calls.push(name); return name === 'browser_tabs' ? { content: [{ type: 'text', text: '- 0: (current) [x](https://idp.example/login)' }] } : { content: [{ type: 'text', text: 'ok' }] }; };
  const g = { ok: true, released: 0 };
  let t = 1_000_000;
  const ws = createWinShow({ liveDir, profile: 'shop', pid: 7, call, live: { switching: () => {}, refresh: () => {} }, names: { req: 'signed', mark: 'signed-on', want: 'signed-want' }, claim: () => g.ok, release: () => { g.released += 1; }, now: () => t });
  return { liveDir, calls, g, ws, at: (v) => { t = v; }, now: () => t };
}

test('막힌 되돌리기 — 다 했어 표는 바로, 되돌리기는 기억했다가(60초 넘어도) 풀리면 한다', async () => {
  const r = gatedRig();
  await r.ws.request(true, { auto: true });
  assert.strictEqual(r.ws.shown(), true);
  assert.strictEqual(r.g.released, 1, '바꾼 뒤 표시를 푼다');
  r.g.ok = false; // 손님이 붙었다
  r.calls.length = 0;
  fs.writeFileSync(path.join(r.liveDir, 'shop.signed'), JSON.stringify({ pid: 7, at: r.now(), on: false, done: '다 했어' }));
  await r.ws.tick();
  assert.deepStrictEqual(r.calls, [], '손님이 있는 동안은 안 바꾼다');
  assert.strictEqual(fs.readFileSync(path.join(r.liveDir, 'shop.done'), 'utf8'), '다 했어', '다 했어 표는 바로');
  assert.strictEqual(fs.existsSync(path.join(r.liveDir, 'shop.signed')), false, '요청은 받아 둔다(60초 뒤 버려지지 않게)');
  r.at(r.now() + 120_000);
  await r.ws.tick();
  assert.deepStrictEqual(r.calls, []);
  r.g.ok = true; // 손님이 떠났다
  await r.ws.tick();
  assert.deepStrictEqual(r.calls, ['browser_tabs', 'browser_close', 'browser_navigate']);
  assert.strictEqual(r.ws.shown(), false);
  r.calls.length = 0;
  await r.ws.tick();
  assert.deepStrictEqual(r.calls, [], '한 번만');
});

test('래퍼 스스로 되돌리기(request false)도 막히면 기억했다가 풀리면 — 막힌 켜기는 버린다(손님이 떠난 뒤 갑자기 바뀌지 않게)', async () => {
  const r = gatedRig();
  await r.ws.request(true, { auto: true });
  r.g.ok = false;
  r.calls.length = 0;
  await r.ws.request(false);
  assert.strictEqual(r.ws.shown(), true);
  r.g.ok = true;
  await r.ws.tick();
  assert.strictEqual(r.ws.shown(), false);
  r.g.ok = false;
  r.calls.length = 0;
  await r.ws.request(true, { auto: true });
  r.g.ok = true;
  await r.ws.tick();
  assert.deepStrictEqual(r.calls, []);
  assert.strictEqual(r.ws.shown(), false);
});
