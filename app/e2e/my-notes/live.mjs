#!/usr/bin/env node
// 폰 메모 실시간 재기(2026-11-08 사용자 "맥에서 고친 글이 폰에 바로") — 메모 탭을 연 채 맥에서 파일을 고치고
// 폰 카드에 새 글이 보일 때까지 ms. 쓰는 중이면 안 바뀌는지, 조용히 둔 동안 폰 길 요청이 몇 번인지도 본다.
// node app/e2e/my-notes/live.mjs [--delay 300] [--rounds 5] [--idle 30] [--expect-live]
// --expect-live: 열어 둔 채 고친 글이 받기 고리 한 바퀴(3초)+왕복 안에 안 보이면 종료 1 — 고치기 전엔 다시 열기 전까지 안 보여 실패한다
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const DELAY = Number(arg('delay', 300));
const ROUNDS = Number(arg('rounds', 5));
const IDLE = Number(arg('idle', 30));
const expectLive = process.argv.includes('--expect-live');
const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-live-'));
const notes = path.join(tmp, 'notes');
fs.mkdirSync(notes);
const names = ['note-1000.md', 'note-1001.md', 'note-1002.md'];
names.forEach((n, i) => fs.writeFileSync(path.join(notes, n), `메모 ${i + 1}\n장 볼 것\n`));
const PORT = 47435;
const base = `http://127.0.0.1:${PORT}/`;
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], {
  cwd: appDir, env: { ...process.env, E2E_NOTES: notes, E2E_PORT: String(PORT), E2E_CACHE: path.join(tmp, 'vite'), E2E_DELAY: String(DELAY) }, stdio: 'ignore',
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
for (let i = 0; i < 60; i++) { try { await fetch(`${base}__state`); break; } catch { await sleep(250); } }
for (const n of names) await fetch(`${base}api/note-meta`, { method: 'POST', body: JSON.stringify({ name: n, shown: true }) });

const require = createRequire(import.meta.url);
const { launch } = require(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
const { context, release } = await launch('honor-orchestrator', { headless: true });
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
try {
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(`${base}?phone=1&poll=1`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction((n) => document.querySelectorAll('.m-nt-ed').length === n && [...document.querySelectorAll('.m-nt-ed')].every((e) => e.value), names.length);
  await sleep(DELAY * 3 + 500);
  const top = path.join(notes, [...names].sort().reverse()[0]);
  // 맥 앱 저장 = 바꿔 끼우기(reader::write_checked — 임시 파일 → rename)
  const macSave = (f, t) => { fs.writeFileSync(`${f}.tmp`, t); fs.renameSync(`${f}.tmp`, f); };
  /** 맨 위 카드에 want 가 보일 때까지 ms(t0 부터, 최대 max) — locator 는 저절로 기다려 안 쓴다 */
  const until = (want, t0, max = 10000) => page.evaluate(async ({ want, t0, max }) => {
    while (Date.now() - t0 < max) {
      if (document.querySelector('.m-nt-ed')?.value.includes(want)) return Date.now() - t0;
      await new Promise((r) => setTimeout(r, 10));
    }
    return -1;
  }, { want, t0, max });

  // ① 열어 둔 채 맥에서 고침 — 폰 맨 위 카드에 보일 때까지(최대 10초). locator 는 저절로 기다려 안 쓴다
  const seen = [];
  for (let i = 0; i < ROUNDS; i++) {
    const want = `맥에서 고침 ${i}`;
    const t0 = Date.now();
    macSave(top, `메모 ${want}\n새 줄\n`);
    seen.push(await until(want, t0));
    await sleep(1200 + Math.floor(Math.random() * 3000)); // 받기 고리와 박자가 안 맞게
  }
  const med = median(seen);
  console.log(`열어 둔 채 고친 글 보이기: ${seen.join(', ')}ms (중앙값 ${med}, -1 = 10초 안에 안 보임)`);

  // ①' 앱이 뒤로 간 사이(받기 멈춤) 맥에서 고침 → 돌아오면(kick) 보일 때까지
  await page.evaluate(() => window.__pause());
  macSave(top, '메모 뒤에 있는 사이 고침\n');
  await sleep(5000);
  const tr = Date.now();
  await page.evaluate(() => window.__resume());
  const back = await until('뒤에 있는 사이', tr);
  console.log(`뒤로 갔다 돌아온 뒤 보이기: ${back}ms`);
  // ①'' 제자리 덮어쓰기(다른 앱이 rename 없이 바로 씀) — 폴더 도장이 안 바뀌어 못 본다(대가, 다시 열 때 받는다)
  await sleep(1000);
  const ti = Date.now();
  fs.writeFileSync(top, '메모 제자리 덮어씀\n');
  const inplace = await until('제자리 덮어씀', ti, 7000);
  console.log(`제자리 덮어쓰기 보이기: ${inplace}ms (-1 = 7초 안에 안 보임)`);
  macSave(top, '메모 원래대로\n');
  await until('원래대로', Date.now(), 7000);

  // ② 쓰는 중이면 밀려온 값으로 안 바꾼다 — 치고 있는 카드에 맥 고침
  const box = page.locator('.m-nt-ed').first();
  await box.click();
  await page.keyboard.press('End');
  await page.keyboard.type('폰타자');
  macSave(top, '메모 쓰는 중 맥 고침\n');
  await sleep(DELAY * 3 + 1500);
  const v = await box.inputValue();
  ok('쓰는 중 맥 고침이 와도 친 글이 남는다', v.includes('폰타자'), JSON.stringify(v.slice(-16)));
  ok('맥 글을 옛 글로 덮지 않는다', fs.readFileSync(top, 'utf8').includes('쓰는 중 맥 고침'), JSON.stringify(fs.readFileSync(top, 'utf8').slice(0, 20)));

  // ③ 조용히 둔 동안 폰 길 요청 수(대가)
  await page.evaluate(() => document.activeElement?.blur());
  await sleep(4000); // 앞 판 고침이 다 들어온 뒤부터 센다
  await fetch(`${base}__apireset`);
  await sleep(IDLE * 1000);
  const st = await (await fetch(`${base}__state`)).json();
  const idle = st.api;
  console.log(`조용히 ${IDLE}초: 세션 목록 ${st.sess}번(원래 도는 받기 고리)`);
  const per = (n) => Math.round((n / IDLE) * 600) / 10;
  console.log(`조용히 ${IDLE}초: 폰 길 요청 ${idle.length}번(분당 ${per(idle.length)}) — ${[...new Set(idle)].map((p) => `${p}×${idle.filter((x) => x === p).length}`).join(' ')}`);

  fs.mkdirSync(path.join(appDir, '../.shots/phone-memo-live'), { recursive: true });
  fs.writeFileSync(path.join(appDir, `../.shots/phone-memo-live/live-${Date.now()}.json`), JSON.stringify({ DELAY, seen, back, inplace, idle }, null, 2));
  // 받기 고리 3초 + 왕복(목록 1 + 카드 1) — 최대 3초 + 지연 × 3 남짓
  const max = 3000 + DELAY * 4 + 500;
  if (expectLive) ok(`열어 둔 채 고친 글이 ${max}ms 안에 보인다`, seen.every((s) => s >= 0 && s < max), `${seen.join(', ')}ms`);
  if (expectLive) ok('돌아오면 바로(왕복 3번 안팎) 보인다', back >= 0 && back < DELAY * 4 + 500, `${back}ms`);
  await page.close();
} finally {
  await release();
  vite.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `실패 ${failed}` : '다 통과');
process.exit(failed ? 1 : 0);
