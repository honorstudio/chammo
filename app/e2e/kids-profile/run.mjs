#!/usr/bin/env node
// 키즈 참모 프로필 E2E(11-17) — 진짜 AvatarPicker 를 헤드리스로. 부모가 0.5초마다 다시 그려지는 채로
// ① 스위치를 켜고 이름을 바꿔 저장 → 켠 채로 남고 kids_set(on) 이 간다 ② 이미 키즈 참모면 이름만 바꿔 저장해도 꺼지지 않는다 ③ 스위치 크기는 설정 줄 스위치와 같다.
// node app/e2e/kids-profile/run.mjs [캡처 폴더] [--before <옛 app/src>] — --before 면 캡처·측정만(검사 안 함). 실패하면 종료 1
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const args = process.argv.slice(2);
const bi = args.indexOf('--before');
const before = bi >= 0 ? path.resolve(args.splice(bi, 2)[1]) : null;
const tag = before ? 'before' : 'after';
const out = path.resolve(args[0] ?? path.join(appDir, '../.shots/kids-wire'));
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-e2e-'));
const PORT = before ? 47492 : 47491;
const base = `http://127.0.0.1:${PORT}/`;
try { await fetch(base); console.log(`FAIL ${PORT} 포트에 앞 판 하네스가 떠 있다`); process.exit(1); } catch { /* 비어 있다 */ }
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], {
  cwd: appDir, env: { ...process.env, E2E_PORT: String(PORT), E2E_CACHE: path.join(tmp, 'vite'), ...(before ? { E2E_SRC: before } : {}) }, stdio: 'ignore', detached: true,
});
const stopVite = () => { try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* 이미 꺼짐 */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (before) { console.log(`     ${name}${extra ? ` — ${extra}` : ''}`); return; } if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await sleep(250); } }
const { launch } = createRequire(import.meta.url)(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
const { context, release } = await launch('kids-profile-e2e', { headless: true });
const result = {};
try {
  const p = await context.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.stack ?? e)));
  await p.setViewportSize({ width: 760, height: 900 });
  const shot = async (name) => { const box = await p.$('.oa-picker'); await (box ?? p).screenshot({ path: path.join(out, `profile-${tag}-${name}.png`) }); };
  const sw = () => p.$('.oa-kids input');
  const size = () => p.$eval('.oa-kids input', (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return { w: Math.round(r.width), h: Math.round(r.height), pad: s.padding, border: s.borderTopWidth, bg: s.backgroundColor }; });

  // ① 새 참모 — 켜고 이름 바꿔 저장
  await p.goto(base);
  try { await p.waitForSelector('.oa-kids input', { timeout: 30_000 }); } catch (e) { console.log('FAIL 스위치가 안 뜸 —', errs.join(' / ').slice(0, 800)); throw e; }
  await sleep(600);
  await shot('1-open');
  result.switch = await size();
  // 설정 화면 스위치(cfg-sw)와 견준다 — 같은 페이지에 하나 그려 잰다
  result.settingsSwitch = await p.evaluate(() => { const i = document.createElement('input'); i.type = 'checkbox'; i.className = 'cfg-sw'; document.body.appendChild(i); const r = i.getBoundingClientRect(); const o = { w: Math.round(r.width), h: Math.round(r.height) }; i.remove(); return o; });
  ok('스위치 크기가 설정 줄 스위치와 같다', result.switch.w === result.settingsSwitch.w && result.switch.h === result.settingsSwitch.h, `${JSON.stringify(result.switch)} vs ${JSON.stringify(result.settingsSwitch)}`);
  await (await sw()).click();
  await sleep(1600); // 부모가 세 번 넘게 다시 그려진다
  result.onAfterRerender = await p.$eval('.oa-kids input', (e) => e.checked);
  await shot('2-on');
  ok('켠 스위치가 부모가 다시 그려져도 켜진 채', result.onAfterRerender === true);
  const nameBox = p.locator('input.oa-name').first();
  await nameBox.fill('선생님2');
  await sleep(1100);
  result.onAfterRename = await p.$eval('.oa-kids input', (e) => e.checked);
  ok('이름을 바꿔도 켜진 채', result.onAfterRename === true);
  await p.getByRole('button', { name: '저장' }).click();
  await sleep(800);
  result.calls1 = await p.evaluate(() => window.__kidsSet);
  ok('저장하면 kids_set(켬)이 간다', result.calls1.length === 1 && result.calls1[0].on === true && result.calls1[0].key === '참모-5', JSON.stringify(result.calls1));

  // ② 이미 키즈 참모 — 이름만 바꿔 저장해도 안 꺼진다
  await p.goto(`${base}?kid=1&v=${Date.now()}`);
  await p.waitForSelector('.oa-kids input', { timeout: 30_000 });
  await sleep(1600);
  result.kidOpen = await p.$eval('.oa-kids input', (e) => e.checked);
  await shot('3-kid-open');
  ok('키즈 참모를 열면 켜진 채로 보인다', result.kidOpen === true);
  await p.locator('input.oa-name').first().fill('선생님3');
  await sleep(1100);
  await p.getByRole('button', { name: '저장' }).click();
  await sleep(800);
  result.calls2 = await p.evaluate(() => window.__kidsSet);
  result.kidsAfter = await p.evaluate(() => window.__kids);
  ok('이름만 바꿔 저장 — kids_set(끔)이 안 가고 키즈 표시가 남는다', !result.calls2.some((c) => c.on === false) && !!result.kidsAfter['참모-5'], JSON.stringify(result.calls2));
  // ③ 낮은 창 — 내용이 90vh 를 넘어도 글 칸이 눌리지 않는다(11-17 사용자 "입력칸이 이상한데?")
  result.lowWindow = [];
  for (const H of [700, 900, 1100]) {
    await p.setViewportSize({ width: 760, height: H });
    await p.goto(`${base}?kid=1&v=${Date.now()}`);
    await p.waitForSelector('input.oa-name', { timeout: 30_000 });
    await sleep(500);
    result.lowWindow.push({ H, name: await p.$eval('input.oa-name', (e) => Math.round(e.getBoundingClientRect().height)) });
    if (H === 700) await shot('4-low-window');
  }
  ok('낮은 창에서도 이름 칸 36px', result.lowWindow.every((x) => x.name === 36), JSON.stringify(result.lowWindow));
  // ④ 맥 안 아이 화면 미리보기 — 키즈 참모 줄 오른쪽 클릭 메뉴 맨 위 '아이 화면으로'(폰과 같은 말, 11-17 사용자) → 패드 틀, 가로·세로, Esc 는 미리보기만
  if (!before) {
    ok('프로필 창엔 아이 화면 단추가 없다(메뉴로 옮김)', !(await p.$('.oa-kids-view')));
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.goto(`${base}?kid=1&menu=1&v=pv`);
    await p.waitForSelector('#orch-row', { timeout: 30_000 });
    await sleep(600);
    await p.click('#orch-row', { button: 'right' });
    await p.waitForSelector('text=아이 화면으로', { timeout: 10_000 });
    const items = await p.$$eval('[role=menuitem], .od-menu button', (els) => els.map((e) => e.textContent?.trim()).filter(Boolean));
    ok('메뉴 맨 위가 아이 화면으로', items[0] === '아이 화면으로', JSON.stringify(items));
    ok('그 아래 오늘 시간·10분 더', items[1] === '아이 시간 10분 더 · 오늘 12/20분', String(items[1]));
    await sleep(400); // 메뉴가 나타나는 움직임이 끝난 뒤
    await p.screenshot({ path: path.join(out, 'kidsview-after-menu.png'), clip: { x: 0, y: 0, width: 520, height: 420 } });
    await p.click('text=아이 화면으로');
    await p.waitForSelector('.kzp-frame .kz-char', { timeout: 30_000 });
    await sleep(800);
    await p.screenshot({ path: path.join(out, `preview-${tag}-land.png`) });
    const f = await p.$eval('.kzp-frame', (e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
    ok('미리보기 틀이 패드 가로 비율', Math.abs(f.w / f.h - 1180 / 820) < 0.02, JSON.stringify(f));
    await p.click('.kzp-bar button:nth-child(2)');
    await sleep(600);
    await p.screenshot({ path: path.join(out, `preview-${tag}-port.png`) });
    const c = await p.$eval('.kzp-frame .kz-char', (e) => { const r = e.getBoundingClientRect(); const fr = e.closest('.kzp-frame').getBoundingClientRect(); return { cx: Math.round(r.x + r.width / 2 - fr.x), fw: Math.round(fr.width) }; });
    ok('세로 틀이면 캐릭터가 가운데쯤(틀 크기로 배치)', Math.abs(c.cx - c.fw / 2) < c.fw * 0.12, JSON.stringify(c));
    await p.keyboard.press('Escape');
    await sleep(300);
    const gone = { frame: !!(await p.$('.kzp-frame')), row: !!(await p.$('#orch-row')) };
    ok('Esc 로 미리보기를 닫는다', !gone.frame && gone.row, JSON.stringify(gone));
  }
  // ⑤ 설정 부모 잠금(여섯째 조각) — 네 자리만 받고 정하면 '바꾸기'로
  if (!before) {
    await p.setViewportSize({ width: 640, height: 320 });
    await p.goto(`${base}?lock=1&v=lock`);
    await p.waitForSelector('.cfg-kids-lock', { timeout: 30_000 });
    await sleep(300);
    await p.screenshot({ path: path.join(out, 'lock-setting-before.png') });
    await p.fill('.cfg-kids-lock input', '12ab345');
    ok('부모 잠금 칸은 숫자 네 자리만', (await p.inputValue('.cfg-kids-lock input')) === '1234');
    await p.click('.cfg-kids-lock button');
    await p.waitForSelector('.cfg-kids-ok', { timeout: 5000 });
    ok('정하면 바꾸기로', (await p.textContent('.cfg-kids-lock button')) === '바꾸기');
    await p.screenshot({ path: path.join(out, 'lock-setting-after.png') });
    // ⑥ 빠른 대답(API 키)·얼굴로 열기(일곱째 조각) — 키 값은 다시 안 보이고 '넣어 둠' + 지우기 아이콘만
    await p.setViewportSize({ width: 640, height: 360 });
    await p.goto(`${base}?lock=1&pk=1&v=api`);
    await p.waitForSelector('.cfg-kids-key', { timeout: 30_000 });
    await sleep(200);
    await p.screenshot({ path: path.join(out, 'api-setting-before.png') });
    await p.fill('.cfg-kids-key', 'sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE');
    ok('키 칸은 비밀번호 칸(값 안 보임)', (await p.getAttribute('.cfg-kids-key', 'type')) === 'password');
    await p.click('.cfg-kids-row:has(.cfg-kids-key) button');
    await p.waitForSelector('button[aria-label="API 키 지우기"]', { timeout: 5000 });
    const shown = await p.textContent('.cfg-kids-lock');
    ok('넣은 뒤엔 넣어 둠만 — 키 글자는 화면 어디에도 없다', !shown.includes('FAKE') && shown.includes('넣어 둠'), shown);
    ok('얼굴로 열기 줄(패드 1대)', shown.includes('패드 1대'));
    await p.screenshot({ path: path.join(out, 'api-setting-after.png') });
    await p.click('button[aria-label="얼굴로 열기 지우기"]');
    await sleep(200);
    ok('얼굴로 열기 지우면 줄이 사라진다', !(await p.$('button[aria-label="얼굴로 열기 지우기"]')));
  }
  ok('페이지 오류 없음', errs.length === 0, errs.join(' / ').slice(0, 400));
} finally {
  fs.writeFileSync(path.join(out, `profile-${tag}.json`), JSON.stringify(result, null, 1));
  await release();
  stopVite();
}
console.log(failed ? `FAIL ${failed}` : before ? '캡처 끝' : '모두 통과');
process.exit(failed ? 1 : 0);
