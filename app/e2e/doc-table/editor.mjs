#!/usr/bin/env node
// 문서 편집기 해피패스 E2E(2026-11-09 노션 비교 2차) — 앱과 같은 시스템 WKWebView 에 진짜 마우스·키·편집 명령을 넣는다.
// 접는 목록·접는 제목은 <details> 로 저장했다 다시 열어도 그대로, 맨 글 여러 줄은 줄마다 블록, 새 표는 칸 맞춤 공백 없이,
// 블록 고르기(Esc·손잡이·Shift+↓·복사·지우기·끌기)·손잡이 메뉴는 아이콘만.
// node app/e2e/doc-table/editor.mjs — 맥 전용(swiftc). 창은 화면 밖, 클립보드는 끝나면 되돌린다. 실패하면 종료 1
import { PA, click, ready, start, xy } from './kit.mjs';

const { run, ok, done } = await start();
const M = '?p=/E/misc.md';
const key = (code, chars, mods) => ({ key: code, chars, ...(mods ? { mods } : {}) });
const ESC = key(53, '\x1b'), ENTER = key(36, '\r'), BS = key(51, '\x7f'), SDOWN = key(125, '', ['shift']);
const J = (expr) => ({ js: `return JSON.stringify(${expr})` });
const SAVED = [{ wait: 2.5 }, J('__md()')];
const handleAt = (text) => [xy(`...(() => { const r = __para('${text}').getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2]; })()`), { move: 0 }, { move: 0, gap: 0.4 },
  xy('...(() => { const r = document.querySelector(".bn-side-menu [draggable=true]").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()')];

try {
  // 1) 접는 목록 안 접는 제목 — 안쪽 글을 고쳐 저장하면 <details> 그대로, 다시 열어도 같은 나무
  {
    const edit = { js: "const t = __tip(); let at = -1; t.state.doc.descendants((n, p) => { if (at < 0 && n.isText && n.text.includes('깊은 글')) at = p + 2; }); t.view.dispatch(t.state.tr.insertText('X', at)); return at" };
    const [, tree, , saved] = run([...ready, J('__tree()'), edit, ...SAVED], M);
    const t = JSON.parse(tree);
    ok('읽기: 접는 목록 안에 글·접는 제목', JSON.stringify(t.find((x) => x[0] === 'toggleListItem')) === JSON.stringify(['toggleListItem', '밖 토글', [['paragraph', '속 글', []], ['heading+T', '안 머리', [['paragraph', '깊은 글', []]]]]]), tree);
    const md = JSON.parse(saved);
    ok('쓰기: 고친 접는 블록도 <details>', md.includes('<details>\n<summary>밖 토글</summary>\n\n속 글\n\n<details>\n<summary><h3>안 머리</h3></summary>\n\n깊은X 글\n\n</details>\n\n</details>'), md);
    const [, again] = run([...ready, J('__tree()')], `?p=/E/q.md&md=${encodeURIComponent(md)}`);
    ok('다시 열기: 접힘·안쪽 블록 그대로', JSON.stringify(JSON.parse(again).find((x) => x[0] === 'toggleListItem')) === JSON.stringify(['toggleListItem', '밖 토글', [['paragraph', '속 글', []], ['heading+T', '안 머리', [['paragraph', '깊은X 글', []]]]]]), again);
  }
  // 2) 맨 글 여러 줄 → 줄마다 블록 / 3) 새 표 → 칸 맞춤 공백 없이
  {
    const end = xy(PA('마지막 문단', 6));
    const [, blocks, saved] = run([...ready, end, ...click(0), ENTER, { pbset: { plain: '첫 줄\n둘째 줄\n\n넷째 줄' } }, { cmd: 'paste', gap: 0.6 },
      ENTER, { pbset: { plain: '| a | b |\n| --- | --- |\n| 1 | 2 |' } }, { cmd: 'paste', gap: 0.6 }, J('__blocks()'), ...SAVED], M);
    const b = JSON.parse(blocks);
    ok('맨 글 여러 줄 = 줄마다 블록', ['paragraph:첫 줄', 'paragraph:둘째 줄', 'paragraph:넷째 줄'].every((x) => b.includes(x)), blocks);
    const md = JSON.parse(saved);
    ok('저장도 줄마다 문단', md.includes('첫 줄\n\n둘째 줄\n\n넷째 줄'), md);
    ok('새 표는 칸 맞춤 공백 없이', md.includes('| a | b |\n| --- | --- |\n| 1 | 2 |'), md);
  }
  // 4) Esc 로 고르고 Shift+↓ 로 늘려 복사 → 다른 문단 끝에 붙이면 블록째 아래로(합쳐지지 않게)
  {
    const [, p1, p2, pb, p3, blocks] = run([...ready, xy(PA('둘', 1), PA('마지막 문단', 6)), ...click(0), ESC, J('__picked()'), SDOWN, J('__picked()'),
      { cmd: 'copy' }, { pb: 1 }, ...click(1), J('__picked()'), { cmd: 'paste', gap: 0.6 }, J('__blocks()')], M);
    ok('Esc = 지금 블록 고르기', p1 === '["둘"]', p1);
    ok('Shift+↓ = 늘리기', p2 === '["둘","셋"]', p2);
    ok('복사 글은 사람 글', pb['public.utf8-plain-text'] === '- 둘\n- 셋', JSON.stringify(pb['public.utf8-plain-text']));
    ok('글을 누르면 고르기가 풀린다', p3 === '[]', p3);
    const b = JSON.parse(blocks);
    const at = b.indexOf('paragraph:마지막 문단');
    ok('붙이면 블록째 아래로(문단에 안 합쳐짐)', at > 0 && b[at + 1] === 'bulletListItem:둘' && b[at + 2] === 'bulletListItem:셋', blocks);
  }
  // 5) 고른 블록 Backspace = 지우기, 저장
  {
    const [, blocks, saved] = run([...ready, xy(PA('하나', 1)), ...click(0), ESC, SDOWN, BS, J('__blocks()'), ...SAVED], M);
    const b = JSON.parse(blocks);
    ok('Backspace = 고른 블록 지우기', !b.includes('bulletListItem:하나') && !b.includes('bulletListItem:둘') && b.includes('bulletListItem:셋'), blocks);
    ok('저장에도 빠짐', JSON.parse(saved).includes('첫 문단\n\n- 셋'), saved);
  }
  // 6) 손잡이 누르기 = 그 블록 고르기 + 아이콘만 메뉴, 메뉴를 Esc 로 닫아도 고른 채로
  {
    const [, p1, labels, texts, p2, menu] = run([...ready, ...handleAt('셋'), ...click(0), { wait: 0.4 }, J('__picked()'),
      J('[...document.querySelectorAll("[role=menuitem] [aria-label]")].map((e) => e.getAttribute("aria-label"))'),
      J('[...document.querySelectorAll("[role=menuitem]")].map((e) => e.textContent.trim())'), ESC, { wait: 0.6 }, J('__picked()'), J('!!document.querySelector(".bn-drag-handle-menu")')], M);
    ok('손잡이 누르기 = 그 블록 고르기', p1 === '["셋"]', p1);
    ok('메뉴는 아이콘(이름은 aria-label)', labels === '["삭제","색"]', labels);
    ok('메뉴에 글자 없음', JSON.parse(texts).every((t) => t === ''), texts);
    ok('메뉴 Esc = 메뉴만 닫힘, 고른 건 그대로', menu === 'false' && p2 === '["셋"]', `${menu} ${p2}`);
  }
  // 7) 고른 두 블록을 손잡이로 끌어 옮기기 — 같이 옮겨지고, md 목록이 둘로 안 갈리고, 옮긴 뒤에도 고른 채로
  {
    const target = xy('...(() => { const h = document.querySelector(".bn-side-menu [draggable=true]").getBoundingClientRect(); const t = __para("첫 문단").getBoundingClientRect(); return [h.left + h.width / 2, h.top + h.height / 2, h.left + h.width / 2, t.top + 3]; })()');
    const [, blocks, picked, saved] = run([...ready, xy(PA('둘', 1)), ...click(0), ESC, SDOWN, ...handleAt('셋'), target,
      { move: 0 }, { down: 0 }, ...Array.from({ length: 10 }, () => ({ drag: 1, gap: 0.03 })), { up: 1, gap: 0.5 }, J('__blocks()'), J('__picked()'), ...SAVED], M);
    const b = JSON.parse(blocks);
    ok('고른 두 블록이 같이 옮겨진다', b[1] === 'bulletListItem:둘' && b[2] === 'bulletListItem:셋' && b[3] === 'paragraph:첫 문단', blocks);
    ok('옮긴 뒤에도 고른 채로', picked === '["둘","셋"]', picked);
    ok('md 목록이 둘로 안 갈림', JSON.parse(saved).includes('# 여러 블록\n\n- 둘\n- 셋\n\n첫 문단\n\n- 하나'), saved);
  }
} finally {
  done();
}
