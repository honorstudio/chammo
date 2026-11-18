#!/usr/bin/env node
// 새 세션 기본 모델 칸 — 데스크톱 설정(참모 탭)·폰 더보기. 전(길 없는 맥 = 칸 없음)·후 캡처, 고르면 저장되나, 모델을 바꾸면 못 받는 노력값이 풀리나.
// node app/e2e/default-model/run.mjs [캡처 폴더] — 참모 브라우저(창 없음). 실패하면 종료 1
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(appDir, '../.shots/default-model'));
fs.mkdirSync(out, { recursive: true });
const PORT = 47583;
const busy = await new Promise((r) => { const s = net.connect(PORT, '127.0.0.1', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
if (busy) { console.log(`FAIL 포트 ${PORT} 를 다른 것이 쥐고 있다`); process.exit(1); }
const base = `http://127.0.0.1:${PORT}/`;
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'default-model-'));
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], { cwd: appDir, env: { ...process.env, E2E_PORT: String(PORT), E2E_CACHE: cache }, stdio: 'ignore', detached: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
const require = createRequire(import.meta.url);
const { launch } = require(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
for (let i = 0; i < 120; i++) { try { if ((await fetch(base)).ok) break; } catch { /* 아직 */ } await sleep(250); }
const { context, release } = await launch('default-model-e2e', { headless: true });
const page = async (qs, size) => {
  const p = await context.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.setViewportSize(size);
  await p.goto(`${base}?${qs}`);
  await sleep(1200);
  return { p, errs };
};
try {
  for (const when of ['before', 'after']) {
    const b = when === 'before' ? '&before=1' : '';
    // 데스크톱 설정 — 참모 탭
    {
      const { p, errs } = await page(`view=desktop${b}`, { width: 900, height: 640 });
      await p.waitForSelector('.cfg-modal');
      const has = await p.$('.su-model select');
      ok(`${when} 데스크톱 칸 ${when === 'before' ? '없음' : '있음'}`, when === 'before' ? !has : !!has);
      await p.screenshot({ path: path.join(out, `desktop-${when}.png`) });
      if (when === 'after') {
        const [m, e] = await p.$$('.su-model select');
        const labels = await m.$$eval('option', (os) => os.map((o) => o.textContent));
        ok('첫 칸이 전역 기본값', labels[0] === '기본 (Opus 5.5)', labels.join(' / '));
        await m.selectOption('sonnet');
        await e.selectOption('xhigh');
        await p.screenshot({ path: path.join(out, 'desktop-after-picked.png') });
        await p.click('.su-go');
        await sleep(400);
        const saved = await p.evaluate(() => JSON.parse(sessionStorage.getItem('saved') ?? 'null'));
        ok('저장하면 config 에 sonnet·xhigh', saved?.defaultModel === 'sonnet' && saved?.defaultEffort === 'xhigh', JSON.stringify({ m: saved?.defaultModel, e: saved?.defaultEffort }));
      }
      ok(`${when} 데스크톱 페이지 오류 없음`, errs.length === 0, errs.join(' | '));
      await p.close();
    }
    // 폰 더보기
    for (const dark of [false, true]) {
      const { p, errs } = await page(`view=phone${b}`, { width: 390, height: 640 });
      if (dark) await p.emulateMedia({ colorScheme: 'dark' });
      const has = await p.$('.m-mo-model select');
      ok(`${when} 폰 칸 ${when === 'before' ? '없음' : '있음'}${dark ? ' (어둠)' : ''}`, when === 'before' ? !has : !!has);
      await sleep(300);
      await p.screenshot({ path: path.join(out, `phone-${when}${dark ? '-dark' : ''}.png`) });
      if (when === 'after' && !dark) {
        const [m] = await p.$$('.m-mo-model select');
        const h = await m.evaluate((x) => x.getBoundingClientRect().height);
        ok('폰 고르기 손가락 44px', h >= 44, `${h}px`);
        await m.selectOption('haiku');
        await sleep(300);
        const posts = await p.evaluate(() => window.__posts);
        ok('폰에서 고르면 바로 저장', JSON.stringify(posts) === JSON.stringify([{ model: 'haiku', effort: '' }]), JSON.stringify(posts));
        const wide = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
        ok('폰 가로로 안 넘침', wide);
      }
      ok(`${when} 폰 페이지 오류 없음${dark ? ' (어둠)' : ''}`, errs.length === 0, errs.join(' | '));
      await p.close();
    }
  }
} finally {
  await release();
  try { process.kill(-vite.pid); } catch { /* 끝남 */ }
}
console.log(failed ? `FAIL ${failed}` : 'PASS');
process.exit(failed ? 1 : 0);
