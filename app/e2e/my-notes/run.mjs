#!/usr/bin/env node
// 내 메모 해피패스 E2E(시안 v2) — 적기·저장·다시 열기·참모에게 안 감·보여 주기·글 통째 넣기·좁은 창 덮개·스킨·여러 장 쌓기·내리기/띄우기·휴지통
// / 폰: 카드 쓰기·덮어쓰기 막힘·목록 핀·스킨·맥 꺼짐. 실패하면 종료 1.
// node app/e2e/my-notes/run.mjs [캡처 폴더] — 참모 브라우저로 돈다. 진짜 Rust 는 cargo 시험이 잰다
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(appDir, '../.shots/memo-panel/e2e'));
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-e2e-'));
const notes = path.join(tmp, 'notes');
fs.mkdirSync(notes);
const PORT = 47433;
const base = `http://127.0.0.1:${PORT}/`;
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], {
  cwd: appDir, env: { ...process.env, E2E_NOTES: notes, E2E_PORT: String(PORT), E2E_CACHE: path.join(tmp, 'vite') }, stdio: 'ignore',
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
const state = async () => (await fetch(`${base}__state`)).json();
const noteFiles = () => fs.readdirSync(notes).filter((n) => n.endsWith('.md'));
const allText = () => noteFiles().map((n) => fs.readFileSync(path.join(notes, n), 'utf8')).join('\n');
const LINES = ['장 볼 것', '우유랑 달걀', '빵은 내일', '세제는 큰 걸로', '과일은 시장에서'];

const require = createRequire(import.meta.url);
const { launch } = require(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
for (let i = 0; i < 60; i++) { try { await fetch(`${base}__state`); break; } catch { await sleep(250); } }

const { context, release } = await launch('honor-orchestrator', { headless: true });
try {
  const page = await context.newPage();
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.reload();
  const card = (i = 0) => page.locator('.nt-stack .nt-card').nth(i);
  const ed = page.locator('.nt-stack .nt-card .bn-editor').first();
  const cards = () => page.locator('.nt-stack .nt-card').count();
  await ed.waitFor({ timeout: 30000 });
  ok('처음 열면 빈 메모가 하나 생겨 카드로 뜬다', noteFiles().length === 1 && (await cards()) === 1);

  // 적기
  await ed.click();
  for (const [i, l] of LINES.entries()) { await page.keyboard.type(l); if (i < LINES.length - 1) await page.keyboard.press('Enter'); }
  await sleep(1500);
  ok('적은 줄이 파일에 저장된다', LINES.every((l) => allText().includes(l)), allText().replace(/\n+/g, ' / '));
  await page.screenshot({ path: path.join(out, 'panel.png') });

  // 참모에게 저절로 안 간다
  let st = await state();
  ok('고쳐도 space-log 에 안 남는다', st.calls.includes('write_doc_text') && !st.calls.includes('space_log_append'));
  ok('참모 입력칸에 저절로 안 들어간다', (await page.evaluate(() => window.__shared.length + window.__pasted.length)) === 0);
  ok('보내기 단추가 없다', (await page.locator('.nt-panel .cv-send-fab, .nt-panel [class*="send-fab"]').count()) === 0);

  // 다시 켜도 그대로
  await page.reload();
  await ed.waitFor({ timeout: 30000 });
  ok('앱을 다시 켜도 그대로', (await ed.innerText()).includes(LINES[4]));

  // 보내기 아이콘 — 글 통째, 누를 때만
  await card().getByRole('button', { name: /입력칸에 넣기/ }).click();
  await sleep(300);
  const pasted = await page.evaluate(() => window.__pasted);
  ok('보내기 아이콘을 누르면 메모 글 통째가 입력칸으로', pasted.length === 1 && LINES.every((l) => pasted[0].includes(l)), JSON.stringify(pasted).slice(0, 120));

  // 보여 주기 — 누를 때만
  await card().getByRole('button', { name: '더보기' }).click();
  await page.getByRole('menuitem', { name: /보여 주기/ }).click();
  const shared = await page.evaluate(() => window.__shared);
  ok('⋯ 보여 주기를 눌렀을 때만 참조가 간다', shared.length === 1 && shared[0].endsWith('.md'), shared.join(','));
  ok('넣었다고 한 줄 알린다', await page.locator('.nt-say').isVisible());

  // 좁은 창
  ok('넓을 땐 나란히', !(await page.locator('.nt-panel').evaluate((e) => e.classList.contains('nt-over'))));
  await page.setViewportSize({ width: 640, height: 700 });
  await sleep(200);
  ok('스페이스 내용이 360 밑이면 덮개', await page.locator('.nt-panel').evaluate((e) => e.classList.contains('nt-over')));
  await page.setViewportSize({ width: 1100, height: 700 });

  // 스킨
  await card().getByRole('button', { name: '더보기' }).click();
  await page.getByRole('button', { name: '터미널' }).click();
  await sleep(400);
  st = await state();
  ok('⋯ 견본으로 스킨을 고르면 카드가 바뀌고 메타에 남는다', (await card().getAttribute('class')).includes('sk-term') && Object.values(st.meta).some((m) => m.skin === 'term'));

  // 여러 장
  await page.getByRole('button', { name: '새 메모' }).click();
  await sleep(700);
  ok('새 메모가 생겨 카드가 둘로 쌓인다', noteFiles().length === 2 && (await cards()) === 2);
  await page.getByRole('button', { name: '새 메모' }).click();
  await sleep(400);
  ok('빈 메모면 또 안 만든다', noteFiles().length === 2);
  await card(0).locator('.bn-editor').click();
  await page.keyboard.type('장 볼 것');
  await sleep(1200);
  await page.screenshot({ path: path.join(out, 'stack.png') });

  // 목록 두 칸 · 내리기 · 띄우기
  await page.locator('.nt-title').click();
  await sleep(300);
  const listText = await page.locator('.nt-list').innerText();
  ok('목록은 띄운 / 안 띄운 두 칸', listText.includes('띄운 메모') && listText.includes('안 띄운 메모') && listText.includes('장 볼 것'), listText.replace(/\n/g, ' | '));
  await page.locator('.nt-list .nt-lrow', { hasText: LINES[0] }).getByRole('button', { name: '내리기' }).click();
  await sleep(500);
  ok('내리면 패널에서 빠지고 파일은 남는다', (await cards()) === 1 && noteFiles().length === 2);
  await page.screenshot({ path: path.join(out, 'list.png') });
  await page.locator('.nt-list .nt-lrow', { hasText: LINES[0] }).getByRole('button', { name: '띄우기' }).click();
  await sleep(600);
  ok('안 띄운 칸에서 띄우면 다시 쌓인다', (await cards()) === 2);
  await page.keyboard.press('Escape');

  // 휴지통
  await page.locator('.nt-stack .nt-card', { hasText: '장 볼 것' }).getByRole('button', { name: '더보기' }).click();
  await page.getByRole('menuitem', { name: '휴지통으로' }).click();
  await sleep(600);
  st = await state();
  ok('휴지통으로 옮기면 그 카드만 빠진다', st.trash.length === 1 && noteFiles().length === 1 && (await cards()) === 1);

  // 폰
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(`${base}?phone=1`);
  const box = page.locator('.m-nt-ed').first();
  await box.waitFor({ timeout: 20000 });
  ok('폰 탭을 열면 띄운 메모가 카드로', (await box.inputValue()).includes(LINES[0]) && (await page.locator('.m-nt-card').count()) === 1);
  ok('폰 카드도 맥에서 고른 스킨', (await page.locator('.m-nt-card').first().getAttribute('class')).includes('sk-term'));
  await box.fill(`${LINES.join('\n')}\n달걀`);
  await sleep(1300);
  ok('폰에서 쓴 글이 맥 파일에', allText().includes('달걀'));
  await page.locator('.m-nt-card').first().getByRole('button', { name: '더보기' }).click();
  await page.getByRole('button', { name: '줄 노트' }).click();
  await sleep(500);
  ok('폰 ⋯ 시트에서 스킨을 바꾼다', (await page.locator('.m-nt-card').first().getAttribute('class')).includes('sk-lined'));
  ok('스킨을 바꿔도 마지막 줄이 안 잘린다', await box.evaluate((e) => e.scrollHeight <= e.clientHeight + 1));
  await page.screenshot({ path: path.join(out, 'phone.png') });
  // 목록 시트 핀
  await page.getByRole('button', { name: '메모 목록' }).click();
  await page.locator('.m-nt-list').getByRole('button', { name: '내리기' }).click();
  await sleep(500);
  ok('목록 시트 핀을 끄면 카드가 내려간다', (await page.locator('.m-nt-card').count()) === 0);
  await page.screenshot({ path: path.join(out, 'phone-list.png') });
  await page.locator('.m-nt-list').getByRole('button', { name: '띄우기' }).click();
  await sleep(600);
  await page.keyboard.press('Escape');
  ok('다시 켜면 돌아온다', (await page.locator('.m-nt-card').count()) === 1);
  // 맥에서 그새 고쳤으면 안 덮는다
  await page.reload();
  await box.waitFor({ timeout: 20000 });
  fs.writeFileSync(path.join(notes, noteFiles()[0]), '맥에서 고침\n');
  await box.fill('폰 글\n대파');
  await sleep(1300);
  ok('맥에서 고친 글을 안 덮는다', allText().includes('맥에서 고침') && !allText().includes('대파'));
  ok('덮지 않았다고 알린다', await page.locator('.m-nt-note').isVisible());
  // 맥 꺼짐
  await page.reload();
  await box.waitFor({ timeout: 20000 });
  await sleep(500);
  await fetch(`${base}__macoff?on=1`);
  await page.reload();
  await box.waitFor({ timeout: 20000 });
  ok('맥이 꺼져도 마지막 카드를 읽는다', (await box.inputValue()).includes('맥에서 고침'));
  ok('맥이 꺼지면 읽기만', await box.evaluate((e) => e.readOnly));
  await page.screenshot({ path: path.join(out, 'phone-off.png') });
  await fetch(`${base}__macoff?on=0`);
  await page.close();
} finally {
  await release();
  vite.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `실패 ${failed}` : '다 통과');
process.exit(failed ? 1 : 0);
