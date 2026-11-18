#!/usr/bin/env node
// 키즈 패드 화면 E2E(11-17 셋째 조각) — 헤드리스 크롬으로 iPad Air 11" 가로(1180×820)·세로(820×1180)
// ① 첫 화면 ② 누르는 순간 움직임(0초 반응) ③ 꾹 → 글 칸 → 보내기 → 만드는 중 ④ 답 → 말풍선·종이 ⑤ 초록 참모 = 남색 매트 ⑥ 잠든 화면 ⑦ 구석 3초 나가기
// node app/e2e/kids-pad/run.mjs [캡처 폴더] — 실패하면 종료 1
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(appDir, '../.shots/kids-pad'));
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kpad-e2e-'));
const PORT = 47496;
const base = `http://127.0.0.1:${PORT}/`;
try { await fetch(base); console.log(`FAIL ${PORT} 포트에 앞 판 하네스가 떠 있다`); process.exit(1); } catch { /* 비어 있다 */ }
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], { cwd: appDir, env: { ...process.env, E2E_PORT: String(PORT), E2E_CACHE: path.join(tmp, 'vite') }, stdio: 'ignore', detached: true });
const stopVite = () => { try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* 이미 꺼짐 */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await sleep(250); } }
const { launch } = createRequire(import.meta.url)(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
const { context, release } = await launch('kids-pad-e2e', { headless: true });
try {
  const p = await context.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.stack ?? e)));
  const box = (sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
  const st = () => p.$eval('.kz', (e) => e.dataset.state);
  for (const [orient, w, h] of [['land', 1180, 820], ['port', 820, 1180]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.goto(`${base}?v=${orient}`);
    await p.waitForSelector('.kz-char', { timeout: 30_000 });
    await sleep(700);
    await p.screenshot({ path: path.join(out, `${orient}-1-idle.png`) });
    const c = await box('.kz-char');
    ok(`${orient} 캐릭터가 화면 안·크다(44px 이상)`, c.w >= 160 && c.x >= 0 && c.x + c.w <= w + 1 && c.y + c.h <= h + 1, JSON.stringify(c));
    const paper = await box('.kz-paper');
    ok(`${orient} 종이가 캐릭터와 안 겹친다`, orient === 'land' ? paper.x + paper.w <= c.x + c.w * 0.35 : paper.y + paper.h <= c.y + c.h * 0.3, JSON.stringify({ paper, c }));
    const corner = await box('.kz-corner');
    ok(`${orient} 숨은 나가기 칸 44px 이상`, corner.w >= 44 && corner.h >= 44);
    // ② 누르는 순간
    await p.mouse.move(c.x + c.w / 2, c.y + c.h / 2);
    await p.mouse.down();
    ok(`${orient} 누르는 순간 듣는 몸짓`, (await st()) === 'listen');
    await sleep(120);
    if (orient === 'land') await p.screenshot({ path: path.join(out, `${orient}-2-press.png`) });
    await p.mouse.up();
    ok(`${orient} 목소리가 없으면 톡 한 번에 글 칸(꾹 누르기 없음)`, !!(await p.$('.kz-type input')));
    await p.fill('.kz-type input', '공룡이 점프하는 게임 만들어 줘');
    if (orient === 'land') await p.screenshot({ path: path.join(out, `${orient}-3-type.png`) });
    await p.click('.kz-send');
    await sleep(300);
    ok(`${orient} 보내면 만드는 중`, (await st()) === 'think' && (await p.evaluate(() => window.__said.at(-1))) === '공룡이 점프하는 게임 만들어 줘');
    await p.screenshot({ path: path.join(out, `${orient}-4-think.png`) });
    await p.evaluate(() => window.__reply('좋아! 공룡 점프 게임을 만들었어. 톡 누르면 공룡이 껑충 뛰어.'));
    await p.waitForSelector('.kz-bubble', { timeout: 5000 });
    await sleep(500);
    ok(`${orient} 답 → 말하기 + 말풍선 + 종이 그림`, (await st()) === 'talk' && !!(await p.$('.kz-paper .kz-wave')));
    const b = await box('.kz-bubble');
    ok(`${orient} 말풍선이 화면 안`, b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h, JSON.stringify(b));
    await p.screenshot({ path: path.join(out, `${orient}-5-reply.png`) });
    // 짧게 톡 = 폴짝(글 칸 없음)
    await sleep(200);
  }
  // ⑤ 초록 참모 → 남색 매트 ⑥ 잠든 화면
  await p.setViewportSize({ width: 1180, height: 820 });
  await p.goto(`${base}?who=green&v=g`);
  await p.waitForSelector('.kz-char', { timeout: 30_000 });
  await sleep(500);
  ok('초록 참모는 남색 매트', (await p.$eval('.kz', (e) => e.dataset.mat)) === 'navy');
  await p.screenshot({ path: path.join(out, 'land-6-green-navy.png') });
  await p.goto(`${base}?who=orange&asleep=1&v=s`);
  await p.waitForSelector('.kz-char', { timeout: 30_000 });
  await sleep(500);
  ok('보호자가 끄면 잠든 화면 — 눌러도 안 움직인다', (await st()) === 'sleep' && (await p.$eval('.kz-char', (e) => e.disabled)));
  await p.screenshot({ path: path.join(out, 'land-7-asleep.png') });
  // ⑦ 구석 3초 — 2초엔 안 나가고 3초 넘으면 나간다
  const cb = await box('.kz-corner');
  await p.mouse.move(cb.x + cb.w / 2, cb.y + cb.h / 2);
  await p.mouse.down();
  await sleep(2000);
  const early = !!(await p.$('.kzpin'));
  await sleep(1300);
  await p.mouse.up();
  ok('구석 3초 길게 = 보호자 숫자판(2초엔 아님), 숫자판만으론 안 나간다', !early && !!(await p.$('.kzpin')) && (await p.evaluate(() => window.__left)) === 0);
  await p.screenshot({ path: path.join(out, 'lock-1-pin.png') });
  const key = (d) => p.click(`.kzpin-keys button:text-is("${d}")`);
  for (const d of '1111') await key(d);
  await sleep(150);
  ok('틀린 숫자 — 안 나가고 점이 비워진다', (await p.evaluate(() => window.__left)) === 0 && (await p.$$('.kzpin-dots i.on')).length === 0);
  for (const d of '2580') await key(d);
  await sleep(150);
  ok('맞는 숫자 = 나가기', (await p.evaluate(() => window.__left)) === 1);
  // 틀린 숫자 연타 — 세 번째부터 남은 초만 보이고 숫자 단추가 막힌다
  await p.goto(`${base}?asleep=1&v=lock2`);
  await p.waitForSelector('.kz-char', { timeout: 30_000 });
  await p.mouse.move(cb.x + cb.w / 2, cb.y + cb.h / 2);
  await p.mouse.down(); await sleep(3200); await p.mouse.up();
  for (const pin of ['1111', '2222', '3333']) { for (const d of pin) await key(d); await sleep(120); }
  ok('세 번 틀리면 쉬기 — 남은 초·단추 막힘', !!(await p.$('.kzpin-wait')) && (await p.$eval('.kzpin-keys button:text-is("5")', (e) => e.disabled)));
  await p.screenshot({ path: path.join(out, 'lock-2-wait.png') });
  await p.mouse.click(5, 400);
  await sleep(200);
  ok('숫자판 바깥을 누르면 닫힌다(그래도 안 나간 채)', !(await p.$('.kzpin')));
  ok('패스키를 못 쓰는 기기는 얼굴 칸이 없다(빈칸 그대로)', !(await p.$('.kzpin-face')));
  // ⑩ 패스키 '되면 고르기'(일곱째 조각) — 얼굴 칸 → 숫자 네 자리 = 등록(안 나감) → 얼굴 칸 = 나가기
  await p.goto(`${base}?pk=1&v=pk`);
  await p.waitForSelector('.kz-char', { timeout: 30_000 });
  await p.mouse.move(cb.x + cb.w / 2, cb.y + cb.h / 2);
  await p.mouse.down(); await sleep(3200); await p.mouse.up();
  await p.waitForSelector('.kzpin-face', { timeout: 5000 });
  ok('패스키 되는 기기 — 숫자판 왼쪽 아래가 얼굴 칸', !!(await p.$('.kzpin-face:not(.set)')));
  await p.screenshot({ path: path.join(out, 'passkey-1-face.png') });
  await p.click('.kzpin-face');
  await sleep(200);
  ok('등록 전 얼굴 칸을 누르면 등록 모드(숫자 기다림)', (await p.getAttribute('.kzpin-face', 'aria-pressed')) === 'true');
  await p.screenshot({ path: path.join(out, 'passkey-2-register.png') });
  for (const d of '2580') await key(d);
  await sleep(300);
  const reg = await p.evaluate(() => ({ reg: window.__pkReg, left: window.__left }));
  ok('숫자를 맞히면 등록만 — 나가지 않는다', reg.reg === 1 && reg.left === 0 && !!(await p.$('.kzpin-face.set')), JSON.stringify(reg));
  await sleep(300);
  await p.click('.kzpin-face');
  await sleep(300);
  ok('등록 뒤 얼굴 칸 = 나가기', (await p.evaluate(() => window.__pkLeave)) === 1 && (await p.evaluate(() => window.__left)) === 1);
  // ⑨ 하루 시간이 다 되면 — 인사 → 오늘 작품 → 잘 자 → 잠든 화면(눌러도 안 움직임)
  // 지나간 장면을 50ms 마다 적어 둔다(작품이 빨리 끝나면 'bye' 를 못 볼 수 있어서)
  await p.addInitScript(() => { window.__closingSeen = []; window.__closingLog = []; const t0 = Date.now(); setInterval(() => { const k = document.querySelector('.kz'); const v = k?.dataset.closing; const all = `${t0 ? Date.now() - t0 : 0}:${location.search}:${v ?? '-'}/${k?.dataset.state ?? 'none'}`; if (window.__closingLog.at(-1)?.split(':').slice(1).join(':') !== all.split(':').slice(1).join(':')) window.__closingLog.push(all); if (v && window.__closingSeen.at(-1) !== v) window.__closingSeen.push(v); }, 50); });
  // 오늘 만든 작품이 없는 날 — 그래도 '오늘은 여기까지' 인사가 끝날 만큼(2초 넘게) 머문 뒤 잘 자(두 말이 겹치지 않게)
  await p.goto(`${base}?left=0&v=close0`);
  await p.waitForSelector('.kz[data-closing="done"]', { timeout: 20_000 });
  const log0 = await p.evaluate(() => window.__closingLog);
  const at = (re) => Number((log0.find((l) => re.test(l)) ?? '').split(':')[0]);
  ok('작품 없는 날도 인사 장면이 2초 넘게 — 바로 잘 자로 안 넘어간다', at(/:bye\//) > 0 && at(/:done\//) - at(/:bye\//) >= 2000, JSON.stringify(log0));
  await p.goto(`${base}?left=0&works=1&v=close`);
  await p.waitForSelector('.kz[data-closing="done"]', { timeout: 20_000 });
  const seen = await p.evaluate(() => window.__closingSeen);
  ok('하루 시간이 다 되면 마무리 장면(인사 → 오늘 작품 → 잠듦)', seen[0] === 'bye' && seen.at(-1) === 'done' && (await p.evaluate(() => window.__workFetch)) >= 1, JSON.stringify(seen) + ' ' + JSON.stringify(await p.evaluate(() => window.__closingLog)));
  ok('마무리 뒤 잠든 화면·캐릭터 막힘', (await st()) === 'sleep' && (await p.$eval('.kz-char', (e) => e.disabled)));
  await p.screenshot({ path: path.join(out, 'close-done.png') });
  // ⑧ 목소리(넷째 조각) — 톡 한 번 = 바로 듣기, 말 → 0.45초 쉼에 미리 받아쓰기 → 끝난 말이면 바로 끝 → 0초 '알겠어!' → 답 조각 둘 → 이어 듣기 → 조용해도 계속 듣기(11-18)
  await p.setViewportSize({ width: 1180, height: 820 });
  await p.goto(`${base}?voice=1&v=voice`);
  await p.waitForSelector('.kz-char', { timeout: 30_000 });
  await sleep(1200);
  const vc = await box('.kz-char');
  await p.mouse.click(vc.x + vc.w / 2, vc.y + vc.h / 2);
  await sleep(250);
  ok('목소리: 톡 한 번에 바로 듣기(손 뗐는데도)', (await st()) === 'listen');
  await p.screenshot({ path: path.join(out, 'voice-1-listen.png') });
  await p.evaluate(() => window.__speak());
  await sleep(1200 + 900);
  ok('말하고 쉬면(0.45초) 미리 받아쓰기', (await p.evaluate(() => window.__peek)) === 1);
  await sleep(900);
  const v1 = await p.evaluate(() => ({ hear: window.__hear, t: window.__kidsTimings }));
  ok('끝난 말이면 바로 끝 — 새 소리가 없으니 미리 받아쓴 글로(빈 몸)', v1.hear.length === 1 && v1.hear[0] === 0, JSON.stringify(v1.hear));
  ok('끝나는 순간 미리 만든 말(0초 반응, 50ms 밑)', v1.t.length === 1 && v1.t[0].cannedMs < 50, JSON.stringify(v1.t));
  await p.screenshot({ path: path.join(out, 'voice-2-think.png') });
  await p.waitForFunction(() => window.__clips >= 1, null, { timeout: 5000 });
  await sleep(150);
  ok('답 조각이 오면 말하기', (await st()) === 'talk');
  await p.screenshot({ path: path.join(out, 'voice-3-talk.png') });
  await p.waitForFunction(() => document.querySelector('.kz')?.dataset.state === 'listen', null, { timeout: 6000 }).catch(() => {});
  ok('답을 다 읽으면 이어 듣기', (await st()) === 'listen' && (await p.evaluate(() => window.__clips)) === 2);
  await sleep(8600);
  // 어린아이 기준 — 답 뒤 8초에 멈추면 다시 톡을 해야 했다. 화면이 떠 있는 동안 계속 듣고, 못 잡은 바퀴는 기록(최대 소리·바닥)
  const tl = await p.evaluate(() => window.__turnLog);
  ok('이어 듣기에 조용해도 계속 듣기(쉬지 않음) + 못 잡음 기록', (await st()) === 'listen' && tl.some((e) => e.ev === 'giveup' && e.follow), JSON.stringify(tl));
  // 듣는 중 다시 톡 = 바로 끝
  await p.mouse.click(vc.x + vc.w / 2, vc.y + vc.h / 2);
  await sleep(200);
  await p.evaluate(() => window.__speak());
  await sleep(500);
  await p.mouse.click(vc.x + vc.w / 2, vc.y + vc.h / 2);
  await sleep(300);
  ok('듣는 중 다시 톡 = 바로 끝(통째 녹음으로)', (await p.evaluate(() => window.__hear.length)) === 2 && (await p.evaluate(() => window.__hear[1])) > 44);
  // 받아쓰기가 비면(작은 목소리·소음) — 톡 한 말이면 '다시 말해 줄래?' 뒤 계속 듣기, 빈 받아쓰기 기록
  await p.goto(`${base}?voice=1&emptyhear=1&v=empty`);
  await p.waitForSelector('.kz-char', { timeout: 30_000 });
  await sleep(1200);
  await p.mouse.click(vc.x + vc.w / 2, vc.y + vc.h / 2);
  await sleep(250);
  await p.evaluate(() => window.__speak());
  await p.waitForFunction(() => window.__hear.length >= 1, null, { timeout: 6000 }).catch(() => {});
  await sleep(600);
  const el = await p.evaluate(() => window.__turnLog);
  ok('빈 받아쓰기 — 쉬지 않고 다시 듣기 + 기록', (await st()) === 'listen' && el.some((e) => e.ev === 'empty' && !e.follow && e.lv > 0.1), JSON.stringify(el));
  // ⑨ 작품(다섯째 조각) — 말하면 만드는 중 그림이 그려지고, 작품 첫 화면이 종이 칸(iframe sandbox)에, 고치면 다시 그려진다
  await p.goto(`${base}?voice=1&works=1&v=works`);
  await p.waitForSelector('.kz-char', { timeout: 30_000 });
  await sleep(1200);
  await p.mouse.click(vc.x + vc.w / 2, vc.y + vc.h / 2);
  await sleep(200);
  await p.evaluate(() => window.__speak());
  // 끝 판정이 빨라져(11-18 말 끝 판정) 한 시점만 보면 '만드는 중'을 지나쳤다 — 말한 뒤 4초 안에 한 번이라도
  await p.waitForFunction(() => !!document.querySelector('.kz-paper .kz-drawing') || !!document.querySelector('.kz-paper .kz-work'), null, { timeout: 4000, polling: 50 }).catch(() => null);
  ok('만드는 중 — 종이에 크레용이 그려진다', !!(await p.$('.kz-paper .kz-drawing')) || !!(await p.$('.kz-paper .kz-work')), JSON.stringify(await p.evaluate(() => ({ st: document.querySelector('.kz')?.dataset.state, hear: window.__hear, paper: document.querySelector('.kz-paper')?.innerHTML.slice(0, 120) }))));
  await p.screenshot({ path: path.join(out, 'make-1-drawing.png') });
  await p.waitForSelector('.kz-paper iframe.kz-work', { timeout: 8000 });
  const sb = await p.$eval('.kz-paper iframe.kz-work', (e) => e.getAttribute('sandbox'));
  ok('작품 첫 화면이 종이 칸 iframe 에(sandbox = 스크립트만)', sb === 'allow-scripts', String(sb));
  await sleep(1200);
  await p.screenshot({ path: path.join(out, 'make-2-first.png') });
  const n0 = await p.evaluate(() => window.__workFetch);
  await sleep(3000);
  ok('작품이 고쳐지면 다시 받아 그린다', (await p.evaluate(() => window.__workFetch)) > n0);
  await p.screenshot({ path: path.join(out, 'make-3-grown.png') });
  // 마이크를 못 열면 톡 한 번에 글 칸
  await p.goto(`${base}?voice=1&nomic=1&v=nomic`);
  await p.waitForSelector('.kz-char', { timeout: 30_000 });
  await sleep(1000);
  await p.mouse.click(vc.x + vc.w / 2, vc.y + vc.h / 2);
  await sleep(400);
  ok('마이크를 못 열면 톡 한 번에 글 칸', !!(await p.$('.kz-type input')));
  ok('페이지 오류 없음', errs.length === 0, errs.join(' / ').slice(0, 400));
} finally {
  await release();
  stopVite();
}
console.log(failed ? `FAIL ${failed}` : '모두 통과');
process.exit(failed ? 1 : 0);
