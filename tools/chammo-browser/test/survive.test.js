const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const PRELOAD = path.join(__dirname, '..', 'src', 'survive.js');

// 플레이라이트 MCP 의 browser_run_code_unsafe 흉내 — vm 상자엔 page·__end__ 만 넣고, 처리기는 크롬 사건처럼 다음 틱(setImmediate)에 부른다
const RUN_CODE = (code) => `
const vm = require('vm');
const { EventEmitter } = require('events');
const page = new EventEmitter();
const ctx = { page, __end__: {} };
vm.createContext(ctx);
const reasons = [];
process.on('unhandledRejection', (r) => reasons.push(String(r)));
vm.runInContext(${JSON.stringify(code)}, ctx);
setImmediate(() => page.emit('response', { url: () => 'https://example.test/_vercel/insights/view' }));
setTimeout(() => { console.log(JSON.stringify({ alive: true, reasons })); }, 200);
`;

const run = (script, preload = true) =>
  spawnSync(process.execPath, [...(preload ? ['--require', PRELOAD] : []), '-e', script], { encoding: 'utf8', timeout: 10000 });

const HANDLER = "page.on('response', (r) => { globalThis.out = new URL(r.url()).pathname; notDefinedHere.x; })";

test('재현: 고치기 전 — run_code 처리기 안 예외가 플레이라이트 프로세스를 통째로 죽인다(세션엔 Connection closed)', () => {
  const r = run(RUN_CODE(HANDLER), false);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /ReferenceError/);
});

test('run_code 처리기 안 예외는 서버를 죽이지 않고 다음 도구 결과로 간다(unhandledRejection 길)', () => {
  const r = run(RUN_CODE(HANDLER));
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.alive, true);
  assert.strictEqual(out.reasons.length, 1);
  assert.match(out.reasons[0], /notDefinedHere is not defined/); // URL 은 있으니 그다음 줄에서 터진다
});

test('run_code 상자에 URL·setTimeout 같은 표준 전역을 넣는다 — 없어서 ReferenceError 로 죽었다(2026-10-11)', () => {
  const code = "page.on('response', (r) => { setTimeout(() => {}, 1); new URLSearchParams('a=1'); console.log('in-box', new URL(r.url()).pathname); })";
  const r = run(RUN_CODE(code));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stderr, /in-box \/_vercel\/insights\/view/);
  assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()).reasons, []);
});

test('상자 console 은 stderr 로 — stdout 은 MCP JSON-RPC 통로라 세션의 console.log 가 날것으로 섞이면 안 된다', () => {
  const code = "page.on('response', () => { console.log('box-log'); console.info('box-info'); console.warn('box-warn'); })";
  const r = run(RUN_CODE(code));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /box-/);
  assert.match(r.stderr, /box-log/);
  assert.match(r.stderr, /box-info/);
  assert.strictEqual(r.stdout.trim().split('\n').length, 1); // 시험 끝 줄(JSON) 하나만
});

test('같은 처리기 예외가 되풀이돼도(setInterval·응답마다) 한 번만 넘기고 stderr 도 한 줄 — 다음 도구 결과·로그가 끝없이 불어나지 않게', () => {
  const code = "let n = 0; const t = setInterval(() => { n++; if (n > 30) clearInterval(t); missingThing.x; }, 1)";
  const r = run(RUN_CODE(code).replace('}, 200);', '}, 600);'));
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.reasons.length, 1, JSON.stringify(out.reasons));
  assert.ok((r.stderr.match(/run_code 처리기 오류/g) || []).length <= 1, r.stderr);
});

test('다른 예외는 따로 넘긴다(같은 글만 묶는다)', () => {
  const code = "page.on('response', () => { setTimeout(() => { aaa.x; }, 1); setTimeout(() => { bbb.x; }, 2); })";
  const r = run(RUN_CODE(code));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(JSON.parse(r.stdout.trim().split('\n').pop()).reasons.length, 2);
});

test('사용자 코드가 아닌 예외는 원래처럼 죽는다(오류 줄 + 종료 코드 1)', () => {
  const r = run("setImmediate(() => { throw new Error('internal-bug'); }); setTimeout(() => console.log('should-not-print'), 300);");
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /internal-bug/);
  assert.doesNotMatch(r.stdout, /should-not-print/);
});

test('page·__end__ 가 없는 다른 vm 상자는 건드리지 않는다', () => {
  const r = run("const vm = require('vm'); const c = {}; vm.createContext(c); console.log(vm.runInContext('typeof URL', c));");
  assert.strictEqual(r.stdout.trim(), 'undefined');
});
