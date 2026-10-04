const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { setupMcp, stableNode } = require('../src/setup');

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
  setupMcp({ profile: 'acme-shop', dir, env: {}, home: tmp() }); // 홈 밖 경로라 ${HOME} 로 안 바뀐다, 데이터 폴더에 node 링크 없음
  const e = read(dir).mcpServers.playwright;
  assert.strictEqual(e.command, stableNode(fs.realpathSync(process.execPath)));
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

test('Homebrew node 는 버전 폴더(Cellar/…/26.8.1) 말고 버전 없는 opt 경로로 — brew upgrade 가 옛 버전을 지우면 .mcp.json 이 죽는다', () => {
  const has = (set) => (p) => set.includes(p);
  assert.strictEqual(
    stableNode('/opt/homebrew/Cellar/node/26.8.1/bin/node', has(['/opt/homebrew/opt/node/bin/node'])),
    '/opt/homebrew/opt/node/bin/node',
  );
  assert.strictEqual(
    stableNode('/usr/local/Cellar/node@22/22.11.0/bin/node', has(['/usr/local/opt/node@22/bin/node'])),
    '/usr/local/opt/node@22/bin/node',
  );
  // opt 링크가 없으면 그대로, Cellar 가 아니면 그대로(nvm·fnm·공식 설치판)
  assert.strictEqual(stableNode('/opt/homebrew/Cellar/node/26.8.1/bin/node', has([])), '/opt/homebrew/Cellar/node/26.8.1/bin/node');
  assert.strictEqual(stableNode('/usr/local/bin/node', has(['/usr/local/opt/node/bin/node'])), '/usr/local/bin/node');
  assert.strictEqual(stableNode('C:\\Program Files\\nodejs\\node.exe', has([])), 'C:\\Program Files\\nodejs\\node.exe');
});

test('데이터 폴더에 node 링크(tools/bin/node)가 있으면 그걸 — 앱이 고른 node(시스템 20+ 또는 받은 것)를 한 곳에서 가리킨다', () => {
  if (process.platform === 'win32') return;
  const home = tmp();
  const data = path.join(home, '.chammo');
  fs.mkdirSync(path.join(data, 'tools', 'bin'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(data, 'tools', 'bin', 'node'));
  const dir = tmp();
  setupMcp({ profile: 'acme-shop', dir, env: {}, home, wrapperPath: path.join(data, 'tools/chammo-browser/bin/chammo-browser-mcp.js') });
  const e = read(dir).mcpServers.playwright;
  // 홈 아래 경로는 ${HOME} 로 — git 으로 다른 맥(다른 사용자 이름)에 가도 뜬다(Claude 가 .mcp.json 에서 풀어 준다)
  assert.strictEqual(e.command, '${HOME}/.chammo/tools/bin/node');
  assert.deepStrictEqual(e.args, ['${HOME}/.chammo/tools/chammo-browser/bin/chammo-browser-mcp.js', 'acme-shop']);
});

test('링크가 깨져 있으면(가리키던 node 가 지워짐) 지금 node 로', () => {
  if (process.platform === 'win32') return;
  const home = tmp();
  fs.mkdirSync(path.join(home, '.chammo', 'tools', 'bin'), { recursive: true });
  fs.symlinkSync('/nonexistent/node', path.join(home, '.chammo', 'tools', 'bin', 'node'));
  const dir = tmp();
  setupMcp({ profile: 'acme-shop', dir, env: {}, home });
  assert.strictEqual(read(dir).mcpServers.playwright.command, stableNode(fs.realpathSync(process.execPath)));
});

test('홈 경로 바꾸기 — 맥은 홈 아래만 ${HOME}, 윈도우는 그대로(풀기 실측 전)', () => {
  const { homeVar } = require('../src/setup');
  assert.strictEqual(homeVar('/Users/a/.chammo/tools/bin/node', '/Users/a', 'darwin'), '${HOME}/.chammo/tools/bin/node');
  assert.strictEqual(homeVar('/Users/ab/x', '/Users/a', 'darwin'), '/Users/ab/x'); // 이름이 겹치는 다른 사용자
  assert.strictEqual(homeVar('/opt/homebrew/opt/node/bin/node', '/Users/a', 'darwin'), '/opt/homebrew/opt/node/bin/node');
  assert.strictEqual(homeVar('C:\\Users\\a\\.chammo\\tools\\node\\node.exe', 'C:\\Users\\a', 'win32'), 'C:\\Users\\a\\.chammo\\tools\\node\\node.exe');
  assert.strictEqual(homeVar('/x', '', 'darwin'), '/x');
});
