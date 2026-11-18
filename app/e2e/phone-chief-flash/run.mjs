#!/usr/bin/env node
// 참모 바꾸기 시트 깜빡임 E2E(11-16 사용자 폰 "고정·프로필이 잠깐 초기 상태에서 맞춰져") — 진짜 폰 화면(mobile.html)을 vite 로, /api 는 이 파일의 가짜 폰 서버로.
// 고정·순서·프사·기기 목록 응답을 DELAY 만큼 늦추고, 시트를 연 순간부터 화면 모양(이름 순서·압정·프사 색·뼈대·기기 칩)을 그릴 때마다 적는다.
//  ① 처음 켬(기억 없음) — 틀린 기본값(고정 없는 순서·기본 색) 대신 뼈대로 시작해야 한다
//  ② 페이지를 다시 띄움(홈 화면 앱이 다시 뜬 것) — 지난번 받은 것으로 바로 맞게 그려야 한다(모양이 한 번도 안 바뀜)
// 지어낸 데이터만. 실패하면 종료 1. node app/e2e/phone-chief-flash/run.mjs [캡처 폴더] [--app <app 폴더>](전·후 비교용 — 기본은 이 저장소)
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const appAt = argv.indexOf('--app');
const appDir = appAt >= 0 ? path.resolve(argv.splice(appAt, 2)[1]) : path.resolve(here, '../..');
const out = path.resolve(argv[0] ?? path.join(here, '../../../.shots/phone-chief-flash/e2e'));
fs.mkdirSync(out, { recursive: true });
const FAKE = 47471, PORT = 47472, DELAY = Number(process.env.DELAY ?? 3000);
const base = `http://127.0.0.1:${PORT}/mobile.html`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };

// ── 지어낸 참모 넷 — 기본 순서는 참모·2·3·4, 맥에선 참모-3 고정 + 끌어 둔 순서 4·2·1, 참모-3 은 프사 색을 바꿔 둠 ──
const sid = (n) => `${n}1111111-1111-4111-8111-111111111111`;
const S = [['a1', '참모 · 참모 업데이트'], ['a2', '참모-2 · 회사 비서'], ['a3', '참모-3 · 개발 담당'], ['a4', '참모-4 · 트레이더']];
const sessions = S.map(([id, name], i) => ({ id, sessionId: sid(i + 1), cwd: '/Users/me/hq', name, state: 'done', status: 'idle', kind: 'background' }));
const PINS = [sid(3)];
const ORDER = [sid(4), sid(2), sid(1), sid(3)];
const PINK = '#d23f6b';
const AVATARS = [{ key: '참모-3', avatar: { kind: 'preset', shape: 'cloud', eyes: 'pill', color: PINK, voice: null }, v: 1 }];
const PEERS = [{ id: 'p1', name: 'DESKTOP-TEST' }];
const SLOW = new Set(['/api/pins', '/api/order', '/api/avatars', '/api/peer-devices']);
// 장면 ③ — 빈 목록 글('아직 … 없어요')이 받기 전에 먼저 뜨나: 맡긴 일 기록·팀·모드도 늦춘다
const SLOW_EMPTY = new Set(['/api/tasks', '/api/team', '/api/modes']);
let scene = 1;
const sent = []; // [경로, 받은 시각, 보낸 시각] — 장면 ③이 '글이 답보다 먼저 떴나'를 가른다
function api(u) {
  switch (u.pathname) {
    case '/api/env': return [200, { assistantName: '참모', language: 'ko', devRoot: '/Users/me/dev', extraProjects: [], hqDir: '/Users/me/hq', deviceName: 'MacBook Test' }];
    case '/api/sessions': return [200, `{"tag":"t1","same":false}\n${JSON.stringify(sessions)}`];
    case '/api/shows': return [200, '{"tag":"s1","same":false}\n'];
    case '/api/tasks': return [200, u.searchParams.has('from') ? '{"next":0,"reset":false}\n' : ''];
    case '/api/transcript': case '/api/peek': return [200, { text: '', next: 1, reset: true, start: 0 }];
    case '/api/send-status': return [200, { state: 'done' }];
    case '/api/usage': case '/api/roles': case '/api/tails': return [200, {}];
    case '/api/pins': return [200, JSON.stringify(PINS)];
    case '/api/order': return [200, JSON.stringify(ORDER)];
    case '/api/avatars': return [200, AVATARS];
    case '/api/peer-devices': return [200, PEERS];
    case '/api/stopped': case '/api/routines': case '/api/browsers': return [200, []];
    case '/api/direct': return [200, ''];
    case '/api/accounts': return [502, 'unsupported'];
    case '/api/push-key': return [404, 'no'];
    case '/api/locker': return [200, { items: [], ids: {} }];
    case '/api/notes': return [200, []];
    case '/api/modes': return [200, []];
    case '/api/team': return [200, { view: { joined: false }, items: [] }];
    default: return [404, 'not found'];
  }
}
const fake = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  req.resume();
  req.on('end', () => {
    const arrived = Date.now();
    if (req.headers.authorization !== 'Bearer tok-e2e') { res.writeHead(401); res.end('no key'); return; }
    const [st, body] = api(u);
    const send = () => {
      sent.push([u.pathname, arrived, Date.now()]);
      res.writeHead(st, { 'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json', 'cache-control': 'no-store' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    // 장면 ③은 빈 목록 쪽 셋만 늦춘다 — 늦춘 요청이 브라우저 동시 연결(6개)을 다 잡으면 화면 자체가 답 뒤에 떠서 시험이 헛돈다
    if (scene === 3 ? SLOW_EMPTY.has(u.pathname) : SLOW.has(u.pathname)) setTimeout(send, DELAY); else send();
  });
}).listen(FAKE, '127.0.0.1');

// ── 폰 화면 vite(빌드 없이) — /api 는 가짜 서버로 ──
const req = createRequire(path.join(appDir, 'package.json'));
const { createServer } = await import(pathToFileURL(req.resolve('vite')).href);
const react = (await import(pathToFileURL(req.resolve('@vitejs/plugin-react')).href)).default;
const pro = path.resolve(appDir, '../pro/web');
const vite = await createServer({ configFile: false, root: appDir, plugins: [react()], cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'phone-flash-vite-')),
  resolve: { alias: { '@pro': fs.existsSync(pro) ? pro : path.resolve(appDir, 'src/pro-stub') }, dedupe: ['react', 'react-dom', '@tauri-apps/api'] },
  server: { port: PORT, strictPort: true, host: '127.0.0.1', fs: { strict: false }, proxy: { '/api': `http://127.0.0.1:${FAKE}` } }, logLevel: 'error', clearScreen: false });
await vite.listen();

// 그릴 때마다 시트 모양 한 줄 — 이름 순서·압정·프사 색·뼈대 수·기기 칩. 바뀔 때만 적는다(t = 연 순간부터 ms)
const SAMPLER = () => {
  const frames = [];
  const t0 = performance.now();
  let last = '';
  const look = () => {
    const sheet = document.querySelector('[aria-label="참모 바꾸기"]');
    if (!sheet) return null;
    const rows = [...sheet.querySelectorAll('.m-orch:not(.m-off):not(.m-orch-skel)')].map((b) => {
      const name = b.querySelector('.m-orch-name')?.textContent ?? '';
      const pin = b.querySelector('.m-orch-pin') ? '[고정]' : '';
      const body = b.querySelector('[role="img"][style*="--oa-body"]')?.style.getPropertyValue('--oa-body') ?? '';
      return `${name}${pin}${body ? `(${body})` : ''}`;
    });
    const skel = sheet.querySelectorAll('.m-orch-skel').length;
    const chips = [...sheet.querySelectorAll('.m-far-pill:not(.m-far-skel)')].map((c) => c.textContent).join('|');
    const chipSkel = sheet.querySelectorAll('.m-far-skel').length;
    return JSON.stringify({ rows, skel, chips, chipSkel });
  };
  const tick = () => {
    const s = look();
    if (s && s !== last) { last = s; frames.push({ t: Math.round(performance.now() - t0), ...JSON.parse(s) }); }
    if (performance.now() - t0 < 6000) requestAnimationFrame(tick);
  };
  window.__frames = frames;
  requestAnimationFrame(tick);
};

// 이 프로필 크롬이 남았나 — 앞 판 찌꺼기가 있으면 시작하지 않는다(11-16 부하 123 에서 재부팅, 같은 판을 겹쳐 돌리지 않게)
const PROFILE = 'phone-chief-flash-e2e';
const { execFileSync } = await import('node:child_process');
// 크롬(그 프로필 폴더)과 지킴이(chammo-browser _hold)만 — 셸 명령 줄에 프로필 이름이 들어 있어도 안 잡히게
const chromePids = () => execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
  .filter((l) => l.includes(PROFILE) && /Chrome|chammo-browser/.test(l)).map((l) => Number(l.trim().split(/\s+/)[0])).filter((x) => x && x !== process.pid);
const left = chromePids();
if (left.length) { console.log(`FAIL 앞 판 크롬이 남아 있어 시작 안 함 — pid ${left.join(' ')}`); await vite.close(); fake.close(); process.exit(1); }
const load1 = os.loadavg()[0];
if (load1 > 50) { console.log(`FAIL 부하 ${load1.toFixed(0)} — 50 밑에서 다시`); await vite.close(); fake.close(); process.exit(1); }
const { launch } = createRequire(import.meta.url)(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
const { context, release } = await launch(PROFILE, { headless: true });
// 전체 2분 — 넘으면 크롬을 놓고 끝낸다(매달려 쌓이지 않게)
const watchdog = setTimeout(() => { console.log('FAIL 3분 넘음 — 크롬 놓고 끝냄'); void release().finally(() => process.exit(1)); }, 180_000);
const result = {};
try {
  const p = await context.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  const cdp = await context.newCDPSession(p);
  await cdp.send('Storage.clearDataForOrigin', { origin: `http://127.0.0.1:${PORT}`, storageTypes: 'all' });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const shot = async (name) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 }); fs.writeFileSync(path.join(out, `${name}.jpg`), Buffer.from(data, 'base64')); };
  await p.goto(base, { timeout: 60_000 });
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('chammo.token', 'tok-e2e'); });

  const openSheet = async (tag) => {
    await p.goto(`${base}?v=${Date.now()}`, { timeout: 60_000 });
    const btn = p.locator('[title="참모 바꾸기"]').first();
    await btn.waitFor({ timeout: 30_000 });
    await p.evaluate(SAMPLER);
    await btn.click();
    // 시각별 캡처 — 연 직후·DELAY 전·DELAY 뒤
    const t0 = Date.now();
    for (const at of [0, 300, DELAY - 300, DELAY + 600]) { await sleep(Math.max(0, at - (Date.now() - t0))); await shot(`${tag}-${String(at).padStart(4, '0')}ms`); }
    await sleep(Math.max(0, DELAY + 1500 - (Date.now() - t0)));
    const frames = await p.evaluate(() => window.__frames);
    fs.writeFileSync(path.join(out, `${tag}-frames.json`), JSON.stringify(frames, null, 1));
    return frames;
  };
  const show = (f) => `${f.t}ms ${f.skel ? `뼈대${f.skel} ` : ''}${f.rows.join(', ')}${f.chips ? ` · 칩 ${f.chips}` : ''}${f.chipSkel ? ` · 칩뼈대${f.chipSkel}` : ''}`;
  const want = (fs_) => fs_.at(-1);

  // ① 처음 켬
  const a = await openSheet('1-first');
  console.log('① 처음 켬 — 바뀐 모양:\n  ' + a.map(show).join('\n  '));
  const fin = want(a);
  ok('① 마지막 모양: 고정한 참모-3 맨 위·끌어 둔 순서·바꾼 색·기기 칩', fin && fin.rows[0]?.startsWith('개발 담당[고정]') && fin.rows[0].includes(PINK) && fin.rows.slice(1).map((r) => r.replace(/\(.*\)/, '')).join(',') === '트레이더,회사 비서,참모 업데이트' && fin.chips.includes('DESKTOP-TEST'), fin ? show(fin) : '없음');
  const wrong = a.filter((f) => f.rows.length && JSON.stringify(f.rows) !== JSON.stringify(fin.rows));
  ok('① 틀린 기본값(고정 없는 순서·기본 색)으로 그린 적 없음 — 받기 전엔 뼈대', wrong.length === 0, wrong.map(show).join(' / '));
  ok('① 받기 전 첫 그림은 뼈대', a[0] && a[0].skel > 0 && a[0].rows.length === 0, a[0] ? show(a[0]) : '없음');

  // ② 다시 띄움 — 지난번 받은 걸 기억해 바로 맞게
  const b = await openSheet('2-reload');
  console.log('② 다시 띄움 — 바뀐 모양:\n  ' + b.map(show).join('\n  '));
  ok('② 연 순간부터 마지막 모양 그대로(한 번도 안 바뀜)', b.length === 1 && JSON.stringify(b[0].rows) === JSON.stringify(fin.rows) && b[0].chips === fin.chips, b.map(show).join(' / '));
  // ③ 빈 목록 글 — 받기 전에 '없어요'가 먼저 뜨면 안 된다(받고 나서 진짜 비었으면 뜬다)
  scene = 3;
  const firstSeen = async (phrase, path_, go) => {
    // 앞 페이지(폴링 중)를 먼저 닫는다 — 그 페이지 요청의 답을 새 페이지 답으로 세지 않게, 새 페이지 요청은 받은 시각으로 가른다
    await p.goto('about:blank');
    await sleep(300);
    const from = Date.now();
    await p.goto(`${base}?v=${Date.now()}`, { timeout: 60_000 });
    await p.locator('[title="참모 바꾸기"]').first().waitFor({ timeout: 30_000 });
    await p.evaluate((ph) => {
      const t0 = performance.now();
      window.__seen = null;
      const tick = () => { if (window.__seen === null && document.body.innerText.includes(ph)) window.__seen = Date.now(); if (performance.now() - t0 < 8000) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }, phrase);
    if (go) await go();
    await sleep(DELAY + 1500);
    const at = await p.evaluate(() => window.__seen);
    const answered = sent.find(([q, got]) => q === path_ && got >= from)?.[2] ?? null;
    return { at, answered, early: at !== null && answered !== null ? answered - at : null };
  };
  const said = (r) => `글 ${r.at ? 'O' : 'X'} · 답보다 ${r.early === null ? '?' : r.early > 0 ? `${r.early}ms 먼저` : `${-r.early}ms 뒤`}`;
  const dashAt = await firstSeen('아직 시킨 일이 없어요', '/api/tasks');
  ok('③ 홈 "아직 시킨 일이 없어요"는 기록을 받은 뒤에만', dashAt.at !== null && dashAt.early !== null && dashAt.early <= 0, said(dashAt));
  const teamAt = await firstSeen('아직 팀이 없어요', '/api/team', () => p.locator('[role="tab"]').filter({ hasText: /^팀\d*$/ }).last().click());
  ok('③ 팀 "아직 팀이 없어요"는 팀을 받은 뒤에만', teamAt.at !== null && teamAt.early !== null && teamAt.early <= 0, said(teamAt));
  await shot('3-team-end');
  await p.locator('[role="tab"]').filter({ hasText: /^참모$/ }).last().click().catch(() => {});
  ok('화면 오류 없음', errs.length === 0, errs.join(' | ').slice(0, 300));
  result.first = a; result.reload = b;
} finally {
  clearTimeout(watchdog);
  await release().catch(() => {});
  await vite.close().catch(() => {});
  fake.close();
  // release 뒤엔 지킴이(chammo-browser _hold)가 크롬을 닫는다 — 몇 초 걸린다. 15초 넘게 남으면 그 pid 만 끈다
  let still = chromePids();
  for (const end = Date.now() + 15_000; still.length && Date.now() < end; still = chromePids()) await sleep(500);
  if (still.length) { console.log(`크롬이 남아 끔 — ${execFileSync('ps', ['-o', 'pid=,ppid=,comm=', '-p', still.join(',')], { encoding: 'utf8' }).trim().replace(/\s+/g, ' ')}`); for (const x of still) { try { process.kill(x, 'SIGTERM'); } catch { /* 이미 꺼짐 */ } } }
}
console.log(failed ? `FAIL ${failed}` : 'all ok');
process.exit(failed ? 1 : 0);
