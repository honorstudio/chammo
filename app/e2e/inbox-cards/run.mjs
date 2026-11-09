#!/usr/bin/env node
// 결정 대기함 해피패스 E2E — 결제 카드는 바깥 클릭·Esc 로 안 닫힘, 따닥 누름이 다음 결제 카드에 안 떨어짐, 그냥 물음만 남으면 바깥 클릭으로 닫힘,
// 긴 물음은 안 잘림, 답장. 실패하면 종료 1.  node app/e2e/inbox-cards/run.mjs [캡처 폴더] — 참모 브라우저로 돈다
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(appDir, '../.shots/inbox-cards/e2e'));
fs.mkdirSync(out, { recursive: true });
const PORT = 47433;
const base = `http://127.0.0.1:${PORT}/`;
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-e2e-'));
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], { cwd: appDir, env: { ...process.env, E2E_CACHE: cache }, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };

const require = createRequire(import.meta.url);
const { launch } = require(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch { /* 아직 */ } await sleep(250); }

const { context, release } = await launch('inbox-today-shot', { headless: true });
try {
  const p = await context.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.setViewportSize({ width: 560, height: 560 });
  const answers = () => p.evaluate(() => window.__calls.filter((c) => c.cmd === 'direct_answer').map((c) => c.args));
  const shot = async (name) => { for (const scheme of ['light', 'dark']) { await p.emulateMedia({ colorScheme: scheme }); await sleep(120); await p.screenshot({ path: path.join(out, `${name}-${scheme}.png`) }); } await p.emulateMedia({ colorScheme: 'light' }); };

  await p.goto(base);
  await p.waitForSelector('.inbox-pop .dc-amount');
  ok('결제가 맨 앞', (await p.textContent('.inbox-pop .dc-amount')) === 'US$8.20');
  ok('결제 장은 옅은 빨강 말풍선', await p.evaluate(() => document.querySelector('.inbox-pop').classList.contains('pay')));
  ok('제목 막대·닫기 X 없음', (await p.locator('.inbox-pop .inbox-head, .inbox-pop .inbox-later').count()) === 0);
  ok('아래 줄 = 남은 3개', (await p.textContent('.ibx-more')).includes('3'));
  await sleep(600);
  await shot('pay');

  // 결제 카드가 있으면 바깥 클릭·Esc 로 안 닫힌다
  await p.mouse.click(60, 300);
  await sleep(200);
  ok('결제 카드 — 바깥 클릭에 안 닫힘', await p.isVisible('.inbox-pop'));
  await p.keyboard.press('Escape');
  await sleep(200);
  ok('결제 카드 — Esc 에 안 닫힘', await p.isVisible('.inbox-pop'));

  // 따닥 — 첫 누름은 p1 승인, 바로 그 자리에 온 p2 승인 단추엔 두 번째 누름이 안 먹는다
  const btn = await p.locator('.inbox-pop .dc-go.dc-pay').boundingBox();
  const cx = btn.x + btn.width / 2;
  const cy = btn.y + btn.height / 2;
  await p.mouse.click(cx, cy);
  await sleep(120);
  ok('다음 결제 카드가 같은 자리로', (await p.textContent('.inbox-pop .dc-amount')) === 'US$20.00');
  await p.mouse.click(cx, cy);
  await sleep(150);
  let a = await answers();
  ok('따닥 두 번째 누름은 다음 결제에 안 떨어짐', a.length === 1 && a[0].id === 'p1' && a[0].pick.pick === 'yes', JSON.stringify(a));
  await sleep(500);
  await p.mouse.click(cx, cy);
  await sleep(200);
  a = await answers();
  ok('잠깐 뒤 누르면 그 카드에 답이 간다(답 길 그대로)', a.length === 2 && a[1].id === 'p2', JSON.stringify(a));

  // 운영 카드가 남아 있으면 아직 안 닫힌다 → 처리함 → 그냥 물음만 남으면 바깥 클릭으로 닫힌다
  await p.waitForSelector('.ibx-card');
  ok('운영 결정 장엔 노란 표식', await p.isVisible('.ibx-card .dc-warn'));
  await p.mouse.click(60, 300);
  await sleep(200);
  ok('운영 카드 — 바깥 클릭에 안 닫힘', await p.isVisible('.inbox-pop'));
  await sleep(500);
  await p.click('.ibx-card button[aria-label="처리함"]');
  await sleep(600);
  ok('그냥 물음 장엔 표식 없음', (await p.locator('.ibx-card .dc-risk').count()) === 0);
  ok('어제 물음은 어제로', (await p.textContent('.ibx-who em')) === '어제');
  const cut = await p.evaluate(() => { const q = document.querySelector('.ibx-q'); const cs = getComputedStyle(q); return { over: q.scrollHeight > q.clientHeight + 1 || q.scrollWidth > q.clientWidth + 1, clamp: cs.webkitLineClamp, ell: cs.textOverflow, text: q.textContent }; });
  ok('긴 물음이 안 잘림', !cut.over && cut.clamp !== '2' && cut.ell !== 'ellipsis' && cut.text.endsWith('달라질 것 같아?'), JSON.stringify(cut).slice(0, 160));
  ok('종 숫자 회색(그냥 물음만)', await p.evaluate(() => document.querySelector('.bell').classList.contains('calm')));
  await shot('ask');
  await p.fill('.ibx-card .inbox-reply .inp', '꽤 믿어');
  await p.keyboard.press('Enter');
  await sleep(200);
  ok('답장이 간다', (await p.evaluate(() => window.__replies)).includes('꽤 믿어'));
  await p.mouse.click(60, 300);
  await sleep(200);
  ok('그냥 물음 — 바깥 클릭에 닫힘', !(await p.isVisible('.inbox-pop')));
  await p.click('.bell');
  await sleep(200);
  ok('종 누르면 다시 열림', await p.isVisible('.inbox-pop'));
  await p.keyboard.press('Escape');
  await sleep(200);
  ok('그냥 물음 — Esc 에 닫힘', !(await p.isVisible('.inbox-pop')));
  ok('화면 오류 없음', errs.length === 0, errs.join(' | ').slice(0, 300));
  await p.close();

  // ── 폰 알림 시트 '답 기다림' — 한 장씩, 따닥 막기는 같은 훅
  const m = await context.newPage();
  const merrs = [];
  m.on('pageerror', (e) => merrs.push(String(e)));
  await m.setViewportSize({ width: 390, height: 844 });
  await m.goto(`${base}phone.html`);
  await m.waitForSelector('.m-pg .dc-amount');
  await sleep(600);
  ok('폰 결제가 맨 앞', (await m.textContent('.m-pg .dc-amount')) === 'US$8.20');
  ok('폰 아래 줄 = 2개 더', (await m.textContent('.m-pg-more')).includes('2'));
  const navs = await m.locator('.m-pg-foot button').evaluateAll((bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
  ok('폰 넘기기 단추 44px 이상', navs.length === 2 && navs.every((n) => n >= 44), JSON.stringify(navs));
  for (const scheme of ['light', 'dark']) { await m.emulateMedia({ colorScheme: scheme }); await sleep(120); await m.screenshot({ path: path.join(out, `phone-pay-${scheme}.png`) }); }
  await m.emulateMedia({ colorScheme: 'light' });
  const mb = await m.locator('.m-pg .dc-go.dc-pay').boundingBox();
  const mx = mb.x + mb.width / 2;
  const my = mb.y + mb.height / 2;
  await m.mouse.click(mx, my);
  await sleep(120);
  await m.mouse.click(mx, my);
  await sleep(150);
  let ma = await m.evaluate(() => window.__calls.filter((c) => c.cmd === 'direct_answer').map((c) => c.args.id));
  ok('폰 따닥 두 번째 누름은 다음 결제에 안 떨어짐', ma.join() === 'p1', ma.join());
  await sleep(500);
  await m.locator('.m-pg-foot button').last().click();
  await sleep(300);
  ok('폰 다음으로 넘기면 기다림 카드', (await m.locator('.m-pg').textContent()).includes('얼마나 믿어'));
  for (const scheme of ['light', 'dark']) { await m.emulateMedia({ colorScheme: scheme }); await sleep(120); await m.screenshot({ path: path.join(out, `phone-ask-${scheme}.png`) }); }
  ok('폰 화면 오류 없음', merrs.length === 0, merrs.join(' | ').slice(0, 300));
  await m.close();
} catch (e) {
  failed++;
  console.log('FAIL 멈춤', e);
} finally {
  await release();
  vite.kill();
  fs.rmSync(cache, { recursive: true, force: true });
}
console.log(failed ? `실패 ${failed}` : '전부 통과');
process.exit(failed ? 1 : 0);
