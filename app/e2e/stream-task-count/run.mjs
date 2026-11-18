#!/usr/bin/env node
// 폰 일하는 중 줄 E2E(11-17 사용자 폰 "회사 비서는 59개라고 항상 나오다가 스트리밍 끝날 때 사라짐") — 진짜 MessageList 를 헤드리스로.
// 일하는 중(답이 흘러나오는 중)에 '도구 59번' 같은 횟수가 안 보이고 걸린 시간만 · 끝나면 줄째 없음(그건 맞다 — 일하는 중 표시).
// node app/e2e/stream-task-count/run.mjs [캡처 폴더] [--before <옛 app/src>] — --before 면 캡처만. 실패하면 종료 1
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
const out = path.resolve(args[0] ?? path.join(appDir, '../.shots/stream-task-count'));
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stc-e2e-'));
const PORT = before ? 47477 : 47476;
const base = `http://127.0.0.1:${PORT}/`;
try { await fetch(base); console.log(`FAIL ${PORT} 포트에 앞 판 하네스가 떠 있다`); process.exit(1); } catch { /* 비어 있다 */ }
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], {
  cwd: appDir, env: { ...process.env, E2E_PORT: String(PORT), E2E_CACHE: path.join(tmp, 'vite'), ...(before ? { E2E_SRC: before } : {}) }, stdio: 'ignore', detached: true,
});
const stopVite = () => { try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* 이미 꺼짐 */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (before) return; if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await sleep(250); } }
const require = createRequire(import.meta.url);
const { launch } = require(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
const { context, release } = await launch('honor-orchestrator', { headless: true });
try {
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.stack ?? e)));
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto(base);
  await page.waitForSelector('.m-live', { timeout: 30_000 });
  await sleep(300);
  await page.screenshot({ path: path.join(out, `${tag}-phone-streaming.png`) });
  const live = await page.textContent('.m-live');
  ok('일하는 중 줄에 도구 횟수(59)가 없다', !live.includes('59'), live);
  ok('걸린 시간은 그대로', live.includes('1분 15초'), live);
  await page.goto(`${base}?busy=0`);
  await page.waitForSelector('text=메일 12통', { timeout: 30_000 });
  await page.screenshot({ path: path.join(out, `${tag}-phone-done.png`) });
  ok('끝나면 일하는 중 줄이 없다', (await page.$$('.m-live')).length === 0);
  ok('페이지 오류 없음', errs.length === 0, errs.join(' / ').slice(0, 500));
} catch (e) {
  failed++;
  console.log('FAIL', String(e).slice(0, 500));
} finally {
  await release();
  stopVite();
}
process.exit(failed ? 1 : 0);
