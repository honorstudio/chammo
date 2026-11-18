#!/usr/bin/env node
// 키즈 보호자 채팅 E2E(11-17) — 보호자 대화 사이에 아이 화면 대화가 시각 순으로 끼고(아이 말·답·앱 줄, 보호자 튜닝 줄은 빼고),
// 키즈 모드를 끄면 아무것도 안 낀다. node app/e2e/kids-chat/run.mjs [캡처 폴더]. 실패하면 종료 1
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(appDir, '../.shots/kids-wire'));
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-e2e-'));
const PORT = 47493;
const base = `http://127.0.0.1:${PORT}/`;
try { await fetch(base); console.log(`FAIL ${PORT} 포트에 앞 판 하네스가 떠 있다`); process.exit(1); } catch { /* 비어 있다 */ }
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], { cwd: appDir, env: { ...process.env, E2E_PORT: String(PORT), E2E_CACHE: path.join(tmp, 'vite') }, stdio: 'ignore', detached: true });
const stopVite = () => { try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* 이미 꺼짐 */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await sleep(250); } }
const { launch } = createRequire(import.meta.url)(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
const { context, release } = await launch('kids-chat-e2e', { headless: true });
try {
  const p = await context.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.stack ?? e)));
  await p.setViewportSize({ width: 560, height: 820 });
  const order = () => p.$$eval('.chat-row', (els) => els.map((e) => (e.querySelector('.chat-relay.kids, .chat-relay.app') ? `[아이] ${e.textContent}` : e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean));
  await p.goto(`${base}?off=1`);
  await p.waitForSelector('text=서아 오늘 뭐 했어?', { timeout: 30_000 });
  await sleep(1500);
  await p.screenshot({ path: path.join(out, 'chat-before-off.png') });
  const offRows = await p.$$('.chat-relay.kids');
  ok('키즈 모드 꺼짐 — 아이 대화가 안 낀다', offRows.length === 0);
  ok("키즈 모드 꺼짐 — '오늘 만든 것' 줄도 없다", !(await p.$('.kt')));
  await p.goto(`${base}?v=${Date.now()}`);
  await p.waitForSelector('.chat-relay.kids', { timeout: 30_000 });
  await sleep(800);
  await p.screenshot({ path: path.join(out, 'chat-after-kids.png') });
  const o = await order();
  console.log(o.join('\n'));
  const i = (s) => o.findIndex((x) => x.includes(s));
  ok('보호자 말 → 아이 말 → 답 → 아이 말 → 답 → 보호자 답 순서', i('서아 오늘') < i('점프하는 게임') && i('점프하는 게임') < i('톡 누르면') && i('톡 누르면') < i('두 마리로 해') && i('두 마리로 해') < i('빨간색도') && i('빨간색도') < i('오늘은 공룡'), o.join(' | '));
  ok('보호자 튜닝 줄은 안 낀다(보호자 채팅에 이미 있다)', i('튜닝:') === -1);
  ok('아이 말 머리는 아이 이름', (await p.textContent('body')).includes('서아'));
  // 보호자 '오늘 만든 것'(여덟째 조각, 계획서 H) — 입력칸 위 한 줄 → 누르면 작품마다 고친 과정 → 작품 이름 = 그 작품 크게(Esc 로 닫기)
  await p.waitForSelector('.kt-line', { timeout: 10_000 });
  const tl = await p.textContent('.kt-line');
  ok("'오늘 만든 것' 한 줄 — 아이 이름·쓴 시간·고친 과정", tl.includes('오늘 서아') && tl.includes('12/20분') && tl.includes('공룡이 점프하는 게임 → 공룡 두 마리로'), tl);
  await p.screenshot({ path: path.join(out, 'today-1-line.png') });
  await p.click('.kt-line');
  await p.waitForSelector('.kt-works li', { timeout: 3000 });
  ok('누르면 작품마다 고친 과정', (await p.$$('.kt-works li')).length === 1 && (await p.textContent('.kt-steps')).includes('→'));
  await p.screenshot({ path: path.join(out, 'today-2-open.png') });
  await p.click('.kt-title');
  await p.waitForSelector('.kt-frame iframe', { timeout: 3000 });
  ok('작품 이름 = 그 작품 크게(스크립트만 되는 막힌 칸)', (await p.getAttribute('.kt-frame iframe', 'sandbox')) === 'allow-scripts');
  const wf = await (await p.$('.kt-frame iframe')).contentFrame();
  await wf.waitForSelector('#w', { timeout: 3000 }).catch(() => null);
  ok('작품 안이 그려진다', ((await wf.textContent('body').catch(() => '')) ?? '').includes('공룡 점프'));
  await p.screenshot({ path: path.join(out, 'today-3-work.png') });
  await p.keyboard.press('Escape');
  await sleep(150);
  ok('Esc 로 작품 창을 닫는다', !(await p.$('.kt-frame')));
  // 끝에서 끝 — 패드 길로 진짜 아이 세션에 보낸 기록(cargo test kids_pad::real_pad_e2e 가 남긴 e2e-rows.json)을 보호자 채팅에
  if (process.env.KIDS_ROWS) {
    const real = JSON.parse(fs.readFileSync(process.env.KIDS_ROWS, 'utf8'));
    const shift = Date.now() - 300_000 - real[0].ts; // 보호자 대화 사이에 오게 시각만 옮긴다
    const moved = real.map((r) => ({ ...r, ts: r.ts + shift }));
    const q = await context.newPage();
    q.on('pageerror', (e) => errs.push(String(e.stack ?? e)));
    await q.setViewportSize({ width: 560, height: 900 });
    await q.addInitScript((rs) => { window.__rows = rs; }, moved);
    await q.goto(`${base}?v=real`);
    await q.waitForSelector('.chat-relay.kids', { timeout: 30_000 });
    await sleep(800);
    await q.screenshot({ path: path.join(out, 'chat-e2e-real.png'), fullPage: true });
    const body = await q.textContent('body');
    const kid = real.find((r) => r.who === 'kid');
    const ans = real.findLast((r) => r.who === 'assistant');
    ok('진짜 아이 말이 보호자 채팅에', body.includes(kid.text), kid.text);
    ok('진짜 아이 세션 답이 보호자 채팅에', body.includes(ans.text.split('\n')[0]), ans.text.slice(0, 40));
  }
  ok('페이지 오류 없음', errs.length === 0, errs.join(' / ').slice(0, 400));
} finally {
  await release();
  stopVite();
}
console.log(failed ? `FAIL ${failed}` : '모두 통과');
process.exit(failed ? 1 : 0);
