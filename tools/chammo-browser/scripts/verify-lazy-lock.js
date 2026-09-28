// 지연 락 실전 검증: 래퍼(chammo-browser-mcp) 두 개를 같은 프로필로 띄우고
// JSON-RPC 를 직접 흘려 본다. Claude 세션 재시작 없이 확인하는 용도.
// 실제 <데이터 폴더>/browser 는 건드리지 않도록 임시 CHAMMO_BROWSER_HOME 을 쓴다.
//   node scripts/verify-lazy-lock.js   (결과 로그: .shots/verify-lazy-lock.log)
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLineSplitter } = require('../src/relay');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-verify-'));
const PROFILE = 'verify-lazy';
const WRAPPER = path.join(__dirname, '..', 'bin', 'chammo-browser-mcp.js');
const LOCK = path.join(HOME, 'locks', `${PROFILE}.lock`);
const PAGE = 'data:text/html,<title>chammo</title><h1>lazy lock</h1>';

const log = [];
function say(s) { console.log(s); log.push(s); }

function startWrapper(tag) {
  const p = spawn(process.execPath, [WRAPPER, PROFILE, '--headless'], {
    env: { ...process.env, CHAMMO_BROWSER_HOME: HOME },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const waiters = new Map();
  let nextId = 1;
  p.stdout.on('data', createLineSplitter((line) => {
    const msg = JSON.parse(line);
    if (msg.id != null && waiters.has(msg.id)) { waiters.get(msg.id)(msg); waiters.delete(msg.id); }
  }));
  p.stderr.on('data', (d) => log.push(`[${tag} stderr] ${d.toString().trim()}`));
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const t = setTimeout(() => reject(new Error(`${tag} ${method} 응답 없음`)), 60000);
    waiters.set(id, (m) => { clearTimeout(t); resolve(m); });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const notify = (method) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
  const tool = (name, args = {}) => request('tools/call', { name, arguments: args });
  return { p, tag, request, notify, tool, alive: () => p.exitCode === null && p.signalCode === null };
}

// 크로미움은 `--user-data-dir=<경로>`(등호)로 뜨고 MCP cli 는 공백으로 받는다 → 크로미움만 센다
const chromiumCount = () => {
  try {
    return Number(execSync(`pgrep -f "user-data-dir=${path.join(HOME, 'profiles', PROFILE)}" | wc -l`).toString().trim());
  } catch { return 0; }
};
const lockHolder = () => (fs.existsSync(LOCK) ? JSON.parse(fs.readFileSync(LOCK, 'utf8')).pid : null);
const text = (res) => (res.result?.content || []).map((c) => c.text).join(' ').replace(/\s+/g, ' ').slice(0, 160);

let failed = 0;
function check(label, cond, detail = '') {
  if (!cond) failed++;
  say(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

async function handshake(w) {
  const init = await w.request('initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'verify', version: '0' },
  });
  w.notify('notifications/initialized');
  const list = await w.request('tools/list', {});
  return { init, tools: list.result?.tools?.length || 0 };
}

async function main() {
  say(`임시 홈: ${HOME}`);
  const A = startWrapper('A');
  const B = startWrapper('B');

  const [ha, hb] = await Promise.all([handshake(A), handshake(B)]);
  check('1. A·B 둘 다 initialize/tools/list 성공 (락 없이 연결)', ha.tools > 0 && hb.tools > 0, `도구 A=${ha.tools} B=${hb.tools}`);
  check('   연결 직후엔 아무도 락을 안 잡음', lockHolder() === null);

  const navA = await A.tool('browser_navigate', { url: PAGE });
  check('2. A 첫 browser_navigate 성공', !navA.result?.isError, text(navA));
  check('   락 = A', lockHolder() === A.p.pid, `holder=${lockHolder()} A=${A.p.pid}`);
  check('   크로미움 떠 있음', chromiumCount() > 0, `프로세스 ${chromiumCount()}개`);

  const navB = await B.tool('browser_navigate', { url: PAGE });
  check('3. B browser_navigate → 도구 에러(isError)', navB.result?.isError === true, text(navB));
  check('   B 프로세스는 살아 있음', B.alive());

  const closeA = await A.tool('browser_close');
  check('4. A browser_close 성공', !closeA.result?.isError, text(closeA));
  check('   락 해제됨', lockHolder() === null);
  await new Promise((r) => setTimeout(r, 1000));
  check('   크로미움도 전부 종료 (프로필이 실제로 비었음)', chromiumCount() === 0, `프로세스 ${chromiumCount()}개`);

  const navB2 = await B.tool('browser_navigate', { url: PAGE });
  check('5. B 재시도 browser_navigate 성공', !navB2.result?.isError, text(navB2));
  check('   락 = B', lockHolder() === B.p.pid, `holder=${lockHolder()} B=${B.p.pid}`);

  const navA2 = await A.tool('browser_navigate', { url: PAGE });
  check('6. 이번엔 A 가 막힘 (역방향)', navA2.result?.isError === true, text(navA2));

  // 7. Claude 세션 종료 = stdin EOF → 래퍼 종료 + 락 해제
  const exited = new Promise((r) => B.p.on('exit', r));
  B.p.stdin.end();
  await exited;
  check('7. B stdin 종료 → 프로세스 종료 + 락 해제', lockHolder() === null);

  const navA3 = await A.tool('browser_navigate', { url: PAGE });
  check('8. A 가 이어서 획득', !navA3.result?.isError && lockHolder() === A.p.pid);

  await A.tool('browser_close');
  A.p.stdin.end();
  await new Promise((r) => A.p.on('exit', r));
}

main()
  .catch((e) => { failed++; say(`에러: ${e.stack}`); })
  .finally(() => {
    say(failed ? `\n실패 ${failed}건` : '\n전부 통과');
    const out = path.join(__dirname, '..', '.shots', 'verify-lazy-lock.log');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, log.join('\n') + '\n');
    fs.rmSync(HOME, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
  });
