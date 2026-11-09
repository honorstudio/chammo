#!/usr/bin/env node
// 영상 검토 해피패스 E2E — PC: 말 남기기·고치기·지우기·찾기·재열기·보내기 / 폰: 저용량 256KB·펴기·그림 묶음·말·보내기. 실패하면 종료 1.
// node app/e2e/video-review/run.mjs [캡처 폴더]  — 참모 브라우저로 돈다. 시험 영상은 ffmpeg 으로 만든다(30초)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(appDir, '../.shots/video-curation/e2e'));
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-e2e-'));
const DUR = 30;
const ff = (...a) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...a]); if (r.status) throw new Error(`ffmpeg: ${r.stderr}`); };
const video = path.join(tmp, 'v.mp4');
const low = path.join(tmp, 'low.mp4');
const sprite = path.join(tmp, 'sprite.jpg');
ff('-f', 'lavfi', '-i', `testsrc=d=${DUR}:s=1280x720:r=30`, '-c:v', 'libx264', '-g', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video);
ff('-i', video, '-vf', 'scale=960:540', '-c:v', 'libx264', '-b:v', '700k', '-g', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', low);
ff('-i', video, '-vf', 'fps=1/2,scale=160:90,tile=10x10', '-frames:v', '1', '-q:v', '6', sprite);
const meta = { duration: DUR, sprite: { interval: 2, cols: 10, rows: 10, count: 15, cw: 160, ch: 90, sheets: 1 } };

const PORT = 47431;
const base = `http://127.0.0.1:${PORT}/`;
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], { cwd: appDir, env: { ...process.env, E2E_VIDEO: video, E2E_LOW: low, E2E_SPRITE: sprite, E2E_SPRITE_META: JSON.stringify(meta), E2E_PORT: String(PORT) }, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
const state = async () => (await fetch(`${base}__state`)).json();

const require = createRequire(import.meta.url);
const { launch } = require(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));

for (let i = 0; i < 40; i++) { try { await fetch(`${base}__state`); break; } catch { await sleep(250); } }

const { context, release } = await launch('honor-orchestrator', { headless: true });
try {
  await fetch(`${base}__reset`);
  // ── PC
  const p = await context.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.setViewportSize({ width: 984, height: 860 });
  await p.goto(`${base}?v=pc`);
  await p.waitForSelector('.vr video');
  await p.waitForFunction(() => document.querySelector('.vr video')?.duration > 0);
  ok('PC 프레임 타임코드', (await p.textContent('.vr-tc')) === '00:00:00:00', await p.textContent('.vr-tc'));
  ok('PC 글 칸 초점', await p.evaluate(() => document.activeElement?.classList.contains('vr-field')));
  ok('PC 빈 목록 문구', await p.isVisible('.vr-empty'));
  // ←→ 찾기 — 글 칸이 비었을 때
  await p.keyboard.press('ArrowRight');
  await p.keyboard.press('ArrowRight');
  await sleep(300);
  ok('→ 두 번 = 2초', (await p.textContent('.vr-tc')).startsWith('00:00:02'), await p.textContent('.vr-tc'));
  // Space 재생
  await p.keyboard.press(' ');
  await sleep(700);
  ok('Space 재생', await p.evaluate(() => !document.querySelector('.vr video').paused));
  // 치기 시작하면 멈춤
  await p.keyboard.type('첫 컷 너무 길어');
  ok('치면 멈춘다', await p.evaluate(() => document.querySelector('.vr video').paused));
  const at = await p.textContent('.vr-tc');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.vr-row');
  ok('Enter 로 들어감·칸 비움', (await p.inputValue('.vr-field')) === '' && (await p.textContent('.vr-row .vr-tx')) === '첫 컷 너무 길어');
  ok('목록 시각 = 그때 시각', (await p.textContent('.vr-row em')) === at, at);
  ok('눈금에 마커', (await p.locator('.vr-mk').count()) === 1);
  // 눈금 눌러 이동 → 말 하나 더
  const box = await p.locator('.vr-rul').boundingBox();
  await p.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  await sleep(400);
  ok('눈금 누르면 그 시각', (await p.textContent('.vr-tc')).startsWith('00:00:15'), await p.textContent('.vr-tc'));
  await p.keyboard.type('음악 줄여');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.querySelectorAll('.vr-row').length === 2);
  ok('시각순', (await p.locator('.vr-row .vr-tx').allTextContents()).join('|') === '첫 컷 너무 길어|음악 줄여');
  // 눈금 글자가 재생 위치 선과 안 겹친다
  const overlap = await p.evaluate(() => {
    const ph = document.querySelector('.vr-ph')?.getBoundingClientRect();
    return [...document.querySelectorAll('.vr-tl')].some((l) => { const r = l.getBoundingClientRect(); return ph && ph.left >= r.left && ph.left <= r.right; });
  });
  ok('눈금 글자 ↔ 재생 위치 선 안 겹침', !overlap);
  await p.screenshot({ path: path.join(out, 'pc.png') });
  // 줄 누르면 그 시각으로, 고치기
  await p.locator('.vr-row').first().click();
  await sleep(300);
  ok('줄 누르면 이동', (await p.textContent('.vr-tc')) === at, await p.textContent('.vr-tc'));
  await p.locator('.vr-row.on .vr-acts button').first().click();
  await p.fill('.vr-field', '첫 컷 2초만');
  await p.keyboard.press('Enter');
  await sleep(200);
  ok('고치기', (await p.locator('.vr-row .vr-tx').first().textContent()) === '첫 컷 2초만');
  // 지우기
  await p.locator('.vr-row').nth(1).click();
  await p.locator('.vr-row.on .vr-acts button').nth(1).click();
  await sleep(200);
  ok('지우기', (await p.locator('.vr-row').count()) === 1);
  // 글자 치던 건 Esc 로 비우고, 빈 칸 Esc 는 닫기
  await p.locator('.vr-field').focus();
  await p.keyboard.type('지울 말');
  await p.keyboard.press('Escape');
  ok('Esc 는 먼저 비우기', (await p.inputValue('.vr-field')) === '' && !(await p.evaluate(() => window.__closed)));
  await p.keyboard.press('Escape');
  ok('빈 칸 Esc 는 닫기', await p.evaluate(() => window.__closed === true));
  // 보내기
  await p.click('.vr-send');
  await sleep(200);
  const sent = (await p.evaluate(() => window.__sent))[0] ?? '';
  ok('참모에게 보낸 글', sent.includes('첫 컷 2초만') && sent.includes('/d/curation/film-v8-ab12.state.json') && sent.includes('말 1개'), sent.split('\n').join(' / '));
  const s1 = await state();
  ok('기록 저장(state.json)', JSON.parse(s1.saved).notes?.[0]?.text === '첫 컷 2초만' && JSON.parse(s1.saved).source?.fps === 30);
  ok('사람 글 저장(md)', s1.savedMd.includes('첫 컷 2초만'));
  // 다시 열면 그대로
  await p.reload();
  await p.waitForSelector('.vr-row');
  ok('다시 열어도 남아 있음', (await p.locator('.vr-row .vr-tx').first().textContent()) === '첫 컷 2초만');
  ok('PC 화면 오류 없음', errs.length === 0, errs.join(' | ').slice(0, 300));
  await p.close();

  // ── 폰
  await fetch(`${base}__reset`);
  const m = await context.newPage();
  const merrs = [];
  m.on('pageerror', (e) => merrs.push(String(e)));
  const cdp = await context.newCDPSession(m);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await m.goto(`${base}?v=phone`);
  await m.waitForFunction(() => document.querySelector('.vr video')?.duration > 0, null, { timeout: 15000 });
  const lowReqs = (await state()).log.filter((l) => l.url.includes('low=1'));
  ok('폰은 저용량을 받는다', lowReqs.length > 0);
  ok('한 조각 256KB 이하', lowReqs.every((l) => l.bytes <= 256 * 1024), String(Math.max(...lowReqs.map((l) => l.bytes))));
  ok('원본은 안 받는다', !(await state()).log.some((l) => l.url.startsWith('/api/media?') && !l.url.includes('low=1')));
  ok('폰 타임코드 0.1초', (await m.textContent('.vr-tc')) === '00:00.0', await m.textContent('.vr-tc'));
  // 길게 눌러 펴기
  const r = await m.locator('.vr-rul').boundingBox();
  await m.mouse.move(r.x + r.width * 0.5, r.y + r.height / 2);
  await m.mouse.down();
  ok('끌면 그림 묶음', await m.isVisible('.vr-thumb'));
  await sleep(450);
  ok('0.3초 누르면 펴진다', await m.isVisible('.vr-rul.zoom'));
  await m.screenshot({ path: path.join(out, 'phone-zoom.png') });
  const seeks0 = (await state()).log.length;
  await m.mouse.move(r.x + r.width * 0.5 + 26, r.y + r.height / 2, { steps: 6 });
  await sleep(100);
  // 15초/390px — 26px 는 1초
  const tcMoved = await m.textContent('.vr-tc');
  ok('펴진 뒤엔 26px = 1초', tcMoved >= '00:15.9' && tcMoved <= '00:16.1', tcMoved);
  ok('끄는 동안 영상 안 받음', (await state()).log.filter((l) => l.url.startsWith('/api/media?')).length <= seeks0);
  await m.mouse.up();
  await sleep(400);
  ok('떼면 펴기 끝', !(await m.isVisible('.vr-rul.zoom')));
  ok('뗀 자리로 영상 이동', Math.abs((await m.evaluate(() => document.querySelector('.vr video').currentTime)) - 16) < 0.3);
  // 말 + 누르는 자리 44
  await m.tap?.('.vr-field').catch(() => {});
  await m.locator('.vr-field').focus();
  await m.keyboard.type('여기 전환');
  const small = await m.evaluate(() => [...document.querySelectorAll('.vr button, .m-vr-head button')].filter((b) => b.offsetParent).map((b) => { const q = b.getBoundingClientRect(); return [b.getAttribute('aria-label'), Math.round(q.width), Math.round(q.height)]; }).filter((x) => x[1] < 44 || x[2] < 44));
  ok('폰 단추 44px', small.length === 0, JSON.stringify(small));
  const fieldW = await m.evaluate(() => document.querySelector('.vr-field').getBoundingClientRect().width);
  ok('폰 글 칸 폭 충분(200px 이상)', fieldW >= 200, `${Math.round(fieldW)}px`);
  await m.keyboard.press('Enter');
  await m.waitForSelector('.vr-row');
  await m.screenshot({ path: path.join(out, 'phone.png') });
  await m.click('.m-vr-send');
  await m.waitForFunction(() => window.__closed === true, null, { timeout: 5000 }).catch(() => {});
  const s2 = await state();
  ok('폰 보내기', s2.sends.length === 1 && s2.sends[0].includes('여기 전환'), String(s2.sends[0]).split('\n').join(' / '));
  ok('폰 기록 저장', JSON.parse(s2.saved).notes?.[0]?.from === 'phone');
  ok('폰 화면 오류 없음', merrs.length === 0, merrs.join(' | ').slice(0, 300));
  await m.close();
} catch (e) {
  failed++;
  console.log('FAIL 멈춤', e);
} finally {
  await release();
  vite.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `실패 ${failed}` : '전부 통과');
process.exit(failed ? 1 : 0);
