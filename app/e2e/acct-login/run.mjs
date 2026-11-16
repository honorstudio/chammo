#!/usr/bin/env node
// 계정 메뉴 '로그인 필요' 줄 E2E(2026-11-13 — 누르면 로그인 대신 첫 계정으로 바뀌던 버그).
// 진짜 AccountPopover·useAccountAuto 에 가짜 계정 셋(index.html) — 진짜 로그인·키체인·~/.claude 는 안 건드린다.
//  1) 로그인 필요 줄 누름 → 바꾸기를 안 부르고 그 계정 로그인 터미널이 뜨고, 자동 전환 한 차례(15초)가 지나도 지금 계정 그대로
//  2) 사용량 주소가 쉬는 중(제일 나쁜 경우)에 로그인이 끝남 → 그 계정으로 바뀌어 고정되고, 다음 차례에 첫 계정으로 되돌아가지 않는다
//  3) 로그인 중 팝오버를 닫음 → 쉬기는 남고(자동 전환이 안 끼어듦), 로그인이 끝나면 자동 전환이 마무리(그 계정 고정·막힘 풀림)
//  4) 설정 › 계정 — 약관 칸 '이 계정으로'는 막힘 풀고 바꿈(안 되돌아감), 로그인 필요 칸은 '로그인' → 바꾸기 없이 터미널
//  5) 폰 계정 시트 — 로그인 필요 칸은 바꾸기 요청 없이 이유 한 줄, 약관 칸은 확인 → 바꿈(안 되돌아감)
// node app/e2e/acct-login/run.mjs [캡처 폴더] — 참모 브라우저(헤드리스)로 돈다. 실패하면 종료 1
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(appDir, '../.shots/acct-login/e2e'));
fs.mkdirSync(out, { recursive: true });
const PORT = 47439;
const base = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { await fetch(base); console.error(`포트 ${PORT} 를 다른 게 쥐고 있어 — 먼저 꺼`); process.exit(2); } catch { /* 비었다 */ }
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'acct-login-e2e-'));
// detached + 묶음째 끄기 — vite.kill() 만 하면 node 자식이 포트를 쥐고 남는다
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], { cwd: appDir, env: { ...process.env, E2E_CACHE: cache }, stdio: 'ignore', detached: true });
const stopVite = () => { try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* 이미 */ } };
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };

const require = createRequire(import.meta.url);
const { launch } = require(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch { /* 아직 */ } await sleep(250); }

const { context, release } = await launch('acct-login-e2e', { headless: true });
try {
  const p = await context.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.setViewportSize({ width: 560, height: 620 });
  const S = () => p.evaluate(() => JSON.parse(JSON.stringify(window.__S)));
  const switches = () => p.evaluate(() => window.__calls.filter((c) => c.cmd === 'accounts_switch').map((c) => `${c.active}→${c.args.id}`));
  const shot = (name) => p.screenshot({ path: path.join(out, `${name}.png`) });

  await p.goto(base);
  await p.waitForSelector('.e2e-chip:has-text("tteok")');
  await p.click('.e2e-chip');
  await p.waitForSelector('.acct-pop');
  await sleep(300);
  await shot('1-menu');
  const row = p.locator('.acct-pop-row', { hasText: 'mandu.studio' });
  ok('로그인 필요 줄에 "로그인 필요"', (await row.textContent()).includes('로그인 필요'));
  ok('로그인 필요 줄 이름표 = 로그인', (await row.getAttribute('aria-label')) === 'mandu.studio 계정 로그인', String(await row.getAttribute('aria-label')));

  // 1) 누름 → 로그인 터미널, 바꾸기 없음. 자동 전환 한 차례(15초)를 넘겨 본다
  await row.click();
  await sleep(1500);
  await shot('2-login-open');
  await sleep(18_500);
  let s = await S();
  ok('바꾸기를 안 불렀다', (await switches()).length === 0, (await switches()).join(', ') || '없음');
  ok('지금 계정 그대로(tteok)', s.active === 't', `active=${s.active}`);
  ok('고정도 그대로', s.auto.pinned === 't', `pinned=${s.auto.pinned}`);
  ok('위 칩도 tteok', (await p.textContent('.e2e-chip')) === 'tteok', await p.textContent('.e2e-chip'));
  ok('로그인 터미널이 떴다', await p.isVisible('.acct-pop-term'));
  const pty = await p.evaluate(() => window.__calls.filter((c) => c.cmd === 'pty_open').map((c) => c.args.command));
  ok('그 계정 이메일로 claude auth login', pty.some((c) => c.includes("auth login --email 'mandu@example.com'")), pty.join(' | ') || '안 불림');
  await shot('3-after-auto-round');

  // 2) 사용량 주소가 쉬는 중에 로그인이 끝남 — 키체인이 그 계정이 된 순간 자동 전환이 끼어들면 첫 계정으로 되돌린다
  await p.evaluate(() => { window.__S.usageMode = 'rate'; window.__login('m'); });
  await sleep(26_000);
  s = await S();
  ok('로그인한 계정으로 바뀌어 고정', s.active === 'm' && s.auto.pinned === 'm', `active=${s.active} pinned=${s.auto.pinned}`);
  ok('그 칸 로그인 막힘이 풀렸다', !s.auto.slots.m?.why && !s.auto.slots.m?.blockedUntil, JSON.stringify(s.auto.slots.m));
  ok('첫 계정(kimchi)으로 되돌아가지 않았다', !(await switches()).some((x) => x.endsWith('→k')), (await switches()).join(', ') || '없음');
  ok('터미널은 닫혔다', !(await p.isVisible('.acct-pop-term')));
  ok('위 칩 = mandu.studio', (await p.textContent('.e2e-chip')) === 'mandu.studio', await p.textContent('.e2e-chip'));
  await shot('4-after-login');

  // 3) 로그인 중 팝오버를 닫음 — 터미널은 닫혀도 쉬기는 남는다(다른 길로 로그인이 끝나도 마무리)
  await p.goto(base);
  await p.waitForSelector('.e2e-chip:has-text("tteok")');
  await p.click('.e2e-chip');
  await p.locator('.acct-pop-row', { hasText: 'mandu.studio' }).click();
  await p.waitForSelector('.acct-pop-term', { timeout: 5000 }).catch(() => {}); // 고치기 전 판은 안 뜬다 — 멈추지 말고 아래 판정으로
  await p.keyboard.press('Escape');
  await sleep(500);
  ok('[닫음] 팝오버가 닫혔다', !(await p.isVisible('.acct-pop')));
  await sleep(18_000);
  s = await S();
  ok('[닫음] 닫은 뒤에도 바꾸기 없음·지금 계정 그대로', (await switches()).length === 0 && s.active === 't', `${(await switches()).join(', ') || '없음'} active=${s.active}`);
  await p.evaluate(() => { window.__S.usageMode = 'rate'; window.__login('m'); });
  await sleep(15_000);
  s = await S();
  ok('[닫음] 로그인이 끝나자 자동 전환이 그 계정으로 고정', s.active === 'm' && s.auto.pinned === 'm', `active=${s.active} pinned=${s.auto.pinned}`);
  ok('[닫음] 그 칸 막힘 풀림·첫 계정으로 안 감', !s.auto.slots.m?.why && !(await switches()).some((x) => x.endsWith('→k')), `${JSON.stringify(s.auto.slots.m)} · ${(await switches()).join(', ')}`);
  await shot('5-closed-then-login');

  // 4) 설정 › 계정 — 약관 칸 먼저(로그인을 시작하면 자동 전환이 쉬어 되돌림을 못 본다)
  await p.goto(`${base}?s=settings`);
  await p.waitForSelector('.e2e-settings .acct-row');
  const srow = (email) => p.locator('.e2e-settings .acct-row', { hasText: email });
  ok('[설정] 로그인 필요 칸 버튼 = 로그인', (await srow('mandu@example.com').locator('button.btn.pri').textContent()) === '로그인');
  ok('[설정] 약관 칸 버튼 = 이 계정으로', (await srow('pajeon@example.com').locator('button.btn.pri').textContent()) === '이 계정으로');
  await srow('pajeon@example.com').locator('button.btn.pri').click();
  await sleep(18_000);
  s = await S();
  ok('[설정] 약관 칸으로 바뀌어 고정·막힘 풀림', s.active === 'p' && s.auto.pinned === 'p' && !s.auto.slots.p?.why, `active=${s.active} pinned=${s.auto.pinned} ${JSON.stringify(s.auto.slots.p)}`);
  ok('[설정] 첫 계정으로 안 되돌아감', (await switches()).join(',') === 't→p', (await switches()).join(', '));
  await srow('mandu@example.com').locator('button.btn.pri').click();
  await sleep(4000);
  s = await S();
  ok('[설정] 로그인 → 바꾸기 없이 그 계정 로그인 터미널', (await switches()).join(',') === 't→p' && s.active === 'p' && await p.isVisible('.e2e-settings .su-term'), `${(await switches()).join(', ')} active=${s.active}`);
  const spty = await p.evaluate(() => window.__calls.filter((c) => c.cmd === 'pty_open').map((c) => c.args.command));
  ok('[설정] 그 계정 이메일로 claude auth login', spty.some((c) => c.includes("auth login --email 'mandu@example.com'")), spty.join(' | ') || '안 불림');
  await shot('6-settings');

  // 5) 폰 계정 시트
  await p.goto(`${base}?s=phone`);
  await p.waitForSelector('.e2e-phone .m-acct-tile');
  const tile = (name) => p.locator('.e2e-phone .m-acct-tile', { hasText: name });
  await tile('mandu.studio').click();
  await sleep(500);
  const perr = await p.textContent('.e2e-phone .m-error').catch(() => null);
  ok('[폰] 로그인 필요 칸 — 이유 한 줄', !!perr && perr.includes('로그인이 풀렸어요') && perr.includes('계정 메뉴'), String(perr));
  ok('[폰] 확인 창도 바꾸기 요청도 없다', !(await p.isVisible('.e2e-phone .m-sleep-card')) && (await p.evaluate(() => window.__calls.filter((c) => c.cmd === 'phone_switch').length)) === 0);
  await shot('7-phone-login');
  await tile('pajeon').click();
  await p.click('.e2e-phone .m-send');
  await sleep(18_000);
  s = await S();
  ok('[폰] 약관 칸 확인 → 바뀌어 고정·막힘 풀림', s.active === 'p' && s.auto.pinned === 'p' && !s.auto.slots.p?.why, `active=${s.active} pinned=${s.auto.pinned}`);
  ok('[폰] 첫 계정으로 안 되돌아감', (await switches()).length === 0, (await switches()).join(', ') || '없음');

  ok('페이지 오류 없음', errs.length === 0, errs.join(' | '));
} finally {
  await release();
  stopVite();
}
console.log(failed ? `\n${failed}개 실패` : '\n전부 통과');
process.exit(failed ? 1 : 0);
