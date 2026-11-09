#!/usr/bin/env node
// 문서 표 고르기·복사 해피패스 E2E(2026-11-09 사용자 "칸 안 글 복사가 표 밖에 안 붙는다·끌기 선택이 애매") — 앱과 같은 시스템 WKWebView 에
// 진짜 마우스·편집 명령(copy:·paste:)을 넣는다. 칸 안 일부 끌기·세 번 클릭·옆 칸 갔다 돌아오기 = 글 선택이고 표 밖 문단에 글로 붙는다,
// 여러 칸 끌기 = 칸 선택(파란 칸)이고 클립보드엔 탭 구분 글만(표 html 없음), 우리 문서엔 표로 붙는다.
// node app/e2e/doc-table/run.mjs — 맥 전용(swiftc). 창은 화면 밖, 클립보드는 끝나면 되돌린다. 실패하면 종료 1
import { C, PA, click, drag, ready, start, xy } from './kit.mjs';

const { run, ok, done } = await start();
const triple = (k) => [{ move: k }, ...[1, 2, 3].flatMap((n) => [{ down: k, clicks: n }, { up: k, clicks: n, gap: 0.05 }]), { wait: 0.3 }];
const SEL = { js: 'return JSON.stringify(__sel())' };
const BLOCKS = { js: 'return JSON.stringify(__blocks())' };
/** 고르기 → 복사 → 아래 문단 '글' 앞에 붙이기 */
const copyPaste = (pick, target) => [...pick, SEL, { cmd: 'copy' }, { pb: 1 }, ...click(target), { cmd: 'paste', gap: 0.6 }, BLOCKS];

try {
  // 1) 칸 안 일부 끌기 → 글 선택, 표 밖 문단에 글로
  {
    const [n, sel, pb, blocks] = run([...ready, xy(C(1, 2, 0), C(1, 2, 2), PA('아래 문단 글', 6)), ...copyPaste(drag(0, 1), 2)]);
    const s = JSON.parse(sel);
    ok('편집기가 떴다', n >= 4, `블록 ${n}`);
    ok('칸 안 일부 끌기 = 글 선택', s.type === 'TextSelection' && s.text === '빨강', JSON.stringify(s));
    ok('복사한 글 = 고른 글', pb['public.utf8-plain-text'] === '빨강');
    ok('표 밖 문단에 글로 붙는다', JSON.parse(blocks).includes('paragraph:아래 문단 빨강글'), blocks);
  }
  // 2) 세 번 클릭 → 칸 글 전체 글 선택, 클립보드에 표 없음, 문단에 글로
  {
    const [, sel, pb, blocks] = run([...ready, xy(C(1, 2, 1), PA('아래 문단 글', 6)), ...copyPaste(triple(0), 1)]);
    const s = JSON.parse(sel);
    const b = JSON.parse(blocks);
    ok('세 번 클릭 = 칸 글 전체 글 선택', s.type === 'TextSelection' && s.text === '빨강 과일', JSON.stringify(s));
    ok('복사에 표(<table>)가 안 들어간다', !String(pb['public.html'] ?? '').includes('<table'));
    ok('표 밖에 1칸 표가 안 생기고 글로', b.filter((x) => x.startsWith('table:')).length === 1 && b.includes('paragraph:아래 문단 빨강 과일글'), blocks);
  }
  // 3) 끌다 옆 칸에 갔다 처음 칸으로 돌아오면 다시 글 선택
  {
    const [, sel] = run([...ready, xy(C(1, 2, 0), C(1, 1, 0), C(1, 2, 3)), ...drag(0, 1, 2), SEL]);
    const s = JSON.parse(sel);
    ok('옆 칸 갔다 돌아오기 = 글 선택', s.type === 'TextSelection' && s.text === '빨강 ', JSON.stringify(s));
  }
  // 4) 여러 칸 끌기 → 칸 선택(파란 칸), 다른 앱엔 탭 구분 글만, 우리 문서엔 표로
  {
    const [, sel, bg, pb, blocks] = run([...ready, xy(C(1, 0, 0), C(2, 1, 0), PA('아래 문단 글', 6)), ...drag(0, 1), SEL,
      { js: 'return getComputedStyle(__cell(1,0)).backgroundImage' }, { cmd: 'copy' }, { pb: 1 }, ...click(2), { cmd: 'paste', gap: 0.6 }, BLOCKS]);
    const s = JSON.parse(sel);
    ok('여러 칸 끌기 = 칸 선택', s.type === 'CellSelection', JSON.stringify(s));
    ok('칸 선택은 파란 칸', String(bg).includes('rgba(35, 131, 226'), bg);
    ok('다른 앱엔 탭 구분 글', pb['public.utf8-plain-text'] === '사과\t3\n바나나\t5', JSON.stringify(pb['public.utf8-plain-text']));
    ok('다른 앱엔 표 html 없음', !('public.html' in pb), Object.keys(pb).join(','));
    ok('우리 문서 표 밖엔 표로', JSON.parse(blocks).includes('table:사과3바나나5'), blocks);
  }
} finally {
  done();
}
