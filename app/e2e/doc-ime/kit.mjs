// 문서 키 E2E 공용(notion-keys.mjs) — wk.swift 빌드, 빈 포트 확인, vite(doc-table 받침) 띄우기·예열, 단계 돌리기, 키·커서·나무 도우미
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');

export async function start(port) {
  const base = `http://127.0.0.1:${port}/`;
  // 포트에 옛 서버(끝난 시험이 남긴 vite)가 있으면 그걸 보고 엉뚱하게 통과·실패한다
  try { await fetch(base); console.log(`FAIL 포트 ${port} 에 이미 서버가 있다 — E2E_PORT=<빈 포트> 로 다시`); process.exit(1); } catch { /* 비었다 */ }
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-keys-'));
  const wk = path.join(cache, 'wk');
  execFileSync('swiftc', ['-O', path.join(here, 'wk.swift'), '-o', wk], { stdio: 'inherit' });
  const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(appDir, 'e2e/doc-table/vite.config.ts')],
    { cwd: appDir, env: { ...process.env, E2E_PORT: String(port), E2E_CACHE: path.join(cache, 'vite') }, stdio: 'ignore', detached: true });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch { /* 아직 */ } await new Promise((r) => setTimeout(r, 250)); }
  const run = (steps, md) => {
    const f = path.join(cache, 'steps.json');
    fs.writeFileSync(f, JSON.stringify(steps));
    const r = spawnSync(wk, [`${base}?p=/E/q.md&md=${encodeURIComponent(md)}`, f], { encoding: 'utf8', timeout: 120_000 });
    return r.stdout.split('\n').filter((l) => l.startsWith('R ')).map((l) => JSON.parse(l.slice(2)).v);
  };
  run([...ready, { wait: 1 }, ...ready], '예열\n'); // 새 vite 캐시는 첫 판에 의존성을 묶고 페이지를 다시 읽는다
  let failed = 0;
  return {
    run,
    ok(name, cond, extra = '') { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); },
    crash(e) { failed++; console.log('FAIL 하네스', e); },
    done() {
      try { process.kill(-vite.pid); } catch { /* 이미 꺼짐 */ }
      fs.rmSync(cache, { recursive: true, force: true });
      console.log(failed ? `실패 ${failed}` : '모두 통과');
      process.exit(failed ? 1 : 0);
    },
  };
}

export const ready = [{ js: 'for (let i = 0; i < 400 && !(document.querySelector(".ProseMirror")?.editor && document.querySelector(".bn-block-content")); i++) await new Promise((r) => setTimeout(r, 100)); await new Promise((r) => setTimeout(r, 800)); return 1' }];
export const key = (code, chars, mods) => ({ key: code, chars, ...(mods ? { mods } : {}), gap: 0.15 });
export const K = {
  ENTER: key(36, '\r'), BS: key(51, '\u007f'), DEL: key(117, ''), TAB: key(48, '\t'), STAB: key(48, '\t', ['shift']), ESC: key(53, '\x1b'),
  SENTER: key(36, '\r', ['shift']), UP: key(126, ''), DOWN: key(125, ''), CMDENTER: key(36, '\r', ['cmd']),
};
/** 영문 자판 글자 하나씩 진짜 키로(단축 입력은 키 사건으로 돌아야 한다) */
const CODES = { '-': [27], '*': [28, 1], '+': [24, 1], '1': [18], '.': [47], '[': [33], ']': [30], '#': [20, 1], '>': [47, 1], '`': [50], '"': [39, 1], ' ': [49], a: [0], i: [34], x: [7] };
export const typeKeys = (s) => [...s].map((c) => { const [code, shift] = CODES[c]; return key(code, c, shift ? ['shift'] : undefined); });
export const J = (expr) => ({ js: `return JSON.stringify(${expr})` });
const at = (t, end) => ({ js: `const t = __tip(); let at = -1; t.state.doc.descendants((n, p) => { if (n.isText && n.text.includes(${JSON.stringify(t)})) at = p + ${end ? 'n.nodeSize' : '0'}; }); t.commands.focus(); t.commands.setTextSelection(at); return at` });
export const endOf = (t) => at(t, true);
export const startOf = (t) => at(t, false);
const flat = (tree, d = 0) => tree.flatMap(([t, x, kids]) => [`${'  '.repeat(d)}${t}:${x}`, ...flat(kids, d + 1)]);
/** 끝에 붙이는 관찰 — 나무·커서(블록 종류·글·자리)·[체크 상태·줄바꿈·토글 열림] */
export const LOOK = [J('__tree()'),
  J('(() => { const $f = __tip().state.selection.$from; return [$f.parent.type.name, $f.parent.textContent, $f.parentOffset]; })()'),
  J('(() => { const o = []; __tip().state.doc.descendants((n) => { if (n.type.name === "checkListItem") o.push(n.attrs.checked); if (n.type.name === "hardBreak") o.push("br"); }); document.querySelectorAll(".bn-toggle-wrapper").forEach((w) => o.push(`open:${w.getAttribute("data-show-children")}`)); return o; })()')];
export const read = (rs) => { const [t, c, x] = rs.slice(-3).map((v) => JSON.parse(v)); return { t: flat(t), c, x }; };
