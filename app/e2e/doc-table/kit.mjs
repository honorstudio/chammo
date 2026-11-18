// 문서 E2E 공용 — wk.swift 빌드, vite 띄우기, 단계 돌리기(결과 "R" 줄), ok 세기. run.mjs·editor.mjs 가 쓴다
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
export const PORT = Number(process.env.E2E_PORT ?? 47452);
export const base = `http://127.0.0.1:${PORT}/`;

export async function start() {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-e2e-'));
  const wk = path.join(cache, 'wk');
  // 포트에 옛 서버(끝난 시험이 남긴 vite)가 있으면 그걸 보고 엉뚱하게 통과·실패한다 — 시작 전에 비었나 본다
  try { await fetch(base); console.log(`FAIL 포트 ${PORT} 에 이미 서버가 있다 — E2E_PORT=<빈 포트> 로 다시`); process.exit(1); } catch { /* 비었다 */ }
  execFileSync('swiftc', ['-O', path.join(here, 'wk.swift'), '-o', wk], { stdio: 'inherit' });
  const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.ts')], { cwd: appDir, env: { ...process.env, E2E_CACHE: path.join(cache, 'vite') }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch { /* 아직 */ } await new Promise((r) => setTimeout(r, 250)); }
  let failed = 0;
  return {
    /** 단계 목록을 돌려 "R" 줄 값들을 돌려준다(query = 주소 뒤 ?…) */
    run(steps, query = '') {
      const f = path.join(cache, 'steps.json');
      fs.writeFileSync(f, JSON.stringify(steps));
      const r = spawnSync(wk, [base + query, f], { encoding: 'utf8', timeout: 120_000 });
      return r.stdout.split('\n').filter((l) => l.startsWith('R ')).map((l) => JSON.parse(l.slice(2)).v);
    },
    /** 하네스가 터졌을 때 — '모두 통과'로 끝나지 않게(try 의 catch 에서) */
    crash(e) { failed++; console.log('FAIL 하네스', e); },
    ok(name, cond, extra = '') { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); },
    done() {
      vite.kill();
      fs.rmSync(cache, { recursive: true, force: true });
      console.log(failed ? `실패 ${failed}` : '모두 통과');
      process.exit(failed ? 1 : 0);
    },
  };
}

export const C = (r, c, n) => `...__charXY(__cell(${r},${c}),${n})`;
export const PA = (t, n) => `...__charXY(__para('${t}'),${n})`;
export const xy = (...pts) => ({ xy: `return [${pts.join(', ')}]` });
export const drag = (...idx) => [{ move: idx[0] }, { down: idx[0] }, ...idx.slice(1).flatMap((k) => Array.from({ length: 8 }, () => ({ drag: k, gap: 0.03 }))), { up: idx[idx.length - 1], gap: 0.3 }];
export const click = (k) => [{ move: k }, { move: k }, { down: k }, { up: k, gap: 0.25 }];
export const ready = [{ wait: 3 }, { js: 'return document.querySelectorAll(".bn-block-content").length' }];
