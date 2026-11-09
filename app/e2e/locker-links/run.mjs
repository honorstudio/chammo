#!/usr/bin/env node
// 보관함 링크 칸 해피패스 E2E(시안 locker-links v1 B, 사용자 11-06) — 데스크톱: 머리 파일 · 링크 → 넣기 · 잘못된 주소 · 빼기 → 되돌리기 · 열기(보여 준 세션 것은 그 세션 자리) ·
// ⌘ 두 개 골라 Backspace / 폰: 파일 | 링크 → 넣기 · 밀어 빼기 → 되돌리기 · 길게 누르기 메뉴 빼기. 실패하면 종료 1.
// node app/e2e/locker-links/run.mjs [캡처 폴더] — 참모 브라우저로 돈다. 진짜 Rust(대화 기록 이어 읽기·저장)는 cargo 시험이 잰다
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(appDir, '../.shots/locker-links/e2e'));
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'links-e2e-'));
const PORT = 47437;
const base = `http://127.0.0.1:${PORT}/`;
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], {
  cwd: appDir, env: { ...process.env, E2E_PORT: String(PORT), E2E_CACHE: path.join(tmp, 'vite') }, stdio: 'ignore',
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
const state = async () => (await fetch(`${base}__state`)).json();
const require = createRequire(import.meta.url);
const { launch } = require(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
for (let i = 0; i < 80; i++) { try { await fetch(`${base}__state`); break; } catch { await sleep(250); } }

const { context, release } = await launch('honor-orchestrator', { headless: true });
try {
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.setViewportSize({ width: 1000, height: 720 });
  await page.goto(base);
  // ── 데스크톱 ──
  const sw = page.locator('.lkl-switch');
  await sw.waitFor({ timeout: 30000 });
  await sleep(1000);
  ok('맨 위 머리 = 파일 · 링크(보여 준 주소까지 3)', (await sw.innerText()).replace(/\s+/g, ' ').includes('링크 3'), await sw.innerText());
  await sw.getByRole('button', { name: '링크' }).click();
  const rows = page.locator('.lkl-row');
  await page.locator('.lkl-paste input').waitFor();
  await sleep(300);
  ok('링크 칸 — 모은 둘 + 보여 준 웹 주소 하나(파일 경로는 아님)', (await rows.count()) === 3, String(await rows.count()));
  ok('이름 붙은 링크는 이름이 제목, 아래 줄은 사이트 · 누가', (await rows.filter({ hasText: 'PR #418' }).innerText()).includes('github.com · 참모-2가 알려 줌'));
  await page.screenshot({ path: path.join(out, 'desk-links.png') });

  const input = page.locator('.lkl-paste input');
  await input.fill('그냥 글');
  await input.press('Enter');
  ok('주소꼴이 아니면 안 넣고 알린다', await page.locator('.lkl-bad').isVisible() && (await state()).links.length === 2);
  await input.fill('chammo.app/download');
  await input.press('Enter');
  await sleep(600);
  let st = await state();
  ok('붙여 넣고 Enter — https:// 붙여 넣는다', st.links.some((l) => l.url === 'https://chammo.app/download' && l.how === 'hand') && (await rows.count()) === 4 && (await input.inputValue()) === '');
  ok('넣은 링크는 맨 위(최근), 내가 넣음', (await rows.first().innerText()).includes('내가 넣음'));

  const mine = rows.filter({ hasText: 'chammo.app' });
  await mine.hover();
  await mine.getByRole('button', { name: '목록에서 빼기' }).click();
  await sleep(500);
  ok('휴지통 — 목록에서 빠지고 되돌리기 줄', (await rows.count()) === 3 && await page.getByRole('button', { name: '되돌리기' }).isVisible());
  await page.screenshot({ path: path.join(out, 'desk-undo.png') });
  await page.getByRole('button', { name: '되돌리기' }).click();
  await sleep(600);
  ok('되돌리기 — 다시 보인다', (await rows.count()) === 4);

  await rows.filter({ hasText: 'PR #418' }).click();
  await rows.filter({ hasText: 'localhost:1420' }).click();
  const opened = await page.evaluate(() => window.__opened);
  ok('누르면 열기 — 스페이스 안 자리, 참모 것은 빈 문서(참모 브라우저)', JSON.stringify(opened[0]) === JSON.stringify(['https://github.com/o/r/pull/418', '', 'space']), JSON.stringify(opened));
  ok('세션이 보여 준 주소는 그 세션 폴더(그 세션 브라우저)', JSON.stringify(opened[1]) === JSON.stringify(['http://localhost:1420/', '/H/dev/onboarding/', 'space']));

  await rows.filter({ hasText: 'shop-landing' }).click({ modifiers: ['Meta'] });
  await rows.filter({ hasText: 'localhost:1420' }).click({ modifiers: ['Meta'] });
  ok('⌘ 두 개 고르면 아래 줄', (await page.locator('.lk-selcount').innerText()).includes('2개'));
  await page.screenshot({ path: path.join(out, 'desk-pick.png') });
  await page.keyboard.press('Backspace');
  await sleep(600);
  st = await state();
  ok('Backspace — 둘 다 빠진다(보여 준 주소는 show: 열쇠로)', (await rows.count()) === 2 && st.hidden.some((h) => h.startsWith('show:')) && st.hidden.includes('u2#0'), JSON.stringify(st.hidden));

  await sw.getByRole('button', { name: '파일' }).click();
  await sleep(300);
  ok('파일 칸으로 — 옛 보관함 맨 위', await page.locator('.lk-chips').isVisible() && !(await page.locator('.lkl-paste').count()));
  ok('화면 오류 없음(데스크톱)', errs.length === 0, errs.join(' | ').slice(0, 300));

  // ── 폰 ──
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}?phone=1`);
  const psw = page.locator('.m-lkl-switch');
  await psw.waitFor({ timeout: 30000 });
  await sleep(800);
  ok('폰 — 위 파일 | 링크(지금 2)', (await psw.innerText()).replace(/\s+/g, ' ').includes('링크 2'), await psw.innerText());
  await psw.getByRole('tab', { name: /링크/ }).click();
  const prows = page.locator('.m-lkl-row');
  await page.locator('.m-lkl-paste input').waitFor();
  await page.locator('.m-lkl-paste input').fill('https://example.com/a');
  await page.locator('.m-lkl-paste input').press('Enter');
  await sleep(800);
  ok('폰 — 붙여 넣고 넣기', (await prows.count()) === 3 && (await prows.first().innerText()).includes('example.com'), String(await prows.count()));
  await page.screenshot({ path: path.join(out, 'phone-links.png') });

  // 밀기 — SwipeRow 는 touch 사건을 받는다
  const swipe = async (loc, dx, holdMs = 0) => {
    const b = await loc.boundingBox();
    const x = b.x + b.width * 0.7, y = b.y + b.height / 2;
    await loc.evaluate((el, a) => {
      const t = (cx) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: a.y });
      el.dispatchEvent(new TouchEvent('touchstart', { touches: [t(a.x)], bubbles: true, cancelable: true }));
      if (a.hold) return;
      for (const k of [1, 2, 3, 4]) el.dispatchEvent(new TouchEvent('touchmove', { touches: [t(a.x + (a.dx * k) / 4)], bubbles: true, cancelable: true }));
      el.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true, cancelable: true }));
    }, { x, y, dx, hold: holdMs > 0 });
    if (holdMs) { await sleep(holdMs); await loc.evaluate((el) => el.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true }))); }
  };
  const front = page.locator('.m-lkl-list .m-swipe-front').first();
  await swipe(front, -120);
  await sleep(400);
  const del = page.locator('.m-lkl-list .m-swipe').first().getByRole('button', { name: '목록에서 빼기' });
  ok('폰 — 왼쪽으로 밀면 빼기 단추', await del.isVisible());
  await page.screenshot({ path: path.join(out, 'phone-swipe.png') });
  await del.click();
  await sleep(600);
  ok('폰 — 빼면 사라지고 되돌리기 알림', (await prows.count()) === 2 && await page.locator('.m-lk-toast').getByRole('button', { name: '되돌리기' }).isVisible());
  await page.locator('.m-lk-toast').getByRole('button', { name: '되돌리기' }).click();
  await sleep(700);
  ok('폰 — 되돌리기', (await prows.count()) === 3);

  await swipe(page.locator('.m-lkl-list .m-swipe-front').nth(1), 0, 650);
  const sheet = page.locator('.m-menu');
  await sheet.waitFor({ timeout: 3000 }).catch(() => {});
  ok('폰 — 길게 누르면 열기 · 주소 복사 · 목록에서 빼기', (await sheet.innerText()).includes('주소 복사'));
  await page.screenshot({ path: path.join(out, 'phone-hold.png') });
  await sleep(500);
  await sheet.getByRole('button', { name: '목록에서 빼기' }).click();
  await sleep(700);
  ok('폰 — 메뉴로 빼기', (await prows.count()) === 2);
  st = await state();
  ok('폰 길로 넣기·빼기가 맥에 닿았다', st.calls.includes('phone-add') && st.calls.includes('phone-hide true') && st.calls.includes('phone-hide false'));
  ok('화면 오류 없음(폰)', errs.length === 0, errs.join(' | ').slice(0, 300));
} finally {
  await release();
  vite.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `\n${failed}개 실패` : '\n전부 통과');
process.exit(failed ? 1 : 0);
