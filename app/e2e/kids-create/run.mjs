#!/usr/bin/env node
// 키즈 참모 만들기 E2E(11-17) — 설정 키즈 모드가 꺼져 있으면 새 참모 창이 지금과 같고, 켜져 있으면 '키즈 참모' 스위치(설정 줄과 같은 크기) + 켜면 아이 이름 칸,
// 만들기를 누르면 kid 가 넘어간다. 데스크톱·폰 둘 다. node app/e2e/kids-create/run.mjs [캡처 폴더] — 실패하면 종료 1
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(appDir, '../.shots/kids-wire'));
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kcr-e2e-'));
const PORT = 47495;
const base = `http://127.0.0.1:${PORT}/`;
try { await fetch(base); console.log(`FAIL ${PORT} 포트에 앞 판 하네스가 떠 있다`); process.exit(1); } catch { /* 비어 있다 */ }
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], { cwd: appDir, env: { ...process.env, E2E_PORT: String(PORT), E2E_CACHE: path.join(tmp, 'vite') }, stdio: 'ignore', detached: true });
const stopVite = () => { try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* 이미 꺼짐 */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await sleep(250); } }
const { launch } = createRequire(import.meta.url)(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
const { context, release } = await launch('kids-create-e2e', { headless: true });
try {
  const p = await context.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.stack ?? e)));
  const box = (sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  // ── 데스크톱 ──
  await p.setViewportSize({ width: 760, height: 720 });
  await p.goto(`${base}?face=desk`);
  await p.waitForSelector('.od-box', { timeout: 30_000 });
  await sleep(500);
  await p.screenshot({ path: path.join(out, 'create-desk-before.png') });
  ok('데스크톱 · 키즈 모드 꺼짐 — 스위치 없음(지금과 같다)', (await p.$$('.od-box [role=switch]')).length === 0);
  await p.goto(`${base}?face=desk&kids=1&v=1`);
  await p.waitForSelector('.od-box [role=switch]', { timeout: 30_000 });
  await sleep(400);
  await p.screenshot({ path: path.join(out, 'create-desk-after-off.png') });
  const sw = await box('.od-box [role=switch]');
  ok('데스크톱 스위치가 설정 줄 스위치 크기(40×24)', sw.w === 40 && sw.h === 24, JSON.stringify(sw));
  await p.click('.od-box [role=switch]');
  await p.fill('input[aria-label="아이 이름"]', '서아');
  await p.fill('input[aria-label="별명"]', '선생님');
  await sleep(200);
  await p.screenshot({ path: path.join(out, 'create-desk-after-on.png') });
  ok('데스크톱 아이 이름 칸 36px', (await box('input[aria-label="아이 이름"]')).h === 36);
  await p.click('.od-foot .pri');
  const made = await p.evaluate(() => window.__made);
  ok('데스크톱 만들기 — 키즈 값이 넘어간다', JSON.stringify(made) === JSON.stringify([{ nick: '선생님', role: '', kid: { child: '서아' } }]), JSON.stringify(made));
  // ── 폰 ──
  await p.setViewportSize({ width: 390, height: 760 });
  await p.goto(`${base}?face=phone&v=2`);
  await p.waitForSelector('.m-new', { timeout: 30_000 });
  await sleep(400);
  await p.screenshot({ path: path.join(out, 'create-phone-before.png') });
  ok('폰 · 키즈 모드 꺼짐 — 스위치 없음', (await p.$$('.m-new [role=switch]')).length === 0);
  await p.goto(`${base}?face=phone&kids=1&v=3`);
  await p.waitForSelector('.m-new [role=switch]', { timeout: 30_000 });
  await p.click('.m-new [role=switch]');
  await p.fill('#m-new-nick', '선생님');
  await p.fill('input[aria-label="아이 이름"]', '서아');
  await sleep(300);
  await p.screenshot({ path: path.join(out, 'create-phone-after-on.png') });
  ok('폰 스위치 줄 손가락 44px 이상', (await box('.m-new [role=switch]')).h >= 44);
  ok('폰 스위치 켜짐 표시', (await p.getAttribute('.m-new [role=switch]', 'aria-checked')) === 'true');
  await p.click('.m-new button[type=submit]');
  await sleep(200);
  const pm = await p.evaluate(() => window.__made);
  ok('폰 만들기 — 키즈 값이 넘어간다', JSON.stringify(pm) === JSON.stringify([{ nick: '선생님', role: '', kid: { child: '서아' } }]), JSON.stringify(pm));
  ok('페이지 오류 없음', errs.length === 0, errs.join(' / ').slice(0, 400));
} finally {
  await release();
  stopVite();
}
console.log(failed ? `FAIL ${failed}` : '모두 통과');
process.exit(failed ? 1 : 0);
