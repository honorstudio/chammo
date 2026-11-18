#!/usr/bin/env node
// 폰 화면 하나하나를 패드 크기로 — '폰 화면을 그대로 늘린 곳' 전수조사·구현 전후 비교(serve.mjs 가 떠 있을 때).
//   node app/e2e/ipad-layout/screens.mjs <캡처 폴더> [접두] [--port 47531] [--size 1194x834]
// 장면: 참모 홈 · 보관함 탭 · 참모 바꾸기 시트 · 더보기 · 알림 · 길게 누르기 메뉴 · 사무실 · 팀 탭 · 메모 탭. 장면마다 넓은 칸 폭(가장 넓은 카드·줄·시트)도 적는다
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const port = Number(opt('--port', 47531));
const [W, H] = opt('--size', '1194x834').split('x').map(Number);
const out = path.resolve(argv[0] ?? '.shots/ipad-layout/screens');
const pre = argv[1] ?? 'now';
fs.mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { launch } = createRequire(import.meta.url)(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
const { context, release } = await launch('ipad-layout-screens', { headless: true });
const report = {};
try {
  const p = await context.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  const cdp = await context.newCDPSession(p);
  await cdp.send('Storage.clearDataForOrigin', { origin: base, storageTypes: 'all' });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const widest = () => p.evaluate(() => {
    const sel = '.m-pick, .m-menu, .m-sheet, .m-lrow, .m-orch, .m-dash > *, .m-tabbar button, .m-lk-row, .m-lk-card, .tmx-list, .m-nt-ed, .m-office-room, .m-view, .m-tb-chat, .m-tb-dash, .m-tb-narrow';
    const r = {};
    for (const e of document.querySelectorAll(sel)) { const w = Math.round(e.getBoundingClientRect().width); if (!w) continue; const k = (e.className || e.tagName).toString().split(' ')[0]; r[k] = Math.max(r[k] ?? 0, w); }
    return r;
  });
  const shot = async (name) => { await sleep(900); const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, `${pre}-${name}.png`), Buffer.from(data, 'base64')); report[name] = await widest(); };
  const fresh = async () => { await p.goto(`${base}/__setup?orch=c0&v=${Date.now()}`, { timeout: 60_000 }); await p.waitForURL(/mobile\.html/); await p.waitForSelector('.m-app', { timeout: 30_000 }); await sleep(2500); };
  const click = async (sel) => { const l = p.locator(sel).first(); if (!(await l.count())) return false; await l.click({ timeout: 4000 }).catch(() => {}); return true; };

  await fresh(); await shot('1-home');
  await click('.m-dash-tabs [role="tab"]:nth-child(2)'); await shot('2-locker');
  await fresh(); await click('.m-corch'); await shot('3-picker');
  await fresh(); await click('.m-dash-head button[title="더보기"]'); await shot('4-more');
  await fresh(); await click('.m-bell'); await shot('5-alerts');
  await fresh(); await click('.m-peek'); await sleep(1200);
  const b = await p.evaluate(() => { const a = document.querySelectorAll('.m-bubble.m-ai'); const e = a[a.length - 1]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + 30, y: r.y + 16 }; });
  if (b) { await touch('touchStart', b.x, b.y); await sleep(650); await touch('touchEnd', b.x, b.y); }
  await shot('6-hold-menu');
  await fresh(); await click('.m-dash-head button[title="사무실"]'); await sleep(1500); await shot('7-office');
  // 팀·메모 — 폰은 아래 탭바, 패드는 띠 아래 단추
  await fresh(); (await click('.m-tabbar [role="tab"]:nth-child(2)')) || (await click('.m-tb-rail button[aria-label="팀"]')); await shot('8-team');
  (await click('.m-tabbar [role="tab"]:nth-child(3)')) || (await click('.m-tb-rail button[aria-label="내 메모"]')); await shot('9-notes');
  report.errors = errs.slice(0, 5);
} finally {
  fs.writeFileSync(path.join(out, `${pre}-widths.json`), JSON.stringify(report, null, 1));
  await release();
}
console.log('done', out);
