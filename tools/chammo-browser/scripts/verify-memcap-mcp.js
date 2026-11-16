// 메모리 상한 — 세션 브라우저 도구(MCP 래퍼) 길 검증. 임시 CHAMMO_HOME·헤드리스, 상한 1GB.
//   먹는 페이지로 이동 → 래퍼 감시가 그 탭을 닫고 기록 → 다음 도구 결과에 '[참모 브라우저] …' 꼬리 한 줄
//   node scripts/verify-memcap-mcp.js
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createLineSplitter } = require('../src/relay');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-memcap-mcp-'));
const PROFILE = 'memcap-mcp';
const EVENTS = path.join(HOME, 'browser', 'run', 'memcap.jsonl');
fs.mkdirSync(path.join(HOME, 'tools', 'chammo-browser'), { recursive: true });
fs.writeFileSync(path.join(HOME, 'tools', 'chammo-browser', 'memcap.json'), JSON.stringify({ profileGb: 1, totalGb: 2 }));
let failed = 0;
const check = (label, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const events = () => { try { return fs.readFileSync(EVENTS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  if (req.url.startsWith('/eat')) return res.end('<title>0</title><script>const k=[];let mb=0;setInterval(()=>{if(mb>=3000)return;const b=new Uint8Array(64<<20);for(let i=0;i<b.length;i+=4096)b[i]=1;k.push(b);mb+=64;document.title=mb},150)</script>');
  res.end('<title>idle</title>idle');
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'chammo-browser-mcp.js'), PROFILE, '--headless'], {
    env: { ...process.env, CHAMMO_HOME: HOME, CHAMMO_BROWSER_HOME: path.join(HOME, 'browser') },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const waiters = new Map();
  let id = 1;
  p.stdout.on('data', createLineSplitter((line) => { const m = JSON.parse(line); if (waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } }));
  const errs = [];
  p.stderr.on('data', (d) => errs.push(d.toString()));
  const request = (method, params) => new Promise((resolve, reject) => {
    const n = id++;
    const t = setTimeout(() => reject(new Error(`${method} 응답 없음`)), 90_000);
    waiters.set(n, (m) => { clearTimeout(t); resolve(m); });
    p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`);
  });
  const text = (r) => ((r.result && r.result.content) || []).map((c) => c.text).join(' ');
  try {
    await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'verify', version: '0' } });
    p.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    await request('tools/call', { name: 'browser_navigate', arguments: { url: `${base}/eat` } });
    let ev = null;
    for (let t = 0; t < 60 && !ev; t++) { ev = events().find((e) => e.action === 'trim'); if (!ev) await sleep(1000); }
    check('래퍼 감시가 상한을 넘은 탭을 잘랐다', !!ev, ev ? `${(ev.bytes / 2 ** 30).toFixed(2)}GB · ${ev.tabs.join(', ')}` : '60초 안에 기록 없음');
    check('기록에 세션 pid(래퍼를 띄운 claude 세션 — 없으면 0)', !!ev && Number.isInteger(ev.sessionPid), ev && String(ev.sessionPid));
    const r = await request('tools/call', { name: 'browser_navigate', arguments: { url: `${base}/idle` } });
    check('다음 도구 결과에 꼬리 한 줄', /\[참모 브라우저\] 'memcap-mcp'/.test(text(r)), text(r).split('\n').find((l) => l.includes('참모 브라우저')) || text(r).slice(0, 200));
    const r2 = await request('tools/call', { name: 'browser_snapshot', arguments: {} });
    check('꼬리는 한 번만', !/\[참모 브라우저\]/.test(text(r2)));
    // 3분 안에 또 넘음 → 그 크롬만 끈다 → 다음 도구 부름에 크롬이 다시 뜬다(멈춤 대신 낮추기)
    await request('tools/call', { name: 'browser_navigate', arguments: { url: `${base}/eat` } }).catch(() => {});
    let kill = null;
    for (let t = 0; t < 60 && !kill; t++) { kill = events().find((e) => e.action === 'kill'); if (!kill) await sleep(1000); }
    check('또 넘자 그 크롬을 껐다', !!kill, kill ? `${(kill.bytes / 2 ** 30).toFixed(2)}GB` : '60초 안에 기록 없음');
    await sleep(3000);
    const r3 = await request('tools/call', { name: 'browser_navigate', arguments: { url: `${base}/idle` } });
    const t3 = text(r3);
    check('끈 뒤 다음 도구 부름에 크롬이 다시 떠 페이지가 열린다', /idle/.test(t3) && !(r3.result && r3.result.isError), t3.slice(0, 160).replace(/\n/g, ' '));
    check('끈 줄도 꼬리로', /크롬을 껐어/.test(t3));
  } catch (e) {
    failed++;
    console.log(`FAIL  예외 — ${e.message}`);
    console.log(errs.join('').slice(-1500));
  } finally {
    p.kill('SIGTERM');
    server.close();
    await sleep(1500);
    try { execFileSync('/usr/bin/pkill', ['-f', `user-data-dir=${path.join(HOME, 'browser', 'profiles', PROFILE)}`]); } catch { /* 없음 */ }
    console.log(failed ? `실패 ${failed}개` : '모두 통과');
    process.exit(failed ? 1 : 0);
  }
})();
