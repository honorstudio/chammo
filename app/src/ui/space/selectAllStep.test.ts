import { describe, expect, it } from 'vitest';
import { selectAllStep, wholeText } from './selectAllStep';
import { docOf, p, posOf, table } from './docTestKit';

// 노션처럼: 첫 ⌘A = 커서가 있는 칸(표 셀·블록) 글 전체, 이미 그만큼 골라져 있으면 문서 전체
describe('selectAllStep — ⌘A 를 누를 때마다 넓힌다(칸 → 문서)', () => {
  const doc = docOf([p('위 문단'), table([['이메일', 'fake@example.com'], ['비밀번호', '']]), p('아래 문단')]);
  const cell = { from: posOf(doc, 'fake'), to: posOf(doc, '.com', 'end') };

  it('표 셀 안 커서 → 그 셀 글 전체', () => {
    const at = posOf(doc, 'example');
    expect(selectAllStep(doc, at, at)).toEqual(cell);
  });
  it('셀 안 일부만 골라져 있어도 → 그 셀 전체', () => {
    expect(selectAllStep(doc, posOf(doc, 'fake'), posOf(doc, 'fake', 'end'))).toEqual(cell);
  });
  it('셀 전체가 이미 골라져 있으면 → 문서 전체', () => {
    expect(selectAllStep(doc, cell.from, cell.to)).toBe('all');
  });
  it('빈 셀이면 셀 단계를 건너뛰고 문서 전체', () => {
    // '비밀번호' 오른쪽 빈 셀 — 셀 글 위치는 '비밀번호' 끝 + 셀 닫기·열기·문단 열기
    const empty = posOf(doc, '비밀번호', 'end') + 4;
    expect(doc.resolve(empty).parent.type.name).toBe('tableParagraph');
    expect(doc.resolve(empty).parent.content.size).toBe(0);
    expect(selectAllStep(doc, empty, empty)).toBe('all');
  });
  it('문단 안 커서 → 그 문단 글 전체, 한 번 더 → 문서 전체', () => {
    const at = posOf(doc, '문단');
    const block = { from: posOf(doc, '위 문단'), to: posOf(doc, '위 문단', 'end') };
    expect(selectAllStep(doc, at, at)).toEqual(block);
    expect(selectAllStep(doc, block.from, block.to)).toBe('all');
  });
  it('블록을 걸쳐 골라져 있으면 → 문서 전체', () => {
    expect(selectAllStep(doc, posOf(doc, '위'), posOf(doc, '아래'))).toBe('all');
  });
  it('셀 두 개를 걸치면 → 문서 전체', () => {
    expect(selectAllStep(doc, posOf(doc, '이메일'), posOf(doc, 'fake'))).toBe('all');
  });
  it('빈 문단 커서 → 문서 전체', () => {
    const d = docOf([p('글'), p()]);
    const end = d.content.size - 3; // 마지막 빈 문단 안
    expect(d.resolve(end).parent.content.size).toBe(0);
    expect(selectAllStep(d, end, end)).toBe('all');
  });
});

// 문서 전체 = 글 처음 ~ 끝(TextSelection). AllSelection 이면 BlockNote 가 마우스를 움직일 때마다
// "Position 0 is not within a blockContainer" 경고를 초당 수백 번 찍었다(2026-10-02 개발판 실측)
describe('wholeText — 문서 전체를 글 범위로', () => {
  it('첫 글 처음 ~ 마지막 글 끝(표 칸 글 포함)', () => {
    const doc = docOf([p('위 문단'), table([['a', 'b']]), p('아래 문단')]);
    expect(wholeText(doc)).toEqual({ from: posOf(doc, '위 문단'), to: posOf(doc, '아래 문단', 'end') });
  });
  it('표로 시작·끝나도 칸 글이 처음·끝', () => {
    const doc = docOf([table([['첫칸', 'b']]), table([['c', '끝칸']])]);
    expect(wholeText(doc)).toEqual({ from: posOf(doc, '첫칸'), to: posOf(doc, '끝칸', 'end') });
  });
  it('끝이 빈 문단이어도 그 빈 문단까지', () => {
    const doc = docOf([p('글'), p()]);
    expect(wholeText(doc)).toEqual({ from: posOf(doc, '글'), to: doc.content.size - 3 });
  });
  it('첫·끝 블록이 그림처럼 글 없는 블록이면 null(전체 선택으로 물러난다 — 그림을 빼먹지 않게)', () => {
    expect(wholeText(docOf([{ type: 'image', props: { url: 'a.png' } }, p('글')]))).toBeNull();
    expect(wholeText(docOf([p('글'), { type: 'image', props: { url: 'a.png' } }]))).toBeNull();
  });
});
