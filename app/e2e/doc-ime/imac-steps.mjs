#!/usr/bin/env node
// 아이맥 진짜 입력기 시험 단계 만들기 — node imac-steps.mjs > steps.json, 그다음 imac-probe <묶음 주소> steps.json out.json
// 장면마다 새 문서(주소 ?md=)를 열고, 글 끝에 커서, 두벌식 키(QWERTY 자리)로 친 뒤 블록 나무와 조합 사건 수를 남긴다
const ENTER = { key: 36, gap: 0.15 }, TAB = { key: 48, gap: 0.15 };
const k = (keys, gap = 0.1) => ({ keys, gap });
const open = (md) => [
  { js: `location.search = '?p=/E/q.md&md=' + encodeURIComponent(${JSON.stringify(md)}); return 1` }, { wait: 1.5 },
  { js: 'for (let i = 0; i < 300 && !(document.querySelector(".ProseMirror")?.editor && document.querySelector(".bn-block-content")); i++) await new Promise((r) => setTimeout(r, 100)); await new Promise((r) => setTimeout(r, 600)); window.__E = {}; for (const ev of ["compositionstart","compositionend","insertReplacementText","insertCompositionText","deleteCompositionText"]) window.__E[ev] = 0; const pm = document.querySelector(".ProseMirror"); pm.addEventListener("compositionstart", () => __E.compositionstart++, true); pm.addEventListener("compositionend", () => __E.compositionend++, true); pm.addEventListener("beforeinput", (e) => { if (e.inputType in __E) __E[e.inputType]++; }, true); return document.querySelectorAll(".bn-block-content").length' },
];
const endOf = (t) => ({ js: `const t = __tip(); let at = -1; t.state.doc.descendants((n, p) => { if (n.isText && n.text.includes(${JSON.stringify(t)})) at = p + n.nodeSize; }); t.commands.focus(); t.commands.setTextSelection(at); await new Promise((r) => setTimeout(r, 400)); return at` });
const read = (name) => [{ wait: 0.8 }, { js: `const fl = (tr, d = 0) => tr.flatMap(([t, x, kids]) => ['  '.repeat(d) + t.replace('ListItem', '') + ':' + x, ...fl(kids, d + 1)]); return JSON.stringify({ name: ${JSON.stringify(name)}, tree: fl(__tree()), ev: __E })` }];
const S = [
  { wait: 2 },
  // 1) Enter 새 항목 — 해볼|게 ⏎ 이렇게
  ...open('1. 해볼\n'), endOf('해볼'), k('rp'), ENTER, k('dlfjgrp '), ...read('Enter 새 항목'),
  // 2) Enter 뒤 바로 Tab 하위 항목 — 이렇게
  ...open('1. 해볼\n'), endOf('해볼'), k('rp'), ENTER, TAB, k('dlfjgrp '), ...read('Tab 하위 항목'),
  // 3) 하위 항목 Enter + 자음 연타 — ㅇㅇㅇ아
  ...open('1. 위\n   1. 하나\n'), endOf('하나'), k('en'), ENTER, k('dddk '), ...read('자음 연타'),
  // 4) 받침 이어 치기 — 볼게 밝은 길
  ...open('1. 위\n   1. 하나\n'), endOf('하나'), k('en'), ENTER, k('qhfrp qkfrdms rlf '), ...read('받침 이어 치기'),
  // 5) 사용자 문서 그대로 — 하위 목록 거푸
  ...open('1. 텍스트\n   1. 뭔말인지알지\n'), endOf('알지'), k('dy'), ENTER, k('qhaus'), ENTER, k('wwwj'), ENTER, k('dlfjgrp '), ...read('하위 거푸'),
];
console.log(JSON.stringify(S));
