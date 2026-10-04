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
const { createFocusGuard } = require('../src/focus');
const { windowPosition, windowSize, virtualDisplay, chromeLaunch, chromeArgs, macScreens, waitVirtualDisplay, offscreenPosition } = require('../src/window');
const { minimizePulledIn } = require('../src/minimize');
const { guardTool } = require('../src/guard');
const liveMod = require('../src/live');

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

// 세션 브라우저 앱에서 보기 — 켜져 있으면(기본) 크롬에 CDP 포트를 열고 지금 탭·하는 일을 상태 파일로(src/live.js)
const watchable = liveMod.enabled(paths.dataDir());
const live = watchable ? liveMod.createLive({ profile, root: paths.ROOT, profileDir: userDataDir, pid: process.pid, ppid: process.ppid }) : null;
if (live) live.reset();

// 크롬 인자(경고 띠 숨기기·창 자리·CDP 포트)는 MCP 설정 파일로 — 사용자가 --config 를 따로 주면 그걸 쓴다
const mac = process.platform === 'darwin';
const configArgs = [];
let offPos = null; // 가짜 화면이 없어 화면 밖에 띄웠으면 그 자리 — 크롬이 끌어오면 최소화
if (!extra.some((a) => a === '--config' || a.startsWith('--config='))) {
  // 세션 브라우저 앱에서 보기가 켜져 있고 앱이 가상 모니터를 띄워 뒀으면 거기에(사용자 화면 어디에도 안 보이게), 아니면 비켜 놓은 자리
  // 앱이 있는 맥이면(데이터 폴더 config.json) 가짜 화면 자리를 3초 기다리고 — 앱이 다시 켜지는 사이·도우미가 막 뜨는 중이면 곧 생긴다 —
  // 그래도 없으면 화면 밖에(사용자 화면에 안 뜨게, 2026-10-03 맥북 하나일 때). 앱이 아예 없는 기계는 지금처럼 보이는 자리
  const appHere = fs.existsSync(require('path').join(paths.dataDir(), 'config.json'));
  const vdFile = require('path').join(paths.ROOT, 'vdisplay.json');
  const vd = mac && watchable ? (appHere ? waitVirtualDisplay(() => virtualDisplay(vdFile)) : virtualDisplay(vdFile)) : null;
  const screens = mac && !vd ? { ...(macScreens() || {}), profile } : null;
  offPos = mac && watchable && appHere && !vd ? offscreenPosition(screens) : null;
  const pos = vd ? vd.pos : offPos || (screens ? windowPosition(screens) : null);
  const size = vd ? vd.size : offPos ? [1280, 800] : screens ? windowSize(screens, pos) : null;
  const configFile = require('path').join(paths.ROOT, 'run', `${profile}.json`);
  try {
    fs.mkdirSync(require('path').dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify({ browser: { launchOptions: { args: chromeArgs(pos, watchable, size) } } }, null, 2));
    configArgs.push('--config', configFile);
  } catch (e) {
    console.error(`[chammo-browser-mcp] 설정 파일을 못 써서 크롬 인자 없이 띄웁니다: ${e.message}`);
  }
}

// 세션 크롬은 크롬 베타가 있으면 베타로(사용자 일반 크롬과 안 섞이게) — 사용자가 --browser 를 따로 주면 그걸.
// 베타가 ~/Applications 면(관리자 아닌 계정에 앱이 깐 자리) 플레이라이트가 못 찾으니 실행 파일 경로를 같이
const own = extra.some((a) => a === '--browser' || a.startsWith('--browser=') || a === '--executable-path' || a.startsWith('--executable-path='));
const picked = chromeLaunch();
if (!own && picked.channel) configArgs.push('--browser', picked.channel);
if (!own && picked.executablePath) configArgs.push('--executable-path', picked.executablePath);
// 크롬이 하나도 없으면 브라우저 도구를 '설치' 안내로 막는다(직접 고른 브라우저면 그대로). browser_install 은 늘 막는다(src/guard.js)
const chromeFound = own || picked.found;

const ASK_TOOL = {
  name: 'browser_ask_human',
  description: '사람이 브라우저에서 직접 해야 할 때만 부른다 — 로그인·2단계 인증·캡차·결제 승인처럼 대신 하면 안 되거나 못 하는 것. 지금 열린 브라우저를 사람 앱(Chammo)에 크게 띄우고 알린 뒤, 사람이 다 했다고 누를 때까지(최대 10분) 기다린다. 끝나면 browser_snapshot 으로 확인하고 이어서 한다. 비밀번호를 묻거나 대신 치지 않는다.',
  inputSchema: { type: 'object', properties: { reason: { type: 'string', description: '사람에게 보일 한 줄(무엇을 해 달라는지). 비밀번호·개인 정보는 적지 않는다' } }, required: ['reason'] },
};

const child = spawn(process.execPath, [cli, '--user-data-dir', userDataDir, ...configArgs, ...extra], {
  stdio: ['pipe', 'pipe', 'inherit'], // stdin/stdout 은 중계, stderr 는 그대로
});

// 화면 밖에 띄운 크롬을 크롬·맥이 화면 안으로 끌어오면 최소화 — 포트가 생기면 몇 번(처음 창·곧 뜨는 창). 앱이 나중에 켜지면 가짜 화면으로 옮긴다
if (offPos && live) {
  const started = Date.now();
  const tries = [0, 1500, 4000];
  const tick = setInterval(() => {
    const port = liveMod.readPort(userDataDir);
    if (!port) {
      if (Date.now() - started > 30_000) clearInterval(tick);
      return;
    }
    clearInterval(tick);
    for (const ms of tries) setTimeout(() => { minimizePulledIn(port, offPos).catch(() => {}); }, ms).unref();
  }, 300);
  tick.unref();
}

const relay = createRelay({
  profile,
  acquire: () => lock.acquire(profile, { lockDir: paths.locksDir }),
  release: () => { lock.release(profile, { lockDir: paths.locksDir }); if (live) live.closed(); }, // browser_close·유휴 닫기
  sendToChild: (line) => child.stdin.write(line + '\n'),
  // 사람 부르기 — 로그인·2FA·캡차처럼 사람이 해야 할 때. 앱(세션 브라우저 앱에서 보기)이 크게 띄우고 알린다
  extraTools: live ? [ASK_TOOL] : [],
  onLocalTool: (name, args) => {
    const blocked = guardTool(name, chromeFound);
    if (blocked) return Promise.resolve(blocked);
    return live && name === ASK_TOOL.name
      ? live.askHuman(args && args.reason).then((r) => ({ content: [{ type: 'text', text: r.text }], isError: !r.ok }))
      : null;
  },
  sendToClient: (line) => process.stdout.write(line + '\n'),
  // 사람이 앱 모달에서 연 파일 창(앱이 맥 파일 창으로 처리)이 플레이라이트에도 '[File chooser]' 로 쌓여 세션 도구를 막았다(QA N3) —
  // 그만큼 파일 없는 browser_file_upload(= 그 상태만 치움, 페이지엔 아무것도 안 함)를 먼저 보낸다
  beforeCall: () => (live ? Array.from({ length: live.takeHumanChoosers() }, () => ({ name: 'browser_file_upload', arguments: {} })) : []),
  idleMs,
  log: (msg) => console.error(msg),
  // 브라우저가 뜨며 크롬이 맨 앞 앱이 되면 원래 앞 앱으로 되돌린다(macOS) + 세션 브라우저 상태 파일
  ...(() => {
    const g = mac ? createFocusGuard() : null;
    return {
      onCallStart: (n, a) => { if (g) g.start(n); if (live) live.onCall(n, a); },
      onCallEnd: (n, r) => { if (g) g.end(n); if (live && n !== 'browser_close') live.onResult(n, r); },
    };
  })(),
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
  if (live) live.closed();
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
