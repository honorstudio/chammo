#!/usr/bin/env node
// 첫 설치 E2E — 해피패스(사람 3번 누름)와 예외(받기 실패·브라우저 실패·로그인 안 함·중간에 끄기·계정 추가·윈도우 갈래). 실패하면 종료 1.
// node app/e2e/first-run/run.mjs [캡처 폴더] — 참모 브라우저(창 없음)로 돈다
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(appDir, '../.shots/onboarding/e2e'));
fs.mkdirSync(out, { recursive: true });
const PORT = 47533;
const base = `http://127.0.0.1:${PORT}/`;
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'first-run-e2e-'));
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], { cwd: appDir, env: { ...process.env, E2E_PORT: String(PORT), E2E_CACHE: cache }, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };

const require = createRequire(import.meta.url);
const { launch } = require(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
for (let i = 0; i < 120; i++) { try { if ((await fetch(base)).ok) break; } catch { /* 아직 */ } await sleep(250); }

const { context, release } = await launch('first-run-e2e', { headless: true });
try {
  const errs = [];
  /** 새 맥 흉내 — 빈 저장소 + 조건 */
  const fresh = async (set = {}, opts = {}) => {
    const p = await context.newPage();
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.setViewportSize({ width: 640, height: 440 });
    await p.emulateMedia({ colorScheme: opts.dark ? 'dark' : 'light' });
    if (opts.win) await p.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Windows NT 10.0)' }));
    await p.addInitScript((s) => { if (!sessionStorage.getItem('fake-state')) sessionStorage.setItem('fake-state', JSON.stringify(s)); }, set);
    await p.goto(base);
    await p.waitForSelector('.fr-top');
    return p;
  };
  const calls = (p, cmd) => p.evaluate((c) => window.__fake.calls.filter((x) => x.cmd === c).map((x) => x.args), cmd);
  const text = (p) => p.textContent('.fr');
  const waitText = (p, t, ms = 8000) => p.waitForFunction((x) => document.querySelector('.fr')?.textContent.includes(x), t, { timeout: ms });

  // ── 해피패스: 사람이 누르는 건 시작·로그인·시작하기 셋
  {
    const p = await fresh();
    await p.screenshot({ path: path.join(out, '1-start.png') });
    ok('시작 화면 — 기본 폴더가 이미 정해져 있다', (await text(p)).includes('~/Developer'));
    let clicks = 0;
    const click = async (name) => { clicks++; await p.getByRole('button', { name, exact: true }).click(); };
    await click('시작');
    await waitText(p, '개 중');
    await sleep(120);
    await p.screenshot({ path: path.join(out, '2-prep.png') });
    ok('준비 — n개 중 m개, 큰 % 숫자 없음', /4개 중 \d개/.test(await text(p)) && !(await text(p)).includes('%'));
    ok('터미널 창이 안 보인다', (await p.locator('.xterm').count()) === 0);
    await waitText(p, 'Claude 로그인');
    const cons = await calls(p, 'trust_consent'), fold = await calls(p, 'trust_folders');
    ok('시작 = 폴더 동의, 준비가 믿음을 적는다', cons[0]?.devRoot === '~/Developer' && fold[0]?.devRoot === '~/Developer' && fold[0]?.hqDir === '~/.chammo/hq');
    const order = (await p.evaluate(() => window.__fake.calls.map((c) => c.cmd))).filter((c) => ['trust_consent', 'browser_setup_start', 'trust_folders'].includes(c));
    ok('순서 — 동의 → 브라우저 → 믿음', order.join() === 'trust_consent,browser_setup_start,trust_folders', order.join());
    await p.screenshot({ path: path.join(out, '3-login.png') });
    await click('로그인');
    await p.screenshot({ path: path.join(out, '3-wait.png') });
    await waitText(p, '로그인됐어요');
    await p.screenshot({ path: path.join(out, '3-ok.png') });
    ok('로그인 뒤 다음 단추 없음 — 저절로', (await p.getByRole('button', { name: '다음', exact: true }).count()) === 0);
    await waitText(p, '됐어요!', 7000);
    await sleep(900);
    await p.screenshot({ path: path.join(out, '4-done-rising.png') });
    await sleep(2800);
    await p.screenshot({ path: path.join(out, '4-done-blue.png') });
    ok('끝 — 익명 사용 통계 안내 줄(시작하기 전)', (await text(p)).includes('하루 한 번 익명 사용 통계를 보내요'));
    ok('끝 — 안내 줄이 시작하기 단추 위, 창 안', await p.evaluate(() => { const n = document.querySelector('.fr-note')?.getBoundingClientRect(); const b = document.querySelector('.fr-last .fr-btn')?.getBoundingClientRect(); return !!n && !!b && n.bottom <= b.top + 1 && n.right <= 640; }));
    ok('끝 — 선이 창을 파랗게 채운다', await p.evaluate(() => getComputedStyle(document.querySelector('.fr-flood')).transform === 'matrix(1, 0, 0, 1, 0, 0)'));
    await p.evaluate(() => { window.__noReload = true; });
    await click('시작하기');
    await sleep(300);
    const wc = await calls(p, 'write_config');
    ok('설정 끝 표시를 적는다', wc.at(-1)?.config?.setupDone === true);
    ok('첫 참모 표시를 남긴다', (await p.evaluate(() => localStorage.getItem('firstRunSpawn'))) === '1');
    ok('맥이 알림을 한 번 묻는다', (await calls(p, 'notify_request')).length === 1);
    ok('창을 원래 크기로', (await calls(p, 'first_run_window')).some((a) => a.on === false));
    ok('앱 단추 합계 3', clicks === 3, String(clicks));
    await p.close();
  }

  // ── 받기 실패(오프라인) — 그 자리에 멈추고 다시 시도
  {
    const p = await fresh({ fail: { python: 'curl: (6) Could not resolve host: github.com' } });
    await p.getByRole('button', { name: '시작', exact: true }).click();
    await waitText(p, '인터넷을 확인');
    await sleep(800);
    ok('받기 실패 — 다음 항목으로 안 간다', !(await p.evaluate(() => window.__fake.calls.some((c) => c.cmd === 'browser_setup_start'))));
    ok('맥 참모 도구는 넘기기 없음', (await p.getByRole('button', { name: '나중에', exact: true }).count()) === 0);
    await p.screenshot({ path: path.join(out, 'x-offline.png') });
    await p.getByRole('button', { name: '다시 시도' }).click();
    await waitText(p, 'Claude 로그인');
    ok('다시 시도하면 이어서 끝까지', true);
    await p.close();
  }

  // ── Claude 설치가 망 말고 다른 이유로 한 번 실패 — 저절로 다시(끈 앱의 설치 자물쇠)
  {
    const p = await fresh({ python: true, fail: { claude: 'Another process is currently installing Claude' } });
    await p.clock.install();
    await p.getByRole('button', { name: '시작', exact: true }).click();
    for (let i = 0; i < 80 && !(await text(p)).includes('Claude 로그인'); i++) { await p.clock.runFor(1000); await sleep(30); }
    ok('자물쇠 실패는 저절로 다시 받아 넘어간다', (await text(p)).includes('Claude 로그인') && (await calls(p, 'pty_open')).filter((a) => /install\.sh/.test(a.command)).length === 2);
    await p.close();
  }

  // ── 브라우저 실패 — 안 깔린 채 끝으로 못 간다(필수)
  {
    const p = await fresh({ fail: { browser: '시험으로 열지 못했어요: timeout launching' } });
    await p.getByRole('button', { name: '시작', exact: true }).click();
    await waitText(p, '인터넷을 확인');
    await sleep(1000);
    ok('브라우저 실패 — 로그인으로 못 넘어간다', !(await text(p)).includes('Claude 로그인'));
    await p.getByRole('button', { name: '다시 시도' }).click();
    await waitText(p, 'Claude 로그인');
    ok('브라우저 다시 시도 뒤 통과', true);
    await p.close();
  }

  // ── 로그인 안 함 — 기다리고, 다시 열기는 새로 띄우고, 5분 넘으면 안내, Console 길
  {
    const p = await fresh({ loginDone: false, python: true, claude: true, browser: true });
    await p.clock.install();
    await p.getByRole('button', { name: '시작', exact: true }).click();
    for (let i = 0; i < 40 && !(await text(p)).includes('Claude 로그인'); i++) { await p.clock.runFor(500); await sleep(30); }
    await p.getByRole('button', { name: '로그인', exact: true }).click();
    await waitText(p, "'허용'");
    await p.clock.runFor(60_000);
    ok('로그인 안 하면 끝으로 안 간다', (await text(p)).includes("'허용'") && !(await text(p)).includes('됐어요!'));
    await p.getByRole('button', { name: '다시 열기' }).click();
    await p.clock.runFor(100);
    const before = (await p.evaluate(() => window.__fake.closed.length));
    ok('다시 열기 — 앞 로그인을 끄고 새로', before >= 1 && (await calls(p, 'pty_open')).filter((a) => /auth login/.test(a.command)).length === 2);
    await p.clock.runFor(5 * 60_000 + 1000);
    await waitText(p, '다시 열어 주세요');
    ok('5분 넘으면 안내 + 숨은 로그인 끔', (await p.evaluate(() => window.__fake.closed.length)) > before);
    await p.getByRole('button', { name: /Console/ }).click();
    await p.clock.runFor(100);
    ok('Console 길은 --console', (await calls(p, 'pty_open')).at(-1).command.includes('auth login --console'));
    await p.screenshot({ path: path.join(out, 'x-login-late.png') });
    await p.evaluate(() => { window.__fake.loggedIn = true; window.__fake.live = 'me@example.com'; });
    await p.clock.runFor(4000);
    await waitText(p, '로그인됐어요');
    ok('밖에서 로그인돼도 알아챈다', true);
    await p.close();
  }

  // ── 중간에 끄기 — 다시 켜면 준비부터, 된 건 건너뛴다
  {
    const p = await fresh({ browserMs: 60000, installMs: 100 });
    await p.getByRole('button', { name: '시작', exact: true }).click();
    await p.waitForFunction(() => window.__fake.calls.some((c) => c.cmd === 'browser_setup_start'), null, { timeout: 8000 });
    await p.evaluate(() => { window.__fake.browserMs = 200; window.__save(); });
    await p.reload();
    await p.waitForSelector('.fr-prep');
    ok('다시 켜면 시작 화면이 아니라 준비(동의 기록으로 안다)', !(await text(p)).includes('시작해요'));
    await waitText(p, 'Claude 로그인');
    const installs = (await calls(p, 'pty_open')).filter((a) => /get-tool|install\.sh/.test(a.command));
    ok('받은 건 다시 안 받는다', installs.length === 2, installs.map((a) => a.command.slice(0, 60)).join(' | '));
    await p.close();
  }

  // ── 이미 다 있는 맥 — 시작 한 번이면 로그인도 건너뛰고 끝까지
  {
    const p = await fresh({ python: true, claude: true, browser: true, loggedIn: true });
    await p.getByRole('button', { name: '시작', exact: true }).click();
    await waitText(p, '로그인됐어요');
    await waitText(p, '됐어요!', 7000);
    ok('다 있으면 시작·시작하기 둘로 끝', (await calls(p, 'pty_open')).length === 0);
    await p.close();
  }

  // ── 계정 추가 — 기본 길은 안 늘고, 누르면 멈춰 목록·다음
  {
    const p = await fresh({ python: true, claude: true, browser: true, nextEmail: 'first@example.com' });
    await p.getByRole('button', { name: '시작', exact: true }).click();
    await waitText(p, 'Claude 로그인');
    await p.getByRole('button', { name: '로그인', exact: true }).click();
    await waitText(p, '로그인됐어요');
    await p.evaluate(() => { window.__fake.nextEmail = 'second@example.com'; });
    await p.getByRole('button', { name: '계정 추가', exact: true }).click();
    await waitText(p, 'second@example.com', 8000).catch(() => {});
    await waitText(p, 'first@example.com');
    await p.screenshot({ path: path.join(out, 'x-add-account.png') });
    ok('추가한 계정이 한 줄씩', (await p.locator('.fr-accts li').count()) === 2, await p.locator('.fr-accts').textContent());
    await sleep(4500);
    ok('누른 뒤엔 저절로 안 넘어간다', !(await text(p)).includes('됐어요!'));
    await p.getByRole('button', { name: '다음', exact: true }).click();
    await waitText(p, '됐어요!');
    await p.close();
  }

  // ── 윈도우 — 항목·winget 없음·넘기기
  {
    const p = await fresh({ winget: false }, { win: true });
    await p.getByRole('button', { name: '시작', exact: true }).click();
    await waitText(p, '직접 받은 뒤');
    ok('윈도우 항목 다섯, 참모 도구 줄 없음', /5개 중/.test(await text(p)) && !(await text(p)).includes('참모 도구'));
    ok('받기 링크·나중에', (await p.getByRole('button', { name: '받기', exact: true }).count()) === 1 && (await p.getByRole('button', { name: '나중에', exact: true }).count()) === 1);
    await p.screenshot({ path: path.join(out, 'x-win-nowinget.png') });
    await p.getByRole('button', { name: '나중에', exact: true }).click();
    await waitText(p, '직접 받은 뒤'); // 다음 줄(파이썬)도 같은 안내
    await p.getByRole('button', { name: '나중에', exact: true }).click();
    await waitText(p, 'Claude 로그인');
    ok('둘 다 넘기면 이어서', true);
    const none = (await calls(p, 'pty_open')).filter((a) => /winget/.test(a.command));
    ok('winget 없는 PC 엔 winget 을 안 부른다', none.length === 0);
    await p.close();
  }

  // ── 어두운 화면 캡처
  {
    const p = await fresh({}, { dark: true });
    await p.screenshot({ path: path.join(out, 'd-start.png') });
    await p.close();
  }
  ok('페이지 오류 0', errs.length === 0, errs.slice(0, 3).join(' | '));
} finally {
  await release();
  vite.kill();
  fs.rmSync(cache, { recursive: true, force: true });
}
console.log(failed ? `\n실패 ${failed}개` : '\n다 통과');
process.exit(failed ? 1 : 0);
