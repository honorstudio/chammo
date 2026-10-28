const { test } = require('node:test');
const assert = require('node:assert');
const { createPasskeyAuto } = require('../src/passkey-auto');

// 2026-10-29 패스키 자동 판단 — 신호(ask·ok)·1초 tick·사람 '다 했어'로 구글 크롬↔ad-hoc 사본
function rigAuto({ can = true } = {}) {
  const st = { shown: false, auto: false, req: [] };
  const winshow = { shown: () => st.shown, auto: () => st.auto, request: async (on, o = {}) => { st.req.push([on, !!o.auto]); st.shown = on; st.auto = on && !!o.auto; } };
  const urls = { T: 'https://idp.example/passkey' };
  let t = 0;
  const logs = [];
  const a = createPasskeyAuto({ winshow, url: (id) => urls[id], canSwitch: () => can, now: () => t, log: (m) => logs.push(m) });
  return { a, st, urls, at: (v) => { t = v; }, logs };
}

test('자동 — 패스키를 부르면 구글 크롬으로, 성공 뒤 주소가 바뀌고 잠잠해지면 돌아온다', async () => {
  const r = rigAuto();
  await r.a.signal('ask', 'T');
  assert.deepStrictEqual(r.st.req, [[true, true]]);
  await r.a.signal('ask', 'T');
  assert.strictEqual(r.st.req.length, 1, '이미 바꿨으면 그대로');
  r.at(1000);
  await r.a.signal('ok', 'T');
  await r.a.tick();
  assert.strictEqual(r.st.req.length, 1, '주소가 그대로면 기다린다');
  r.urls.T = 'https://idp.example/redirect';
  r.at(1500); await r.a.tick();
  r.urls.T = 'https://shop.example/home';
  r.at(2000); await r.a.tick();
  r.at(3000); await r.a.tick();
  assert.strictEqual(r.st.req.length, 1, '옮겨 다니는 중엔 기다린다');
  r.at(3600); await r.a.tick();
  assert.deepStrictEqual(r.st.req[1], [false, false]);
  assert.match(r.logs.join('\n'), /패스키/);
});

test('자동 — 성공했는데 주소가 안 바뀌면 30초 뒤 돌아온다, 사람이 다 했어를 누르면 바로', async () => {
  const r = rigAuto();
  await r.a.signal('ask', 'T');
  await r.a.signal('ok', 'T');
  r.at(29_000); await r.a.tick();
  assert.strictEqual(r.st.req.length, 1);
  r.at(30_000); await r.a.tick();
  assert.deepStrictEqual(r.st.req.at(-1), [false, false]);
  const q = rigAuto();
  await q.a.signal('ask', 'T');
  await q.a.humanDone();
  assert.deepStrictEqual(q.st.req.at(-1), [false, false]);
});

test('자동 — 사람이 직접 고른 구글 크롬은 저절로 안 되돌린다, 같이 쓰는 스크립트 크롬은 안 바꾼다', async () => {
  const r = rigAuto();
  r.st.shown = true; // 사람이 '이번만 구글 크롬으로 열기'
  await r.a.signal('ok', 'T');
  r.at(60_000); await r.a.tick();
  await r.a.humanDone();
  assert.deepStrictEqual(r.st.req, []);
  const q = rigAuto({ can: false });
  await q.a.signal('ask', 'T');
  assert.deepStrictEqual(q.st.req, []);
  assert.match(q.logs.join('\n'), /못 바꿔/);
});

test('자동 — 탭이 닫히면(로그인 창이 닫힘) 잠잠해진 뒤 돌아온다', async () => {
  const r = rigAuto();
  await r.a.signal('ask', 'T');
  await r.a.signal('ok', 'T');
  delete r.urls.T;
  r.at(100); await r.a.tick();
  r.at(1700); await r.a.tick();
  assert.deepStrictEqual(r.st.req.at(-1), [false, false]);
});

// 실측(10-29) — 세션 browser_click 이 패스키를 부른 그 도구가 끝나기 전에 크롬을 닫아 click 이 'TypeError … url' 로 끝났다.
// 세션 도구가 도는 중이면 끝날 때까지(최대 4초) 기다렸다 바꾼다. 원래 부름은 HOLD_MS 동안 미뤄 두어 크롬 패스키 창은 안 뜬다
test('자동 — 세션 도구가 도는 중이면 끝난 뒤 바꾼다(끝내 안 끝나면 4초 뒤엔 바꾼다)', async () => {
  const st = { shown: false, req: [] };
  const winshow = { shown: () => st.shown, auto: () => false, request: async (on) => { st.req.push(on); st.shown = on; } };
  let busy = true;
  const a = createPasskeyAuto({ winshow, url: () => 'x', canSwitch: () => true, idle: () => !busy, wait: (ms) => new Promise((r) => setTimeout(r, ms / 100)) });
  const p = a.signal('ask', 'T');
  await new Promise((r) => setTimeout(r, 5));
  assert.deepStrictEqual(st.req, [], '도구가 끝나길 기다린다');
  busy = false;
  await p;
  assert.deepStrictEqual(st.req, [true]);
  const st2 = { shown: false, req: [] };
  const w2 = { shown: () => st2.shown, auto: () => false, request: async (on) => { st2.req.push(on); st2.shown = on; } };
  const b = createPasskeyAuto({ winshow: w2, url: () => 'x', canSwitch: () => true, idle: () => false, wait: (ms) => new Promise((r) => setTimeout(r, ms / 100)) });
  await b.signal('ask', 'T');
  assert.deepStrictEqual(st2.req, [true], '끝내 안 끝나도 바꾼다');
});

// 공격 리뷰(10-29) — 돌아온 페이지가 열리자마자 또 패스키를 부르면(성공 30초 뒤 같은 패스키 화면으로 돌아옴 등) 바꾸기↔돌아오기가 끝없이 돈다.
// 돌아온 뒤 60초는 저절로 다시 안 바꾼다(그때는 크롬 패스키 창·칸 더보기 '이번만 구글 크롬으로 열기'). 기록은 남긴다
test('자동 — 돌아온 뒤 60초 안 패스키 부름은 다시 안 바꾼다(되풀이 막기)', async () => {
  const r = rigAuto();
  await r.a.signal('ask', 'T');
  await r.a.humanDone();
  assert.strictEqual(r.st.req.length, 2);
  r.at(59_000);
  await r.a.signal('ask', 'T');
  assert.strictEqual(r.st.req.length, 2);
  assert.match(r.logs.at(-1), /방금 돌아와/);
  r.at(60_000);
  await r.a.signal('ask', 'T');
  assert.deepStrictEqual(r.st.req.at(-1), [true, true]);
});

// 10-29 fix/dock-hide-back 실측 — 사람이 칸 '돌아오기'(앱 .signed off)로 돌아오면 자동 판단은 몰라서, 다시 열린 페이지가 패스키를 또 부르자 곧바로 또 바꿨다
test('자동 — 사람이 돌아오기로 되돌려도(자동 판단 밖) 60초는 다시 안 바꾼다', async () => {
  const r = rigAuto();
  await r.a.signal('ask', 'T');
  assert.strictEqual(r.st.shown, true);
  r.at(5000);
  r.st.shown = false; // 앱 '돌아오기' — winshow 가 직접 되돌림
  r.st.auto = false;
  await r.a.signal('ask', 'T'); // tick 이 돌기 전에 바로 또 부름
  assert.strictEqual(r.st.req.length, 1, '바로 또 안 바꾼다');
  r.at(30_000); await r.a.tick();
  await r.a.signal('ask', 'T');
  assert.strictEqual(r.st.req.length, 1, '60초 안');
  r.at(66_000); await r.a.tick();
  await r.a.signal('ask', 'T');
  assert.strictEqual(r.st.req.length, 2, '60초 지나면 다시');
});

// 0.4.4 리뷰 4 — 감시가 페이지 부름을 붙잡을지 정하는 값: 지금 바꿀 수 있나(사본 갈래·60초 되풀이 막기 밖·같이 쓰는 손님 없음)
test('바꿀 수 있나(ready) — 이미 구글 크롬·돌아온 지 60초 안·손님 있음이면 false', async () => {
  const r = rigAuto();
  assert.strictEqual(r.a.ready(), true);
  await r.a.signal('ask', 'T');
  assert.strictEqual(r.a.ready(), false, '이미 구글 크롬');
  await r.a.humanDone();
  r.at(10_000);
  assert.strictEqual(r.a.ready(), false, '방금 돌아옴');
  r.at(70_000);
  assert.strictEqual(r.a.ready(), true);
  assert.strictEqual(rigAuto({ can: false }).a.ready(), false);
});
