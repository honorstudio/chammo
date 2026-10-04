import { describe, expect, it } from 'vitest';
import { duplicateBlock, moveSlot, notionSlashItems } from './docBlocks';

describe('moveSlot — 블록 손잡이를 끌 때 놓을 자리(마우스 따라가기)', () => {
  const rects = [
    { id: 'a', top: 0, bottom: 30 },
    { id: 'b', top: 30, bottom: 90 }, // b 안에 b1
    { id: 'b1', top: 60, bottom: 90 },
    { id: 'c', top: 90, bottom: 120 },
  ];
  it('다른 블록 위 절반이면 그 앞, 아래 절반이면 그 뒤', () => {
    expect(moveSlot(rects, 'a', ['a'], 95)).toEqual({ id: 'c', place: 'before', y: 90 });
    expect(moveSlot(rects, 'a', ['a'], 118)).toEqual({ id: 'c', place: 'after', y: 120 });
  });
  it('끄는 블록·그 자식 위는 놓을 자리가 아니다(자기 안으로 못 넣는다)', () => {
    expect(moveSlot(rects, 'b', ['b', 'b1'], 70)).toBeNull();
    expect(moveSlot(rects, 'b', ['b', 'b1'], 40)).toBeNull();
  });
  it('제자리(바로 앞 블록 뒤·바로 뒤 블록 앞)는 움직이지 않는다', () => {
    expect(moveSlot(rects, 'c', ['c'], 85)).toBeNull(); // b1 아래 절반 = c 앞
    expect(moveSlot(rects, 'a', ['a'], 32)).toBeNull(); // b 위 절반 = a 뒤
  });
});

describe('duplicateBlock — ⌘D 블록 복제(노션)', () => {
  it('번호(id)를 자식까지 지워 새 블록으로 넣게', () => {
    const b = { id: '1', type: 'paragraph', props: { x: 1 }, content: [{ type: 'text', text: '가' }], children: [{ id: '2', type: 'paragraph', children: [] }] };
    expect(duplicateBlock(b)).toEqual({ type: 'paragraph', props: { x: 1 }, content: [{ type: 'text', text: '가' }], children: [{ type: 'paragraph', children: [] }] });
    expect(b.id).toBe('1');
  });
});

describe('notionSlashItems — "/" 메뉴(노션처럼)', () => {
  const d = [
    { key: 'heading', title: '제목1', group: '제목', aliases: ['h1'] },
    { key: 'paragraph', title: '본문', group: '기본 블록', aliases: ['p'] },
    { key: 'check_list', title: '체크리스트', group: '기본 블록', aliases: [] },
    { key: 'image', title: '이미지', group: '미디어', aliases: ['image'] },
  ];
  const page = { key: 'page', title: '페이지', aliases: ['page'] };
  it('페이지는 기본 블록 묶음 끝에 그 묶음 이름으로 — 묶음이 둘로 갈라지지 않게', () => {
    const out = notionSlashItems(d, page);
    expect(out.map((x) => x.key)).toEqual(['heading', 'paragraph', 'check_list', 'page', 'image']);
    expect(out[3]!.group).toBe('기본 블록');
    expect(new Set(out.map((x) => x.group)).size).toBe(3);
  });
  it('하위 페이지를 못 만드는 문서면 페이지 없이', () => {
    expect(notionSlashItems(d).map((x) => x.key)).toEqual(['heading', 'paragraph', 'check_list', 'image']);
  });
  it('노션에서 쓰는 한글 이름으로도 찾는다(할 일·그림)', () => {
    const out = notionSlashItems(d);
    expect(out.find((x) => x.key === 'check_list')!.aliases).toContain('할 일');
    expect(out.find((x) => x.key === 'image')!.aliases).toEqual(expect.arrayContaining(['image', '그림', '사진']));
    expect(d[3]!.aliases).toEqual(['image']); // 원본은 그대로
  });
});
