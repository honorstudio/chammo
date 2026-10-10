import { describe, expect, it } from 'vitest';
import { DRAG_SLOP, dragStarted, dropIndex, tabShift } from './tabDrag';

// 폭 100 탭 넷, 틈 4 — 0·104·208·312
const rects = [0, 104, 208, 312].map((left) => ({ left, width: 100 }));

describe('채팅 탭 끌기 — 크롬처럼(2026-10-10 사용자)', () => {
  it('조금 움직여야 끌기 시작 — 클릭·× 와 헷갈리지 않게', () => {
    expect(dragStarted(0, 0)).toBe(false);
    expect(dragStarted(DRAG_SLOP - 1, 0)).toBe(false);
    expect(dragStarted(DRAG_SLOP, 0)).toBe(true);
    expect(dragStarted(-DRAG_SLOP - 2, 1)).toBe(true);
  });

  it('놓을 자리 — 끄는 탭 가운데가 옆 탭 가운데를 넘으면 그 자리', () => {
    expect(dropIndex(rects, 0, 0)).toBe(0);
    expect(dropIndex(rects, 0, 50)).toBe(0); // 아직 옆 탭 가운데(154) 전
    expect(dropIndex(rects, 0, 110)).toBe(1);
    expect(dropIndex(rects, 0, 900)).toBe(3);
    expect(dropIndex(rects, 3, -110)).toBe(2);
    expect(dropIndex(rects, 3, -900)).toBe(0);
  });

  it('놓을 자리는 범위 안에서만(고정한 탭 경계)', () => {
    expect(dropIndex(rects, 3, -900, 1, 3)).toBe(1);
    expect(dropIndex(rects, 1, 900, 1, 2)).toBe(2);
  });

  it('옆 탭이 비켜 준다 — 끄는 탭 폭+틈만큼, 사이에 있는 탭만', () => {
    // 0 번을 2 번 자리로: 1·2 번이 왼쪽으로 한 칸
    expect([0, 1, 2, 3].map((i) => tabShift(i, 0, 2, 104))).toEqual([0, -104, -104, 0]);
    // 3 번을 1 번 자리로: 1·2 번이 오른쪽으로
    expect([0, 1, 2, 3].map((i) => tabShift(i, 3, 1, 104))).toEqual([0, 104, 104, 0]);
    expect([0, 1, 2, 3].map((i) => tabShift(i, 2, 2, 104))).toEqual([0, 0, 0, 0]);
  });
});
