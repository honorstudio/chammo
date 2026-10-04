import { describe, expect, it } from 'vitest';
import { copyText, rowsText } from './copyText';
import { bold, code, docOf, p, posOf, sel, selAll, table, type Doc } from './docTestKit';

describe('rowsText — 표를 사람 글로(한 행 = 한 줄, 칸 사이 탭)', () => {
  it('행은 줄, 칸은 탭', () => {
    expect(rowsText([['이메일', 'a@b.c'], ['비밀번호', 'x']])).toBe('이메일\ta@b.c\n비밀번호\tx');
  });
  it('머리 줄이 비어 있으면 뺀다', () => {
    expect(rowsText([['', ''], ['이메일', 'a@b.c']])).toBe('이메일\ta@b.c');
    expect(rowsText([[' ', '\t'], ['a', 'b']])).toBe('a\tb');
  });
  it('가운데 빈 줄은 그대로 둔다(머리 줄만)', () => {
    expect(rowsText([['a', 'b'], ['', ''], ['c', 'd']])).toBe('a\tb\n\t\nc\td');
  });
  it('칸 안의 탭·줄바꿈은 공백으로 — 칸이 밀리지 않게', () => {
    expect(rowsText([['한\t글', '첫줄\n둘째줄']])).toBe('한 글\t첫줄 둘째줄');
  });
  it('빈 표·행 없음', () => {
    expect(rowsText([])).toBe('');
    expect(rowsText([['', '']])).toBe('');
  });
});

describe('copyText — 복사한 문서 조각을 사람 글로(text/plain)', () => {
  it('이메일·비밀번호 표 전체 — 마크다운 표시(| --- | 백틱 굵게) 없이', () => {
    const doc = docOf([table([['항목', '값'], ['이메일', 'fake@example.com'], ['비밀번호', 'Pass|12`34']], 1)]);
    // 셀 값에 실제로 든 파이프·백틱은 글자 그대로 남는다
    const d2 = docOf([table([['이메일', ''], ['비밀번호', '']])]);
    expect(copyText(selAll(doc))).toBe('항목\t값\n이메일\tfake@example.com\n비밀번호\tPass|12`34');
    expect(copyText(selAll(d2))).toBe('이메일\t\n비밀번호\t');
  });
  it('인라인 코드·굵게 표시는 벗긴다', () => {
    const doc = docOf([table([['', ''], ['x', 'y']]), p({ type: 'text', text: '앞 ', styles: {} }, code('fake@example.com'), { type: 'text', text: ' 와 ', styles: {} }, bold('굵게'))]);
    expect(copyText(selAll(doc))).toBe('x\ty\n앞 fake@example.com 와 굵게');
  });
  it('셀 안 서식(코드·굵게)도 글만', () => {
    const doc = docOf([{ type: 'table', content: { type: 'tableContent', rows: [{ cells: [[code('키')], [bold('값'), { type: 'text', text: '!', styles: {} }]] }] } }]);
    expect(copyText(selAll(doc))).toBe('키\t값!');
  });
  it('문단·제목·목록 — 블록마다 한 줄, 목록 기호는 사람 글로', () => {
    const doc = docOf([
      { type: 'heading', props: { level: 2 }, content: '제목' },
      p('문단'),
      { type: 'bulletListItem', content: '하나', children: [{ type: 'bulletListItem', content: '안쪽' }] },
      { type: 'bulletListItem', content: '둘' },
      { type: 'numberedListItem', content: '첫째' },
      { type: 'numberedListItem', content: '둘째' },
      { type: 'checkListItem', props: { checked: true }, content: '끝남' },
      { type: 'checkListItem', content: '남음' },
    ]);
    expect(copyText(selAll(doc))).toBe('제목\n문단\n- 하나\n  - 안쪽\n- 둘\n1. 첫째\n2. 둘째\n[x] 끝남\n[ ] 남음');
  });
  it('링크는 글 뒤에 주소 — 글이 곧 주소면 한 번만', () => {
    const doc = docOf([p({ type: 'link', href: 'https://ex.com/a', content: '가이드' }, { type: 'text', text: ' 와 ', styles: {} }, { type: 'link', href: 'https://ex.com', content: 'https://ex.com' })]);
    expect(copyText(selAll(doc))).toBe('가이드 (https://ex.com/a) 와 https://ex.com');
  });
  it('한 블록 안 일부만 고르면 고른 글만(목록 기호·주소 안 붙임)', () => {
    const doc = docOf([{ type: 'bulletListItem', content: '목록 안의 글자' }]);
    expect(copyText(sel(doc, posOf(doc, '안의'), posOf(doc, '안의', 'end')))).toBe('안의');
  });
  it('표 한 칸 안 일부만 고르면 그 글만', () => {
    const doc = docOf([table([['이메일', 'fake@example.com']])]);
    expect(copyText(sel(doc, posOf(doc, 'fake'), posOf(doc, '.com', 'end')))).toBe('fake@example.com');
  });
  it('블록을 걸쳐 일부만 — 앞 블록 뒷부분 + 뒤 블록 앞부분', () => {
    const doc = docOf([p('첫 문단 글'), p('둘째 문단 글')]);
    expect(copyText(sel(doc, posOf(doc, '문단 글'), posOf(doc, '둘째', 'end')))).toBe('문단 글\n둘째');
  });
  it('셀 여러 개를 고른 조각(CellSelection — 표 없이 행부터 온다)도 행·탭', () => {
    const doc = docOf([table([['', ''], ['이메일', 'fake@example.com']])]);
    let rows: Doc['content'] | null = null;
    doc.descendants((n) => { if (n.type.name === 'table') rows = n.content; return !rows; });
    const cellSel = { $from: doc.resolve(3), $to: doc.resolve(doc.content.size - 3), content: () => ({ content: rows! }) as unknown as ReturnType<Doc['slice']> };
    expect(copyText(cellSel)).toBe('이메일\tfake@example.com');
  });
  it('코드 블록은 줄 그대로', () => {
    const doc = docOf([{ type: 'codeBlock', content: 'a = 1\nb = 2' }, p('뒤')]);
    expect(copyText(selAll(doc))).toBe('a = 1\nb = 2\n뒤');
  });
  it('문단 안 줄바꿈(Shift+Enter)은 줄바꿈', () => {
    const doc = docOf([p('첫 줄\n둘째 줄')]);
    expect(copyText(selAll(doc))).toBe('첫 줄\n둘째 줄');
  });
  it('끝의 빈 블록은 버리고, 사이 빈 문단은 빈 줄로', () => {
    const doc = docOf([p('위'), p(), p('아래'), p()]);
    expect(copyText(selAll(doc))).toBe('위\n\n아래');
  });
});
