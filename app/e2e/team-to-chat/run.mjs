#!/usr/bin/env node
// 팀 보관함 → 팀챗 해피패스 E2E(11-09 사용자 "팀 보관함에서 팀챗으로 파일이 안 옮겨져. 회의하는데 난감했어").
// 데스크톱: 팀 보관함 줄을 팀 대화 칸에 끌어 놓기 → 첨부 칩 → Enter 로 보내기(참조, 숨은 참모에게 안 감) · 줄 '팀챗에 보내기' → 방 고르기 → 바로 보냄 ·
// ⌘ 둘 고르고 막대 단추 → DM 에 묶음 · 잠긴 파일엔 단추 없음 / 폰: 길게 누르기 → 팀챗에 보내기 → 대화 고르기 · 잠긴 파일 메뉴엔 없음.
// node app/e2e/team-to-chat/run.mjs [캡처 폴더] — 참모 브라우저(headless)로 돈다. E2E_OLD_CHATDROP=<파일> 이면 고치기 전 chatDrop 으로(전후 비교). 실패하면 종료 1
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(appDir, '../.shots/team-to-chat/e2e'));
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-e2e-'));
const PORT = 47451;
const base = `http://127.0.0.1:${PORT}/`;
// 앞 판 vite 가 포트를 쥐고 있으면 그 판(예: 고치기 전 chatDrop)을 보게 된다 — 바로 멈춘다
try { await fetch(`${base}__state`); console.log(`FAIL ${PORT} 포트에 앞 판 하네스가 떠 있다 — lsof -nP -iTCP:${PORT} 로 끄고 다시`); process.exit(1); } catch { /* 비어 있다 */ }
// 묶음째 띄우고 묶음째 끈다 — vite 자식이 남아 포트를 쥐고 있었다(11-09)
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], {
  cwd: appDir, env: { ...process.env, E2E_PORT: String(PORT), E2E_CACHE: path.join(tmp, 'vite') }, stdio: 'ignore', detached: true,
});
const stopVite = () => { try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* 이미 꺼짐 */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
const calls = async () => (await (await fetch(`${base}__state`)).json()).calls;
const reset = () => fetch(`${base}__reset`);
const says = async () => (await calls()).filter((c) => c.cmd === 'team_human_say');
const require = createRequire(import.meta.url);
const { launch } = require(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
for (let i = 0; i < 80; i++) { try { await fetch(`${base}__state`); break; } catch { await sleep(250); } }

const { context, release } = await launch('honor-orchestrator', { headless: true });
try {
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto(base);
  const row = (name) => page.locator('.tlk-rw', { has: page.locator('.tmx-lk-row', { hasText: name }) });
  await row('견적서.pdf').waitFor({ timeout: 30000 });
  await sleep(800);
  await reset();

  // ── 1. 끌어 놓기 — 팀 대화 칸 가운데에 ──
  const from = await row('견적서.pdf').locator('.tmx-lk-row').boundingBox();
  const to = await page.locator('.tmx-convo').boundingBox();
  await page.mouse.move(from.x + 60, from.y + from.height / 2);
  await page.mouse.down();
  for (let k = 1; k <= 12; k++) await page.mouse.move(from.x + 60 + ((to.x + to.width / 2 - from.x - 60) * k) / 12, from.y + from.height / 2 + ((to.y + to.height / 2 - from.y - from.height / 2) * k) / 12);
  await sleep(120);
  ok('끄는 동안 팀 대화 칸에 "붙이기" 판(숨은 참모 칸 빛 아님)', await page.locator('.tmx-dropov').isVisible() && !(await page.locator('.och-card.drop-hot').count()));
  await page.screenshot({ path: path.join(out, 'drag-over.png') });
  await page.mouse.up();
  await sleep(500);
  let cs = await calls();
  ok('놓은 파일이 숨은 내 참모에게 안 감(team_locker_give 없음)', !cs.some((c) => c.cmd === 'team_locker_give'), cs.map((c) => c.cmd).join(','));
  ok('대화 입력칸에 첨부 칩', (await page.locator('.tmx-compw').innerText()).includes('견적서.pdf'));
  ok('다시 받거나 올리지 않음(team_locker_open·team_file_attach 없음)', !cs.some((c) => /team_locker_open|team_file_attach/.test(c.cmd)));
  await page.locator('.tmx-convo textarea').last().click();
  await page.keyboard.press('Enter');
  await sleep(500);
  let ss = await says();
  ok('Enter — 그 방에 파일 참조로 보냄', ss.length === 1 && ss[0].args.room === 'r1' && ss[0].args.files?.[0]?.id === 'f-quote' && ss[0].args.files[0].team === 't-3k' && ss[0].args.files[0].room === '', JSON.stringify(ss.map((s) => s.args)));
  await page.screenshot({ path: path.join(out, 'drag-sent.png') });

  // ── 2. 줄 단추 — 팀챗에 보내기 → 방 고르기 ──
  await reset();
  ok('잠긴 파일 줄엔 팀챗 단추가 없다', (await row('잠긴 것.pdf').locator('.tlk-tsend').count()) === 0);
  await row('회의 자료.pptx').hover();
  const btn = row('회의 자료.pptx').locator('.tlk-tsend');
  ok('줄에 올리면 팀챗 단추(아이콘, 이름 "팀챗에 보내기")', await btn.isVisible() && (await btn.getAttribute('aria-label')) === '팀챗에 보내기');
  await btn.click();
  const menu = page.locator('.od-menu');
  await menu.waitFor();
  ok('메뉴 = 팀챗 먼저, 그다음 DM', (await menu.locator('button[role="menuitem"]').allInnerTexts()).join('|') === '회의방|디자인팀|비비', (await menu.locator('button').allInnerTexts()).join('|'));
  await page.screenshot({ path: path.join(out, 'row-menu.png') });
  await menu.getByRole('menuitem', { name: '디자인팀' }).click();
  await sleep(500);
  ss = await says();
  ok('고른 방에 바로 보냄(참조 하나)', ss.length === 1 && ss[0].args.room === 'r2' && ss[0].args.files.map((f) => f.id).join() === 'f-plan', JSON.stringify(ss.map((s) => s.args)));
  ok('보낸 뒤 그 대화를 연다', (await page.evaluate(() => window.__sent)).includes('room:r2'));

  // ── 3. ⌘ 둘 고르고 막대 단추 → DM 에 묶음 ──
  await reset();
  await row('견적서.pdf').locator('.tmx-lk-row').click({ modifiers: ['Meta'] });
  await row('현장 사진.png').locator('.tmx-lk-row').click({ modifiers: ['Meta'] });
  const bar = page.locator('.lk-selbar');
  await bar.waitFor();
  await bar.getByRole('button', { name: '팀챗에 보내기' }).click();
  await page.locator('.od-menu').getByRole('menuitem', { name: '비비' }).click();
  await sleep(500);
  ss = await says();
  ok('고른 둘을 한 말에 묶어 아직 안 연 DM 에(to = 사람, 방은 Rust 가 연다)', ss.length === 1 && ss[0].args.to === 'm-b' && !ss[0].args.room && ss[0].args.files.map((f) => f.id).sort().join() === 'f-photo,f-quote', JSON.stringify(ss.map((s) => s.args)));
  ok('보내면 고른 것이 풀린다', (await page.locator('.lk-selbar').count()) === 0);

  // ── 4. 폰 — 길게 누르기 → 팀챗에 보내기 ──
  await reset();
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(`${base}?phone=1`);
  const prow = (name) => page.locator('.m-team-lk .tmx-lk-row', { hasText: name });
  await prow('견적서.pdf').waitFor({ timeout: 20000 });
  const hold = async (name) => { const b = await prow(name).boundingBox(); await page.mouse.move(b.x + 40, b.y + b.height / 2); await page.mouse.down(); await sleep(650); await page.mouse.up(); await sleep(550); };
  await hold('잠긴 것.pdf');
  ok('폰 — 잠긴 파일 메뉴엔 팀챗에 보내기가 없다', (await page.locator('.m-menu-item', { hasText: '팀챗에 보내기' }).count()) === 0);
  await page.keyboard.press('Escape');
  await page.goto(`${base}?phone=1`);
  await prow('견적서.pdf').waitFor({ timeout: 20000 });
  await hold('견적서.pdf');
  const item = page.locator('.m-menu-item', { hasText: '팀챗에 보내기' });
  ok('폰 — 길게 누르기 메뉴 맨 위에 팀챗에 보내기', await item.isVisible() && (await page.locator('.m-menu-item').first().innerText()) === '팀챗에 보내기');
  await item.click();
  await page.locator('.m-menu-item', { hasText: '회의방' }).waitFor();
  await page.screenshot({ path: path.join(out, 'phone-pick.png') });
  await page.locator('.m-menu-item', { hasText: '회의방' }).click();
  await sleep(400);
  const ps = await page.evaluate(() => window.__say);
  ok('폰 — 고른 방에 파일 참조로', ps.length === 1 && ps[0].to === 'room:r1' && ps[0].files[0].id === 'f-quote' && ps[0].files[0].team === 't-3k', JSON.stringify(ps));
  ok('폰 — 보낸 뒤 그 대화를 연다', (await page.evaluate(() => window.__sent)).includes('room:r1'));
  ok('페이지 오류 없음', errs.length === 0, errs.join(' | '));
} finally {
  await release();
  stopVite();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `\n${failed}개 실패` : '\n모두 통과');
process.exit(failed ? 1 : 0);
