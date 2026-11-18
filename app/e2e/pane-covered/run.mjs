#!/usr/bin/env node
// 덮인 칸 E2E(11-18 사용자 "알림이 떠 있을 때 참모 브라우저 렌더링이 멈춤") — 결정 대기함 팝오버가 칸 귀퉁이를 덮은 3초 동안
// 칸에 깐 그림이 몇 번 바뀌나. 실패하면 종료 1. 참모 브라우저(헤드리스)로 돈다.
//   node app/e2e/pane-covered/run.mjs [캡처 폴더] [--before <커밋>]   — --before 면 그 커밋의 app/src 로(전후 비교)
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const args = process.argv.slice(2);
const bi = args.indexOf('--before');
const before = bi >= 0 ? args.splice(bi, 2)[1] : null;
const out = path.resolve(args[0] ?? path.join(appDir, '../.shots/browser-freeze/e2e'));
fs.mkdirSync(out, { recursive: true });
const tag = before ? 'before' : 'after';

// 옛 소스는 app 안에 풀어야 vite 가 node_modules 를 찾는다(교훈) — 받침 폴더째 같은 모양으로
let root = here;
let old = null;
if (before) {
  old = path.join(appDir, '.qb-before');
  fs.rmSync(old, { recursive: true, force: true });
  fs.mkdirSync(old, { recursive: true });
  execSync(`git archive ${before} app/src | tar -x -C "${old}" --strip-components=1`, { cwd: path.resolve(appDir, '..') });
  root = path.join(old, 'e2e/pane-covered');
  fs.cpSync(here, root, { recursive: true });
}

const PORT = 47441;
const base = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 20; i++) { try { await fetch(base); console.log('포트가 이미 쓰는 중'); process.exit(1); } catch { break; } }
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'pane-covered-e2e-'));
// detached + 그룹째 끄기 — vite.kill() 은 node 자식이 남아 포트를 쥔다(교훈)
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(root, 'vite.config.ts')], { cwd: appDir, env: { ...process.env, E2E_CACHE: cache }, stdio: 'ignore', detached: true });
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };

const require = createRequire(import.meta.url);
const { launch } = require(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch { /* 아직 */ } await sleep(250); }

const { context, release } = await launch('pane-covered-shot', { headless: true });
try {
  const p = await context.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.setViewportSize({ width: 900, height: 560 });
  await p.goto(base);
  await p.waitForFunction(() => window.__places?.length > 0);
  await sleep(600);
  await p.evaluate(() => window.__open(true));
  await p.waitForSelector('.inbox-pop');
  await sleep(400);
  await p.screenshot({ path: path.join(out, `${tag}-0s.png`) });
  // 덮인 3초 — 칸 img 가 보인 그림 번호를 0.1초마다 적는다
  const seen = await p.evaluate(async () => {
    const got = new Set();
    for (let i = 0; i < 30; i++) {
      const src = document.querySelector('.e2e-still')?.getAttribute('src') ?? '';
      got.add(decodeURIComponent(src).match(/>(\d+)<\/text>/)?.[1] ?? '');
      await new Promise((r) => setTimeout(r, 100));
    }
    return [...got];
  });
  await p.screenshot({ path: path.join(out, `${tag}-3s.png`) });
  const places = await p.evaluate(() => window.__places.slice(-3));
  const covered = await p.evaluate(() => document.querySelector('.inbox-pop') !== null);
  console.log(`[${tag}] 덮인 3초 동안 칸 그림 ${seen.length}가지(${seen.join(',')}) · 마지막 place ${JSON.stringify(places.at(-1))}`);
  ok('팝오버가 칸을 덮은 채', covered);
  ok('덮인 동안 칸 그림이 계속 바뀐다(3초에 5가지 이상)', seen.length >= 5, `${seen.length}가지`);
  ok('화면 오류 없음', errs.length === 0, errs.join(' | ').slice(0, 300));
} catch (e) {
  failed++;
  console.log('FAIL 멈춤', e);
} finally {
  await release();
  try { process.kill(-vite.pid); } catch { /* 이미 꺼짐 */ }
  fs.rmSync(cache, { recursive: true, force: true });
  if (old) fs.rmSync(old, { recursive: true, force: true });
}
console.log(failed ? `실패 ${failed}` : '전부 통과');
process.exit(failed ? 1 : 0);
