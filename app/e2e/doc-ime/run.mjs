#!/usr/bin/env node
// 문서 목록 한글 조합 E2E(2026-11-17 사용자 "번호 목록 새 항목에서 한글 첫 글자가 따로 한 항목으로 떨어진다") — 앱과 같은 시스템 WKWebView 에
// 입력기가 부르는 그대로 조합 글(setMarkedText)·확정(insertText)을 넣는다. 받침·자음 연타·Enter 새 항목·Tab 하위 항목·첫 항목.
// node app/e2e/doc-ime/run.mjs — 맥 전용(swiftc). 창은 화면 밖. 받침은 doc-table 하네스(vite·main.tsx)를 그대로 쓴다. 실패하면 종료 1
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const PORT = Number(process.env.E2E_PORT ?? 47462);
const base = `http://127.0.0.1:${PORT}/`;
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ime-'));
const wk = path.join(cache, 'wk');
// 포트에 옛 서버(끝난 시험이 남긴 vite)가 있으면 그걸 보고 엉뚱하게 통과·실패한다 — 시작 전에 비었나 본다
try { await fetch(base); console.log(`FAIL 포트 ${PORT} 에 이미 서버가 있다 — E2E_PORT=<빈 포트> 로 다시`); process.exit(1); } catch { /* 비었다 */ }
execFileSync('swiftc', ['-O', path.join(here, 'wk.swift'), '-o', wk], { stdio: 'inherit' });
// detached + 무리째 끄기 — vite.kill() 만 하면 node 자식이 포트를 쥔다(lesson team-to-chat)
const vite = spawn(path.join(appDir, 'node_modules/.bin/vite'), ['--config', path.join(appDir, 'e2e/doc-table/vite.config.ts')],
  { cwd: appDir, env: { ...process.env, E2E_PORT: String(PORT), E2E_CACHE: path.join(cache, 'vite') }, stdio: 'ignore', detached: true });
for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch { /* 아직 */ } await new Promise((r) => setTimeout(r, 250)); }
let failed = 0;
const run = (steps, query) => {
  const f = path.join(cache, 'steps.json');
  fs.writeFileSync(f, JSON.stringify(steps));
  const r = spawnSync(wk, [base + query, f], { encoding: 'utf8', timeout: 120_000 });
  return r.stdout.split('\n').filter((l) => l.startsWith('R ')).map((l) => JSON.parse(l.slice(2)).v);
};
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };

// 두벌식 입력기가 부르는 차례 — 'm:글' 조합 글 바꿈, 'c:글' 확정. 사람 손 빠르기(키 사이 0.09초)
const ime = (ops, gap = 0.09) => ops.map((o) => (o.startsWith('m:') ? { mark: o.slice(2), gap } : { commit: o.slice(2), gap }));
const T = {
  // 이렇게
  이렇게: ['m:ㅇ', 'm:이', 'm:일', 'c:이', 'm:러', 'm:렇', 'c:렇', 'm:ㄱ', 'm:게'],
  // 보면
  보면: ['m:ㅂ', 'm:보', 'm:봄', 'c:보', 'm:며', 'm:면'],
  // ㅇㅇㅇ아
  자음: ['m:ㅇ', 'c:ㅇ', 'm:ㅇ', 'c:ㅇ', 'm:ㅇ', 'c:ㅇ', 'm:ㅇ', 'm:아'],
  // 볼게(받침 이어 치기 — 볼 + ㄱ 은 겹받침이 아니라 다음 글자로)
  볼게: ['m:ㅂ', 'm:보', 'm:볼', 'm:볽', 'c:볼', 'm:게'],
};
const key = (code, chars, mods) => ({ key: code, chars, ...(mods ? { mods } : {}) });
// 한글 조합 중 Enter — 입력기가 먼저 확정하고 Enter 키가 뒤따른다
const ENTER = (last) => [{ commit: last, gap: 0.01 }, { ...key(36, '\r'), gap: 0.12 }];
const TAB = { ...key(48, '\t'), gap: 0.12 };
const J = (expr) => ({ js: `return JSON.stringify(${expr})` });
// 글 끝에 커서(클릭 대신 편집기 명령 — 화면 밖 창이라 좌표 없이)
const endOf = (t) => ({ js: `const t = __tip(); let at = -1; t.state.doc.descendants((n, p) => { if (n.isText && n.text.includes(${JSON.stringify(t)})) at = p + n.nodeSize; }); t.commands.focus(); t.commands.setTextSelection(at); return at` });
// 편집기가 뜰 때까지(새 vite 캐시는 첫 판이 느리다) — 최대 40초
const ready = [{ js: 'for (let i = 0; i < 400 && !(document.querySelector(".ProseMirror")?.editor && document.querySelector(".bn-block-content")); i++) await new Promise((r) => setTimeout(r, 100)); await new Promise((r) => setTimeout(r, 800)); return document.querySelectorAll(".bn-block-content").length' }];
const q = (md) => `?p=/E/q.md&md=${encodeURIComponent(md)}`;
// [종류, 글, 안쪽] 나무를 '깊이 종류:글' 줄로
const flat = (tree, d = 0) => tree.flatMap(([t, x, kids]) => [`${'  '.repeat(d)}${t}:${x}`, ...flat(kids, d + 1)]);
const tree = (rs) => { if (rs.some((r) => String(r).startsWith("ERR"))) console.log(rs); return flat(JSON.parse(rs.at(-1))); };

try {
  run([...ready, { wait: 1 }, ...ready], q('예열\n')); // 새 vite 캐시는 첫 판에 의존성을 묶고 페이지를 다시 읽는다
  // 1) Enter 로 만든 새 번호 항목에 '이렇게' — 한 항목으로
  {
    const rs = run([...ready, endOf('해볼'), ...ime(['m:ㄱ', 'm:게']), ...ENTER('게'), ...ime(T.이렇게), { commit: '게', gap: 0.5 }, J('__tree()')], q('1. 해볼\n'));
    const t = tree(rs);
    ok('Enter 새 항목: 첫 음절이 안 떨어진다', JSON.stringify(t) === JSON.stringify(['numberedListItem:해볼게', 'numberedListItem:이렇게']), t.join(' / '));
  }
  // 2) Enter 뒤 Tab 하위 항목에 '이렇게'
  {
    const rs = run([...ready, endOf('해볼'), ...ime(['m:ㄱ', 'm:게']), ...ENTER('게'), TAB, ...ime(T.이렇게), { commit: '게', gap: 0.5 }, J('__tree()')], q('1. 해볼\n'));
    const t = tree(rs);
    ok('Tab 하위 항목: 첫 음절이 안 떨어진다', JSON.stringify(t) === JSON.stringify(['numberedListItem:해볼게', '  numberedListItem:이렇게']), t.join(' / '));
  }
  // 3) 하위 항목 안에서 Enter 새 항목 + 자음 연타
  {
    const rs = run([...ready, endOf('하나'), ...ime(['m:ㄷ', 'm:두']), ...ENTER('두'), ...ime(T.자음), { commit: '아', gap: 0.5 }, J('__tree()')], q('1. 위\n   1. 하나\n'));
    const t = tree(rs);
    ok('자음 연타: 같은 자음이 안 쌓이고 한 항목', JSON.stringify(t) === JSON.stringify(['numberedListItem:위', '  numberedListItem:하나두', '  numberedListItem:ㅇㅇㅇ아']), t.join(' / '));
  }
  // 4) 받침 있는 글자 이어 치기 + 빈 문서 첫 항목('1. ' 로 목록 만들기 바로 뒤)
  {
    const rs = run([...ready, endOf('글'), ...ime(['m:ㄲ', 'm:끄', 'm:끝']), ...ENTER('끝'), key(18, '1'), key(47, '.'), key(49, ' '), { wait: 0.2 }, ...ime(T.볼게), { commit: '게', gap: 0.5 }, J('__tree()')], q('글\n'));
    const t = tree(rs);
    ok('첫 항목 + 받침 이어 치기', JSON.stringify(t) === JSON.stringify(['paragraph:글끝', 'numberedListItem:볼게']), t.join(' / '));
  }
  // 5) 글머리 목록도 같은 길(번호 목록만의 일인지 가른다)
  {
    const rs = run([...ready, endOf('해볼'), ...ime(['m:ㄱ', 'm:게']), ...ENTER('게'), ...ime(T.보면), { commit: '면', gap: 0.5 }, J('__tree()')], q('- 해볼\n'));
    const t = tree(rs);
    ok('글머리 목록 새 항목', JSON.stringify(t) === JSON.stringify(['bulletListItem:해볼게', 'bulletListItem:보면']), t.join(' / '));
  }
  // 6) 사용자 문서 그대로 — 하위 목록에서 Enter·치기를 거푸(보 / 보면, ㅈ / ㅈㅈ… 모양이 안 나와야)
  {
    const rs = run([...ready, endOf('알지'), ...ime(['m:ㅇ', 'm:요']), ...ENTER('요'), ...ime(T.보면), ...ENTER('면'), ...ime(['m:ㅈ', 'c:ㅈ', 'm:ㅈ', 'c:ㅈ', 'm:ㅈ', 'm:저']), ...ENTER('저'), ...ime(T.이렇게), { commit: '게', gap: 0.5 }, J('__tree()')],
      q('1. 텍스트\n   1. 뭔말인지알지\n'));
    const t = tree(rs);
    ok('하위 목록 거푸 치기', JSON.stringify(t) === JSON.stringify(['numberedListItem:텍스트', '  numberedListItem:뭔말인지알지요', '  numberedListItem:보면', '  numberedListItem:ㅈㅈ저', '  numberedListItem:이렇게']), t.join(' / '));
  }
} catch (e) {
  failed++; console.log('FAIL 하네스', e); // 터져도 '모두 통과'로 끝나지 않게
} finally {
  try { process.kill(-vite.pid); } catch { /* 이미 꺼짐 */ }
  fs.rmSync(cache, { recursive: true, force: true });
  console.log(failed ? `실패 ${failed}` : '모두 통과');
  process.exit(failed ? 1 : 0);
}
