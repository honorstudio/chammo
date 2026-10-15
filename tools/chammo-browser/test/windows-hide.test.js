const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// 윈도우에서 콘솔 프로그램(node·powershell·tasklist 등)을 창 숨김 없이 띄우면, 부모에 콘솔이 없을 때(앱·detached 지킴이) 부를 때마다
// 검은 창이 번쩍인다(2026-10-15 참모 브라우저 쓰는 동안 PC 를 못 쓸 정도). child_process 호출은 모두 windowsHide: true.
// 예외: 첫 인자가 '/' 로 시작하는 글자 그대로의 맥·유닉스 경로 — 윈도우엔 그 파일이 없어 프로세스가 아예 안 뜬다
const CALL = /(?<![.\w$])(spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)\s*\(/g;

/** 여는 괄호 자리부터 짝 닫는 괄호까지의 글(따옴표·템플릿 안 괄호는 안 센다) */
function callText(src, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

/** windowsHide 없이 프로세스를 띄우는 호출 — [{ line, text }] */
function unhidden(src) {
  const out = [];
  for (const m of src.matchAll(CALL)) {
    const open = m.index + m[0].length - 1;
    const text = callText(src, open);
    if (/^\(\s*['"`]\//.test(text)) continue;
    if (/windowsHide\s*:\s*true/.test(text)) continue;
    out.push({ line: src.slice(0, m.index).split('\n').length, text: `${m[1]}${text}`.slice(0, 120) });
  }
  return out;
}

test('검사기: 숨김 없는 호출을 잡고, 숨김·맥 경로는 넘긴다', () => {
  assert.deepStrictEqual(unhidden("execFile(process.execPath, [cli], { env }, cb)").length, 1);
  assert.deepStrictEqual(unhidden("spawn(exe, ['--version'], { detached: true, stdio: 'ignore' })").length, 1);
  assert.deepStrictEqual(unhidden("spawn(process.execPath, args, { detached: true, windowsHide: true })").length, 0);
  assert.deepStrictEqual(unhidden("spawnSync('/usr/bin/lsappinfo', args, { timeout: 2000 })").length, 0);
  assert.deepStrictEqual(unhidden("spawnSync(ks, ['-x'], { stdio: 'ignore' })").length, 1);
  // 정규식 .exec(·다른 함수 이름(spawnHolder)·괄호 든 글자는 오해하지 않는다
  assert.deepStrictEqual(unhidden("const m = /a(b)/.exec(s); spawnHolder(o); d.spawnChild(['x'])").length, 0);
  assert.deepStrictEqual(unhidden("spawn(node, ['-e', 'f(1))'], { windowsHide: true })").length, 0);
});

test('도구(src·bin)의 child_process 호출은 모두 windowsHide', () => {
  const root = path.join(__dirname, '..');
  const bad = [];
  for (const dir of ['src', 'bin']) {
    for (const f of fs.readdirSync(path.join(root, dir)).filter((n) => n.endsWith('.js'))) {
      for (const b of unhidden(fs.readFileSync(path.join(root, dir, f), 'utf8'))) bad.push(`${dir}/${f}:${b.line} ${b.text}`);
    }
  }
  assert.deepStrictEqual(bad, [], `windowsHide: true 를 붙여:\n${bad.join('\n')}`);
});
