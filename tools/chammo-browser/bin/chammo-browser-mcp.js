#!/usr/bin/env node
// 투명 래퍼: 진짜 @playwright/mcp 를 기동하고 stdio JSON-RPC 를 중계한다.
// Claude 에는 평범한 "playwright" MCP 로 보인다 (도구 이름 동일).
// 락은 기동 시점이 아니라 첫 브라우저 도구 호출 때 잡는다 (src/relay.js).
// 해제: browser_close 성공 시 + 유휴 자동 닫기 + 세션 종료(=프로세스 종료) 시.
// 유휴 시간: --idle-minutes=N 또는 CHAMMO_BROWSER_IDLE_MINUTES (기본 10, 0=끔)
const { spawn } = require('child_process');
const fs = require('fs');
const lock = require('../src/lock');
const paths = require('../src/paths');
const { createRelay, createLineSplitter, parseIdleMs } = require('../src/relay');

const profile = process.argv[2];
if (!profile) {
  console.error('[chammo-browser-mcp] 프로필 이름이 필요합니다. 예: chammo-browser-mcp acme-shop');
  process.exit(1);
}
// 프로필 이름이 경로를 벗어나면(../ 등) 엉뚱한 폴더를 프로필로 쓰게 된다 → 기동 전에 막는다
const badProfile = paths.checkProfile(profile);
if (badProfile) {
  console.error(`[chammo-browser-mcp] ${badProfile}`);
  process.exit(1);
}

const userDataDir = paths.profileDir(profile);
fs.mkdirSync(userDataDir, { recursive: true });

// 프로필 뒤에 붙은 추가 인자는 그대로 playwright 로 패스스루 (--headless 등).
// 단 우리 옵션(--idle-minutes=N)은 빼낸다.
const { idleMs, rest: extra } = parseIdleMs(process.argv.slice(3), process.env);

/**
 * @playwright/mcp 실행 파일 경로.
 *
 * **npx를 쓰지 않는다.** `npx @playwright/mcp@latest`는 매번 최신을 끌어오는데,
 * 2026-09-07에 그게 깨진 alpha(`playwright-core@1.63.0-alpha`, `coreBundle.js` 누락)를 받아
 * MCP가 통째로 뜨지 않았다(Claude엔 CONNECTION_CLOSED로만 보인다).
 * 이 패키지의 의존성으로 **버전을 고정**해 두고 그 cli를 직접 실행한다.
 */
function resolveMcpCli() {
  try {
    // cli.js는 package.json의 `exports`에 없어 직접 resolve가 막힌다 —
    // exports에 있는 package.json을 짚어 그 옆의 cli.js를 쓴다.
    const pkgJson = require.resolve('@playwright/mcp/package.json');
    const cli = require('path').join(require('path').dirname(pkgJson), 'cli.js');
    return fs.existsSync(cli) ? cli : null;
  } catch {
    return null;
  }
}

const cli = resolveMcpCli();
if (!cli) {
  console.error('[chammo-browser-mcp] @playwright/mcp 를 찾지 못했습니다.');
  console.error(`  → cd ${require('path').join(__dirname, '..')} && npm install`);
  process.exit(1);
}

const child = spawn(process.execPath, [cli, '--user-data-dir', userDataDir, ...extra], {
  stdio: ['pipe', 'pipe', 'inherit'], // stdin/stdout 은 중계, stderr 는 그대로
});

const relay = createRelay({
  profile,
  acquire: () => lock.acquire(profile, { lockDir: paths.locksDir }),
  release: () => lock.release(profile, { lockDir: paths.locksDir }),
  sendToChild: (line) => child.stdin.write(line + '\n'),
  sendToClient: (line) => process.stdout.write(line + '\n'),
  idleMs,
  log: (msg) => console.error(msg),
});
process.stdin.on('data', createLineSplitter(relay.onClientLine));
process.stdin.on('end', () => child.stdin.end()); // Claude 가 끊으면 playwright 도 종료 흐름으로
child.stdout.on('data', createLineSplitter(relay.onChildLine));
child.stdin.on('error', () => { /* child 가 먼저 죽은 경우 — exit 핸들러가 정리 */ });

// 락이 없을 때 release 는 no-lock/not-owner 로 끝나므로 남의 락을 건드리지 않는다
let released = false;
function cleanup() {
  if (released) return;
  released = true;
  lock.release(profile, { lockDir: paths.locksDir });
}

child.on('exit', (code) => {
  cleanup();
  process.exit(code == null ? 0 : code);
});
child.on('error', (e) => {
  console.error(`[chammo-browser-mcp] playwright 기동 실패: ${e.message}`);
  cleanup();
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    try { child.kill(sig); } catch { /* noop */ }
    cleanup();
  });
}
process.on('exit', cleanup);
