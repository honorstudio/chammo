#!/usr/bin/env node
// serve.mjs 가 떠 있을 때 헤드리스 크롬(참모 브라우저)으로 패드·폰 크기별 캡처 + 치수. CDP 폭 흉내(Page.captureScreenshot — page.screenshot 은 흉내를 푼다)
//   node app/e2e/ipad-layout/shoot.mjs <캡처 폴더> [접두 before|after] [--port 47531]
// 크기: 폰 390×844(회귀 비교) · iPad Pro 11 세로 834×1194 · 가로 1194×834 · 13" 가로 1376×1032 · 분할 화면 678×834
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const argv = process.argv.slice(2);
const pi = argv.indexOf('--port');
const port = pi >= 0 ? Number(argv.splice(pi, 2)[1]) : 47531;
const out = path.resolve(argv[0]);
const pre = argv[1] ?? 'shot';
fs.mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = (process.env.SIZES ?? 'phone,port11,land11,land13,split').split(',');
const ALL = { phone: [390, 844, 3], port11: [834, 1194, 2], land11: [1194, 834, 2], land13: [1376, 1032, 2], split: [678, 834, 2] };
const MEASURE = () => {
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const small = [...document.querySelectorAll('button, [role="button"], a, [role="tab"], input, textarea')]
    .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && (b.width < 44 || b.height < 44) && getComputedStyle(e).visibility !== 'hidden'; })
    .map((e) => { const b = e.getBoundingClientRect(); return `${(e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || e.tagName).trim().slice(0, 18)} ${Math.round(b.width)}x${Math.round(b.height)}`; });
  const widest = (sel) => Math.max(0, ...[...document.querySelectorAll(sel)].map((e) => Math.round(e.getBoundingClientRect().width)));
  return { vw: innerWidth, vh: innerHeight, app: r('.m-app'), dash: r('.m-dash'), sheet: r('.m-sheet'), composer: r('textarea'), tabbar: r('.m-tabbar'), bubbleMax: widest('.m-bubble'), dashCardMax: widest('.m-dash > *'), small: small.slice(0, 40), smallCount: small.length };
};
const { launch } = createRequire(import.meta.url)(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
const { context, release } = await launch('ipad-layout-shots', { headless: true });
const report = {};
try {
  const p = await context.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  const cdp = await context.newCDPSession(p);
  await cdp.send('Storage.clearDataForOrigin', { origin: base, storageTypes: 'all' });
  const shot = async (name) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, `${pre}-${name}.png`), Buffer.from(data, 'base64')); };
  for (const tag of SIZES) {
    const [w, h, dpr] = ALL[tag];
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await p.goto(`${base}/__setup?orch=${process.env.ORCH ?? 'c0'}&v=${Date.now()}`, { timeout: 60_000 });
    await p.waitForURL(/mobile\.html/, { timeout: 30_000 });
    await p.waitForSelector('.m-app', { timeout: 30_000 }).catch(() => {});
    await sleep(3500);
    await shot(`${tag}-1-home`);
    report[`${tag}-home`] = await p.evaluate(MEASURE);
    const peek = p.locator('.m-peek').first();
    if (await peek.count()) { await peek.click({ timeout: 5000 }).catch(() => {}); await sleep(1500); }
    await shot(`${tag}-2-chat`);
    report[`${tag}-chat`] = await p.evaluate(MEASURE);
  }
  report.errors = errs.slice(0, 10);
} finally {
  fs.writeFileSync(path.join(out, `${pre}-measure.json`), JSON.stringify(report, null, 1));
  await release();
}
console.log('done', out);
