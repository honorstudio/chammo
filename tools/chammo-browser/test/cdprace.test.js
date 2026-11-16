const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

// 지킴이(_hold)·MCP 래퍼의 플레이라이트가 대화상자를 스스로 닫으려다(Page.handleJavaScriptDialog) 크롬이 이미 닫은 뒤면
// "No dialog is showing" 으로 거절된다 — 아무도 안 받는 거절이라 node 가 죽고 스크립트가 크롬을 잃었다(2026-11-16 운영 수집 PC 지킴이 기록)
const SRC = path.join(__dirname, '..', 'src');
const RACE = "Object.assign(new Error('Protocol error (Page.handleJavaScriptDialog): No dialog is showing'), { name: 'ProtocolError', method: 'Page.handleJavaScriptDialog' })";
const run = (pre, body) => spawnSync(process.execPath, [...pre, '-e', body], { encoding: 'utf8', timeout: 10_000 });

test('대화상자 경합 거절을 알아본다 — 다른 오류는 아니다', () => {
  const { benignRace } = require('../src/cdprace');
  assert.ok(benignRace(eval(RACE)));
  assert.ok(benignRace({ message: 'Protocol error (Page.handleJavaScriptDialog): No dialog is showing' }));
  assert.ok(!benignRace(new Error('Target page, context or browser has been closed')));
  assert.ok(!benignRace(null));
});

test('지킴이: 그 거절을 흉내 내도 node 가 산다(고치기 전엔 죽었다)', () => {
  const body = `Promise.reject(${RACE}); setTimeout(() => console.log('alive'), 300);`;
  const bare = run([], body);
  assert.notStrictEqual(bare.status, 0, '감싸지 않으면 죽는다 — 시험이 진짜 조건을 흉내 내는지');
  const held = run([], `require(${JSON.stringify(path.join(SRC, 'cdprace.js'))}).guardHold({ log: (m) => console.error(m) }); ${body}`);
  assert.strictEqual(held.status, 0, held.stderr);
  assert.match(held.stdout, /alive/);
  assert.match(held.stderr, /No dialog is showing/);
});

test('지킴이: 다른 처리 안 된 거절도 지킴이를 죽이지 않는다(기록만) — 죽으면 스크립트가 크롬을 잃는다', () => {
  const r = run([], `require(${JSON.stringify(path.join(SRC, 'cdprace.js'))}).guardHold({ log: (m) => console.error(m) }); Promise.reject(new Error('다른 거절')); setTimeout(() => console.log('alive'), 300);`);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stderr, /다른 거절/);
});

test('MCP 래퍼(survive.js): 대화상자 경합 거절엔 안 죽고, 다른 거절엔 전처럼 죽는다', () => {
  const pre = ['--require', path.join(SRC, 'survive.js')];
  const ok = run(pre, `Promise.reject(${RACE}); setTimeout(() => console.log('alive'), 300);`);
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /alive/);
  const dead = run(pre, `Promise.reject(new Error('진짜 오류')); setTimeout(() => console.log('alive'), 300);`);
  assert.strictEqual(dead.status, 1);
});
