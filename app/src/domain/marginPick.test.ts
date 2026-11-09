import { describe, expect, it } from 'vitest';
import { clickKind, intoBox, isDrag } from './marginPick';

// 문서 여백에서 시작한 끌기(11-05 사용자 "마우스 끌기가 안 된다") — 여백 누름을 글 칸 안 점으로 당겨 그 줄부터 고른다
const box = { left: 100, top: 50, right: 700, bottom: 900 };

describe('intoBox — 여백 점을 글 칸 안으로', () => {
  it('왼쪽 여백은 글 칸 왼쪽 끝 바로 안으로(같은 줄 높이)', () => {
    expect(intoBox(box, 60, 300)).toEqual({ x: 101, y: 300 });
  });
  it('오른쪽 여백은 오른쪽 끝 바로 안으로', () => {
    expect(intoBox(box, 760, 300)).toEqual({ x: 699, y: 300 });
  });
  it('글 칸 아래·위는 위아래 끝 바로 안으로', () => {
    expect(intoBox(box, 300, 1200)).toEqual({ x: 300, y: 899 });
    expect(intoBox(box, 300, 0)).toEqual({ x: 300, y: 51 });
  });
  it('칸 안 점은 그대로', () => {
    expect(intoBox(box, 300, 300)).toEqual({ x: 300, y: 300 });
  });
  it('칸이 1px 보다 좁아도 뒤집히지 않는다', () => {
    const p = intoBox({ left: 10, top: 10, right: 10, bottom: 10 }, 0, 0);
    expect(p.x).toBe(10);
    expect(p.y).toBe(10);
  });
});

describe('isDrag — 4px 넘게 움직여야 끌기', () => {
  it('그 자리 떼기·손 떨림은 클릭', () => {
    expect(isDrag(10, 10, 10, 10)).toBe(false);
    expect(isDrag(10, 10, 12, 12)).toBe(false);
  });
  it('4px 이상이면 끌기', () => {
    expect(isDrag(10, 10, 14, 10)).toBe(true);
    expect(isDrag(10, 10, 10, 30)).toBe(true);
  });
});

describe('clickKind — 그냥 누른 여백', () => {
  it('마지막 블록 아래 빈 곳이면 맨 끝(빈 줄 만들기 — 원래 동작)', () => {
    expect(clickKind(400, 401)).toBe('end');
  });
  it('글 줄 옆 여백이면 그 줄 가까운 자리', () => {
    expect(clickKind(400, 399)).toBe('near');
    expect(clickKind(400, 400)).toBe('near');
  });
});
