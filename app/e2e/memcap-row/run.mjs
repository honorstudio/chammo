#!/usr/bin/env node
// 메모리 상한 줄 — 한 줄로 그려지나·값 바꾸면 저장되나·전체가 프로필보다 작으면 맞춰지나·이상한 값은 되돌아가나. 실패하면 종료 1.
// node app/e2e/memcap-row/run.mjs [캡처 폴더] — 참모 브라우저(창 없음)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(appDir, '../.shots/browser-memcap'));
fs.mkdirSync(out, { recursive: true });
const PORT = 47561;
const base = `http://127.0.0.1:${PORT}/`;
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'memcap-row-'));
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], { cwd: appDir, env: { ...process.env, E2E_PORT: String(PORT), E2E_CACHE: cache }, stdio: 'ignore', detached: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
const require = createRequire(import.meta.url);
const { launch } = require(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
for (let i = 0; i < 120; i++) { try { if ((await fetch(base)).ok) break; } catch { /* 아직 */ } await sleep(250); }
const { context, release } = await launch('memcap-row-e2e', { headless: true });
try {
  for (const dark of [false, true]) {
    const p = await context.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.setViewportSize({ width: 600, height: 140 });
    await p.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await p.goto(base);
    await p.waitForSelector('.su-memcap input');
    const row = await p.$eval('.su-memcap', (e) => ({ h: e.getBoundingClientRect().height, text: e.textContent }));
    ok(`${dark ? '어둠' : '밝음'} 한 줄로 그려짐`, row.h <= 40, `${row.h}px · ${row.text}`);
    await p.screenshot({ path: path.join(out, `memcap-row-${dark ? 'dark' : 'light'}.png`) });
    if (!dark) {
      const [prof, tot] = await p.$$('.su-memcap input');
      await prof.fill('8'); await prof.press('Enter');
      await sleep(200);
      ok('프로필 8 저장 → 전체 12 그대로', (await tot.inputValue()) === '12' && (await prof.inputValue()) === '8');
      await tot.fill('4'); await tot.press('Enter');
      await sleep(200);
      ok('전체 4 → 프로필(8)에 맞춰 8', (await tot.inputValue()) === '8', await tot.inputValue());
      await prof.fill('0.1'); await prof.press('Enter');
      await sleep(200);
      ok('이상한 값(0.1)은 저장 안 되고 되돌아감', (await prof.inputValue()) === '8', await prof.inputValue());
      const sets = (await p.evaluate(() => window.__calls)).filter((c) => c.cmd === 'browser_memcap_set').length;
      ok('저장 부름 3번(같은 값은 안 부름)', sets === 3, String(sets));
    }
    ok(`${dark ? '어둠' : '밝음'} 페이지 오류 없음`, errs.length === 0, errs.join(' | '));
    await p.close();
  }
} finally {
  await release();
  try { process.kill(-vite.pid); } catch { /* 끝남 */ }
}
console.log(failed ? `FAIL ${failed}` : 'PASS');
process.exit(failed ? 1 : 0);
