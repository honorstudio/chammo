import { describe, expect, it } from 'vitest';
import { moveHead, spanIds, textSpan } from './blockPick';
import { docOf, p, posOf } from './docTestKit';

// 노션식 블록 고르기(2026-11-09 사용자) — 고른 범위·화살표로 옮기기·고른 블록 글 전체 위치
const ids = ['a', 'b', 'c', 'd'];

describe('spanIds — 기준 블록 ~ 끝 블록(같은 줄 형제 안)', () => {
  it('앞으로·뒤로 둘 다 문서 순서', () => {
    expect(spanIds(ids, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(spanIds(ids, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(spanIds(ids, 'c', 'c')).toEqual(['c']);
  });
  it('형제에 없는 번호 — 기준 블록만(없으면 빈 것)', () => {
    expect(spanIds(ids, 'b', 'x')).toEqual(['b']);
    expect(spanIds(ids, 'x', 'b')).toEqual([]);
  });
});

describe('moveHead — 위아래 화살표, 끝에서는 멈춤', () => {
  it('한 칸씩', () => {
    expect(moveHead(ids, 'b', 1)).toBe('c');
    expect(moveHead(ids, 'b', -1)).toBe('a');
  });
  it('맨 위·맨 아래에서 그대로', () => {
    expect(moveHead(ids, 'a', -1)).toBe('a');
    expect(moveHead(ids, 'd', 1)).toBe('d');
  });
});

describe('textSpan — 고른 블록들의 글 처음 ~ 끝(편집기 선택으로 덮어 복사·⌘D 가 그대로 돈다)', () => {
  const doc = docOf([p('첫째 글'), { type: 'bulletListItem', content: '둘째', children: [p('안쪽 글')] }, p('셋째 끝'), { type: 'image', props: { url: 'x.png' } }]);
  const id = (k: number) => {
    const out: string[] = [];
    doc.descendants((n) => { if (n.type.name === 'blockContainer') out.push(n.attrs.id as string); return true; });
    return out[k]!;
  };
  it('블록 하나 — 그 블록 글', () => {
    expect(textSpan(doc, [id(0)])).toEqual({ from: posOf(doc, '첫째'), to: posOf(doc, '첫째 글', 'end') });
  });
  it('여러 블록 — 첫 블록 글 처음 ~ 끝 블록(안쪽 블록까지) 글 끝', () => {
    expect(textSpan(doc, [id(0), id(1)])).toEqual({ from: posOf(doc, '첫째'), to: posOf(doc, '안쪽 글', 'end') });
  });
  it('글 없는 블록(그림)만 — null(블록 통째 선택으로)', () => {
    expect(textSpan(doc, [id(4)])).toBeNull();
  });
  it('없는 번호 — null', () => {
    expect(textSpan(doc, ['없음'])).toBeNull();
  });
});
