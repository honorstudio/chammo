#!/usr/bin/env node
// 폰 메모 탭 열기 재기(2026-11-08 사용자 "모바일에서 메모 나올 때 느림") — 가짜 중계 지연을 둔 폰 길에서
// 탭을 누르고 첫 카드 글·모든 카드 글이 보일 때까지 ms 와 폰 길 왕복 수. 맥에서 고친 뒤 다시 열기·쓰는 중 새 값·맥 꺼짐도 본다.
// node app/e2e/my-notes/bench.mjs [--delay 300] [--cards 5] [--rounds 5] [--out 캡처 폴더] [--expect-fast]
// --expect-fast: 다시 열기 첫 글 100ms 안·다시 열 때 왕복 1번(목록만)이 아니면 종료 1 — 고치기 전엔 실패한다
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const DELAY = Number(arg('delay', 300));
const CARDS = Number(arg('cards', 5));
const ROUNDS = Number(arg('rounds', 5));
const expectFast = process.argv.includes('--expect-fast');
const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const out = path.resolve(arg('out', path.join(appDir, '../.shots/phone-memo-fast')));
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-bench-'));
const notes = path.join(tmp, 'notes');
fs.mkdirSync(notes);
// 카드 5장 — 띄움은 vite 가짜 서버 메타가 들고 있어 첫 목록 뒤 note-meta 로 켠다
const names = Array.from({ length: CARDS }, (_, i) => `note-${1000 + i}.md`);
names.forEach((n, i) => fs.writeFileSync(path.join(notes, n), `메모 ${i + 1}\n${'장 볼 것 달걀 대파 두부\n'.repeat(8)}`));
const PORT = 47434;
const base = `http://127.0.0.1:${PORT}/`;
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], {
  cwd: appDir, env: { ...process.env, E2E_NOTES: notes, E2E_PORT: String(PORT), E2E_CACHE: path.join(tmp, 'vite'), E2E_DELAY: String(DELAY) }, stdio: 'ignore',
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = async () => (await fetch(`${base}__state`)).json();
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
for (let i = 0; i < 60; i++) { try { await fetch(`${base}__state`); break; } catch { await sleep(250); } }
for (const n of names) await fetch(`${base}api/note-meta`, { method: 'POST', body: JSON.stringify({ name: n, shown: true }) });

const require = createRequire(import.meta.url);
const { launch } = require(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
const { context, release } = await launch('honor-orchestrator', { headless: true });
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
const rows = [];
try {
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(`${base}?phone=1&tabs=1`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('[data-tab="notes"]').waitFor();
  await sleep(500);
  /** 메모 탭을 누르고 — 첫 카드 글(want 가 들어간)이 보일 때, 모든 카드에 글이 찰 때까지 ms. 처음 보인 첫 카드 글도 */
  const open = (want) => page.evaluate(async ({ want, cards }) => {
    const t0 = performance.now();
    document.querySelector('[data-tab="notes"]').click();
    let first = -1; let firstText = null; let any = -1; let all = -1;
    while (performance.now() - t0 < 10000) {
      const eds = [...document.querySelectorAll('.m-nt-ed')];
      const now = performance.now() - t0;
      if (any < 0 && eds.length && eds[0].value) { any = now; firstText = eds[0].value; }
      if (first < 0 && eds.length && eds[0].value.includes(want)) first = now;
      if (all < 0 && eds.length === cards && eds.every((e) => e.value)) all = now;
      if (first >= 0 && all >= 0) break;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return { first: Math.round(first), all: Math.round(all), any: Math.round(any), firstText };
  }, { want, cards: CARDS });
  const toOrch = async () => { await page.locator('[data-tab="orch"]').click(); await sleep(400); };
  const api = async () => { await sleep(DELAY * 3 + 300); return (await state()).api; };
  const reset = () => fetch(`${base}__apireset`);
  // 맨 위 카드 = 이름 큰 것부터(MemoTab 이 이름 내림차순)
  const topName = [...names].sort().reverse()[0];
  const topFile = path.join(notes, topName);

  // ① 첫 열기 — 이 페이지에서 처음
  await reset();
  const cold = await open('메모');
  const coldApi = await api();
  rows.push({ case: '첫 열기', first: cold.first, all: cold.all, api: coldApi.length, detail: coldApi.join(' ') });
  await page.screenshot({ path: path.join(out, 'open-cold.png') });

  // ② 다시 열기 × ROUNDS
  const warm = [];
  for (let i = 0; i < ROUNDS; i++) {
    await toOrch();
    await reset();
    const r = await open('메모');
    const a = await api();
    warm.push({ ...r, api: a.length, detail: a.join(' ') });
  }
  rows.push({ case: `다시 열기(중앙값 ${ROUNDS}번)`, first: median(warm.map((w) => w.first)), all: median(warm.map((w) => w.all)), api: median(warm.map((w) => w.api)), detail: warm[warm.length - 1].detail });
  // 전후 캡처 — 다시 누르고 100ms 뒤 화면(고치기 전엔 빈 탭)
  await toOrch();
  await page.locator('[data-tab="notes"]').click();
  await sleep(100);
  await page.screenshot({ path: path.join(out, 'reopen-100ms.png') });
  await sleep(DELAY * 3);

  // ③ 탭을 떠난 사이 맥에서 고침 → 다시 열기: 옛 글이 얼마나 보이나(대가)
  await toOrch();
  fs.writeFileSync(topFile, `메모 맥에서 고침\n새 줄\n`);
  await reset();
  const stale = await open('맥에서 고침');
  const staleApi = await api();
  rows.push({ case: '맥에서 고친 뒤 다시 열기', first: stale.first, all: stale.all, api: staleApi.length, detail: `처음 보인 글 ${stale.any}ms: ${JSON.stringify((stale.firstText ?? '').slice(0, 12))} · ${staleApi.join(' ')}` });
  ok('맥에서 고친 글이 결국 보인다', stale.first >= 0, `${stale.first}ms`);

  // ④ 쓰는 중 새 값 — 떠난 사이 맥에서 또 고치고, 다시 열자마자(새 값 오기 전) 적기 시작
  await toOrch();
  fs.writeFileSync(topFile, `메모 맥에서 두 번째\n`);
  await page.locator('[data-tab="notes"]').click();
  const box = page.locator('.m-nt-ed').first();
  await box.waitFor({ timeout: 5000 });
  await box.click();
  await page.keyboard.press('End');
  await page.keyboard.type('폰타자');
  await sleep(DELAY * 2 + 1500);
  const v = await box.inputValue();
  const caret = await box.evaluate((e) => [e.selectionStart, e.value.length]);
  ok('쓰는 중 새 값이 와도 친 글이 안 사라진다', v.includes('폰타자'), JSON.stringify(v.slice(-20)));
  ok('커서가 친 자리(끝)에 남는다', caret[0] === caret[1] || v.lastIndexOf('폰타자') + 3 === caret[0], JSON.stringify(caret));
  ok('맥에서 고친 글을 옛 글로 덮지 않는다', fs.readFileSync(topFile, 'utf8').includes('맥에서 두 번째'), JSON.stringify(fs.readFileSync(topFile, 'utf8').slice(0, 30)));
  ok('덮지 않았다고 그 카드에 알린다', await page.locator('.m-nt-card').first().locator('.m-nt-note').isVisible());
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.m-nt-card').first().screenshot({ path: path.join(out, 'typing-conflict.png') });

  // ⑤ 다시 열어 그대로 쓰기 — 저장이 맥에 간다(옛 base 로 거절당하지 않는다)
  await toOrch();
  await sleep(500);
  await page.locator('[data-tab="notes"]').click();
  await sleep(DELAY * 3 + 300);
  const box2 = page.locator('.m-nt-ed').nth(1);
  await box2.click();
  await page.keyboard.press('End');
  await page.keyboard.type('두부');
  await sleep(DELAY * 2 + 1500);
  const second = [...names].sort().reverse()[1];
  ok('다시 연 카드에서 쓴 글이 맥 파일에 간다', fs.readFileSync(path.join(notes, second), 'utf8').includes('두부'));
  await toOrch();
  await page.locator('[data-tab="notes"]').click();
  // locator 는 저절로 기다려서 안 쓴다 — 누른 뒤 두 화면(약 50ms) 안에 이미 있어야 한다
  const quick = await page.evaluate(async () => { for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r)); return document.querySelectorAll('.m-nt-ed')[1]?.value ?? ''; });
  ok('저장한 글이 다시 열 때 바로 보인다', quick.includes('두부'), JSON.stringify(quick.slice(-12)));

  // ⑥' 누르기만 하고 안 친 채 새 값이 오면 — 새 글로 가되 커서는 그 자리
  await toOrch();
  const third = path.join(notes, [...names].sort().reverse()[2]);
  fs.writeFileSync(third, '메모 셋 맥에서 바꿈\n');
  await page.locator('[data-tab="notes"]').click();
  const box3 = page.locator('.m-nt-ed').nth(2);
  await box3.waitFor({ timeout: 3000 });
  await box3.evaluate((e) => { e.focus(); e.setSelectionRange(3, 3); });
  await sleep(DELAY * 3 + 300);
  const [v3, c3, f3] = await box3.evaluate((e) => [e.value, e.selectionStart, document.activeElement === e]);
  ok('안 친 카드는 새 글로 바뀌고 커서는 그 자리', v3.includes('맥에서 바꿈') && c3 === 3 && f3, JSON.stringify([v3.slice(0, 12), c3, f3]));

  // ⑥ 맥 꺼짐 — 다시 열면 읽기만
  await toOrch();
  await fetch(`${base}__macoff?on=1`);
  // 맥 꺼짐을 알기 전(받기 재시도 7초 남짓)엔 기억한 카드가 쓰기 칸으로 보인다 — 그 시간을 잰다(대가)
  const offWin = await page.evaluate(async () => {
    const t0 = performance.now();
    document.querySelector('[data-tab="notes"]').click();
    let shown = -1;
    while (performance.now() - t0 < 30000) {
      const el = document.querySelector('.m-nt-ed');
      if (shown < 0 && el) shown = performance.now() - t0;
      if (el?.readOnly) return { shown: Math.round(shown), ro: Math.round(performance.now() - t0) };
      await new Promise((r) => setTimeout(r, 50));
    }
    return { shown: Math.round(shown), ro: -1 };
  });
  console.log(`맥 꺼짐 다시 열기: 카드 보임 ${offWin.shown}ms, 읽기만으로 바뀜 ${offWin.ro}ms`);
  rows.push({ case: '맥 꺼짐 다시 열기', first: offWin.shown, all: offWin.ro, api: '-', detail: `읽기만으로 바뀐 때 ${offWin.ro}ms` });
  const ro = await page.locator('.m-nt-ed').first().evaluate((e) => e.readOnly).catch(() => null);
  ok('맥이 꺼지면 읽기만(알림 + readOnly)', ro === true && (await page.locator('.m-nt-note').count()) > 0, String(ro));
  await page.screenshot({ path: path.join(out, 'mac-off.png') });
  await fetch(`${base}__macoff?on=0`);

  console.log(`\n지연 ${DELAY}ms · 카드 ${CARDS}장`);
  console.log('| 경우 | 첫 카드 글(ms) | 모든 카드 글(ms) | 폰 길 왕복 | 요청 |');
  console.log('|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.case} | ${r.first} | ${r.all} | ${r.api} | ${r.detail} |`);
  console.log('다시 열기 판별:', warm.map((w) => `${w.first}/${w.all}ms·${w.api}`).join(', '));
  fs.writeFileSync(path.join(out, `bench-${Date.now()}.json`), JSON.stringify({ DELAY, CARDS, rows, warm }, null, 2));
  if (expectFast) {
    const w = rows[1];
    ok('다시 열기 첫 글 100ms 안', w.first >= 0 && w.first < 100, `${w.first}ms`);
    ok('다시 열 때 왕복 1번(목록만)', w.api <= 1, `${w.api}`);
  }
  await page.close();
} finally {
  await release();
  vite.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `실패 ${failed}` : '다 통과');
process.exit(failed ? 1 : 0);
