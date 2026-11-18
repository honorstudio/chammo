#!/usr/bin/env node
// 메모 창 '교훈' 탭 — 참모 창마다 그 참모 기억 칸 + 공통 교훈이 뜨나(옛 판은 누구를 열어도 같은 HQ 프로젝트 교훈), 기억 줄 지우기·규칙 되돌리기 길.
// node app/e2e/chief-lessons/run.mjs [캡처 폴더] [참모A,참모B] — 진짜 데이터 폴더 파일을 읽기만 하고(가짜 명령이 메모리 안에서 고친다) 참모 브라우저 헤드리스로 찍는다. 실패하면 종료 1
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(appDir, '../.shots/chief-lessons'));
const chiefs = (process.argv[3] ?? '참모-2,참모-8').split(',');
fs.mkdirSync(out, { recursive: true });
const data = process.env.CHAMMO_HOME || path.join(os.homedir(), '.honor-orchestrator');
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const real = {
  'honor-orchestrator': read(path.join(data, 'lessons/honor-orchestrator.md')),
  _common: read(path.join(data, 'lessons/_common.md')),
  ...Object.fromEntries(chiefs.map((c) => [`orch:${c}`, read(path.join(data, 'memory/orch', c, 'MEMORY.md'))])),
};
const count = (t) => t.split('\n').filter((l) => l.startsWith('- ')).length;
const PORT = 47583;
const base = `http://127.0.0.1:${PORT}/`;
try { await fetch(base); console.log(`FAIL 포트 ${PORT} 가 이미 쓰인다`); process.exit(1); } catch { /* 비었다 */ }
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'chief-lessons-'));
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], { cwd: appDir, env: { ...process.env, E2E_PORT: String(PORT), E2E_CACHE: cache }, stdio: 'ignore', detached: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
const require = createRequire(import.meta.url);
const { launch } = require(path.join(os.homedir(), '.honor-orchestrator/tools/chammo-browser'));
for (let i = 0; i < 120; i++) { try { if ((await fetch(base)).ok) break; } catch { /* 아직 */ } await sleep(250); }
const { context, release } = await launch('chief-lessons-e2e', { headless: true });

async function open(mode, fix, names = chiefs) {
  const p = await context.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.setViewportSize({ width: 920, height: 720 });
  await p.addInitScript((f) => { window.__FIX = f; }, fix);
  await p.goto(`${base}?mode=${mode}&chiefs=${encodeURIComponent(names.join(','))}`);
  await p.waitForSelector('.chief .memo');
  for (const el of await p.$$('.chief [role=tab]:nth-child(2)')) await el.click();
  await sleep(300);
  return { p, errs };
}
const rows = (p, name) => p.$$eval(`.chief[data-name="${name}"] .lesson-item .memo-text`, (es) => es.map((e) => e.textContent));
const tabCount = (p, name) => p.$eval(`.chief[data-name="${name}"] [role=tab]:nth-child(2)`, (e) => e.textContent);

try {
  // 전: 옛 App 처럼 프로젝트(honor-orchestrator)로 — 두 참모가 같은 교훈
  {
    const { p, errs } = await open('before', real);
    const [a, b] = [await rows(p, chiefs[0]), await rows(p, chiefs[1])];
    ok('전 — 두 참모가 같은 목록', JSON.stringify(a) === JSON.stringify(b), `${a.length}줄`);
    await p.screenshot({ path: path.join(out, 'before.png') });
    ok('전 페이지 오류 없음', errs.length === 0, errs.join(' | '));
    await p.close();
  }
  // 후: 참모마다 자기 기억 + 공통
  {
    const { p, errs } = await open('after', real);
    for (const c of chiefs) {
      const want = count(real[`orch:${c}`]);
      ok(`후 — ${c} 탭 숫자 = 기억 ${want}줄`, (await tabCount(p, c)).replace(/\D/g, '') === (want ? String(want) : ''), await tabCount(p, c));
      ok(`후 — ${c} 목록 = 기억 + 공통`, (await rows(p, c)).length === want + count(real._common));
    }
    const [a, b] = [await rows(p, chiefs[0]), await rows(p, chiefs[1])];
    ok('후 — 두 참모 목록이 다르다', JSON.stringify(a) !== JSON.stringify(b));
    ok('후 — 색인 링크는 제목만', !a.concat(b).some((t) => /\]\([^)]*\.md\)/.test(t)));
    await p.screenshot({ path: path.join(out, 'after.png') });
    ok('후 페이지 오류 없음', errs.length === 0, errs.join(' | '));
    await p.close();
  }
  // 동작: 지어낸 칸으로 — 그냥 줄 지우기 = 기억 파일 쓰기, 규칙 줄 = memory undo, 색인 줄엔 '공통으로' 없음
  {
    const fix = { _common: '- 공통 하나\n', 'orch:시험': '## 메모\n- [제목](a.md) — 설명\n- 그냥 기억\n- 자동 규칙 <!-- r-ab12 -->\n' };
    const { p, errs } = await open('after', fix, ['시험']);
    const item = (t) => p.locator('.chief .lesson-item', { hasText: t });
    ok('색인 줄엔 공통으로 없음', (await item('제목').locator('button').count()) === 1);
    ok('그냥 줄엔 공통으로 있음', (await item('그냥 기억').locator('button').count()) === 2);
    await item('그냥 기억').locator('button').last().click();
    await item('그냥 기억').locator('button').last().click();
    await sleep(300);
    await item('자동 규칙').locator('button').last().click();
    await item('자동 규칙').locator('button').last().click();
    await sleep(300);
    const calls = await p.evaluate(() => window.__calls.filter((c) => c.cmd !== 'read_lessons'));
    ok('그냥 줄 → orch:시험 파일에서 뺌', calls.some((c) => c.cmd === 'write_lessons' && c.args.name === 'orch:시험' && !String(c.args.content).includes('그냥 기억')), JSON.stringify(calls));
    ok('규칙 줄 → undo_memory_rule r-ab12', calls.some((c) => c.cmd === 'undo_memory_rule' && c.args.id === 'r-ab12'));
    ok('기억 줄은 프로젝트 거울을 안 건드림', !calls.some((c) => c.cmd === 'unmirror_lesson'));
    ok('남은 줄 = 색인 + 공통', JSON.stringify(await rows(p, '시험')) === JSON.stringify(['제목 — 설명', '공통 하나']), JSON.stringify(await rows(p, '시험')));
    ok('동작 페이지 오류 없음', errs.length === 0, errs.join(' | '));
    await p.close();
  }
} finally {
  await release();
  try { process.kill(-vite.pid); } catch { /* 끝남 */ }
}
console.log(failed ? `FAIL ${failed}` : 'PASS');
process.exit(failed ? 1 : 0);
