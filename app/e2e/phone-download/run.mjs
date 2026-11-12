#!/usr/bin/env node
// 폰 받기 E2E(11-12 "공유 버튼은 있는데 다운로드 버튼이 없다") — 진짜 폰 화면(mobile.html)을 vite 로, /api 는 이 파일의 가짜 폰 서버로.
// ① 개인 파일 보기 머리 '받기' → 받기 표 주소를 내려받는다 ② 팀 보관함 길게 누르기 '받기' → 맥이 받는 동안 % → 다 되면 그 표로 내려받는다
// ③ 팀 그림 보기 머리 '공유' → 같은 길로 받아 공유 시트에 파일을 넘긴다. 지어낸 데이터만. 실패하면 종료 1.
// node app/e2e/phone-download/run.mjs [캡처 폴더] — 참모 브라우저(헤드리스)로 돌아 화면에 안 뜬다
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(appDir, '../.shots/phone-download/e2e'));
fs.mkdirSync(out, { recursive: true });
const FAKE = 47463, PORT = 47464;
const base = `http://127.0.0.1:${PORT}/mobile.html`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };

// ── 지어낸 파일 — 보여 준 문서 하나, 팀 그림 하나 ──
const fx = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-dl-e2e-'));
const DOC = path.join(fx, '회의 메모.md');
fs.writeFileSync(DOC, '# 회의 메모\n\n지어낸 문서야.\n');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
const IMG = path.join(fx, '로고.png');
fs.writeFileSync(IMG, PNG);
const T = 't-sample';
const now = Date.now();
const li = (id, name, folder, size) => ({ id, name, size, cipher: size, at: now - 3_600_000, state: 'live', kind: 'file', room: '', folder, by: 'member.b', byMember: 'm2', mine: false, why: '', deletedAt: null });
const locker = { rev: 3, usage: { used: 1e6, reserved: 0, seats: 5, limit: 50e9 }, items: [li('Z1', '묶음.zip', '', 12000), li('P1', '로고.png', '', PNG.length)], skipped: [], shared: 0, uploads: [] };
const view = { joined: true, team: '샘플팀', teamId: T, me: '시험', device: 'd1', role: 'owner', server: 'https://relay.example', deliverTo: '', members: [{ id: 'm1', name: '시험', role: 'owner', me: true }, { id: 'm2', name: 'member.b', role: 'member', me: false }], rooms: [], teams: [{ id: T, name: '샘플팀', role: 'owner', current: true }] };
const ME = 'aaaa0001';
const sessions = [{ id: ME, sessionId: '11111111-1111-4111-8111-111111111111', cwd: '/Users/me/hq', name: '참모 · 시험', state: 'done', status: 'idle', kind: 'background' }];
const polls = new Map();
const log = [];
// 팀 받기 — 두 번은 '받는 중', 세 번째에 다 됨(그림 id 는 그림 파일, 나머지는 문서 파일을 그 이름으로)
const teamDl = (id) => {
  const f = locker.items.find((x) => x.id === id);
  if (!f) return [404, 'not found'];
  const n = (polls.get(id) ?? 0) + 1;
  polls.set(id, n);
  if (n < 3) return [200, { state: 'going', done: Math.round((f.size * n) / 3), total: f.size }];
  polls.delete(id);
  return [200, { state: 'ready', url: `/api/dl?t=team-${id}`, size: f.size, name: f.name, mime: 'application/octet-stream' }];
};
function api(u, body) {
  const j = () => { try { return JSON.parse(body.toString() || '{}'); } catch { return {}; } };
  switch (u.pathname) {
    case '/api/env': return [200, { assistantName: '참모', language: 'ko', devRoot: '/Users/me/dev', extraProjects: [], hqDir: '/Users/me/hq' }];
    case '/api/sessions': return [200, `{"tag":"t1","same":false}\n${JSON.stringify(sessions)}`];
    case '/api/shows': return [200, '{"tag":"s1","same":false}\n' + JSON.stringify({ ts: new Date(now - 60_000).toISOString(), path: DOC, from: ME, cwd: '/Users/me/hq' }) + '\n'];
    case '/api/tasks': return [200, u.searchParams.has('from') ? '{"next":0,"reset":false}\n' : ''];
    case '/api/transcript': return [200, { text: '', next: 1, reset: true, start: 0 }];
    case '/api/send-status': return [200, { state: 'done' }];
    case '/api/usage': case '/api/roles': case '/api/tails': return [200, {}];
    case '/api/stopped': case '/api/routines': case '/api/browsers': case '/api/avatars': case '/api/pins': return [200, []];
    case '/api/direct': return [200, ''];
    case '/api/accounts': return [502, 'unsupported'];
    case '/api/push-key': return [404, 'no'];
    case '/api/locker': return [200, { items: [], ids: {} }];
    case '/api/file': return u.searchParams.get('path') === DOC ? [200, fs.readFileSync(DOC, 'utf8')] : [403, 'not allowed'];
    case '/api/dl-ticket': return j().path === DOC ? [200, { url: '/api/dl?t=doc', size: fs.statSync(DOC).size, name: path.basename(DOC), mime: 'text/markdown' }] : [403, 'not allowed'];
    case '/api/dl': {
      const t = u.searchParams.get('t');
      const file = t === 'doc' ? DOC : t === 'team-P1' ? IMG : t === 'team-Z1' ? DOC : null;
      if (!file) return [403, 'bad ticket'];
      return [200, fs.readFileSync(file), 'application/octet-stream', { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(t === 'team-Z1' ? '묶음.zip' : path.basename(file))}` }];
    }
    case '/api/team': return [200, { view, items: [] }];
    case '/api/team-profiles': return [200, { team: T, rev: 1, teamIcon: '', people: {} }];
    case '/api/team-posts': return [200, { team: T, rev: 1, posts: [], pinned: '', owner: true }];
    case '/api/team-home': return [200, { team: T, rev: 1, home: null }];
    case '/api/team-agents': return [200, { agents: [], seen: {} }];
    case '/api/team-locker': return [200, Number(u.searchParams.get('rev')) === locker.rev ? { same: true, uploads: [] } : locker];
    case '/api/team-file-thumb': return [415, '그림이 아니야'];
    case '/api/team-file-image': return [200, PNG, 'image/png'];
    case '/api/team-dl': return teamDl(j().id);
    case '/api/notes': return [200, []];
    default: return [404, 'not found'];
  }
}
const fake = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const b = Buffer.concat(chunks);
    log.push(`${req.method} ${u.pathname}${u.search} ${b.length < 300 ? b.toString() : ''}`);
    // 받기 표 주소는 열쇠 없이(사파리 내려받기 링크는 Bearer 를 못 싣는다) — 진짜 폰 서버와 같다
    if (u.pathname !== '/api/dl' && req.headers.authorization !== 'Bearer tok-e2e') { res.writeHead(401); res.end('no key'); return; }
    const [st, body, ctype, extra] = api(u, b);
    res.writeHead(st, { 'content-type': ctype ?? (typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json'), 'cache-control': 'no-store', ...(extra ?? {}) });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  });
}).listen(FAKE, '127.0.0.1');

// ── 폰 화면 vite(빌드 없이) — /api 는 가짜 서버로 ──
const req = createRequire(path.join(appDir, 'package.json'));
const { createServer } = await import(pathToFileURL(req.resolve('vite')).href);
const react = (await import(pathToFileURL(req.resolve('@vitejs/plugin-react')).href)).default;
const pro = path.resolve(appDir, '../pro/web');
const vite = await createServer({ configFile: false, root: appDir, plugins: [react()], cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'phone-dl-vite-')),
  resolve: { alias: { '@pro': fs.existsSync(pro) ? pro : path.resolve(appDir, 'src/pro-stub') }, dedupe: ['react', 'react-dom', '@tauri-apps/api'] },
  server: { port: PORT, strictPort: true, host: '127.0.0.1', fs: { strict: false }, proxy: { '/api': `http://127.0.0.1:${FAKE}` } }, logLevel: 'error', clearScreen: false });
await vite.listen();

const { launch } = createRequire(import.meta.url)(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
const { context, release } = await launch('phone-download-e2e', { headless: true });
try {
  const p = await context.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  // 아이폰처럼 공유 시트가 있는 척 — 넘긴 파일 이름만 적는다
  await p.addInitScript(() => {
    window.__shared = [];
    navigator.canShare = () => true;
    navigator.share = (d) => { window.__shared.push(...(d.files ?? []).map((f) => `${f.name}:${f.size}`)); return Promise.resolve(); };
  });
  const cdp = await context.newCDPSession(p);
  await cdp.send('Storage.clearDataForOrigin', { origin: `http://127.0.0.1:${PORT}`, storageTypes: 'all' });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const shot = async (name) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(data, 'base64')); };
  const got = (re) => log.some((l) => re.test(l));
  const until = async (fn, ms = 8000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) if (await fn()) return true; return false; };
  await p.goto(base);
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('chammo.token', 'tok-e2e'); });
  await p.goto(`${base}?v=${Date.now()}`);
  await p.locator('button').filter({ hasText: /^보관함$/ }).first().waitFor({ timeout: 30_000 });

  // ① 개인 — 보관함 탭의 보여 준 문서 → 머리 받기
  await p.locator('button').filter({ hasText: /^보관함$/ }).first().click();
  await p.locator('.m-lk-card, .m-lk-row').first().click();
  await p.locator('[aria-label="받기"]').last().waitFor({ timeout: 10_000 });
  ok('개인 파일 보기 머리에 받기·공유 둘', (await p.locator('[aria-label="받기"]').count()) === 1 && (await p.locator('[aria-label="공유"]').count()) === 1);
  await p.locator('[aria-label="받기"]').last().click();
  ok('개인 받기 → 받기 표로 원본을 내려받는다', await until(() => got(/^GET \/api\/dl\?t=doc/)), log.filter((l) => l.includes('/api/dl')).join(' | '));
  ok('받기는 공유 시트를 안 부른다', (await p.evaluate(() => window.__shared.length)) === 0);
  await shot('1-personal');
  await p.locator('[aria-label="닫기"]').last().click();

  // ② 팀 — 보관함 길게 누르기 → 메뉴 머리 받기 → 받는 중 % → 다 되면 내려받기
  await p.locator('[role="tab"]').filter({ hasText: /^팀\d*$/ }).last().click();
  await p.locator('[role="tab"]').filter({ hasText: '보관함' }).click();
  const row = p.locator('.tmx-lk-row').filter({ hasText: '묶음.zip' }).first();
  await row.waitFor({ timeout: 15_000 });
  const b = await row.boundingBox();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await p.mouse.down(); await sleep(800); await p.mouse.up(); await sleep(700);
  ok('팀 보관함 길게 누르기 메뉴 머리에 받기·공유', (await p.locator('.m-menu [aria-label="받기"]').count()) === 1 && (await p.locator('.m-menu [aria-label="공유"]').count()) === 1);
  await p.locator('.m-menu [aria-label="받기"]').click();
  ok('맥이 받는 동안 메뉴에 받는 중 %', await until(async () => /받는 중 \d+%/.test((await p.locator('.m-menu .m-share-st').allTextContents()).join(''))));
  await shot('2-team-going');
  ok('다 되면 그 받기 표로 내려받는다(zip — 형식 안 가림)', await until(() => got(/^GET \/api\/dl\?t=team-Z1/)));
  ok('팀 받기 길에 팀·파일 id 를 보낸다', got(/^POST \/api\/team-dl \{"team":"t-sample","id":"Z1"\}/));
  await p.keyboard.press('Escape'); await sleep(600);
  if (await p.locator('.m-menu').count()) { await p.mouse.click(195, 60); await sleep(600); }

  // ③ 팀 그림 보기 머리 — 공유 → 같은 길로 받아 공유 시트에 파일
  await p.locator('.tmx-lk-row').filter({ hasText: '로고.png' }).first().click();
  await p.locator('.m-iv [aria-label="공유"]').waitFor({ timeout: 10_000 });
  ok('팀 그림 보기 머리에 받기·공유', (await p.locator('.m-iv [aria-label="받기"]').count()) === 1);
  await p.locator('.m-iv [aria-label="공유"]').click();
  ok('팀 그림 공유 → 공유 시트에 원본 파일', await until(async () => (await p.evaluate(() => window.__shared)).includes(`로고.png:${PNG.length}`)), JSON.stringify(await p.evaluate(() => window.__shared)));
  await shot('3-team-share');
  ok('화면 오류 없음', errs.length === 0, errs.join(' | ').slice(0, 300));
} finally {
  await release();
  await vite.close();
  fake.close();
  fs.rmSync(fx, { recursive: true, force: true });
}
console.log(failed ? `FAIL ${failed}` : 'all ok');
process.exit(failed ? 1 : 0);
