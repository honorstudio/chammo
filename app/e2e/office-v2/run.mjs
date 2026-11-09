#!/usr/bin/env node
// 사무실 v2 E2E — 넘기기·넓히기·고르기·층 편집(끌기·겹침·되돌리기)·폰 평면도(칸 44px·누르기 두 번). 실패하면 종료 1.
// node app/e2e/office-v2/run.mjs [캡처 폴더] — 참모 브라우저(헤드리스)로 돌아 화면에 안 뜬다
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(appDir, '../.shots/office-v2/e2e'));
fs.mkdirSync(out, { recursive: true });
const PORT = 47437;
const base = `http://127.0.0.1:${PORT}/e2e/office-v2`;
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'office-v2-e2e-'));
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], { cwd: appDir, env: { ...process.env, CACHE_DIR: cache, PORT: String(PORT) }, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };

const require = createRequire(import.meta.url);
const { launch } = require(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/pc.html`)).ok) break; } catch { /* 아직 */ } await sleep(250); }

const { context, release } = await launch('office-v2-e2e', { headless: true });
const page = await context.newPage();
page.setDefaultTimeout(8000);
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

try {
  // ───────── PC: 넘기기·넓히기·명단 ─────────
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.goto(`${base}/pc.html?v=rooms`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForSelector('.office-cv');
  await sleep(800);
  ok('방이 그려진다', await page.evaluate(() => { const c = document.querySelector('.office-cv'); return c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data[3] > 0; }));
  ok('아래 세 칸 — 안 산 사무실은 값', (await page.locator('.ra-th').count()) === 3 && (await page.locator('.ra-th .v-price').count()) === 1);
  ok('자리 모자람 경고', /모자람/.test(await page.locator('.r-warn').innerText()));
  await page.locator('.r-warn button').click();
  ok('넓히기 카드 — 값·늘어나는 칸 수', /1,500/.test(await page.locator('.r-grow-card').innerText()));
  await page.locator('.r-grow-card .v-cta:not(.quiet)').click();
  await sleep(300);
  ok('넓히면 코인이 빠지고 경고가 사라진다', (await page.locator('.r-warn').count()) === 0 && /4,612/.test(await page.locator('.office-coin').innerText()));
  await sleep(300);
  ok('넓히면 방 그림도 커진다', await page.evaluate(() => document.querySelector('.office-cv').width === 288)); // 12×10
  await page.locator('.r-toggle').click();
  ok('출근 명단', (await page.locator('.r-row').count()) >= 10);
  await page.screenshot({ path: path.join(out, 'pc-rooms.png') });
  await page.locator('.r-toggle').click();
  await page.locator('.ra-th').nth(2).click();
  await sleep(300);
  ok('안 산 사무실로 넘기면 잠금 카드', /3번째 사무실/.test(await page.locator('.r-lock-card').innerText()));

  // ───────── PC: 캐릭터 고르기 ─────────
  await page.goto(`${base}/pc.html?v=pick`, { waitUntil: 'load' });
  await page.waitForSelector('.pick');
  ok('안 정한 참모가 있으면 고르기 창', /2명 남음/.test(await page.locator('.pick .pick-left').innerText()));
  await page.screenshot({ path: path.join(out, 'pc-pick.png') });

  // ───────── PC: 층 편집 ─────────
  await page.goto(`${base}/pc.html?v=edit&layer=floor`, { waitUntil: 'load' });
  await page.waitForSelector('.e-edit .office-cv');
  await sleep(500);
  const box = await page.locator('.e-edit .office-cv').boundingBox();
  const k = box.width / 240; // 10×8 방 논리 폭
  const at = (gx, gy) => ({ x: box.x + (108 + (gx - gy) * 12) * k, y: box.y + (50 + (gx + gy) * 6) * k });
  const drag = async (from, to) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 }); await page.mouse.move(to.x, to.y, { steps: 4 }); await sleep(150); await page.mouse.up(); await sleep(250); };
  const placed = () => page.locator('.e-card.placed').count();
  const before = await placed();
  const card = async (n) => { const b = await page.locator('.e-card').nth(n).boundingBox(); return { x: b.x + 30, y: b.y + 30 }; };
  await drag(await card(3), at(1, 5));
  ok('카드를 끌어 바닥에 놓는다', (await placed()) === before + 1);
  await drag(await card(4), at(2, 1));
  ok('바닥 장식끼리 겹치면 안내하고 안 놓인다', (await placed()) === before + 1 && /못 겹쳐/.test(await page.locator('.e-toast').innerText()));
  await page.locator('.e-top .v-ico-btn').click();
  await sleep(250);
  ok('되돌리기', (await placed()) === before);
  await page.screenshot({ path: path.join(out, 'pc-edit.png') });

  // ───────── PC: 뽑기 진열대 ─────────
  await page.goto(`${base}/pc.html?v=gacha`, { waitUntil: 'load' });
  await page.waitForSelector('.a1-row');
  ok('선반 두 줄 다섯 칸', (await page.locator('.a1-row').count()) === 2 && (await page.locator('.a1-cell').count()) === 10);
  await page.screenshot({ path: path.join(out, 'pc-gacha.png') });

  // ───────── 폰 ─────────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/phone.html?lv=1`, { waitUntil: 'load' });
  await page.waitForSelector('.m-office-dots');
  await sleep(1500);
  ok('칩이 안 줄바꿈된다', await page.evaluate(() => [...document.querySelectorAll('.m-office-chips button')].every((b) => b.getBoundingClientRect().height <= 46)));
  await page.locator('.m-grow-chip').waitFor();
  await page.getByRole('button', { name: '꾸미기' }).click();
  await page.waitForSelector('.m-plan-box canvas');
  await sleep(600);
  const cw = await page.evaluate(() => { const c = document.querySelector('.m-plan-box canvas'); return c.clientWidth / 11; });
  ok('평면도 칸이 44px 이상', cw >= 44, `${cw}px`);
  const plan = await page.locator('.m-plan-box canvas').boundingBox();
  const tap = async (x, y) => { await page.mouse.click(plan.x + cw + x * cw + cw / 2, plan.y + cw + y * cw + cw / 2); await sleep(350); };
  await page.locator('.e-card').nth(1).click();
  ok('카드를 누르면 집힌다', (await page.locator('.e-card.on').count()) === 1);
  await tap(3, 6); // 빈 바닥 — 직원 자리 묶음 아래에도 깔린다
  ok('칸을 누르면 놓인다', (await page.locator('.e-card.on').count()) === 0 && (await page.locator('.e-card.placed').count()) === 3);
  await page.locator('.e-card').nth(3).click();
  await tap(3, 6);
  ok('겹치면 안내하고 집은 채로', (await page.locator('.e-card.on').count()) === 1 && /못 겹쳐/.test(await page.locator('.e-toast').innerText()));
  await page.screenshot({ path: path.join(out, 'phone-plan.png') });
  await page.getByRole('button', { name: '되돌리기' }).click();
  await sleep(350);
  ok('되돌리기', (await page.locator('.e-card.placed').count()) === 2);
  ok('화면 오류 없음', errs.length === 0, errs.join(' / ').slice(0, 300));
} catch (e) {
  ok('시험이 끝까지 돌았다', false, String(e).slice(0, 400));
  await page.screenshot({ path: path.join(out, 'fail.png') }).catch(() => {});
} finally {
  await page.close().catch(() => {});
  await release?.();
  vite.kill();
  fs.rmSync(cache, { recursive: true, force: true });
}
console.log(failed ? `실패 ${failed}` : '다 통과');
process.exit(failed ? 1 : 0);
