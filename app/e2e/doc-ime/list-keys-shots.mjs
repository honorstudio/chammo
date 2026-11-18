#!/usr/bin/env node
// 목록 지우기 전후 캡처(사용자 '새 문서 9.md' 두 장면) — list-keys.mjs 와 같은 화면 밖 WKWebView. node app/e2e/doc-ime/list-keys-shots.mjs <폴더> <앞이름>
// 장면마다 키를 누른 뒤 '글'을 쳐서 커서가 간 자리가 보이게 한다
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [outDir, tag] = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const PORT = Number(process.env.E2E_PORT ?? 47465);
const base = `http://127.0.0.1:${PORT}/`;
try { await fetch(base); console.log(`포트 ${PORT} 에 이미 서버가 있다`); process.exit(1); } catch { /* 비었다 */ }
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-shots-'));
const wk = path.join(cache, 'wk');
execFileSync('swiftc', ['-O', path.join(here, 'wk.swift'), '-o', wk], { stdio: 'inherit' });
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(appDir, 'e2e/doc-table/vite.config.ts')],
  { cwd: appDir, env: { ...process.env, E2E_PORT: String(PORT), E2E_CACHE: path.join(cache, 'vite') }, stdio: 'ignore', detached: true });
for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch { /* 아직 */ } await new Promise((r) => setTimeout(r, 250)); }
const run = (steps, md) => {
  const f = path.join(cache, 'steps.json');
  fs.writeFileSync(f, JSON.stringify(steps));
  return spawnSync(wk, [`${base}?p=/E/q.md&md=${encodeURIComponent(md)}`, f], { encoding: 'utf8', timeout: 120_000 }).stdout;
};
const key = (code, chars, mods) => ({ key: code, chars, ...(mods ? { mods } : {}), gap: 0.25 });
const ENTER = key(36, '\r'), BS = key(51, '\u007f'), TAB = key(48, '\t');
const endOf = (t) => ({ js: `const t = __tip(); let at = -1; t.state.doc.descendants((n, p) => { if (n.isText && n.text.includes(${JSON.stringify(t)})) at = p + n.nodeSize; }); t.commands.focus(); t.commands.setTextSelection(at); return at` });
const ready = [{ js: 'for (let i = 0; i < 400 && !(document.querySelector(".ProseMirror")?.editor && document.querySelector(".bn-block-content")); i++) await new Promise((r) => setTimeout(r, 100)); await new Promise((r) => setTimeout(r, 800)); return 1' }];
const shot = (name) => ({ shot: path.join(outDir, `${tag}-${name}.png`), gap: 0.3 });
fs.mkdirSync(outDir, { recursive: true });
try {
  run([...ready, { wait: 1 }, ...ready], '예열\n');
  // 1) 번호 목록 2번 빈 항목에서 Backspace → 글
  run([...ready, endOf('하나'), ENTER, { wait: 0.3 }, shot('1-번호-누르기전'), BS, { commit: '글', gap: 0.4 }, shot('1-번호-지우고-글')], '# 새 문서 9\n\n1. 하나\n');
  // 2) 하위 빈 항목에서 Backspace 두 번 → 글 / Enter 두 번 → 글
  run([...ready, endOf('위'), ENTER, TAB, { wait: 0.3 }, shot('2-하위-누르기전'), BS, shot('2-하위-지우기1번'), BS, { commit: '글', gap: 0.4 }, shot('2-하위-지우기2번-글')], '# 새 문서 9\n\n1. 위\n');
  run([...ready, endOf('위'), ENTER, TAB, ENTER, shot('3-하위-Enter1번'), ENTER, { commit: '글', gap: 0.4 }, shot('3-하위-Enter2번-글')], '# 새 문서 9\n\n1. 위\n');
} finally {
  try { process.kill(-vite.pid); } catch { /* 이미 꺼짐 */ }
  fs.rmSync(cache, { recursive: true, force: true });
  console.log(fs.readdirSync(outDir).filter((f) => f.startsWith(tag)).join('\n'));
}
