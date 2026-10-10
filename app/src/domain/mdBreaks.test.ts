import { describe, expect, it } from 'vitest';
import { dropBreakSpace, keepBreaks, keepItemLines } from './mdBreaks';

// 편집기(BlockNote 0.51.4)는 문단 안 '그냥 줄바꿈'을 <br>+공백으로 읽어 글이 "첫 줄\n 둘째 줄" 이 되고(둘째 줄 앞 공백),
// 쓸 때는 모든 줄바꿈을 `\` 강제 줄바꿈으로 내보낸다 — 한 글자만 고쳐도 파일 전체 줄바꿈이 바뀌었다(2026-10-04 QA N1, 실측)
const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: 'text', text: t, styles });

describe('dropBreakSpace — 읽은 블록에서 줄바꿈 뒤 끼어든 공백 한 칸을 뺀다', () => {
  it('재현: 문단 글 "첫 줄\\n 둘째 줄" → "첫 줄\\n둘째 줄"', () => {
    const bs = [{ type: 'paragraph', content: [text('첫 줄\n 둘째 줄\n 셋째 줄')], children: [] }];
    expect(dropBreakSpace(bs)[0]!.content).toEqual([text('첫 줄\n둘째 줄\n셋째 줄')]);
  });
  it('줄바꿈과 공백이 다른 조각에 갈라져 와도(굵게·링크)', () => {
    const bs = [{ type: 'paragraph', content: [text('앞\n'), text(' 굵게', { bold: true }), text('\n'), { type: 'link', href: 'a.md', content: [text(' 링크')] }], children: [] }];
    expect(dropBreakSpace(bs)[0]!.content).toEqual([text('앞\n'), text('굵게', { bold: true }), text('\n'), { type: 'link', href: 'a.md', content: [text('링크')] }]);
  });
  it('공백만 남은 조각은 뺀다', () => {
    const bs = [{ type: 'paragraph', content: [text('앞\n'), text(' '), text('뒤', { bold: true })], children: [] }];
    expect(dropBreakSpace(bs)[0]!.content).toEqual([text('앞\n'), text('뒤', { bold: true })]);
  });
  it('하위 블록(목록 안)·인용·제목도', () => {
    const bs = [{ type: 'bulletListItem', content: [text('a')], children: [{ type: 'quote', content: [text('b\n c')], children: [] }] }];
    expect((dropBreakSpace(bs)[0]!.children[0] as { content: unknown }).content).toEqual([text('b\nc')]);
  });
  it('코드 블록·줄 안 코드의 공백은 진짜 글 — 그대로', () => {
    const code = [{ type: 'codeBlock', content: [text('a\n  b')], children: [] }];
    expect(dropBreakSpace(code)).toEqual(code);
    const inline = [{ type: 'paragraph', content: [text('a\n'), text(' x', { code: true })], children: [] }];
    expect(dropBreakSpace(inline)).toEqual(inline);
  });
  it('줄바꿈 없는 공백·두 칸째 공백은 안 건드린다', () => {
    const bs = [{ type: 'paragraph', content: [text('a b  c\n  d')], children: [] }];
    expect(dropBreakSpace(bs)[0]!.content).toEqual([text('a b  c\n d')]);
  });
  it('표·그림처럼 글 배열이 아닌 블록은 그대로', () => {
    const bs = [{ type: 'table', content: { type: 'tableContent', rows: [] }, children: [] }, { type: 'image', props: { url: 'a.png' }, children: [] }];
    expect(dropBreakSpace(bs)).toEqual(bs);
  });
});

// 실측 모양 — 원래 파일 vs BlockNote 가 쓴 글(공백은 dropBreakSpace 로 빠진 뒤)
const orig = ['# 제목', '', '첫 줄', '둘째 줄', '셋째 줄', '', '> 인용 첫 줄', '> 인용 둘째 줄', '', '강제\\', '줄바꿈', '', '두 칸 공백  ', '줄바꿈 둘'].join('\n');
const blocknote = ['# 제목', '', '첫 줄\\', '둘째 줄\\', '셋째 줄', '', '> 인용 첫 줄\\', '> 인용 둘째 줄', '', '강제\\', '줄바꿈', '', '두 칸 공백\\', '줄바꿈 둘', ''].join('\n');

describe('keepBreaks — 원래 파일의 줄바꿈 모양을 지킨다', () => {
  it('재현: 안 고친 문서를 쓰면 원래 글 그대로(끝 줄바꿈만 더해짐)', () => {
    expect(keepBreaks(orig, blocknote)).toBe(orig + '\n');
  });
  it('한 줄 고치면 그 줄만 바뀐다 — 고친 줄 앞뒤 줄바꿈도 그냥 줄바꿈', () => {
    const out = keepBreaks(orig, blocknote.replace('둘째 줄\\', '둘째 X줄\\'));
    expect(out).toBe(orig.replace('둘째 줄', '둘째 X줄') + '\n');
  });
  it('사람이 새로 넣은 강제 줄바꿈(Shift+Enter)은 `\\` 그대로', () => {
    const next = blocknote.replace('셋째 줄', '셋째 줄\\\n새 줄');
    expect(keepBreaks(orig, next)).toContain('셋째 줄\\\n새 줄');
  });
  it('원래 강제 줄바꿈(`\\`)은 그대로, 두 칸 공백 모양도 원래대로', () => {
    const out = keepBreaks(orig, blocknote);
    expect(out).toContain('강제\\\n줄바꿈');
    expect(out).toContain('두 칸 공백  \n줄바꿈 둘');
  });
  it('코드 블록 안 `\\` 줄 끝은 안 건드린다', () => {
    const o = ['a', 'b', '', '```', 'a\\', 'b', '```'].join('\n');
    const n = ['a\\', 'b', '', '```', 'a\\', 'b', '```', ''].join('\n');
    expect(keepBreaks(o, n)).toBe(o + '\n');
  });
  it('글자 `\\` 로 끝나는 줄(탈출된 \\\\)은 강제 줄바꿈이 아니다', () => {
    const o = 'a\nb';
    expect(keepBreaks(o, 'a\\\\\nb\n')).toBe('a\\\\\nb\n');
    expect(keepBreaks(o, 'a\\\\\\\nb\n')).toBe('a\\\\\nb\n'); // 글자 \ + 강제 줄바꿈 → 그냥 줄바꿈으로
  });
  it('굵게가 줄을 넘던 문단 — 편집기가 굵게를 줄마다 끊어 써도 그냥 줄바꿈으로(실측 모양)', () => {
    const o = '그래서 **화면이 옛 상태를 들고 있으면 그게\n되살아난다** — 실제로 겪었다.\n다음 줄';
    const n = '그래서 **화면이 옛 상태를 들고 있으면 그게**\\\n**되살아난다** — 실제로 겪었다.\\\n다음 줄\n';
    expect(keepBreaks(o, n)).toBe('그래서 **화면이 옛 상태를 들고 있으면 그게**\n**되살아난다** — 실제로 겪었다.\n다음 줄\n');
  });
  it('목록 항목 안 줄바꿈은 `\\` 그대로 — 그냥 줄바꿈이면 다시 읽을 때 항목이 쪼개진다', () => {
    expect(keepBreaks('a\nb', '* a\\\n  b\n')).toBe('* a\\\n  b\n');
    expect(keepBreaks('a\nb', '1. a\\\n   b\n')).toBe('1. a\\\n   b\n');
  });
  it('원래 파일에 없던 문단이면 그대로', () => {
    expect(keepBreaks('', 'a\\\nb\n')).toBe('a\\\nb\n');
    expect(keepBreaks('x\ny', 'a\\\nb\n')).toBe('a\\\nb\n');
  });
  it('다음 줄이 비었거나 마지막 줄이면 안 건드린다', () => {
    expect(keepBreaks('a\nb', 'a\\\n\nb')).toBe('a\\\n\nb');
    expect(keepBreaks('a\nb', 'a\\')).toBe('a\\');
  });
});

// 문단 안 이어진 줄의 들여쓰기 — 편집기는 지운다(2026-10-04 실측 Harnitor starter). 그냥 줄바꿈을 되살릴 때 원래 들여쓰기도
describe('keepBreaks — 이어진 줄 들여쓰기', () => {
  it('재현: 최상위 문단의 들여 쓴 이어진 줄', () => {
    const o = '**제목 줄**\n  같은 깊이의 폴더\n  하나도 없으면';
    expect(keepBreaks(o, 'X**제목 줄**\\\n같은 깊이의 폴더\\\n하나도 없으면\n')).toBe('X**제목 줄**\n  같은 깊이의 폴더\n  하나도 없으면\n');
  });
  it('들여 쓴 왼쪽 줄 뒤도 — 문단 이어진 줄의 들여쓰기는 md 에서 뜻이 없어 모양만 되살린다', () => {
    expect(keepBreaks('a\n  b', '  a\\\nb\n')).toBe('  a\n  b\n');
  });
});

// 목록 항목의 들여 쓴 이어진 줄 — 편집기는 항목 + 하위 문단으로 읽는다. 쓸 땐 하위 문단을 빈 줄 + 항목 글자 폭 들여쓰기로 쓰고(nestChildren),
// 원래 빈 줄 없이 붙어 있던 이어진 줄이면 빈 줄을 뺀다(2026-10-04 실측)
describe('keepItemLines — 체크 항목에 붙어 있던 이어진 줄(roadmap 문서 저장 ①)', () => {
  // 진짜 BlockNote 0.51: '- [ ] 항목\n  이어진 줄' 의 항목을 고치면 '* [ ] 항목\n\n이어진 줄' — 이어진 줄이 들여쓰기 없는 형제 문단으로 나왔다
  it('재현: 원래 글에서 체크 항목에 붙어 있던 줄이면 빈 줄을 빼고 원래 들여쓰기로', () => {
    expect(keepItemLines('- [ ] 항목\n  이어진 줄\n', '- [ ] 항목 고침\n\n이어진 줄\n')).toBe('- [ ] 항목 고침\n  이어진 줄\n');
    expect(keepItemLines('- [x] 끝남\n  설명\n', '- [x] 끝남!\n\n설명\n')).toBe('- [x] 끝남!\n  설명\n');
  });
  it('보통 항목도 형제 문단으로 나오면 같이(하네스 실측)', () => {
    expect(keepItemLines('- 항목\n  이어진 줄\n', '- 항목 고침\n\n이어진 줄\n')).toBe('- 항목 고침\n  이어진 줄\n');
  });
  it('원래 따로 있던 문단은 그대로', () => {
    expect(keepItemLines('- [ ] 항목\n\n문단\n', '- [ ] 항목 고침\n\n문단\n')).toBe('- [ ] 항목 고침\n\n문단\n');
    expect(keepItemLines('- [ ] 항목\n  이어진 줄\n\n문단\n', '- [ ] 항목 고침\n\n이어진 줄\n\n문단\n')).toBe('- [ ] 항목 고침\n  이어진 줄\n\n문단\n');
  });
});

describe('keepItemLines — 목록 항목에 붙어 있던 이어진 줄', () => {
  const o = '3. **Google Auth Platform**: pick **External** as the\n   audience. The single page\n   into two.';
  it('재현: 항목을 고치면 이어진 줄 앞에 빈 줄이 생긴다 → 원래처럼 붙인다', () => {
    const fresh = '1. X**Google Auth Platform**: pick **External** as the\n\n   audience. The single page\\\n   into two.\n';
    expect(keepItemLines(o, fresh)).toBe('1. X**Google Auth Platform**: pick **External** as the\n   audience. The single page\\\n   into two.\n');
    expect(keepItemLines(o, keepBreaks(o, fresh))).toBe('1. X**Google Auth Platform**: pick **External** as the\n   audience. The single page\n   into two.\n');
  });
  it('이어진 줄 자체를 고쳐도 — 항목 줄이 원래 이어진 줄을 가졌던 항목이면', () => {
    expect(keepItemLines('- [ ] **토큰** 없다. 넣기 전까지\n  프로덕션에 못 올린다.', '- [ ] **토큰** 없다. 넣기 전까지\n\n  X프로덕션에 못 올린다.\n'))
      .toBe('- [ ] **토큰** 없다. 넣기 전까지\n  X프로덕션에 못 올린다.\n');
  });
  it('원래 빈 줄로 띄운 하위 문단·들여 쓰지 않은 문단(항목 밖 문단)은 그대로', () => {
    expect(keepItemLines('- a\n\n  b', '- a\n\n  b\n')).toBe('- a\n\n  b\n');
    expect(keepItemLines('- a\n  b', '- a\n\nc\n')).toBe('- a\n\nc\n');
  });
});
