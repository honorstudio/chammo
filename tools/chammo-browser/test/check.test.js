const { test } = require('node:test');
const assert = require('node:assert');
const { check } = require('../src/check');
const { featureArgs } = require('../src/features');

const fakeBrowser = (log) => ({
  newPage: async () => ({ goto: async (u) => log.push(`goto ${u}`) }),
  version: () => '156.0.8078.4',
  close: async () => log.push('close'),
});

test('시험 열기 — 헤드리스·임시 프로필로 about:blank 를 열고 닫는다(사람 프로필·화면 안 건드림)', async () => {
  const log = [];
  let opts;
  const r = await check({ pick: () => ({ channel: 'chrome-beta', executablePath: null, found: true }), launch: async (o) => { opts = o; return fakeBrowser(log); } });
  assert.deepStrictEqual(r, { ok: true, channel: 'chrome-beta', version: '156.0.8078.4' });
  assert.strictEqual(opts.headless, true);
  assert.strictEqual(opts.channel, 'chrome-beta');
  assert.strictEqual(opts.userDataDir, undefined); // launch() 는 임시 프로필 — 사람 프로필 폴더를 주지 않는다
  assert.deepStrictEqual(opts.args, featureArgs()); // 시험 열기도 세션 크롬과 같은 기능 끄기 — 이게 '앱 관리' 차단이 뜬 자리(QA 4)
  assert.deepStrictEqual(log, ['goto about:blank', 'close']);
});

test('크롬이 없으면 띄우지 않고 no-chrome, 띄우다 실패하면 이유', async () => {
  let launched = false;
  const none = await check({ pick: () => ({ channel: null, executablePath: null, found: false }), launch: async () => { launched = true; } });
  assert.deepStrictEqual(none, { ok: false, error: 'no-chrome' });
  assert.strictEqual(launched, false);
  const bad = await check({ pick: () => ({ channel: 'chrome-beta', executablePath: '/x/Chrome', found: true }), launch: async () => { throw new Error('boom'); } });
  assert.strictEqual(bad.ok, false);
  assert.match(bad.error, /boom/);
});

test('시간 안에 안 끝나면 실패로 돌려준다', async () => {
  const r = await check({ pick: () => ({ channel: null, executablePath: null, found: true }), launch: () => new Promise(() => {}), timeoutMs: 50 });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /timeout/);
});
