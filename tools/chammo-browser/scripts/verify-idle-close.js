// 유휴 자동 닫기 실전 검증 + 닫았다 다시 떠도 로그인(쿠키·localStorage)이 유지되는지 확인.
// 임시 CHAMMO_BROWSER_HOME 과 로컬 http 서버를 쓰므로 실제 프로필은 건드리지 않는다.
//   node scripts/verify-idle-close.js   (결과 로그: .shots/verify-idle-close.log)
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createLineSplitter } = require('../src/relay');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-idle-verify-'));
const PROFILE = 'verify-idle';
const IDLE_MIN = 0.05; // 3초
const WRAPPER = path.join(__dirname, '..', 'bin', 'chammo-browser-mcp.js');
const LOCK = path.join(HOME, 'locks', `${PROFILE}.lock`);

const log = [];
function say(s) { console.log(s); log.push(s); }
let failed = 0;
function check(label, cond, detail = '') {
  if (!cond) failed++;
  say(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lockHolder = () => (fs.existsSync(LOCK) ? JSON.parse(fs.readFileSync(LOCK, 'utf8')).pid : null);
const chromiumCount = () => {
  try {
    return Number(execSync(`pgrep -f "user-data-dir=${path.join(HOME, 'profiles', PROFILE)}" | wc -l`).toString().trim());
  } catch { return 0; }
};
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(200); }
  return fn();
}

// 로그인 흉내: 영구 쿠키(Max-Age) + 세션 쿠키 + localStorage
const server = http.createServer((req, res) => {
  if (req.url === '/login') {
    res.setHeader('Set-Cookie', ['auth=persist-123; Max-Age=86400; Path=/', 'sess=session-456; Path=/']);
    res.end('<script>localStorage.setItem("demo", "ls-789")</script>logged in');
    return;
  }
  res.end('<title>home</title>home');
});

function startWrapper() {
  const p = spawn(process.execPath, [WRAPPER, PROFILE, '--headless'], {
    env: { ...process.env, CHAMMO_BROWSER_HOME: HOME, CHAMMO_BROWSER_IDLE_MINUTES: String(IDLE_MIN) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const waiters = new Map();
  const seenIds = [];
  let nextId = 1;
  p.stdout.on('data', createLineSplitter((line) => {
    const msg = JSON.parse(line);
    seenIds.push(msg.id);
    if (msg.id != null && waiters.has(msg.id)) { waiters.get(msg.id)(msg); waiters.delete(msg.id); }
  }));
  p.stderr.on('data', (d) => log.push(`[stderr] ${d.toString().trim()}`));
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const t = setTimeout(() => reject(new Error(`${method} 응답 없음`)), 60000);
    waiters.set(id, (m) => { clearTimeout(t); resolve(m); });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const tool = (name, args = {}) => request('tools/call', { name, arguments: args });
  return { p, request, tool, seenIds };
}
const text = (res) => (res.result?.content || []).map((c) => c.text).join(' ');

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  say(`임시 홈: ${HOME} · 유휴 ${IDLE_MIN}분 · 서버 ${base}`);

  const w = startWrapper();
  await w.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'verify', version: '0' } });
  w.p.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');

  await w.tool('browser_navigate', { url: `${base}/login` });
  const before = await w.tool('browser_evaluate', { function: '() => document.cookie + " | " + localStorage.getItem("demo")' });
  check('1. 로그인 흉내: 쿠키·localStorage 심음', /auth=persist-123/.test(text(before)) && /ls-789/.test(text(before)), text(before).match(/"[^"]*\|[^"]*"/)?.[0]);
  check('   락 보유 + 크로미움 떠 있음', lockHolder() === w.p.pid && chromiumCount() > 0);

  // 2. 유휴 시간보다 긴 호출 중에는 닫지 않는다
  await w.tool('browser_evaluate', { function: '() => new Promise(r => setTimeout(() => r("slow"), 5000))' });
  check('2. 유휴 시간(3초)보다 긴 호출(5초) 직후에도 락·브라우저 유지', lockHolder() === w.p.pid && chromiumCount() > 0);

  // 3. 방치 → 자동 닫기
  const closed = await waitFor(() => lockHolder() === null && chromiumCount() === 0, 15000);
  check('3. 방치하면 자동으로 브라우저 닫고 락 해제', closed, `락=${lockHolder()} 크로미움=${chromiumCount()}`);
  check('   내부 browser_close 응답은 Claude 로 안 흘렀다', !w.seenIds.some((id) => String(id).startsWith('chammo-idle')));
  check('   래퍼 프로세스는 살아 있음', w.p.exitCode === null);

  // 4. 다음 호출에서 다시 락 + 브라우저, 로그인 유지 확인
  await w.tool('browser_navigate', { url: `${base}/` });
  check('4. 다음 호출에서 락 재획득 + 브라우저 재기동', lockHolder() === w.p.pid && chromiumCount() > 0);
  const after = await w.tool('browser_evaluate', { function: '() => document.cookie + " | " + localStorage.getItem("demo")' });
  const t = text(after);
  check('5. 영구 쿠키(Max-Age) 유지 — 일반적인 "로그인 유지" 쿠키', /auth=persist-123/.test(t));
  check('6. localStorage 유지', /ls-789/.test(t));
  say(`INFO  세션 쿠키(만료 없음): ${/sess=session-456/.test(t) ? '유지됨' : '사라짐 — 브라우저를 닫으면 지워지는 게 정상 동작'}`);

  await w.tool('browser_close');
  w.p.stdin.end();
  await new Promise((r) => w.p.on('exit', r));
}

main()
  .catch((e) => { failed++; say(`에러: ${e.stack}`); })
  .finally(() => {
    say(failed ? `\n실패 ${failed}건` : '\n전부 통과');
    const out = path.join(__dirname, '..', '.shots', 'verify-idle-close.log');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, log.join('\n') + '\n');
    server.close();
    fs.rmSync(HOME, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
  });
