// 메모리 상한 실전 검증(2026-11-16 사고) — 임시 CHAMMO_HOME·헤드리스 크롬(스크립트 길 launch)으로, 메모리를 일부러 먹는 페이지를 연다.
//   ① 프로필 상한(1GB)을 넘으면 제일 큰 탭이 닫히고 다른 탭은 산다 → ② 3분 안에 또 넘으면 그 프로필 크롬만 꺼진다(락도 돌려준다)
//   node scripts/verify-memcap.js [js|img]   (js = ArrayBuffer, img = 큰 그림 여러 장 디코딩 — store-shop 상세 사진 흉내)
// 진짜 프로필·진짜 데이터 폴더는 안 건드린다. 상한을 못 걸어도 페이지가 3GB 에서 멈춘다(맥을 지키는 바닥)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'chammo-memcap-'));
process.env.CHAMMO_HOME = HOME;
process.env.CHAMMO_BROWSER_HOME = path.join(HOME, 'browser');
const KIND = process.argv[2] === 'img' ? 'img' : 'js';
const PROFILE = `memcap-${KIND}`;
fs.mkdirSync(path.join(HOME, 'tools', 'chammo-browser'), { recursive: true });
fs.writeFileSync(path.join(HOME, 'tools', 'chammo-browser', 'memcap.json'), JSON.stringify({ profileGb: 1, totalGb: 2 }));

const { launch } = require('../src/connect');
const EVENTS = path.join(HOME, 'browser', 'run', 'memcap.jsonl');
let failed = 0;
const check = (label, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const events = () => { try { return fs.readFileSync(EVENTS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
async function waitFor(fn, ms) { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(500); } return fn(); }
const chromeMain = () => {
  const out = execFileSync('/bin/ps', ['-axo', 'pid=,args='], { encoding: 'utf8' });
  const l = out.split('\n').find((x) => x.includes(`--user-data-dir=${path.join(HOME, 'browser', 'profiles', PROFILE)}`) && !x.includes('--type='));
  return l ? Number(l.trim().split(/\s+/)[0]) : null;
};

// 먹는 페이지 — js: 64MB ArrayBuffer 를 채워 가며 쌓기 / img: 4000x4000 캔버스 그림을 비트맵으로 디코딩해 쌓기(장당 64MB). 3GB 에서 멈춤
const EAT = {
  js: `const keep=[];let mb=0;setInterval(()=>{if(mb>=3000)return;const b=new Uint8Array(64<<20);for(let i=0;i<b.length;i+=4096)b[i]=1;keep.push(b);mb+=64;document.title=mb},150);`,
  img: `const keep=[];let mb=0;const c=new OffscreenCanvas(4000,4000);const g=c.getContext('2d');
    setInterval(async()=>{if(mb>=3000)return;g.fillStyle='#'+(Math.random()*0xffffff|0).toString(16).padStart(6,'0');g.fillRect(0,0,4000,4000);
    const blob=await c.convertToBlob({type:'image/png'});keep.push(await createImageBitmap(blob));mb+=64;document.title=mb},200);`,
};
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  if (req.url.startsWith('/eat')) return res.end(`<title>0</title><script>${EAT[KIND]}</script>`);
  res.end('<title>idle</title><p>idle</p>');
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`임시 폴더 ${HOME} · 종류 ${KIND} · 상한 프로필 1GB 전체 2GB`);
  const { context, release } = await launch(PROFILE, { headless: true, view: false });
  const main = chromeMain();
  check('헤드리스 크롬이 우리 프로필 폴더로 떴다', !!main, `pid ${main}`);
  try {
    const lib = require('child_process').execFileSync('python3', ['-I', '-c', `import ctypes;f=ctypes.CDLL(None).responsibility_get_pid_responsible_for_pid;print(f(${main}))`], { encoding: 'utf8' }).trim();
    console.log(`참고: 크롬 본체 ${main} 의 책임 프로세스 = ${lib} (${execFileSync('/bin/ps', ['-o', 'comm=', '-p', lib], { encoding: 'utf8' }).trim()})`);
  } catch { /* 참고만 */ }

  const memcap = require('../src/memcap');
  const T = Date.now();
  const mon = setInterval(() => {
    const g = memcap.chromeGroups(memcap.parsePs(execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,rss=,args='], { encoding: 'utf8', maxBuffer: 1 << 25 })), path.join(HOME, 'browser', 'profiles')).get(PROFILE);
    console.log(`  · ${Math.round((Date.now() - T) / 1000)}초 ${g ? (g.bytes / 2 ** 30).toFixed(2) + 'GB' : '크롬 없음'} 기록 ${events().length}`);
  }, 5000);
  const idle = await context.newPage();
  await idle.goto(`${base}/idle`);
  const eat = await context.newPage();
  const crashed = new Promise((r) => eat.once('crash', () => r(true)));
  const t0 = Date.now();
  await eat.goto(`${base}/eat`);
  const ev1 = await waitFor(() => events().find((e) => e.action === 'trim'), 60_000);
  check('① 상한을 넘자 자르기(trim) 기록', !!ev1, ev1 ? `${(ev1.bytes / 2 ** 30).toFixed(2)}GB · ${Math.round((Date.now() - t0) / 1000)}초` : '60초 안에 없음');
  check('① 기록에 먹던 탭 주소(쿼리 없이)', !!ev1 && ev1.tabs.some((u) => u.endsWith('/eat')), ev1 && ev1.tabs.join(', '));
  check('① 먹던 탭은 죽었다', await Promise.race([crashed, sleep(5000).then(() => false)]));
  check('① 다른 탭은 산다', await idle.evaluate(() => document.title).then((t) => t === 'idle', () => false));
  check('① 크롬 본체는 그대로', chromeMain() === main);

  // ② 3분 안에 또 넘음 → 그 프로필 크롬만 끈다
  const eat2 = await context.newPage();
  await eat2.goto(`${base}/eat`).catch(() => {});
  const ev2 = await waitFor(() => events().find((e) => e.action === 'kill'), 60_000);
  check('② 또 넘자 끄기(kill) 기록', !!ev2, ev2 ? `${(ev2.bytes / 2 ** 30).toFixed(2)}GB · 탭 ${ev2.tabs.length}개` : '60초 안에 없음');
  check('② 그 프로필 크롬 본체가 꺼졌다', await waitFor(() => !chromeMain(), 15_000));
  const lockFile = path.join(HOME, 'browser', 'locks', `${PROFILE}.lock`);
  check('② 지킴이가 락을 돌려줬다', await waitFor(() => !fs.existsSync(lockFile), 10_000));
  const holdLog = fs.readFileSync(path.join(HOME, 'browser', 'run', `${PROFILE}.hold.log`), 'utf8');
  check('② 지킴이 기록에 상한 줄과 닫힘', /\[참모 브라우저\]/.test(holdLog) && /크롬이 닫힘/.test(holdLog), holdLog.trim().split('\n').slice(-2).join(' / '));
  clearInterval(mon);
  await release().catch(() => {});
})().catch((e) => { failed++; console.log(`FAIL  예외 — ${e.message.split('\n')[0]}`); }).finally(() => {
  server.close();
  const left = chromeMain();
  if (left) try { process.kill(left, 'SIGKILL'); } catch { /* 끝남 */ }
  console.log(failed ? `실패 ${failed}개` : '모두 통과');
  process.exit(failed ? 1 : 0);
});
