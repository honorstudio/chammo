#!/usr/bin/env node
// 붐비는 사무실 E2E(11-09 사용자 화면 — 참모 7·직원 6, 3단계 방) — 이름표 안 겹침·현황판 한 줄·방 바닥 안 가림·자리 수·참모 누르면 캐릭터 고르기·안 정한 참모 점.
// node app/e2e/office-v2/crowd.mjs [캡처 폴더] — 참모 브라우저(헤드리스)로 돌아 화면에 안 뜬다. 실패하면 종료 1
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(appDir, '../.shots/office-chars'));
fs.mkdirSync(out, { recursive: true });
const PORT = 47438;
const base = `http://127.0.0.1:${PORT}/e2e/office-v2/crowd.html`;
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'office-crowd-e2e-'));
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], { cwd: appDir, env: { ...process.env, CACHE_DIR: cache, PORT: String(PORT) }, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };

const require = createRequire(import.meta.url);
const { launch } = require(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch { /* 아직 */ } await sleep(250); }
const { context, release } = await launch('office-crowd-e2e', { headless: true });
const page = await context.newPage();
page.setDefaultTimeout(8000);
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

/** 화면 상자끼리 겹치는 쌍 */
const tagOverlaps = () => page.evaluate(() => {
  const r = [...document.querySelectorAll('.office-tag')].map((e) => ({ t: e.textContent, b: e.getBoundingClientRect() }));
  const bad = [];
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
    const a = r[i].b, b = r[j].b;
    if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) bad.push(`${r[i].t} / ${r[j].t}`);
  }
  return bad;
});

try {
  await page.setViewportSize({ width: 1300, height: 960 });
  await page.goto(base, { waitUntil: 'load', timeout: 90000 });
  await page.waitForSelector('.office-cv');
  await sleep(1200);
  const bad = await tagOverlaps();
  ok('이름표끼리 안 겹친다', bad.length === 0, bad.join(', '));
  const tags = await page.locator('.office-tag').allInnerTexts();
  const folded = tags.reduce((n, t) => n + Number(/\+(\d+)$/.exec(t)?.[1] ?? 0), 0);
  ok('빠진 사람 없음(이름표 + 접힌 수 = 13)', tags.length + folded === 13, `${tags.length} + ${folded}`);
  const tops = await page.locator('.dock-card').evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))]);
  ok('현황판은 한 줄', tops.length === 1, `줄 ${tops.length}`);
  ok('넘치면 +N 단추', /^\+\d+$/.test((await page.locator('.dock-more').innerText()).trim()));
  const gap = await page.evaluate(() => document.querySelector('.office-dock').getBoundingClientRect().top - document.querySelector('.office-cv').getBoundingClientRect().bottom);
  ok('현황판이 방을 안 가린다', gap >= -2, `방 아래 끝과 현황판 사이 ${Math.round(gap)}px`);
  const over = await page.evaluate(() => document.querySelector('.office-dock').getBoundingClientRect().bottom - document.querySelector('.ra-dock').getBoundingClientRect().top);
  ok('현황판이 아래 사무실 세 칸과 안 겹친다', over <= 0, `${Math.round(over)}px`);
  ok('자리 수 = 직원 자리 쓰는 사람(10/12)', (await page.locator('.ra-th.on .ln').innerText()).trim() === '10/12');
  await page.screenshot({ path: path.join(out, 'after-crowd.png') });

  await page.locator('.dock-more').click();
  await sleep(250);
  ok('+N 을 누르면 다 펼친다', (await page.locator('.dock-card').count()) === 12);
  await page.screenshot({ path: path.join(out, 'after-dock-open.png') });
  await page.locator('.dock-more').click();

  // 참모 이름표를 누르면 그 참모 캐릭터 고르기
  await page.locator('.office-tag', { hasText: '회계 담당' }).first().click();
  await page.waitForSelector('.pick');
  ok('참모 이름표 → 그 참모로 캐릭터 고르기', (await page.locator('.pb-row.on').innerText()).includes('회계 담당'));
  await sleep(500); // 창이 열리는 움직임이 끝난 뒤
  await page.screenshot({ path: path.join(out, 'after-pick.png') });
  await page.locator('.pick button[aria-label]').first().click(); // 닫기
  await sleep(200);
  ok('닫힌다', (await page.locator('.pick').count()) === 0);
  // 세션 이름표는 원래 길
  await page.locator('.office-tag', { hasText: 'todo-api' }).first().click();
  await sleep(200);
  ok('세션 이름표는 원래 길(고르기 창 안 뜸)', (await page.locator('.pick').count()) === 0 && (await page.evaluate(() => window.__opened.includes('todo-api'))));

  // 이 사무실을 연 참모가 안 정했으면 점 — 캐릭터를 누르면 그 참모로
  await page.goto(`${base}?chars=mine&me=모모-2`, { waitUntil: 'load' });
  await page.waitForSelector('.pick'); // 들어오면 한 번 묻는다(원래 길)
  await page.locator('.pick button[aria-label]').first().click();
  await sleep(600);
  ok('안 정한 참모 캐릭터에 점', (await page.locator('.office-dot').count()) === 1);
  await page.screenshot({ path: path.join(out, 'after-dot.png') });
  const d = await page.locator('.office-dot').boundingBox();
  await page.mouse.click(d.x - 10, d.y + 30); // 점 옆 캐릭터 몸통
  await page.waitForSelector('.pick');
  ok('점 단 캐릭터를 누르면 그 참모로 고르기', (await page.locator('.pb-row.on').innerText()).includes('홍보 담당'));
  await page.locator('.p-chr').first().click();
  await page.locator('.pick button[aria-label]').first().click();
  await sleep(400);
  ok('정하면 점이 사라진다', (await page.locator('.office-dot').count()) === 0);

  // ───────── 폰: 같은 길 — 지금 말하는 참모가 안 정했으면 점, 방에서 참모를 누르면 그 참모 캐릭터 칸 ─────────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base.replace('crowd.html', 'phone.html')}?undec=1&me=o2`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForSelector('.m-office-sheet'); // 들어오면 한 번 묻는다(원래 길)
  await page.locator('.m-office-sheet [aria-label="닫기"]').click();
  await sleep(600);
  ok('폰: 안 정한 지금 참모 캐릭터에 점', (await page.locator('.office-dot').count()) === 1);
  await page.screenshot({ path: path.join(out, 'after-phone-dot.png') });
  const pd = await page.locator('.office-dot').boundingBox();
  await page.mouse.click(pd.x - 4, pd.y + 10);
  await page.waitForSelector('.m-chars');
  ok('폰: 참모 캐릭터를 누르면 그 참모 캐릭터 칸', (await page.locator('.m-chars [role="tab"][aria-selected="true"]').getAttribute('aria-label')) === '디자인');
  await sleep(400);
  await page.screenshot({ path: path.join(out, 'after-phone-pick.png') });
  await page.locator('.m-office-sheet [aria-label="닫기"]').click();
  await sleep(300);
  await page.locator('.m-talk [aria-label="회사 비서에게 말하기"]').click();
  await sleep(300);
  ok('폰: 참모 줄은 말 상대 바꾸기 그대로', (await page.locator('.m-talk [aria-selected="true"]').getAttribute('aria-label')) === '회사 비서에게 말하기' && (await page.locator('.m-office-sheet').count()) === 0);
  ok('페이지 오류 없음', errs.length === 0, errs.join(' | '));
} finally {
  await context.close().catch(() => {});
  await release?.();
  vite.kill();
}
console.log(failed ? `\n${failed}개 실패` : '\n다 통과');
process.exit(failed ? 1 : 0);
