#!/usr/bin/env node
// 보안 번호 단순화 해피패스 E2E(11-09 보안 번호 화면이 너무 복잡했다 — 팀원이 '보안 번호 아직 안 견줌' 을 잠긴 파일 이유로 읽음).
// 팀원 목록엔 평소 아무것도 없고 바뀐 사람(팀원·도윤)만 짧은 한 줄 → 누르면 팀원 자세히 보기가 펼친 비교로 · 지수 줄 → 자세히 보기(접힘) → '비교' → '같아요' 가 e2e_safety_verify 로 ·
// 대화 회색 줄 '번호 비교' → 같은 자세히 보기(대화 안에 큰 판 없음) · 폰 대화도 같은 칸(단추 없이 한 줄).
// node app/e2e/safety-simple/run.mjs [캡처 폴더] [--before] — --before 면 캡처만(고치기 전 판). 참모 브라우저(headless). 실패하면 종료 1
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const args = process.argv.slice(2);
const before = args.includes('--before');
const out = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(appDir, '../.shots/safety-simple', before ? 'before' : 'after'));
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'safety-e2e-'));
const PORT = 47453;
const base = `http://127.0.0.1:${PORT}/`;
try { await fetch(`${base}__state`); console.log(`FAIL ${PORT} 포트에 앞 판 하네스가 떠 있다 — lsof -nP -iTCP:${PORT} 로 끄고 다시`); process.exit(1); } catch { /* 비어 있다 */ }
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], {
  cwd: appDir, env: { ...process.env, E2E_PORT: String(PORT), E2E_CACHE: path.join(tmp, 'vite') }, stdio: 'ignore', detached: true,
});
const stopVite = () => { try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* 이미 꺼짐 */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
const calls = async () => (await (await fetch(`${base}__state`)).json()).calls;
const reset = () => fetch(`${base}__reset`);
const require = createRequire(import.meta.url);
const { launch } = require(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
for (let i = 0; i < 80; i++) { try { await fetch(`${base}__state`); break; } catch { await sleep(250); } }

const { context, release } = await launch('honor-orchestrator', { headless: true });
try {
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(`${page.url()} ${String(e)} ${String(e.stack ?? '').split('\n').slice(1, 3).join(' ')}`));
  const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });

  // ── 1. 팀원 목록 ──
  await page.setViewportSize({ width: 900, height: 820 });
  await page.goto(`${base}?view=settings`);
  const rows = page.locator('.tmp-ppl > li');
  await rows.nth(4).waitFor({ timeout: 30000 });
  await sleep(800);
  await shot('1-members');
  const rowText = async (name) => (await page.locator('.tmp-ppl > li', { hasText: name }).first().innerText()).replace(/\s+/g, ' ');
  if (!before) {
    const all = (await page.locator('.tmp-ppl').innerText()).replace(/\s+/g, ' ');
    ok('팀원 목록에 보안 번호 꼬리가 없다', !all.includes('보안 번호'), all);
    ok('안 견준 지수·확인한 민지 줄엔 아무 표시 없음', !(await rowText('지수')).includes('기기') && !(await rowText('민지')).includes('기기'));
    ok('이틀 전 바뀐 팀원 줄만 "기기가 바뀌었어요"', (await rowText('팀원')).includes('기기가 바뀌었어요'), await rowText('팀원'));
    ok('막아 둔 도윤 줄 "기기가 바뀌어 막아 뒀어요"', (await rowText('도윤')).includes('막아 뒀어요'), await rowText('도윤'));
    ok('목록 아래 큰 비교 카드 없음', !(await page.locator('.sn').count()));

    // ── 2. 팀원 줄(바뀜) → 펼친 비교 ──
    await page.locator('.tmp-ppl > li', { hasText: '팀원' }).locator('.tmp-who').click();
    await sleep(300);
    const card = page.locator('.tmp-card[role="dialog"]');
    ok('팀원 자세히 보기가 뜨고 번호가 바로 보인다', (await card.count()) === 1 && (await card.locator('.sn span').count()) === 6);
    ok('자세히 보기 안 글은 짧다(만나서나 전화로 없음)', !(await card.innerText()).includes('만나서나'));
    const box = await card.boundingBox();
    ok('카드가 화면 안', box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 900 && box.y + box.height <= 820, JSON.stringify(box));
    await shot('2-changed-detail');
    await page.keyboard.press('Escape');
    await sleep(200);
    ok('Esc 로 닫힘', !(await card.count()));

    // ── 3. 지수 줄(평소) → 접힘 → 비교 → 같아요 ──
    await reset();
    await page.locator('.tmp-ppl > li', { hasText: '지수' }).locator('.tmp-who').click();
    await sleep(300);
    ok('지수 자세히 보기는 접혀 있다(번호 안 보임)', (await card.count()) === 1 && !(await card.locator('.sn').count()));
    await shot('3-detail-folded');
    await card.getByRole('button', { name: '비교' }).click();
    await sleep(200);
    ok('비교를 누르면 번호 판', (await card.locator('.sn span').count()) === 6);
    await shot('4-detail-compare');
    await card.getByRole('button', { name: '같아요' }).click();
    await sleep(500);
    const v = (await calls()).find((c) => c.cmd === 'e2e_safety_verify');
    ok('같아요 → e2e_safety_verify(지수 계정)', v?.args?.account === 'a-m-js', JSON.stringify(v));
    ok('같아요 뒤 자세히 보기가 닫힌다', !(await card.count()));
  }

  // ── 4. 대화 회색 줄 ──
  await page.setViewportSize({ width: 900, height: 760 });
  await page.goto(`${base}?view=convo`);
  await page.locator('.tmx-pill').first().waitFor({ timeout: 30000 });
  await sleep(600);
  await shot('5-convo');
  if (!before) {
    ok('회색 줄 글 "팀원의 기기가 바뀌었어요"', (await page.locator('.tmx-pill').first().innerText()).includes('팀원의 기기가 바뀌었어요'));
    await page.locator('.tmx-pill button').first().click();
    await sleep(300);
    const card = page.locator('.tmp-card[role="dialog"]');
    ok('번호 비교 → 자세히 보기(대화 안에 판 없음)', (await card.count()) === 1 && !(await page.locator('.tmx-msgs .sn').count()) && !(await page.locator('.tmx-msgs .tmp-card').count()) && (await card.locator('.sn span').count()) === 6);
    await card.locator('.sn').click();
    await sleep(150);
    ok('카드 안 번호를 눌러도 카드가 그대로(입력칸으로 안 샘)', (await card.count()) === 1 && !(await page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA')));
    await shot('6-convo-detail');
  } else {
    await page.locator('.tmx-pill button').first().click();
    await sleep(300);
    await shot('6-convo-compare');
  }

  // ── 5. 폰 대화 ──
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(`${base}?view=convo&phone=1`);
  await page.locator('.tmx-pill').first().waitFor({ timeout: 30000 });
  await sleep(600);
  await page.locator('.tmx-pill button').first().click();
  await sleep(300);
  await shot('7-phone-compare');
  if (!before) {
    const card = page.locator('.tmp-card[role="dialog"]');
    const b = await card.boundingBox();
    ok('폰 — 자세히 보기가 화면 안(390)', b && b.x >= 0 && b.x + b.width <= 390 && b.y >= 0 && b.y + b.height <= 780, JSON.stringify(b));
    ok('폰 — 단추 없이 한 줄(받아들이기·같아요 없음)', !(await card.getByRole('button', { name: /같아요|받아들이기|막아/ }).count()));
  }
  ok('페이지 오류 없음', errs.length === 0, errs.join(' | '));
} finally {
  await release();
  stopVite();
}
console.log(`${failed ? 'FAIL' : 'ok'} — 캡처 ${out}`);
process.exit(failed ? 1 : 0);
