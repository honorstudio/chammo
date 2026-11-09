#!/usr/bin/env node
// 폰 사람 부르기 카드 E2E — 카드가 화면 40% 안, 이름 줄 바로 밑에 그림, '다 했어'가 보이고, 입력칸 위에 남고, 뒤 채팅이 스크롤되고, 눌러서 크게 보기.
// 실패하면 종료 1.  node app/e2e/phone-browser-card/run.mjs [캡처 폴더] — 참모 브라우저(헤드리스)로 돌아 화면에 안 뜬다
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(appDir, '../.shots/phone-browser-card/e2e'));
fs.mkdirSync(out, { recursive: true });
const PORT = 47436;
const base = `http://127.0.0.1:${PORT}/`;
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-card-e2e-'));
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], { cwd: appDir, env: { ...process.env, E2E_CACHE: cache, E2E_PORT: String(PORT) }, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };

const require = createRequire(import.meta.url);
const { launch } = require(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch { /* 아직 */ } await sleep(250); }

// 카드 치수 — 눈에 안 보이는 잘림까지 본다(단추가 조상 overflow 에 잘리면 '보임'이 아니다)
const measure = () => {
  const r = (s) => document.querySelector(s)?.getBoundingClientRect();
  // 이름 '글자' 끝 기준 — 이름 칸 상자 자체가 늘어나 빈 자리가 되는 게 이번 버그라 상자로 재면 틈이 안 보인다
  const name = document.createRange();
  name.selectNodeContents(document.querySelector('.m-bask-who'));
  const who = name.getBoundingClientRect();
  const card = r('.m-bask'), shot = r('.m-bask .m-br-shot'), img = r('.m-bask .m-br-shot img'), log = document.querySelector('.m-log'), comp = r('.m-comp-wrap');
  const btn = document.querySelector('.m-bask .m-br-act');
  const b = btn?.getBoundingClientRect();
  let visible = !!b;
  if (b) {
    for (let e = btn.parentElement; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.overflowY !== 'visible' || cs.overflowX !== 'visible') { const c = e.getBoundingClientRect(); if (b.bottom > c.bottom + .5 || b.top < c.top - .5) visible = false; }
    }
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    if (!hit || !(hit === btn || btn.contains(hit))) visible = false;
  }
  return { vh: innerHeight, cardH: card?.height, cardTop: card?.top, cardBottom: card?.bottom, gap: shot && who ? shot.top - who.bottom : null, shotH: shot?.height, imgH: img?.height, imgW: img?.width, naturalW: document.querySelector('.m-bask .m-br-shot img')?.naturalWidth,
    btnH: b?.height, btnVisible: visible, compTop: comp?.top, logH: log?.clientHeight, logScroll: log ? log.scrollHeight - log.clientHeight : 0 };
};

const { context, release } = await launch('phone-browser-card-e2e', { headless: true });
try {
  const p = await context.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  const cdp = await context.newCDPSession(p);
  const size = async (height) => { await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height, deviceScaleFactor: 2, mobile: true }); };
  const shot = async (name) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(data, 'base64')); };
  const open = async (qs, h = 844) => {
    await size(h);
    await p.goto(`${base}?${qs}`);
    await p.waitForSelector('.m-bask .m-br-shot img');
    await sleep(500); // 시트 올라오는 전환
  };
  const fits = (name, m, { minLog }) => {
    ok(`${name} 카드 높이 화면 40% 안`, m.cardH <= m.vh * .4 + .5, `${Math.round(m.cardH)} / ${m.vh}`);
    ok(`${name} 이름 줄 바로 밑에 그림(빈 자리 없음)`, m.gap != null && m.gap <= 16, `틈 ${m.gap == null ? '?' : Math.round(m.gap)}px`);
    ok(`${name} '다 했어' 단추가 잘리지 않고 눌린다(44px 이상)`, m.btnVisible && m.btnH >= 44, `보임 ${m.btnVisible} · ${m.btnH}px`);
    ok(`${name} 카드 아래가 입력칸 위`, m.cardBottom <= m.compTop + .5, `${Math.round(m.cardBottom)} ≤ ${Math.round(m.compTop)}`);
    ok(`${name} 그림이 납작하지 않음`, m.imgH >= 48, `그림 칸 ${Math.round(m.shotH)}px`);
    ok(`${name} 뒤 채팅이 남는다`, m.logH >= minLog, `${m.logH}px ≥ ${minLog}px`);
  };

  // 다 연 시트(사용자 캡처 상황)
  await open('snap=full');
  await shot('full');
  let m = await p.evaluate(measure);
  console.log('측정', JSON.stringify(m));
  fits('전체', m, { minLog: 200 });

  // 뒤 채팅 스크롤 — 카드는 그 자리, 채팅만 움직인다
  ok('채팅에 스크롤할 내용이 있다', m.logScroll > 200, `${m.logScroll}px`);
  const before = await p.evaluate(() => { const l = document.querySelector('.m-log'); l.scrollTop = l.scrollHeight; return l.scrollTop; });
  const lb = await p.locator('.m-log').boundingBox();
  await p.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
  await p.mouse.wheel(0, -400);
  await sleep(300);
  const after = await p.evaluate(() => document.querySelector('.m-log').scrollTop);
  ok('손으로 밀면 채팅이 스크롤된다', after < before - 100, `${Math.round(before)} → ${Math.round(after)}`);
  const m2 = await p.evaluate(measure);
  ok('채팅을 밀어도 카드는 입력칸 위 그 자리', Math.abs(m2.cardTop - m.cardTop) < 1 && m2.btnVisible, `${Math.round(m.cardTop)} → ${Math.round(m2.cardTop)}`);
  await shot('full-scrolled');

  // 눌러서 크게 보기 → 닫으면 작은 카드로
  await p.click('.m-bask .m-br-shot');
  await p.waitForSelector('.m-sheet-host .m-view-title');
  await sleep(400);
  const bigImg = await p.evaluate(() => document.querySelector('.m-sheet-host img')?.getBoundingClientRect().width);
  ok('누르면 크게 보기', bigImg >= 360, `${Math.round(bigImg)}px`);
  ok('크게 보기에 부른 이유 전문', await p.isVisible('.m-sheet-host .m-br-ask'));
  await shot('big');
  await p.click('.m-sheet-host [aria-label="닫기"]');
  await sleep(400);
  ok('닫으면 크게 보기가 사라지고 카드로', (await p.locator('.m-sheet-host .m-view-title').count()) === 0 && await p.isVisible('.m-bask .m-br-shot'));

  // 긴 이유 — 줄이 늘어도 카드는 40% 안, 단추 그대로
  await open('snap=full&reason=long');
  await shot('full-long');
  fits('긴 이유', await p.evaluate(measure), { minLog: 200 });

  // 반 시트 — 카드가 뜨면 앱이 여는 높이. 채팅도 남아야 한다
  await open('snap=half');
  await shot('half');
  fits('반', await p.evaluate(measure), { minLog: 40 });

  // 키보드 — 보이는 화면이 절반쯤(시트가 위까지)
  await open('snap=half&kb=1', 480);
  await shot('kb');
  fits('키보드', await p.evaluate(measure), { minLog: 40 });

  // 작은 폰
  await open('snap=half', 667);
  await shot('half-small');
  fits('작은 폰 반', await p.evaluate(measure), { minLog: 40 });

  // 두 장 — 합쳐서 40% 안, 스크롤로 둘째까지 닿고, 눌리지 않는다
  await open('snap=full&asks=2');
  await shot('two');
  const two = await p.evaluate(() => {
    const l = document.querySelector('.m-bask')?.parentElement;
    const cs = [...document.querySelectorAll('.m-bask')];
    l.scrollTop = l.scrollHeight;
    const last = cs.at(-1).querySelector('.m-br-act').getBoundingClientRect();
    const box = l.getBoundingClientRect();
    const hit = document.elementFromPoint(last.left + last.width / 2, last.top + last.height / 2);
    return { listH: box.height, vh: innerHeight, cards: cs.map((c) => Math.round(c.getBoundingClientRect().height)), reached: last.bottom <= box.bottom + 1 && !!hit?.closest('.m-br-act') };
  });
  ok('두 장 — 합쳐서 화면 40% 안', two.listH <= two.vh * .4 + .5, `${Math.round(two.listH)} / ${two.vh}`);
  ok('두 장 — 눌리지 않음', two.cards.every((h) => h >= 120), JSON.stringify(two.cards));
  ok('두 장 — 밀면 둘째 단추까지 닿는다', two.reached);

  ok('화면 오류 없음', errs.length === 0, errs.join(' | ').slice(0, 300));
} finally {
  await release?.();
  vite.kill();
  fs.rmSync(cache, { recursive: true, force: true });
}
console.log(failed ? `실패 ${failed}개` : '전부 통과');
process.exit(failed ? 1 : 0);
