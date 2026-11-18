#!/usr/bin/env node
// 길게 누르기 E2E(11-18 사용자 아이패드 "길게 누른 액션 느낌이 아니라 그냥 블록 지정") — serve.mjs 가 떠 있을 때, 헤드리스 크롬 터치 흉내로
//  ① 말풍선 길게 → 0.12초 뒤 눌린 느낌(.m-holding) → 0.45초에 '참조·복사' 메뉴, 글 고르기 없음
//  ② 짧게 톡 → 메뉴·눌린 느낌 없음  ③ 누른 채 스크롤만큼 움직이면 메뉴 없음
//  ④ 참모 바꾸기 줄(밀기 줄) 길게 → 줄이 눌렸다가 참모 메뉴  ⑤ 머리·탭·단추는 글 고르기 없음, 입력칸은 그대로
//   node app/e2e/ipad-layout/hold.mjs [캡처 폴더] [--port 47531] [--size 834x1194] — 실패하면 종료 1
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const port = Number(opt('--port', 47531));
const [W, H] = opt('--size', '834x1194').split('x').map(Number);
const out = path.resolve(argv[0] ?? '.shots/ipad-layout/hold');
fs.mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };

const { launch } = createRequire(import.meta.url)(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
const { context, release } = await launch('ipad-layout-hold', { headless: true });
try {
  const p = await context.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  const cdp = await context.newCDPSession(p);
  await cdp.send('Storage.clearDataForOrigin', { origin: base, storageTypes: 'all' });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const shot = async (name) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(data, 'base64')); };
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const center = async (sel) => p.evaluate((s) => { const all = document.querySelectorAll(s); const e = all[all.length - 1]; if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 24) }; }, sel);
  const state = () => p.evaluate(() => ({
    holding: [...document.querySelectorAll('.m-holding')].map((e) => e.className),
    menu: [...document.querySelectorAll('.m-menu .m-menu-item')].map((e) => e.textContent),
    title: document.querySelector('.m-menu .m-menu-title')?.textContent ?? '',
    sel: window.getSelection()?.toString() ?? '',
  }));
  const closeMenu = async () => { await p.keyboard.press('Escape').catch(() => {}); await p.evaluate(() => document.querySelector('.m-menu-wrap')?.parentElement && document.querySelector('.m-menu-back, .m-menu-wrap')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))); await sleep(500); };

  await p.goto(`${base}/__setup?orch=c0&v=${Date.now()}`, { timeout: 60_000 });
  await p.waitForURL(/mobile\.html/, { timeout: 30_000 });
  await p.waitForSelector('.m-app', { timeout: 30_000 });
  await sleep(3000);
  // 채팅 시트를 펴고 맨 아래 참모 말풍선
  await p.locator('.m-peek').first().click({ timeout: 5000 }).catch(() => {});
  await sleep(1500);
  const bub = await center('.m-bubble.m-ai');
  ok('참모 말풍선이 있다', !!bub);
  if (bub) {
    // ① 길게
    await touch('touchStart', bub.x, bub.y);
    await sleep(230);
    const mid = await state();
    await shot('hold-1-pressing');
    await sleep(330);
    const after = await state();
    await shot('hold-2-menu');
    await touch('touchEnd', bub.x, bub.y);
    await sleep(200);
    const up = await state();
    ok('0.23초: 눌린 느낌', mid.holding.some((c) => c.includes('m-bubble')), JSON.stringify(mid.holding));
    ok('0.23초: 아직 메뉴 없음', mid.menu.length === 0, JSON.stringify(mid.menu));
    ok('0.56초: 참조·복사 메뉴', after.menu.join(',') === '참조,복사', JSON.stringify(after.menu));
    ok('메뉴가 뜨면 눌린 느낌은 풀린다', after.holding.length === 0, JSON.stringify(after.holding));
    ok('글 고르기 없음', !after.sel && !up.sel, JSON.stringify([after.sel, up.sel]));
    ok('손을 떼도 메뉴는 그대로(항목이 바로 눌리지 않음)', up.menu.length === 2, JSON.stringify(up.menu));
    await closeMenu();
    await p.reload(); await sleep(3000);
    await p.locator('.m-peek').first().click({ timeout: 5000 }).catch(() => {});
    await sleep(1500);
    const b2 = await center('.m-bubble.m-ai');
    // ② 짧게 톡
    await touch('touchStart', b2.x, b2.y); await sleep(90); await touch('touchEnd', b2.x, b2.y); await sleep(600);
    const tap = await state();
    ok('짧게 톡: 메뉴·눌린 느낌 없음', tap.menu.length === 0 && tap.holding.length === 0, JSON.stringify(tap));
    // ③ 누른 채 움직임(스크롤)
    await touch('touchStart', b2.x, b2.y); await sleep(60);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', b2.x, b2.y - i * 6); await sleep(30); }
    await sleep(500);
    const mv = await state();
    await touch('touchEnd', b2.x, b2.y - 36); await sleep(300);
    ok('누른 채 움직이면: 메뉴 없음', mv.menu.length === 0 && mv.holding.length === 0, JSON.stringify(mv));
  }
  // ④ 참모 바꾸기 → 줄 길게
  await p.reload(); await sleep(3000);
  await p.locator('.m-corch').first().click({ timeout: 5000 });
  await sleep(1200);
  const row = await center('[data-swipe]:first-of-type .m-swipe-front[data-hold]');
  ok('참모 줄(밀기 줄)이 길게 누르기 대상', !!row);
  if (row) {
    await touch('touchStart', row.x, row.y);
    await sleep(230);
    const mid = await state();
    await shot('hold-3-row-pressing');
    await sleep(330);
    const after = await state();
    await shot('hold-4-row-menu');
    await touch('touchEnd', row.x, row.y);
    ok('참모 줄: 0.23초 눌린 느낌(줄 전체)', mid.holding.some((c) => c.includes('m-swipe')), JSON.stringify(mid.holding));
    ok('참모 줄: 0.56초 참모 메뉴', after.menu.length >= 3 && after.title.length > 0, JSON.stringify(after));
    ok('참모 줄: 글 고르기 없음', !after.sel, after.sel);
  }
  // ⑤ 글 고르기 규칙(계산값)
  const sel = await p.evaluate(() => {
    const us = (e) => (e ? getComputedStyle(e).webkitUserSelect || getComputedStyle(e).userSelect : 'missing');
    return { html: document.documentElement.classList.contains('m-chrome'), tab: us(document.querySelector('[role="tab"]')), head: us(document.querySelector('.m-dash-title')), btn: us(document.querySelector('.m-dash-row button')), input: us(document.querySelector('textarea')) };
  });
  ok('html 에 .m-chrome', sel.html);
  ok('탭·머리 이름·단추 글 고르기 없음', sel.tab === 'none' && sel.head === 'none' && sel.btn === 'none', JSON.stringify(sel));
  ok('입력칸은 글 고르기 됨', sel.input === 'text' || sel.input === 'auto', JSON.stringify(sel));
  ok('페이지 오류 없음', errs.length === 0, errs.slice(0, 3).join(' | '));
} finally {
  await release();
}
console.log(failed ? `실패 ${failed}` : '통과');
process.exit(failed ? 1 : 0);
