#!/usr/bin/env node
// 보관함 폴더 끌어 놓기 전후 캡처 — node app/e2e/locker-folder/run.mjs [캡처 폴더]. 참모 브라우저(헤드리스)로 돈다, 실패하면 종료 1
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(appDir, '../.shots/locker-folder'));
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lkfolder-e2e-'));
const PORT = 47441;
const base = `http://127.0.0.1:${PORT}/`;
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], {
  cwd: appDir, env: { ...process.env, E2E_PORT: String(PORT), E2E_CACHE: path.join(tmp, 'vite') }, stdio: 'ignore', detached: true,
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
const require = createRequire(import.meta.url);
const { launch } = require(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await sleep(250); } }

const { context, release } = await launch('honor-orchestrator', { headless: true });
try {
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.setViewportSize({ width: 1100, height: 640 });
  const shot = async (v) => {
    await page.goto(`${base}?v=${v}`);
    await page.locator('.lk-center').first().waitFor({ timeout: 30000 });
    await sleep(800);
    await page.screenshot({ path: path.join(out, `${v}.png`) });
    return { banner: await page.locator('.banner.warn').allInnerTexts(), text: await page.locator('.lk-center').innerText() };
  };
  const b = await shot('before');
  ok('전 — 전체 경로가 든 막힘 띠', b.banner.join('').includes('폴더는 못 넣어') && b.banner.join('').includes('/H/Desktop'));
  const a = await shot('after');
  ok('후 — 띠 없음, Selects 가 폴더로 보인다', a.banner.length === 0 && a.text.includes('Selects'), a.text.slice(0, 120));
  const o = await shot('open');
  ok('후 — 연결 폴더 안 파일이 보인다', o.text.includes('245A6730.jpg'), o.text.slice(0, 160));
  const f = await shot('fail');
  ok('남는 실패 — 이름과 짧은 까닭만(경로 없음)', f.banner.join('') === '‘Selects’ 를 못 넣었어 — 권한 없음', f.banner.join(''));
  ok('페이지 오류 없음', errs.length === 0, errs.join(' | '));
} finally {
  await release();
  try { process.kill(-vite.pid); } catch { /* 이미 꺼짐 */ }
}
console.log(failed ? `FAIL ${failed}` : 'all ok', '→', out);
process.exit(failed ? 1 : 0);
