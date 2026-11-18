#!/usr/bin/env node
// 보호자 패드 채팅의 아이 화면 대화·'오늘 만든 것'(아홉째 조각) — serve.mjs --kids 가 떠 있을 때. 가로 1194·세로 834·폰 390 에서
// 키즈 참모(참모-7) 채팅에 아이 말·답·앱 줄이 시각 순으로 끼고, 입력칸 위 한 줄 → 펼침 → 작품 크게(막힌 칸) → Esc. 키즈 아닌 참모엔 없다
//   node app/e2e/ipad-layout/kids.mjs [캡처 폴더] [--port 47531] — 실패하면 종료 1
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const argv = process.argv.slice(2);
const pi = argv.indexOf('--port');
const port = pi >= 0 ? Number(argv.splice(pi, 2)[1]) : 47531;
const out = path.resolve(argv[0] ?? '.shots/ipad-layout/kids');
fs.mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
const { launch } = createRequire(import.meta.url)(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
const { context, release } = await launch('ipad-layout-kids', { headless: true });
try {
  const p = await context.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  const cdp = await context.newCDPSession(p);
  const size = async (w, h) => { await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true }); await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); };
  const shot = async (name) => { await sleep(400); const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(data, 'base64')); };
  const open = async (orch) => { await p.goto(`${base}/__setup?orch=${orch}&v=${Date.now()}`, { timeout: 60_000 }); await p.waitForURL(/mobile\.html/); await p.waitForSelector('.m-app', { timeout: 30_000 }); await sleep(2500); };
  for (const [tag, w, h] of [['land', 1194, 834], ['port', 834, 1194], ['phone', 390, 844]]) {
    await size(w, h);
    await open('c6');
    if (tag === 'phone' && !(await p.$('.m-kt'))) { await p.click('.m-sheet .m-grab').catch(() => {}); await sleep(800); }
    await p.waitForSelector('.m-kt .kt-line', { timeout: 15_000 }).catch(() => null);
    const kids = await p.$$eval('.m-kid-row', (els) => els.map((e) => e.textContent));
    ok(`${tag}: 아이 화면 대화가 보호자 채팅에(아이 말·답·앱 줄)`, kids.some((t) => t.includes('공룡이 점프하는 게임 만들어 줘')) && kids.some((t) => t.includes('아이 화면 답')) && kids.some((t) => t.includes('고치기 dino')), JSON.stringify(kids.slice(0, 3)));
    const line = (await p.textContent('.m-kt .kt-line').catch(() => '')) ?? '';
    ok(`${tag}: 입력칸 위 '오늘 만든 것' 한 줄`, line.includes('오늘 서아') && line.includes('12/20분') && line.includes('구름 비') && line.includes('외 1'), line);
    const lb = await p.evaluate(() => { const e = document.querySelector('.m-kt .kt-line'); const b = e?.getBoundingClientRect(); return b ? { h: Math.round(b.height), right: Math.round(b.right) } : null; });
    ok(`${tag}: 한 줄 손가락 44px·화면 안`, !!lb && lb.h >= 44 && lb.right <= w, JSON.stringify(lb));
    await shot(`${tag}-1-chat`);
    await p.click('.m-kt .kt-line'); await sleep(300);
    const items = await p.$$eval('.m-kt .kt-works li', (els) => els.map((e) => e.textContent));
    ok(`${tag}: 펼치면 작품마다 고친 과정(최근 작품 먼저)`, items.length === 2 && items[0].startsWith('구름 비') && items[1].includes('공룡이 점프하는 게임 → 공룡 두 마리로 → 빨간색으로'), JSON.stringify(items));
    await shot(`${tag}-2-open`);
    await p.click('.m-kt .kt-title >> nth=1'); await sleep(300);
    const fr = await (await p.waitForSelector('.kt-frame iframe', { timeout: 3000 })).contentFrame();
    await fr.waitForSelector('#w', { timeout: 3000 }).catch(() => null);
    ok(`${tag}: 작품 이름 = 그 작품 크게(스크립트만 되는 막힌 칸)`, (await p.getAttribute('.kt-frame iframe', 'sandbox')) === 'allow-scripts' && ((await fr.textContent('body').catch(() => '')) ?? '').includes('공룡 점프'));
    const fb = await p.evaluate(() => { const b = document.querySelector('.kt-frame')?.getBoundingClientRect(); return b ? { x: Math.round(b.x), w: Math.round(b.width) } : null; });
    ok(`${tag}: 작품 창이 화면 안`, !!fb && fb.x >= 0 && fb.x + fb.w <= w, JSON.stringify(fb));
    await shot(`${tag}-3-work`);
    await p.click('.kt-close'); await sleep(300);
    ok(`${tag}: 닫기`, !(await p.$('.kt-frame')));
  }
  // 키즈 참모가 아닌 참모엔 없다
  await size(1194, 834); await open('c1');
  ok('키즈 아닌 참모 — 아이 줄·오늘 줄 없음', !(await p.$('.m-kt')) && !(await p.$('.m-kid-row')));
  ok('페이지 오류 없음', errs.length === 0, errs.join(' / ').slice(0, 300));
} finally {
  await release();
}
console.log(failed ? `FAIL ${failed}` : 'ok 전부');
process.exit(failed ? 1 : 0);
