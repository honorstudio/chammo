const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { setupMcp } = require('../src/setup');

const NODE = '/opt/node/bin/node';
const WRAPPER = '/opt/chammo-browser/bin/chammo-browser-mcp.js';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-setup-'));
const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'));
const run = (dir, extra = {}) => setupMcp({ profile: 'acme-shop', dir, nodePath: NODE, wrapperPath: WRAPPER, env: {}, ...extra });

test('빈 폴더: .mcp.json 을 만들고 playwright 를 래퍼 절대경로 + 현재 node 로 등록', () => {
  const dir = tmp();
  const r = run(dir);
  assert.strictEqual(r.created, true);
  assert.deepStrictEqual(read(dir), {
    mcpServers: { playwright: { type: 'stdio', command: NODE, args: [WRAPPER, 'acme-shop'] } },
  });
});

test('다른 서버·최상위 키는 그대로 두고 병합', () => {
  const dir = tmp();
  const before = { mcpServers: { supabase: { type: 'http', url: 'https://example.test/mcp' } }, extra: 1 };
  fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify(before));
  run(dir);
  const after = read(dir);
  assert.deepStrictEqual(after.mcpServers.supabase, before.mcpServers.supabase);
  assert.strictEqual(after.extra, 1);
  assert.strictEqual(after.mcpServers.playwright.command, NODE);
});

test('다른 곳을 가리키던 playwright 는 바꾸고, 무엇을 바꿨는지 돌려준다', () => {
  const dir = tmp();
  const old = { command: 'npx', args: ['@playwright/mcp@latest', '--extension'] };
  fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { playwright: old } }));
  const r = run(dir);
  assert.deepStrictEqual(r.replaced, old);
  assert.deepStrictEqual(read(dir).mcpServers.playwright.args, [WRAPPER, 'acme-shop']);
});

test('같은 설정으로 다시 돌리면 unchanged (replaced 없음)', () => {
  const dir = tmp();
  run(dir);
  const r = run(dir);
  assert.strictEqual(r.unchanged, true);
  assert.strictEqual(r.replaced, null);
});

test('.mcp.json 이 깨져 있으면 덮어쓰지 않고 에러', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '.mcp.json'), '{ broken');
  assert.throws(() => run(dir), /JSON/);
  assert.strictEqual(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'), '{ broken');
});

test('잘못된 프로필 이름·없는 폴더는 거부', () => {
  assert.throws(() => run(tmp(), { profile: '../etc' }), /경로 문자/);
  assert.throws(() => run(path.join(tmp(), 'missing')), /폴더가 없습니다/);
});

test('데이터 폴더를 바꿔 둔 환경이면 그 루트를 env 로 고정해 둔다', () => {
  const dir = tmp();
  run(dir, { env: { CHAMMO_HOME: '/data/c' } });
  assert.deepStrictEqual(read(dir).mcpServers.playwright.env, { CHAMMO_BROWSER_HOME: path.join('/data/c', 'browser') });
  const dir2 = tmp();
  run(dir2);
  assert.strictEqual(read(dir2).mcpServers.playwright.env, undefined); // 기본 위치면 안 적는다
});

test('기본값: node 는 실제 경로(realpath), 래퍼는 이 패키지의 bin 절대경로', () => {
  const dir = tmp();
  setupMcp({ profile: 'acme-shop', dir, env: {} });
  const e = read(dir).mcpServers.playwright;
  assert.strictEqual(e.command, fs.realpathSync(process.execPath));
  assert.ok(path.isAbsolute(e.args[0]) && fs.existsSync(e.args[0]));
  assert.strictEqual(path.basename(e.args[0]), 'chammo-browser-mcp.js');
});

test('CLI setup: PATH 에 없어도 node 로 직접 실행해 등록되고, 바뀐 항목을 알려준다', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { playwright: { command: 'old-cmd' } } }));
  const cli = path.join(__dirname, '..', 'bin', 'chammo-browser.js');
  const env = { ...process.env, CHAMMO_BROWSER_HOME: tmp() };
  delete env.CHAMMO_HOME;
  const r = spawnSync(process.execPath, [cli, 'setup', 'acme-shop', dir], { env, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /old-cmd/);
  assert.strictEqual(read(dir).mcpServers.playwright.args[1], 'acme-shop');
  const bad = spawnSync(process.execPath, [cli, 'setup', '../x', dir], { env, encoding: 'utf8' });
  assert.notStrictEqual(bad.status, 0);
});
