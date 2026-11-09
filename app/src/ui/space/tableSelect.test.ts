import { describe, expect, it } from 'vitest';
import { cellRangeAt, oneCellRange } from './tableSelect';
import { docOf, p, posOf, table, type Doc } from './docTestKit';

// 칸(tableCell·tableHeader) 노드가 시작하는 자리 — CellSelection 의 $anchorCell.pos 와 같은 값
function cellPos(doc: Doc, text: string): number {
  let at = -1;
  doc.descendants((n, pos) => {
    if (at >= 0) return false;
    if ((n.type.name === 'tableCell' || n.type.name === 'tableHeader') && n.textContent === text) { at = pos; return false; }
    return true;
  });
  if (at < 0) throw new Error(`없는 칸: ${text}`);
  return at;
}
// CellSelection 과 같은 모양(prosemirror-tables 를 시험에 들이지 않는다)
const cells = (doc: Doc, a: string, b: string) => ({ $anchorCell: doc.resolve(cellPos(doc, a)), $headCell: doc.resolve(cellPos(doc, b)) });
const textSel = (doc: Doc, from: number, to: number) => ({ $anchor: doc.resolve(from), $head: doc.resolve(to) });

const doc = docOf([p('위 문단'), table([['이름', '값'], ['사과', '빨강 과일'], ['', '노랑']], 1), p('아래')]);

describe('cellRangeAt — 그 자리가 든 표 칸의 글 범위', () => {
  it('칸 글 가운데 → 그 칸 글 처음~끝', () => {
    expect(cellRangeAt(doc, posOf(doc, '과일'))).toEqual({ from: posOf(doc, '빨강'), to: posOf(doc, '과일', 'end') });
  });
  it('머리 칸(tableHeader)도', () => {
    expect(cellRangeAt(doc, posOf(doc, '이름') + 1)).toEqual({ from: posOf(doc, '이름'), to: posOf(doc, '이름', 'end') });
  });
  it('칸 노드 바로 안(칸 시작 +1)도 그 칸', () => {
    expect(cellRangeAt(doc, cellPos(doc, '사과') + 1)).toEqual({ from: posOf(doc, '사과'), to: posOf(doc, '사과', 'end') });
  });
  it('빈 칸 → 처음과 끝이 같은 자리', () => {
    const r = cellRangeAt(doc, cellPos(doc, '') + 2);
    expect(r).not.toBeNull();
    expect(r!.from).toBe(r!.to);
  });
  it('표 밖 문단 → null', () => {
    expect(cellRangeAt(doc, posOf(doc, '위 문단') + 1)).toBeNull();
    expect(cellRangeAt(doc, posOf(doc, '아래'))).toBeNull();
  });
});

describe('oneCellRange — 칸 하나만 고른 칸 선택이면 그 칸 글 범위(글로 복사하려고)', () => {
  it('칸 하나(세 번 클릭·끌다 돌아옴) → 그 칸 글', () => {
    expect(oneCellRange(doc, cells(doc, '빨강 과일', '빨강 과일'))).toEqual({ from: posOf(doc, '빨강'), to: posOf(doc, '과일', 'end') });
  });
  it('칸 여러 개 → null(표로 복사)', () => {
    expect(oneCellRange(doc, cells(doc, '사과', '빨강 과일'))).toBeNull();
    expect(oneCellRange(doc, cells(doc, '이름', '노랑'))).toBeNull();
  });
  it('빈 칸 하나 → null(글로 바꿀 게 없다)', () => {
    expect(oneCellRange(doc, cells(doc, '', ''))).toBeNull();
  });
  it('글 선택(TextSelection) → null', () => {
    expect(oneCellRange(doc, textSel(doc, posOf(doc, '빨강'), posOf(doc, '과일', 'end')))).toBeNull();
  });
});
