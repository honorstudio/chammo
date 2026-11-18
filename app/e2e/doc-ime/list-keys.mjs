#!/usr/bin/env node
// 문서 목록 지우기·빠져나오기 E2E(2026-11-17 사용자 '새 문서 9.md' — 2번 항목에서 Backspace 하면 1번 줄 끝으로 올라가고, 하위 빈 항목은 못 빠져나온다).
// 노션처럼: 목록 맨 앞 Backspace = 하위면 한 단계 바깥, 맨 바깥이면 목록 표시만 빼고 제자리 / 빈 항목 Enter = 같은 규칙으로 빠져나가기.
// 앱과 같은 시스템 WKWebView(doc-ime/wk.swift, 화면 밖)에 진짜 키 NSEvent·입력기 조합을 넣는다. node app/e2e/doc-ime/list-keys.mjs — 실패하면 종료 1
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const PORT = Number(process.env.E2E_PORT ?? 47463);
const base = `http://127.0.0.1:${PORT}/`;
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-list-'));
const wk = path.join(cache, 'wk');
// 포트에 옛 서버(끝난 시험이 남긴 vite)가 있으면 그걸 보고 엉뚱하게 통과·실패한다 — 시작 전에 비었나 본다
try { await fetch(base); console.log(`FAIL 포트 ${PORT} 에 이미 서버가 있다 — E2E_PORT=<빈 포트> 로 다시`); process.exit(1); } catch { /* 비었다 */ }
execFileSync('swiftc', ['-O', path.join(here, 'wk.swift'), '-o', wk], { stdio: 'inherit' });
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

const key = (code, chars, mods) => ({ key: code, chars, ...(mods ? { mods } : {}), gap: 0.15 });
const ENTER = key(36, '\r');
const BS = key(51, '\u007f');
const TAB = key(48, '\t');
const STAB = key(48, '\t', ['shift']);
const type = (t) => ({ commit: t, gap: 0.15 }); // 맨 글 넣기(영문 입력기와 같은 insertText)
const J = (expr) => ({ js: `return JSON.stringify(${expr})` });
const at = (t, end) => ({ js: `const t = __tip(); let at = -1; t.state.doc.descendants((n, p) => { if (n.isText && n.text.includes(${JSON.stringify(t)})) at = p + ${end ? 'n.nodeSize' : '0'}; }); t.commands.focus(); t.commands.setTextSelection(at); return at` });
const endOf = (t) => at(t, true);
const startOf = (t) => at(t, false);
const ready = [{ js: 'for (let i = 0; i < 400 && !(document.querySelector(".ProseMirror")?.editor && document.querySelector(".bn-block-content")); i++) await new Promise((r) => setTimeout(r, 100)); await new Promise((r) => setTimeout(r, 800)); return document.querySelectorAll(".bn-block-content").length' }];
const q = (md) => `?p=/E/q.md&md=${encodeURIComponent(md)}`;
const flat = (tree, d = 0) => tree.flatMap(([t, x, kids]) => [`${'  '.repeat(d)}${t}:${x}`, ...flat(kids, d + 1)]);
// 끝 두 결과 = [나무, 커서(블록 종류·그 블록 글·블록 안 자리)]
const CUR = J('(() => { const $f = __tip().state.selection.$from; return [$f.parent.type.name, $f.parent.textContent, $f.parentOffset]; })()');
const look = (rs) => ({ t: flat(JSON.parse(rs.at(-2))), c: JSON.parse(rs.at(-1)) });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const check = (name, steps, md, tree, cur) => {
  const rs = run([...ready, ...steps, J("__tree()"), CUR], q(md)); if (rs.some((r) => String(r).startsWith("ERR"))) console.log(rs);
  const { t, c } = look(rs);
  ok(name, same(t, tree) && (!cur || same(c, cur)), `${t.join(' / ')} · 커서 ${JSON.stringify(c)}`);
};

const KINDS = [['번호', 'numberedListItem', '1. '], ['점', 'bulletListItem', '- '], ['체크', 'checkListItem', '- [ ] ']];
try {
  run([...ready, { wait: 1 }, ...ready], q('예열\n')); // 새 vite 캐시는 첫 판에 의존성을 묶고 페이지를 다시 읽는다
  // 1) 글 있는 2번 항목 맨 앞 Backspace — 윗줄에 안 붙고 목록 표시만 빠진다, 한 번 더 눌러야 합쳐진다
  check('글 있는 항목 맨 앞 지우기 = 목록 표시만', [startOf('둘'), BS], '1. 하나\n2. 둘\n', ['numberedListItem:하나', 'paragraph:둘'], ['paragraph', '둘', 0]);
  check('보통 글이 된 뒤 한 번 더 = 윗줄과 합침', [startOf('둘'), BS, BS], '1. 하나\n2. 둘\n', ['numberedListItem:하나둘'], ['numberedListItem', '하나둘', 2]);
  // 2) 맨 바깥 빈 항목 Backspace — 커서는 그 줄에 남고 거기서 글을 친다
  for (const [name, t, mark] of KINDS) {
    check(`${name}: 빈 항목 지우기 = 보통 글 줄, 제자리`, [endOf('하나'), ENTER, BS, type('글')], `${mark}하나\n`, [`${t}:하나`, 'paragraph:글'], ['paragraph', '글', 1]);
  }
  // 3) 하위 빈 항목 Backspace — 한 단계 바깥, 한 번 더면 보통 글 줄(사용자 '1. / 1. ← 여기서 지우기')
  for (const [name, t, mark] of KINDS) {
    check(`${name}: 하위 빈 항목 지우기 = 한 단계 바깥`, [endOf('위'), ENTER, TAB, BS], `${mark}위\n`, [`${t}:위`, `${t}:`], [t, '', 0]);
    check(`${name}: 하위 빈 항목 두 번 지우고 글 = 보통 글 줄`, [endOf('위'), ENTER, TAB, BS, BS, type('글')], `${mark}위\n`, [`${t}:위`, 'paragraph:글'], ['paragraph', '글', 1]);
  }
  // 하위 항목 글 있는 채로 맨 앞 Backspace — 한 단계 바깥(글은 그대로)
  check('하위 글 있는 항목 맨 앞 지우기 = 한 단계 바깥', [startOf('하나'), BS], '1. 위\n   1. 하나\n', ['numberedListItem:위', 'numberedListItem:하나'], ['numberedListItem', '하나', 0]);
  // 4) 빈 항목 Enter — 새 번호 대신 빠져나간다(하위면 한 단계 바깥, 맨 바깥이면 보통 글)
  for (const [name, t, mark] of KINDS) {
    check(`${name}: 하위 빈 항목 Enter = 한 단계 바깥`, [endOf('하나'), ENTER, ENTER], `${mark}위\n   ${mark}하나\n`, [`${t}:위`, `  ${t}:하나`, `${t}:`], [t, '', 0]);
    check(`${name}: 하위 빈 항목 Enter 두 번 + 글 = 보통 글 줄`, [endOf('하나'), ENTER, ENTER, ENTER, type('글')], `${mark}위\n   ${mark}하나\n`, [`${t}:위`, `  ${t}:하나`, 'paragraph:글'], ['paragraph', '글', 1]);
  }
  // 5) Shift+Tab 은 그대로 한 단계 바깥
  check('Shift+Tab = 한 단계 바깥', [endOf('하나'), STAB], '1. 위\n   1. 하나\n', ['numberedListItem:위', 'numberedListItem:하나'], ['numberedListItem', '하나', 2]);
  // 6) 한글 조합 중 Backspace — 조합 글만 지운다(목록 구조는 그대로). 조합이 끝난 뒤 Backspace 는 같은 규칙
  check('조합 중 지우기는 끼어들지 않는다', [endOf('위'), ENTER, TAB, { mark: 'ㄱ', gap: 0.09 }, { ...BS, gap: 0.05 }, { mark: '', gap: 0.6 }], '1. 위\n',
    ['numberedListItem:위', '  numberedListItem:'], ['numberedListItem', '', 0]);
  check('조합 지운 직후(0.5초 안) 지우기 = 한 단계 바깥', [endOf('위'), ENTER, TAB, { mark: 'ㄱ', gap: 0.09 }, { ...BS, gap: 0.05 }, { mark: '', gap: 0.1 }, BS], '1. 위\n',
    ['numberedListItem:위', 'numberedListItem:'], ['numberedListItem', '', 0]);
  check('한글 친 줄 맨 앞 지우기 = 목록 표시만', [endOf('하나'), ENTER, { mark: 'ㄷ', gap: 0.09 }, { mark: '두', gap: 0.09 }, { commit: '두', gap: 0.6 }, startOf('두'), BS], '1. 하나\n',
    ['numberedListItem:하나', 'paragraph:두'], ['paragraph', '두', 0]);
} catch (e) {
  failed++; console.log('FAIL 하네스', e);
} finally {
  try { process.kill(-vite.pid); } catch { /* 이미 꺼짐 */ }
  fs.rmSync(cache, { recursive: true, force: true });
  console.log(failed ? `실패 ${failed}` : '모두 통과');
  process.exit(failed ? 1 : 0);
}
