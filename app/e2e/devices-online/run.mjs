// node app/e2e/devices-online/run.mjs [캡처 폴더] — 기기 관리 붙음 판정(11-18 사용자 '다 꺼짐'). 참모 브라우저(창 없음)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(appDir, '../.shots/onboard-fix/5-online'));
fs.mkdirSync(out, { recursive: true });
const PORT = 47541;
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'devices-online-'));
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], { cwd: appDir, env: { ...process.env, E2E_PORT: String(PORT), E2E_CACHE: cache }, stdio: 'ignore', detached: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (n, c, x = '') => { if (!c) failed++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? ` — ${x}` : ''}`); };
const base = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 120; i++) { try { if ((await fetch(base)).ok) break; } catch { /* 아직 */ } await sleep(250); }
const { launch } = createRequire(import.meta.url)(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
const { context, release } = await launch('devices-online-e2e', { headless: true });
try {
  const meta = async (p, name) => p.locator('.dev-row', { hasText: name }).first().textContent();
  for (const mode of ['live', 'none']) {
    const p = await context.newPage();
    await p.setViewportSize({ width: 720, height: 900 });
    await p.goto(`${base}?live=${mode}`);
    await p.waitForSelector('.dev-row', { timeout: 15000 });
    await sleep(600);
    await p.screenshot({ path: path.join(out, `after-${mode}.png`), fullPage: true });
    const imac = await meta(p, 'iMac'), win = await meta(p, 'DESKTOP'), ip = await meta(p, 'iPhone'), gal = await meta(p, 'Galaxy');
    ok(`${mode}: 켜진 아이맥(마지막 33분 전) 붙음`, imac.includes('붙음'), imac);
    ok(`${mode}: 윈도우(53분 전) 붙음`, win.includes('붙음'), win);
    ok(`${mode}: 아이폰(37분 전) 붙음`, ip.includes('붙음'), ip);
    ok(`${mode}: 30시간 전 갤럭시는 꺼짐`, gal.includes('꺼짐'), gal);
    if (mode === 'live') { const mbp = await meta(p, 'MacBookPro'); ok('live: 허브가 없다는 맥북프로는 마지막 12분 전이어도 꺼짐', mbp.includes('꺼짐'), mbp); }
    await p.close();
  }
} finally { await release(); try { process.kill(-vite.pid); } catch { /* 이미 */ } }
console.log(failed ? `실패 ${failed}개` : '다 통과');
process.exit(failed ? 1 : 0);
