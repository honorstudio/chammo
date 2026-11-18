#!/usr/bin/env node
// 문서 편집기 키 동작 노션 비교(11-17 사용자 "거의 유사한데 뭔가 약간 달라") — 표 docs/design-drafts/editor-keys/notion-diff.md 의 줄마다 한 장면.
// want 가 있는 줄 = 노션 공식 문서·사용자 기준과 같아야 통과, want 가 없는 줄(노션 확인 못 함) = 지금 동작만 찍는다.
// node app/e2e/doc-ime/notion-keys.mjs [줄 id…] — 화면 밖 WKWebView, 실패하면 종료 1
import { K, LOOK, endOf, key, read, ready, start, startOf, typeKeys } from './kit.mjs';

const { run, ok, crash, done } = await start(Number(process.env.E2E_PORT ?? 47466));
const only = process.argv.slice(2);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const P = '빈칸\n'; // 단축 입력 장면 — 빈 문단에서 시작
const emptyLine = [endOf('빈칸'), K.ENTER];
const row = (id, name, md, steps, want) => {
  if (only.length && !only.includes(id)) return;
  const { t, c, x } = read(run([...ready, ...steps, ...LOOK], md));
  const got = `${t.join(' / ')} · 커서 ${JSON.stringify(c)}${x.length ? ` · ${JSON.stringify(x)}` : ''}`;
  if (!want) { console.log(`--   ${id} ${name} — ${got}`); return; }
  ok(`${id} ${name}`, (!want.t || same(t, want.t)) && (!want.c || same(c, want.c)) && (!want.x || same(x, want.x)), got);
};

try {
  // ── 목록 ──
  row('L1', '글 있는 번호 항목 끝 Enter = 다음 번호', '1. 하나\n', [endOf('하나'), K.ENTER], { t: ['numberedListItem:하나', 'numberedListItem:'], c: ['numberedListItem', '', 0] });
  row('L4', '목록 줄 끝 Delete', '1. 하나\n2. 둘\n', [endOf('하나'), K.DEL]);
  row('L5', 'Tab = 바로 위 항목 안으로', '1. 하나\n2. 둘\n', [endOf('둘'), K.TAB], { t: ['numberedListItem:하나', '  numberedListItem:둘'] });
  row('L7', 'Shift+Enter = 블록 안 줄바꿈', '1. 하나\n', [endOf('하나'), K.SENTER, ...typeKeys('x')], { t: ['numberedListItem:하나x'], x: ['br'] });
  // ── 보통 글·제목 ──
  row('P1', '보통 글 줄 맨 앞 Backspace', '위 줄\n\n아래 줄\n', [startOf('아래'), K.BS]);
  row('H1', '제목 끝 Enter', '# 제목\n', [endOf('제목'), K.ENTER]);
  row('H2', '빈 제목에서 Backspace', '위 줄\n\n# 제목\n', [endOf('제목'), K.BS, K.BS, K.BS]);
  // ── 마크다운 단축 입력(줄 맨 앞) ──
  for (const [id, s, t] of [['M1', '- ', 'bulletListItem'], ['M2', '* ', 'bulletListItem'], ['M3', '+ ', 'bulletListItem'], ['M4', '1. ', 'numberedListItem'],
    ['M5', 'a. ', 'numberedListItem'], ['M6', 'i. ', 'numberedListItem'], ['M7', '[] ', 'checkListItem'], ['M8', '# ', 'heading'], ['M9', '## ', 'heading'],
    ['M10', '> ', 'toggleListItem'], ['M11', '" ', 'quote'], ['M12', '---', 'divider']]) {
    row(id, `'${s}' = ${t}`, P, [...emptyLine, ...typeKeys(s)], { t: ['paragraph:빈칸', `${t}:`] });
  }
  row('M13', "'``` ' 코드 블록", P, [...emptyLine, ...typeKeys('``` ')]);
  row('M14', "'- ' 바로 뒤 Backspace = 글자로 되돌리기(공백 하나)", P, [...emptyLine, ...typeKeys('- '), K.BS], { t: ['paragraph:빈칸', 'paragraph:- '] });
  row('M15', "'- ' 바로 뒤 ⌘Z", P, [...emptyLine, ...typeKeys('- '), key(6, 'z', ['cmd'])]);
  // ── 화살표·블록 고르기 ──
  row('A1', '↓ 로 짧은 줄 → 긴 줄 넘어갈 때 커서', '가나다라마바사\n\n가나\n\n가나다라마바사\n', [{ js: 'const t = __tip(); let n = 0, at = -1; t.state.doc.descendants((x, p) => { if (x.isText && x.text === "가나다라마바사" && n++ === 0) at = p + 5; }); t.commands.focus(); t.commands.setTextSelection(at); return at' }, K.DOWN, K.DOWN]);
  row('S1', 'Esc 로 고른 블록에서 Tab', '- 하나\n- 둘\n', [startOf('둘'), K.ESC, K.TAB]);
  row('S2', 'Esc 로 고른 블록에서 Enter = 글 편집으로', '- 하나\n- 둘\n', [endOf('둘'), K.ESC, K.ENTER, ...typeKeys('x')], { t: ['bulletListItem:하나', 'bulletListItem:둘x'] });
  row('S3', 'Esc 로 고른 블록에서 Backspace = 블록 지우기', '- 하나\n- 둘\n', [endOf('둘'), K.ESC, K.BS], { t: ['bulletListItem:하나'] });
  row('S4', '⌘⇧↑ = 블록 위로 옮기기', '- 하나\n- 둘\n', [endOf('둘'), key(126, '', ['cmd', 'shift'])], { t: ['bulletListItem:둘', 'bulletListItem:하나'] });
  row('S5', '⌘D = 복제', '- 하나\n', [endOf('하나'), key(2, 'd', ['cmd'])], { t: ['bulletListItem:하나', 'bulletListItem:하나'] });
  // ── 할 일·블록 종류 단축키 ──
  row('C1', '⌘Enter = 할 일 체크', '- [ ] 할 일\n', [endOf('할 일'), K.CMDENTER], { x: [true] });
  row('C2', '⌘Enter 두 번 = 체크 풀기', '- [x] 할 일\n', [endOf('할 일'), K.CMDENTER], { x: [false] });
  row('C3', '⌘Enter = 토글 열고 닫기', '- 위\n', [endOf('위'), K.ENTER, ...typeKeys('> '), ...typeKeys('x'), K.CMDENTER], { t: ['bulletListItem:위', 'toggleListItem:x'], x: ['open:true'] });
  row('C4', '⌘Enter 는 한글 조합 중엔 안 끼어든다', '- [ ] 할 일\n', [endOf('할 일'), { mark: 'ㄱ', gap: 0.09 }, K.CMDENTER, { commit: 'ㄱ', gap: 0.6 }], { x: [false] });
  for (const [id, n, code, t] of [['T0', 0, 29, 'paragraph'], ['T1', 1, 18, 'heading'], ['T4', 4, 21, 'checkListItem'], ['T5', 5, 23, 'bulletListItem'],
    ['T6', 6, 22, 'numberedListItem'], ['T7', 7, 26, 'toggleListItem'], ['T8', 8, 28, 'codeBlock']]) {
    row(id, `⌘⌥${n} = ${t}`, n === 0 ? '# 글\n' : '글\n', [endOf('글'), key(code, String(n), ['cmd', 'alt'])], { t: [`${t}:글`] });
  }
} catch (e) {
  crash(e);
} finally {
  done();
}
