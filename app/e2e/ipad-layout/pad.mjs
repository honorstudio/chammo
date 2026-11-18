#!/usr/bin/env node
// 패드 화면 E2E(11-18 시안 v1 가로 A · 세로 B) — serve.mjs 가 떠 있을 때 헤드리스 크롬 폭 흉내로
//  가로 1194: 띠 68 · 채팅 400 · 스페이스, 위 막대에 대시보드 머리줄, 탭바·채팅 시트 없음 · 참모 시트 가운데 600 · 띠 길게 누르기 → 그 참모 메뉴(440)
//            ⌘2 → 둘째 참모 · ⌘⇧L → 보관함 탭 · ⌘⇧M → 메모(가운데 760) · Enter 보내기 · ⇧Enter 줄바꿈
//  세로 834: 띠 + 채팅, 판은 닫힘 → 위 막대 단추로 열림(min(520, 64%)) → Esc 로 닫힘
//  폰 390: 아래 탭바·채팅 시트 그대로, 패드 칸 없음
//   node app/e2e/ipad-layout/pad.mjs [캡처 폴더] [--port 47531] — 실패하면 종료 1
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const argv = process.argv.slice(2);
const pi = argv.indexOf('--port');
const port = pi >= 0 ? Number(argv.splice(pi, 2)[1]) : 47531;
const out = path.resolve(argv[0] ?? '.shots/ipad-layout/pad');
fs.mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
const { launch } = createRequire(import.meta.url)(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
const { context, release } = await launch('ipad-layout-pad', { headless: true });
try {
  const p = await context.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  const cdp = await context.newCDPSession(p);
  await cdp.send('Storage.clearDataForOrigin', { origin: base, storageTypes: 'all' });
  const size = async (w, h, dpr = 2) => { await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: true }); await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); };
  const shot = async (name) => { await sleep(500); const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(data, 'base64')); };
  const fresh = async () => { await p.goto(`${base}/__setup?orch=c0&v=${Date.now()}`, { timeout: 60_000 }); await p.waitForURL(/mobile\.html/); await p.waitForSelector('.m-app', { timeout: 30_000 }); await sleep(2500); };
  const box = (sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), vis: cs.visibility }; }, sel);
  const count = (sel) => p.evaluate((s) => document.querySelectorAll(s).length, sel);
  const key = async (code, mods = []) => { for (const m of mods) await p.keyboard.down(m); await p.keyboard.press(code); for (const m of mods.slice().reverse()) await p.keyboard.up(m); await sleep(500); };

  // ── 가로 1194 ──
  await size(1194, 834); await fresh();
  const rail = await box('.m-tb-rail'), chat = await box('.m-tb-chat'), dsh = await box('.m-tb-dash');
  ok('가로: 띠 68', rail?.w === 68, JSON.stringify(rail));
  ok('가로: 채팅 칸 400', chat?.w === 400 && chat.x === 68, JSON.stringify(chat));
  ok('가로: 스페이스는 나머지', dsh?.x === 468 && dsh.w === 1194 - 468, JSON.stringify(dsh));
  ok('가로: 위 막대에 대시보드 머리줄', (await count('.m-tb-top .m-dash-head')) === 1 && (await count('.m-tb-dash .m-dash-head')) === 0);
  ok('가로: 아래 탭바·채팅 시트 없음', (await count('.m-tabbar')) === 0 && (await count('.m-sheet')) === 0);
  ok('가로: 띠 참모 7 · 지금 참모 표시', (await count('.m-tb-face')) === 7 && (await count('.m-tb-face[aria-current]')) === 1);
  const small = await p.evaluate(() => [...document.querySelectorAll('.m-tb-rail button, .m-tb-top button, .m-tb-chat button')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.width < 44 || b.height < 44); }).map((e) => `${e.className} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));
  ok('가로: 띠·위 막대·채팅 단추 44 이상', small.length === 0, JSON.stringify(small.slice(0, 5)));
  await shot('land-1-home');
  // 참모 시트 — 가운데 600
  await p.click('.m-tb-new'); await sleep(900);
  const pick = await box('.m-pick');
  ok('가로: 참모 시트 가운데 600', !!pick && pick.w <= 600 && Math.abs(pick.x + pick.w / 2 - (468 + 726 / 2 + 0)) < 400 && pick.w > 400, JSON.stringify(pick));
  await shot('land-2-picker');
  await p.keyboard.press('Escape'); await sleep(400);
  await fresh();
  // 띠 길게 누르기 → 그 참모 메뉴
  const f2 = await p.evaluate(() => { const e = document.querySelectorAll('.m-tb-face')[1]; const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, name: e.getAttribute('title') }; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: f2.x, y: f2.y }] }); await sleep(600);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(700);
  const menu = await box('.m-menu');
  const mt = await p.evaluate(() => document.querySelector('.m-menu .m-menu-title')?.textContent ?? '');
  ok('가로: 띠 길게 누르기 → 그 참모 메뉴(440 이하)', !!menu && menu.w <= 440 && mt === f2.name, `${JSON.stringify(menu)} ${mt} / ${f2.name}`);
  ok('가로: 길게 눌러도 참모는 안 바뀜', (await p.evaluate(() => document.querySelectorAll('.m-tb-face')[0].hasAttribute('aria-current'))));
  await shot('land-3-hold-menu');
  await fresh();
  // ⌘ 키
  await p.click('.m-tb-chat textarea'); await key('Digit2', ['Meta']);
  ok('⌘2 → 둘째 참모', await p.evaluate(() => document.querySelectorAll('.m-tb-face')[1].hasAttribute('aria-current')));
  await key('Digit1', ['Meta']);
  await key('KeyL', ['Meta', 'Shift']);
  ok('⌘⇧L → 보관함 탭', await p.evaluate(() => document.querySelector('.m-dash-tabs [role="tab"][aria-selected="true"]')?.textContent === '보관함'));
  await key('KeyH', ['Meta', 'Shift']);
  ok('⌘⇧H → 홈 탭', await p.evaluate(() => document.querySelector('.m-dash-tabs [role="tab"][aria-selected="true"]')?.textContent === '홈'));
  await key('KeyM', ['Meta', 'Shift']);
  const narrow = await box('.m-tb-narrow');
  ok('⌘⇧M → 메모(가운데 760)', !!narrow && narrow.w <= 760, JSON.stringify(narrow));
  await shot('land-4-notes');
  await key('KeyM', ['Meta', 'Shift']);
  ok('⌘⇧M 다시 → 참모로', (await count('.m-tb-chat')) === 1);
  // Enter 보내기 · ⇧Enter 줄바꿈
  await p.click('.m-tb-chat textarea'); await p.keyboard.type('첫 줄'); await p.keyboard.down('Shift'); await p.keyboard.press('Enter'); await p.keyboard.up('Shift'); await p.keyboard.type('둘째 줄');
  const two = await p.evaluate(() => document.querySelector('.m-tb-chat textarea').value);
  ok('⇧Enter 는 줄바꿈', two === '첫 줄\n둘째 줄', JSON.stringify(two));
  await p.keyboard.press('Enter'); await sleep(600);
  const after = await p.evaluate(() => document.querySelector('.m-tb-chat textarea').value);
  ok('Enter 는 보낸다(입력칸 비움)', after === '', JSON.stringify(after));
  await shot('land-5-sent');

  // ── 세로 834 ──
  await size(834, 1194); await fresh();
  const d0 = await box('.m-tb-dash');
  ok('세로: 띠 + 채팅(판 닫힘)', d0?.vis === 'hidden' && (await box('.m-tb-chat'))?.w === 834 - 68, JSON.stringify(d0));
  await shot('port-1-closed');
  await p.click('.m-tb-top button[aria-label="스페이스"]'); await sleep(700);
  const d1 = await box('.m-tb-dash');
  const want = Math.round(Math.min(520, (834 - 68) * 0.64));
  ok('세로: 위 막대 단추 → 판 열림 min(520, 64%)', d1?.vis === 'visible' && Math.abs(d1.w - want) <= 1 && d1.x + d1.w === 834, `${JSON.stringify(d1)} want ${want}`);
  ok('세로: 채팅이 1/3 넘게 남는다', d1 && (d1.x - 68) / (834 - 68) > 0.3);
  await shot('port-2-open');
  await p.keyboard.press('Escape'); await sleep(600);
  ok('세로: Esc 로 닫힘', (await box('.m-tb-dash'))?.vis === 'hidden');

  // ── 폰 390 ──
  await size(390, 844, 3); await fresh();
  ok('폰: 아래 탭바·채팅 시트 그대로', (await count('.m-tabbar')) === 1 && (await count('.m-sheet')) === 1);
  ok('폰: 패드 칸 없음', (await count('.m-tb, .m-tb-rail, .m-tb-chat')) === 0);
  await shot('phone-1-home');
  ok('페이지 오류 없음', errs.length === 0, errs.slice(0, 3).join(' | '));
} finally {
  await release();
}
console.log(failed ? `실패 ${failed}` : '통과');
process.exit(failed ? 1 : 0);
